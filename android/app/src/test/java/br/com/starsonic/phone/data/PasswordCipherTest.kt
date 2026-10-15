package br.com.starsonic.phone.data

import java.security.KeyStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A senha cifrada pelo Android Keystore: a que não abre vai ao log (o motivo, nunca a senha). */
class PasswordCipherTest {
    @Test
    fun `a password that does not open goes to the log`() {
        // Na JVM não há o Android Keystore: a senha gravada não abre, como num celular que perdeu a chave.
        val lines = mutableListOf<String>()
        assertNull(PasswordCipher(log = { lines += it }).decrypt("AAAAAAAAAAAAAAAAAAAAAAAA"))
        assertEquals(lines.toString(), 1, lines.size)
    }

    @Test
    fun `a password whose key is not in the Keystore goes to the log`() {
        // Um Keystore que abre, mas sem a chave da senha (no celular, uma chave que sumiu).
        val lines = mutableListOf<String>()
        val empty = { KeyStore.getInstance("PKCS12").apply { load(null, null) } }
        assertNull(PasswordCipher(log = { lines += it }, keyStore = empty).decrypt("AAAAAAAAAAAAAAAAAAAAAAAA"))
        assertEquals(lines.toString(), 1, lines.size)
        assertTrue(lines.single(), "a chave dela não está no Keystore" in lines.single())
    }
}
