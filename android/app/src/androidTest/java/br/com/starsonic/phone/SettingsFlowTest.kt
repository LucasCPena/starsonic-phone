package br.com.starsonic.phone

import android.os.PowerManager
import android.view.ViewGroup
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.data.CallSettings
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.main.MainActivity
import br.com.starsonic.phone.permissions.Guide
import br.com.starsonic.phone.permissions.PermissionsScreen
import br.com.starsonic.phone.service.SipService
import br.com.starsonic.phone.ui.StarsonicTheme
import java.io.File
import java.io.IOException
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
 * As Configurações no emulador (spec 3.3, 3.4, 5, 8 e 11), com o motor de verdade e o registrador falso do CI (ver
 * [Emulator]):
 * - as chaves do bipe no fim da ligação e do Atender automático, e o Tempo para atender, gravados no arquivo
 *   "configuracoes" e iguais depois de a tela ser recriada;
 * - o Sair da conta, que pergunta antes e deixa as configurações de ligação, que valem de novo depois do Entrar
 *   (Review Focus 4);
 * - o Editar conta (a tela Entrar preenchida) e as Permissões e bateria (a tela Permissões, que daqui não segue sozinha,
 *   nem com tudo dado);
 * - na tela Permissões, o voltar do Android (o das Configurações volta a elas; o de depois do primeiro Entrar vai para a
 *   tela principal, R28), o nome "Permitida" do sinal de feito (R29) e os números do passo a passo do fabricante com a
 *   letra no dobro (R30; o emulador é genérico, e o teste desenha o cartão da Samsung por cima da tela principal);
 * - as telas de dentro (Configurações, o Tempo para atender aberto, a confirmação do Sair, Permissões, Entrar e Sobre)
 *   nos temas escuro (R11) e claro, com as etiquetas no lugar e as fotos (R19), numa tela do tamanho dos quadros do
 *   canvas (390 × 844 dp).
 *
 * Cada teste começa com a conta gravada por TCP (o CI confere que o último REGISTER aceito veio por TCP) e as
 * configurações de ligação de fábrica (o bipe ligado, o Atender automático e o Não perturbe desligados, 3 s). O fim
 * devolve as configurações de ligação, a tela, a letra, o tema e a saída da otimização de bateria de antes, cada um
 * mesmo que outro falhe.
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class SettingsFlowTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val emulator = Emulator(compose)
    private val app = emulator.app
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private val account by lazy { Account(emulator.registrar, Transport.TCP, "2001", emulator.senha) }
    private val connected by lazy { "Conectado · ${emulator.registrar}" }
    private var scenario: ActivityScenario<MainActivity>? = null
    private var settingsBefore: CallSettings? = null
    private var batteryRevoked = false

    // O ComposeView com o passo a passo da Samsung por cima da tela principal ([showTheSamsungGuide]), da activity do teste.
    private var overlay: ComposeView? = null

    @Before
    fun prepare() {
        // A tela acesa e sem bloqueio, como num celular em uso.
        device.wakeUp()
        device.executeShellCommand("svc power stayon true")
        device.executeShellCommand("wm dismiss-keyguard")
        emulator.startClean()
        settingsBefore = app.callSettings.settings.value
        app.callSettings.update { CallSettings() }
        app.store.save(account)
    }

    @After
    fun close() {
        try {
            // Uma ligação que sobrou de um teste que falhou acaba aqui (a do registrador, e a do app).
            if (app.calls.state.value != null) {
                emulator.control("HANGUP 2001")
                app.calls.hangup()
            }
            scenario?.close()
            emulator.waitUntil("as telas do app fecharem") { emulator.finishMainActivities() == 0 }
        } finally {
            try {
                emulator.restoreLook()
            } finally {
                try {
                    if (batteryRevoked) restoreBattery()
                } finally {
                    settingsBefore?.let { before -> app.callSettings.update { before } }
                }
            }
        }
    }

    @Test
    fun aGrantedPermissionIsReadAsPermitida() {
        // R29: o sinal de feito das Permissões tem o nome do quadro. A bateria fica por liberar, e a tela, aberta.
        revokeBattery()
        openSettings()
        compose.onNodeWithTag("config-permissoes").performScrollTo().performClick()
        emulator.waitUntil("a tela Permissões com o Permitir da bateria") { emulator.showsTag("permitir-BATTERY") }
        for (banner in listOf("NOTIFICATIONS", "MICROPHONE", "FULL_SCREEN")) {
            compose.onNodeWithTag("permitida-$banner").assertContentDescriptionEquals(GRANTED)
        }
    }

    @Test
    fun autoAnswerAndItsTimeAreRemembered() {
        openSettings()
        compose.onNodeWithTag(AUTO).performScrollTo().assertIsOff()
        assertTrue("a ajuda com o tempo de fábrica", emulator.showsText(autoAnswerHelp(3)))
        compose.onNodeWithTag(AUTO).performClick()
        compose.onNodeWithTag(AUTO).assertIsOn()
        assertTrue("o Atender automático ligado", app.callSettings.settings.value.autoAnswer)
        // O Tempo para atender: o menu com as opções do Windows, nesta ordem, e a de agora marcada.
        compose.onNodeWithTag(TIME).performScrollTo().assert(hasText("3 s")).performClick()
        emulator.waitUntil("o menu do Tempo para atender") { emulator.showsTag("tempo-0") }
        for ((seconds, label) in TIMES) {
            val option = compose.onNodeWithTag("tempo-$seconds").performScrollTo()
            option.assert(hasText(label))
            if (seconds == 3) option.assertIsSelected() else option.assertIsNotSelected()
        }
        // As posições lidas de uma vez, na mesma rolagem do menu.
        val tops = TIMES.map { (seconds, _) -> compose.onNodeWithTag("tempo-$seconds").fetchSemanticsNode().positionInRoot.y }
        assertTrue("as opções de cima para baixo, na ordem do Windows: $tops", tops.zipWithNext().all { (above, below) -> above < below })
        val options = compose.onAllNodes(hasTagStartingWith("tempo-")).fetchSemanticsNodes().size
        assertEquals("só as opções do Windows", TIMES.size, options)
        compose.onNodeWithTag("tempo-5").performScrollTo().performClick()
        emulator.waitUntil("o menu fechar") { !emulator.showsTag("tempo-0") }
        compose.onNodeWithTag(TIME).assert(hasText("5 s"))
        emulator.waitForText(autoAnswerHelp(5))
        assertEquals("o tempo escolhido", 5, app.callSettings.settings.value.autoAnswerSeconds)
        waitForSaved("atender_auto" to "true", "atender_segundos" to "5")
        // Depois de a tela ser recriada (o tema, o idioma), igual.
        scenario!!.recreate()
        emulator.waitUntil("as Configurações de novo") { emulator.showsTag(AUTO) }
        compose.onNodeWithTag(AUTO).performScrollTo().assertIsOn()
        compose.onNodeWithTag(TIME).performScrollTo().assert(hasText("5 s"))
        assertTrue("a ajuda com o tempo escolhido", emulator.showsText(autoAnswerHelp(5)))
        // A pílula do cabeçalho também está ligada.
        compose.onNodeWithTag("voltar").performClick()
        emulator.waitUntil("a tela principal") { emulator.showsTag(CHIP_AUTO) }
        compose.onNodeWithTag(CHIP_AUTO).assertIsOn()
    }

    @Test
    fun backOnPermissoesAfterTheFirstEntrarGoesToTheMainScreen() {
        // R28: o primeiro Entrar (sem conta gravada) com a bateria por liberar leva à tela Permissões; o voltar do Android
        // vai para a tela principal, como o Voltar da barra e o Continuar.
        app.store.clear()
        revokeBattery()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitUntil("a tela Entrar") { emulator.showsTag("entrar") }
        enterTheAccount()
        emulator.waitUntil("a tela Permissões depois do Entrar") { emulator.showsTag("permitir-BATTERY") }
        device.pressBack()
        emulator.waitUntil("a tela principal") { emulator.showsTag("aba-teclado") }
        emulator.waitForText(connected)
    }

    @Test
    fun backOnPermissoesFromConfiguracoesReturnsToConfiguracoes() {
        // R28: aberta das Configurações, o voltar do Android volta a elas. A bateria fica por liberar: a tela fica
        // aberta até o voltar.
        revokeBattery()
        openSettings()
        compose.onNodeWithTag("config-permissoes").performScrollTo().performClick()
        emulator.waitUntil("a tela Permissões com o Permitir da bateria") { emulator.showsTag("permitir-BATTERY") }
        device.pressBack()
        emulator.waitUntil("as Configurações") { emulator.showsTag("config-permissoes") }
    }

    @Test
    fun editarContaOpensEntrarFilledIn() {
        openSettings()
        compose.onNodeWithTag("config-editar").performClick()
        emulator.waitUntil("a tela Entrar do Editar") { emulator.showsTag("entrar") }
        assertTrue("o rótulo do cabeçalho", emulator.showsText("Ramal no celular"))
        assertTrue("o título do cabeçalho", emulator.showsText("Entre com o seu ramal"))
        compose.onNodeWithTag("servidor").assert(hasText(emulator.registrar))
        compose.onNodeWithTag("protocolo-tcp").assertIsSelected()
        compose.onNodeWithTag("protocolo-udp").assertIsNotSelected()
        compose.onNodeWithTag("ramal").assert(hasText("2001"))
        assertEquals("a senha vazia", "", emulator.editableText("senha"))
        assertFalse("o Editar das Configurações abre sem aviso", emulator.showsTag("aviso"))
        // O voltar do Android volta às Configurações, de onde o Editar abriu, com a conta como estava.
        device.pressBack()
        emulator.waitUntil("as Configurações") { emulator.showsTag("config-sair") }
        assertEquals("a conta gravada", account, app.store.load())
    }

    @Test
    fun permissoesEBateriaOpensThePermissionsScreen() {
        openSettings()
        compose.onNodeWithTag("config-permissoes").performScrollTo()
        assertTrue("a ajuda", emulator.showsText(PERMISSIONS_HELP))
        // Com tudo dado (o run-emulator-tests.sh dá tudo, e o emulador não tem o passo a passo de um fabricante): depois
        // do primeiro Entrar, a tela seguiria sozinha; aberta das Configurações, ela fica.
        compose.onNodeWithTag("config-permissoes").performClick()
        emulator.waitUntil("a tela Permissões") { emulator.showsTag("continuar") }
        Thread.sleep(2_000)
        assertTrue("a tela Permissões continua aberta, com tudo dado", emulator.showsTag("continuar"))
        assertTrue("o título", emulator.showsText("Permissões"))
        assertTrue("a seção", emulator.showsText("Para as ligações chegarem"))
        for ((banner, text) in BANNERS) {
            assertTrue("o aviso $banner", emulator.showsText(text))
            assertTrue("o sinal de feito de $banner", emulator.showsTag("permitida-$banner"))
            assertFalse("sem o Permitir de $banner", emulator.showsTag("permitir-$banner"))
        }
        // O Voltar da barra volta às Configurações.
        compose.onNodeWithTag("voltar").performClick()
        emulator.waitUntil("as Configurações") { emulator.showsTag("config-permissoes") }
        // Sem a saída da otimização de bateria, o aviso dela tem o Permitir compacto do quadro: 40 dp de altura, com o
        // toque de 48; os outros, o sinal de feito.
        revokeBattery()
        compose.onNodeWithTag("config-permissoes").performScrollTo().performClick()
        emulator.waitUntil("a tela Permissões com o Permitir da bateria") { emulator.showsTag("permitir-BATTERY") }
        for ((banner, _) in BANNERS) {
            val allowed = banner != "BATTERY"
            assertEquals("o sinal de feito de $banner", allowed, emulator.showsTag("permitida-$banner"))
            assertEquals("o Permitir de $banner", !allowed, emulator.showsTag("permitir-$banner"))
        }
        compose.onNodeWithTag("permitir-BATTERY").performScrollTo()
        assertEquals("a altura do Permitir (dp)", 40f, heightDp("permitir-BATTERY"), 0.5f)
        emulator.assertTouchAtLeast48("permitir-BATTERY")
        // O Continuar também volta às Configurações.
        compose.onNodeWithTag("continuar").performScrollTo().performClick()
        emulator.waitUntil("as Configurações") { emulator.showsTag("config-permissoes") }
    }

    @Test
    fun sairDaContaAsksFirstAndKeepsTheCallSettings() {
        val saved = CallSettings(doNotDisturb = true, autoAnswer = true, autoAnswerSeconds = 8, endBeep = false)
        app.callSettings.update { saved }
        openSettings(line = DND_LINE)
        // Pergunta antes: o Cancelar fica com a conta.
        compose.onNodeWithTag("config-sair").performScrollTo().performClick()
        emulator.waitUntil("a confirmação do Sair") { emulator.showsTag("sair-confirmar") }
        assertTrue("a pergunta", emulator.showsText("Sair da conta?"))
        compose.onNodeWithTag("sair-cancelar").performClick()
        emulator.waitUntil("a confirmação fechar") { !emulator.showsTag("sair-confirmar") }
        assertTrue("as Configurações", emulator.showsTag("config-sair"))
        assertEquals("a conta continua gravada", account, app.store.load())
        assertTrue("o serviço continua de pé", SipService.running)
        // Sair: a conta sai; as configurações de ligação ficam, na memória e no arquivo.
        compose.onNodeWithTag("config-sair").performScrollTo().performClick()
        emulator.waitUntil("a confirmação do Sair") { emulator.showsTag("sair-confirmar") }
        compose.onNodeWithTag("sair-confirmar").performClick()
        emulator.waitUntil("a tela Entrar") { emulator.showsTag("entrar") }
        emulator.waitUntil("o serviço parar") { !SipService.running }
        assertNull("a conta saiu", app.store.load())
        assertEquals("o ramal vazio", "", emulator.editableText("ramal"))
        assertEquals("as configurações de ligação ficam", saved, app.callSettings.settings.value)
        waitForSaved("nao_perturbe" to "true", "atender_auto" to "true", "atender_segundos" to "8", "bipe_fim" to "false")
        // O Entrar de novo: elas valem outra vez (Review Focus 4), nas pílulas, na bolinha e na notificação fixa.
        enterTheAccount()
        emulator.waitUntil("a tela principal") { emulator.showsTag(CHIP_DND) }
        emulator.waitForText(DND_LINE)
        compose.onNodeWithTag(CHIP_DND).assertIsOn()
        compose.onNodeWithTag(CHIP_AUTO).assertIsOn()
        emulator.waitUntil("a notificação \"Não perturbe (ramal 2001)\"") {
            emulator.connectionNotificationTitle() == "Não perturbe (ramal 2001)"
        }
        // E nas chaves das Configurações.
        emulator.openMenu("menu-configuracoes")
        emulator.waitUntil("as Configurações") { emulator.showsTag(BEEP) }
        compose.onNodeWithTag(BEEP).performScrollTo().assertIsOff()
        compose.onNodeWithTag(AUTO).performScrollTo().assertIsOn()
        compose.onNodeWithTag(TIME).performScrollTo().assert(hasText("8 s"))
        assertTrue("a ajuda com o tempo gravado", emulator.showsText(autoAnswerHelp(8)))
    }

    @Test
    fun theBeepSwitchStartsOnAndIsRemembered() {
        openSettings()
        // Uma chave de verdade para o leitor de tela: o papel, o nome, o estado e o toque de pelo menos 48 dp.
        compose.onNodeWithTag(BEEP).performScrollTo()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Switch))
            .assertContentDescriptionEquals(BEEP_TITLE)
            .assertIsOn()
        emulator.assertTouchAtLeast48(BEEP)
        assertTrue("a ajuda", emulator.showsText(BEEP_HELP))
        compose.onNodeWithTag(BEEP).performClick()
        compose.onNodeWithTag(BEEP).assertIsOff()
        assertFalse("o bipe desligado", app.callSettings.settings.value.endBeep)
        waitForSaved("bipe_fim" to "false")
        // Depois de a tela ser recriada, igual; e liga de novo.
        scenario!!.recreate()
        emulator.waitUntil("as Configurações de novo") { emulator.showsTag(BEEP) }
        compose.onNodeWithTag(BEEP).performScrollTo().assertIsOff()
        compose.onNodeWithTag(BEEP).performClick()
        compose.onNodeWithTag(BEEP).assertIsOn()
        assertTrue("o bipe ligado", app.callSettings.settings.value.endBeep)
        waitForSaved("bipe_fim" to "true")
    }

    @Test
    fun theInnerScreensDrawInTheDarkTheme() = drawTheInnerScreens(night = true, theme = "escuro")

    @Test
    fun theInnerScreensDrawInTheLightTheme() = drawTheInnerScreens(night = false, theme = "claro")

    @Test
    fun theManufacturerStepsStayWholeAtTheLargestFont() {
        // R30: o cartão do fabricante só aparece nos celulares Samsung e Xiaomi, e o emulador do CI é genérico. O teste
        // desenha a tela Permissões com o passo a passo da Samsung por cima da tela principal, na letra do celular e com
        // ela no dobro (a maior do Android): os números dos passos ficam numa linha só, inteiros. As fotos são para a
        // conferência com o quadro Permissoes.
        emulator.setNightMode(false)
        emulator.useCanvasDisplay()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitForText(connected)
        showTheSamsungGuide(fontScale = 1f)
        emulator.waitUntil("o cartão do fabricante") { emulator.showsTag("abrir-ajustes") }
        assertTrue("o título do cartão", emulator.showsText(SAMSUNG_TITLE))
        assertStepNumbersWhole("na letra do celular")
        emulator.saveScreen("permissoes-samsung-claro.png")
        showTheSamsungGuide(fontScale = 2f)
        emulator.waitUntil("o cartão do fabricante na letra maior") { emulator.showsTag("abrir-ajustes") }
        assertStepNumbersWhole("na letra no dobro")
        compose.onNodeWithTag("abrir-ajustes").performScrollTo()
        emulator.saveScreen("permissoes-samsung-letra-grande.png")
    }

    // As telas de dentro no tema [theme] ("escuro" ou "claro"; [night] para o do celular): cada uma com as etiquetas no
    // lugar, e a foto dela. Sem a saída da otimização de bateria, as Permissões mostram um Permitir, como no quadro.
    private fun drawTheInnerScreens(night: Boolean, theme: String) {
        emulator.setNightMode(night)
        emulator.useCanvasDisplay()
        revokeBattery()
        openSettings()
        for (tag in SETTINGS_TAGS) assertTrue("$tag nas Configurações", emulator.showsTag(tag))
        emulator.saveScreen("configuracoes-$theme.png")
        // O Tempo para atender aberto.
        compose.onNodeWithTag(TIME).performScrollTo().performClick()
        emulator.waitUntil("o menu do Tempo para atender") { emulator.showsTag("tempo-3") }
        emulator.saveScreen("configuracoes-tempo-$theme.png")
        device.pressBack()
        emulator.waitUntil("o menu fechar") { !emulator.showsTag("tempo-3") }
        // A confirmação do Sair, que fica.
        compose.onNodeWithTag("config-sair").performScrollTo().performClick()
        emulator.waitUntil("a confirmação do Sair") { emulator.showsTag("sair-confirmar") && emulator.showsTag("sair-cancelar") }
        emulator.saveScreen("sair-$theme.png")
        compose.onNodeWithTag("sair-cancelar").performClick()
        emulator.waitUntil("a confirmação fechar") { !emulator.showsTag("sair-confirmar") }
        // Permissões.
        compose.onNodeWithTag("config-permissoes").performScrollTo().performClick()
        emulator.waitUntil("a tela Permissões") { emulator.showsTag("continuar") }
        for (tag in PERMISSIONS_TAGS) assertTrue("$tag nas Permissões", emulator.showsTag(tag))
        emulator.saveScreen("permissoes-$theme.png")
        compose.onNodeWithTag("voltar").performClick()
        // Entrar (o do Editar conta).
        emulator.waitUntil("as Configurações") { emulator.showsTag("config-editar") }
        compose.onNodeWithTag("config-editar").performClick()
        emulator.waitUntil("a tela Entrar") { emulator.showsTag("entrar") }
        for (tag in ENTRAR_TAGS) assertTrue("$tag no Entrar", emulator.showsTag(tag))
        emulator.saveScreen("entrar-$theme.png")
        device.pressBack()
        // Sobre, com o logo do tema: o principal no claro e o negativo no escuro.
        emulator.waitUntil("as Configurações") { emulator.showsTag("config-sair") }
        compose.onNodeWithTag("voltar").performClick()
        emulator.openMenu("menu-sobre")
        emulator.waitUntil("o Sobre") { emulator.showsTag("enviar-diagnostico") }
        for (tag in ABOUT_TAGS) assertTrue("$tag no Sobre", emulator.showsTag(tag))
        val (logo, other) = if (night) "logo-negativo" to "logo-principal" else "logo-principal" to "logo-negativo"
        assertTrue("o logo $logo", emulator.showsTag(logo))
        assertFalse("sem o logo $other", emulator.showsTag(other))
        emulator.saveScreen("sobre-$theme.png")
        device.pressBack()
        emulator.waitUntil("a tela principal") { emulator.showsTag("aba-teclado") }
    }

    // Preenche a tela Entrar com a conta do teste (por TCP) e toca em Entrar.
    private fun enterTheAccount() {
        compose.onNodeWithTag("servidor").performScrollTo().performTextInput(emulator.registrar)
        compose.onNodeWithTag("protocolo-tcp").performScrollTo().performClick()
        compose.onNodeWithTag("ramal").performScrollTo().performTextInput("2001")
        compose.onNodeWithTag("senha").performScrollTo().performTextInput(emulator.senha)
        compose.onNodeWithTag("entrar").performScrollTo().performClick()
    }

    // Desenha a tela Permissões com o passo a passo da Samsung (que o emulador genérico nunca mostra) num ComposeView por
    // cima da tela principal, no tema do app e com a letra [fontScale] vezes a do celular; da segunda vez, troca o
    // conteúdo do mesmo ComposeView.
    private fun showTheSamsungGuide(fontScale: Float) {
        scenario!!.onActivity { activity ->
            val view = overlay ?: ComposeView(activity).also {
                activity.addContentView(it, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                overlay = it
            }
            view.setContent {
                StarsonicTheme {
                    val density = LocalDensity.current
                    CompositionLocalProvider(LocalDensity provides Density(density.density, density.fontScale * fontScale)) {
                        PermissionsScreen(resumes = 0, guide = Guide.SAMSUNG, continuesAlone = false, onContinue = {})
                    }
                }
            }
        }
    }

    // Os números dos passos do fabricante ("1.", "2." e "3.") numa linha só, inteiros ([what]: a letra da vez).
    private fun assertStepNumbersWhole(what: String) {
        for (number in listOf("1.", "2.", "3.")) {
            val results = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText(number, useUnmergedTree = true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(results) }
            val layout = results.single()
            assertTrue(
                "o número \"$number\" $what: ${layout.lineCount} linha(s), a primeira até ${layout.getLineEnd(0)} de ${number.length}",
                layout.lineCount == 1 && layout.getLineEnd(0) == number.length,
            )
        }
    }

    // Abre o app, espera a linha do status [line] (no cartão da conta) e abre as Configurações pelo menu do cabeçalho.
    private fun openSettings(line: String = connected) {
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitForText(line)
        emulator.openMenu("menu-configuracoes")
        emulator.waitUntil("as Configurações") { emulator.showsTag("config-sair") }
    }

    // Tira o app da lista dos que ficam fora da otimização de bateria (o run-emulator-tests.sh o pôs nela) até o fim do
    // teste: a tela Permissões mostra o Permitir da bateria.
    private fun revokeBattery() {
        batteryRevoked = true
        emulator.shell("dumpsys deviceidle whitelist -${app.packageName}")
        emulator.waitUntil("o app sem a saída da otimização de bateria") { !ignoresBatteryOptimizations() }
    }

    private fun restoreBattery() {
        batteryRevoked = false
        emulator.shell("dumpsys deviceidle whitelist +${app.packageName}")
        emulator.waitUntil("o app com a saída da otimização de bateria de volta") { ignoresBatteryOptimizations() }
    }

    private fun ignoresBatteryOptimizations(): Boolean =
        app.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(app.packageName)

    // Espera o arquivo das configurações de ligação (o SharedPreferences "configuracoes", que o Sair da conta não apaga)
    // ter cada chave com o valor (o Android grava depois da mudança, fora da thread principal, e troca o arquivo no meio).
    private fun waitForSaved(vararg values: Pair<String, String>) {
        val file = File(app.dataDir, "shared_prefs/configuracoes.xml")
        fun read(): String =
            try {
                file.readText()
            } catch (e: IOException) {
                "(sem o arquivo: ${e.message})"
            }
        emulator.waitUntil("o arquivo configuracoes com ${values.toList()}", details = { "O arquivo: ${read()}" }) {
            val text = read()
            values.all { (key, value) -> "name=\"$key\" value=\"$value\"" in text }
        }
    }

    // A altura do elemento [tag], em dp.
    private fun heightDp(tag: String): Float {
        val node = compose.onNodeWithTag(tag).fetchSemanticsNode()
        return with(node.layoutInfo.density) { node.size.height.toDp().value }
    }

    // Os elementos com a etiqueta que começa com [prefix].
    private fun hasTagStartingWith(prefix: String) = SemanticsMatcher("a etiqueta começa com $prefix") {
        it.config.getOrNull(SemanticsProperties.TestTag)?.startsWith(prefix) == true
    }

    // A linha de baixo do "Atender automaticamente" com [seconds] segundos (os de 2 para cima, os deste teste).
    private fun autoAnswerHelp(seconds: Int) = "Depois de $seconds segundos tocando"

    private companion object {
        const val BEEP = "config-bipe"
        const val AUTO = "config-atender"
        const val TIME = "config-tempo"
        const val CHIP_DND = "nao-perturbe"
        const val CHIP_AUTO = "atender-auto"
        const val BEEP_TITLE = "Bipe quando a ligação cai ou termina"
        const val BEEP_HELP = "Vem ligado. Um bipe curto no fone quando a outra pessoa desliga ou a ligação cai."
        const val PERMISSIONS_HELP =
            "Notificações, microfone e o uso da bateria, para as ligações chegarem com a tela apagada"
        const val DND_LINE = "Não perturbe · as ligações não tocam"

        // O nome do sinal de feito das Permissões (o aria-label do quadro, R29) e o título do passo a passo da Samsung.
        const val GRANTED = "Permitida"
        const val SAMSUNG_TITLE = "Nos celulares Samsung, libere também o app nos ajustes:"

        // As opções do Tempo para atender, as do Windows, na ordem: os segundos e o nome de cada uma.
        val TIMES = listOf(
            0 to "Na hora", 1 to "1 s", 2 to "2 s", 3 to "3 s", 5 to "5 s", 8 to "8 s", 10 to "10 s", 15 to "15 s",
            20 to "20 s", 30 to "30 s",
        )

        // Os quatro avisos das Permissões, na ordem, com o texto de cada um.
        val BANNERS = listOf(
            "NOTIFICATIONS" to "Permita as notificações para receber ligações.",
            "MICROPHONE" to "Permita o microfone para fazer e receber ligações.",
            "FULL_SCREEN" to "Permita a tela cheia para ver as ligações com o celular bloqueado.",
            "BATTERY" to "Libere o uso de bateria para receber ligações com o app fechado.",
        )

        val SETTINGS_TAGS = listOf("voltar", "config-conta", "config-editar", "config-sair", BEEP, AUTO, TIME, "config-permissoes")
        val PERMISSIONS_TAGS = listOf("voltar", "continuar", "permitir-BATTERY") + BANNERS.map { "permissao-${it.first}" }
        val ENTRAR_TAGS = listOf("servidor", "protocolo", "protocolo-udp", "protocolo-tcp", "ramal", "senha", "entrar")
        val ABOUT_TAGS = listOf("voltar", "site", "suporte", "whatsapp", "codigo-fonte", "enviar-diagnostico")
    }
}
