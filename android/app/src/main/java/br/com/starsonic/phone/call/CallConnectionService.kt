package br.com.starsonic.phone.call

import android.content.ComponentName
import android.media.AudioManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.telecom.Conferenceable
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.util.Log
import br.com.starsonic.phone.App
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * O serviço que o Telecom do Android chama para criar as ligações do app (self-managed). A recebida só nasce
 * se ainda toca, e a feita só se o CallManager ainda espera por ela; senão, uma Connection que já falhou. Enquanto o
 * Telecom o mantém (com as ligações de pé), o [AndroidTelecom] o usa para pôr a conferência no Telecom.
 * Roda na thread principal.
 */
class CallConnectionService : ConnectionService() {
    private val app: App
        get() = application as App

    override fun onCreate() {
        super.onCreate()
        app.telecom.attach(this)
    }

    override fun onDestroy() {
        app.telecom.detach(this)
        super.onDestroy()
    }

    override fun onCreateIncomingConnection(manager: PhoneAccountHandle?, request: ConnectionRequest): Connection {
        val call = incoming(request)
        val ringing = app.calls.isRinging(call.callId)
        CallLog.i { "Telecom: criar a recebida ${call.callId} (tocando: $ringing)" }
        if (!ringing) return Connection.createFailedConnection(DisconnectCause(DisconnectCause.MISSED))
        return app.telecom.created(CallConnection(app, incoming = true, call.callId, call.number, call.name))
    }

    override fun onCreateIncomingConnectionFailed(manager: PhoneAccountHandle?, request: ConnectionRequest) {
        // O Android não deixou (uma ligação da operadora começou): ocupado, e a perdida é avisada.
        val callId = incoming(request).callId
        CallLog.w { "Telecom: a recebida $callId não foi criada" }
        app.calls.onTelecomFailed(callId)
    }

    override fun onCreateOutgoingConnection(manager: PhoneAccountHandle?, request: ConnectionRequest): Connection {
        if (!app.telecom.takeOutgoing() || !app.calls.isDialing()) {
            CallLog.i { "Telecom: a feita já não é esperada" }
            return Connection.createFailedConnection(DisconnectCause(DisconnectCause.LOCAL))
        }
        CallLog.i { "Telecom: criar a feita" }
        val number = request.address?.schemeSpecificPart.orEmpty()
        val connection = app.telecom.created(CallConnection(app, incoming = false, CallManager.NO_ID, number, ""))
        app.calls.onOutgoingReady()   // o motor liga (numa thread própria)
        return connection
    }

    override fun onCreateOutgoingConnectionFailed(manager: PhoneAccountHandle?, request: ConnectionRequest) {
        CallLog.w { "Telecom: a feita não foi criada" }
        app.telecom.takeOutgoing()
        app.calls.onTelecomFailed(CallManager.NO_ID)
    }

    // A recebida do pedido: os extras que o app mandou vêm aninhados (ver IncomingExtras).
    private fun incoming(request: ConnectionRequest): IncomingRequest {
        val top = request.extras
        val nested = top?.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS)
        return IncomingExtras.read(
            nested = nested?.let(::BundleExtras),
            top = top?.let(::BundleExtras),
            ringing = app.calls.ringing(),
            address = request.address?.schemeSpecificPart.orEmpty(),
        )
    }
}

/** Os [Extras] de um android.os.Bundle. */
private class BundleExtras(private val bundle: Bundle) : Extras {
    override fun int(key: String): Int? = if (bundle.containsKey(key)) bundle.getInt(key) else null

    override fun string(key: String): String? = bundle.getString(key)
}

/**
 * O [TelecomAdapter] do app: a conta "Starsonic Phone" self-managed no Telecom ([register]), as Connections das
 * ligações de agora (até duas, como no CallManager), a conferência das duas ([CallConference]) e as rotas de áudio
 * ([routes], [setRoute]), que o Telecom decide para todas.
 *
 * Os pedidos do CallManager chegam de qualquer thread; o que mexe nas Connections e na conferência vai para a thread
 * principal, onde o Telecom também as chama, na ordem dos pedidos.
 *
 * A conferência: as duas Connections viram filhas de uma Conference do Telecom, que o serviço
 * ([CallConnectionService.addConference]) entrega a ele. Enquanto elas são filhas, o estado delas fica como estava
 * (a ativa e a em espera): o setActive de uma filha faria o Telecom pôr a conferência em espera (a ligação da frente,
 * para ele), e a espera voltaria ao CallManager como um pedido dele. Quando ela sai, as Connections voltam a ser
 * ligações soltas, e o CallManager diz qual é a ativa.
 */
