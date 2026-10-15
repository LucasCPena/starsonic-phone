package br.com.starsonic.phone.service

import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.engine.Transport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A conexão do processo: um motor só, a conta que o serviço segura (a que a tela Entrar registrou fica, com o
 * mesmo id) e o status, que só usa os resultados do registro dessa conta.
 */
class ConnectionTest {
    private val engine = FakeEngine()
    private val connection = Connection({ engine }, FakeCore(), "Starsonic Phone Android/0.0.0", { "[conta]" })
    private val account = Account("sip.exemplo.com.br", Transport.TCP, "2001", "senha-certa")
    private val service = Any()   // o serviço de pé (o dono da conta)

    private val connected = Status("Conectado · 2001", "Conectado (ramal 2001)")
    private val connecting = Status("Conectando…", "Conectando…")

    private fun login(account: Account): Int =
        connection.setAccount(account.address, account.transport, account.ramal, account.senha)

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
        assertTrue(connection.adopt(service, account))
        assertEquals(1, engine.accounts.size)   // nenhum setAccount a mais
        assertEquals(connected, connection.status.value)   // o último resultado da conta já vale
    }

    @Test
    fun `the service registers the saved account when the engine does not have it`() {
        connection.claim(service)
        assertTrue(connection.adopt(service, account))
        assertEquals(listOf(account), engine.accounts)
        assertEquals(connecting, connection.status.value)
        engine.registration(200, true)
        assertEquals(connected, connection.status.value)
    }

    @Test
    fun `another account in the engine is replaced by the saved one`() {
        login(account.copy(senha = "outra"))   // uma tentativa com outra senha ainda está no motor
        connection.claim(service)
        assertTrue(connection.adopt(service, account))
        assertEquals(account, engine.accounts.last())
        assertEquals(2, engine.accounts.size)
    }

    @Test
    fun `a result that arrives before setAccount returns counts`() {
        connection.claim(service)
        engine.duringSetAccount = { id -> engine.registration(200, true, id) }
        assertTrue(connection.adopt(service, account))
        assertEquals(connected, connection.status.value)
    }

    @Test
    fun `results of another account do not change the status`() {
        val previous = login(account.copy(senha = "antiga"))   // uma conta anterior, que o serviço troca
        connection.claim(service)
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
    fun `stopping the service removes its account`() {
        connection.claim(service)
        connection.adopt(service, account)
        engine.registration(200, true)
        connection.release(service)
        assertEquals(1, engine.removals)
        assertEquals(connecting, connection.status.value)
        // O próximo serviço registra de novo: a conta já não está no motor.
        val next = Any()
        connection.claim(next)
        assertTrue(connection.adopt(next, account))
        assertEquals(2, engine.accounts.size)
    }

    @Test
    fun `a service that stopped while registering does not leave the account`() {
        connection.claim(service)
        engine.duringSetAccount = { connection.release(service) }   // o serviço para no meio do registro
        assertFalse(connection.adopt(service, account))
        assertEquals(1, engine.removals)
    }

    @Test
    fun `a stopped service does not adopt`() {
        connection.claim(service)
        connection.release(service)
        assertFalse(connection.adopt(service, account))
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
        assertEquals(listOf(Triple(403, false, id), Triple(200, false, id)), seen)
    }
}
