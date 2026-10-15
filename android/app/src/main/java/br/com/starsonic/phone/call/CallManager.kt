package br.com.starsonic.phone.call

import br.com.starsonic.phone.core.Clock
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.Scheduled
import br.com.starsonic.phone.data.CallKind
import br.com.starsonic.phone.data.Recent
import br.com.starsonic.phone.data.RecentsStore
import br.com.starsonic.phone.engine.CallState
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
enum class CallPhase {
    /** Feita, chamando (até o outro lado atender). */
    DIALING,

    /** Recebida, tocando. */
    RINGING,

    /** Recebida, atendida aqui, esperando o motor confirmar. */
    CONNECTING,

    /** Em andamento (os dois lados atenderam). */
    ACTIVE,
}

/** O que a tela de chamada mostra. */
data class CallUi(
    val number: String,
    val name: String,
    val incoming: Boolean,
    val phase: CallPhase,
    val activeSinceMillis: Long = 0,
    val held: Boolean = false,
    val muted: Boolean = false,
) {
    /**
     * A ligação usa o microfone: a feita desde o começo (a pessoa ligou com o app na frente) e a recebida depois
     * de atendida. O serviço acrescenta os tipos phoneCall e microphone enquanto isso vale.
     */
    val usesMicrophone: Boolean
        get() = !incoming || phase == CallPhase.CONNECTING || phase == CallPhase.ACTIVE
}

/** Os motivos do fim de uma ligação para o Telecom (os valores de android.telecom.DisconnectCause). */
object EndCause {
    const val ERROR = 1
    const val LOCAL = 2
    const val REMOTE = 3
    const val MISSED = 5
    const val REJECTED = 6
    const val BUSY = 7
}

/**
 * As ligações do app (spec 7.3 a 7.5), uma por vez (spec 4.2), entre o motor ([gateway]), o Telecom do Android
 * ([telecom]), os Recentes e as notificações.
 *
 * - Recebida ([onIncoming]): sem outra ligação e com o Telecom deixando, vai ao Telecom, que mostra a
 *   notificação de ligação; com outra (do ramal ou da operadora), ocupado (486) e perdida no Recentes, com a
 *   notificação "Ligação perdida de <número>". Atender, Recusar (486, perdida sem notificação) e a desistência de
 *   quem ligou (perdida, com a notificação).
 * - Feita ([dial]): o número sem separadores (núcleo); sem registro ([registered]), o aviso "Sem conexão…" e
 *   nada é discado. Senão o Telecom cria a Connection ([TelecomAdapter.placeOutgoing]) e, quando ele avisa
 *   ([onOutgoingReady]), o motor liga. O id da ligação no motor vem do makeCall, mas os eventos dela podem
 *   chegar antes: o primeiro evento de uma ligação nova (id maior que todos os já vistos) é da feita. Se ela não
 *   completa, o aviso do núcleo (CallEndMessage) fica em [endMessage] por 2 s.
 * - Depois de [onLogout] (Sair), os eventos do motor são ignorados até o próximo Entrar ([onLogin]).
 *
 * Threads: os eventos chegam na thread dos eventos do motor; os toques da tela e do Telecom, na principal. Nada
 * aqui espera o motor, a não ser o makeCall, que roda em [background] (como as gravações dos Recentes, que leem
 * e gravam o disco). A trava guarda o estado e nunca fica presa numa chamada ao motor, ao Telecom, às
 * notificações ou ao disco, nem na entrega de [state] e [endMessage]: tudo sai depois, na ordem em que foi
 * decidido. Os coletores que rodam na hora (Dispatchers.Main.immediate na thread principal) rodam sem a trava,
 * e um deles pode chamar o CallManager de volta.
 */
