package br.com.starsonic.phone

import android.os.ParcelFileDescriptor
import android.os.SystemClock
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.printToString
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.main.MainActivity
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.Socket
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * A tela Entrar no emulador, com o motor de verdade e o registrador falso do CI rodando no computador
 * (tests/smoke/fake_registrar.py, ramal 2001; o emulador o vê em 10.0.2.2). Argumentos do am instrument:
 * registrar (o endereço do registrador), porta (a porta de controle dele) e senha (a senha que ele aceita).
 *
 * Os testes rodam em ordem alfabética, e o último REGISTER que o registrador aceita é o do teste da senha
 * com acento, por TCP: o CI confere depois o User-Agent e que o protocolo desse registro foi o TCP.
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class LoginScreenTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val app = ApplicationProvider.getApplicationContext<App>()
    private val arguments = InstrumentationRegistry.getArguments()
    private val registrar = arguments.getString("registrar") ?: "10.0.2.2"
    private val controlPort = (arguments.getString("porta") ?: "5070").toInt()
    private val senha = arguments.getString("senha") ?: "senha-certa"
    private lateinit var scenario: ActivityScenario<MainActivity>

    @Before
    fun openEntrar() {
        // Sem conta gravada o app abre na tela Entrar; a conta de um teste anterior sai do motor.
        app.store.clear()
        app.gateway.removeAccount()
        scenario = ActivityScenario.launch(MainActivity::class.java)
    }

    @After
    fun closeApp() {
        scenario.close()
    }

    @Test
    fun emptyFieldsShowTheMessagesInOrder() {
        clickEntrar()
        waitForText("Digite o endereço do servidor.")
        type("servidor", registrar)
        clickEntrar()
        waitForText("Digite só o número do ramal.")
        type("ramal", "2001")
        clickEntrar()
        waitForText("Digite a senha.")
    }

    @Test
    fun serverWithPortShowsTheAddressMessage() {
        type("servidor", "$registrar:5060")
        type("ramal", "2001")
        type("senha", senha)
        clickEntrar()
        waitForText("Digite só o endereço do servidor, como starcloud1-starsonic.com.br.")
    }

    @Test
    fun ramalWithASpaceShowsTheRamalMessage() {
        type("servidor", registrar)
        type("ramal", "20 01")
        type("senha", senha)
        clickEntrar()
        waitForText("Digite só o número do ramal.")
    }

    @Test
    fun wrongPasswordShowsTheCoreMessage() {
        login("senha-errada")
        waitForText("Ramal ou senha incorretos.")
    }

    @Test
    fun loginOverUdpShowsConectado() {
        login(senha)
        waitForText("Conectado · 2001")
        // A conta ficou gravada, com a senha cifrada pelo Keystore e decifrada de volta.
        assertEquals(Account(registrar, Transport.UDP, "2001", senha), app.store.load())
    }

    @Test
    fun loginOverTcpShowsConectado() {
        login(senha, tcp = true)
        waitForText("Conectado · 2001")
        assertEquals(Account(registrar, Transport.TCP, "2001", senha), app.store.load())
    }

    @Test
    fun loginWithAnAccentedPassword() {
        val accented = "Senha#ç"
        control("PASSWORD $accented")
        try {
            login(accented, tcp = true)
            waitForText("Conectado · 2001")
        } finally {
            control("PASSWORD $senha")
        }
    }

    private fun login(password: String, tcp: Boolean = false) {
        type("servidor", registrar)
        if (tcp) {
            compose.onNodeWithTag("protocolo").performClick()
            compose.onNodeWithText("TCP").performClick()
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

    /** Espera o texto aparecer na tela; se não aparece, a falha traz o fim do log do motor e a tela. */
    private fun waitForText(text: String, timeoutMillis: Long = 20_000) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()) return
            Thread.sleep(100)
        }
        throw AssertionError("\"$text\" não apareceu em ${timeoutMillis / 1000} s.\nMotor:\n${engineLog()}\nTela:\n${screen()}")
    }

    private fun screen(): String =
        try {
            compose.onRoot().printToString().lines().take(30).joinToString("\n")
        } catch (e: Throwable) {
            "(${e.message})"
        }

    /** As últimas linhas do motor no logcat (o app as escreve com a tag StarsonicMotor nos builds de debug). */
    private fun engineLog(): String {
        val output = InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand("logcat -d -v brief -s StarsonicMotor:I")
        val lines = ParcelFileDescriptor.AutoCloseInputStream(output).bufferedReader().use { it.readLines() }
        return lines.takeLast(20).joinToString("\n") { it.take(240) }
    }

    /** Um comando na porta de controle do registrador falso (ex.: PASSWORD <senha>), que responde OK. */
    private fun control(command: String) {
        Socket(registrar, controlPort).use { socket ->
            socket.soTimeout = 5_000
            val writer = OutputStreamWriter(socket.getOutputStream(), Charsets.UTF_8)
            writer.write(command + "\n")
            writer.flush()
            val reply = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8)).readLine()
            assertEquals("resposta a $command", "OK", reply)
        }
    }
}
