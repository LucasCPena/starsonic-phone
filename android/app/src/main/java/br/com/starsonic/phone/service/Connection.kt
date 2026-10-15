package br.com.starsonic.phone.service

import br.com.starsonic.phone.call.CallEvents
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.engine.EngineEvents
import br.com.starsonic.phone.engine.SipGateway
import br.com.starsonic.phone.engine.Transport
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** O que [Connection.adopt] fez com a conta gravada. */
enum class Adoption {
    /** O motor já estava com ela (a tela Entrar acabou de registrá-la ou a pôs de volta): o mesmo id, sem REGISTER. */
    KEPT,

    /** O motor estava vazio, ou com a conta que o próprio serviço tinha posto: o serviço registrou a gravada. */
    REGISTERED,

    /**
     * A tela Entrar está com o motor (uma tentativa, do setAccount dela até o desfecho): nada muda. O status
     * segue a conta gravada pelos campos; depois do desfecho, o serviço fica com a conta certa (ver [Connection]).
     */
    WAITING,

    /** O motor recusou a conta, ou não subiu. */
    REFUSED,

    /** O serviço já tinha parado: nada fica no motor. */
    STOPPED,
}

/**
 * A conexão do processo com o servidor (spec 7.2): o motor de ligações, a conta que está nele e o status da
 * faixa e da notificação fixa. Um motor por processo: ele sobe uma vez ([ensureStarted], ou na primeira troca
 * de conta) e fica de pé.
 *
 * - Toda troca de conta passa por aqui: a conexão é o [SipGateway] da tela Entrar, do [SipService] e do
 *   [NetworkMonitor]. Ela sabe qual conta está no motor, com que id (o que o setAccount devolve) e quem a pôs:
 *   o serviço ou a tela Entrar (todo [setAccount] de fora é da tela Entrar: a tentativa ou a volta à anterior).
 * - Com conta gravada, quem manda é o [SipService]: ele se apresenta ao começar ([claim]), segura a conta
 *   gravada ([adopt]) e a solta ao parar ([release]: a conta sai do motor).
 *   - [adopt]: se o motor já está com a conta gravada (pelos campos), fica o mesmo id, sem REGISTER. Se o
 *     motor está vazio, ou com a conta que o próprio serviço pôs, registra a gravada. Se está com uma conta
 *     que a tela Entrar pôs, não mexe ([Adoption.WAITING]): é uma tentativa, do setAccount dela até o desfecho
 *     (ou o resultado dela antes de o serviço reler a conta gravada).
 *   - Depois do desfecho de uma tentativa: no commit, o app inicia o serviço, que relê a conta gravada e adota a
 *     nova, que já está no motor (mesmo id, sem REGISTER). No rollback, a tela põe a anterior de volta, e o
 *     status a segue pelos campos; se a tela deixa o motor vazio, o serviço registra a conta gravada.
 * - O [status] usa só os resultados do registro da conta do serviço, pelo id dela no motor. O último
 *   resultado de cada conta fica guardado, então o serviço que adota a conta já mostra o resultado dela.
 *   [registered] diz o mesmo para quem liga: a conta do serviço registrada e com rede.
 * - Os avisos de ligação do motor vão às ligações ([calls], o CallManager), na thread dos eventos.
 *
 * Threads e travas (ninguém espera em círculo):
 * - As trocas de conta ([setAccount], [removeAccount], [adopt] e a saída do [release]) vão em ordem, uma de
 *   cada vez, na thread "starsonic-conta". A decisão (com a trava de estado) e o pedido ao motor ficam na mesma
 *   troca, então o motor recebe os pedidos na ordem em que a conexão decidiu: uma conta que sai já sai para
 *   quem vem depois, e uma limpeza nunca tira a conta de uma troca seguinte. [setAccount] e [adopt] esperam a
 *   vez e o motor (nunca na thread principal); [removeAccount] e [release] só põem na fila.
 * - Travas: startLock guarda só a subida do motor; lock guarda o estado, é curto e nunca fica preso numa
 *   chamada ao motor, ao log ou à tela Entrar. Ninguém pega o startLock com o lock na mão.
 * - Quem espera quem: quem chama → a thread das trocas → a thread do motor ("starsonic-motor"). A thread das
 *   trocas nunca espera a dos eventos nem a principal; a do motor não espera ninguém. A dos eventos
 *   ("starsonic-eventos") só pega o lock para anotar um resultado; sem trava nenhuma, ela pode esperar a das
 *   trocas (a volta à conta anterior da tela Entrar).
 */