class CallManager(
    private val gateway: SipGateway,
    private val telecom: TelecomAdapter,
    private val recents: RecentsStore,
    private val notifier: CallNotifier,
    private val core: CoreRules,
    private val clock: Clock,
    private val registered: () -> Boolean,
    private val background: Executor = Executors.newSingleThreadExecutor { task ->
        Thread(task, "starsonic-ligacao").apply { isDaemon = true }
    },
) : CallEvents {
    // A ligação de agora. Só com a trava.
    private class Call(val incoming: Boolean, val number: String, val name: String, val startMillis: Long) {
        var id = NO_ID                 // o id no motor (a feita só o ganha com o makeCall ou o primeiro evento)
        var phase = if (incoming) CallPhase.RINGING else CallPhase.DIALING
        var dialRequested = false      // feita: o makeCall já foi pedido
        var hangupWhenDialed = false   // feita desligada antes de ter o id: desliga quando ele chegar
        var answered = false           // recebida: atendida aqui
        var rejected = false           // recebida: recusada aqui
        var notifyMissed = false       // recusada sem a pessoa ver (o Telecom não deixou): avisa a perdida
        var localHangup = false        // desligada aqui
        var ending = false             // pedida a saída: a tela já não a mostra
        var abandoned = false          // a conta saiu (Sair) com ela de pé
        var activeSince = 0L           // quando os dois lados atenderam (0: ainda não)
        var held = false
        var muted = false
    }

    private val lock = Any()
    private var call: Call? = null
    private var maxSeenId = 0          // o maior id de ligação do motor já visto
    private var endTimer: Scheduled? = null
    private var endToken = 0
    private val publications = ArrayDeque<() -> Unit>()   // as entregas em [state] e [endMessage], na ordem
    private var delivering = false                         // uma thread está entregando as publicações

    @Volatile
    private var loggedOut = false

    private val mutableState = MutableStateFlow<CallUi?>(null)
    private val mutableEndMessage = MutableStateFlow("")

    /** A ligação para a tela de chamada (null: nenhuma, ou a que está saindo). */
    val state: StateFlow<CallUi?> = mutableState

    /**
     * O aviso de uma feita que não completou (CallEndMessage: Ocupado, Número não encontrado...) ou de discar sem
     * registro, por 2 s; "" fora disso.
     */
    val endMessage: StateFlow<String> = mutableEndMessage

    override fun onIncoming(callId: Int, number: String, name: String) {
        val permitted = !loggedOut && telecom.incomingPermitted()   // fora da trava: pergunta ao Android
        act { effects ->
            // Antes de olhar o loggedOut: o fim de uma ligação ignorada depois de Sair nunca é tomado por uma feita.
            maxSeenId = maxOf(maxSeenId, callId)
            if (loggedOut) return@act
            if (call != null || !permitted) {
                // Uma ligação por vez, do ramal ou da operadora: ocupado, e a ligação entra como perdida.
                effects += { gateway.reject(callId) }
                missed(Recent(number, name, CallKind.PERDIDA, clock.nowMillis(), 0), effects)
                return@act
            }
            call = Call(incoming = true, number, name, clock.nowMillis()).also { it.id = callId }
            publish()
            effects += { telecom.addIncoming(callId, number, name) }
        }
    }

    override fun onRejectedBusy(number: String, name: String) {
        act { effects ->
            if (!loggedOut) missed(Recent(number, name, CallKind.PERDIDA, clock.nowMillis(), 0), effects)
        }
    }

    override fun onCallState(callId: Int, state: Int, code: Int) {
        act { effects ->
            val current = call
            // A feita sem id (o makeCall ainda não voltou): o primeiro evento de uma ligação nova é dela.
            val adoptable = current != null && !current.incoming && current.id == NO_ID && current.dialRequested &&
                callId > maxSeenId
            if (loggedOut || current == null || (current.id != callId && !adoptable)) {
                maxSeenId = maxOf(maxSeenId, callId)   // de outra ligação (ou depois de Sair): fica lembrado
                return@act
            }
            if (current.id != callId) adopt(current, callId, effects)
            when (state) {
                CallState.CONFIRMED -> if (current.activeSince == 0L) {
                    current.activeSince = clock.nowMillis()
                    current.phase = CallPhase.ACTIVE
                    effects += { telecom.setActive(callId) }
                }
                CallState.DISCONNECTED -> end(current, code, effects)
            }
            publish()
        }
    }

    /**
     * Liga para [raw] (o número como foi digitado). false se não ligou: número vazio, outra ligação, depois de
     * Sair, ou sem registro (aí [endMessage] mostra "Sem conexão…").
     */
    fun dial(raw: String): Boolean {
        if (raw.isBlank()) return false
        if (!registered()) {
            act { showEndMessage(NO_CONNECTION) }
            return false
        }
        val number = core.normalizeDialString(raw)
        if (number.isEmpty()) return false
        act { effects ->
            if (loggedOut || call != null) return false
            clearEndMessage()
            call = Call(incoming = false, number, "", clock.nowMillis())
            publish()
            effects += { telecom.placeOutgoing(number) }
        }
        return true
    }

    /** O Telecom criou a Connection da feita: o motor liga (o makeCall roda em [background]). */
    fun onOutgoingReady() {
        val dialed = synchronized(lock) {
            val current = call ?: return
            if (current.incoming || current.dialRequested || current.ending) return
            current.dialRequested = true
            current
        }
        background.execute { onDialed(dialed, gateway.makeCall(dialed.number)) }
    }

    /**
     * O Telecom não criou a Connection: a recebida [callId] recebe ocupado (e a perdida é avisada); a feita
     * ([NO_ID]) acaba sem discar.
     */
    fun onTelecomFailed(callId: Int) {
        act { effects ->
            val current = call ?: return@act
            if (current.ending) return@act
            if (current.incoming) {
                if (current.id != callId || current.phase != CallPhase.RINGING) return@act
                current.notifyMissed = true
                reject(current, effects)
            } else if (callId == NO_ID && !current.dialRequested) {
                end(current, 0, effects, cause = EndCause.ERROR)
            }
            publish()
        }
    }

    /** A recebida [callId] ainda toca (o Telecom pergunta antes de criar a Connection dela). */
    fun isRinging(callId: Int): Boolean = synchronized(lock) {
        val current = call ?: return false
        current.incoming && current.id == callId && current.phase == CallPhase.RINGING && !current.ending
    }

    /**
     * A recebida que toca agora (o id, o número e o nome), ou null. Vem do estado do CallManager, e não de [state]:
     * o Telecom pode pedir a Connection antes de o estado ser publicado.
     */
    fun ringing(): IncomingRequest? = synchronized(lock) {
        val current = call ?: return null
        if (current.incoming && current.phase == CallPhase.RINGING && !current.ending) {
            IncomingRequest(current.id, current.number, current.name)
        } else {
            null
        }
    }

    /** Há uma feita esperando o Telecom (ele pergunta antes de criar a Connection dela). */
    fun isDialing(): Boolean = synchronized(lock) {
        val current = call ?: return false
        !current.incoming && !current.dialRequested && !current.ending
    }

    /** Atende a recebida que toca. */
    fun answer() {
        act { effects ->
            val current = call ?: return@act
            if (!current.incoming || current.phase != CallPhase.RINGING || current.ending) return@act
            current.answered = true
            current.phase = CallPhase.CONNECTING
            publish()
            val id = current.id
            effects += { notifier.stopRinging(id) }
            effects += { gateway.answer(id) }
        }
    }

    /** Recusa a recebida que toca: ocupado (486), e ela entra no Recentes como perdida. */
    fun reject() {
        act { effects ->
            val current = call ?: return@act
            if (!current.incoming || current.phase != CallPhase.RINGING || current.ending) return@act
            reject(current, effects)
            publish()
        }
    }

    /** Desliga (ou cancela a feita que chama; a recebida que toca é recusada). */
    fun hangup() {
        act { effects ->
            val current = call ?: return@act
            if (current.ending) return@act
            if (current.incoming && current.phase == CallPhase.RINGING) {
                reject(current, effects)
                publish()
                return@act
            }
            current.localHangup = true
            current.ending = true
            val id = current.id
            when {
                id != NO_ID -> effects += { gateway.hangup(id) }
                current.dialRequested -> current.hangupWhenDialed = true
                else -> end(current, 0, effects)   // o Telecom ainda não criou a Connection: nada foi discado
            }
            publish()
        }
    }

    /** Põe em espera ou retoma a ligação em andamento (null: troca). */
    fun hold(on: Boolean? = null) {
        act { effects ->
            val current = call ?: return@act
            if (current.phase != CallPhase.ACTIVE || current.ending) return@act
            val target = on ?: !current.held
            if (target == current.held) return@act
            current.held = target
            publish()
            val id = current.id
            effects += { gateway.setHold(id, target) }
        }
    }

    /** Liga ou desliga o mudo da ligação (null: troca); ele sai no fim dela. */
    fun mute(on: Boolean? = null) {
        act { effects ->
            val current = call ?: return@act
            if (current.ending || current.phase == CallPhase.RINGING) return@act
            val target = on ?: !current.muted
            if (target == current.muted) return@act
            current.muted = target
            publish()
            effects += { gateway.setMute(target) }
        }
    }

    /** Manda os dígitos (DTMF) na ligação em andamento. */
    fun dtmf(digits: String) {
        act { effects ->
            val current = call ?: return@act
            if (current.phase != CallPhase.ACTIVE || current.ending) return@act
            val id = current.id
            effects += { gateway.sendDtmf(id, digits) }
        }
    }

    /**
     * Transfere a ligação em andamento para [raw] (sem consulta; spec 4.2): a ligação acaba quando o PABX aceitar.
     * false se não há o que transferir.
     */
    fun transfer(raw: String): Boolean {
        val number = core.normalizeDialString(raw)
        if (number.isEmpty()) return false
        act { effects ->
            val current = call ?: return false
            if (current.phase != CallPhase.ACTIVE || current.ending) return false
            val id = current.id
            effects += { gateway.transfer(id, number) }
        }
        return true
    }

    /** Sair: a ligação de agora acaba, e daqui em diante os eventos do motor são ignorados (até [onLogin]). */
    fun onLogout() {
        act { effects ->
            loggedOut = true
            clearEndMessage()
            val current = call
            if (current != null) {
                current.abandoned = true
                val id = current.id
                if (id != NO_ID) effects += { gateway.hangup(id) }
                end(current, 0, effects, cause = EndCause.LOCAL, quiet = true)
            }
            publish()
        }
    }

    /** O próximo Entrar depois de [onLogout]: os eventos do motor voltam a valer. */
    fun onLogin() {
        synchronized(lock) { loggedOut = false }
    }

    // Em [background]: o makeCall da feita [dialed] voltou com [id] (-1: não ligou). O id do makeCall vale mais
    // que o de um evento tomado antes dele (de outra ligação, que então sai).
    private fun onDialed(dialed: Call, id: Int) {
        act { effects ->
            if (call !== dialed) {
                // Ela já acabou: a conta saiu, ou um fim chegou antes de o makeCall voltar. Se o fim era de outra
                // ligação (o id tomado não é o do makeCall), a do motor ficou sem dono: sai também.
                if (id > 0 && (dialed.abandoned || dialed.id != id)) effects += { gateway.hangup(id) }
                return@act
            }
            when {
                id <= 0 -> end(dialed, 0, effects, cause = if (dialed.localHangup) EndCause.LOCAL else EndCause.ERROR)
                dialed.id == NO_ID -> adopt(dialed, id, effects)
                dialed.id != id -> {
                    val other = dialed.id
                    dialed.id = NO_ID
                    dialed.phase = CallPhase.DIALING   // o que veio da outra não vale
                    dialed.activeSince = 0L
                    // Desligada enquanto tinha o id da outra: o pedido vale para esta (o adopt a desliga).
                    if (dialed.localHangup) dialed.hangupWhenDialed = true
                    adopt(dialed, id, effects)
                    effects += { gateway.hangup(other) }
                }
            }
            publish()
        }
    }

    // Com a trava: a feita [current] ganha o id [id] do motor.
    private fun adopt(current: Call, id: Int, effects: MutableList<() -> Unit>) {
        current.id = id
        maxSeenId = maxOf(maxSeenId, id)
        if (current.hangupWhenDialed) {
            current.hangupWhenDialed = false
            effects += { gateway.hangup(id) }
        }
    }

    // Com a trava: a recebida [current] recebe ocupado (486); o fim dela chega pelo motor.
    private fun reject(current: Call, effects: MutableList<() -> Unit>) {
        current.rejected = true
        current.ending = true
        val id = current.id
        effects += { notifier.stopRinging(id) }
        effects += { gateway.reject(id) }
    }

    // Com a trava: a ligação [current] acabou com o código [code]: Recentes, notificação, aviso e Telecom.
    private fun end(current: Call, code: Int, effects: MutableList<() -> Unit>, cause: Int? = null, quiet: Boolean = false) {
        call = null
        val id = current.id
        val received = current.activeSince > 0
        val duration = if (received) ((clock.nowMillis() - current.activeSince) / 1000).toInt() else 0
        val kind: CallKind
        val endCause: Int
        if (current.incoming) {
            kind = if (received) CallKind.RECEBIDA else CallKind.PERDIDA
            endCause = cause ?: when {
                received -> if (current.localHangup) EndCause.LOCAL else EndCause.REMOTE
                current.rejected -> EndCause.REJECTED
                current.answered -> EndCause.REMOTE
                else -> EndCause.MISSED
            }
            // A perdida que a pessoa não viu (desistência, ou o Telecom não deixou) ganha a notificação.
            val unseen = !current.answered && (!current.rejected || current.notifyMissed)
            if (!received && unseen && !quiet) effects += { notifier.showMissed(missedText(current.number, current.name)) }
            effects += { notifier.stopRinging(id) }
        } else {
            kind = CallKind.FEITA
            // O aviso é só da feita que não completou: o código de uma desligada aqui é a resposta daqui, e uma
            // atendida que caiu (ex.: 408 depois de uma troca de rede) completou.
            val message = if (current.localHangup || quiet || received) "" else core.callEndMessage(code)
            endCause = cause ?: when {
                message.isNotEmpty() && (code == 486 || code == 600) -> EndCause.BUSY
                message.isNotEmpty() -> EndCause.ERROR
                current.localHangup -> EndCause.LOCAL
                code in 400..699 -> EndCause.ERROR   // atendida que caiu
                else -> EndCause.REMOTE
            }
            if (message.isNotEmpty()) showEndMessage(message)
        }
        if (current.muted) effects += { gateway.setMute(false) }
        record(Recent(current.number, current.name, kind, current.startMillis, duration), effects)
        effects += { telecom.disconnect(id, endCause) }
    }

    // Com a trava: uma perdida que a pessoa não viu (ocupado): Recentes e notificação.
    private fun missed(recent: Recent, effects: MutableList<() -> Unit>) {
        record(recent, effects)
        effects += { notifier.showMissed(missedText(recent.number, recent.name)) }
    }

    // Os Recentes leem e gravam o disco: em [background], na ordem.
    private fun record(recent: Recent, effects: MutableList<() -> Unit>) {
        effects += { background.execute { recents.add(recent) } }
    }

    // Com a trava: o estado de agora vai à fila das publicações (entregue depois de soltar a trava, em [deliver]).
    private fun publish() {
        val ui = call?.takeIf { !it.ending }?.let {
            CallUi(it.number, it.name, it.incoming, it.phase, it.activeSince, it.held, it.muted)
        }
        publications.addLast { mutableState.value = ui }
    }

    // Com a trava: o aviso vai à fila das publicações.
    private fun publishEndMessage(text: String) {
        publications.addLast { mutableEndMessage.value = text }
    }

    // Sem a trava: entrega as publicações na ordem em que foram decididas, uma thread por vez. Quem chega com outra
    // thread entregando deixa as suas na fila, e ela as entrega também; um coletor que chama o CallManager de volta
    // (na mesma thread) põe as dele na fila, e elas saem depois da que está saindo.
    private fun deliver() {
        while (true) {
            val next = synchronized(lock) {
                if (delivering || publications.isEmpty()) return
                delivering = true
                publications.removeFirst()
            }
            try {
                next()
            } finally {
                synchronized(lock) { delivering = false }
            }
        }
    }

    // Com a trava: [text] por 2 s.
    private fun showEndMessage(text: String) {
        endTimer?.cancel()
        val token = ++endToken
        publishEndMessage(text)
        endTimer = clock.schedule(END_MESSAGE_MILLIS) {
            act {
                if (endToken == token) {
                    publishEndMessage("")
                    endTimer = null
                }
            }
        }
    }

    // Com a trava.
    private fun clearEndMessage() {
        endTimer?.cancel()
        endTimer = null
        endToken++
        publishEndMessage("")
    }

    // Decide com a trava e faz o resto (motor, Telecom, notificações, disco) depois de soltá-la, na ordem; por
    // último, entrega o estado e o aviso.
    private inline fun act(block: (MutableList<() -> Unit>) -> Unit) {
        val effects = ArrayList<() -> Unit>()
        try {
            synchronized(lock) { block(effects) }
        } finally {
            try {
                effects.forEach { it() }
            } finally {
                deliver()
            }
        }
    }

    private fun missedText(number: String, name: String) = "Ligação perdida de ${number.ifEmpty { name }}"

    companion object {
        /** O id de uma feita antes de o motor dar o dela. */
        const val NO_ID = 0

        /** O aviso de discar sem registro (spec 7.4 e 11.1). */
        const val NO_CONNECTION = "Sem conexão com o servidor. Tente de novo em instantes."

        private const val END_MESSAGE_MILLIS = 2_000L
    }
}
