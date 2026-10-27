package br.com.starsonic.phone

import android.app.Instrumentation
import android.app.Notification
import android.app.NotificationManager
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.telecom.CallAudioState
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.filterToOne
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onChildren
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.toSize
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import br.com.starsonic.phone.call.AudioRoutes
import br.com.starsonic.phone.call.CallActionReceiver
import br.com.starsonic.phone.call.CallActivity
import br.com.starsonic.phone.call.CallPhase
import br.com.starsonic.phone.call.IncomingCallNotifier
import br.com.starsonic.phone.call.SecondKind
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.data.CallKind
import br.com.starsonic.phone.data.CallSettings
import br.com.starsonic.phone.data.Recent
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.main.MainActivity
import java.util.regex.Pattern
import org.junit.After
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * As ligações no emulador (spec 7.3 a 7.5 e 11.2), com o motor de verdade e o registrador falso do CI (ver
 * [Emulator]): ele liga para o ramal 2001 (RING, de "Cliente Teste" <sip:3001@ci>), desliga (HANGUP) e anota
 * o que o telefone mandou (LOG); ligações para 486 recebem Ocupado, e para outro número são atendidas. Cada RING é
 * uma ligação nova (dois RING, duas ligações), e o HANGUP desliga a última que ele fez que ainda está de pé. Nas
 * ligações do RING, o LOG anota os pedidos do telefone com o 3001 (reinv-in 3001 sendonly, bye-in 3001); nas que o
 * telefone faz, com o número discado (inv-in 2002 200). O REFER do telefone recebe 202 e um NOTIFY 200 (refer-in
 * <alvo> <destino>, com replaces=known no REFER com Replaces de um diálogo que ele conhece), ou o que REFER_REPLY e
 * REFER_NOTIFY pedirem até o RESET.
 *
 * Cada teste começa com a conta gravada por TCP (o CI confere que o último REGISTER aceito veio por TCP) e o
 * app aberto, que inicia o serviço; as recebidas tocam com o app em segundo plano (UiDevice.pressHome). Os
 * botões da notificação de ligação são do Android: o CI sobe o emulador em pt-BR (Atender e Recusar). O Recentes
 * começa vazio em cada teste, com o Não perturbe e o Atender automático desligados; o fim devolve as configurações de
 * ligação, a tela e a letra de antes.
 *
 * As telas da ligação no visual do Windows (spec 3, 5, 6 e 7; R9, R19, R35, R38 e R39): a linha do status no alto
 * ("Ocupado · em ligação" e o ramal, com a notificação fixa), o "Ramal <n>" embaixo do nome, o Não perturbe (o
 * registrador recebe o 486), o Atender automático com o app em segundo plano (1 s e na hora), a contagem dele na recebida
 * em tela cheia (e a notificação, que perde e ganha a linha com a decisão), o Rediscar da Nova ligação, o Desligar da
 * ligação ativa com duas, e a maior letra na tela de 320 dp (a contagem e os nomes inteiros). As fotos
 * ([Emulator.saveScreen]) saem na tela dos quadros do canvas (390 × 844 dp), menos as "-pequena" e as "-letra-grande",
 * na do emulador do CI.
 *
 * No fim, uma "Nota do teste" na saída do am instrument conta os toques repetidos nos botões da notificação
 * (o run-emulator-tests.sh a mostra numa anotação); outra conta como o Android deixou o serviço com o Atender automático
 * em segundo plano (o risco 12 da spec: o microfone).
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class CallFlowTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val emulator = Emulator(compose)
    private val app = emulator.app
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private val audio = app.getSystemService(AudioManager::class.java)
    private var scenario: ActivityScenario<MainActivity>? = null
    private var settingsBefore: CallSettings? = null

    @Before
    fun connect() {
        // A tela acesa e sem bloqueio, como num celular em uso: a ligação aparece no alto da tela (sem a tela
        // cheia, que o Android usa com a tela apagada ou bloqueada).
        device.wakeUp()
        device.executeShellCommand("svc power stayon true")
        device.executeShellCommand("wm dismiss-keyguard")
        emulator.startClean()
        app.recents.clear()
        settingsBefore = app.callSettings.settings.value
        app.callSettings.update { it.copy(doNotDisturb = false, autoAnswer = false) }
        // Uma notificação de ligação (ou de perdida) que sobrou de um teste que falhou não engana o próximo.
        val notifications = app.getSystemService(NotificationManager::class.java)
        notifications.activeNotifications.filter { it.notification.channelId in CALL_CHANNELS + MISSED_CHANNELS }
            .forEach { notifications.cancel(it.tag, it.id) }
        app.store.save(Account(emulator.registrar, Transport.TCP, "2001", emulator.senha))
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitForText("Conectado · ${emulator.registrar}")
    }

    @After
    fun close() {
        try {
            // As ligações que sobraram de um teste que falhou (até duas) acabam aqui: as do registrador, e as do app.
            if (app.calls.state.value != null) {
                repeat(2) { emulator.control("HANGUP 2001") }
                app.calls.state.value?.second?.let { app.calls.hangup(it.id) }
                app.calls.hangup()
            }
            scenario?.close()
        } finally {
            emulator.restoreLook()
            settingsBefore?.let { before -> app.callSettings.update { before } }
        }
    }

    @Test
    fun theCallScreenShowsOcupadoEmLigacao() {
        // R9: na tela da ligação, a linha do status no alto, com a bolinha ("Ocupado · em ligação" e o ramal), e a
        // notificação fixa com o mesmo título, que volta a "Conectado" no fim. A foto do quadro Chamada (com o Mudo ligado,
        // como nele) e a do teclado dos tons, que nunca tem o Rediscar (spec 6).
        emulator.useCanvasDisplay()
        answerOnTheCallScreen()
        emulator.waitUntil("a linha do status na tela da ligação", details = { "Na linha: ${tagTexts(CALL_STATUS)}" }) {
            tagTexts(CALL_STATUS) == listOf("Ocupado · em ligação", "2001")
        }
        emulator.waitUntil("a notificação \"Ocupado · em ligação\"", details = ::notificationTitle) {
            emulator.connectionNotificationTitle() == "Ocupado · em ligação"
        }
        assertTrue("R35: o ramal embaixo do nome", emulator.showsText("Ramal 3001"))
        // Com uma ligação só, o Desligar é "Desligar" (o quadro Chamada); com duas, o da ativa (R39, abaixo).
        compose.onNodeWithTag("desligar").assert(hasText(HANG_UP))
        assertNull("o Desligar sem outro nome", description("desligar"))
        compose.onNodeWithTag("mudo").performClick()
        emulator.waitUntil("o mudo ligado") { app.calls.state.value?.muted == true }
        emulator.saveScreen("ligacao.png")
        compose.onNodeWithTag("teclado-chamada").performClick()
        emulator.waitUntil("o teclado da ligação") { emulator.showsTag("dtmf-1") }
        for (key in "12") compose.onNodeWithTag("dtmf-$key").performClick()
        assertFalse("o Rediscar no teclado dos tons", emulator.showsTag("rediscar") || emulator.showsTag(REDIAL_NEW))
        emulator.saveScreen("ligacao-teclado.png")
        compose.onNodeWithTag("teclado-chamada").performClick()
        // A Nova ligação sem nenhuma feita nos Recentes: o Rediscar apagado, só "Rediscar".
        compose.onNodeWithTag("nova-ligacao").performClick()
        emulator.waitUntil("o Rediscar da Nova ligação") { emulator.showsTag(REDIAL_NEW) }
        compose.onNodeWithTag(REDIAL_NEW).assertIsNotEnabled().assertContentDescriptionEquals("Rediscar")
        compose.onNodeWithTag("nova-cancelar").performClick()
        compose.onNodeWithTag("mudo").performClick()
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("a ligação acabar") { app.calls.state.value == null }
        emulator.waitUntil("a notificação de volta em \"Conectado (ramal 2001)\"", details = ::notificationTitle) {
            emulator.connectionNotificationTitle() == "Conectado (ramal 2001)"
        }
    }

    @Test
    fun autoAnswerAnswersByItselfAfterTheTime() {
        // Spec 5 e 11: com o Atender automático, a recebida é atendida sozinha, sem nenhum toque, com o app em segundo
        // plano: depois de 1 s tocando e, na hora (0 s), logo que o celular toca (a corrida do R15: a Connection do Telecom
        // nasce antes, e o som da ligação passa por ela: o viva-voz pedido a ela vale). Sem o bipe do fim, para a Connection
        // de uma sair na hora, antes da próxima.
        app.callSettings.update { it.copy(autoAnswer = true, autoAnswerSeconds = 1, endBeep = false) }
        device.pressHome()
        emulator.clearLogcat()
        for (seconds in listOf(1, 0)) {
            app.callSettings.update { it.copy(autoAnswerSeconds = seconds) }
            val before = emulator.callLog().size
            assertEquals("OK", emulator.control("RING 2001"))
            val rang = timeOf("a ligação chegar ($seconds s)") { app.calls.state.value != null }
            val answered = timeOf("a ligação atendida sozinha ($seconds s)") {
                app.calls.state.value?.phase.let { it == CallPhase.CONNECTING || it == CallPhase.ACTIVE }
            }
            if (seconds > 0) {
                assertTrue("atendida depois do tempo (${answered - rang} ms depois de tocar)", answered - rang >= 700)
            }
            waitForLog(before, "inv-out 2001 200")
            emulator.waitUntil("a ligação em andamento ($seconds s)") { app.calls.state.value?.phase == CallPhase.ACTIVE }
            InstrumentationRegistry.getInstrumentation().runOnMainSync { app.telecom.setRoute(CallAudioState.ROUTE_SPEAKER) }
            emulator.waitUntil("o viva-voz pela Connection do Telecom ($seconds s)", details = { "Rotas: ${app.telecom.routes.value}" }) {
                app.telecom.routes.value.speaker
            }
            if (seconds > 0) emulator.note("CallFlowTest: Atender automático com o app em segundo plano: ${foregroundService()}")
            assertEquals("OK", emulator.control("HANGUP 2001"))
            emulator.waitUntil("a ligação acabar ($seconds s)") { app.calls.state.value == null }
            emulator.waitUntil("a Connection sair do Telecom ($seconds s)", details = { "Rotas: ${app.telecom.routes.value}" }) {
                app.telecom.routes.value == AudioRoutes()
            }
        }
        assertEquals("as duas no Recentes", listOf(CallKind.RECEBIDA, CallKind.RECEBIDA), app.recents.list().map { it.kind })
    }

    @Test
    fun doNotDisturbMakesTheCallerHearBusy() {
        // Spec 4: com o Não perturbe ligado, quem liga ouve ocupado (o registrador recebe o 486); nada toca nem abre a tela,
        // e a perdida entra no Recentes, com o aviso sem som, no canal do Não perturbe.
        app.callSettings.update { it.copy(doNotDisturb = true) }
        val before = emulator.callLog().size
        assertEquals("OK", emulator.control("RING 2001"))
        waitForLog(before, "inv-out 2001 486")
        emulator.waitUntil("a perdida no Recentes") { app.recents.list().firstOrNull()?.kind == CallKind.PERDIDA }
        assertEquals("3001", app.recents.list().first().number)
        emulator.waitUntil("o aviso da perdida sem som", details = ::notifications) { silentMissed() != null }
        assertEquals("Ligação perdida de 3001", silentMissed()?.extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString())
        assertNull("nada tocou", app.calls.state.value)
        assertNull("sem a notificação de ligação", callNotification())
        assertFalse("sem a tela de chamada", emulator.showsTag("chamada"))
    }

    @Test
    fun rediscarInNovaLigacaoDialsTheLastCall() {
        // Spec 6 (R4): na Nova ligação, o Rediscar liga para a feita mais nova dos Recentes pelo mesmo caminho do Ligar do
        // painel (a primeira vai para a espera), com o nome do Rediscar do Teclado. As fotos do painel e das duas ligações
        // (o quadro DuasLigacoes).
        emulator.useCanvasDisplay()
        val now = System.currentTimeMillis()
        app.recents.add(Recent("2005", "", CallKind.FEITA, now - 120_000, 30))
        app.recents.add(Recent("2002", "", CallKind.FEITA, now - 60_000, 30))
        val first = answerOnTheCallScreen()
        compose.onNodeWithTag("nova-ligacao").performClick()
        emulator.waitUntil("o Rediscar da feita mais nova", details = { "Rediscar: ${description(REDIAL_NEW)}" }) {
            description(REDIAL_NEW) == "Rediscar 2002"
        }
        compose.onNodeWithTag(REDIAL_NEW).assertIsEnabled()
        emulator.assertTouchAtLeast48(REDIAL_NEW)
        emulator.saveScreen("nova-ligacao.png")
        val before = emulator.callLog().size
        compose.onNodeWithTag(REDIAL_NEW).performClick()
        waitForLog(before, "reinv-in 3001 sendonly")
        waitForLog(before, "inv-in 2002 200")
        emulator.waitUntil("a feita em cima, com a primeira em espera") { activeWith(held = first) }
        assertEquals("2002", app.calls.state.value?.number)
        emulator.waitUntil("o cartão da em espera") { showsTagWithText("cartao-espera", "Em espera") }
        assertTrue("R35: o ramal com o tempo no cartão: ${textsUnder("cartao-espera")}", hasLine("cartao-espera", HELD_LINE))
        // R39: com duas, o Desligar é o da ligação ativa (DuasLigacoes.dc.html:44).
        compose.onNodeWithTag("desligar").assertContentDescriptionEquals(HANG_UP_ACTIVE)
        emulator.saveScreen("duas-ligacoes.png")
        // Desligar a feita: a primeira volta sozinha; depois o registrador a desliga.
        compose.onNodeWithTag("desligar").performClick()
        emulator.waitUntil("a primeira de volta, sozinha") {
            app.calls.state.value?.let { it.id == first && it.second == null } == true
        }
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("a primeira acabar") { app.calls.state.value == null }
    }

    @Test
    fun theIncomingScreenCountsDownTheAutoAnswer() {
        // R7, R32 e R33: na recebida em tela cheia, a linha "Atender automático · em <n> s" conta os segundos desde que o
        // celular tocou, só enquanto o Atender automático vai atendê-la (com as configurações de agora); a notificação
        // mostra o tempo escolhido, uma vez. As fotos da recebida com e sem a linha (o quadro Recebida).
        emulator.useCanvasDisplay()
        app.callSettings.update { it.copy(autoAnswer = true, autoAnswerSeconds = 30) }
        val before = emulator.callLog().size
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a ligação tocando") { app.calls.state.value?.phase == CallPhase.RINGING }
        emulator.waitUntil("a notificação com o Atender automático", details = ::notifications) {
            callNotification()?.extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString() == "3001 · Atender automático · em 30 s"
        }
        openTheIncomingByItsNotification("Cliente Teste")
        emulator.waitUntil("a linha do Atender automático") { emulator.showsTag(AUTO_LINE) }
        assertTrue("o título da recebida", emulator.showsText("Ligação recebida · 2001"))
        assertTrue("R35: o ramal embaixo do nome", emulator.showsText("Ramal 3001"))
        val first = countdown()
        Thread.sleep(2_200)
        val later = countdown()
        assertTrue("a contagem desce de segundo em segundo ($first s, depois $later s)", later in 1..first - 2)
        emulator.saveScreen("recebida-atender.png")
        // O Não perturbe ligado na contagem: ninguém a atende sozinho, e a linha sai da tela e da notificação (R38: postada
        // de novo uma vez, sem a linha); desligado de novo, ela volta às duas.
        app.callSettings.update { it.copy(doNotDisturb = true) }
        emulator.waitUntil("a linha sair com o Não perturbe") { !emulator.showsTag(AUTO_LINE) }
        emulator.waitUntil("a notificação sem a linha", details = ::incomingDetails) { incomingText() == "3001" }
        app.callSettings.update { it.copy(doNotDisturb = false) }
        emulator.waitUntil("a linha de volta") { emulator.showsTag(AUTO_LINE) }
        emulator.waitUntil("a notificação com a linha de novo", details = ::incomingDetails) {
            incomingText() == "3001 · Atender automático · em 30 s"
        }
        // O Atender automático desligado: a linha sai das duas. A foto da recebida sem ela.
        app.callSettings.update { it.copy(autoAnswer = false) }
        emulator.waitUntil("a linha sair") { !emulator.showsTag(AUTO_LINE) }
        emulator.waitUntil("a notificação sem a linha", details = ::incomingDetails) { incomingText() == "3001" }
        emulator.saveScreen("recebida.png")
        assertEquals("ainda tocando", CallPhase.RINGING, app.calls.state.value?.phase)
        compose.onNodeWithTag("recusar").performClick()
        waitForLog(before, "inv-out 2001 486")
        emulator.waitUntil("a ligação acabar") { app.calls.state.value == null }
    }

    @Test
    fun theLargestFontKeepsTheCountdownAndTheNamesWhole() {
        // Spec 3.3, com a maior letra na tela de 320 dp (a do emulador do CI): a linha do Atender automático quebra em
        // linhas inteiras, com os segundos, e o nome de cada um dos dois cartões aparece inteiro (o selo desce para baixo
        // dele, como o "Em espera · transferência"). As fotos da recebida e das duas ligações com a letra grande.
        emulator.useDisplay(640, 1280, 320)
        emulator.setFontScale(2.0f)
        app.callSettings.update { it.copy(autoAnswer = true, autoAnswerSeconds = 30) }
        val before = emulator.callLog().size
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a notificação de ligação", details = ::notifications) { callNotification() != null }
        openTheIncomingByItsNotification("Cliente Teste")
        emulator.waitUntil("a linha do Atender automático") { emulator.showsTag(AUTO_LINE) }
        val line = drawnText(AUTO_LINE)
        val drawn = line.fetchSemanticsNode().config[SemanticsProperties.Text].joinToString("")
        assertTrue("a contagem com os segundos: \"$drawn\"", DRAWN_COUNTDOWN.matches(drawn))
        assertWhole("a linha do Atender automático", AUTO_LINE, line)
        emulator.saveScreen("recebida-letra-grande.png")
        compose.onNodeWithTag("recusar").performScrollTo().performClick()
        waitForLog(before, "inv-out 2001 486")
        emulator.waitUntil("a recebida acabar") { app.calls.state.value == null }
        // As duas ligações (sem o Atender automático): o nome inteiro em cada cartão.
        app.callSettings.update { it.copy(autoAnswer = false) }
        twoCalls()
        for (card in listOf("cartao-ativa", "cartao-espera")) assertWhole("o nome em $card", card, drawnText(card, "Cliente Teste"))
        emulator.saveScreen("duas-ligacoes-letra-grande.png")
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("a primeira de volta") { app.calls.state.value?.let { it.second == null } == true }
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("as ligações acabarem") { app.calls.state.value == null }
    }

    @Test
    fun theSecondCallConsultAndConferenceDraw() {
        // R19: as fotos da faixa da segunda ligação, da consulta e da conferência, na tela dos quadros.
        emulator.useCanvasDisplay()
        val client = answerOnTheCallScreen()
        var before = emulator.callLog().size
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a faixa da segunda ligação") { showsTagWithText("segunda-ligacao", "Ligação de Cliente Teste") }
        assertTrue("R35: o ramal na faixa: ${textsUnder("segunda-ligacao")}", "Ramal 3001" in textsUnder("segunda-ligacao"))
        compose.onNodeWithTag("desligar").assertContentDescriptionEquals(HANG_UP_ACTIVE)   // R39: a outra ainda toca
        // A notificação da chamada em espera desce no alto da tela por uns segundos (sem a tela cheia, ela sobe
        // sozinha), por cima da faixa: a foto espera ela subir.
        device.wait(Until.gone(By.pkg(SYSTEM_UI).text("Ligação de Cliente Teste")), 15_000)
        emulator.saveScreen("segunda-ligacao.png")
        compose.onNodeWithTag("recusar-segunda").performClick()
        waitForLog(before, "inv-out 2001 486")
        emulator.waitUntil("a faixa sair") { !emulator.showsTag("segunda-ligacao") }
        // A consulta: o colega em cima, e o cliente em espera para a transferência.
        consultOnTheCallScreen("2003", client)
        assertTrue("R35: o ramal do cliente: ${textsUnder("cartao-espera")}", hasLine("cartao-espera", HELD_LINE))
        compose.onNodeWithTag("desligar").assertContentDescriptionEquals(HANG_UP_ACTIVE)   // R39: desliga o colega
        emulator.saveScreen("consulta.png")
        before = emulator.callLog().size
        compose.onNodeWithTag("cancelar-consulta").performClick()
        waitForLog(before, "bye-in 2003")
        emulator.waitUntil("o cliente de volta, sozinho") {
            app.calls.state.value?.let { it.id == client && it.second == null && !it.held } == true
        }
        // A conferência: a Nova ligação e o Juntar.
        before = emulator.callLog().size
        compose.onNodeWithTag("nova-ligacao").performClick()
        compose.onNodeWithTag("nova-numero").performTextInput("2002")
        compose.onNodeWithTag("nova-ligar").performClick()
        waitForLog(before, "inv-in 2002 200")
        emulator.waitUntil("a nova ligação em cima, com a primeira em espera") { activeWith(held = client) }
        compose.onNodeWithTag("juntar").performClick()
        emulator.waitUntil("a Conferência") { showsTagWithText("conferencia", "Conferência") }
        assertTrue("R35: o ramal no cartão: ${textsUnder("participante")}", "Ramal 3001" in textsUnder("participante"))
        // Na conferência, o Desligar desliga as duas: só "Desligar".
        compose.onNodeWithTag("desligar").assert(hasText(HANG_UP))
        assertNull("o Desligar das duas", description("desligar"))
        emulator.saveScreen("conferencia.png")
        before = emulator.callLog().size
        compose.onNodeWithTag("desligar").performClick()
        waitForLog(before, "bye-in 3001")
        waitForLog(before, "bye-in 2002")
        emulator.waitUntil("as ligações acabarem") { app.calls.state.value == null }
    }

    @Test
    fun incomingCallShowsAtenderAndIsAnswered() {
        device.pressHome()
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a notificação de ligação", details = ::notifications) { callNotification() != null }
        tapSystemButton("Atender") { answered() }
        emulator.waitForText("Ramal 3001")   // a tela de chamada, com o número embaixo do nome como no Windows (R35)
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        emulator.waitUntil("o toque parar", details = ::notifications) { callNotification() == null }
        emulator.saveScreen("ligacao-pequena.png")   // na tela do emulador do CI (320 × 640 dp)
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
        compose.onNodeWithTag("transferir-agora").performClick()
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
    fun secondCallRingsAsABarAndIsAnswered() {
        val first = answerOnTheCallScreen()
        // O Transferir aberto na primeira é dela: não reabre sozinho na segunda, depois de atendida (abaixo).
        compose.onNodeWithTag("transferir").performClick()
        emulator.waitUntil("o número do Transferir") { emulator.showsTag("transferir-numero") }
        var before = emulator.callLog().size
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a faixa da segunda ligação") { showsTagWithText("segunda-ligacao", "Ligação de Cliente Teste") }
        // A chamada em espera: a notificação no canal sem som, sem a tela cheia e sem o toque que se repete (o app
        // bipa no som da ligação).
        emulator.waitUntil("a notificação da chamada em espera", details = ::notifications) { waitingNotification() }
        compose.onNodeWithTag("atender-segunda").performClick()
        emulator.waitUntil("a segunda atendida, com a primeira em espera") { activeWith(held = first) }
        emulator.waitUntil("o cartão da em espera") { showsTagWithText("cartao-espera", "Em espera") }
        emulator.saveScreen("duas-ligacoes-pequena.png")   // na tela do emulador do CI (320 × 640 dp)
        assertEquals("a faixa sai", false, emulator.showsTag("segunda-ligacao"))
        assertEquals("o Transferir da primeira na segunda", false, emulator.showsTag("transferir-numero"))
        emulator.waitUntil("a notificação da chamada em espera sair", details = ::notifications) { callNotification() == null }
        waitForLog(before, "reinv-in 3001 sendonly")   // a primeira em espera
        val second = app.calls.state.value!!.id
        // Alternar: a primeira volta para o cartão de cima (o motor a retoma), e a segunda vai para a espera.
        before = emulator.callLog().size
        compose.onNodeWithTag("alternar").performClick()
        emulator.waitUntil("a primeira no cartão de cima") { activeWith(held = second) && app.calls.state.value?.id == first }
        waitForLog(before, "reinv-in 3001 sendrecv")
        assertEquals("o cartão da em espera continua", true, showsTagWithText("cartao-espera", "Em espera"))
        // O registrador desliga a última que ele fez (a segunda, agora em espera): a tela volta a uma ligação.
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitForText("Cliente Teste desligou")
        emulator.waitUntil("a tela com uma ligação só") {
            app.calls.state.value?.let { it.id == first && it.second == null } == true && !emulator.showsTag("cartao-espera")
        }
        assertEquals(CallPhase.ACTIVE, app.calls.state.value?.phase)
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("a primeira acabar") { app.calls.state.value == null }
    }

    @Test
    fun theSecondCallRingsFullyWhenTheFirstEnds() {
        val first = answerOnTheCallScreen()
        val before = emulator.callLog().size
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a faixa da segunda ligação") { showsTagWithText("segunda-ligacao", "Ligação de Cliente Teste") }
        emulator.waitUntil("a notificação da chamada em espera", details = ::notifications) { waitingNotification() }
        // A primeira acaba com a segunda tocando: o Desligar da tela desliga a ativa, a primeira (o HANGUP do
        // registrador derrubaria a segunda, a última que ele fez).
        compose.onNodeWithTag("desligar").performClick()
        waitForLog(before, "bye-in 3001")
        emulator.waitUntil("a segunda tocando sozinha") {
            app.calls.state.value?.let { it.id != first && it.phase == CallPhase.RINGING && it.second == null } == true
        }
        // Ela passa a tocar como uma primeira ligação: o canal com o toque, a tela cheia e o toque que se repete.
        emulator.waitUntil("a notificação de ligação com o toque e a tela cheia", details = ::notifications) {
            callNotification()?.let {
                it.channelId == IncomingCallNotifier.CHANNEL_CALLS && it.fullScreenIntent != null &&
                    it.flags and Notification.FLAG_INSISTENT != 0
            } == true
        }
        emulator.waitUntil("o Atender da tela de chamada") { emulator.showsTag("atender") }
        assertEquals("sem a faixa", false, emulator.showsTag("segunda-ligacao"))
        // Recusar: ocupado, e o toque para.
        compose.onNodeWithTag("recusar").performClick()
        waitForLog(before, "inv-out 2001 486")
        emulator.waitUntil("a ligação acabar") { app.calls.state.value == null }
        emulator.waitUntil("o toque parar", details = ::notifications) { callNotification() == null }
    }

    @Test
    fun hangingUpTheActiveCallResumesTheHeldOne() {
        val (first, _) = twoCalls()
        val before = emulator.callLog().size
        compose.onNodeWithTag("desligar").performClick()
        waitForLog(before, "bye-in 3001")
        // A em espera volta sozinha: o motor a retoma (sendrecv), e a tela mostra uma ligação só.
        waitForLog(before, "reinv-in 3001 sendrecv")
        emulator.waitUntil("a primeira de volta, sozinha") {
            app.calls.state.value?.let { it.id == first && it.second == null && !it.held && it.phase == CallPhase.ACTIVE } == true
        }
        emulator.waitUntil("o cartão da em espera sumir") { !emulator.showsTag("cartao-espera") }
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("a primeira acabar") { app.calls.state.value == null }
    }

    @Test
    fun thirdCallDuringTwoCallsGetsBusy() {
        val (first, second) = twoCalls()
        val before = emulator.callLog().size
        val recents = app.recents.list().size
        assertEquals("OK", emulator.control("RING 2001"))
        waitForLog(before, "inv-out 2001 486")
        emulator.waitUntil("a terceira como perdida no Recentes") {
            val list = app.recents.list()
            list.size == recents + 1 && list.first().kind == CallKind.PERDIDA
        }
        assertEquals("as duas seguem", true, activeWith(held = first) && app.calls.state.value?.id == second)
        assertEquals("sem a faixa", false, emulator.showsTag("segunda-ligacao"))
        // O registrador desliga as duas (a segunda primeiro: a primeira volta sozinha, e depois sai).
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("a primeira de volta") { app.calls.state.value?.let { it.id == first && it.second == null } == true }
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("as ligações acabarem") { app.calls.state.value == null }
    }

    @Test
    fun newCallFromTheCallScreenHoldsTheFirst() {
        val first = answerOnTheCallScreen()
        val before = emulator.callLog().size
        compose.onNodeWithTag("nova-ligacao").performClick()
        compose.onNodeWithTag("nova-numero").performTextInput("2002")
        compose.onNodeWithTag("nova-ligar").performClick()
        // O motor põe a primeira em espera no makeCall e liga para o 2002 (o registrador atende).
        waitForLog(before, "reinv-in 3001 sendonly")
        waitForLog(before, "inv-in 2002 200")
        emulator.waitUntil("a nova ligação em cima, com a primeira em espera") { activeWith(held = first) }
        emulator.waitUntil("o cartão da em espera") { showsTagWithText("cartao-espera", "Em espera") }
        assertEquals("2002", app.calls.state.value?.number)
        // Desligar a nova: a primeira volta sozinha; depois o registrador a desliga.
        compose.onNodeWithTag("desligar").performClick()
        emulator.waitUntil("a primeira de volta, sozinha") {
            app.calls.state.value?.let { it.id == first && it.second == null } == true
        }
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("a primeira acabar") { app.calls.state.value == null }
    }

    @Test
    fun attendedTransferCompletesAndEndsBothCalls() {
        val client = answerOnTheCallScreen()
        val before = emulator.callLog().size
        consultOnTheCallScreen("2003", client)
        compose.onNodeWithTag("concluir-transferencia").performClick()
        // O REFER com Replaces vai na ligação do cliente (o 3001 das ligações do RING), apontando para o colega.
        waitForLog(before, "refer-in 3001 2003 replaces=known")
        // O registrador aceita (NOTIFY 200), e o motor desliga as duas: a tela de chamada fecha.
        emulator.waitUntil("a tela de chamada fechar") { app.calls.state.value == null && !emulator.showsTag("chamada") }
        waitForLog(before, "bye-in 3001")
        waitForLog(before, "bye-in 2003")
        emulator.waitUntil("as duas no Recentes", details = { "Recentes: ${app.recents.list()}" }) {
            app.recents.list().map { it.number to it.kind }.toSet() == setOf("3001" to CallKind.RECEBIDA, "2003" to CallKind.FEITA)
        }
    }

    @Test
    fun attendedTransferRefusedKeepsBothCalls() {
        val client = answerOnTheCallScreen()
        try {
            assertEquals("OK", emulator.control("REFER_REPLY 603"))
            val before = emulator.callLog().size
            consultOnTheCallScreen("2003", client)
            val colleague = app.calls.state.value!!.id
            compose.onNodeWithTag("concluir-transferencia").performClick()
            waitForLog(before, "refer-in 3001 2003 replaces=known")
            emulator.waitUntil("o aviso da recusa") {
                showsTagWithText("aviso-ligacao", "O servidor não aceitou a transferência.")
            }
            assertEquals("as duas continuam", true, activeWith(held = client) && app.calls.state.value?.id == colleague)
            assertEquals("a consulta continua", true, showsTagWithText("cartao-espera", "Em espera · transferência"))
            emulator.saveScreen("consulta-pequena.png")   // na tela do emulador do CI (320 × 640 dp)
            assertEquals("nenhum BYE", emptyList<String>(), emulator.callLog().drop(before).filter { it.startsWith("bye-in") })
            // Cancelar: o colega sai, e o cliente volta sozinho.
            compose.onNodeWithTag("cancelar-consulta").performClick()
            waitForLog(before, "bye-in 2003")
            waitForLog(before, "reinv-in 3001 sendrecv")
            emulator.waitUntil("o cliente de volta, sozinho") {
                app.calls.state.value?.let { it.id == client && it.second == null && !it.held && it.consult == null } == true
            }
            assertEquals("OK", emulator.control("HANGUP 2001"))
            emulator.waitUntil("o cliente acabar") { app.calls.state.value == null }
        } finally {
            emulator.control("RESET")
        }
    }

    @Test
    fun conferenceJoinsTwoCallsAndSplits() {
        val first = answerOnTheCallScreen()
        var before = emulator.callLog().size
        compose.onNodeWithTag("nova-ligacao").performClick()
        compose.onNodeWithTag("nova-numero").performTextInput("2002")
        compose.onNodeWithTag("nova-ligar").performClick()
        waitForLog(before, "inv-in 2002 200")
        emulator.waitUntil("a nova ligação em cima, com a primeira em espera") { activeWith(held = first) }
        val second = app.calls.state.value!!.id
        // Juntar: o motor retoma a primeira (o 3001 das ligações do RING), e a tela vira a Conferência.
        before = emulator.callLog().size
        compose.onNodeWithTag("juntar").performClick()
        waitForLog(before, "reinv-in 3001 sendrecv")
        emulator.waitUntil("a Conferência") { showsTagWithText("conferencia", "Conferência") }
        assertEquals(true, app.calls.state.value?.conference)
        assertEquals("os dois na tela", true, emulator.showsText("Cliente Teste") && emulator.showsText("2002"))
        assertEquals("sem o cartão da em espera", false, emulator.showsTag("cartao-espera"))
        // Separar: a última que entrou (a feita) vai para a espera, e a primeira volta ao cartão de cima.
        before = emulator.callLog().size
        compose.onNodeWithTag("separar").performClick()
        waitForLog(before, "reinv-in 2002 sendonly")
        emulator.waitUntil("o cartão da em espera") { showsTagWithText("cartao-espera", "Em espera") }
        emulator.waitUntil("a primeira em cima, com a feita em espera") {
            activeWith(held = second) && app.calls.state.value?.id == first
        }
        assertEquals("sem a Conferência", false, emulator.showsTag("conferencia"))
        // Juntar de novo e Desligar: o telefone desliga as duas.
        before = emulator.callLog().size
        compose.onNodeWithTag("juntar").performClick()
        waitForLog(before, "reinv-in 2002 sendrecv")
        emulator.waitUntil("a Conferência de novo") { showsTagWithText("conferencia", "Conferência") }
        compose.onNodeWithTag("desligar").performClick()
        waitForLog(before, "bye-in 3001")
        waitForLog(before, "bye-in 2002")
        emulator.waitUntil("as ligações acabarem") { app.calls.state.value == null }
        emulator.waitUntil("as duas no Recentes", details = { "Recentes: ${app.recents.list()}" }) {
            app.recents.list().map { it.number to it.kind }.toSet() == setOf("3001" to CallKind.RECEBIDA, "2002" to CallKind.FEITA)
        }
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

    // O app aberto com uma conta que nunca registra: o servidor em 127.0.0.1, o próprio emulador, onde nada escuta a
    // porta do SIP. (Com a senha errada, o app iria para a tela Entrar: a senha recusada pelo servidor, spec 7.1.7.)
    private fun openWithoutRegistration() {
        scenario?.close()
        emulator.startClean()
        app.store.save(Account("127.0.0.1", Transport.TCP, "2001", emulator.senha))
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitUntil("a tela principal sem registro") { emulator.showsTag("aba-teclado") }
        assertEquals("sem registro", false, app.connection.registered.value)
    }

    // O registrador liga e a ligação é atendida no Atender da tela de chamada (aberta com o app na frente, como pelo
    // toque na notificação): o id dela. Volta com o áudio já fora do modo do toque: o app lê o MODE_RINGTONE como uma
    // ligação da operadora tocando, e o nosso próprio toque fica nele até o Telecom trocar o modo, um pouco depois do
    // atender; uma segunda ligação nesse meio-tempo sairia como perdida (run 40435909397).
    private fun answerOnTheCallScreen(): Int {
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a ligação tocando") { app.calls.state.value?.phase == CallPhase.RINGING }
        app.startActivity(CallActivity.intent(app))
        emulator.waitUntil("o Atender da tela de chamada") { emulator.showsTag("atender") }
        compose.onNodeWithTag("atender").performScrollTo().performClick()   // com a letra grande, a tela rola
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        emulator.waitUntil("o toque parar", details = ::notifications) { callNotification() == null }
        emulator.waitUntil("o áudio no modo da ligação", details = { "Modo do áudio: ${audio.mode}" }) {
            audio.mode.let { it != AudioManager.MODE_RINGTONE && it != AudioManager.MODE_IN_CALL }
        }
        return app.calls.state.value!!.id
    }

    // A recebida em tela cheia aberta como pela pessoa com o celular em uso: o Android mostra a recebida no alto da tela
    // (a notificação de título [title] e texto começando por [text]), e o toque nela abre a tela cheia e a recolhe.
    // Aberta por fora (o startActivity), a tela cheia ficaria com a notificação por cima, nas fotos. Com a letra grande,
    // o título some da notificação, e o toque é no texto. Sem a notificação no alto, por fora.
    private fun openTheIncomingByItsNotification(title: String, text: String = "3001") {
        val anchors = listOf(By.pkg(SYSTEM_UI).text(title), By.pkg(SYSTEM_UI).textStartsWith(text))
        repeat(3) {
            val found = anchors.firstNotNullOfOrNull { device.wait(Until.findObject(it), 5_000) }
            if (found == null) {
                app.startActivity(CallActivity.intent(app))
                return
            }
            device.waitForIdle()
            found.click()
            if (within(5_000) { emulator.showsTag("chamada") }) {
                for (anchor in anchors) device.wait(Until.gone(anchor), 5_000)
                return
            }
        }
        throw AssertionError("A notificação da recebida não abriu a tela cheia.\nNa tela: ${visibleTexts()}\n${notifications()}")
    }

    // Duas ligações do registrador: a primeira atendida na tela de chamada, e a segunda pela faixa, com a primeira em
    // espera. Os ids: a primeira e a segunda.
    private fun twoCalls(): Pair<Int, Int> {
        val first = answerOnTheCallScreen()
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a faixa da segunda ligação") { showsTagWithText("segunda-ligacao", "Ligação de Cliente Teste") }
        compose.onNodeWithTag("atender-segunda").performClick()
        emulator.waitUntil("a segunda atendida, com a primeira em espera") { activeWith(held = first) }
        emulator.waitUntil("o cartão da em espera") { showsTagWithText("cartao-espera", "Em espera") }
        return first to app.calls.state.value!!.id
    }

    // Na tela de chamada, com o cliente [client] em andamento: Transferir, o número [number] e Consultar. O motor põe o
    // cliente em espera e liga para o colega, que o registrador atende: o colega em cima e o cliente no cartão "Em
    // espera · transferência".
    private fun consultOnTheCallScreen(number: String, client: Int) {
        val before = emulator.callLog().size
        compose.onNodeWithTag("transferir").performClick()
        compose.onNodeWithTag("transferir-numero").performTextInput(number)
        compose.onNodeWithTag("transferir-consultar").performClick()
        waitForLog(before, "reinv-in 3001 sendonly")
        waitForLog(before, "inv-in $number 200")
        emulator.waitUntil("o colega em cima, com o cliente em espera") {
            activeWith(held = client) && app.calls.state.value?.consult?.colleagueActive == true
        }
        emulator.waitUntil("o cartão do cliente") { showsTagWithText("cartao-espera", "Em espera · transferência") }
    }

    // Os textos do elemento [tag] (os dele e os de dentro, como o leitor de tela os lê); vazio sem ele na frente.
    private fun tagTexts(tag: String): List<String> =
        try {
            compose.onNodeWithTag(tag).fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.map { it.text }.orEmpty()
        } catch (e: AssertionError) {
            emptyList()
        } catch (e: IllegalStateException) {
            emptyList()
        }

    // O título da notificação fixa, para as falhas.
    private fun notificationTitle(): String = "Título da notificação fixa: ${emulator.connectionNotificationTitle()}"

    // O nome do elemento [tag] para o leitor de tela, ou null sem ele na frente.
    private fun description(tag: String): String? =
        try {
            compose.onNodeWithTag(tag).fetchSemanticsNode().config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString()
        } catch (e: AssertionError) {
            null
        } catch (e: IllegalStateException) {
            null
        }

    // Os segundos que faltam na linha do Atender automático da recebida ("Atender automático · em <n> s").
    private fun countdown(): Int {
        val line = tagTexts(AUTO_LINE).joinToString()
        return COUNTDOWN.matchEntire(line)?.groupValues?.get(1)?.toInt()
            ?: throw AssertionError("a linha do Atender automático: \"$line\"")
    }

    // O texto da notificação da recebida (o que vem embaixo do nome), para as esperas e as falhas.
    private fun incomingText(): String? = callNotification()?.extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString()

    private fun incomingDetails(): String = "Texto da notificação da recebida: ${incomingText()}"

    // Os textos de tudo o que está dentro dos elementos [tag] (na árvore sem a fusão), na ordem; nenhum sem a tela.
    private fun textsUnder(tag: String): List<String> =
        try {
            compose.onAllNodes(hasAnyAncestor(hasTestTag(tag)), useUnmergedTree = true).fetchSemanticsNodes()
                .flatMap { node -> node.config.getOrNull(SemanticsProperties.Text)?.map { it.text }.orEmpty() }
        } catch (e: IllegalStateException) {
            emptyList()
        }

    // Algum texto dentro dos elementos [tag] é a [line] inteira.
    private fun hasLine(tag: String, line: Regex): Boolean = textsUnder(tag).any(line::matches)

    // O texto desenhado dentro do elemento [tag]: o [text], ou o único que há (o do selo, que o esconde do leitor de
    // tela: ele só aparece na árvore sem a fusão).
    private fun drawnText(tag: String, text: String? = null): SemanticsNodeInteraction {
        val inside = compose.onNodeWithTag(tag, useUnmergedTree = true).onChildren()
        return inside.filterToOne(if (text == null) SemanticsMatcher.keyIsDefined(SemanticsProperties.Text) else hasText(text))
    }

    // O texto do nó [node] desenhado inteiro dentro do elemento [container]: todo ele nas linhas, sem reticências, quebrando
    // só nos espaços (nunca no meio de uma palavra) e com a caixa dentro da do elemento. O hasVisualOverflow não serve: o
    // TextLayoutResult que a semântica de um Text simples refaz usa a largura máxima que ele recebeu, e um texto mais curto
    // que ela (o nome de um cartão numa linha só) sai como transbordando. A falha mostra as linhas e as caixas.
    private fun assertWhole(what: String, container: String, node: SemanticsNodeInteraction) {
        val semantics = node.fetchSemanticsNode()
        val text = semantics.config[SemanticsProperties.Text].joinToString("")
        val results = mutableListOf<TextLayoutResult>()
        node.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(results) }
        val layout = results.single()
        val lines = (0 until layout.lineCount).map { text.substring(layout.getLineStart(it), layout.getLineEnd(it)) }
        val brokenWord = (0 until layout.lineCount - 1).any { line ->
            val end = layout.getLineEnd(line)
            end in 1 until text.length && !text[end - 1].isWhitespace() && !text[end].isWhitespace()
        }
        val box = Rect(semantics.positionInRoot, semantics.size.toSize())
        val outer = compose.onNodeWithTag(container, useUnmergedTree = true).fetchSemanticsNode()
            .let { Rect(it.positionInRoot, it.size.toSize()) }
        val inside = box.left >= outer.left - 1 && box.top >= outer.top - 1 && box.right <= outer.right + 1 &&
            box.bottom <= outer.bottom + 1
        val whole = !brokenWord && inside && layout.getLineEnd(layout.lineCount - 1) == text.length &&
            (0 until layout.lineCount).none(layout::isLineEllipsized)
        assertTrue(
            "$what inteiro: \"$text\" desenhado como ${lines.joinToString(" | ") { "\"$it\"" }}, em $box (em $container: $outer)",
            whole,
        )
    }

    // Espera a [condition] (como o Emulator.waitUntil) e diz quando ela passou a valer (SystemClock.uptimeMillis).
    private fun timeOf(what: String, condition: () -> Boolean): Long {
        emulator.waitUntil(what, condition = condition)
        return SystemClock.uptimeMillis()
    }

    // O aviso sem som de uma perdida no Não perturbe (o canal dele), ou null.
    private fun silentMissed(): Notification? =
        app.getSystemService(NotificationManager::class.java).activeNotifications
            .firstOrNull { it.notification.channelId == IncomingCallNotifier.CHANNEL_MISSED_SILENT }?.notification

    // O serviço em primeiro plano como o Android o vê agora (os tipos e o uso do microfone, do dumpsys) e as recusas do
    // Android ao pôr o serviço em primeiro plano (o logcat do SipService), para a nota do risco 12 da spec.
    private fun foregroundService(): String {
        val dump = emulator.shell("dumpsys activity services br.com.starsonic.phone/.service.SipService").map { it.trim() }
        val wanted = dump.filter { line -> FGS_KEYS.any { line.contains(it, ignoreCase = true) } }.distinct().take(8)
        val refused = emulator.shell("logcat -d -v brief -s SipService:W").count { "não entrou em primeiro plano" in it }
        return "${wanted.joinToString(" | ").take(600)}; recusas do primeiro plano no logcat: $refused"
    }

    // A notificação da chamada em espera: no canal sem som, sem a tela cheia e sem o toque que se repete.
    private fun waitingNotification(): Boolean =
        callNotification()?.let {
            it.channelId == IncomingCallNotifier.CHANNEL_SILENCED && it.fullScreenIntent == null &&
                it.flags and Notification.FLAG_INSISTENT == 0
        } == true

    // A ligação de cima em andamento, e a ligação [held] em espera no cartão de baixo.
    private fun activeWith(held: Int): Boolean =
        app.calls.state.value?.let {
            it.phase == CallPhase.ACTIVE && it.id != held && it.second?.id == held && it.second?.kind == SecondKind.HELD
        } == true

    // Uma tela do app na frente tem o elemento [tag] com o texto [text] (nele ou dentro dele).
    private fun showsTagWithText(tag: String, text: String): Boolean =
        try {
            compose.onAllNodes(hasTestTag(tag) and (hasText(text) or hasAnyDescendant(hasText(text))), useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        } catch (e: IllegalStateException) {
            false   // sem nenhuma tela do Compose na frente
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

    // A notificação de ligação do app (canal "ligacoes", ou o da ligação silenciada), ou null. O resumo que o
    // Android cria sozinho ao agrupar as notificações do app (sem título, no canal de uma delas) não conta.
    private fun callNotification(): Notification? =
        app.getSystemService(NotificationManager::class.java).activeNotifications
            .firstOrNull {
                it.notification.channelId in CALL_CHANNELS && it.notification.flags and Notification.FLAG_GROUP_SUMMARY == 0
            }?.notification

    // A ligação do app e as notificações dele (canal/título/tipo de ligação), para as falhas.
    private fun notifications(): String {
        val shown = app.getSystemService(NotificationManager::class.java).activeNotifications.joinToString {
            val extras = it.notification.extras
            val summary = if (it.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) "(resumo)" else ""
            "${it.notification.channelId}$summary/${extras.getCharSequence(Notification.EXTRA_TITLE)}" +
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
        private val MISSED_CHANNELS = setOf(IncomingCallNotifier.CHANNEL_MISSED, IncomingCallNotifier.CHANNEL_MISSED_SILENT)

        // As etiquetas novas das telas da ligação: a linha do status no alto, a do Atender automático na recebida e o
        // Rediscar da Nova ligação.
        private const val CALL_STATUS = "status-ligacao"
        private const val AUTO_LINE = "atender-em"
        private const val REDIAL_NEW = "rediscar-nova"
        private val COUNTDOWN = Regex("Atender automático · em (\\d+) s")

        // O Desligar de uma ligação e o de duas (R39), e a linha do cartão do cliente (R35: o ramal e o tempo).
        private const val HANG_UP = "Desligar"
        private const val HANG_UP_ACTIVE = "Desligar a ligação ativa"
        private val HELD_LINE = Regex("Ramal 3001 · \\d\\d:\\d\\d")

        // A linha do Atender automático como é desenhada (o selo, em maiúsculas), com os segundos.
        private val DRAWN_COUNTDOWN = Regex("ATENDER AUTOMÁTICO · EM \\d+ S")

        // O que a nota do risco 12 tira do dumpsys do serviço: se está em primeiro plano, os tipos e o microfone.
        private val FGS_KEYS = listOf("isForeground", "types=", "foregroundServiceType", "WhileInUse")

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