class Connection(
    private val newEngine: () -> SipGateway,
    private val core: CoreRules,
    private val userAgent: String,
    private val profileText: () -> String,
    private val log: (Int, String) -> Unit = { _, _ -> },
    private val calls: () -> CallEvents? = { null },
) : SipGateway {
    /** O último resultado do registro de uma conta: o código SIP e se ela ficou registrada. */
    private data class Registration(val code: Int, val active: Boolean)

    /** Quem pôs no motor a conta que está nele. */
    private enum class Setter { SERVICE, LOGIN }

    private val mutableStatus = MutableStateFlow(StatusModel.from(null, false, true, "", core))

    /** O status da conta do serviço: a faixa e a notificação fixa ("Conectando…" sem o serviço). */
    val status: StateFlow<Status> = mutableStatus

    private val mutableRegistered = MutableStateFlow(false)

    /** A conta do serviço está registrada e há rede ("Conectado"): só assim o app liga (spec 7.4). */
    val registered: StateFlow<Boolean> = mutableRegistered

    /** Quem espera o resultado do registro na tela Entrar (null fora dela): código, ativa e id da conta. */
    @Volatile
    var loginEvents: ((Int, Boolean, Int) -> Unit)? = null

    // A thread das trocas de conta.
    @Volatile
    private var changeThread: Thread? = null

    private val changes: ExecutorService = Executors.newSingleThreadExecutor { task ->
        Thread(task, "starsonic-conta").also {
            it.isDaemon = true
            changeThread = it
        }
    }

    // O motor nasce na primeira subida: carregar a biblioteca nativa lê o disco (nunca na thread principal).
    private val startLock = Any()

    @Volatile
    private var engine: SipGateway? = null

    @Volatile
    private var started = false

    // A trava guarda o resto.
    private val lock = Any()
    private var engineAccount: Account? = null   // a conta do último setAccount aceito...
    private var engineAccountId = 0              // ...o id dela (cada conta nova recebe um maior)...
    private var engineSetter = Setter.LOGIN      // ...e quem a pôs
    private var removedUpTo = 0                  // o maior id que já saiu do motor (ou cuja saída já foi pedida)
    private val results = HashMap<Int, Registration>()   // o último resultado de cada conta recente
    private var owner: Any? = null               // o serviço de pé
    private var owned: Account? = null           // a conta gravada que ele segura
    private var online = true

    private val events = object : EngineEvents {
        override fun onRegistration(code: Int, active: Boolean, accountId: Int) {
            synchronized(lock) {
                // (200, false): a conta saiu do motor (removeAccount); não é um registro.
                if (code in 200..299 && !active && accountId > removedUpTo) removedUpTo = accountId
                results[accountId] = Registration(code, active)
                forgetOldResults()
                publish()
            }
            loginEvents?.invoke(code, active, accountId)
        }

        override fun onIncomingCall(callId: Int, remoteUser: String, remoteName: String) {
            calls()?.onIncoming(callId, remoteUser, remoteName)
        }

        override fun onRejectedBusy(remoteUser: String, remoteName: String) {
            calls()?.onRejectedBusy(remoteUser, remoteName)
        }

        override fun onCallState(callId: Int, state: Int, code: Int) {
            calls()?.onCallState(callId, state, code)
        }

        override fun onLog(level: Int, line: String) = log(level, line)
    }

    /** Sobe o motor, se ainda não subiu (uma vez por processo). Espera o motor: nunca na thread principal. */
    fun ensureStarted(): Boolean {
        if (started) return true
        synchronized(startLock) {
            if (started) return true
            val current = engine ?: newEngine().also { engine = it }
            started = current.start(userAgent, profileText(), events)
            if (!started) log(1, "o motor de ligações não subiu")
            return started
        }
    }

    /** O serviço [owner] começou: só ele pode segurar a conta gravada daqui em diante. */
    fun claim(owner: Any) {
        synchronized(lock) { this.owner = owner }
    }

    /**
     * O serviço [owner] segura a conta gravada [account] (ver a regra em [Connection]). Espera a vez entre as
     * trocas de conta e o motor: nunca na thread principal.
     */
    fun adopt(owner: Any, account: Account): Adoption = inOrder {
        val decided = synchronized(lock) {
            if (this.owner !== owner) return@inOrder Adoption.STOPPED
            owned = account
            publish()
            when {
                currentIdOf(account) > 0 -> Adoption.KEPT
                engineAccountId > removedUpTo && engineSetter == Setter.LOGIN -> Adoption.WAITING
                else -> null
            }
        }
        decided ?: register(owner, account)
    }

    /** O serviço [owner] parou: a conta dele sai do motor (na ordem das trocas), e o status volta a "Conectando…". */
    fun release(owner: Any) {
        val account = synchronized(lock) {
            if (this.owner !== owner) return
            val account = owned
            this.owner = null
            owned = null
            online = true
            publish()
            account
        } ?: return
        later {
            // Só se o motor ainda está com ela (pelos campos): com uma tentativa da tela Entrar no motor, nada sai.
            val inEngine = synchronized(lock) { currentIdOf(account) > 0 }
            if (inEngine) removeFromEngine()
        }
    }

    /**
     * O serviço [owner] diz se há rede ([NetworkMonitor.online]); sem ela, o status é "Sem internet". O aviso
     * de um serviço que já parou (atrasado) não conta.
     */
    fun setOnline(owner: Any, online: Boolean) {
        synchronized(lock) {
            if (this.owner !== owner) return
            this.online = online
            publish()
        }
    }

    /** Espera as trocas de conta pedidas até aqui (para os testes). */
    internal fun awaitChanges() {
        inOrder {}
    }

    /** A conexão sobe o motor sozinha ([ensureStarted]), com o User-Agent e o perfil dela. */
    override fun start(userAgent: String, profileText: String, events: EngineEvents): Boolean =
        throw UnsupportedOperationException("o motor sobe pela Connection.ensureStarted()")

    /** Na etapa 1 o motor fica de pé enquanto o processo vive (Sair só tira a conta). */
    override fun stop() {
        throw UnsupportedOperationException("o motor fica de pé enquanto o processo vive")
    }

    /**
     * A tela Entrar troca a conta e registra (a tentativa, ou a anterior de volta depois de uma falha); sobe o
     * motor antes, se preciso. Espera a vez entre as trocas de conta e o motor.
     */
    override fun setAccount(address: String, transport: Transport, ramal: String, senha: String): Int = inOrder {
        val id = setInEngine(Account(address, transport, ramal, senha), Setter.LOGIN)
        resumeOwned()
        id
    }

    /** Tira a conta do motor, na ordem das trocas; o (200, false) chega no fim. Só põe na fila. */
    override fun removeAccount() = later {
        removeFromEngine()
        resumeOwned()
    }

    override fun reregister() {
        engine?.reregister()
    }

    /** A rede mudou: o registro da conta é refeito, e o status fica em "Conectando…" até a resposta. */
    override fun handleIpChange() {
        synchronized(lock) {
            if (engineAccountId > removedUpTo) results.remove(engineAccountId)
            publish()
        }
        engine?.handleIpChange()
    }

    override fun makeCall(number: String): Int = engine?.makeCall(number) ?: -1

    override fun answer(id: Int) {
        engine?.answer(id)
    }

    override fun reject(id: Int) {
        engine?.reject(id)
    }

    override fun hangup(id: Int) {
        engine?.hangup(id)
    }

    override fun setHold(id: Int, hold: Boolean) {
        engine?.setHold(id, hold)
    }

    override fun setMute(mute: Boolean) {
        engine?.setMute(mute)
    }

    override fun sendDtmf(id: Int, digits: String) {
        engine?.sendDtmf(id, digits)
    }

    override fun transfer(id: Int, number: String) {
        engine?.transfer(id, number)
    }

    override fun hasCall(): Boolean = engine?.hasCall() ?: false

    // Na thread das trocas: põe [account] no motor (sobe o motor antes, se preciso) e anota quem a pôs.
    private fun setInEngine(account: Account, setter: Setter): Int {
        val id = if (ensureStarted()) {
            engine?.setAccount(account.address, account.transport, account.ramal, account.senha) ?: 0
        } else {
            0
        }
        synchronized(lock) {
            if (id > engineAccountId) {
                engineAccount = account
                engineAccountId = id
                engineSetter = setter
            } else if (id == 0) {
                // O motor recusou a conta: a anterior pode já ter saído (SipEngine::SetAccount).
                removedUpTo = maxOf(removedUpTo, engineAccountId)
            }
            publish()
        }
        return id
    }

    // Na thread das trocas: tira do motor a conta que está nele. A decisão vale na hora: o motor tira exatamente
    // esta (os pedidos vão na ordem das trocas), e a troca seguinte já a vê fora.
    private fun removeFromEngine() {
        synchronized(lock) {
            removedUpTo = maxOf(removedUpTo, engineAccountId)
            publish()
        }
        engine?.removeAccount()
    }

    // Na thread das trocas: o serviço [owner] registra a conta gravada; se ele parou enquanto isso, a conta sai
    // antes de qualquer outra troca.
    private fun register(owner: Any, account: Account): Adoption {
        val id = setInEngine(account, Setter.SERVICE)
        val stopped = synchronized(lock) { this.owner !== owner || owned != account }
        if (id > 0 && stopped) removeFromEngine()
        return when {
            stopped -> Adoption.STOPPED
            id > 0 -> Adoption.REGISTERED
            else -> Adoption.REFUSED
        }
    }

    // Na thread das trocas, depois de uma troca da tela Entrar: se ela deixou o motor vazio (uma tentativa
    // desfeita sem uma conta anterior para pôr de volta) e o serviço segura a conta gravada, ele a registra.
    private fun resumeOwned() {
        val holder: Any
        val account: Account
        synchronized(lock) {
            holder = owner ?: return
            account = owned ?: return
            if (engineAccountId > removedUpTo) return
        }
        register(holder, account)
    }

    // Roda [change] na thread das trocas, depois das que já foram pedidas, e espera. Na própria thread das
    // trocas, roda na hora. Uma interrupção não corta a troca: fica para depois.
    private fun <T> inOrder(change: () -> T): T {
        if (Thread.currentThread() === changeThread) return change()
        val result = changes.submit(Callable { change() })
        var interrupted = false
        try {
            while (true) {
                try {
                    return result.get()
                } catch (e: InterruptedException) {
                    interrupted = true
                } catch (e: ExecutionException) {
                    throw e.cause ?: e
                }
            }
        } finally {
            if (interrupted) Thread.currentThread().interrupt()
        }
    }

    // Põe [change] na fila das trocas e volta.
    private fun later(change: () -> Unit) {
        changes.execute {
            try {
                change()
            } catch (e: RuntimeException) {
                log(1, "troca de conta: $e")
            }
        }
    }

    // Com a trava: o id da [account] no motor, ou 0 se o motor não está com ela.
    private fun currentIdOf(account: Account): Int =
        if (engineAccountId > removedUpTo && engineAccount == account) engineAccountId else 0

    // Com a trava: o status da conta do serviço (só os resultados do id dela no motor).
    private fun publish() {
        val account = owned
        val result = if (account != null) results[currentIdOf(account)] else null
        mutableStatus.value = StatusModel.from(result?.code, result?.active ?: false, online, account?.ramal.orEmpty(), core)
        mutableRegistered.value = online && result != null && result.code in 200..299 && result.active
    }

    // Com a trava: os resultados das contas mais antigas saem (o da conta do motor fica).
    private fun forgetOldResults() {
        while (results.size > KEPT_RESULTS) {
            val oldest = results.keys.filter { it != engineAccountId }.minOrNull() ?: return
            results.remove(oldest)
        }
    }

    private companion object {
        const val KEPT_RESULTS = 8
    }
}
