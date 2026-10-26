package br.com.starsonic.phone

import android.app.Instrumentation
import android.app.Notification
import android.app.NotificationManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.hardware.display.DisplayManager
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.Display
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.printToString
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import br.com.starsonic.phone.main.MainActivity
import br.com.starsonic.phone.service.SipService
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.Socket
import org.junit.Assert.assertTrue

/**
 * O andaime dos testes no emulador, com o motor de verdade e o registrador falso do CI rodando no computador
 * (tests/smoke/fake_registrar.py, ramal 2001; o emulador o vê em 10.0.2.2). Argumentos do am instrument:
 * registrar (o endereço do registrador), porta (a porta de controle dele) e senha (a senha que ele aceita).
 *
 * As esperas, quando falham, trazem o fim do log do motor e a tela.
 *
 * Nas telas do app: o menu do cabeçalho ([openMenu]), o texto de um campo ([editableText]) e a área de toque
 * ([assertTouchAtLeast48]).
 *
 * Para os testes do visual: as fotos das telas ([saveScreen]), a tela, a letra e o tema do emulador (com o
 * [restoreLook]) e os contatos da agenda ([insertContact]).
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

    /** Alguma linha do motor no logcat (desde o último [clearLogcat]) tem [text]. */
    fun engineLogHas(text: String): Boolean = logcatLines("StarsonicMotor:I").any { text in it }

    /** Limpa o logcat: uma linha que aparece depois é nova. */
    fun clearLogcat() {
        shell("logcat -c")
    }

    private fun logcat(filter: String, lines: Int): String =
        logcatLines(filter).filter { "Cannot find conference" !in it }
            .takeLast(lines)
            .joinToString("\n") { it.take(200) }

    private fun logcatLines(filter: String): List<String> =
        shell("logcat -d -v brief -s $filter").filter { !it.startsWith("-----") }

    /**
     * Um comando no shell do aparelho (com o usuário shell, que pode, por exemplo, gravar na agenda); a saída, linha a
     * linha (lida até o fim: o comando acabou). O comando é separado nos espaços, sem um shell: nada de aspas.
     */
    fun shell(command: String): List<String> {
        val output = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(output).bufferedReader().use { it.readLines() }
    }

    /** Um comando na porta de controle do registrador falso (ex.: PASSWORD <senha>, RING 2001): a resposta. */
    fun control(command: String): String = controlLines(command, multiLine = false).firstOrNull().orEmpty()

    /** O registro de ligações do registrador (LOG), sem o END: inv-out 2001 486, reinv-in 2002 sendonly... */
    fun callLog(): List<String> = controlLines("LOG", multiLine = true)

    /** Os REGISTER aceitos do ramal 2001 com Expires > 0. */
    fun registers(): Int = control("REGISTERS 2001").toInt()

    /**
     * O wake lock da conexão ([SipService.WAKE_LOCK_TAG]) está preso agora: ele aparece na seção "Wake Locks" do
     * dumpsys power (o histórico, mais embaixo, guarda os antigos e não conta), como no build/android/check-boot.sh.
     */
    fun connectionWakeLockHeld(): Boolean {
        val tag = "'${SipService.WAKE_LOCK_TAG}'"
        var section = false
        for (line in shell("dumpsys power")) {
            when {
                line.trim().startsWith("Wake Locks: size=") -> section = true
                section && line.isBlank() -> section = false
                section && tag in line -> return true
            }
        }
        return false
    }

    /** O título da notificação fixa do app (canal "conexao"), ou null se ela não está lá. */
    fun connectionNotificationTitle(): String? =
        app.getSystemService(NotificationManager::class.java).activeNotifications
            .firstOrNull { it.notification.channelId == SipService.CHANNEL_ID }
            ?.notification?.extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString()

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

    /** Abre o menu do cabeçalho da tela principal e toca na linha [tag] dele (menu-configuracoes ou menu-sobre). */
    fun openMenu(tag: String) {
        waitUntil("o menu do cabeçalho") { showsTag("menu") }
        compose.onNodeWithTag("menu").performClick()
        waitUntil("o item $tag do menu") { showsTag(tag) }
        compose.onNodeWithTag(tag).performClick()
    }

    /** O texto do campo [tag] (os da tela Entrar). */
    fun editableText(tag: String): String =
        compose.onNodeWithTag(tag).fetchSemanticsNode().config.getOrNull(SemanticsProperties.EditableText)?.text.orEmpty()

    /** A área de toque do elemento [tag] tem pelo menos 48 × 48 dp (spec 3.3), mesmo com o desenho menor. */
    fun assertTouchAtLeast48(tag: String) {
        val node = compose.onNodeWithTag(tag).fetchSemanticsNode()
        val minimum = with(node.layoutInfo.density) { 48.dp.toPx() }
        val touch = node.touchBoundsInRoot
        assertTrue(
            "a área de toque de $tag tem ${touch.width} × ${touch.height} px (pelo menos $minimum)",
            touch.width >= minimum - 0.5f && touch.height >= minimum - 0.5f,
        )
    }

    /** Pede o fim das MainActivity que ainda não acabaram (as de fora do ActivityScenario também) e diz quantas eram. */
    fun finishMainActivities(): Int {
        var alive = 0
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val monitor = ActivityLifecycleMonitorRegistry.getInstance()
            val activities = LIVE_STAGES.flatMap { monitor.getActivitiesInStage(it) }.filterIsInstance<MainActivity>()
            activities.filter { !it.isFinishing }.forEach { it.finish() }
            alive = activities.size
        }
        return alive
    }

    /**
     * Uma nota na saída do am instrument ("Nota do teste: ..."), que o run-emulator-tests.sh mostra numa anotação do
     * run: o que não é falha, mas não pode passar calado.
     */
    fun note(text: String) {
        val line = "\nNota do teste: $text\n"
        InstrumentationRegistry.getInstrumentation()
            .sendStatus(0, Bundle().apply { putString(Instrumentation.REPORT_KEY_STREAMRESULT, line) })
    }

    // As fotos das telas (R19) e o que os testes do visual mudam no emulador: a tela, a letra e o tema.

    /**
     * Guarda a tela inteira do aparelho (a barra de status, o app e a navegação, como a pessoa vê) em PNG, em
     * telas/[name] na pasta do app no armazenamento externo (/sdcard/Android/data/br.com.starsonic.phone/files): o
     * android.yml a copia do emulador logo depois da classe e a publica no artefato telas-<commit>, para a conferência
     * com os quadros do canvas. Espera a tela parar (as animações e o último quadro). Uma foto que não sai não derruba o
     * teste: vira uma nota ([note]).
     */
    fun saveScreen(name: String) {
        compose.waitForIdle()
        Thread.sleep(SCREEN_SETTLE_MILLIS)
        val problem = try {
            val shot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            if (shot == null) {
                "o Android não tirou a foto"
            } else {
                val folder = File(app.getExternalFilesDir(null), SCREENS_FOLDER).apply { mkdirs() }
                FileOutputStream(File(folder, name)).use { shot.compress(Bitmap.CompressFormat.PNG, 100, it) }
                shot.recycle()
                null
            }
        } catch (e: IOException) {
            "não gravou: ${e.message}"
        }
        if (problem != null) note("a tela $name não foi salva ($problem)")
    }

    // A tela, a letra e o tema de antes de os testes do visual os mudarem (o [restoreLook] os devolve).
    private var displayChanged = false
    private var fontScaleBefore: String? = null
    private var nightBefore: String? = null

    /** A tela dos quadros do canvas, 390 × 844 dp (780 × 1688 pixels em 320 dpi), para as fotos ([saveScreen]). */
    fun useCanvasDisplay() = useDisplay(780, 1688, 320)

    /**
     * A tela do emulador em [width] × [height] pixels e [density] dpi (wm size e wm density), até o [restoreLook].
     * Espera o Android passar a usá-la: uma tela aberta depois já nasce nela.
     */
    fun useDisplay(width: Int, height: Int, density: Int) {
        displayChanged = true
        shell("wm size ${width}x$height")
        shell("wm density $density")
        waitForDisplay(width, height, density)
    }

    /** A letra do celular em [scale] (o font_scale dos ajustes do Android), até o [restoreLook]. */
    fun setFontScale(scale: Float) {
        if (fontScaleBefore == null) fontScaleBefore = shell("settings get system font_scale").firstOrNull()?.trim().orEmpty()
        shell("settings put system font_scale $scale")
        waitUntil("a letra do celular em $scale") { app.resources.configuration.fontScale == scale }
    }

    /** O tema escuro ([night]) ou o claro do celular (cmd uimode night), até o [restoreLook]. */
    fun setNightMode(night: Boolean) {
        if (nightBefore == null) nightBefore = shell("cmd uimode night").firstOrNull()?.substringAfterLast(' ')?.trim().orEmpty()
        shell("cmd uimode night ${if (night) "yes" else "no"}")
        waitUntil("o tema ${if (night) "escuro" else "claro"} do celular") { isNight() == night }
    }

    /** Devolve a tela, a letra e o tema que os testes do visual mudaram. */
    fun restoreLook() {
        if (displayChanged) {
            displayChanged = false
            shell("wm size reset")
            shell("wm density reset")
            val size = shell("wm size").first { it.startsWith("Physical size:") }.substringAfter(':').trim().split('x')
            val density = shell("wm density").first { it.startsWith("Physical density:") }.substringAfter(':').trim()
            waitForDisplay(size[0].toInt(), size[1].toInt(), density.toInt())
        }
        fontScaleBefore?.let { before ->
            fontScaleBefore = null
            val scale = before.toFloatOrNull() ?: 1f   // "null": nunca mudou, a letra padrão
            shell("settings put system font_scale $scale")
            waitUntil("a letra do celular de volta em $scale") { app.resources.configuration.fontScale == scale }
        }
        nightBefore?.let { before ->
            nightBefore = null
            val mode = before.takeIf { it in setOf("yes", "no", "auto") } ?: "no"
            shell("cmd uimode night $mode")
            if (mode != "auto") waitUntil("o tema do celular de volta") { isNight() == (mode == "yes") }
        }
    }

    private fun isNight(): Boolean =
        app.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES

    private fun waitForDisplay(width: Int, height: Int, density: Int) =
        waitUntil("a tela de ${width}x$height em $density dpi") {
            val metrics = displayMetrics()
            metrics.widthPixels == width && metrics.heightPixels == height && metrics.densityDpi == density &&
                app.resources.configuration.densityDpi == density
        }

    // O tamanho da tela inteira, com o do wm size e o do wm density (de qualquer contexto, também o do app).
    @Suppress("DEPRECATION")
    private fun displayMetrics(): DisplayMetrics = DisplayMetrics().also {
        app.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY).getRealMetrics(it)
    }

    /**
     * Põe na agenda do emulador, pelo shell (content insert, numa conta local), o contato [given] [family] ([family] pode
     * ser vazio) com o celular [number], e devolve o id dele (raw_contacts) para o [removeContact]. O shell separa os
     * argumentos nos espaços, sem aspas: um espaço do número vai como o espaço que não quebra (U+00A0), que a tela
     * mostra igual.
     */
    fun insertContact(given: String, family: String, number: String): Long {
        val before = rawContactIds()
        shell("content insert --uri $RAW_CONTACTS --bind account_type:n: --bind account_name:n:")
        val id = (rawContactIds() - before).singleOrNull()
            ?: throw AssertionError("o contato $given $family não entrou na agenda (raw_contacts: ${rawContactIds()})")
        val names = "--bind data2:s:$given" + if (family.isEmpty()) "" else " --bind data3:s:$family"
        shell("content insert --uri $DATA --bind raw_contact_id:l:$id --bind mimetype:s:$NAME_TYPE $names")
        shell(
            "content insert --uri $DATA --bind raw_contact_id:l:$id --bind mimetype:s:$PHONE_TYPE " +
                "--bind data1:s:${number.replace(' ', ' ')} --bind data2:i:2",
        )
        return id
    }

    /** Tira da agenda o contato [id] do [insertContact], de vez (como o adaptador de sincronização). */
    fun removeContact(id: Long) {
        shell("content delete --uri $RAW_CONTACTS/$id?caller_is_syncadapter=true")
    }

    private fun rawContactIds(): Set<Long> =
        shell("content query --uri $RAW_CONTACTS --projection _id").mapNotNull { RAW_ID.find(it)?.groupValues?.get(1)?.toLong() }
            .toSet()

    private companion object {
        val LIVE_STAGES = listOf(
            Stage.PRE_ON_CREATE, Stage.CREATED, Stage.STARTED, Stage.RESUMED, Stage.PAUSED, Stage.STOPPED, Stage.RESTARTED,
        )

        // A pasta das fotos, na pasta do app no armazenamento externo (o android.yml a copia com esse nome).
        const val SCREENS_FOLDER = "telas"

        // O tempo para a tela parar antes da foto: as animações (o menu, as pílulas, o toque) e o último quadro.
        const val SCREEN_SETTLE_MILLIS = 800L

        const val RAW_CONTACTS = "content://com.android.contacts/raw_contacts"
        const val DATA = "content://com.android.contacts/data"
        const val NAME_TYPE = "vnd.android.cursor.item/name"
        const val PHONE_TYPE = "vnd.android.cursor.item/phone_v2"
        val RAW_ID = Regex("""_id=(\d+)""")
    }
}
