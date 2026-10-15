package br.com.starsonic.phone.call

import android.net.Uri
import android.telecom.CallAudioState
import android.telecom.Connection
import android.telecom.PhoneAccount
import android.telecom.TelecomManager
import br.com.starsonic.phone.App

/**
 * As rotas de áudio da ligação (o Telecom decide): a de agora e as que o celular tem (o Bluetooth aparece quando
 * há um fone ligado).
 */
data class AudioRoutes(
    val current: Int = CallAudioState.ROUTE_EARPIECE,
    val supported: Int = CallAudioState.ROUTE_EARPIECE or CallAudioState.ROUTE_SPEAKER,
) {
    val speaker: Boolean
        get() = current == CallAudioState.ROUTE_SPEAKER

    val bluetooth: Boolean
        get() = current == CallAudioState.ROUTE_BLUETOOTH

    /** Há um fone Bluetooth: a tela oferece Celular, Viva-voz e Bluetooth. */
    val bluetoothAvailable: Boolean
        get() = supported and CallAudioState.ROUTE_BLUETOOTH != 0

    /** O som sai no alto-falante de ouvido (o celular encostado no rosto: a tela pode apagar). */
    val atEar: Boolean
        get() = current == CallAudioState.ROUTE_EARPIECE

    /** O "Celular" da escolha de rota: o fone com fio, se houver, senão o de ouvido. */
    val handsetRoute: Int
        get() = if (supported and CallAudioState.ROUTE_WIRED_HEADSET != 0) {
            CallAudioState.ROUTE_WIRED_HEADSET
        } else {
            CallAudioState.ROUTE_EARPIECE
        }
}

/**
 * A ligação no Telecom do Android, modo self-managed (spec 6.2): os pedidos dele (atender, recusar, desligar,
 * mostrar a notificação de ligação) vão ao [CallManager]; as rotas de áudio vão ao [AndroidTelecom]. Uma por
 * vez. A feita nasce sem o id do motor ([CallManager.NO_ID]) e o ganha quando o CallManager a ativa ou encerra.
 * Os avisos do Telecom chegam na thread principal.
 */
class CallConnection(
    private val app: App,
    val incoming: Boolean,
    callId: Int,
    private val number: String,
    private val name: String,
) : Connection() {
    @Volatile
    var callId: Int = callId

    init {
        // Sem espera nem mudo pelo Telecom: os dois são do motor (a tela de chamada). Uma ligação da operadora
        // atendida no meio desta a encerra (onDisconnect): uma ligação por vez (spec 4.2).
        connectionProperties = PROPERTY_SELF_MANAGED
        audioModeIsVoip = true
        setAddress(Uri.fromParts(PhoneAccount.SCHEME_SIP, number, null), TelecomManager.PRESENTATION_ALLOWED)
        if (name.isNotEmpty()) setCallerDisplayName(name, TelecomManager.PRESENTATION_ALLOWED)
        if (incoming) setRinging() else setDialing()
    }

    override fun onShowIncomingCallUi() {
        app.notifier.showIncoming(callId, number, name)
    }

    override fun onAnswer() {
        app.calls.answer()
    }

    override fun onReject() {
        app.calls.reject()
    }

    override fun onDisconnect() {
        app.calls.hangup()
    }

    override fun onAbort() {
        app.calls.hangup()
    }

    @Deprecated("Telecom ainda manda as rotas por aqui (a API nova, CallEndpoint, é só do Android 14+)")
    override fun onCallAudioStateChanged(state: CallAudioState) {
        app.telecom.onRoutes(this, AudioRoutes(state.route, state.supportedRouteMask))
    }
}
