package br.com.starsonic.phone.login

import br.com.starsonic.phone.core.Check
import br.com.starsonic.phone.core.Clock
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.LoginFlow
import br.com.starsonic.phone.core.LoginFlowHandle
import br.com.starsonic.phone.core.Scheduled
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.data.AccountStore
import br.com.starsonic.phone.engine.EngineEvents
import br.com.starsonic.phone.engine.SipGateway
import br.com.starsonic.phone.engine.Transport
import java.util.concurrent.Executor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A tela Entrar na JVM, com o núcleo, o motor, o armazenamento, o relógio e o LoginFlow falsos (o LoginFlow
 * de verdade, pela ponte, é testado no núcleo e no NativeLoadTest).
 */
class LoginViewModelTest {
    private val core = FakeCore()
    private val gateway = FakeGateway()
    private val store = FakeStore()
    private val clock = FakeClock()

    // A conta gravada vem de quem cria o modelo (no app, lida fora da thread principal); a volta à conta
    // anterior depois do fim do tempo roda em [background] (aqui, na hora).
    private fun model(background: Executor = Executor { it.run() }) =
        LoginViewModel(core, gateway, store, clock, previous = store.load(), newFlow = ::FakeFlow, background = background)

    private fun LoginViewModel.fill(server: String, ramal: String, senha: String, transport: Transport = Transport.UDP) {
        onServerChange(server)
        onTransportChange(transport)
        onRamalChange(ramal)
        onSenhaChange(senha)
    }

    @Test
    fun `empty server shows the core message first`() {
        val model = model()
        model.submit()
        assertEquals("servidor vazio", model.state.value.message)
        assertFalse(model.state.value.loading)
        assertTrue(gateway.accounts.isEmpty())
    }

    @Test
    fun `invalid ramal and empty password are checked in order`() {
        val model = model()
        model.fill(" Sip.Exemplo.com.br ", "20 01", "")
        model.submit()
        assertEquals("ramal inválido", model.state.value.message)
        model.onRamalChange("2001")
        model.submit()
        assertEquals("Digite a senha.", model.state.value.message)
        assertTrue(gateway.accounts.isEmpty())
        assertNull(store.account)
    }

    @Test
    fun `successful registration saves the account and leaves`() {
        val model = model()
        model.fill(" Sip.Exemplo.com.br ", " 2001 ", "senha-certa", Transport.TCP)
        model.submit()
        assertTrue(model.state.value.loading)
        assertEquals("", model.state.value.message)
        model.submit()   // um segundo toque enquanto espera não registra de novo
        assertEquals(listOf(AccountCall("sip.exemplo.com.br", Transport.TCP, "2001", "senha-certa")), gateway.accounts)
        val id = gateway.lastId
        // A saída de uma conta (200 sem registro), as respostas provisórias e as de outra conta não contam.
        model.onRegistration(200, false, id)
        model.onRegistration(100, false, id)
        model.onRegistration(200, true, id + 1)
        assertTrue(model.state.value.loading)
        assertNull(store.account)
        model.onRegistration(200, true, id)
        assertEquals(Account("sip.exemplo.com.br", Transport.TCP, "2001", "senha-certa"), store.account)
        assertTrue(model.state.value.done)
        assertFalse(model.state.value.loading)
        assertEquals(0, gateway.removals)
    }

    @Test
    fun `failed registration shows the message and saves nothing`() {
        val model = model()
        model.fill("sip.exemplo.com.br", "2001", "errada")
        model.submit()
        model.onRegistration(403, false, gateway.lastId)
        assertEquals("registro 403", model.state.value.message)
        assertFalse(model.state.value.loading)
        assertFalse(model.state.value.done)
        assertNull(store.account)
        assertEquals(1, gateway.removals)   // a conta tentada sai do motor
        model.onRegistration(200, true, gateway.lastId)   // um resultado atrasado não muda nada
        assertNull(store.account)
        assertFalse(model.state.value.done)
    }

    @Test
    fun `no answer in 15 seconds times out`() {
        val model = model()
        model.fill("sip.exemplo.com.br", "2001", "senha-certa")
        model.submit()
        clock.advance(14_999)
        assertTrue(model.state.value.loading)
        clock.advance(1)
        assertEquals("registro 0", model.state.value.message)
        assertFalse(model.state.value.loading)
        assertEquals(1, gateway.removals)
        model.onRegistration(200, true, gateway.lastId)   // chegou depois do tempo: ignorado
        assertNull(store.account)
        assertFalse(model.state.value.done)
        assertEquals("registro 0", model.state.value.message)
    }

