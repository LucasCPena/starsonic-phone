package br.com.starsonic.phone.data

import android.content.SharedPreferences

/**
 * O SharedPreferences na memória, como o do Android: commit() e apply() mudam a memória na hora. Guarda textos,
 * booleanos e inteiros (os tipos que as gravações do app usam); os outros tipos ficam de fora.
 */
internal class FakePreferences : SharedPreferences {
    val values = HashMap<String, Any?>()

    /** O disco falha: commit() devolve false (a memória já mudou). */
    var diskFails = false

    override fun getAll(): MutableMap<String, *> = HashMap(values)

    override fun getString(key: String?, defValue: String?): String? = values[key] as String? ?: defValue

    override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? = defValues

    override fun getInt(key: String?, defValue: Int): Int = values[key] as Int? ?: defValue

    override fun getLong(key: String?, defValue: Long): Long = defValue

    override fun getFloat(key: String?, defValue: Float): Float = defValue

    override fun getBoolean(key: String?, defValue: Boolean): Boolean = values[key] as Boolean? ?: defValue

    override fun contains(key: String?): Boolean = values.containsKey(key)

    override fun edit(): SharedPreferences.Editor = Editor()

    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}

    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}

    private inner class Editor : SharedPreferences.Editor {
        private val changes = LinkedHashMap<String, Any?>()   // null: remove
        private var clearAll = false

        override fun putString(key: String?, value: String?): SharedPreferences.Editor = also { changes[key!!] = value }

        override fun putStringSet(key: String?, values: MutableSet<String>?): SharedPreferences.Editor = this

        override fun putInt(key: String?, value: Int): SharedPreferences.Editor = also { changes[key!!] = value }

        override fun putLong(key: String?, value: Long): SharedPreferences.Editor = this

        override fun putFloat(key: String?, value: Float): SharedPreferences.Editor = this

        override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor = also { changes[key!!] = value }

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

/** A cifra falsa: inverte a senha (a de verdade usa o Android Keystore, que não existe na JVM). */
internal class FakeSeal : PasswordSeal {
    override fun encrypt(senha: String): String = "selada:" + senha.reversed()

    override fun decrypt(text: String): String? = text.removePrefix("selada:").reversed()
}
