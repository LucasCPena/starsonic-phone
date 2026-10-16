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

    /** O resultado de uma transferência (a direta ou a com consulta) pedida na ligação [callId]: o código SIP. */
    fun onTransfer(callId: Int, code: Int)
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

/**
 * O que a tela de chamada mostra: a ligação ativa (a de cima) e, com duas, a outra em [second].
 *
 * - [id]: o id da ligação no motor ([CallManager.NO_ID]: a feita antes de o motor dar o dela).
 * - [name]: o nome de exibição que a central mandou (pode ser vazio).
 * - [muted]: o mudo do microfone, que vale para as duas ligações.
 * - [second]: a outra ligação (tocando ou em espera); null com uma só. A feita que chama é sempre a ativa.
 * - [conference]: as duas em conferência (spec da 0.2, 7.4); ainda sempre false.
 * - [consult]: a transferência com consulta em andamento (spec da 0.2, 7.3), com as duas ligações dela de pé (o
 *   cliente e o colega são esta e a [second]); null sem consulta.
 */
data class CallUi(
    val id: Int,
    val number: String,
    val name: String,
    val incoming: Boolean,
    val phase: CallPhase,
    val activeSinceMillis: Long = 0,
    val held: Boolean = false,
    val muted: Boolean = false,
    val second: SecondUi? = null,
    val conference: Boolean = false,
    val consult: ConsultUi? = null,
) {
    /**
     * A ligação usa o microfone: a feita desde o começo (a pessoa ligou com o app na frente) e a recebida depois
     * de atendida. O serviço acrescenta os tipos phoneCall e microphone enquanto isso vale.
     */
    val usesMicrophone: Boolean
        get() = !incoming || phase == CallPhase.CONNECTING || phase == CallPhase.ACTIVE
}

/** A outra de duas ligações, para o cartão de baixo (ou a faixa da que toca): o id no motor, o número e o nome. */
data class SecondUi(val id: Int, val number: String, val name: String, val kind: SecondKind)

/** Em que pé está a outra de duas ligações. */
enum class SecondKind {
    /** Recebida, tocando (a faixa "Ligação de <nome ou número>"). */
    RINGING,

    /** Em espera. */
    HELD,

    /** Com o som junto da ativa: só na conferência. */
    ACTIVE,
}

/**
 * A consulta (spec da 0.2, 7.3): o id do colega ([CallManager.NO_ID] até o motor dar o dele) e se ele é a ativa (o
 * cliente, então, em espera: "Em espera · transferência").
 */
