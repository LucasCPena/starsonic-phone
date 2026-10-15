package br.com.starsonic.phone.call

import br.com.starsonic.phone.core.Clock
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.data.RecentsStore
import br.com.starsonic.phone.engine.SipGateway
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Os avisos de ligação do motor (os de [br.com.starsonic.phone.engine.EngineEvents]), que a Connection repassa. */
interface CallEvents {
    fun onIncoming(callId: Int, number: String, name: String)

    fun onRejectedBusy(number: String, name: String)

    fun onCallState(callId: Int, state: Int, code: Int)
}

/** As notificações que o [CallManager] pede (a da ligação recebida nasce no Telecom: IncomingCallNotifier). */
interface CallNotifier {
    /** "Ligação perdida de <número>" (canal "perdidas"). */
    fun showMissed(text: String)

    /** A ligação [callId] parou de tocar (atendida, recusada, desistência): a notificação dela sai e o toque para. */
    fun stopRinging(callId: Int)
}

/** Em que pé a ligação está, para a tela de chamada. */
enum class CallPhase { DIALING, RINGING, CONNECTING, ACTIVE }

/** O que a tela de chamada mostra. */
data class CallUi(
    val number: String,
    val name: String,
    val incoming: Boolean,
    val phase: CallPhase,
    val activeSinceMillis: Long = 0,
    val held: Boolean = false,
    val muted: Boolean = false,
)

/** Os motivos do fim de uma ligação para o Telecom (os valores de android.telecom.DisconnectCause). */
object EndCause {
    const val ERROR = 1
    const val LOCAL = 2
    const val REMOTE = 3
    const val MISSED = 5
    const val REJECTED = 6
    const val BUSY = 7
}

/** As ligações (stub da Task 8: a implementação vem no GREEN). */
class CallManager(
    private val gateway: SipGateway,
    private val telecom: TelecomAdapter,
    private val recents: RecentsStore,
    private val notifier: CallNotifier,
    private val core: CoreRules,
    private val clock: Clock,
    private val registered: () -> Boolean,
    private val background: Executor = Executors.newSingleThreadExecutor { Thread(it, "starsonic-ligacao").apply { isDaemon = true } },
) : CallEvents {
    private val mutableState = MutableStateFlow<CallUi?>(null)
    private val mutableEndMessage = MutableStateFlow("")

    val state: StateFlow<CallUi?> = mutableState

    val endMessage: StateFlow<String> = mutableEndMessage

    override fun onIncoming(callId: Int, number: String, name: String) {}

    override fun onRejectedBusy(number: String, name: String) {}

    override fun onCallState(callId: Int, state: Int, code: Int) {}

    fun dial(raw: String): Boolean = false

    fun onOutgoingReady() {}

    fun onTelecomFailed(callId: Int) {}

    fun isRinging(callId: Int): Boolean = false

    fun isDialing(): Boolean = false

    fun answer() {}

    fun reject() {}

    fun hangup() {}

    fun hold(on: Boolean? = null) {}

    fun mute(on: Boolean? = null) {}

    fun dtmf(digits: String) {}

    fun transfer(raw: String): Boolean = false

    fun onLogout() {}

    fun onLogin() {}

    companion object {
        /** O id de uma feita antes de o motor dar o dela. */
        const val NO_ID = 0
    }
}
