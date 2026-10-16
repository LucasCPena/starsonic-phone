package br.com.starsonic.phone.service

import br.com.starsonic.phone.core.Check
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.Manifest
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

    override fun contactDialString(raw: String, ddi: String, prefix: String) = raw

    override fun profileDial(profileText: String) = "55" to ""

    override fun parseManifest(json: String, allowedPrefix: String, onError: (String) -> Unit): Manifest? = null

    override fun compareVersions(a: String, b: String) = 0
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

    /** Quantas renovações do registro foram pedidas ([reregister]). */
    @Volatile
    var reregisters = 0

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

    override fun reregister() {
        reregisters++
    }

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

/** O wake lock falso: anota se está preso e quantas vezes foi pego e solto. */
internal class FakeCpuLock : CpuLock {
    var held = false
    var acquires = 0
    var releases = 0

    override fun acquire() {
        held = true
        acquires++
    }

    override fun release() {
        held = false
        releases++
    }
}

/**
 * As falhas do registro que o pjsua repete sozinho (pjsua_acc.c, regc_cb): 408, 480, 500, 502, 503, 504 e os 6xx. O
 * motor dá 408 e 503 também quando o servidor não responde ou o transporte cai.
 */
internal val RETRIED_FAILURES = listOf(408, 480, 500, 502, 503, 504, 600, 603, 604, 606)

/**
 * As recusas do registro que o pjsua não repete: a senha recusada (401, 403 e 407), os outros 4xx (404, 420...), os 3xx
 * e os 5xx fora da lista dele (501, 505...).
 */
internal val NOT_RETRIED_FAILURES = listOf(401, 403, 407, 404, 400, 420, 302, 501, 505)
