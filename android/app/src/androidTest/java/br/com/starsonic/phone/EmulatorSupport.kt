package br.com.starsonic.phone

import android.os.ParcelFileDescriptor
import android.os.SystemClock
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToString
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import br.com.starsonic.phone.service.SipService
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.Socket

/**
 * O andaime dos testes no emulador, com o motor de verdade e o registrador falso do CI rodando no computador
 * (tests/smoke/fake_registrar.py, ramal 2001; o emulador o vê em 10.0.2.2). Argumentos do am instrument:
 * registrar (o endereço do registrador), porta (a porta de controle dele) e senha (a senha que ele aceita).
 *
 * As esperas, quando falham, trazem o fim do log do motor e a tela.
 */
class Emulator(private val compose: ComposeTestRule) {
    val app: App = ApplicationProvider.getApplicationContext()
    private val arguments = InstrumentationRegistry.getArguments()
    val registrar: String = arguments.getString("registrar") ?: "10.0.2.2"
    val controlPort: Int = (arguments.getString("porta") ?: "5070").toInt()
    val senha: String = arguments.getString("senha") ?: "senha-certa"

    /**
     * O começo de cada teste: o serviço de um teste anterior (ou o que o MY_PACKAGE_REPLACED iniciou com a conta
     * de uma classe anterior) para, e a conta dele sai do motor; a conta gravada e a que ainda estiver no motor
     * saem.
     */
    fun startClean() {
        SipService.stop(app)
        waitUntil("o serviço parar") { !SipService.running }
        app.store.clear()
        app.gateway.removeAccount()
    }

    /** Espera o texto aparecer numa tela do app. */
    fun waitForText(text: String, timeoutMillis: Long = 20_000) =
        waitUntil("\"$text\" na tela", timeoutMillis) { showsText(text) }

    /** Uma tela do app na frente mostra o texto (com o app em segundo plano, nenhuma mostra). */
    fun showsText(text: String): Boolean = shows { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }

    /** Uma tela do app na frente tem o elemento com a etiqueta [tag]. */
    fun showsTag(tag: String): Boolean = shows { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }

    // Sem nenhuma tela do Compose na frente (o app em segundo plano), o Compose lança IllegalStateException.
    private fun shows(found: () -> Boolean): Boolean =
        try {
            found()
        } catch (e: IllegalStateException) {
            false
        }

    /** Espera a condição; se ela não vem, a falha traz o fim do log do motor e a tela (e [details], se houver). */
    fun waitUntil(what: String, timeoutMillis: Long = 20_000, details: () -> String = { "" }, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(100)
        }
        val extra = details().let { if (it.isEmpty()) "" else "\n$it" }
        throw AssertionError(
            "Sem $what em ${timeoutMillis / 1000} s.$extra\nLigações:\n${callLogcat()}\nMotor:\n${engineLog()}\nTela:\n${screen()}",
        )
    }

    /** As primeiras linhas da árvore da tela do app (ou o motivo de não haver uma). */
    fun screen(): String =
        try {
            compose.onRoot().printToString().lines().take(30).joinToString("\n")
        } catch (e: Throwable) {
            "(${e.message?.lines()?.firstOrNull()})"
        }

    /** As últimas linhas do motor no logcat (o app as escreve com a tag StarsonicMotor nos builds de debug). */
    fun engineLog(): String = logcat("StarsonicMotor:I", 12)

    /**
     * As últimas linhas do caminho das ligações (StarsonicLigacao, nos builds de debug) e os avisos do Telecom e
     * das notificações do Android.
     */
    fun callLogcat(): String = logcat("StarsonicLigacao:V TelecomFramework:W NotificationService:W", 20)

    private fun logcat(filter: String, lines: Int): String {
        val output = InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand("logcat -d -v brief -s $filter")
        val read = ParcelFileDescriptor.AutoCloseInputStream(output).bufferedReader().use { it.readLines() }
        return read.filter { !it.startsWith("-----") && "Cannot find conference" !in it }
            .takeLast(lines)
            .joinToString("\n") { it.take(200) }
    }

    /** Um comando na porta de controle do registrador falso (ex.: PASSWORD <senha>, RING 2001): a resposta. */
    fun control(command: String): String = controlLines(command, multiLine = false).firstOrNull().orEmpty()

    /** O registro de ligações do registrador (LOG), sem o END: inv-out 2001 486, reinv-in 2002 sendonly... */
    fun callLog(): List<String> = controlLines("LOG", multiLine = true)

    /** Os REGISTER aceitos do ramal 2001 com Expires > 0. */
    fun registers(): Int = control("REGISTERS 2001").toInt()

    private fun controlLines(command: String, multiLine: Boolean): List<String> =
        Socket(registrar, controlPort).use { socket ->
            socket.soTimeout = 5_000
            val writer = OutputStreamWriter(socket.getOutputStream(), Charsets.UTF_8)
            writer.write(command + "\n")
            writer.flush()
            val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
            if (!multiLine) return@use listOfNotNull(reader.readLine())
            generateSequence { reader.readLine() }.takeWhile { it != "END" }.toList()
        }
}
