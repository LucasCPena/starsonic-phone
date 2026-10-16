package br.com.starsonic.phone.call

import android.telecom.CallAudioState
import android.telecom.Conference
import android.telecom.Connection
import android.telecom.PhoneAccountHandle
import br.com.starsonic.phone.App

/**
 * A conferência das duas ligações no Telecom do Android (spec da 0.2, 6.2 e 7.4): uma Conference self-managed com as
 * duas Connections ([CallConnection]) como filhas, para o áudio, o Bluetooth e o sistema verem uma ligação só. O som é
 * do motor (a mesa de áudio do PJSIP, que liga as duas); aqui fica só o que o Telecom sabe. Ela nasce do Juntar do app
 * ([AndroidTelecom.joinConference]) e sai no Separar, no fim de uma das duas e no Sair ([AndroidTelecom.splitConference]).
 *
 * Os pedidos do Telecom vão ao [CallManager]: desligar a conferência desliga as duas; a espera (uma ligação da
 * operadora atendida, por exemplo) a desfaz e põe as duas em espera (o motor nunca põe em espera uma ligação da
 * conferência); separar uma é o Separar; a retomada é a de sempre, de uma ligação. Juntar pelo sistema (onMerge) não
 * há. Como na Connection, as rotas de áudio que o Telecom manda (a ele, a ligação da frente é a conferência) vão ao
 * [AndroidTelecom]. Os avisos do Telecom chegam na thread principal.
 */
class CallConference(private val app: App, handle: PhoneAccountHandle) : Conference(handle) {
    init {
        // Self-managed, como as Connections; com a espera, o Telecom põe a conferência em espera (em vez de a
        // desligar) quando uma ligação da operadora é atendida.
        connectionProperties = Connection.PROPERTY_SELF_MANAGED
        connectionCapabilities = Connection.CAPABILITY_HOLD or Connection.CAPABILITY_SUPPORT_HOLD
    }

    // A de uma das duas: os pedidos de espera e de retomada do CallManager são por ligação, e na conferência valem
    // para as duas.
    private val memberId: Int
        get() = (connections.firstOrNull() as? CallConnection)?.callId ?: CallManager.NO_ID

    override fun onDisconnect() {
        CallLog.i { "Telecom: desligar a conferência" }
        app.calls.hangup()
    }

    override fun onSeparate(connection: Connection) {
        CallLog.i { "Telecom: separar ${(connection as? CallConnection)?.callId} da conferência" }
        app.calls.split()
    }

    override fun onHold() {
        CallLog.i { "Telecom: espera da conferência" }
        app.calls.holdFromTelecom(memberId)
    }

    override fun onUnhold() {
        CallLog.i { "Telecom: retomar a conferência" }
        app.calls.activateFromTelecom(memberId)
    }

    @Deprecated("Telecom ainda manda as rotas por aqui (a API nova, CallEndpoint, é só do Android 14+)")
    override fun onCallAudioStateChanged(state: CallAudioState) {
        app.telecom.onRoutes(this, AudioRoutes(state.route, state.supportedRouteMask))
    }
}