    @Test
    fun `the timeout rollback leaves the clock thread`() {
        // A volta à conta anterior espera o motor (setAccount): não pode prender a thread do relógio.
        val queued = mutableListOf<Runnable>()
        val model = model(background = Executor { queued += it })
        model.fill("sip.exemplo.com.br", "2001", "senha-certa")
        model.submit()
        clock.advance(15_000)
        assertEquals(0, gateway.removals)
        assertTrue(model.state.value.loading)
        assertEquals(1, queued.size)
        queued.single().run()
        assertEquals(1, gateway.removals)
        assertEquals("registro 0", model.state.value.message)
        assertFalse(model.state.value.loading)
    }

    @Test
    fun `the saved account comes from the caller and is not read again`() {
        // O modelo nasce na thread principal: a conta gravada (Keystore e disco) já vem lida.
        val saved = Account("sip.exemplo.com.br", Transport.TCP, "2001", "antiga")
        store.account = saved
        val model = LoginViewModel(core, gateway, store, clock, previous = saved, newFlow = ::FakeFlow)
        assertEquals(0, store.loads)
        assertEquals("sip.exemplo.com.br", model.state.value.server)
        assertEquals(Transport.TCP, model.state.value.transport)
        assertEquals("2001", model.state.value.ramal)
    }

    @Test
    fun `account refused by the engine fails at once`() {
        gateway.accepts = false
        val model = model()
        model.fill("sip.exemplo.com.br", "2001", "senha-certa")
        model.submit()
        assertEquals("registro 0", model.state.value.message)
        assertFalse(model.state.value.loading)
        assertNull(store.account)
        clock.advance(15_000)   // o tempo de espera já foi desmarcado
        assertEquals(1, gateway.removals)
    }

    @Test
    fun `a result that arrives before setAccount returns still counts`() {
        val model = model()
        // O motor avisa o registro antes de o setAccount voltar com o id.
        gateway.duringSetAccount = { id -> model.onRegistration(200, true, id) }
        model.fill("sip.exemplo.com.br", "2001", "senha-certa")
        model.submit()
        assertTrue(model.state.value.done)
        assertEquals(Account("sip.exemplo.com.br", Transport.UDP, "2001", "senha-certa"), store.account)
    }

    @Test
    fun `edit keeps server, protocol and ramal and clears the password`() {
        store.account = Account("sip.exemplo.com.br", Transport.TCP, "2001", "antiga")
        val state = model().state.value
        assertEquals("sip.exemplo.com.br", state.server)
        assertEquals(Transport.TCP, state.transport)
        assertEquals("2001", state.ramal)
        assertEquals("", state.senha)
        assertEquals("", state.message)
    }

    @Test
    fun `edit that fails restores the previous account`() {
        val previous = Account("sip.exemplo.com.br", Transport.TCP, "2001", "antiga")
        store.account = previous
        val model = model()
        model.onSenhaChange("nova")
        model.submit()
        assertEquals(AccountCall("sip.exemplo.com.br", Transport.TCP, "2001", "nova"), gateway.accounts.last())
        model.onRegistration(403, false, gateway.lastId)
        assertEquals("registro 403", model.state.value.message)
        assertEquals(AccountCall("sip.exemplo.com.br", Transport.TCP, "2001", "antiga"), gateway.accounts.last())
        assertEquals(2, gateway.accounts.size)
        assertEquals(0, gateway.removals)
        assertEquals(previous, store.account)
        assertEquals(0, store.saves)
    }

    @Test
    fun `a late result of the previous account does not commit the next attempt`() {
        val previous = Account("sip.exemplo.com.br", Transport.TCP, "2001", "antiga")
        store.account = previous
        val model = model()
        // Tentativa 1: o servidor recusa, e a conta anterior volta ao motor (com um id novo).
        model.onSenhaChange("errada-1")
        model.submit()
        model.onRegistration(403, false, gateway.lastId)
        val restored = gateway.lastId
        assertFalse(model.state.value.loading)
        // Tentativa 2: o registro da conta que voltou ainda estava a caminho. A resposta dele chega antes de
        // o setAccount da tentativa 2 voltar e também depois; nenhuma das duas é da tentativa 2.
        model.onSenhaChange("errada-2")
        gateway.duringSetAccount = { model.onRegistration(200, true, restored) }
        model.submit()
        gateway.duringSetAccount = null
        val attempt2 = gateway.lastId
        model.onRegistration(200, true, restored)
        assertTrue(model.state.value.loading)
        assertFalse(model.state.value.done)
        assertEquals(previous, store.account)
        // A resposta da própria tentativa 2.
        model.onRegistration(403, false, attempt2)
        assertEquals("registro 403", model.state.value.message)
        assertFalse(model.state.value.done)
        assertEquals(previous, store.account)
        assertEquals(0, store.saves)
        assertEquals(AccountCall("sip.exemplo.com.br", Transport.TCP, "2001", "antiga"), gateway.accounts.last())
    }
}

