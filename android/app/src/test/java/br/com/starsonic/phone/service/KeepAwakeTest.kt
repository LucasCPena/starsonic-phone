package br.com.starsonic.phone.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * O processador acordado (spec 7.2, item 6): só enquanto o serviço está com a conta gravada e há rede; o
 * serviço que para solta de vez.
 */
class KeepAwakeTest {
    /** O wake lock falso: anota se está preso e quantas vezes foi pego e solto. */
    private class FakeCpuLock : CpuLock {
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

    private val lock = FakeCpuLock()
    private val keepAwake = KeepAwake(lock)

    @Test
    fun `the processor stays awake while the service has the account and a network`() {
        assertFalse("sem conta, nada a manter", lock.held)
        keepAwake.setAccount(true)
        assertTrue(lock.held)
        assertTrue(keepAwake.isHeld)
        keepAwake.setAccount(true)   // um início do serviço de novo: o mesmo wake lock
        keepAwake.setOnline(true)
        assertEquals(1, lock.acquires)
    }

    @Test
    fun `without a network the processor sleeps and wakes again when the network returns`() {
        keepAwake.setAccount(true)
        keepAwake.setOnline(false)
        assertFalse(lock.held)
        assertFalse(keepAwake.isHeld)
        keepAwake.setOnline(true)
        assertTrue(lock.held)
        assertEquals(2, lock.acquires)
        assertEquals(1, lock.releases)
    }

    @Test
    fun `without a network from the start the processor sleeps until it comes`() {
        keepAwake.setOnline(false)
        keepAwake.setAccount(true)
        assertFalse(lock.held)
        keepAwake.setOnline(true)
        assertTrue(lock.held)
    }

    @Test
    fun `without the account the processor sleeps`() {
        keepAwake.setOnline(true)
        assertFalse(lock.held)
        keepAwake.setAccount(true)
        keepAwake.setAccount(false)   // o serviço não ficou com a conta
        assertFalse(lock.held)
        assertEquals(1, lock.releases)
    }

    @Test
    fun `a refused account keeps the processor awake and a stopped service does not`() {
        // Recusada (o motor não aceitou a conta, ou não subiu), a conta continua com o serviço, e a conexão pode
        // registrá-la depois sozinha (Connection.resumeOwned) sem avisar o serviço: o processador fica acordado.
        keepAwake.setAccount(true)
        keepAwake.setAdoption(Adoption.REFUSED)
        assertTrue(lock.held)
        keepAwake.setAdoption(Adoption.KEPT)
        assertTrue(lock.held)
        assertEquals(1, lock.acquires)
        keepAwake.setAdoption(Adoption.STOPPED)   // o serviço parou no meio
        assertFalse(lock.held)
    }

    @Test
    fun `after the service stops the processor sleeps for good`() {
        keepAwake.setAccount(true)
        keepAwake.close()
        assertFalse(lock.held)
        // Avisos atrasados (a rede, uma conta lida antes da parada) não pegam o wake lock de novo.
        keepAwake.setOnline(true)
        keepAwake.setAccount(true)
        assertFalse(lock.held)
        assertEquals(1, lock.acquires)
        assertEquals(1, lock.releases)
        keepAwake.close()   // parar de novo não solta o que já está solto
        assertEquals(1, lock.releases)
    }
}
