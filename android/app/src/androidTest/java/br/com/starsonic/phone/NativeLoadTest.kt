package br.com.starsonic.phone

import androidx.test.ext.junit.runners.AndroidJUnit4
import br.com.starsonic.phone.core.LoginFlowHandle
import br.com.starsonic.phone.core.NativeCoreRules
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/** A libstarsonic.so carrega no aparelho e o núcleo responde pela ponte JNI, com o texto intacto. */
@RunWith(AndroidJUnit4::class)
class NativeLoadTest {
    @Test
    fun validateServerTrimsAndLowercases() {
        assertArrayEquals(
            arrayOf("ok", "starcloud1-starsonic.com.br"),
            Native.validateServer(" Starcloud1-Starsonic.com.br "),
        )
        assertArrayEquals(
            arrayOf("invalid", "Digite só o endereço do servidor, como starcloud1-starsonic.com.br."),
            Native.validateServer("servidor:5060"),
        )
        assertArrayEquals(arrayOf("empty", "Digite o endereço do servidor."), Native.validateServer(" "))
    }

    @Test
    fun validateRamalTrims() {
        assertArrayEquals(arrayOf("ok", "2001"), Native.validateRamal(" 2001 "))
        assertArrayEquals(arrayOf("empty", "Digite só o número do ramal."), Native.validateRamal("  "))
        assertArrayEquals(arrayOf("invalid", "Digite só o número do ramal."), Native.validateRamal("20 01"))
    }

    @Test
    fun registrationMessageComesFromTheCore() {
        assertEquals("Ramal ou senha incorretos.", Native.registrationMessage(403))
    }

    @Test
    fun callEndMessageComesFromTheCore() {
        assertEquals("Ocupado", Native.callEndMessage(486))
        assertEquals("Número não encontrado", Native.callEndMessage(404))
    }

    @Test
    fun loginFlowFollowsTheCore() {
        val confirmed = LoginFlowHandle(NativeCoreRules)
        try {
            assertNull(confirmed.onRegistration(200))   // antes de começar a esperar, nada vale
            confirmed.start()
            assertNull(confirmed.onRegistration(100))   // 1xx: continua esperando
            assertEquals(LoginFlowHandle.Outcome(commit = true, rollback = false, message = ""), confirmed.onRegistration(200))
            assertNull(confirmed.onRegistration(403))   // depois de confirmar, nada mais vale
            assertNull(confirmed.onTimeout())
        } finally {
            confirmed.close()
        }

        val failed = LoginFlowHandle(NativeCoreRules)
        failed.start()
        assertEquals(
            LoginFlowHandle.Outcome(commit = false, rollback = true, message = "Ramal ou senha incorretos."),
            failed.onRegistration(403),
        )
        assertNull(failed.onTimeout())   // a falha já encerrou a espera
        failed.start()                   // uma tentativa nova depois da falha
        assertEquals(
            LoginFlowHandle.Outcome(
                commit = false,
                rollback = true,
                message = "Não foi possível falar com o servidor. Confira o endereço e a sua internet.",
            ),
            failed.onTimeout(),
        )
        assertNull(failed.onRegistration(200))   // o resultado que chega depois do tempo é ignorado
        failed.close()
        failed.start()
        assertNull(failed.onRegistration(200))   // depois do close, nada vale (e nada quebra)
    }

    @Test
    fun profileTransportComesFromTheProfile() {
        assertEquals("udp", Native.profileTransport("[conta]\nporta=5060\ntransporte=udp\n"))
        assertEquals("tcp", Native.profileTransport("[conta]\nporta=5060\ntransporte=tcp\n"))
        assertEquals("", Native.profileTransport("[conta]\ntransporte=tcp\n"))   // sem a porta: perfil inválido
    }

    @Test
    fun textCrossesTheBridgeUnchanged() {
        // UTF-16 do Java -> wchar_t de 32 bits -> UTF-16, com um caractere fora do plano básico (par substituto).
        val emoji = String(Character.toChars(0x1F600))
        assertEquals("+551150603000", Native.normalizeDialString("+55 (11) 5060-3000"))
        assertEquals("ç${emoji}#", Native.normalizeDialString("ç $emoji #"))
    }
}
