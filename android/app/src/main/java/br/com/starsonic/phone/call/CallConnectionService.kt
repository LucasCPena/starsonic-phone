package br.com.starsonic.phone.call

import android.content.ComponentName
import android.media.AudioManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
 * se ainda toca, e a feita só se o CallManager ainda espera por ela; senão, uma Connection que já falhou.
 * Roda na thread principal.
 */
class CallConnectionService : ConnectionService() {
    private val app: App
        get() = application as App

    override fun onCreateIncomingConnection(manager: PhoneAccountHandle?, request: ConnectionRequest): Connection {
        val extras = request.extras ?: Bundle.EMPTY
        val callId = extras.getInt(AndroidTelecom.EXTRA_CALL_ID, CallManager.NO_ID)
        if (!app.calls.isRinging(callId)) return Connection.createFailedConnection(DisconnectCause(DisconnectCause.MISSED))
        val number = extras.getString(AndroidTelecom.EXTRA_NUMBER).orEmpty()
        val name = extras.getString(AndroidTelecom.EXTRA_NAME).orEmpty()
        return app.telecom.created(CallConnection(app, incoming = true, callId, number, name))
    }

    override fun onCreateIncomingConnectionFailed(manager: PhoneAccountHandle?, request: ConnectionRequest) {
        // O Android não deixou (uma ligação da operadora começou): ocupado, e a perdida é avisada.
        val callId = request.extras?.getInt(AndroidTelecom.EXTRA_CALL_ID, CallManager.NO_ID) ?: CallManager.NO_ID
        app.calls.onTelecomFailed(callId)
    }

    override fun onCreateOutgoingConnection(manager: PhoneAccountHandle?, request: ConnectionRequest): Connection {
        if (!app.telecom.takeOutgoing() || !app.calls.isDialing()) {
            return Connection.createFailedConnection(DisconnectCause(DisconnectCause.LOCAL))
        }
        val number = request.address?.schemeSpecificPart.orEmpty()
        val connection = app.telecom.created(CallConnection(app, incoming = false, CallManager.NO_ID, number, ""))
        app.calls.onOutgoingReady()   // o motor liga (numa thread própria)
        return connection
    }

    override fun onCreateOutgoingConnectionFailed(manager: PhoneAccountHandle?, request: ConnectionRequest) {
        app.telecom.takeOutgoing()
        app.calls.onTelecomFailed(CallManager.NO_ID)
    }
}

/**
 * O [TelecomAdapter] do app: a conta "Starsonic Phone" self-managed no Telecom ([register]), a Connection da
 * ligação de agora (uma por vez) e as rotas de áudio dela ([routes], [setRoute]).
 *
 * Os pedidos do CallManager chegam de qualquer thread; o que mexe na Connection vai para a thread principal,
 * onde o Telecom também a chama.
 */
class AndroidTelecom(private val app: App) : TelecomAdapter {
    private val telecom = app.getSystemService(TelecomManager::class.java)
    private val audio = app.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())

    /** A conta do app no Telecom. */
    val handle = PhoneAccountHandle(ComponentName(app, CallConnectionService::class.java), ACCOUNT_ID)

    private val lock = Any()
    private var connection: CallConnection? = null   // a ligação de agora no Telecom
    private var outgoingPending = false              // placeOutgoing pedido, o Telecom ainda não criou a Connection

    private val mutableRoutes = MutableStateFlow(AudioRoutes())

    /** As rotas de áudio da ligação de agora. */
    val routes: StateFlow<AudioRoutes> = mutableRoutes

    /** Registra (ou atualiza) a conta self-managed "Starsonic Phone" no Telecom. */
    fun register() {
        val account = PhoneAccount.builder(handle, ACCOUNT_LABEL)
            .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
            .setSupportedUriSchemes(listOf(PhoneAccount.SCHEME_SIP))
            .build()
        try {
            telecom.registerPhoneAccount(account)
        } catch (e: RuntimeException) {
            Log.w(TAG, "a conta do Telecom não foi registrada", e)
        }
    }

    override fun incomingPermitted(): Boolean =
        try {
            // Uma ligação da operadora tocando ou em andamento põe o áudio do celular nesses modos.
            val carrierCall = audio.mode == AudioManager.MODE_IN_CALL || audio.mode == AudioManager.MODE_RINGTONE
            telecom.isIncomingCallPermitted(handle) && !carrierCall
        } catch (e: RuntimeException) {
            Log.w(TAG, "o Telecom não respondeu se a ligação pode entrar", e)
            true
        }

    override fun addIncoming(callId: Int, number: String, name: String) {
        val call = Bundle().apply {
            putInt(EXTRA_CALL_ID, callId)
            putString(EXTRA_NUMBER, number)
            putString(EXTRA_NAME, name)
        }
        val extras = Bundle().apply {
            putBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS, call)
            putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS, Uri.fromParts(PhoneAccount.SCHEME_SIP, number, null))
        }
        try {
            telecom.addNewIncomingCall(handle, extras)
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

    override fun disconnect(callId: Int, cause: Int) {
        if (callId == CallManager.NO_ID) synchronized(lock) { outgoingPending = false }
        main.post {
            val ended = synchronized(lock) {
                connectionFor(callId)?.also { connection = null }
            } ?: return@post
            ended.setDisconnected(DisconnectCause(cause))
            ended.destroy()
            mutableRoutes.value = AudioRoutes()
        }
    }

    /** Leva o áudio da ligação para [route] (CallAudioState.ROUTE_*). Na thread principal. */
    @Suppress("DEPRECATION")   // setAudioRoute ainda vale no Android 14+ (a API nova pede o CallEndpoint)
    fun setRoute(route: Int) {
        synchronized(lock) { connection }?.setAudioRoute(route)
    }

    // Na thread principal: o Telecom criou a Connection; ela passa a ser a ligação de agora.
    internal fun created(created: CallConnection): CallConnection {
        val old = synchronized(lock) { connection.also { connection = created } }
        if (old != null && old !== created) {
            old.setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
            old.destroy()
        }
        return created
    }

    // Na thread principal: o Telecom vai criar a feita; true se ela ainda é esperada (e deixa de ser).
    internal fun takeOutgoing(): Boolean = synchronized(lock) { outgoingPending.also { outgoingPending = false } }

    // Na thread principal: as rotas da Connection de agora mudaram.
    internal fun onRoutes(from: CallConnection, routes: AudioRoutes) {
        if (synchronized(lock) { connection === from }) mutableRoutes.value = routes
    }

    // Com a trava ou não: a Connection da ligação [callId]; a feita sem id ganha o dela aqui.
    private fun connectionFor(callId: Int): CallConnection? = synchronized(lock) {
        val current = connection ?: return null
        when {
            current.callId == callId -> current
            !current.incoming && current.callId == CallManager.NO_ID -> current.also { it.callId = callId }
            else -> null
        }
    }

    companion object {
        const val EXTRA_CALL_ID = "br.com.starsonic.phone.extra.LIGACAO"
        const val EXTRA_NUMBER = "br.com.starsonic.phone.extra.NUMERO"
        const val EXTRA_NAME = "br.com.starsonic.phone.extra.NOME"

        private const val ACCOUNT_ID = "starsonic"
        private const val ACCOUNT_LABEL = "Starsonic Phone"
        private const val TAG = "StarsonicTelecom"
    }
}
