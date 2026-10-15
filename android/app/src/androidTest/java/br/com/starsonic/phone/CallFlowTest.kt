package br.com.starsonic.phone

import android.app.Notification
import android.app.NotificationManager
import android.os.Build
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import br.com.starsonic.phone.call.CallPhase
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.data.CallKind
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.main.MainActivity
import java.util.regex.Pattern
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * As ligações no emulador (spec 7.3 a 7.5 e 11.2), com o motor de verdade e o registrador falso do CI (ver
 * [Emulator]): ele liga para o ramal 2001 (RING, de "Cliente Teste" <sip:3001@ci>), desliga (HANGUP) e anota
 * o que o telefone mandou (LOG); ligações para 486 recebem Ocupado, e para outro número são atendidas.
 *
 * Cada teste começa com a conta gravada por TCP (o CI confere que o último REGISTER aceito veio por TCP) e o
 * app aberto, que inicia o serviço; as recebidas tocam com o app em segundo plano (UiDevice.pressHome). Os
 * botões da notificação de ligação são do Android: o CI sobe o emulador em pt-BR (Atender e Recusar).
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class CallFlowTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val emulator = Emulator(compose)
    private val app = emulator.app
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private var scenario: ActivityScenario<MainActivity>? = null

    @Before
    fun connect() {
        emulator.startClean()
        app.store.save(Account(emulator.registrar, Transport.TCP, "2001", emulator.senha))
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitForText("Conectado · 2001")
    }

    @After
    fun close() {
        // Uma ligação que sobrou de um teste que falhou acaba aqui (a do registrador, e a do app).
        if (app.calls.state.value != null) {
            emulator.control("HANGUP 2001")
            app.calls.hangup()
        }
        scenario?.close()
    }

    @Test
    fun incomingCallShowsAtenderAndIsAnswered() {
        device.pressHome()
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a notificação de ligação", details = ::notifications) { callNotification() != null }
        tapSystemButton("Atender")
        emulator.waitForText("3001")   // a tela de chamada
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        emulator.waitUntil("o toque parar", details = ::notifications) { callNotification() == null }
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("a tela de chamada sair") { compose.onAllNodesWithTag("chamada").fetchSemanticsNodes().isEmpty() }
        emulator.waitUntil("a recebida no Recentes") { app.recents.list().firstOrNull()?.kind == CallKind.RECEBIDA }
        assertEquals("3001", app.recents.list().first().number)
        // No app: a aba Recentes mostra a recebida.
        scenario?.close()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitUntil("a aba Recentes") { compose.onAllNodesWithTag("aba-recentes").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("aba-recentes").performClick()
        emulator.waitForText("Recebida")
    }

    @Test
    fun outgoingCallIsHeldAndTransferred() {
        val before = emulator.callLog().size
        dial("2002")
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        emulator.waitUntil("o botão Espera") { compose.onAllNodesWithTag("espera").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("espera").performClick()
        waitForLog(before, "reinv-in 2002 sendonly")
        compose.onNodeWithTag("transferir").performClick()
        compose.onNodeWithTag("transferir-numero").performTextInput("2003")
        compose.onNodeWithTag("transferir-confirmar").performClick()
        waitForLog(before, "refer-in 2002 2003")
        // O registrador aceita a transferência (NOTIFY 200), e a ligação acaba.
        emulator.waitUntil("a ligação acabar depois da transferência") { app.calls.state.value == null }
        emulator.waitUntil("a feita no Recentes") { app.recents.list().firstOrNull()?.kind == CallKind.FEITA }
    }

    @Test
    fun outgoingCallTo486ShowsOcupado() {
        dial("486")
        emulator.waitForText("Ocupado")
        emulator.waitUntil("a feita no Recentes") { app.recents.list().firstOrNull()?.number == "486" }
        assertEquals(CallKind.FEITA, app.recents.list().first().kind)
    }

    @Test
    fun recusarSendsBusyAndRecordsAMissedCall() {
        device.pressHome()
        val before = emulator.callLog().size
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a notificação de ligação", details = ::notifications) { callNotification() != null }
        tapSystemButton("Recusar")
        waitForLog(before, "inv-out 2001 486")
        emulator.waitUntil("a perdida no Recentes") { app.recents.list().firstOrNull()?.kind == CallKind.PERDIDA }
        assertEquals("3001", app.recents.list().first().number)
        emulator.waitUntil("o toque parar", details = ::notifications) { callNotification() == null }
    }

    @Test
    fun secondCallDuringACallGetsBusy() {
        device.pressHome()
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a notificação de ligação", details = ::notifications) { callNotification() != null }
        tapSystemButton("Atender")
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        val before = emulator.callLog().size
        assertEquals("OK", emulator.control("RING 2001"))
        waitForLog(before, "inv-out 2001 486")
        emulator.waitUntil("a perdida no Recentes") { app.recents.list().firstOrNull()?.kind == CallKind.PERDIDA }
        assertEquals("a primeira segue", CallPhase.ACTIVE, app.calls.state.value?.phase)
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("a primeira acabar") { app.calls.state.value == null }
    }

    // Disca no Teclado do app (na frente) e toca Ligar.
    private fun dial(number: String) {
        emulator.waitUntil("o Teclado") { compose.onAllNodesWithTag("ligar").fetchSemanticsNodes().isNotEmpty() }
        for (digit in number) compose.onNodeWithTag("tecla-$digit").performClick()
        compose.onNodeWithTag("ligar").performClick()
    }

    private fun waitForLog(before: Int, line: String) =
        emulator.waitUntil("\"$line\" no LOG do registrador", details = { "LOG: ${emulator.callLog().drop(before)}" }) {
            line in emulator.callLog().drop(before)
        }

    // Um botão da notificação de ligação (do Android: no alto da tela, ou na gaveta de notificações).
    private fun tapSystemButton(label: String) {
        val text = By.text(Pattern.compile(Pattern.quote(label), Pattern.CASE_INSENSITIVE))
        var button = device.wait(Until.findObject(text), 10_000)
        if (button == null) {
            device.openNotification()
            button = device.wait(Until.findObject(text), 10_000)
        }
        val found = button
            ?: throw AssertionError("Sem o botão $label da notificação.\nNa tela: ${visibleTexts()}\n${notifications()}")
        found.click()
    }

    // A notificação de ligação do app (canal "ligacoes"), ou null.
    private fun callNotification(): Notification? =
        app.getSystemService(NotificationManager::class.java).activeNotifications
            .firstOrNull { it.notification.channelId == "ligacoes" }?.notification

    private fun notifications(): String =
        app.getSystemService(NotificationManager::class.java).activeNotifications.joinToString(prefix = "notificações: ") {
            val extras = it.notification.extras
            "${it.notification.channelId}/${extras.getCharSequence(Notification.EXTRA_TITLE)}" +
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "/${extras.getInt(Notification.EXTRA_CALL_TYPE)}" else ""
        }

    private fun visibleTexts(): List<String> =
        device.findObjects(By.text(Pattern.compile(".+"))).mapNotNull { it.text }.take(40)
}
