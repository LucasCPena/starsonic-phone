package br.com.starsonic.phone

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import br.com.starsonic.phone.core.LoginFlowHandle
import br.com.starsonic.phone.core.Manifest
import br.com.starsonic.phone.core.NativeCoreRules
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
    fun contactDialStringComesFromTheCore() {
        // O número de um contato do aparelho: o +55 sai, e o prefixo externo entra na frente (mais de 6 dígitos).
        assertEquals("01150603000", Native.contactDialString("+55 (11) 5060-3000", "55", "0"))
        assertEquals("01150603000", NativeCoreRules.contactDialString("+55 (11) 5060-3000", "55", "0"))
        assertEquals("2003", Native.contactDialString("20-03", "55", "0"))   // ramal: sem o prefixo

        // O ddi e o prefixo externo do perfil do APK (branding/perfil.ini, nos assets): 55 e nenhum.
        val profile = ApplicationProvider.getApplicationContext<App>().profileText
        assertArrayEquals(arrayOf("55", ""), Native.profileDial(profile))
        assertEquals("55" to "", NativeCoreRules.profileDial(profile))
        assertArrayEquals(arrayOf("351", "0"), Native.profileDial("[conta]\nporta=5060\nddi=351\nprefixo_externo=0\n"))
        assertArrayEquals(arrayOf("", ""), Native.profileDial("[conta]\nddi=55\n"))   // sem a porta: perfil inválido
    }

    @Test
    fun manifestIsReadByTheCore() {
        val prefix = "https://github.com/LucasCPena/starsonic-phone/releases/download/android-v"
        val apk = "${prefix}0.1.0-rc.2/StarsonicPhone-android-0.1.0-rc.2.apk"
        val emoji = String(Character.toChars(0x1F600))
        val notes = "Correção de áudio $emoji"
        val json = """{"versao":"0.1.0-rc.2","instalador":"$apk","sha256":"${"AB".repeat(32)}","notas":"$notes"}"""
        assertArrayEquals(arrayOf("", "0.1.0-rc.2", apk, "ab".repeat(32), notes), Native.parseManifest(json, prefix))
        assertEquals(Manifest("0.1.0-rc.2", apk, "ab".repeat(32), notes), NativeCoreRules.parseManifest(json, prefix))

        // Fora do endereço permitido (o instalador do Windows) ou um JSON que não vale: null, com o motivo do núcleo.
        val reasons = mutableListOf<String>()
        val windows = json.replace("android-v0.1.0-rc.2/StarsonicPhone-android-0.1.0-rc.2.apk", "v1.0.1/StarsonicPhone-1.0.1-setup.exe")
        assertNull(NativeCoreRules.parseManifest(windows, prefix) { reasons += it })
        assertNull(NativeCoreRules.parseManifest("{", prefix) { reasons += it })
        assertEquals(2, reasons.size)
        assertTrue(reasons[0], reasons[0].startsWith("versao.json: instalador fora do endereco permitido"))
        assertEquals("versao.json: JSON invalido", reasons[1])
        assertArrayEquals(arrayOf("versao.json: JSON invalido", "", "", "", ""), Native.parseManifest("{", prefix))

        // As notas passam de 500 caracteres: o núcleo corta e põe "…".
        val long = NativeCoreRules.parseManifest(json.replace(notes, "a".repeat(600)), prefix)
        assertEquals("a".repeat(500) + "…", long?.notes)
    }

    @Test
    fun versionsAreComparedByTheCore() {
        assertTrue(NativeCoreRules.compareVersions("0.1.1", "0.1.0") > 0)
        assertTrue(NativeCoreRules.compareVersions("0.1.0", "0.1.1") < 0)
        assertTrue(NativeCoreRules.compareVersions("0.1.0", "0.1.0-rc.9") > 0)
        assertTrue(NativeCoreRules.compareVersions("0.1.0-rc.1", "0.1.0-rc.2") < 0)
        assertTrue(NativeCoreRules.compareVersions("9.9.9", "0.0.0") > 0)
        assertEquals(0, NativeCoreRules.compareVersions("0.1.0-rc.2", "0.1.0-rc.2"))
        // Um texto que não é versão não tem ordem: 0, e nada é oferecido.
        assertEquals(0, NativeCoreRules.compareVersions("9.9.9", "dev"))
        assertEquals(0, NativeCoreRules.compareVersions("", "0.1.0"))
    }

    @Test
    fun textCrossesTheBridgeUnchanged() {
        // UTF-16 do Java -> wchar_t de 32 bits -> UTF-16, com um caractere fora do plano básico (par substituto).
        val emoji = String(Character.toChars(0x1F600))
        assertEquals("+551150603000", Native.normalizeDialString("+55 (11) 5060-3000"))
        assertEquals("ç${emoji}#", Native.normalizeDialString("ç $emoji #"))
    }
}
