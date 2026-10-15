package br.com.starsonic.phone

import android.app.Instrumentation
import android.app.Notification
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import br.com.starsonic.phone.call.CallActionReceiver
import br.com.starsonic.phone.call.CallActivity
import br.com.starsonic.phone.call.CallPhase
import br.com.starsonic.phone.call.IncomingCallNotifier
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.data.CallKind
import br.com.starsonic.phone.data.Recent
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.main.MainActivity
import java.util.regex.Pattern
import org.junit.After
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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
 * botões da notificação de ligação são do Android: o CI sobe o emulador em pt-BR (Atender e Recusar). O Recentes
 * começa vazio em cada teste.
 *
 * No fim, uma "Nota do teste" na saída do am instrument conta os toques repetidos nos botões da notificação
 * (o run-emulator-tests.sh a mostra numa anotação).
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
        // A tela acesa e sem bloqueio, como num celular em uso: a ligação aparece no alto da tela (sem a tela
        // cheia, que o Android usa com a tela apagada ou bloqueada).
        device.wakeUp()
        device.executeShellCommand("svc power stayon true")
        device.executeShellCommand("wm dismiss-keyguard")
        emulator.startClean()
        app.recents.clear()
        // Uma notificação de ligação que sobrou de um teste que falhou não engana o próximo.
        val notifications = app.getSystemService(NotificationManager::class.java)
        notifications.activeNotifications.filter { it.notification.channelId in CALL_CHANNELS }
            .forEach { notifications.cancel(it.tag, it.id) }
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
        tapSystemButton("Atender") { answered() }
        emulator.waitForText("3001")   // a tela de chamada
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        emulator.waitUntil("o toque parar", details = ::notifications) { callNotification() == null }
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("a tela de chamada sair") { !emulator.showsTag("chamada") }
        emulator.waitUntil("a recebida no Recentes") { app.recents.list().firstOrNull()?.kind == CallKind.RECEBIDA }
        assertEquals("3001", app.recents.list().first().number)
        // No app: a aba Recentes mostra a recebida.
        scenario?.close()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitUntil("a aba Recentes") { emulator.showsTag("aba-recentes") }
        compose.onNodeWithTag("aba-recentes").performClick()
        emulator.waitForText("Recebida")
    }

    @Test
    fun outgoingCallIsHeldAndTransferred() {
        val before = emulator.callLog().size
        dial("2002")
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        emulator.waitUntil("o botão Espera") { emulator.showsTag("espera") }
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
        tapSystemButton("Recusar") { callNotification() == null }
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
        tapSystemButton("Atender") { answered() }
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        val before = emulator.callLog().size
        val recents = app.recents.list().size
        assertEquals("OK", emulator.control("RING 2001"))
        waitForLog(before, "inv-out 2001 486")
        emulator.waitUntil("a segunda como perdida no Recentes") {
            val list = app.recents.list()
            list.size == recents + 1 && list.first().kind == CallKind.PERDIDA
        }
        assertEquals("a primeira segue", CallPhase.ACTIVE, app.calls.state.value?.phase)
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("a primeira acabar") { app.calls.state.value == null }
    }

    @Test
    fun aNewNotifierRemovesAStuckIncomingNotification() {
        // O processo morreu com a recebida tocando: a notificação (com o toque) ficou. Num processo novo não há
        // ligação, e o notificador que nasce a tira.
        val id = fakeCallId()
        app.notifier.showIncoming(id, "3001", "Cliente Teste")
        emulator.waitUntil("a notificação de ligação", details = ::notifications) { callNotification() != null }
        IncomingCallNotifier(app)
        emulator.waitUntil("a notificação presa sair", details = ::notifications) { callNotification() == null }
    }

    @Test
    fun answerOfACallThatIsNotRingingRemovesTheNotification() {
        val id = fakeCallId()
        app.notifier.showIncoming(id, "3001", "Cliente Teste")
        emulator.waitUntil("a notificação de ligação", details = ::notifications) { callNotification() != null }
        app.startActivity(CallActivity.intent(app).setAction(CallActivity.ACTION_ANSWER).putExtra(CallActivity.EXTRA_CALL_ID, id))
        emulator.waitUntil("a notificação presa sair", details = ::notifications) { callNotification() == null }
        assertNull("nada foi atendido", app.calls.state.value)
    }

    @Test
    fun declineOfACallThatIsNotRingingRemovesTheNotification() {
        val id = fakeCallId()
        app.notifier.showIncoming(id, "3001", "Cliente Teste")
        emulator.waitUntil("a notificação de ligação", details = ::notifications) { callNotification() != null }
        app.sendBroadcast(
            Intent(app, CallActionReceiver::class.java)
                .setAction(IncomingCallNotifier.ACTION_DECLINE)
                .putExtra(CallActivity.EXTRA_CALL_ID, id),
        )
        emulator.waitUntil("a notificação presa sair", details = ::notifications) { callNotification() == null }
    }

    @Test
    fun dialFromRecentsWithoutRegistrationShowsTheMessage() {
        app.recents.add(Recent("2002", "", CallKind.FEITA, System.currentTimeMillis(), 0))
        openWithoutRegistration()
        compose.onNodeWithTag("aba-recentes").performClick()
        emulator.waitUntil("a linha do Recentes") { emulator.showsTag("recente") }
        compose.onAllNodesWithTag("recente").onFirst().performClick()
        emulator.waitForText("Sem conexão com o servidor. Tente de novo em instantes.")
        assertNull("nada foi discado", app.calls.state.value)
    }

    @Test
    fun silenceKeepsTheIncomingNotificationWithoutTheRing() {
        // O volume apertado durante o toque (Telecom: onSilence): a notificação fica, sem o toque que se repete, e
        // continua no alto da tela (com o celular em uso).
        val id = fakeCallId()
        app.notifier.showIncoming(id, "3001", "Cliente Teste")
        emulator.waitUntil("a notificação de ligação que toca", details = ::notifications) {
            callNotification()?.let { it.flags and Notification.FLAG_INSISTENT != 0 } == true
        }
        val answer = By.pkg(SYSTEM_UI).text(Pattern.compile("Atender", Pattern.CASE_INSENSITIVE))
        assertNotNull("a ligação no alto da tela; na tela: ${visibleTexts()}", device.wait(Until.findObject(answer), 10_000))
        app.notifier.silence(id)
        emulator.waitUntil("a notificação de ligação sem o toque", details = ::notifications) {
            callNotification()?.let { it.flags and Notification.FLAG_INSISTENT == 0 } == true
        }
        Thread.sleep(2_000)
        assertNotNull("a ligação continua no alto da tela; na tela: ${visibleTexts()}", device.findObject(answer))
        app.notifier.dismiss(id)   // sem o stopRinging de um id falso, que esconderia as ligações de verdade seguintes
        emulator.waitUntil("a notificação sair", details = ::notifications) { callNotification() == null }
    }

    @Test
    fun theCallBarWaitsForTheAnswer() {
        // Com o app na frente: enquanto a recebida toca, nada de "Ligação em andamento"; atendida, a faixa aparece.
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a ligação tocando") { app.calls.state.value?.phase == CallPhase.RINGING }
        Thread.sleep(1_000)
        assertEquals("a faixa da ligação enquanto toca", false, emulator.showsTag("voltar-ligacao"))
        app.calls.answer()
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        emulator.waitUntil("a faixa da ligação") { emulator.showsTag("voltar-ligacao") }
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("a ligação acabar") { app.calls.state.value == null }
    }

    @Test
    fun theChosenTabSurvivesRecreation() {
        compose.onNodeWithTag("aba-recentes").performClick()
        emulator.waitForText("Nenhuma ligação ainda.")
        scenario!!.recreate()
        emulator.waitForText("Nenhuma ligação ainda.")
    }

    @Test
    fun theMessageDoesNotMoveTheKeypad() {
        // O aviso aparece e some (2 s) sem empurrar o teclado embaixo do dedo.
        openWithoutRegistration()
        compose.onNodeWithTag("tecla-2").performScrollTo().performClick()
        compose.onNodeWithTag("ligar").performScrollTo()
        val before = compose.onNodeWithTag("tecla-1").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("ligar").performClick()
        emulator.waitForText("Sem conexão com o servidor. Tente de novo em instantes.")
        assertEquals("o teclado no lugar", before, compose.onNodeWithTag("tecla-1").fetchSemanticsNode().boundsInRoot)
    }

    // O app aberto com a conta de senha errada: o servidor recusa o registro, e o app fica sem conexão.
    private fun openWithoutRegistration() {
        scenario?.close()
        emulator.startClean()
        app.store.save(Account(emulator.registrar, Transport.TCP, "2001", "senha-errada"))
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitForText("Ramal ou senha incorretos.")
    }

    // Disca no Teclado do app (na frente) e toca Ligar.
    private fun dial(number: String) {
        emulator.waitUntil("o Teclado") { emulator.showsTag("ligar") }
        for (digit in number) compose.onNodeWithTag("tecla-$digit").performScrollTo().performClick()
        compose.onNodeWithTag("ligar").performScrollTo().performClick()
    }

    private fun waitForLog(before: Int, line: String) =
        emulator.waitUntil("\"$line\" no LOG do registrador", details = { "LOG: ${emulator.callLog().drop(before)}" }) {
            line in emulator.callLog().drop(before)
        }

    // Um botão da notificação de ligação (do Android, que desenha a notificação: no alto da tela, ou na gaveta de
    // notificações). A notificação que acabou de aparecer ainda desliza para o lugar, e um toque nesse meio pode
    // não pegar: o toque se repete (até 3) enquanto [took] não vale.
    private fun tapSystemButton(label: String, took: () -> Boolean) {
        val text = By.pkg(SYSTEM_UI).text(Pattern.compile(Pattern.quote(label), Pattern.CASE_INSENSITIVE))
        repeat(3) {
            var button = device.wait(Until.findObject(text), 10_000)
            if (button == null) {
                device.openNotification()
                button = device.wait(Until.findObject(text), 10_000)
            }
            if (button == null && within(5_000, took)) return   // o toque anterior pegou, só demorou
            val found = button
                ?: throw AssertionError("Sem o botão $label da notificação.\nNa tela: ${visibleTexts()}\n${notifications()}")
            device.waitForIdle()
            found.click()
            if (within(5_000, took)) return
            repeatedTaps[label] = (repeatedTaps[label] ?: 0) + 1
        }
        throw AssertionError("O botão $label da notificação não respondeu a 3 toques.\nNa tela: ${visibleTexts()}\n${notifications()}")
    }

    // A recebida foi atendida (a pessoa tocou Atender: o app espera o motor confirmar, ou já confirmou).
    private fun answered(): Boolean =
        app.calls.state.value?.phase.let { it == CallPhase.CONNECTING || it == CallPhase.ACTIVE }

    private fun within(millis: Long, condition: () -> Boolean): Boolean {
        val deadline = SystemClock.uptimeMillis() + millis
        while (SystemClock.uptimeMillis() < deadline) {
            if (condition()) return true
            Thread.sleep(100)
        }
        return condition()
    }

    // A notificação de ligação do app (canal "ligacoes", ou o da ligação silenciada), ou null.
    private fun callNotification(): Notification? =
        app.getSystemService(NotificationManager::class.java).activeNotifications
            .firstOrNull { it.notification.channelId in CALL_CHANNELS }?.notification

    // A ligação do app e as notificações dele (canal/título/tipo de ligação), para as falhas.
    private fun notifications(): String {
        val shown = app.getSystemService(NotificationManager::class.java).activeNotifications.joinToString {
            val extras = it.notification.extras
            "${it.notification.channelId}/${extras.getCharSequence(Notification.EXTRA_TITLE)}" +
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "/${extras.getInt(Notification.EXTRA_CALL_TYPE)}" else ""
        }
        return "ligação: ${app.calls.state.value}; notificações: $shown"
    }

    private fun visibleTexts(): List<String> =
        device.findObjects(By.text(Pattern.compile(".+"))).mapNotNull { "${it.applicationPackage}:${it.text}" }.take(40)

    // Um id de ligação que o motor nunca deu (as notificações de teste sem ligação), sempre maior que o anterior.
    private fun fakeCallId(): Int = ++lastFakeId

    companion object {
        private const val SYSTEM_UI = "com.android.systemui"
        private val CALL_CHANNELS = setOf(IncomingCallNotifier.CHANNEL_CALLS, IncomingCallNotifier.CHANNEL_SILENCED)

        // Os toques repetidos nos botões da notificação, por botão, e os ids das notificações de teste.
        private val repeatedTaps = mutableMapOf("Atender" to 0, "Recusar" to 0)
        private var lastFakeId = 1_000

        /** Conta os toques repetidos na saída do am instrument (o run-emulator-tests.sh a mostra numa anotação). */
        @AfterClass
        @JvmStatic
        fun reportRepeatedTaps() {
            val total = repeatedTaps.values.sum()
            val each = repeatedTaps.entries.joinToString { "${it.key} ${it.value}" }
            val note = "Nota do teste: CallFlowTest: toques repetidos nos botões da notificação: $total ($each)"
            InstrumentationRegistry.getInstrumentation()
                .sendStatus(0, Bundle().apply { putString(Instrumentation.REPORT_KEY_STREAMRESULT, "\n$note\n") })
        }
    }
}
