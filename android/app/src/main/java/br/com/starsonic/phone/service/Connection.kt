package br.com.starsonic.phone.service

import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.engine.EngineEvents
import br.com.starsonic.phone.engine.SipGateway
import br.com.starsonic.phone.engine.Transport
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * A conexão do processo com o servidor (spec 7.2): o motor de ligações, a conta que está nele e o status da
 * faixa e da notificação fixa. Um motor por processo: ele sobe uma vez ([ensureStarted], ou na primeira troca
 * de conta) e fica de pé.
 *
 * - Toda troca de conta passa por aqui: a conexão é o [SipGateway] da tela Entrar, do [SipService] e do
 *   [NetworkMonitor], e sabe qual conta está no motor e com que id (o que o setAccount devolve; a saída de
 *   uma conta chega pelo (200, false) do removeAccount, com o id dela).
 * - Com conta gravada, quem manda é o [SipService]: ele se apresenta ao começar ([claim]), segura a conta
 *   gravada ([adopt]: se o motor já está com ela, como depois do Entrar, fica o mesmo id, sem outro
 *   REGISTER; senão, registra) e a solta ao parar ([release]: a conta sai do motor).
 * - O [status] usa só os resultados do registro da conta do serviço, pelo id dela no motor. O último
 *   resultado de cada conta fica guardado, então o serviço que adota a conta já mostra o resultado dela.
 *
 * Threads: [ensureStarted], [setAccount], [adopt], [makeCall] e [hasCall] esperam o motor (nunca na thread
 * principal); o resto só põe um pedido na fila do motor ou mexe no estado. Os eventos do motor chegam na
 * thread dele ("starsonic-eventos"). A trava nunca fica presa numa chamada ao motor.
 */
class Connection(
    private val newEngine: () -> SipGateway,
    private val core: CoreRules,
    private val userAgent: String,
    private val profileText: () -> String,
    private val log: (Int, String) -> Unit = { _, _ -> },
) : SipGateway {
    /** O último resultado do registro de uma conta: o código SIP e se ela ficou registrada. */
    private data class Registration(val code: Int, val active: Boolean)

    private val mutableStatus = MutableStateFlow(StatusModel.from(null, false, true, "", core))

    /** O status da conta do serviço: a faixa e a notificação fixa ("Conectando…" sem o serviço). */
    val status: StateFlow<Status> = mutableStatus

    /** Quem espera o resultado do registro na tela Entrar (null fora dela): código, ativa e id da conta. */
    @Volatile
    var loginEvents: ((Int, Boolean, Int) -> Unit)? = null

    // O motor nasce na primeira subida: carregar a biblioteca nativa lê o disco (nunca na thread principal).
    private val startLock = Any()

    @Volatile
    private var engine: SipGateway? = null

    @Volatile
    private var started = false

    // A trava guarda o resto.
    private val lock = Any()
    private var engineAccount: Account? = null   // a conta do último setAccount aceito...
    private var engineAccountId = 0              // ...e o id dela (cada conta nova recebe um maior)
    private var removedUpTo = 0                  // o maior id que já saiu do motor
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

        // As ligações entram na Task 8.
        override fun onIncomingCall(callId: Int, remoteUser: String, remoteName: String) {}

        override fun onRejectedBusy(remoteUser: String, remoteName: String) {}

        override fun onCallState(callId: Int, state: Int, code: Int) {}

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
     * O serviço [owner] segura a conta gravada [account]: se o motor já está com ela, fica o mesmo id (sem
     * outro REGISTER); senão, registra. false se o serviço já parou (nada fica no motor) ou o motor não aceitou
     * a conta. Espera o motor: nunca na thread principal.
     */
    fun adopt(owner: Any, account: Account): Boolean {
        val register = synchronized(lock) {
            if (this.owner !== owner) return false
            owned = account
            publish()
            currentIdOf(account) == 0
        }
        if (!register) return true
        val id = setAccount(account.address, account.transport, account.ramal, account.senha)
        val orphan = synchronized(lock) {
            id > 0 && id == engineAccountId && id > removedUpTo && (this.owner !== owner || owned != account)
        }
        if (orphan) engine?.removeAccount()   // o serviço parou enquanto registrava: a conta não fica no motor
        return id > 0 && !orphan
    }

    /** O serviço [owner] parou: a conta dele sai do motor, e o status volta a "Conectando…". */
    fun release(owner: Any) {
        val remove = synchronized(lock) {
            if (this.owner !== owner) return
            val account = owned
            this.owner = null
            owned = null
            online = true
            publish()
            account != null && currentIdOf(account) > 0
        }
        if (remove) engine?.removeAccount()
    }

    /** Há rede ([NetworkMonitor.online]); sem ela, o status é "Sem internet". */
    fun setOnline(online: Boolean) {
        synchronized(lock) {
            this.online = online
            publish()
        }
    }

    /** A conexão sobe o motor sozinha ([ensureStarted]), com o User-Agent e o perfil dela. */
    override fun start(userAgent: String, profileText: String, events: EngineEvents): Boolean =
        throw UnsupportedOperationException("o motor sobe pela Connection.ensureStarted()")

    /** Na etapa 1 o motor fica de pé enquanto o processo vive (Sair só tira a conta). */
    override fun stop() {
        throw UnsupportedOperationException("o motor fica de pé enquanto o processo vive")
    }

    /** Troca a conta e registra (sobe o motor antes, se preciso); a conexão anota a conta e o id dela. */
    override fun setAccount(address: String, transport: Transport, ramal: String, senha: String): Int {
        if (!ensureStarted()) return 0
        val id = engine?.setAccount(address, transport, ramal, senha) ?: 0
        synchronized(lock) {
            if (id > engineAccountId) {
                engineAccount = Account(address, transport, ramal, senha)
                engineAccountId = id
            } else if (id == 0) {
                // O motor recusou a conta: a anterior pode já ter saído (SipEngine::SetAccount).
                removedUpTo = maxOf(removedUpTo, engineAccountId)
            }
            publish()
        }
        return id
    }

    /** Tira a conta do motor; o (200, false) que chega no fim diz à conexão que ela saiu. */
    override fun removeAccount() {
        engine?.removeAccount()
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

    // Com a trava: o id da [account] no motor, ou 0 se o motor não está com ela.
    private fun currentIdOf(account: Account): Int =
        if (engineAccountId > removedUpTo && engineAccount == account) engineAccountId else 0

    // Com a trava: o status da conta do serviço (só os resultados do id dela no motor).
    private fun publish() {
        val account = owned
        val result = if (account != null) results[currentIdOf(account)] else null
        mutableStatus.value = StatusModel.from(result?.code, result?.active ?: false, online, account?.ramal.orEmpty(), core)
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
