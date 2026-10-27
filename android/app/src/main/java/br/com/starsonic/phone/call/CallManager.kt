package br.com.starsonic.phone.call

import br.com.starsonic.phone.contacts.ContactsSource
import br.com.starsonic.phone.core.Clock
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.Scheduled
import br.com.starsonic.phone.data.CallKind
import br.com.starsonic.phone.data.CallSettings
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
    /**
     * "Ligação perdida de <nome do contato do celular ou número>" (canal "perdidas"); [silent], a do Não perturbe: sem
     * som e sem vibrar, num canal próprio.
     */
    fun showMissed(text: String, silent: Boolean = false)

    /** A ligação [callId] parou de tocar (atendida, recusada, desistência): a notificação dela sai e o toque para. */
    fun stopRinging(callId: Int)

    /**
     * O Atender automático da recebida [callId], que toca sozinha, mudou (R38): ele vai atendê-la em [seconds] s (o tempo
     * escolhido; 0: na hora), ou não vai mais (null: desligado, o Não perturbe ligado, o microfone recusado, ou ela não
     * está mais sozinha). A notificação dela, se está lá, ganha ou perde a linha dele, uma vez, sem alertar de novo.
     */
    fun autoAnswerChanged(callId: Int, seconds: Int?)
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
 * - [name]: o nome mostrado: o do contato do celular com o número, se o número está na agenda (procurado quando a
 *   ligação começou), senão o nome de exibição que a central mandou (pode ser vazio).
 * - [muted]: o mudo do microfone, que vale para as duas ligações.
 * - [second]: a outra ligação (tocando, em espera ou, na conferência, junto desta); null com uma só. A feita que
 *   chama é sempre a ativa.
 * - [conference]: as duas em conferência (spec da 0.2, 7.4), com as duas de pé: esta e a [second] (com
 *   [SecondKind.ACTIVE]) se ouvem e têm o som; [conferenceSinceMillis] é quando o Juntar foi pedido (0 fora dela).
 * - [consult]: a transferência com consulta em andamento (spec da 0.2, 7.3), com as duas ligações dela de pé (o
 *   cliente e o colega são esta e a [second]); null sem consulta.
 * - [autoAnswerSeconds]: a recebida que toca vai ser atendida pelo Atender automático (spec 5, R7): o tempo marcado
 *   quando o celular começou a tocar ([autoAnswerSinceMillis]), para a linha "Atender automático · em <n> s" da tela
 *   cheia. Só enquanto as regras dele valem para ela, com as configurações de agora (a única ligação, tocando, com ele
 *   ligado e o Não perturbe desligado); null (e 0) fora disso.
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
    val conferenceSinceMillis: Long = 0,
    val autoAnswerSeconds: Int? = null,
    val autoAnswerSinceMillis: Long = 0,
) {
    /**
     * A ligação usa o microfone: a feita desde o começo (a pessoa ligou com o app na frente) e a recebida depois
     * de atendida. O serviço acrescenta os tipos phoneCall e microphone enquanto isso vale.
     */
    val usesMicrophone: Boolean
        get() = !incoming || phase == CallPhase.CONNECTING || phase == CallPhase.ACTIVE
}

/**
 * A outra de duas ligações, para o cartão de baixo (ou a faixa da que toca): o id no motor, o número, o nome (o do
 * contato do celular, ou o da central, como em [CallUi.name]) e desde quando ela está em andamento (o tempo do cartão;
 * 0 enquanto ela toca).
 */
data class SecondUi(val id: Int, val number: String, val name: String, val kind: SecondKind, val activeSinceMillis: Long = 0)

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

/**
 * O microfone da recebida que o Atender automático vai atender (spec 12): com o app fechado (em segundo plano), o
 * Android pode não deixar o app usar o microfone. No app, o serviço entra em primeiro plano com o microfone antes do
 * atender (SipService); nos testes da JVM, a resposta vem do teste.
 */
