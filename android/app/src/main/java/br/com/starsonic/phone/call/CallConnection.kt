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
 * Uma ligação no Telecom do Android, modo self-managed (spec 6.2): os pedidos dele (atender, recusar, desligar, pôr
 * em espera e retomar, mostrar a notificação de ligação) vão ao [CallManager], para esta ligação; as rotas de áudio
 * vão ao [AndroidTelecom]. Até duas, como no CallManager. A feita nasce sem o id do motor ([CallManager.NO_ID]) e o
 * ganha quando o CallManager a ativa, a põe em espera ou a encerra. Na conferência, ela é filha da [CallConference]
 * (a quem vão os pedidos dela); um pedido que ainda chegue aqui vale só para esta ligação, como sempre (desligar: só
 * ela sai, e a outra fica como uma ligação normal), e o CallManager trata a espera de uma das duas como a da
 * conferência. Os avisos do Telecom chegam na thread principal.
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
        // A espera pelo Telecom: ele sabe qual das duas está em espera (o CallManager o avisa), e os pedidos de espera
        // e de retomada dele (onHold e onUnhold) vão ao CallManager, que decide com o motor. O mudo é só do motor (a
        // tela de chamada). Na conferência, o Telecom pode separar esta (o onSeparate da CallConference) ou desligar
        // só ela (o onDisconnect daqui).
        connectionProperties = PROPERTY_SELF_MANAGED
        connectionCapabilities = CAPABILITY_HOLD or CAPABILITY_SUPPORT_HOLD or
            CAPABILITY_SEPARATE_FROM_CONFERENCE or CAPABILITY_DISCONNECT_FROM_CONFERENCE
        audioModeIsVoip = true
        setAddress(Uri.fromParts(PhoneAccount.SCHEME_SIP, number, null), TelecomManager.PRESENTATION_ALLOWED)
        if (name.isNotEmpty()) setCallerDisplayName(name, TelecomManager.PRESENTATION_ALLOWED)
        if (incoming) setRinging() else setDialing()
    }

    // Com outra ligação em andamento (a de cima na tela de chamada), esta é a chamada em espera: a notificação sem o
    // toque nem a tela cheia, e o bipe no som da ligação.
    override fun onShowIncomingCallUi() {
        val waiting = app.calls.state.value?.phase == CallPhase.ACTIVE
        CallLog.i { "Telecom: mostrar a recebida $callId (chamada em espera: $waiting)" }
        app.notifier.showIncoming(callId, number, name, address?.schemeSpecificPart.orEmpty(), waiting)
    }

    // Android 10+: o volume apertado durante o toque. A notificação fica, sem o toque.
    override fun onSilence() {
        CallLog.i { "Telecom: silenciar $callId" }
        app.notifier.silence(callId)
    }

    override fun onAnswer() {
        CallLog.i { "Telecom: atender $callId" }
        app.calls.answer()
    }

    override fun onReject() {
        CallLog.i { "Telecom: recusar $callId" }
        app.calls.reject()
    }

    // A pessoa ou o Android (uma ligação da operadora atendida, por exemplo) pede a espera desta.
    override fun onHold() {
        CallLog.i { "Telecom: espera $callId" }
        app.calls.holdFromTelecom(callId)
    }

    override fun onUnhold() {
        CallLog.i { "Telecom: retomar $callId" }
        app.calls.activateFromTelecom(callId)
    }

    // Desliga esta ligação (a ativa ou a em espera); a outra segue.
    override fun onDisconnect() {
        CallLog.i { "Telecom: desligar $callId" }
        app.calls.hangup(callId)
    }

    override fun onAbort() {
        app.calls.hangup(callId)
    }

    @Deprecated("Telecom ainda manda as rotas por aqui (a API nova, CallEndpoint, é só do Android 14+)")
    override fun onCallAudioStateChanged(state: CallAudioState) {
        app.telecom.onRoutes(this, AudioRoutes(state.route, state.supportedRouteMask))
    }
}
