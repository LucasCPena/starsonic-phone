package br.com.starsonic.phone

import android.app.Notification
import android.app.NotificationManager
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
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
import br.com.starsonic.phone.service.SipService
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.Socket
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
 * O serviço em primeiro plano no emulador, com o motor de verdade e o registrador falso do CI (ramal 2001,
 * visto em 10.0.2.2; argumentos registrar, porta e senha, como no LoginScreenTest). Os registros vão por TCP,
 * como o último do LoginScreenTest: o CI confere no fim que o último REGISTER aceito veio por TCP.
 *
 * Os testes rodam em ordem alfabética, e o último deixa a conta gravada. O CI para o app à força em seguida e
 * confere que o BOOT_COMPLETED registra a conta de novo e segura o processador acordado
 * (build/android/check-boot.sh).
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class ServiceTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val app = ApplicationProvider.getApplicationContext<App>()
    private val arguments = InstrumentationRegistry.getArguments()
    private val registrar = arguments.getString("registrar") ?: "10.0.2.2"
    private val controlPort = (arguments.getString("porta") ?: "5070").toInt()
    private val senha = arguments.getString("senha") ?: "senha-certa"
    private var scenario: ActivityScenario<MainActivity>? = null

    @Before
    fun startClean() {
        // O serviço de um teste anterior para (a conta dele sai do motor), e a conta gravada é apagada.
        SipService.stop(app)
        waitUntil("o serviço parar") { !SipService.running }
        app.store.clear()
        app.gateway.removeAccount()
    }

    @After
    fun closeApp() {
        scenario?.close()
    }

    @Test
    fun loginShowsTheConnectedNotification() {
        val before = registers()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        login()
        waitForText("Conectado · 2001")
        waitUntil("a notificação \"Conectado (ramal 2001)\"") { notificationTitle() == "Conectado (ramal 2001)" }
        // O serviço ficou com a conta que a tela Entrar registrou: nenhum REGISTER a mais.
        Thread.sleep(3_000)
        assertEquals("REGISTER aceitos do ramal 2001", before + 1, registers())
    }

    @Test
    fun noAccountServiceLeaves() {
        // Sem conta gravada, o serviço que começa sai sozinho, sem deixar a notificação.
        val starts = SipService.startCommands
        assertTrue("SipService.start", SipService.start(app))
        waitUntil("o serviço começar") { SipService.startCommands > starts }
        waitUntil("o serviço sair") { !SipService.running }
        waitUntil("a notificação sair") { notificationTitle() == null }
    }

    @Test
    fun savedAccountStartsTheServiceOnOpen() {
        // Com a conta gravada (como depois de um Entrar) e o serviço parado, abrir o app inicia o serviço, que
        // registra a conta uma vez só: 3 s depois, nenhum REGISTER a mais. A conta fica gravada para a
        // conferência do BOOT_COMPLETED.
        app.store.save(Account(registrar, Transport.TCP, "2001", senha))
        val before = registers()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitForText("Conectado · 2001")
        waitUntil("a notificação \"Conectado (ramal 2001)\"") { notificationTitle() == "Conectado (ramal 2001)" }
        Thread.sleep(3_000)
        assertEquals("REGISTER aceitos do ramal 2001", before + 1, registers())
    }

    private fun login() {
        waitUntil("a tela Entrar") { compose.onAllNodesWithTag("entrar").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("servidor").performScrollTo().performTextInput(registrar)
        compose.onNodeWithTag("protocolo").performClick()
        compose.onNodeWithText("TCP").performClick()
        compose.onNodeWithTag("ramal").performScrollTo().performTextInput("2001")
        compose.onNodeWithTag("senha").performScrollTo().performTextInput(senha)
        compose.onNodeWithTag("entrar").performScrollTo().performClick()
    }

    /** O título da notificação fixa do app (canal "conexao"), ou null se ela não está lá. */
    private fun notificationTitle(): String? {
        val manager = app.getSystemService(NotificationManager::class.java)
        val shown = manager.activeNotifications.firstOrNull { it.notification.channelId == "conexao" } ?: return null
        assertTrue(
            "a notificação da conexão é a do serviço em primeiro plano",
            shown.notification.flags and Notification.FLAG_FOREGROUND_SERVICE != 0,
        )
        return shown.notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
    }

    private fun waitForText(text: String) =
        waitUntil("\"$text\" na tela") { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }

    /** Espera a condição; se ela não vem, a falha traz o fim do log do motor e a tela. */
    private fun waitUntil(what: String, timeoutMillis: Long = 20_000, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(100)
        }
        throw AssertionError("Sem $what em ${timeoutMillis / 1000} s.\nMotor:\n${engineLog()}\nTela:\n${screen()}")
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

    /** Os REGISTER aceitos do ramal 2001 com Expires > 0, pela porta de controle do registrador falso. */
    private fun registers(): Int = control("REGISTERS 2001").toInt()

    private fun control(command: String): String =
        Socket(registrar, controlPort).use { socket ->
            socket.soTimeout = 5_000
            val writer = OutputStreamWriter(socket.getOutputStream(), Charsets.UTF_8)
            writer.write(command + "\n")
            writer.flush()
            BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8)).readLine().orEmpty()
        }
}