fun interface CallMicrophone {
    /** Pede o microfone para a ligação que vai ser atendida sozinha; [ready] recebe se o Android deixou (qualquer thread). */
    fun request(ready: (Boolean) -> Unit)
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
 * - Conferência (spec da 0.2, 7.4): Juntar ([join]), com as duas em andamento, sem consulta, sem transferência
 *   esperando o resultado e sem o Telecom segurando nenhuma (uma ligação da operadora), liga as duas entre si no motor
 *   (a em espera é retomada). No Telecom vale o plano B da spec (risco 1): nenhuma Conference, porque a Conference de
 *   um serviço self-managed perde a propriedade self-managed e o Telefone do sistema a mostraria como uma ligação dele;
 *   a de cima fica ACTIVE e a outra HOLDING só para o Telecom ([TelecomAdapter.joinConference]). Separar ([split]) põe
 *   em espera a última que entrou, e a outra fica a ativa. Desligar ([hangup]) desliga as duas, e Sair e o desligar do
 *   Telecom pela Connection de qualquer uma ([hangup] com o id: o fone Bluetooth, o kit do carro) também. A que acaba
 *   do outro lado deixa a outra como uma ligação normal, com o aviso "<nome ou número> desligou": o motor já a deixa
 *   com o som, e o Telecom a ativa. Na conferência não há Espera, Alternar, Transferir nem Nova ligação; o mudo vale
 *   para as duas, e o teclado manda os dígitos na de cima.
 * - O Telecom acompanha cada espera e retomada ([TelecomAdapter.setOnHold], [TelecomAdapter.setActive]); os pedidos
 *   dele chegam por [holdFromTelecom], [activateFromTelecom] e [hangup] com o id da ligação. A espera que ele pede
 *   (uma ligação da operadora atendida) nunca troca: com duas, as duas ficam em espera, sem som, até ele pedir a
 *   retomada de uma ou a pessoa dar o som a uma (Retomar, Alternar). Na conferência, ela a desfaz antes (o motor nunca
 *   põe em espera uma ligação da conferência): como o Separar, e a que fica vai para a espera também.
 * - Os contatos do celular (spec da 0.2, 7.5): o nome de cada ligação é o do contato com o número dela
 *   ([ContactsSource.lookup]), procurado uma vez quando ela começa (a recebida antes de ir à tela e ao Telecom, que leva
 *   o nome para a notificação; a feita logo depois de começar), senão o que a central mandou. Ele vale na tela, na
 *   faixa da segunda, nos avisos ("<nome ou número> desligou") e na notificação de perdida; os Recentes guardam o nome
 *   da central (a tela deles procura o contato na hora de mostrar). [dialContact] liga para o número de um contato pela
 *   regra dos números dos contatos ([dialRule]).
 * - As configurações de ligação ([settings], lidas a cada uso: a chave mudada entre duas ligações vale na próxima):
 *   - Não perturbe (spec 4): a recebida leva ocupado (486), entra no Recentes como perdida e o aviso dela sai sem som
 *     ([CallNotifier.showMissed] silent; também o da que o motor recusou sozinho); nada vai ao Telecom. A que já toca
 *     continua tocando: ele vale para as próximas. As feitas funcionam normalmente.
 *   - Atender automático (spec 5): a recebida que toca sozinha (sem nenhuma outra ligação) é atendida, como no
 *     Atender, depois do tempo escolhido, contado de quando o celular toca: quando o Telecom cria a Connection dela
 *     ([onIncomingReady]; 0: logo depois, na próxima volta do [clock]). A que o Telecom não cria nunca é atendida
 *     sozinha. Ele se decide aí: a que toca com outra toca normalmente, também depois que a outra acaba. Quando o tempo
 *     acaba, as mesmas regras valem de novo: ainda a única ligação, tocando, com o Atender automático ligado e o Não
 *     perturbe desligado; o atender, o recusar, o fim dela e o Sair o cancelam antes. Valendo, o microfone é pedido
 *     antes ([microphone], spec 12): sem ele (o Android não deixou, com o app fechado), ela continua tocando, e a pessoa
 *     ainda atende à mão; com ele, as regras valem de novo antes do atender. Enquanto vai atender, a tela mostra o tempo
 *     marcado ([CallUi.autoAnswerSeconds], R7), com as configurações de agora: [onSettingsChanged] publica de novo
 *     quando elas mudam. A notificação pergunta quando aparece ([autoAnswerSeconds]), e cada mudança da decisão depois
 *     (desligado, o Não perturbe, o microfone recusado, outra ligação) vai ao [notifier] uma vez
 *     ([CallNotifier.autoAnswerChanged], R38), para a linha dela nunca prometer um atender que não vem.
 *   - O bipe no fim (spec 9): a atendida que acaba sem outra de pé (as que sobram também estão saindo), com a chave
 *     ligada, sem ser pelo Sair e sem o Telecom a segurar por uma ligação da operadora (o som é dela), toca o bipe
 *     ([beep]), e a Connection dela só sai do Telecom quando ele acaba: até lá o Telecom mantém o som da ligação, e o
 *     bipe sai nele. A espera tem um limite no [clock] ([END_BEEP_MAX_MILLIS]), que vale também se o bipe nunca avisar
 *     o fim. Um bipe por vez: a que acaba junto (a outra da conferência, as duas da transferência) espera o mesmo.
 *     Nada mais espera: a tela fecha, o Recentes grava e uma ligação nova começa na hora. O pedido do Telecom para
 *     desligar a Connection que espera (o fone Bluetooth) e o Sair não a cortam: ela sai uma vez só, no fim do bipe
 *     ou no limite (um fim repetido para o id dela pegaria a feita nova, que ainda não tem id no Telecom).
 * - Depois de [onLogout] (Sair), os eventos do motor são ignorados até o próximo Entrar ([onLogin]).
 *
 * Threads: os eventos chegam na thread dos eventos do motor; os toques da tela e do Telecom, na principal; a hora do
 * Atender automático, na do [clock], e a resposta do [microphone], na que ele escolher; o fim do bipe, na do [beep].
 * Nada aqui espera o motor, a não ser o makeCall, que roda em [background] (como as gravações dos Recentes, que leem e
 * gravam o disco, e a procura do contato da feita). A procura do contato da recebida (e da ocupada) lê a agenda na
 * thread dos eventos do motor, antes da trava; nenhuma roda na thread principal. As configurações ([settings]) vêm da
 * memória. A trava guarda o estado e nunca fica presa numa chamada ao motor, ao Telecom, às notificações, ao bipe, ao
 * microfone, à agenda ou ao disco, nem na entrega de [state] e [endMessage]: tudo sai depois, na ordem em que foi
 * decidido. Os coletores que rodam na hora
 * (Dispatchers.Main.immediate na thread principal) rodam sem a trava, e um deles pode chamar o CallManager de volta.
 */
class CallManager(
    private val gateway: SipGateway,
    private val telecom: TelecomAdapter,
    private val recents: RecentsStore,
    private val notifier: CallNotifier,
    private val core: CoreRules,
    private val clock: Clock,
    private val registered: () -> Boolean,
    private val contacts: ContactsSource,
    private val dialRule: (String) -> String,
    private val background: Executor = Executors.newSingleThreadExecutor { task ->
        Thread(task, "starsonic-ligacao").apply { isDaemon = true }
    },
    private val settings: () -> CallSettings = { CallSettings() },
    private val beep: EndBeep = NoBeep,
    private val microphone: CallMicrophone = CallMicrophone { ready -> ready(true) },
) : CallEvents {
    // Uma das ligações de agora: [name] é o nome que a central mandou (o dos Recentes), e [contact], o do contato do
    // celular com o número dela (procurado uma vez, quando ela começa). Só com a trava.
    private class Call(
        val incoming: Boolean,
        val number: String,
        val name: String,
        val startMillis: Long,
        var contact: String? = null,
    ) {
        // O nome mostrado (tela, faixa, avisos e notificação): o do contato, se há; senão, o da central.
        val displayName: String
            get() = contact ?: name

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
        // O Telecom a pôs em espera para proteger uma ligação da operadora (o som é dela): nada a retoma sozinho, e o
        // Juntar não vale. Sai de todas quando uma das nossas ganha o som ([clearTelecomHolds]).
        var heldByTelecom = false
        var transferPending: Transfer? = null   // a transferência pedida nela, até o resultado (onTransfer)
    }

    // Que transferência uma ligação pediu: a direta (Transferir agora) ou a com consulta (o Concluir, no cliente).
    private enum class Transfer { DIRECT, ATTENDED }

    // A consulta de agora: o cliente (o que vai ser transferido) e o colega (a feita pelo Consultar), os dois em
    // [calls]. Só com a trava.
    private class Consult(val client: Call, val colleague: Call)

    // O bipe do fim que toca agora: as Connections que esperam o fim dele para sair do Telecom, cada uma com o id e o
    // motivo do fim, na ordem em que as ligações acabaram, e o limite dessa espera no relógio. Só com a trava.
    private class EndBeepWait(id: Int, cause: Int) {
        val waiting = mutableListOf(id to cause)
        var backstop: Scheduled? = null
    }

    private val lock = Any()
    private val calls = ArrayList<Call>(2)   // as ligações de agora (até duas), na ordem em que começaram
    private var active: Call? = null          // a ativa, uma de [calls]: a do som e a de cima na tela (null: nenhuma)
    private var consulting: Consult? = null   // a consulta em andamento (null: nenhuma); sai com o fim de uma das duas
    private var conference = false            // as duas de [calls] em conferência; sai com o Separar ou o fim de uma
    private var conferenceSince = 0L          // quando o Juntar foi pedido (a tela conta o tempo desde ele)
    private var muted = false                 // o mudo do microfone (o do motor vale para as duas); sai com a última
    private var maxSeenId = 0                 // o maior id de ligação do motor já visto
    private var autoCall: Call? = null        // a recebida do Atender automático marcado (null: nenhum)
    private var autoTimer: Scheduled? = null  // ...o aviso dele no relógio
    private var autoSeconds = 0               // ...o tempo marcado
    private var autoSince = 0L                // ...e quando o celular começou a tocar
    private var announcedId = NO_ID           // a recebida do último aviso do Atender automático ao notificador (R38)
    private var announcedSeconds: Int? = null // ...e o que ele disse (null: não vai atender)
    private var beeping: EndBeepWait? = null  // o bipe do fim que toca agora (null: nenhum)
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
        val chosen = settings()
        val permitted = !loggedOut && telecom.incomingPermitted()   // fora da trava: pergunta ao Android
        val contact = if (loggedOut) null else contacts.lookup(number)   // fora da trava: lê a agenda
        act { effects ->
            // Antes de olhar o loggedOut: o fim de uma ligação ignorada depois de Sair nunca é tomado por uma feita.
            maxSeenId = maxOf(maxSeenId, callId)
            if (loggedOut) return@act
            // Até duas, e a segunda só com a outra em andamento (como no motor); a da operadora não deixa nenhuma.
            val other = calls.singleOrNull()
            val fits = calls.isEmpty() || (other != null && other.phase == CallPhase.ACTIVE && !other.ending)
            if (chosen.doNotDisturb || !fits || !permitted) {
                // Ocupado, e a ligação entra como perdida (no Não perturbe, o aviso sai sem som).
                effects += { gateway.reject(callId) }
                val recent = Recent(number, name, CallKind.PERDIDA, clock.nowMillis(), 0)
                missed(recent, contact, effects, silent = chosen.doNotDisturb)
                return@act
            }
            val incoming = Call(incoming = true, number, name, clock.nowMillis(), contact).also { it.id = callId }
            calls += incoming
            if (active == null) active = incoming
            publish()
            val shownName = incoming.displayName
            effects += { telecom.addIncoming(callId, number, shownName) }
        }
    }

    override fun onRejectedBusy(number: String, name: String) {
        val silent = settings().doNotDisturb
        val contact = if (loggedOut) null else contacts.lookup(number)   // fora da trava: lê a agenda
        act { effects ->
            if (loggedOut) return@act
            missed(Recent(number, name, CallKind.PERDIDA, clock.nowMillis(), 0), contact, effects, silent)
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
     * Liga para [number], um número de um contato do celular (a aba Contatos), como o [dial], depois da regra dos
     * números dos contatos ([dialRule]: o "+<ddi>" sai e o prefixo externo entra na frente de um número externo; spec da
     * 0.2, 4.2). false se não ligou: a regra não deu número, e nos casos do [dial].
     */
    fun dialContact(number: String): Boolean {
        val dialed = dialRule(number)
        return dialed.isNotEmpty() && dial(dialed)
    }

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
            effects += { background.execute { findContact(dialed) } }
        }
        return true
    }

    // Em [background] (nunca na thread principal, de onde vem o [dial]): o nome do contato do celular com o número da
    // feita [dialed], procurado uma vez; achado, a tela passa a mostrá-lo.
    private fun findContact(dialed: Call) {
        val found = contacts.lookup(dialed.number) ?: return
        act {
            dialed.contact = found
            if (calls.any { it === dialed }) publish()
        }
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
     * O Telecom criou a Connection da recebida [callId]: o celular toca agora, e o Atender automático conta daqui (spec
     * 5: "depois do tempo escolhido tocando"). Ele começa se ela é a única ligação, ainda tocando, com o Atender
     * automático ligado e o Não perturbe desligado; a recebida que o Telecom não cria (recusada, ou que já não toca)
     * nunca é atendida sozinha. Uma criação repetida não recomeça a contagem.
     */
    fun onIncomingReady(callId: Int) {
        val chosen = settings()
        act {
            val ringing = calls.firstOrNull { it.incoming && it.id == callId } ?: return@act
            if (ringing === autoCall || !autoAnswers(ringing, chosen)) return@act
            startAutoAnswer(ringing, chosen.autoAnswerSeconds)
            publish()
        }
    }

    /**
     * As configurações de ligação mudaram (o App avisa a cada mudança): com um Atender automático marcado, a tela da
     * recebida mostra de novo se ele ainda vai atendê-la ([CallUi.autoAnswerSeconds], R7). O atender mesmo decide com as
     * de quando o tempo acaba.
     */
    fun onSettingsChanged() {
        act { if (autoCall != null) publish() }
    }

    /**
     * Os segundos do Atender automático marcado para a recebida [callId], se ele ainda vai atendê-la com as configurações
     * de agora (a notificação da recebida mostra a linha dele uma vez, R33); null sem ele.
     */
    fun autoAnswerSeconds(callId: Int): Int? = synchronized(lock) {
        autoCall?.takeIf { it.id == callId && autoAnswers(it, settings()) }?.let { autoSeconds }
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
        ringingCall()?.let { IncomingRequest(it.id, it.number, it.displayName) }
    }

    /** Há uma feita esperando o Telecom (ele pergunta antes de criar a Connection dela). */
    fun isDialing(): Boolean = synchronized(lock) { waitingForTelecom() != null }

    /** Atende a recebida que toca; a outra ligação, se há, vai para a espera (o motor a põe no answer). */
    fun answer() {
        act { effects ->
            val ringing = ringingCall() ?: return@act
            answer(ringing, effects)
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
     * (um segundo toque antes do fim dela), nada: a outra só sai pelo [hangup] com o id dela. Na conferência, desliga
     * as duas (as que ainda não estão saindo), e nenhuma volta sozinha.
     */
    fun hangup() {
        act { effects ->
            if (conference) {
                hangupConference(effects)
                return@act
            }
            val current = active?.takeIf { !it.ending } ?: return@act
            hangup(current, effects)
            publish()
        }
    }

    /**
     * Desliga a ligação [callId], a ativa ou a outra (o pedido do Telecom para a Connection dela: o fone Bluetooth, o
     * kit do carro, o relógio); fora da conferência, a outra acaba sem mexer na ativa. [NO_ID] é a feita mais nova (a
     * Connection dela ainda não sabe o id do motor). Na conferência, pela Connection de qualquer uma das duas (a ACTIVE
     * ou a HOLDING do Telecom), desliga as duas, como o [hangup] da tela (o Desligar encerra para todos: a tela não
     * separa as duas), e nenhuma volta sozinha. Para a Connection de uma ligação que já acabou e espera o bipe do fim,
     * nada: ela sai do Telecom no fim do bipe (ou no limite da espera).
     */
    fun hangup(callId: Int) {
        act { effects ->
            val current = if (callId == NO_ID) {
                calls.lastOrNull { !it.incoming }
            } else {
                calls.firstOrNull { it.id == callId }
            }
            if (current == null || current.ending) return@act
            if (conference) {
                hangupConference(effects)
                return@act
            }
            hangup(current, effects)
            publish()
        }
    }

    /**
     * Alternar: com as duas ligações em andamento, a outra vira a ativa e a ativa vai para a espera. Na conferência,
     * nada (o Separar é o [split]).
     */
    fun activate() {
        act { effects ->
            if (conference) return@act
            val current = active ?: return@act
            val other = otherThan(current) ?: return@act
            swap(current, other, effects)
        }
    }

    /**
     * Põe em espera ou retoma a ligação ativa (null: troca). Com as duas em andamento, a espera da ativa é o Alternar
     * ([activate]): a outra volta. Na conferência, nada.
     */
    fun hold(on: Boolean? = null) {
        act { effects -> if (!conference) holdActive(on, effects) }
    }

    /**
     * O Telecom pede a espera da ligação [callId] (o onHold da Connection dela: uma ligação da operadora atendida, por
     * exemplo). A ativa vai para a espera sem trocar, também com duas: as duas ficam em espera e nenhuma tem o som (o
     * Alternar daria o som à outra, e o Telecom tiraria o da ligação da operadora). A tela continua com ela em cima,
     * em espera. A que já está em espera fica como está. Ela fica marcada como segurada pelo Telecom: não volta sozinha
     * quando outra acaba, e o Juntar não vale. A marca sai de todas quando uma das nossas ganha o som (a retomada pelo
     * Telecom ou pela pessoa, o Alternar): aí o som já não é da ligação da operadora.
     *
     * Na conferência, o pedido chega pela Connection de uma das duas (em geral a ACTIVE, para o Telecom): o motor nunca
     * põe em espera uma ligação da conferência (ela ficaria meio desfeita nele), então primeiro ela é desfeita como no
     * Separar ([split]: a última que entrou vai para a espera), e depois a que fica vai para a espera também, como
     * acima. As duas ficam em espera, e a marcada é a que o Telecom segurou ([callId]), qualquer que seja a de cima.
     * Com uma das duas saindo, nada (o fim dela desfaz a conferência).
     */
    fun holdFromTelecom(callId: Int) {
        act { effects ->
            if (conference) {
                val (first, last) = members() ?: return@act
                if (first.id != callId && last.id != callId) return@act
                separate(first, last, effects)
                setHeld(first, true, effects)
                (if (first.id == callId) first else last).heldByTelecom = true
                return@act
            }
            val current = talking()?.takeIf { it.id == callId } ?: return@act
            if (!current.held) setHeld(current, true, effects)
            current.heldByTelecom = true
        }
    }

    /**
     * O Telecom pede a retomada da ligação [callId] (o onUnhold da Connection dela: a ligação da operadora acabou, ou o
     * "trocar" de um fone Bluetooth, por exemplo). Com as duas em espera, só ela volta (o motor a ativa) e vira a
     * ativa; a outra continua em espera, sem a marca do Telecom (ela volta sozinha quando esta acaba). Com a outra com
     * o som, é o Alternar. A ligação só é retomada, como no [hold].
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
     * transferir: sem a ativa em andamento, com outra transferência dela esperando o resultado, na consulta (lá, a
     * transferência é o [completeTransfer]) ou na conferência.
     */
    fun transfer(raw: String): Boolean {
        val number = core.normalizeDialString(raw)
        if (number.isEmpty()) return false
        act { effects ->
            val current = talking() ?: return false
            if (consulting != null || conference || current.transferPending != null) return false
            current.transferPending = Transfer.DIRECT
            val id = current.id
            effects += { gateway.transfer(id, number) }
        }
        return true
    }

    /**
     * Concluir transferência: com o colega atendido (as duas em andamento, com qualquer uma ativa), o motor manda o
     * REFER com Replaces do cliente para o colega. Um pedido por vez: outro toque antes do resultado ([onTransfer])
     * não faz nada. Se o colega acaba antes do resultado, o pedido sai com ele (o motor recusa o REFER sem o colega, e
     * nenhum resultado chega), e o cliente pode ser transferido de novo.
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

    /**
     * Juntar (spec da 0.2, 7.4): com as duas ligações em andamento (a ativa e a outra, em espera), sem consulta, sem
     * uma transferência de uma delas esperando o resultado, sem o Telecom segurando nenhuma delas (uma ligação da
     * operadora em andamento: juntar as retomaria e tiraria o som dela) e fora de uma conferência, o motor retoma a em
     * espera e liga as duas entre si e ao som ([SipGateway.join]). Para o Telecom, a de cima continua ACTIVE e a outra
     * HOLDING ([TelecomAdapter.joinConference]: o plano B, sem Conference). As duas ficam fora da espera aqui, e a tela
     * mostra a conferência desde agora.
     */
    fun join() {
        act { effects ->
            if (conference || consulting != null) return@act
            val current = talking() ?: return@act
            val other = otherThan(current)?.takeIf { it.phase == CallPhase.ACTIVE } ?: return@act
            if (current.transferPending != null || other.transferPending != null) return@act
            if (current.heldByTelecom || other.heldByTelecom) return@act
            conference = true
            conferenceSince = clock.nowMillis()
            current.held = false
            other.held = false
            publish()
            val id = current.id
            val otherId = other.id
            effects += { gateway.join(id, otherId) }
            effects += { telecom.joinConference(id, otherId) }
        }
    }

    /**
     * Separar (spec da 0.2, 7.4): a última que entrou vai para a espera, e a outra fica a ativa, em cima (o motor desfaz
     * as ligações entre as duas: [SipGateway.split]); para o Telecom, a última fica HOLDING e a outra ACTIVE. Fora da
     * conferência, ou com uma das duas saindo, nada.
     */
    fun split() {
        act { effects ->
            val (first, last) = members() ?: return@act
            separate(first, last, effects)
            val id = first.id
            effects += { telecom.setActive(id) }
        }
    }

    /**
     * Sair: as ligações de agora acabam, sem o bipe do fim (saem do Telecom na hora), e daqui em diante os eventos do
     * motor são ignorados (até [onLogin]). Um bipe que já toca acaba como estava, e a Connection que o espera sai no
     * fim dele (ou no limite da espera).
     */
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

    // Com a trava: a recebida [ringing], que toca, é atendida (pela pessoa ou pelo Atender automático); a outra
    // ligação, se há, vai para a espera (o motor a põe no answer).
    private fun answer(ringing: Call, effects: MutableList<() -> Unit>) {
        if (ringing === autoCall) cancelAutoAnswer()
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

    // Com a trava: o Atender automático da recebida [call], que toca sozinha, daqui a [seconds] s ([autoAnswerDue]). Um
    // por vez (o cancel é só a garantia: um marcado é de uma recebida que ainda toca sozinha, e com ela nenhuma outra
    // toca sozinha).
    private fun startAutoAnswer(call: Call, seconds: Int) {
        cancelAutoAnswer()
        autoCall = call
        autoSeconds = seconds
        autoSince = clock.nowMillis()
        autoTimer = clock.schedule(seconds * 1000L) { autoAnswerDue(call) }
    }

    // Na thread do relógio: a hora do Atender automático de [call]. Só o marcado de agora vale (um cancelado cujo aviso já
    // tinha saído não atende), e as regras são as do começo ([autoAnswers]), de novo, com as configurações de agora. A da
    // operadora não é perguntada de novo: o nosso próprio toque põe o áudio no modo dela. Valendo, o microfone vem antes
    // (spec 12), fora da trava; a resposta atende ([autoAnswer]), e até ela o marcado fica (um cancelamento no meio vale).
    private fun autoAnswerDue(call: Call) {
        val chosen = settings()
        var asks = false
        act {
            if (call !== autoCall) return@act
            autoTimer = null
            if (autoAnswers(call, chosen)) {
                asks = true
            } else {
                cancelAutoAnswer()
                publish()
            }
        }
        if (asks) microphone.request { granted -> autoAnswer(call, granted) }
    }

    // Em qualquer thread: a resposta do [microphone] para o Atender automático de [call]. Só o marcado de agora vale (o
    // atender, o recusar, o fim dela e o Sair o cancelam no meio), e as regras valem de novo, com as configurações de
    // agora. Sem o microfone, ela continua tocando, sem o Atender automático: a pessoa ainda atende à mão.
    private fun autoAnswer(call: Call, granted: Boolean) {
        val chosen = settings()
        act { effects ->
            if (call !== autoCall) return@act
            cancelAutoAnswer()
            if (granted && autoAnswers(call, chosen)) answer(call, effects) else publish()
        }
    }

    // Com a trava: o Atender automático vale para [call]: ela é a única ligação, tocando (nem atendida, nem recusada,
    // nem saindo), com o Atender automático ligado e o Não perturbe desligado ([chosen]), e sem Sair.
    private fun autoAnswers(call: Call, chosen: CallSettings): Boolean {
        val alone = calls.size == 1 && calls[0] === call
        val ringing = call.phase == CallPhase.RINGING && !call.answered && !call.rejected && !call.ending
        return !loggedOut && alone && ringing && chosen.autoAnswer && !chosen.doNotDisturb
    }

    // Com a trava: o Atender automático marcado (se há) não atende mais.
    private fun cancelAutoAnswer() {
        autoTimer?.cancel()
        autoTimer = null
        autoCall = null
        autoSeconds = 0
        autoSince = 0L
    }

    // Com a trava: a recebida [current] recebe ocupado (486); o fim dela chega pelo motor.
    private fun reject(current: Call, effects: MutableList<() -> Unit>) {
        if (current === autoCall) cancelAutoAnswer()
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

    // Com a trava: o Desligar da conferência (o da tela, ou o do Telecom pela Connection de qualquer uma): as que ainda
    // não estão saindo saem, e nenhuma volta sozinha.
    private fun hangupConference(effects: MutableList<() -> Unit>) {
        val members = calls.filter { !it.ending }
        if (members.isEmpty()) return
        for (member in members) hangup(member, effects)
        publish()
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
        if (!target) clearTelecomHolds()
        publish()
        val id = current.id
        effects += { gateway.setHold(id, target) }
        effects += { if (target) telecom.setOnHold(id) else telecom.setActive(id) }
    }

    // Com a trava: com as duas em espera, [to] volta e vira a ativa (o motor a ativa); a outra fica em espera.
    private fun resume(to: Call, effects: MutableList<() -> Unit>) {
        to.held = false
        clearTelecomHolds()
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
        clearTelecomHolds()
        active = to
        publish()
        val fromId = from.id
        val toId = to.id
        effects += { gateway.activate(toId) }
        effects += { telecom.setOnHold(fromId) }
        effects += { telecom.setActive(toId) }
    }

    // Com a trava: uma das nossas ganhou o som (a retomada pelo Telecom ou pela pessoa, o Alternar): o Telecom já não
    // protege uma ligação da operadora, e a marca da espera dele sai de todas, também da que continua em espera (que,
    // assim, volta sozinha quando a ativa acaba, e deixa juntar).
    private fun clearTelecomHolds() {
        for (call in calls) call.heldByTelecom = false
    }

    // Com a trava: [other] vai para a espera pelo motor (no answer ou no makeCall de outra); o Telecom acompanha.
    private fun heldByEngine(other: Call, effects: MutableList<() -> Unit>) {
        other.held = true
        val id = other.id
        effects += { telecom.setOnHold(id) }
    }

    // Com a trava: a ligação [current] acabou com o código [code]: Recentes, notificação, aviso e Telecom (na hora, ou
    // no fim do bipe: [disconnectAfterBeep]). Se era a ativa, a outra (se há) passa a ser, e volta sozinha
    // ([resumeNext]). A outra que cai do outro lado, já em andamento e com a ativa continuando, deixa o aviso "<nome ou
    // número> desligou", como uma das duas da conferência (qualquer uma). Com ela, a consulta ([leaveConsult]) e a
    // conferência ([leaveConference]) acabam; a outra da conferência fica como uma ligação normal
    // ([stayAfterConference]).
    private fun end(current: Call, code: Int, effects: MutableList<() -> Unit>, cause: Int? = null, quiet: Boolean = false) {
        if (current === autoCall) cancelAutoAnswer()
        val wasActive = current === active
        val colleague = leaveConsult(current)
        val fromConference = leaveConference(effects)
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
            if (!received && unseen && !quiet) {
                val text = missedText(current.number, current.name, current.contact)
                effects += { notifier.showMissed(text) }
            }
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
                showEndMessage(if (colleague) "${current.displayName.ifEmpty { current.number }}: $message" else message)
            }
        }
        if ((!wasActive || fromConference) && received && !current.localHangup && !quiet && calls.any { !it.ending }) {
            showEndMessage("${current.displayName.ifEmpty { current.number }} desligou")
        }
        if (muted && calls.isEmpty()) {
            muted = false
            effects += { gateway.setMute(false) }
        }
        record(Recent(current.number, current.name, kind, current.startMillis, duration), effects)
        // A que o Telecom segura por uma ligação da operadora não bipa: o som é dela.
        if (received && !loggedOut && !current.heldByTelecom && calls.none { !it.ending } && settings().endBeep) {
            disconnectAfterBeep(id, endCause, effects)
        } else {
            effects += { telecom.disconnect(id, endCause) }
        }
        when {
            fromConference -> stayAfterConference(effects)
            wasActive && !current.held -> resumeNext(effects)
        }
    }

    // Com a trava: uma atendida acabou sem outra de pé: a Connection [id] sai do Telecom (com o motivo [cause]) no fim
    // do bipe. Com um bipe já tocando (a outra que acaba junto), ela espera o mesmo. A espera tem o limite dela no
    // relógio ([END_BEEP_MAX_MILLIS] desde o primeiro fim): um done que se perca nunca segura as Connections.
    private fun disconnectAfterBeep(id: Int, cause: Int, effects: MutableList<() -> Unit>) {
        beeping?.let {
            it.waiting += id to cause
            return
        }
        val wait = EndBeepWait(id, cause)
        beeping = wait
        wait.backstop = clock.schedule(END_BEEP_MAX_MILLIS) { endBeepDone(wait) }
        effects += { beep.play { endBeepDone(wait) } }
    }

    // Em qualquer thread (a do bipe, ou a do relógio, no limite): a espera [wait] acabou, e as Connections dela saem do
    // Telecom. É a única saída da espera, e roda uma vez só: o primeiro (o done ou o limite) desmarca o outro, e um
    // done repetido ou atrasado não faz nada (outro fim para o mesmo id pegaria a feita que ainda não tem id no
    // Telecom).
    private fun endBeepDone(wait: EndBeepWait) {
        act { effects ->
            if (beeping !== wait) return@act
            beeping = null
            wait.backstop?.cancel()
            wait.backstop = null
            for ((id, cause) in wait.waiting) effects += { telecom.disconnect(id, cause) }
        }
    }

    // Com a trava: a ativa acabou (e não estava em espera): a outra, a ativa agora, em andamento (em espera), volta
    // sozinha: o motor a retoma e o Telecom a ativa. Mas não se o Telecom a pôs em espera (o som é de outra ligação, a
    // da operadora, e ela espera o pedido de retomada dele), nem depois de Sair. (Com a ativa também em espera, as duas
    // pelo Telecom, nada volta: o [end] nem chama.)
    private fun resumeNext(effects: MutableList<() -> Unit>) {
        val next = active ?: return
        if (loggedOut || next.phase != CallPhase.ACTIVE || next.ending || next.heldByTelecom) return
        next.held = false
        val id = next.id
        effects += { gateway.activate(id) }
        effects += { telecom.setActive(id) }
    }

    // Com a trava: uma ligação da conferência acabou (do outro lado, desligada aqui ou com Sair); a conferência acaba
    // aí (o Telecom é avisado antes de a Connection dela acabar). true se havia conferência.
    private fun leaveConference(effects: MutableList<() -> Unit>): Boolean {
        if (!conference) return false
        conference = false
        conferenceSince = 0L
        effects += { telecom.splitConference() }
        return true
    }

    // Com a trava: a outra da conferência que acabou (a ativa agora) segue como uma ligação normal: o motor já a deixa
    // com o som (nada de activate), e o Telecom a ativa (ela podia estar HOLDING para ele). Não se ela também está
    // saindo (Desligar), nem depois de Sair.
    private fun stayAfterConference(effects: MutableList<() -> Unit>) {
        val next = active ?: return
        if (loggedOut || next.phase != CallPhase.ACTIVE || next.ending) return
        next.held = false
        val id = next.id
        effects += { telecom.setActive(id) }
    }

    // Com a trava: o Separar das duas da conferência: ela acaba, [last] (a última que entrou) vai para a espera e
    // [first] fica a ativa, em cima. O motor desfaz as ligações entre as duas e põe [last] em espera (o split); o
    // Telecom é avisado e a Connection de [last] fica HOLDING, antes de quem chama decidir a de [first].
    private fun separate(first: Call, last: Call, effects: MutableList<() -> Unit>) {
        conference = false
        conferenceSince = 0L
        active = first
        first.held = false
        last.held = true
        publish()
        val firstId = first.id
        val lastId = last.id
        effects += { gateway.split(firstId, lastId) }
        effects += { telecom.splitConference() }
        effects += { telecom.setOnHold(lastId) }
    }

    // Com a trava: as duas da conferência, na ordem em que entraram (a primeira e a última), com as duas de pé; null
    // fora da conferência ou com uma delas saindo.
    private fun members(): Pair<Call, Call>? {
        if (!conference || calls.size != 2 || calls.any { it.ending }) return null
        return calls[0] to calls[1]
    }

    // Com a trava: [current] acabou; se era da consulta, ela acaba aí (o cliente volta pela volta sozinha do [end], e o
    // colega que fica é uma ligação normal). true se [current] era o colega: o aviso de fim dele leva o nome ou o
    // número na frente. O colega que acaba com o Concluir esperando o resultado leva o pedido do cliente junto: o motor
    // recusa o REFER sem o colega, o resultado ([onTransfer]) nunca chega, e o cliente pode ser transferido de novo.
    private fun leaveConsult(current: Call): Boolean {
        val pair = consulting ?: return false
        if (current !== pair.client && current !== pair.colleague) return false
        consulting = null
        val colleague = current === pair.colleague
        if (colleague && pair.client.transferPending == Transfer.ATTENDED) pair.client.transferPending = null
        return colleague
    }

    // Com a trava: a central aceitou a transferência de [current], que o motor desliga: ela sai como desligada aqui
    // (a tela já não a mostra), sem o aviso "desligou" e sem a volta sozinha da outra.
    private fun transferred(current: Call) {
        current.localHangup = true
        current.ending = true
    }

    // Com a trava: uma perdida que a pessoa não viu (ocupado): Recentes e notificação ([silent]: a do Não perturbe).
    private fun missed(recent: Recent, contact: String?, effects: MutableList<() -> Unit>, silent: Boolean = false) {
        record(recent, effects)
        val text = missedText(recent.number, recent.name, contact)
        effects += { notifier.showMissed(text, silent) }
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
    // ligação da tela e, com duas, a outra, a consulta e a conferência (só com as duas de pé: com uma saindo, a tela já
    // mostra a outra sozinha), e o Atender automático que vai atender a de cima, com as configurações de agora.
    private fun publish() {
        val ui = shown()?.let { main ->
            val other = otherThan(main)
            val together = conference && other != null
            val second = other?.let {
                SecondUi(it.id, it.number, it.displayName, if (together) SecondKind.ACTIVE else secondKind(it), it.activeSince)
            }
            val auto = main.takeIf { it === autoCall && autoAnswers(it, settings()) }
            CallUi(
                main.id, main.number, main.displayName, main.incoming, main.phase, main.activeSince, main.held, muted,
                second = second,
                conference = together,
                consult = consultUi(),
                conferenceSinceMillis = if (together) conferenceSince else 0,
                autoAnswerSeconds = auto?.let { autoSeconds },
                autoAnswerSinceMillis = if (auto != null) autoSince else 0,
            )
        }
        publications.addLast { mutableState.value = ui }
        val ringing = ringingCall()
        announceAutoAnswer(ringing, ringing?.takeIf { it === autoCall && autoAnswers(it, settings()) }?.let { autoSeconds })
    }

    // Com a trava: a decisão do Atender automático sobre a recebida que toca ([ringing]: [decision], os segundos, ou null
    // se ele não vai atendê-la), quando mudou desde o último aviso, vai ao notificador, na fila das publicações (R38): a
    // notificação dela ganha ou perde a linha, uma vez por mudança, e nunca a cada segundo (a contagem é só da tela). Uma
    // recebida nova começa sem a linha; a que parou de tocar não precisa de aviso (a notificação dela sai).
    private fun announceAutoAnswer(ringing: Call?, decision: Int?) {
        val id = ringing?.id ?: NO_ID
        if (id != announcedId) {
            announcedId = id
            announcedSeconds = null
        }
        if (id == NO_ID || decision == announcedSeconds) return
        announcedSeconds = decision
        publications.addLast { notifier.autoAnswerChanged(id, decision) }
    }

    // Com a trava: a consulta para a tela, só com as duas de pé (com uma saindo, a tela já mostra a outra sozinha).
    private fun consultUi(): ConsultUi? =
        consulting?.takeIf { !it.client.ending && !it.colleague.ending }
            ?.let { ConsultUi(it.colleague.id, colleagueActive = it.colleague === active) }

    // A outra de duas, fora da conferência, para a tela: tocando ou em espera (a feita que chama é sempre a ativa).
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

    // "Ligação perdida de <nome do contato do celular, ou o número (ou, sem número, o nome da central)>".
    private fun missedText(number: String, name: String, contact: String?) =
        "Ligação perdida de ${contact ?: number.ifEmpty { name }}"

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