class AndroidTelecom(private val app: App) : TelecomAdapter {
    private val telecom = app.getSystemService(TelecomManager::class.java)
    private val audio = app.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())

    /** A conta do app no Telecom. */
    val handle = PhoneAccountHandle(ComponentName(app, CallConnectionService::class.java), ACCOUNT_ID)

    private val lock = Any()
    private val connections = ArrayList<CallConnection>(MAX_CONNECTIONS)   // as de agora, na ordem em que nasceram
    private var outgoingPending = false   // placeOutgoing pedido, o Telecom ainda não criou a Connection

    // Só na thread principal: o serviço que o Telecom mantém (null: nenhum agora) e a conferência de agora (null:
    // nenhuma).
    private var service: CallConnectionService? = null
    private var conference: CallConference? = null

    private val mutableRoutes = MutableStateFlow(AudioRoutes())

    /** As rotas de áudio das ligações de agora. */
    val routes: StateFlow<AudioRoutes> = mutableRoutes

    /** Registra (ou atualiza) a conta self-managed "Starsonic Phone" no Telecom. */
    fun register() {
        val account = PhoneAccount.builder(handle, ACCOUNT_LABEL)
            .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
            .setSupportedUriSchemes(listOf(PhoneAccount.SCHEME_SIP))
            .build()
        try {
            telecom.registerPhoneAccount(account)
            CallLog.i { "Telecom: conta registrada (ativa: ${telecom.getPhoneAccount(handle)?.isEnabled})" }
        } catch (e: RuntimeException) {
            Log.w(TAG, "a conta do Telecom não foi registrada", e)
        }
    }

    override fun incomingPermitted(): Boolean =
        try {
            // Uma ligação da operadora tocando ou em andamento põe o áudio do celular nesses modos.
            val carrierCall = audio.mode == AudioManager.MODE_IN_CALL || audio.mode == AudioManager.MODE_RINGTONE
            val permitted = telecom.isIncomingCallPermitted(handle)
            CallLog.i { "Telecom: recebida permitida $permitted, modo do áudio ${audio.mode}" }
            permitted && !carrierCall
        } catch (e: RuntimeException) {
            Log.w(TAG, "o Telecom não respondeu se a ligação pode entrar", e)
            true
        }

    override fun addIncoming(callId: Int, number: String, name: String) {
        // O Telecom devolve este pacote inteiro como os extras do pedido (onCreateIncomingConnection). Com outra
        // ligação em andamento, o caminho é o mesmo: a segunda ganha a Connection dela.
        val call = Bundle().apply {
            putInt(IncomingExtras.CALL_ID, callId)
            putString(IncomingExtras.NUMBER, number)
            putString(IncomingExtras.NAME, name)
        }
        val extras = Bundle().apply {
            putBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS, call)
            putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS, Uri.fromParts(PhoneAccount.SCHEME_SIP, number, null))
        }
        try {
            telecom.addNewIncomingCall(handle, extras)
            CallLog.i { "Telecom: recebida $callId entregue" }
        } catch (e: RuntimeException) {
            Log.w(TAG, "o Telecom recusou a ligação recebida", e)
            app.calls.onTelecomFailed(callId)
        }
    }

    override fun placeOutgoing(number: String) {
        synchronized(lock) { outgoingPending = true }
        val extras = Bundle().apply { putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle) }
        try {
            telecom.placeCall(Uri.fromParts(PhoneAccount.SCHEME_SIP, number, null), extras)
        } catch (e: RuntimeException) {
            Log.w(TAG, "o Telecom recusou a ligação feita", e)
            synchronized(lock) { outgoingPending = false }
            app.calls.onTelecomFailed(CallManager.NO_ID)
        }
    }

    override fun setActive(callId: Int) {
        main.post { connectionFor(callId)?.setActive() }
    }

    override fun setOnHold(callId: Int) {
        main.post { connectionFor(callId)?.setOnHold() }
    }

    override fun disconnect(callId: Int, cause: Int) {
        if (callId == CallManager.NO_ID) synchronized(lock) { outgoingPending = false }
        main.post {
            val ended = connectionFor(callId) ?: return@post
            // Uma filha não sai sozinha: a conferência sai antes (o CallManager já a tira; isto é só a garantia).
            if (conference?.connections?.contains(ended) == true) dissolve()
            val last = synchronized(lock) {
                connections.removeAll { it === ended }
                connections.isEmpty()
            }
            ended.setDisconnected(DisconnectCause(cause))
            ended.destroy()
            if (last) mutableRoutes.value = AudioRoutes()
        }
    }

    override fun joinConference(callIdA: Int, callIdB: Int) {
        main.post {
            val first = synchronized(lock) { connections.firstOrNull { it.callId == callIdA } }
            val second = synchronized(lock) { connections.firstOrNull { it.callId == callIdB } }
            val service = service
            if (first == null || second == null || first === second || service == null) {
                CallLog.w {
                    "Telecom: sem a conferência de $callIdA e $callIdB (Connections: ${first != null} e " +
                        "${second != null}, serviço: ${service != null})"
                }
                return@post
            }
            dissolve()   // uma que tenha sobrado
            val joined = CallConference(app, handle)
            joined.addConnection(first)
            joined.addConnection(second)
            joined.setActive()
            try {
                service.addConference(joined)
                conference = joined
                CallLog.i { "Telecom: conferência de $callIdA e $callIdB" }
            } catch (e: RuntimeException) {
                Log.w(TAG, "o Telecom recusou a conferência", e)
                joined.destroy()
            }
        }
    }

    override fun splitConference() {
        main.post { dissolve() }
    }

    /**
     * Leva o áudio das ligações para [route] (CallAudioState.ROUTE_*): a rota é uma só no Telecom, e qualquer
     * Connection a pede. Na thread principal.
     */
    @Suppress("DEPRECATION")   // setAudioRoute ainda vale no Android 14+ (a API nova pede o CallEndpoint)
    fun setRoute(route: Int) {
        synchronized(lock) { connections.lastOrNull() }?.setAudioRoute(route)
    }

    // Na thread principal: o Telecom criou a Connection; ela passa a ser uma das ligações de agora. Uma terceira
    // seria uma que sobrou (o CallManager nunca tem três): a mais velha sai.
    internal fun created(created: CallConnection): CallConnection {
        val stale = synchronized(lock) {
            connections += created
            if (connections.size > MAX_CONNECTIONS) connections.removeAt(0) else null
        }
        if (stale != null) {
            stale.setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
            stale.destroy()
        }
        return created
    }

    // Na thread principal: o Telecom vai criar a feita; true se ela ainda é esperada (e deixa de ser).
    internal fun takeOutgoing(): Boolean = synchronized(lock) { outgoingPending.also { outgoingPending = false } }

    // Na thread principal: as rotas mudaram, vistas de uma das Connections de agora ou da conferência (o Telecom as
    // manda à ligação da frente: a conferência, quando há uma; são as mesmas para todas).
    internal fun onRoutes(from: Conferenceable, routes: AudioRoutes) {
        if (from === conference || synchronized(lock) { connections.any { it === from } }) mutableRoutes.value = routes
    }

    // Na thread principal: o Telecom criou (ou recriou) o serviço das ligações, e o destruiu.
    internal fun attach(created: CallConnectionService) {
        service = created
    }

    internal fun detach(destroyed: CallConnectionService) {
        if (service === destroyed) service = null
    }

    // Na thread principal: a conferência sai do Telecom (o destroy tira as filhas antes e a dá por desligada); as
    // Connections ficam como estavam, soltas.
    private fun dissolve() {
        val ended = conference ?: return
        conference = null
        ended.destroy()
        CallLog.i { "Telecom: a conferência saiu" }
    }

    // Com a trava ou não: a Connection da ligação [callId]; se nenhuma tem esse id, é o da feita que ainda não tem
    // id (só há uma por vez), que o ganha aqui.
    private fun connectionFor(callId: Int): CallConnection? = synchronized(lock) {
        connections.firstOrNull { it.callId == callId }
            ?: connections.firstOrNull { !it.incoming && it.callId == CallManager.NO_ID }?.also { it.callId = callId }
    }

    companion object {
        private const val MAX_CONNECTIONS = 2
        private const val ACCOUNT_ID = "starsonic"
        private const val ACCOUNT_LABEL = "Starsonic Phone"
        private const val TAG = "StarsonicTelecom"
    }
}
