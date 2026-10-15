package br.com.starsonic.phone.service

import br.com.starsonic.phone.call.CallEvents
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.engine.Transport
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A conexão do processo: um motor só, a conta que o serviço segura (a que a tela Entrar registrou fica, com o
 * mesmo id) e o status, que só usa os resultados do registro dessa conta. As trocas de conta vão em ordem,
 * numa thread da conexão; o motor falso, como o de verdade, tira uma conta só quando chega a vez do pedido.
 */
class ConnectionTest {
    private val engine = FakeEngine()
    private val connection = Connection({ engine }, FakeCore(), "Starsonic Phone Android/0.0.0", { "[conta]" })
    private val account = Account("sip.exemplo.com.br", Transport.TCP, "2001", "senha-certa")
    private val service = Any()   // o serviço de pé (o dono da conta)

    private val connected = Status("Conectado · 2001", "Conectado (ramal 2001)")
    private val connecting = Status("Conectando…", "Conectando…")

    // A tela Entrar registra uma conta (a tentativa, ou a anterior de volta depois de uma falha).
    private fun login(account: Account): Int =
        connection.setAccount(account.address, account.transport, account.ramal, account.senha)

    @Test
    fun `registered follows the service account and the network`() {
        connection.claim(service)
        connection.adopt(service, account)
        assertFalse("sem resposta ainda", connection.registered.value)
        engine.registration(200, true)
        assertTrue(connection.registered.value)
        connection.setOnline(service, false)
        assertFalse("sem rede", connection.registered.value)
        connection.setOnline(service, true)
        assertTrue(connection.registered.value)
        engine.registration(403, false)
        assertFalse(connection.registered.value)
        engine.registration(200, true)
        connection.release(service)
        assertFalse("o serviço parou", connection.registered.value)
    }

    @Test
    fun `call events go to the calls`() {
        val seen = mutableListOf<String>()
        val calls = object : CallEvents {
            override fun onIncoming(callId: Int, number: String, name: String) {
                seen += "incoming $callId $number $name"
            }

            override fun onRejectedBusy(number: String, name: String) {
                seen += "busy $number $name"
            }

            override fun onCallState(callId: Int, state: Int, code: Int) {
                seen += "state $callId $state $code"
            }
        }
        val withCalls = Connection({ engine }, FakeCore(), "Starsonic Phone Android/0.0.0", { "[conta]" }, calls = { calls })
        assertTrue(withCalls.ensureStarted())
        engine.callEvents().onIncomingCall(1, "3001", "Cliente Teste")
        engine.callEvents().onRejectedBusy("3002", "")
        engine.callEvents().onCallState(1, 4, 200)
        assertEquals(listOf("incoming 1 3001 Cliente Teste", "busy 3002 ", "state 1 4 200"), seen)
    }

    @Test
    fun `the engine starts once per process`() {
        assertTrue(connection.ensureStarted())
        assertTrue(connection.ensureStarted())
        login(account)   // a tela Entrar registra com o motor que já subiu
        assertEquals(1, engine.starts)
    }

    @Test
    fun `the service adopts the account the login registered without another REGISTER`() {
        // A tela Entrar registra a conta, o servidor aceita, e só depois o serviço começa.
        val id = login(account)
        engine.registration(200, true, id)
        connection.claim(service)
        assertEquals(connecting, connection.status.value)
        assertEquals(Adoption.KEPT, connection.adopt(service, account))
        assertEquals(1, engine.accounts.size)   // nenhum setAccount a mais
        assertEquals(connected, connection.status.value)   // o último resultado da conta já vale
    }

    @Test
    fun `the service registers the saved account when the engine does not have it`() {
        connection.claim(service)
        assertEquals(Adoption.REGISTERED, connection.adopt(service, account))
        assertEquals(listOf(account), engine.accounts)
        assertEquals(connecting, connection.status.value)
        engine.registration(200, true)
        assertEquals(connected, connection.status.value)
    }

    @Test
    fun `the service replaces the account it put itself when the saved account changes`() {
        connection.claim(service)
        connection.adopt(service, account.copy(senha = "antiga"))
        assertEquals(Adoption.REGISTERED, connection.adopt(service, account))
        assertEquals(account, engine.accounts.last())
        assertEquals(2, engine.accounts.size)
    }

    @Test
    fun `a result that arrives before setAccount returns counts`() {
        connection.claim(service)
        engine.duringSetAccount = { id -> engine.registration(200, true, id) }
        assertEquals(Adoption.REGISTERED, connection.adopt(service, account))
        assertEquals(connected, connection.status.value)
    }

