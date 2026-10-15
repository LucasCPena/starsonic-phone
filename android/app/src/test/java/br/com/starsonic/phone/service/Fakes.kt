package br.com.starsonic.phone.service

import br.com.starsonic.phone.core.Check
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.engine.EngineEvents
import br.com.starsonic.phone.engine.SipGateway
import br.com.starsonic.phone.engine.Transport
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/** O núcleo falso: o aviso do registro como o do núcleo (401, 403 e 407; nada de 100 a 299). */
internal class FakeCore : CoreRules {
    override fun validateServer(raw: String): Pair<Check, String> = Check.OK to raw

    override fun validateRamal(raw: String): Pair<Check, String> = Check.OK to raw

    override fun registrationMessage(code: Int): String = when (code) {
        in 100..299 -> ""
        401, 403, 407 -> "Ramal ou senha incorretos."
        else -> "registro $code"
    }

    override fun callEndMessage(code: Int) = ""

    override fun normalizeDialString(raw: String) = raw
}

/**
 * O motor falso: cada conta recebe um id (1, 2, 3...), como no motor de verdade. A saída de uma conta
 * ([removeAccount]) só põe o pedido na fila, como no motor: ela acontece antes da próxima troca de conta ou em
 * [flush], e aí chega o (200, false) com o id da conta que saiu. Os resultados do registro chegam à mão, por
 * [registration]. Aguenta chamadas de duas threads (os testes de corrida).
 */
internal class FakeEngine : SipGateway {
    @Volatile
    var starts = 0
    val accounts: MutableList<Account> = CopyOnWriteArrayList()
    private val ids = AtomicInteger()
    private val removalRequests = AtomicInteger()
    private val pendingRemovals = AtomicInteger()

    @Volatile
    var ipChanges = 0

    @Volatile
    private var events: EngineEvents? = null

    /** O id da conta que está no motor (0: nenhuma). */
    @Volatile
    var current = 0
        private set

    /** O id da última conta criada. */
    val lastId: Int
        get() = ids.get()

    /** Quantas saídas de conta foram pedidas. */
    val removals: Int
        get() = removalRequests.get()

    /** Roda dentro do setAccount, antes de ele voltar com o id (um aviso do motor que chega antes). */
    @Volatile
    var duringSetAccount: ((Int) -> Unit)? = null

    /** Um resultado do registro da conta [id] (a última, se nada for dito). */
    fun registration(code: Int, active: Boolean, id: Int = lastId) {
        events!!.onRegistration(code, active, id)
    }

    /** Os avisos de ligação do motor, à mão. */
    fun callEvents(): EngineEvents = events!!

    /** O motor termina as saídas de conta pedidas, na ordem. */
    fun flush() {
        while (pendingRemovals.getAndUpdate { if (it > 0) it - 1 else 0 } > 0) {
            val id = current
            current = 0
            if (id > 0) events?.onRegistration(200, false, id)
        }
    }

    override fun start(userAgent: String, profileText: String, events: EngineEvents): Boolean {
        starts++
        this.events = events
        return true
    }

    override fun stop() {}

    override fun setAccount(address: String, transport: Transport, ramal: String, senha: String): Int {
        flush()   // o que foi pedido antes acontece antes
        accounts += Account(address, transport, ramal, senha)
        val id = ids.incrementAndGet()
        current = id
        duringSetAccount?.invoke(id)
        return id
    }

    override fun removeAccount() {
        removalRequests.incrementAndGet()
        pendingRemovals.incrementAndGet()
    }

    override fun reregister() {}

    override fun handleIpChange() {
        ipChanges++
    }

    override fun makeCall(number: String) = -1

    override fun answer(id: Int) {}

    override fun reject(id: Int) {}

    override fun hangup(id: Int) {}

    override fun setHold(id: Int, hold: Boolean) {}

    override fun setMute(mute: Boolean) {}

    override fun sendDtmf(id: Int, digits: String) {}

    override fun transfer(id: Int, number: String) {}

    override fun hasCall() = false
}
