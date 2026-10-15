package br.com.starsonic.phone.data

import android.content.SharedPreferences
import br.com.starsonic.phone.engine.Transport
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A conta no SharedPreferences, com um falso que se comporta como o do Android: o commit() muda a memória antes de
 * gravar o disco, e a falha do disco (commit() devolve false) não desfaz a memória.
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

/** A cifra falsa: inverte a senha (a de verdade usa o Android Keystore, que não existe na JVM). */
private class FakeSeal : PasswordSeal {
    override fun encrypt(senha: String): String = "selada:" + senha.reversed()

    override fun decrypt(text: String): String? = text.removePrefix("selada:").reversed()
}

/** O SharedPreferences na memória, como o do Android: commit() e apply() mudam a memória na hora. */
private class FakePreferences : SharedPreferences {
    val values = HashMap<String, Any?>()

    /** O disco falha: commit() devolve false (a memória já mudou). */
    var diskFails = false

    override fun getAll(): MutableMap<String, *> = HashMap(values)

    override fun getString(key: String?, defValue: String?): String? = values[key] as String? ?: defValue

    override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? = defValues

    override fun getInt(key: String?, defValue: Int): Int = defValue

    override fun getLong(key: String?, defValue: Long): Long = defValue

    override fun getFloat(key: String?, defValue: Float): Float = defValue

    override fun getBoolean(key: String?, defValue: Boolean): Boolean = defValue

    override fun contains(key: String?): Boolean = values.containsKey(key)

    override fun edit(): SharedPreferences.Editor = Editor()

    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}

    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}

    private inner class Editor : SharedPreferences.Editor {
        private val changes = LinkedHashMap<String, String?>()   // null: remove
        private var clearAll = false

        override fun putString(key: String?, value: String?): SharedPreferences.Editor = also { changes[key!!] = value }

        override fun putStringSet(key: String?, values: MutableSet<String>?): SharedPreferences.Editor = this

        override fun putInt(key: String?, value: Int): SharedPreferences.Editor = this

        override fun putLong(key: String?, value: Long): SharedPreferences.Editor = this

        override fun putFloat(key: String?, value: Float): SharedPreferences.Editor = this

        override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor = this

        override fun remove(key: String?): SharedPreferences.Editor = also { changes[key!!] = null }

        override fun clear(): SharedPreferences.Editor = also { clearAll = true }

        override fun commit(): Boolean {
            toMemory()
            return !diskFails
        }

        override fun apply() {
            toMemory()
        }

        private fun toMemory() {
            if (clearAll) values.clear()
            for ((key, value) in changes) if (value == null) values.remove(key) else values[key] = value
        }
    }
}