    @Test
    fun `results of another account do not change the status`() {
        connection.claim(service)
        connection.adopt(service, account.copy(senha = "antiga"))   // uma conta anterior, que o serviço troca
        val previous = engine.lastId
        connection.adopt(service, account)
        engine.registration(200, true)
        val id = engine.lastId
        engine.registration(503, false, previous)   // atrasado, da conta que já saiu
        engine.registration(403, false, id + 1)     // de uma conta que não é a do serviço
        assertEquals(connected, connection.status.value)
        engine.registration(403, false, id)   // da conta do serviço
        assertEquals(Status("Ramal ou senha incorretos.", "Ramal ou senha incorretos."), connection.status.value)
    }

    @Test
    fun `the status follows the saved account when a login attempt puts it back`() {
        // Com o serviço de pé, uma tentativa de outra conta (Editar) falha e a conta gravada volta ao motor
        // com um id novo: o status segue a conta gravada, pelo id novo.
        connection.claim(service)
        connection.adopt(service, account)
        engine.registration(200, true)
        val attempt = login(account.copy(senha = "nova"))
        assertEquals(connecting, connection.status.value)
        engine.registration(403, false, attempt)
        assertEquals(connecting, connection.status.value)
        val restored = login(account)
        engine.registration(200, true, restored)
        assertEquals(connected, connection.status.value)
    }

    @Test
    fun `a service start during a login attempt keeps the attempt and then adopts the new account`() {
        // Editar: o serviço segura a conta gravada, e a tela Entrar tenta outra senha. No meio, o serviço
        // começa de novo (volta ao app, tela acesa, recriação): a conta tentada fica no motor.
        connection.claim(service)
        connection.adopt(service, account)
        engine.registration(200, true)
        val newer = account.copy(senha = "nova")
        val attempt = login(newer)
        assertEquals(Adoption.WAITING, connection.adopt(service, account))
        assertEquals(listOf(account, newer), engine.accounts)
        assertEquals(connecting, connection.status.value)
        // O servidor aceita a tentada, a tela grava a nova (commit) e inicia o serviço, que lê a nova.
        engine.registration(200, true, attempt)
        assertEquals(Adoption.KEPT, connection.adopt(service, newer))
        assertEquals(connected, connection.status.value)
        assertEquals(2, engine.accounts.size)   // nenhum REGISTER a mais
    }

    @Test
    fun `a service start during a login attempt keeps the attempt and then follows the rollback`() {
        connection.claim(service)
        connection.adopt(service, account)
        engine.registration(200, true)
        val attempt = login(account.copy(senha = "errada"))
        assertEquals(Adoption.WAITING, connection.adopt(service, account))
        // O servidor recusa a tentada, e a tela põe a conta gravada de volta (outro id).
        engine.registration(403, false, attempt)
        val restored = login(account)
        engine.registration(200, true, restored)
        assertEquals(connected, connection.status.value)
        assertEquals(3, engine.accounts.size)   // a gravada, a tentada e a de volta: nada do serviço
        assertEquals(Adoption.KEPT, connection.adopt(service, account))   // um início depois: nada a mais
        assertEquals(3, engine.accounts.size)
    }

    @Test
    fun `a service start while the attempt is still registering waits for it`() {
        connection.claim(service)
        connection.adopt(service, account)
        engine.registration(200, true)
        val inEngine = CountDownLatch(1)
        val proceed = CountDownLatch(1)
        engine.duringSetAccount = {
            inEngine.countDown()
            proceed.await(5, TimeUnit.SECONDS)
        }
        val newer = account.copy(senha = "nova")
        val attempt = thread { login(newer) }   // a tentativa ainda está no motor
        assertTrue(inEngine.await(5, TimeUnit.SECONDS))
        engine.duringSetAccount = null
        var adoption: Adoption? = null
        val start = thread { adoption = connection.adopt(service, account) }
        start.join(300)
        val waited = start.isAlive
        proceed.countDown()
        attempt.join(5_000)
        start.join(5_000)
        assertTrue("o início do serviço espera a troca de conta da tentativa", waited)
        assertEquals(Adoption.WAITING, adoption)
        assertEquals(listOf(account, newer), engine.accounts)
    }

    @Test
    fun `a connect that read the old account before the save does not put it back`() {
        connection.claim(service)
        connection.adopt(service, account)
        engine.registration(200, true)
        val newer = account.copy(senha = "nova")
        val attempt = login(newer)
        engine.registration(200, true, attempt)   // o servidor aceita, e a tela grava a nova
        // Um início do serviço que leu a conta antiga antes de a tela gravar a nova chega agora.
        assertEquals(Adoption.WAITING, connection.adopt(service, account))
        assertEquals(listOf(account, newer), engine.accounts)
        // O início seguinte lê a nova: fica com ela, com o mesmo id.
        assertEquals(Adoption.KEPT, connection.adopt(service, newer))
        assertEquals(connected, connection.status.value)
        assertEquals(2, engine.accounts.size)
    }

