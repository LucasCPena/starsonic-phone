package br.com.starsonic.phone.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
}