/** O núcleo falso: os avisos dizem de onde vieram, para o teste ver que a tela usa os do núcleo. */
private class FakeCore : CoreRules {
    override fun validateServer(raw: String): Pair<Check, String> {
        val text = raw.trim()
        return when {
            text.isEmpty() -> Check.EMPTY to "servidor vazio"
            text.contains(':') || text.contains(' ') -> Check.INVALID to "servidor inválido"
            else -> Check.OK to text.lowercase()
        }
    }

    override fun validateRamal(raw: String): Pair<Check, String> {
        val text = raw.trim()
        return when {
            text.isEmpty() -> Check.EMPTY to "ramal vazio"
            text.contains(' ') || text.contains('@') -> Check.INVALID to "ramal inválido"
            else -> Check.OK to text
        }
    }

    override fun registrationMessage(code: Int) = "registro $code"

    override fun callEndMessage(code: Int) = "fim $code"

    override fun normalizeDialString(raw: String) = raw
}

/** O LoginFlow falso, com as regras do LoginFlow do núcleo e os avisos do núcleo falso. */
private class FakeFlow(private val core: CoreRules) : LoginFlow {
    private var waiting = false
    private var done = false

    override fun start() {
        if (!waiting && !done) waiting = true
    }

    override fun onRegistration(code: Int): LoginFlowHandle.Outcome? {
        if (!waiting || code in 100..199) return null
        waiting = false
        if (code in 200..299) {
            done = true
            return LoginFlowHandle.Outcome(commit = true, rollback = false, message = "")
        }
        return LoginFlowHandle.Outcome(commit = false, rollback = true, message = core.registrationMessage(code))
    }

    override fun onTimeout(): LoginFlowHandle.Outcome? {
        if (!waiting) return null
        waiting = false
        return LoginFlowHandle.Outcome(commit = false, rollback = true, message = core.registrationMessage(0))
    }

    override fun close() {
        waiting = false
    }
}

private data class AccountCall(val address: String, val transport: Transport, val ramal: String, val senha: String)

/** O motor falso: guarda as contas pedidas (cada uma recebe um id, 1, 2, 3...) e as saídas. */
private class FakeGateway : SipGateway {
    val accounts = mutableListOf<AccountCall>()
    var removals = 0
    var accepts = true
    var lastId = 0

    /** Roda dentro do setAccount, antes de ele voltar com o id (um aviso do motor que chega antes). */
    var duringSetAccount: ((Int) -> Unit)? = null

    override fun start(userAgent: String, profileText: String, events: EngineEvents) = true

    override fun stop() {}

    override fun setAccount(address: String, transport: Transport, ramal: String, senha: String): Int {
        accounts += AccountCall(address, transport, ramal, senha)
        if (!accepts) return 0
        val id = ++lastId
        duringSetAccount?.invoke(id)
        return id
    }

    override fun removeAccount() {
        removals++
    }

    override fun reregister() {}

    override fun handleIpChange() {}

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

private class FakeStore(var account: Account? = null) : AccountStore {
    var saves = 0
    var loads = 0

    override fun load(): Account? {
        loads++
        return account
    }

    override fun save(account: Account) {
        this.account = account
        saves++
    }

    override fun clear() {
        account = null
    }
}

/** O relógio falso: só anda com [advance], que roda na hora os avisos vencidos. */
private class FakeClock : Clock {
    private class Task(val at: Long, val action: () -> Unit)

    private var now = 0L
    private val tasks = mutableListOf<Task>()

    override fun nowMillis() = now

    override fun schedule(delayMillis: Long, action: () -> Unit): Scheduled {
        val task = Task(now + delayMillis, action)
        tasks += task
        return Scheduled { tasks.remove(task) }
    }

    fun advance(millis: Long) {
        now += millis
        while (true) {
            val due = tasks.filter { it.at <= now }.minByOrNull { it.at } ?: return
            tasks.remove(due)
            due.action()
        }
    }
}
