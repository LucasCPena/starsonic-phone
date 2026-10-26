package br.com.starsonic.phone.data

import br.com.starsonic.phone.engine.Transport
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A conta no SharedPreferences, com um falso que se comporta como o do Android ([FakePreferences]): o commit() muda a
 * memória antes de gravar o disco, e a falha do disco (commit() devolve false) não desfaz a memória.
 */
class PreferencesAccountStoreTest {
    private val preferences = FakePreferences()
    private val store = PreferencesAccountStore(preferences, FakeSeal())
    private val old = Account("sip.exemplo.com.br", Transport.TCP, "2001", "antiga")

    @Test
    fun `a save that fails on the disk puts the previous account back in memory`() {
        store.save(old)
        preferences.diskFails = true
        val failed = runCatching { store.save(Account("outro.exemplo.com.br", Transport.UDP, "2002", "nova")) }
        assertTrue("o save lança a falha do disco", failed.exceptionOrNull() is IOException)
        assertEquals("quem lê depois acha a conta anterior", old, store.load())
    }

    @Test
    fun `a first save that fails on the disk leaves no account in memory`() {
        preferences.diskFails = true
        val failed = runCatching { store.save(old) }
        assertTrue("o save lança a falha do disco", failed.exceptionOrNull() is IOException)
        assertNull("quem lê depois não acha conta", store.load())
        assertTrue("nada sobra na memória: ${preferences.values}", preferences.values.isEmpty())
    }

    @Test
    fun `a save that works is read back`() {
        store.save(old)
        assertEquals(old, store.load())
        store.clear()
        assertNull(store.load())
    }
}
