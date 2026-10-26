package br.com.starsonic.phone

import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.main.MainActivity
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * A tela Entrar no emulador, com o motor de verdade e o registrador falso do CI (ver [Emulator]).
 *
 * Os testes rodam em ordem alfabética, e o último REGISTER que o registrador aceita é o do teste da senha
 * com acento, por TCP: o CI confere no fim o User-Agent e que o protocolo do último registro foi o TCP (as
 * classes que vêm depois também registram por TCP).
 *
 * Depois de um Entrar, o app inicia o SipService, que fica com a conta: cada teste começa parando o serviço.
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class LoginScreenTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val emulator = Emulator(compose)
    private val app = emulator.app
    private lateinit var scenario: ActivityScenario<MainActivity>

    @Before
    fun openEntrar() {
        // Sem conta gravada o app abre na tela Entrar.
        emulator.startClean()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        // A tela aparece depois de o app ler a conta gravada, fora da thread principal.
        emulator.waitUntil("a tela Entrar") { compose.onAllNodesWithTag("entrar").fetchSemanticsNodes().isNotEmpty() }
        // O cabeçalho do visual do Windows (spec 10).
        assertTrue("o rótulo do cabeçalho", emulator.showsText("Ramal no celular"))
        assertTrue("o título do cabeçalho", emulator.showsText("Entre com o seu ramal"))
    }

    @After
    fun closeApp() {
        scenario.close()
    }

    @Test
    fun emptyFieldsShowTheMessagesInOrder() {
        clickEntrar()
        emulator.waitForText("Digite o endereço do servidor.")
        type("servidor", emulator.registrar)
        clickEntrar()
        emulator.waitForText("Digite só o número do ramal.")
        type("ramal", "2001")
        clickEntrar()
        emulator.waitForText("Digite a senha.")
    }

    @Test
    fun serverWithPortShowsTheAddressMessage() {
        type("servidor", "${emulator.registrar}:5060")
        type("ramal", "2001")
        type("senha", emulator.senha)
        clickEntrar()
        emulator.waitForText("Digite só o endereço do servidor, como starcloud1-starsonic.com.br.")
    }

    @Test
    fun ramalWithASpaceShowsTheRamalMessage() {
        type("servidor", emulator.registrar)
        type("ramal", "20 01")
        type("senha", emulator.senha)
        clickEntrar()
        emulator.waitForText("Digite só o número do ramal.")
    }

    @Test
    fun wrongPasswordShowsTheCoreMessage() {
        login("senha-errada")
        emulator.waitForText("Ramal ou senha incorretos.")
    }

    @Test
    fun loginOverUdpShowsConectado() {
        login(emulator.senha)
        emulator.waitForText("Conectado · ${emulator.registrar}")
        // A conta ficou gravada, com a senha cifrada pelo Keystore e decifrada de volta.
        assertEquals(Account(emulator.registrar, Transport.UDP, "2001", emulator.senha), app.store.load())
    }

    @Test
    fun loginOverTcpShowsConectado() {
        login(emulator.senha, tcp = true)
        emulator.waitForText("Conectado · ${emulator.registrar}")
        assertEquals(Account(emulator.registrar, Transport.TCP, "2001", emulator.senha), app.store.load())
    }

    @Test
    fun loginWithAnAccentedPassword() {
        val accented = "Senha#ç"
        assertEquals("resposta a PASSWORD", "OK", emulator.control("PASSWORD $accented"))
        try {
            login(accented, tcp = true)
            emulator.waitForText("Conectado · ${emulator.registrar}")
        } finally {
            assertEquals("resposta a PASSWORD", "OK", emulator.control("PASSWORD ${emulator.senha}"))
        }
    }

    private fun login(password: String, tcp: Boolean = false) {
        type("servidor", emulator.registrar)
        // O Protocolo: o UDP do perfil já vem escolhido, e o TCP fica ao lado.
        compose.onNodeWithTag("protocolo-udp").assertIsSelected()
        if (tcp) {
            compose.onNodeWithTag("protocolo-tcp").performScrollTo().performClick()
            compose.onNodeWithTag("protocolo-tcp").assertIsSelected()
            compose.onNodeWithTag("protocolo-udp").assertIsNotSelected()
        }
        type("ramal", "2001")
        type("senha", password)
        clickEntrar()
    }

    private fun type(tag: String, text: String) {
        compose.onNodeWithTag(tag).performScrollTo().performTextInput(text)
    }

    private fun clickEntrar() {
        compose.onNodeWithTag("entrar").performScrollTo().performClick()
    }
}
