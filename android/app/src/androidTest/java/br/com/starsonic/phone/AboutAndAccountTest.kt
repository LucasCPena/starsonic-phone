package br.com.starsonic.phone

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.core.content.IntentCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.Intents.intended
import androidx.test.espresso.intent.Intents.intending
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import androidx.test.espresso.intent.matcher.IntentMatchers.hasData
import androidx.test.espresso.intent.matcher.IntentMatchers.isInternal
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import br.com.starsonic.phone.call.CallPhase
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.data.CallKind
import br.com.starsonic.phone.data.Recent
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.main.MainActivity
import br.com.starsonic.phone.service.SipService
import org.hamcrest.CoreMatchers.allOf
import org.hamcrest.CoreMatchers.not
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * O menu do cabeçalho, a tela Sobre, o diagnóstico e, nas Configurações, o Editar e o Sair no emulador (spec 3.3, 4.1,
 * 6.4, 7.1 e 8), com o motor de verdade e o registrador falso do CI (ver [Emulator]). O que sai do app (os links do
 * Sobre e o compartilhar do diagnóstico) fica no lugar pelo Espresso-Intents: o teste confere o pedido, e nada abre de
 * verdade.
 *
 * Cada teste começa com a conta gravada por TCP e o app aberto e conectado (o CI confere que o último REGISTER aceito
 * veio por TCP: o último teste, em ordem alfabética, registra por TCP ao começar). Os testes que trocam a senha no
 * registrador (PASSWORD) devolvem a senha certa no fim, mesmo quando falham.
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class AboutAndAccountTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val emulator = Emulator(compose)
    private val app = emulator.app
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private val account by lazy { Account(emulator.registrar, Transport.TCP, "2001", emulator.senha) }
    private var scenario: ActivityScenario<MainActivity>? = null
    private var recording = false

    @Before
    fun connect() {
        // A tela acesa e sem bloqueio, como num celular em uso.
        device.wakeUp()
        device.executeShellCommand("svc power stayon true")
        device.executeShellCommand("wm dismiss-keyguard")
        emulator.startClean()
        app.store.save(account)
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitForText("Conectado · ${emulator.registrar}")
        Intents.init()
        recording = true
    }

    @After
    fun close() {
        if (recording) Intents.release()
        // Uma ligação que sobrou de um teste que falhou acaba aqui (a do registrador, e a do app).
        if (app.calls.state.value != null) {
            emulator.control("HANGUP 2001")
            app.calls.hangup()
        }
        scenario?.close()
        // A abertura pelo ícone pode criar outra MainActivity, fora do ActivityScenario: ela sai também, e o próximo
        // teste começa só com a dele.
        emulator.waitUntil("as telas do app fecharem") { emulator.finishMainActivities() == 0 }
    }

    @Test
    fun aboutLinksOpenTheSiteWhatsappTheDialerAndTheSourceCode() {
        // Nada abre de verdade: o pedido para fora do app fica no lugar.
        intending(not(isInternal())).respondWith(Instrumentation.ActivityResult(Activity.RESULT_OK, null))
        emulator.openMenu("menu-sobre")
        emulator.waitForText("starsonic.com.br")
        emulator.waitForText("(11) 5060-3000")
        click("site")
        intended(allOf(hasAction(Intent.ACTION_VIEW), hasData("https://starsonic.com.br/")))
        click("whatsapp")
        intended(allOf(hasAction(Intent.ACTION_VIEW), hasData("https://wa.me/551150603000")))
        click("suporte")
        intended(allOf(hasAction(Intent.ACTION_DIAL), hasData("tel:+551150603000")))
        click("codigo-fonte")
        intended(allOf(hasAction(Intent.ACTION_VIEW), hasData("https://github.com/LucasCPena/starsonic-phone")))
    }

    @Test
    fun aboutShowsVersionLicenseAndCredits() {
        emulator.openMenu("menu-sobre")
        // A versão do build (0.0.0 no CI).
        emulator.waitForText("Starsonic Phone ${BuildConfig.VERSION_NAME}")
        emulator.waitForText("Licença GPL v3")
        emulator.waitForText("Usa o PJSIP (GPL v2 ou posterior) e o Opus (BSD).")
        emulator.waitForText("Enviar diagnóstico")
    }

    @Test
    fun editAccountKeepsTheFieldsAndAsksThePasswordAgain() {
        val before = emulator.registers()
        openAccount("config-editar")
        emulator.waitUntil("a tela Entrar do Editar") { emulator.showsTag("entrar") }
        compose.onNodeWithTag("servidor").assert(hasText(emulator.registrar))
        compose.onNodeWithTag("protocolo-tcp").assertIsSelected()
        compose.onNodeWithTag("ramal").assert(hasText("2001"))
        assertEquals("a senha vazia", "", emulator.editableText("senha"))
        // A conta nova vai por UDP: o status só volta a "Conectado" se o serviço passar a segurar a conta nova.
        compose.onNodeWithTag("protocolo-udp").performScrollTo().performClick()
        compose.onNodeWithTag("protocolo-udp").assertIsSelected()
        compose.onNodeWithTag("senha").performScrollTo().performTextInput(emulator.senha)
        // A senha é o primeiro campo tocado: o teclado do celular abre agora, e o toque no Entrar espera ele subir.
        emulator.waitForTheKeyboard("entrar")
        compose.onNodeWithTag("entrar").performScrollTo().performClick()
        emulator.waitUntil("a tela principal") { emulator.showsTag("aba-teclado") }
        emulator.waitForText("Conectado · ${emulator.registrar}")
        assertFalse("sem a tela Permissões no Editar", emulator.showsTag("continuar"))
        assertEquals(account.copy(transport = Transport.UDP), app.store.load())
        // O serviço ficou com a conta que o Editar registrou: nenhum REGISTER a mais.
        Thread.sleep(3_000)
        assertEquals("REGISTER aceitos do ramal 2001", before + 1, emulator.registers())
    }

    @Test
    fun passwordChangedOnTheServerSendsTheUserToEntrar() {
        assertEquals("resposta a PASSWORD", "OK", emulator.control("PASSWORD outra"))
        try {
            // A renovação do registro (a cada 300 s), agora.
            assertTrue("o serviço de pé", SipService.reregister())
            emulator.waitUntil("a tela Entrar com o aviso") { emulator.showsTag("entrar") && emulator.showsTag("aviso") }
            compose.onNodeWithTag("aviso").assert(hasText("Ramal ou senha incorretos."))
            compose.onNodeWithTag("servidor").assert(hasText(emulator.registrar))
            compose.onNodeWithTag("ramal").assert(hasText("2001"))
            assertEquals("a senha vazia", "", emulator.editableText("senha"))
            assertEquals("a conta continua gravada", account, app.store.load())
            assertTrue("o serviço continua de pé", SipService.running)
            // Uma vez por falha: quem sai da tela não volta para ela até uma falha nova.
            device.pressBack()
            emulator.waitUntil("a tela principal") { emulator.showsTag("aba-teclado") }
            Thread.sleep(2_000)
            assertFalse("a tela Entrar de novo, sem uma falha nova", emulator.showsTag("entrar"))
        } finally {
            assertEquals("resposta a PASSWORD", "OK", emulator.control("PASSWORD ${emulator.senha}"))
        }
    }

    @Test
    fun passwordRefusedDuringACallWaitsForTheCallToEnd() {
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a ligação tocando") { app.calls.state.value?.phase == CallPhase.RINGING }
        app.calls.answer()
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        assertEquals("resposta a PASSWORD", "OK", emulator.control("PASSWORD outra"))
        try {
            assertTrue("o serviço de pé", SipService.reregister())
            // A faixa mostra o aviso, mas a tela Entrar espera a ligação acabar.
            emulator.waitForText("Ramal ou senha incorretos.")
            Thread.sleep(2_000)
            assertFalse("a tela Entrar no meio da ligação", emulator.showsTag("entrar"))
            assertEquals("OK", emulator.control("HANGUP 2001"))
            emulator.waitUntil("a ligação acabar") { app.calls.state.value == null }
            emulator.waitUntil("a tela Entrar com o aviso") { emulator.showsTag("entrar") && emulator.showsTag("aviso") }
            compose.onNodeWithTag("aviso").assert(hasText("Ramal ou senha incorretos."))
        } finally {
            assertEquals("resposta a PASSWORD", "OK", emulator.control("PASSWORD ${emulator.senha}"))
        }
    }

    @Test
    fun passwordRefusedInTheBackgroundOpensEntrarOnTheNextOpening() {
        device.pressHome()
        assertEquals("resposta a PASSWORD", "OK", emulator.control("PASSWORD outra"))
        try {
            assertTrue("o serviço de pé", SipService.reregister())
            // Com o app em segundo plano, a notificação fixa mostra o aviso.
            emulator.waitUntil("o aviso na notificação fixa") {
                emulator.connectionNotificationTitle() == "Ramal ou senha incorretos."
            }
            assertTrue("o serviço continua de pé", SipService.running)
            assertEquals("a conta continua gravada", account, app.store.load())
            // A próxima abertura do app (como pelo ícone) vai para a tela Entrar, com o aviso.
            val open = app.packageManager.getLaunchIntentForPackage(app.packageName)!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            app.startActivity(open)
            emulator.waitUntil("a tela Entrar com o aviso") { emulator.showsTag("entrar") && emulator.showsTag("aviso") }
            compose.onNodeWithTag("aviso").assert(hasText("Ramal ou senha incorretos."))
        } finally {
            assertEquals("resposta a PASSWORD", "OK", emulator.control("PASSWORD ${emulator.senha}"))
        }
    }

    @Test
    fun passwordRefusedLetsTheProcessorSleepUntilTheAccountRegistersAgain() {
        // Conectado, o processador fica acordado (spec 7.2, item 6). Com o celular no bolso (o app em segundo plano), a
        // renovação leva a senha recusada, que o motor não tenta de novo: nada a renovar, e o processador dorme.
        emulator.waitUntil("o processador acordado com a conta conectada") { emulator.connectionWakeLockHeld() }
        device.pressHome()
        assertEquals("resposta a PASSWORD", "OK", emulator.control("PASSWORD outra"))
        try {
            assertTrue("o serviço de pé", SipService.reregister())
            emulator.waitUntil("o aviso na notificação fixa") {
                emulator.connectionNotificationTitle() == "Ramal ou senha incorretos."
            }
            emulator.waitUntil("o processador solto depois da senha recusada") { !emulator.connectionWakeLockHeld() }
            assertTrue("o serviço continua de pé", SipService.running)
        } finally {
            assertEquals("resposta a PASSWORD", "OK", emulator.control("PASSWORD ${emulator.senha}"))
        }
        // A senha volta a valer no servidor: o próximo registro (aqui, a renovação pedida à mão) acorda o processador.
        assertTrue("o serviço de pé", SipService.reregister())
        emulator.waitUntil("a notificação \"Conectado (ramal 2001)\"") {
            emulator.connectionNotificationTitle() == "Conectado (ramal 2001)"
        }
        emulator.waitUntil("o processador acordado de novo") { emulator.connectionWakeLockHeld() }
    }

    @Test
    fun passwordRefusedWithTheEditorOpenShowsTheMessage() {
        openAccount("config-editar")
        emulator.waitUntil("o Editar") { emulator.showsTag("entrar") }
        assertFalse("o Editar do menu abre sem aviso", emulator.showsTag("aviso"))
        assertEquals("resposta a PASSWORD", "OK", emulator.control("PASSWORD outra"))
        try {
            assertTrue("o serviço de pé", SipService.reregister())
            emulator.waitUntil("o aviso no Editar aberto") { emulator.showsTag("aviso") }
            compose.onNodeWithTag("aviso").assert(hasText("Ramal ou senha incorretos."))
        } finally {
            assertEquals("resposta a PASSWORD", "OK", emulator.control("PASSWORD ${emulator.senha}"))
        }
    }

    @Test
    fun sendDiagnosticsOpensTheShareSheetWithoutThePassword() {
        intending(hasAction(Intent.ACTION_CHOOSER)).respondWith(Instrumentation.ActivityResult(Activity.RESULT_OK, null))
        emulator.openMenu("menu-sobre")
        emulator.waitUntil("o Enviar diagnóstico") { emulator.showsTag("enviar-diagnostico") }
        click("enviar-diagnostico")
        val chooser = sentIntent(Intent.ACTION_CHOOSER)
        val send = IntentCompat.getParcelableExtra(chooser, Intent.EXTRA_INTENT, Intent::class.java)!!
        assertEquals(Intent.ACTION_SEND, send.action)
        assertEquals("text/plain", send.type)
        assertTrue("com a permissão de leitura", send.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        val uri = IntentCompat.getParcelableExtra(send, Intent.EXTRA_STREAM, Uri::class.java)!!
        assertEquals("o FileProvider do app", "${app.packageName}.arquivos", uri.authority)
        val text = app.contentResolver.openInputStream(uri)!!.use { String(it.readBytes(), Charsets.UTF_8) }
        assertTrue("o log do motor está no arquivo", "REGISTER" in text)
        assertFalse("a senha do teste não está no arquivo", emulator.senha in text)
        assertFalse("nem a resposta Digest do REGISTER", DIGEST_RESPONSE.containsMatchIn(text))
        assertTrue("o REGISTER com o Authorization chegou, com a resposta escondida", "response=\"…\"" in text)
    }

    @Test
    fun signOutDuringACallEndsTheCall() {
        app.recents.clear()
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a ligação tocando") { app.calls.state.value?.phase == CallPhase.RINGING }
        app.calls.answer()
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        val before = emulator.callLog().size
        openAccount("config-sair")
        compose.onNodeWithTag("sair-confirmar").performClick()
        emulator.waitUntil("a ligação acabar") { app.calls.state.value == null }
        emulator.waitUntil("o BYE no LOG do registrador", details = { "LOG: ${emulator.callLog().drop(before)}" }) {
            "bye-in 3001" in emulator.callLog().drop(before)
        }
        emulator.waitUntil("a tela Entrar") { emulator.showsTag("entrar") }
        emulator.waitUntil("a recebida no Recentes") { app.recents.list().firstOrNull()?.kind == CallKind.RECEBIDA }
        emulator.waitUntil("o serviço parar") { !SipService.running }
    }

    @Test
    fun signOutReturnsToEntrarAndKeepsTheRecents() {
        app.recents.add(Recent("2002", "", CallKind.FEITA, System.currentTimeMillis(), 0))
        val recents = app.recents.list()
        emulator.clearLogcat()   // a confirmação do desregistro que o motor escreve depois daqui é a do Sair
        openAccount("config-sair")
        compose.onNodeWithTag("sair-confirmar").performClick()
        emulator.waitUntil("a tela Entrar") { emulator.showsTag("entrar") }
        assertEquals("o ramal vazio", "", emulator.editableText("ramal"))
        emulator.waitUntil("o serviço parar") { !SipService.running }
        emulator.waitUntil("a notificação fixa sair") { emulator.connectionNotificationTitle() == null }
        assertNull("a conta e a senha saíram", app.store.load())
        assertEquals("os Recentes ficam", recents, app.recents.list())
        // Desregistrou (spec 7.1.6): o servidor confirmou o REGISTER com Expires 0, e o registrador já não tem o
        // contato do ramal (o RING não tem para onde ligar).
        emulator.waitUntil("o servidor confirmar a saída da conta") { emulator.engineLogHas(UNREGISTERED) }
        assertEquals("o contato do ramal no registrador", "ERR no-contact", emulator.control("RING 2001"))
    }

    // Abre as Configurações pelo menu e toca na linha [tag] da Conta (config-editar ou config-sair).
    private fun openAccount(tag: String) {
        emulator.openMenu("menu-configuracoes")
        emulator.waitUntil("as Configurações") { emulator.showsTag(tag) }
        compose.onNodeWithTag(tag).performClick()
    }

    private fun click(tag: String) {
        compose.onNodeWithTag(tag).performScrollTo().performClick()
    }

    // O último pedido com [action] que o app mandou (o Espresso-Intents guarda todos e os lê na thread principal); o
    // compartilhar sai de uma coroutine, depois de o arquivo ser lido fora da thread principal.
    private fun sentIntent(action: String): Intent {
        var found: Intent? = null
        emulator.waitUntil("o pedido $action", 10_000) {
            found = Intents.getIntents().lastOrNull { it.action == action }
            found != null
        }
        return found!!
    }

    private companion object {
        // A linha do motor quando o servidor confirma a saída da conta (SipEngine.cpp, RetireAccount).
        const val UNREGISTERED = "a conta saiu do servidor"
        val DIGEST_RESPONSE = Regex("""response="[0-9a-f]{32}"""")
    }
}