    @Test
    fun `a waiting service registers the saved account when the attempt leaves the engine empty`() {
        connection.claim(service)
        connection.adopt(service, account)
        login(account.copy(senha = "nova"))
        assertEquals(Adoption.WAITING, connection.adopt(service, account))
        connection.removeAccount()   // a tentativa desfeita sem conta anterior no motor
        connection.awaitChanges()
        assertEquals(account, engine.accounts.last())
        assertEquals(3, engine.accounts.size)
    }

    @Test
    fun `stopping the service removes its account`() {
        connection.claim(service)
        connection.adopt(service, account)
        engine.registration(200, true)
        connection.release(service)
        connection.awaitChanges()
        assertEquals(1, engine.removals)
        assertEquals(connecting, connection.status.value)
        // O próximo serviço registra de novo: a conta já não está no motor.
        val next = Any()
        connection.claim(next)
        assertEquals(Adoption.REGISTERED, connection.adopt(next, account))
        assertEquals(2, engine.accounts.size)
    }

    @Test
    fun `stopping and starting the service right away registers the account again`() {
        // O motor tira a conta só quando chega a vez do pedido: o serviço que começa logo depois não pode
        // contar com a conta que está saindo.
        connection.claim(service)
        connection.adopt(service, account)
        engine.registration(200, true)
        connection.release(service)
        val next = Any()
        connection.claim(next)
        assertEquals(Adoption.REGISTERED, connection.adopt(next, account))
        engine.flush()
        engine.registration(200, true)
        assertEquals(connected, connection.status.value)
        assertEquals(2, engine.accounts.size)
        assertEquals(1, engine.removals)
        assertEquals(engine.lastId, engine.current)
    }

    @Test
    fun `a service that stopped while registering does not leave the account`() {
        connection.claim(service)
        engine.duringSetAccount = { connection.release(service) }   // o serviço para no meio do registro
        assertEquals(Adoption.STOPPED, connection.adopt(service, account))
        connection.awaitChanges()
        engine.flush()
        assertEquals(1, engine.removals)
        assertEquals(0, engine.current)
    }

    @Test
    fun `the cleanup of a service that stopped while registering keeps the next account`() {
        // O serviço para no meio do registro e, na mesma hora, a tela Entrar registra outra conta: a limpeza da
        // conta do serviço vai antes da troca da tela, e a conta da tela fica no motor.
        connection.claim(service)
        val newer = account.copy(senha = "nova")
        val entered = CountDownLatch(1)
        val proceed = CountDownLatch(1)
        var attempt: Thread? = null
        engine.duringSetAccount = { id ->
            if (id == 1) {
                connection.release(service)
                attempt = thread { login(newer) }
                entered.await(1, TimeUnit.SECONDS)   // sem a ordem das trocas, a da tela entraria aqui
            } else {
                entered.countDown()
                proceed.await(5, TimeUnit.SECONDS)
            }
        }
        assertEquals(Adoption.STOPPED, connection.adopt(service, account))
        proceed.countDown()
        attempt!!.join(5_000)
        connection.awaitChanges()
        engine.flush()
        assertEquals(newer, engine.accounts.last())
        assertEquals("a conta da tela Entrar fica no motor", engine.lastId, engine.current)
        assertEquals(1, engine.removals)
    }

    @Test
    fun `a stopped service does not adopt`() {
        connection.claim(service)
        connection.release(service)
        assertEquals(Adoption.STOPPED, connection.adopt(service, account))
        assertTrue(engine.accounts.isEmpty())
    }

    @Test
    fun `offline shows Sem internet`() {
        connection.claim(service)
        connection.adopt(service, account)
        engine.registration(200, true)
        connection.setOnline(service, false)
        assertEquals(Status("Sem internet", "Sem internet"), connection.status.value)
        connection.setOnline(service, true)
        assertEquals(connected, connection.status.value)
    }

    @Test
    fun `the network of a stopped service does not count`() {
        // O aviso da rede de um serviço que já parou chega atrasado: o próximo serviço não fica "Sem internet".
        connection.claim(service)
        connection.adopt(service, account)
        connection.release(service)
        connection.setOnline(service, false)
        val next = Any()
        connection.claim(next)
        connection.adopt(next, account)
        engine.registration(200, true)
        assertEquals(connected, connection.status.value)
    }

    @Test
    fun `a network change shows Conectando until the new registration`() {
        connection.claim(service)
        connection.adopt(service, account)
        engine.registration(200, true)
        connection.handleIpChange()
        assertEquals(1, engine.ipChanges)
        assertEquals(connecting, connection.status.value)
        engine.registration(200, true)
        assertEquals(connected, connection.status.value)
    }

    @Test
    fun `the login screen gets every registration result`() {
        val seen = mutableListOf<Triple<Int, Boolean, Int>>()
        connection.loginEvents = { code, active, id -> seen += Triple(code, active, id) }
        val id = login(account)
        engine.registration(403, false, id)
        connection.removeAccount()
        connection.awaitChanges()
        engine.flush()
        assertEquals(listOf(Triple(403, false, id), Triple(200, false, id)), seen)
    }
}