data class ConsultUi(val colleagueId: Int, val colleagueActive: Boolean)

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
 * As ligações do app (spec 7.3 a 7.5), até duas, uma delas a ativa (spec da 0.2, 4.2, 7.1 e 7.2), entre o motor
 * ([gateway]), o Telecom do Android ([telecom]), os Recentes e as notificações.
 *
 * - Recebida ([onIncoming]): sem ligação, ou com uma só e já em andamento (em espera ou não: a recebida é a outra,
 *   [CallUi.second] tocando), e com o Telecom deixando, vai ao Telecom, que mostra a notificação de ligação. Com
 *   uma que ainda não está em andamento (tocando, atendendo, chamando), com duas, ou sem o Telecom deixar (uma
 *   ligação da operadora), ocupado (486) e perdida no Recentes, com a notificação "Ligação perdida de <número>".
 *   Atender (a outra vai para a espera, que o motor põe no answer), Recusar (486, perdida sem notificação) e a
 *   desistência de quem ligou (perdida, com a notificação).
 * - Feita ([dial]): o número sem separadores (núcleo); sem registro ([registered]), o aviso "Sem conexão…" e
 *   nada é discado. Com uma ligação em andamento, a feita é a Nova ligação: a outra vai para a espera (o motor a põe
 *   no makeCall) e a feita é a ativa. O Telecom cria a Connection ([TelecomAdapter.placeOutgoing]) e, quando ele
 *   avisa ([onOutgoingReady]), o motor liga. O id da ligação no motor vem do makeCall, mas os eventos dela podem
 *   chegar antes: o primeiro evento de uma ligação nova (id maior que todos os já vistos) é da feita (só há uma
 *   feita esperando o id). Se ela não completa, o aviso do núcleo (CallEndMessage) fica em [endMessage] por 2 s; se
 *   o Android não deixa ligar (o Telecom recusa: uma ligação do celular em andamento), o aviso [CARRIER_CALL].
 * - Duas ligações: a ativa é a do som (no motor) e a de cima na tela; a outra toca ou está em espera. Alternar
 *   ([activate]) troca as duas. Quando a ativa acaba (desligada aqui ou do outro lado), a em espera volta sozinha: o
 *   motor a retoma e o Telecom a ativa. A em espera que cai do outro lado sai com o aviso "<nome ou número> desligou"
 *   por 2 s, e a ativa continua.
 * - Transferência com consulta (spec da 0.2, 7.3): o Consultar ([consult]) é a Nova ligação marcada: a que estava em
 *   andamento é o cliente, e a feita, o colega. Concluir ([completeTransfer], só com o colega atendido, de qualquer
 *   dos dois lados) pede ao motor o REFER com Replaces do cliente para o colega, uma vez até o resultado
 *   ([onTransfer]): com 2xx o motor desliga as duas, que saem como desligadas aqui (sem aviso, nem a volta sozinha
 *   do cliente) e entram no Recentes como feita e recebida; com outro código, o aviso [TRANSFER_REFUSED] por 2 s, e
 *   as duas continuam. Cancelar ([cancelConsult]) desliga o colega, e o cliente volta sozinho. O colega que não
 *   atende (não completou) traz o cliente de volta, com o aviso "<nome ou número do colega>: <CallEndMessage>"; o
 *   cliente que desliga deixa o colega como uma ligação normal ("<nome ou número> desligou"). A transferência
 *   direta ([transfer]) recusada mostra o mesmo [TRANSFER_REFUSED]. Uma ligação tem no máximo um pedido de
 *   transferência esperando o resultado: com ele, nem Consultar nem outro Transferir agora nela; na consulta, o
 *   Transferir agora não vale (a transferência é o Concluir), e só o resultado do Concluir é da consulta.
 * - O Telecom acompanha cada espera e retomada ([TelecomAdapter.setOnHold], [TelecomAdapter.setActive]); os pedidos
 *   dele chegam por [holdFromTelecom], [activateFromTelecom] e [hangup] com o id da ligação. A espera que ele pede
 *   (uma ligação da operadora atendida) nunca troca: com duas, as duas ficam em espera, sem som, até ele pedir a
 *   retomada de uma.
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
    // Uma das ligações de agora. Só com a trava.
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
        var held = false               // em espera: pela pessoa, ou a outra de duas
        var heldByTelecom = false      // o Telecom a pôs em espera (uma ligação da operadora): nada a retoma sozinho
        var transferPending: Transfer? = null   // a transferência pedida nela, até o resultado (onTransfer)
    }

    // Que transferência uma ligação pediu: a direta (Transferir agora) ou a com consulta (o Concluir, no cliente).
    private enum class Transfer { DIRECT, ATTENDED }

    // A consulta de agora: o cliente (o que vai ser transferido) e o colega (a feita pelo Consultar), os dois em
    // [calls]. Só com a trava.
    private class Consult(val client: Call, val colleague: Call)

    private val lock = Any()
    private val calls = ArrayList<Call>(2)   // as ligações de agora (até duas), na ordem em que começaram
    private var active: Call? = null          // a ativa, uma de [calls]: a do som e a de cima na tela (null: nenhuma)
    private var consulting: Consult? = null   // a consulta em andamento (null: nenhuma); sai com o fim de uma das duas
    private var muted = false                 // o mudo do microfone (o do motor vale para as duas); sai com a última
    private var maxSeenId = 0                 // o maior id de ligação do motor já visto
    private var endTimer: Scheduled? = null
    private var endToken = 0
    private val publications = ArrayDeque<() -> Unit>()   // as entregas em [state] e [endMessage], na ordem
    private var delivering = false                         // uma thread está entregando as publicações

    @Volatile
    private var loggedOut = false

    private val mutableState = MutableStateFlow<CallUi?>(null)
    private val mutableEndMessage = MutableStateFlow("")

    /** A ligação para a tela de chamada, com a outra de duas (null: nenhuma, ou só a que está saindo). */
    val state: StateFlow<CallUi?> = mutableState

    /**
     * O aviso de uma feita que não completou (CallEndMessage: Ocupado, Número não encontrado...; o do colega da
     * consulta com o nome ou o número dele na frente), de discar sem registro, da ligação em espera que caiu ("<nome
     * ou número> desligou") ou da transferência recusada ([TRANSFER_REFUSED]), por 2 s; "" fora disso.
     */
    val endMessage: StateFlow<String> = mutableEndMessage

    override fun onIncoming(callId: Int, number: String, name: String) {
        val permitted = !loggedOut && telecom.incomingPermitted()   // fora da trava: pergunta ao Android
        act { effects ->
            // Antes de olhar o loggedOut: o fim de uma ligação ignorada depois de Sair nunca é tomado por uma feita.
            maxSeenId = maxOf(maxSeenId, callId)
            if (loggedOut) return@act
            // Até duas, e a segunda só com a outra em andamento (como no motor); a da operadora não deixa nenhuma.
            val other = calls.singleOrNull()
            val fits = calls.isEmpty() || (other != null && other.phase == CallPhase.ACTIVE && !other.ending)
            if (!fits || !permitted) {
                // Ocupado, e a ligação entra como perdida.
                effects += { gateway.reject(callId) }
                missed(Recent(number, name, CallKind.PERDIDA, clock.nowMillis(), 0), effects)
                return@act
            }
            val incoming = Call(incoming = true, number, name, clock.nowMillis()).also { it.id = callId }
            calls += incoming
            if (active == null) active = incoming
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
            val current = if (loggedOut) null else ownerOf(callId)
            if (current == null) {
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
     * Liga para [raw] (o número como foi digitado): sem ligação, ou com uma em andamento (a Nova ligação: ela vai
     * para a espera e a feita é a ativa). false se não ligou: número vazio, uma ligação que ainda não está em
     * andamento, duas, depois de Sair, ou sem registro (aí [endMessage] mostra "Sem conexão…").
     */
    fun dial(raw: String): Boolean = place(raw, consult = false)

    /**
     * O Consultar (spec da 0.2, 7.3): liga para o colega [raw] como a Nova ligação do [dial], com a ligação em
     * andamento (o cliente, que vai para a espera), e as duas ficam marcadas como a consulta ([CallUi.consult]).
     * false se não ligou: sem uma ligação em andamento, com uma transferência dela esperando o resultado (o 2xx da
     * direta desligaria o cliente e deixaria o colega), e nos casos do [dial].
     */
    fun consult(raw: String): Boolean = place(raw, consult = true)

    // A feita do [dial] e do [consult] (com [consult], só com uma ligação em andamento, que vira o cliente).
    private fun place(raw: String, consult: Boolean): Boolean {
        if (raw.isBlank()) return false
        if (!registered()) {
            act { showEndMessage(NO_CONNECTION) }
            return false
        }
        val number = core.normalizeDialString(raw)
        if (number.isEmpty()) return false
        act { effects ->
            if (loggedOut) return false
            val other = calls.singleOrNull()
            if (calls.isNotEmpty() && (other == null || other.phase != CallPhase.ACTIVE || other.ending)) return false
            if (consult && (other == null || other.transferPending != null)) return false
            clearEndMessage()
            val dialed = Call(incoming = false, number, "", clock.nowMillis())
            calls += dialed
            active = dialed
            if (other != null) heldByEngine(other, effects)   // o motor a põe em espera no makeCall
            if (consult && other != null) consulting = Consult(client = other, colleague = dialed)
            publish()
            effects += { telecom.placeOutgoing(number) }
        }
        return true
    }

    /** O Telecom criou a Connection da feita: o motor liga (o makeCall roda em [background]). */
    fun onOutgoingReady() {
        val dialed = synchronized(lock) {
            val waiting = waitingForTelecom() ?: return
            waiting.dialRequested = true
            waiting
        }
        background.execute { onDialed(dialed, gateway.makeCall(dialed.number)) }
    }

    /**
     * O Telecom não criou a Connection: a recebida [callId] recebe ocupado (e a perdida é avisada); a feita
     * ([NO_ID]) acaba sem discar, com o aviso [CARRIER_CALL] por 2 s (o Android não deixa ligar, como com uma
     * ligação do celular em andamento).
     */
    fun onTelecomFailed(callId: Int) {
        act { effects ->
            if (callId == NO_ID) {
                val dialed = waitingForTelecom() ?: return@act
                end(dialed, 0, effects, cause = EndCause.ERROR)
                showEndMessage(CARRIER_CALL)
            } else {
                val ringing = ringingCall()?.takeIf { it.id == callId } ?: return@act
                ringing.notifyMissed = true
                reject(ringing, effects)
            }
            publish()
        }
    }

    /** A recebida [callId] ainda toca (o Telecom pergunta antes de criar a Connection dela). */
    fun isRinging(callId: Int): Boolean = synchronized(lock) { ringingCall()?.id == callId }

    /**
     * A recebida que toca agora (o id, o número e o nome), ou null; só uma toca por vez. Vem do estado do
     * CallManager, e não de [state]: o Telecom pode pedir a Connection antes de o estado ser publicado.
     */
    fun ringing(): IncomingRequest? = synchronized(lock) {
        ringingCall()?.let { IncomingRequest(it.id, it.number, it.name) }
    }

    /** Há uma feita esperando o Telecom (ele pergunta antes de criar a Connection dela). */
    fun isDialing(): Boolean = synchronized(lock) { waitingForTelecom() != null }

    /** Atende a recebida que toca; a outra ligação, se há, vai para a espera (o motor a põe no answer). */
    fun answer() {
        act { effects ->
            val ringing = ringingCall() ?: return@act
            ringing.answered = true
            ringing.phase = CallPhase.CONNECTING
            val other = otherThan(ringing)
            active = ringing
            val id = ringing.id
            effects += { notifier.stopRinging(id) }
            effects += { gateway.answer(id) }
            if (other != null) heldByEngine(other, effects)
            publish()
        }
    }

    /** Recusa a recebida que toca: ocupado (486), e ela entra no Recentes como perdida. */
    fun reject() {
        act { effects ->
            val ringing = ringingCall() ?: return@act
            reject(ringing, effects)
            publish()
        }
    }

    /**
     * Desliga a ativa: a feita que chama é cancelada, e a recebida que toca (só ela), recusada. Com a ativa já saindo
     * (um segundo toque antes do fim dela), nada: a outra só sai pelo [hangup] com o id dela.
     */
    fun hangup() {
        act { effects ->
            val current = active?.takeIf { !it.ending } ?: return@act
            hangup(current, effects)
            publish()
        }
    }

    /**
     * Desliga a ligação [callId], a ativa ou a outra (o pedido do Telecom para a Connection dela); a outra acaba sem
     * mexer na ativa. [NO_ID] é a feita mais nova (a Connection dela ainda não sabe o id do motor).
     */
    fun hangup(callId: Int) {
        act { effects ->
            val current = if (callId == NO_ID) {
                calls.lastOrNull { !it.incoming }
            } else {
                calls.firstOrNull { it.id == callId }
            }
            if (current == null || current.ending) return@act
            hangup(current, effects)
            publish()
        }
    }

    /** Alternar: com as duas ligações em andamento, a outra vira a ativa e a ativa vai para a espera. */
    fun activate() {
        act { effects ->
            val current = active ?: return@act
            val other = otherThan(current) ?: return@act
            swap(current, other, effects)
        }
    }

    /**
     * Põe em espera ou retoma a ligação ativa (null: troca). Com as duas em andamento, a espera da ativa é o Alternar
     * ([activate]): a outra volta.
     */
    fun hold(on: Boolean? = null) {
        act { effects -> holdActive(on, effects) }
    }

    /**
     * O Telecom pede a espera da ligação [callId] (o onHold da Connection dela: uma ligação da operadora atendida, por
     * exemplo). A ativa vai para a espera sem trocar, também com duas: as duas ficam em espera e nenhuma tem o som (o
     * Alternar daria o som à outra, e o Telecom tiraria o da ligação da operadora). A tela continua com ela em cima,
     * em espera. A que já está em espera fica como está. Até a retomada (pelo Telecom ou pela pessoa), ela não volta
     * sozinha quando outra acaba.
     */
    fun holdFromTelecom(callId: Int) {
        act { effects ->
            val current = talking()?.takeIf { it.id == callId } ?: return@act
            if (!current.held) setHeld(current, true, effects)
            current.heldByTelecom = true
        }
    }

    /**
     * O Telecom pede a retomada da ligação [callId] (o onUnhold da Connection dela: a ligação da operadora acabou, por
     * exemplo). Com as duas em espera, só ela volta (o motor a ativa) e vira a ativa; a outra continua em espera. Com a
     * outra com o som, é o Alternar. A ligação só é retomada, como no [hold].
     */
    fun activateFromTelecom(callId: Int) {
        act { effects ->
            val target = calls.firstOrNull { it.id == callId && it.phase == CallPhase.ACTIVE && !it.ending }
            if (target == null || !target.held) return@act
            val other = otherThan(target)?.takeIf { it.phase == CallPhase.ACTIVE }
            when {
                other == null -> if (target === active) setHeld(target, false, effects)
                other === active && !other.held -> swap(other, target, effects)
                else -> resume(target, effects)
            }
        }
    }

    /** Liga ou desliga o mudo do microfone (null: troca); ele vale para as duas ligações e sai no fim da última. */
    fun mute(on: Boolean? = null) {
        act { effects ->
            val current = shown() ?: return@act
            if (current.phase == CallPhase.RINGING) return@act
            val target = on ?: !muted
            if (target == muted) return@act
            muted = target
            publish()
            effects += { gateway.setMute(target) }
        }
    }

    /** Manda os dígitos (DTMF) na ligação ativa, em andamento. */
    fun dtmf(digits: String) {
        act { effects ->
            val current = talking() ?: return@act
            val id = current.id
            effects += { gateway.sendDtmf(id, digits) }
        }
    }

    /**
     * Transfere a ligação ativa, em andamento, para [raw] (sem consulta; spec 4.2): a ligação acaba quando o PABX
     * aceitar (o motor a desliga); se ele recusar ([onTransfer]), o aviso [TRANSFER_REFUSED]. false se não há o que
     * transferir: sem a ativa em andamento, com outra transferência dela esperando o resultado, ou na consulta (lá, a
     * transferência é o [completeTransfer]).
     */
    fun transfer(raw: String): Boolean {
        val number = core.normalizeDialString(raw)
        if (number.isEmpty()) return false
        act { effects ->
            val current = talking() ?: return false
            if (consulting != null || current.transferPending != null) return false
            current.transferPending = Transfer.DIRECT
            val id = current.id
            effects += { gateway.transfer(id, number) }
        }
        return true
    }

    /**
     * Concluir transferência: com o colega atendido (as duas em andamento, com qualquer uma ativa), o motor manda o
     * REFER com Replaces do cliente para o colega. Um pedido por vez: outro toque antes do resultado ([onTransfer])
     * não faz nada.
     */
    fun completeTransfer() {
        act { effects ->
            val pair = consulting ?: return@act
            val client = pair.client
            val colleague = pair.colleague
            val confirmed = client.phase == CallPhase.ACTIVE && colleague.phase == CallPhase.ACTIVE
            if (client.transferPending != null || !confirmed || client.ending || colleague.ending) return@act
            client.transferPending = Transfer.ATTENDED
            val clientId = client.id
            val colleagueId = colleague.id
            effects += { gateway.transferAttended(clientId, colleagueId) }
        }
    }

    /** Cancelar a consulta: o colega sai (como no [hangup]), e o cliente volta sozinho quando o fim dele chega. */
    fun cancelConsult() {
        act { effects ->
            val colleague = consulting?.colleague?.takeIf { !it.ending } ?: return@act
            hangup(colleague, effects)
            publish()
        }
    }

    /**
     * O resultado da transferência pedida na ligação [callId] (a direta, ou a com consulta, no cliente); sem um
     * pedido dela esperando, nada. 2xx: o motor desliga a ligação (e o colega, só no Concluir) logo depois, e os fins
     * chegam por ele; no Concluir, as duas saem já, como desligadas aqui. Outro código: o aviso [TRANSFER_REFUSED] por
     * 2 s, e as ligações continuam como estavam (o pedido vale de novo).
     */
    override fun onTransfer(callId: Int, code: Int) {
        act {
            val current = if (loggedOut) null else calls.firstOrNull { it.id == callId && !it.ending }
            val pending = current?.transferPending ?: return@act
            current.transferPending = null
            val pair = consulting?.takeIf { pending == Transfer.ATTENDED && it.client === current }
            when {
                code !in 200..299 -> showEndMessage(TRANSFER_REFUSED)
                pair != null -> {
                    transferred(pair.client)
                    transferred(pair.colleague)
                    publish()
                }
            }
        }
    }

    /** Sair: as ligações de agora acabam, e daqui em diante os eventos do motor são ignorados (até [onLogin]). */
    fun onLogout() {
        act { effects ->
            loggedOut = true
            clearEndMessage()
            for (current in calls.toList()) {
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
            if (calls.none { it === dialed }) {
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

    // Com a trava: a ligação do evento de [callId]: a que tem o id, ou a feita sem id (o makeCall ainda não voltou),
    // se o id é de uma ligação nova; null: de outra ligação.
    private fun ownerOf(callId: Int): Call? =
        calls.firstOrNull { it.id == callId }
            ?: calls.firstOrNull { !it.incoming && it.id == NO_ID && it.dialRequested }?.takeIf { callId > maxSeenId }

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

    // Com a trava: desliga [current]. A recebida que toca é recusada; a feita sem id é desligada quando o id chegar,
    // e a que o Telecom ainda não criou acaba aqui.
    private fun hangup(current: Call, effects: MutableList<() -> Unit>) {
        if (current.incoming && current.phase == CallPhase.RINGING) {
            reject(current, effects)
            return
        }
        current.localHangup = true
        current.ending = true
        val id = current.id
        when {
            id != NO_ID -> effects += { gateway.hangup(id) }
            current.dialRequested -> current.hangupWhenDialed = true
            else -> end(current, 0, effects)   // o Telecom ainda não criou a Connection: nada foi discado
        }
    }

    // Com a trava: a espera ([on] true) ou a retomada da ativa em andamento (null: troca). Com as duas em andamento,
    // a espera da ativa é o Alternar.
    private fun holdActive(on: Boolean?, effects: MutableList<() -> Unit>) {
        val current = talking() ?: return
        val target = on ?: !current.held
        if (target == current.held) return
        val other = otherThan(current)
        if (target && other != null && other.phase == CallPhase.ACTIVE) {
            swap(current, other, effects)
            return
        }
        setHeld(current, target, effects)
    }

    // Com a trava: põe [current] em espera ([target] true) ou a retoma, sem mexer na outra; o Telecom acompanha.
    private fun setHeld(current: Call, target: Boolean, effects: MutableList<() -> Unit>) {
        current.held = target
        if (!target) current.heldByTelecom = false
        publish()
        val id = current.id
        effects += { gateway.setHold(id, target) }
        effects += { if (target) telecom.setOnHold(id) else telecom.setActive(id) }
    }

    // Com a trava: com as duas em espera, [to] volta e vira a ativa (o motor a ativa); a outra fica em espera.
    private fun resume(to: Call, effects: MutableList<() -> Unit>) {
        to.held = false
        to.heldByTelecom = false
        active = to
        publish()
        val id = to.id
        effects += { gateway.activate(id) }
        effects += { telecom.setActive(id) }
    }

    // Com a trava: o Alternar, de [from] (a ativa) para [to] (a outra), só com as duas em andamento. O motor troca
    // (a ativa vai para a espera e a outra é retomada), e o Telecom acompanha.
    private fun swap(from: Call, to: Call, effects: MutableList<() -> Unit>) {
        if (from.ending || from.phase != CallPhase.ACTIVE || to.phase != CallPhase.ACTIVE) return
        from.held = true
        to.held = false
        to.heldByTelecom = false
        active = to
        publish()
        val fromId = from.id
        val toId = to.id
        effects += { gateway.activate(toId) }
        effects += { telecom.setOnHold(fromId) }
        effects += { telecom.setActive(toId) }
    }

    // Com a trava: [other] vai para a espera pelo motor (no answer ou no makeCall de outra); o Telecom acompanha.
    private fun heldByEngine(other: Call, effects: MutableList<() -> Unit>) {
        other.held = true
        val id = other.id
        effects += { telecom.setOnHold(id) }
    }

    // Com a trava: a ligação [current] acabou com o código [code]: Recentes, notificação, aviso e Telecom. Se era a
    // ativa, a outra (se há) passa a ser; em andamento (em espera), ela volta sozinha: o motor a retoma e o Telecom a
    // ativa. Mas não se a ativa também estava em espera (as duas, pelo Telecom), nem se o Telecom pôs a outra em
    // espera: o som é de outra ligação (a da operadora), e a outra espera o pedido de retomada dele. A outra que cai
    // do outro lado, já em andamento e com a ativa continuando, deixa o aviso "<nome ou número> desligou". Com ela,
    // a consulta acaba ([leaveConsult]).
    private fun end(current: Call, code: Int, effects: MutableList<() -> Unit>, cause: Int? = null, quiet: Boolean = false) {
        val wasActive = current === active
        val colleague = leaveConsult(current)
        calls.remove(current)
        if (wasActive) active = calls.firstOrNull()
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
            // O colega da consulta que não atendeu: "<nome ou número>: <motivo>" (o cliente já volta, abaixo).
            if (message.isNotEmpty()) {
                showEndMessage(if (colleague) "${current.name.ifEmpty { current.number }}: $message" else message)
            }
        }
        if (!wasActive && received && !current.localHangup && !quiet && calls.any { !it.ending }) {
            showEndMessage("${current.name.ifEmpty { current.number }} desligou")
        }
        if (muted && calls.isEmpty()) {
            muted = false
            effects += { gateway.setMute(false) }
        }
        record(Recent(current.number, current.name, kind, current.startMillis, duration), effects)
        effects += { telecom.disconnect(id, endCause) }
        val next = active
        val resumes = wasActive && !current.held && !loggedOut
        if (resumes && next != null && next.phase == CallPhase.ACTIVE && !next.ending && !next.heldByTelecom) {
            next.held = false
            val nextId = next.id
            effects += { gateway.activate(nextId) }
            effects += { telecom.setActive(nextId) }
        }
    }

    // Com a trava: [current] acabou; se era da consulta, ela acaba aí (o cliente volta pela volta sozinha do [end], e o
    // colega que fica é uma ligação normal). true se [current] era o colega: o aviso de fim dele leva o nome ou o
    // número na frente.
    private fun leaveConsult(current: Call): Boolean {
        val pair = consulting ?: return false
        if (current !== pair.client && current !== pair.colleague) return false
        consulting = null
        return current === pair.colleague
    }

    // Com a trava: a central aceitou a transferência de [current], que o motor desliga: ela sai como desligada aqui
    // (a tela já não a mostra), sem o aviso "desligou" e sem a volta sozinha da outra.
    private fun transferred(current: Call) {
        current.localHangup = true
        current.ending = true
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

    // Com a trava: a ligação da tela: a ativa, ou a outra enquanto a ativa sai (null: nenhuma).
    private fun shown(): Call? = active?.takeIf { !it.ending } ?: calls.firstOrNull { !it.ending }

    // Com a trava: a ativa, se está em andamento (os dois lados atenderam) e não está saindo.
    private fun talking(): Call? = active?.takeIf { it.phase == CallPhase.ACTIVE && !it.ending }

    // Com a trava: a outra ligação que não [call] (null: não há, ou ela está saindo).
    private fun otherThan(call: Call): Call? = calls.firstOrNull { it !== call && !it.ending }

    // Com a trava: a recebida que toca (só uma toca por vez).
    private fun ringingCall(): Call? = calls.firstOrNull { it.incoming && it.phase == CallPhase.RINGING && !it.ending }

    // Com a trava: a feita que espera o Telecom criar a Connection dela (só há uma).
    private fun waitingForTelecom(): Call? = calls.firstOrNull { !it.incoming && !it.dialRequested && !it.ending }

    // Com a trava: o estado de agora vai à fila das publicações (entregue depois de soltar a trava, em [deliver]): a
    // ligação da tela e, com duas, a outra e a consulta.
    private fun publish() {
        val ui = shown()?.let { main ->
            val other = otherThan(main)?.let { SecondUi(it.id, it.number, it.name, secondKind(it)) }
            CallUi(
                main.id, main.number, main.name, main.incoming, main.phase, main.activeSince, main.held, muted,
                second = other, consult = consultUi(),
            )
        }
        publications.addLast { mutableState.value = ui }
    }

    // Com a trava: a consulta para a tela, só com as duas de pé (com uma saindo, a tela já mostra a outra sozinha).
    private fun consultUi(): ConsultUi? =
        consulting?.takeIf { !it.client.ending && !it.colleague.ending }
            ?.let { ConsultUi(it.colleague.id, colleagueActive = it.colleague === active) }

    // A outra de duas, para a tela: tocando ou em espera (a feita que chama é sempre a ativa).
    private fun secondKind(call: Call) = if (call.phase == CallPhase.RINGING) SecondKind.RINGING else SecondKind.HELD

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

        /** O aviso de quando o Android não deixa ligar: uma ligação do celular (da operadora) em andamento (spec 11.1). */
        const val CARRIER_CALL = "Termine a ligação do celular para ligar pelo ramal."

        /** O aviso da transferência (direta ou com consulta) que o servidor recusou (spec da 0.2, 11.1). */
        const val TRANSFER_REFUSED = "O servidor não aceitou a transferência."

        private const val END_MESSAGE_MILLIS = 2_000L
    }
}
