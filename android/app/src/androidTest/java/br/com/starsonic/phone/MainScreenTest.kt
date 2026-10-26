package br.com.starsonic.phone

import android.Manifest
import android.content.res.Configuration
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.filterToOne
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onChildren
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.toSize
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import androidx.test.uiautomator.UiDevice
import br.com.starsonic.phone.call.CallPhase
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.data.CallKind
import br.com.starsonic.phone.data.CallSettings
import br.com.starsonic.phone.data.Recent
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.main.MainActivity
import java.time.LocalDate
import java.time.ZoneId
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
 * A tela principal no visual do Windows, no emulador (spec 3 a 7 e 11), com o motor de verdade e o registrador falso do
 * CI (ver [Emulator] e o CallFlowTest): as pílulas Não perturbe e Atender automático (a linha do status e a notificação
 * fixa), o Rediscar, o menu (Configurações e Sobre), a letra do celular no máximo numa tela pequena (Review Focus 5) e os
 * temas claro e escuro.
 *
 * As fotos (R19): os testes dos temas, do menu e da letra grande guardam a tela inteira ([Emulator.saveScreen]) para a
 * conferência com os quadros do canvas; os dos temas e o do menu numa tela do tamanho dos quadros (390 × 844 dp), os dos
 * temas com os contatos e os Recentes dos quadros. Os outros rodam na tela do emulador do CI (320 × 640 dp).
 *
 * Cada teste começa com a conta gravada por TCP (o CI confere que o último REGISTER aceito veio por TCP), os Recentes
 * vazios e o Não perturbe e o Atender automático desligados; o fim devolve as configurações de ligação, a tela, a letra
 * e o tema de antes e tira da agenda os contatos que pôs.
 *
 * A permissão dos contatos vem dada (GrantPermissionRule, que não fecha o app): no CI, a classe roda depois do
 * ContactsFlowTest, cujo primeiro teste precisa dela nunca dada desde a instalação.
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class MainScreenTest {
    @get:Rule
    val contactsPermission: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.READ_CONTACTS)

    @get:Rule
    val compose = createEmptyComposeRule()

    private val emulator = Emulator(compose)
    private val app = emulator.app
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private val connected by lazy { "Conectado · ${emulator.registrar}" }
    private var scenario: ActivityScenario<MainActivity>? = null
    private var settingsBefore: CallSettings? = null
    private val contacts = mutableListOf<Long>()

    @Before
    fun prepare() {
        // A tela acesa e sem bloqueio, como num celular em uso.
        device.wakeUp()
        device.executeShellCommand("svc power stayon true")
        device.executeShellCommand("wm dismiss-keyguard")
        emulator.startClean()
        app.recents.clear()
        settingsBefore = app.callSettings.settings.value
        app.callSettings.update { it.copy(doNotDisturb = false, autoAnswer = false) }
        app.store.save(Account(emulator.registrar, Transport.TCP, "2001", emulator.senha))
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
            emulator.restoreLook()
            settingsBefore?.let { before -> app.callSettings.update { before } }
            contacts.forEach(emulator::removeContact)
            app.recents.clear()
        }
    }

    @Test
    fun theChipsToggleAndChangeTheDot() {
        open()
        compose.onNodeWithTag(DND).assertIsOff()
        compose.onNodeWithTag(AUTO).assertIsOff()
        // As pílulas parecem menores (36 dp), mas o toque tem 48; o botão do menu (44) também.
        assertTouchAtLeast48(DND)
        assertTouchAtLeast48("menu")
        // Não perturbe ligado: a pílula, a bolinha vermelha com a linha dela, a notificação fixa e a configuração gravada.
        compose.onNodeWithTag(DND).performClick()
        compose.onNodeWithTag(DND).assertIsOn()
        waitForStatus(DND_LINE)
        emulator.waitUntil("a notificação \"Não perturbe (ramal 2001)\"") {
            emulator.connectionNotificationTitle() == "Não perturbe (ramal 2001)"
        }
        assertTrue("o Não perturbe gravado", app.callSettings.settings.value.doNotDisturb)
        // Desligado: a bolinha verde e "Conectado" de novo.
        compose.onNodeWithTag(DND).performClick()
        compose.onNodeWithTag(DND).assertIsOff()
        waitForStatus(connected)
        emulator.waitUntil("a notificação \"Conectado (ramal 2001)\"") {
            emulator.connectionNotificationTitle() == "Conectado (ramal 2001)"
        }
        assertFalse("o Não perturbe desligado", app.callSettings.settings.value.doNotDisturb)
        // Atender automático: a pílula e a configuração; a bolinha continua a de conectado.
        compose.onNodeWithTag(AUTO).performClick()
        compose.onNodeWithTag(AUTO).assertIsOn()
        assertTrue("o Atender automático gravado", app.callSettings.settings.value.autoAnswer)
        assertEquals("a linha do status com o Atender automático", connected, statusLine())
        compose.onNodeWithTag(AUTO).performClick()
        compose.onNodeWithTag(AUTO).assertIsOff()
        assertFalse("o Atender automático desligado", app.callSettings.settings.value.autoAnswer)
    }

    @Test
    fun rediscarIsDisabledUntilACallIsMadeThenDialsTheLastOne() {
        open()
        compose.onNodeWithTag(REDIAL).performScrollTo().assertIsNotEnabled().assertContentDescriptionEquals("Rediscar")
        assertTouchAtLeast48(REDIAL)
        var before = emulator.callLog().size
        dial("2002")
        waitForLog(before, "inv-in 2002 200")
        hangUpOnTheCallScreen()
        emulator.waitUntil("a feita no Recentes") { app.recents.list().firstOrNull()?.kind == CallKind.FEITA }
        // De volta ao Teclado: o Rediscar liga, com o número da feita no nome (o 2002 não é contato).
        emulator.waitUntil("o Rediscar da feita", details = { "Rediscar: ${redialDescription()}" }) {
            redialDescription() == "Rediscar 2002"
        }
        compose.onNodeWithTag(REDIAL).performScrollTo().assertIsEnabled()
        // O aperto longo mostra o nome na dica do Android, sem ligar. A dica some sozinha depois de 1,5 s, contados no
        // relógio do Compose, que nos testes só anda quando o teste o avança.
        compose.onNodeWithTag(REDIAL).performTouchInput { longClick() }
        emulator.waitForText("Rediscar 2002")
        compose.mainClock.advanceTimeBy(TOOLTIP_MILLIS)
        emulator.waitUntil("a dica sumir") { !emulator.showsText("Rediscar 2002") }
        assertNull("o aperto longo não ligou", app.calls.state.value)
        // O toque liga de novo para a feita mais nova, como o botão de ligar da linha do Recentes.
        before = emulator.callLog().size
        compose.onNodeWithTag(REDIAL).performClick()
        waitForLog(before, "inv-in 2002 200")
        assertEquals("2002", app.calls.state.value?.number)
        hangUpOnTheCallScreen()
    }

    @Test
    fun theMenuOpensConfiguracoesAndSobre() {
        emulator.useCanvasDisplay()
        open()
        compose.onNodeWithTag("menu").performClick()
        emulator.waitUntil("o menu aberto") { emulator.showsTag("menu-configuracoes") && emulator.showsTag("menu-sobre") }
        assertTrue("Configurações no menu", emulator.showsText("Configurações"))
        assertTrue("Sobre no menu", emulator.showsText("Sobre"))
        assertFalse("o Editar conta foi para as Configurações", emulator.showsText("Editar conta"))
        assertFalse("o Sair da conta foi para as Configurações", emulator.showsText("Sair da conta"))
        // As linhas com a largura de dentro do .popover do quadro Menu (230 dp; fora delas, 6 dp e o contorno de cada lado).
        for (tag in listOf("menu-configuracoes", "menu-sobre")) assertEquals("a largura de $tag (dp)", 230f, widthDp(tag), 0.5f)
        emulator.saveScreen("menu-claro.png")
        compose.onNodeWithTag("menu-configuracoes").performClick()
        // A parte Conta: a bolinha, o ramal, "servidor · protocolo", o Editar e o Sair, com a ajuda dele.
        emulator.waitUntil("as Configurações") { emulator.showsTag("config-sair") }
        assertTrue("o título", emulator.showsText("Configurações"))
        assertTrue("a seção", emulator.showsText("Conta"))
        emulator.waitForText("${emulator.registrar} · TCP")
        assertTrue("o ramal", emulator.showsText("2001"))
        compose.onNodeWithTag("config-editar").assertContentDescriptionEquals("Editar conta")
        assertTouchAtLeast48("config-editar")
        assertTrue("o Sair da conta", emulator.showsText("Sair da conta"))
        assertTrue("a ajuda do Sair", emulator.showsText("O celular deixa de receber as ligações do ramal."))
        emulator.saveScreen("configuracoes-conta-claro.png")
        // O Voltar da barra volta à tela principal.
        compose.onNodeWithTag("voltar").performClick()
        emulator.waitUntil("a tela principal") { emulator.showsTag("aba-teclado") }
        // O Sobre, e o voltar do Android.
        compose.onNodeWithTag("menu").performClick()
        emulator.waitUntil("o menu aberto") { emulator.showsTag("menu-sobre") }
        compose.onNodeWithTag("menu-sobre").performClick()
        emulator.waitForText("Starsonic Phone ${BuildConfig.VERSION_NAME}")
        device.pressBack()
        emulator.waitUntil("a tela principal") { emulator.showsTag("aba-teclado") }
    }

    @Test
    fun mainScreenStaysUsableAtTheLargestFontScale() {
        // Review Focus 5: uma tela pequena (360 × 640 dp) com a maior letra do Android.
        emulator.useDisplay(720, 1280, 320)
        emulator.setFontScale(2.0f)
        open()
        val header = layoutBounds("cabecalho")
        val nav = layoutBounds("navegacao")
        assertTrue("o cabeçalho ($header) acima da navegação ($nav)", header.bottom <= nav.top)
        // O cabeçalho e a navegação inteiros à vista, sem nada por cima de nada.
        val headerParts = listOf("menu", "status", DND, AUTO).associateWith(::layoutBounds)
        for ((tag, bounds) in headerParts) {
            compose.onNodeWithTag(tag).assertIsDisplayed()
            assertInside("$tag no cabeçalho", bounds, header)
        }
        assertNoOverlap(headerParts)
        val tabs = TABS.associateWith(::layoutBounds)
        for ((tag, bounds) in tabs) {
            compose.onNodeWithTag(tag).assertIsDisplayed()
            assertInside("$tag na navegação", bounds, nav)
        }
        assertNoOverlap(tabs)
        // O nome de cada aba numa linha só, inteiro: com a letra grande, ele encolhe em vez de quebrar no meio da palavra.
        for ((tag, label) in TABS.zip(TAB_LABELS)) {
            val layout = textLayout(compose.onNodeWithTag(tag, useUnmergedTree = true).onChildren().filterToOne(hasText(label)))
            assertEquals("\"$label\" numa linha", 1, layout.lineCount)
            assertFalse("\"$label\" inteiro, sem corte", layout.hasVisualOverflow)
        }
        emulator.saveScreen("teclado-letra-grande.png")
        // As 12 teclas, o Rediscar e o Ligar: cada um aparece inteiro entre o cabeçalho e a navegação, rolando o Teclado.
        val body = Rect(header.left, header.bottom, header.right, nav.top)
        for (tag in KEYS.map { "tecla-$it" } + listOf(REDIAL, "ligar")) {
            compose.onNodeWithTag(tag).performScrollTo().assertIsDisplayed()
            val shown = visibleBounds(tag)
            assertEquals("$tag inteiro à vista", layoutBounds(tag).height, shown.height, 1f)
            assertInside("$tag entre o cabeçalho e a navegação", shown, body)
        }
        // E nada do Teclado por cima de nada (todos na mesma rolagem).
        assertNoOverlap((listOf("numero", "apagar") + KEYS.map { "tecla-$it" } + listOf(REDIAL, "ligar")).associateWith(::layoutBounds))
        emulator.saveScreen("teclado-letra-grande-fim.png")
    }

    @Test
    fun theDarkThemeDraws() {
        emulator.setNightMode(true)
        emulator.useCanvasDisplay()
        fillTheBoards()
        open()
        assertTheme(Configuration.UI_MODE_NIGHT_YES)
        drawTheBoards("escuro")
    }

    @Test
    fun theLightThemeDraws() {
        emulator.setNightMode(false)
        emulator.useCanvasDisplay()
        fillTheBoards()
        open()
        assertTheme(Configuration.UI_MODE_NIGHT_NO)
        drawTheBoards("claro")
    }

    // Abre o app e espera a conta conectada.
    private fun open() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitForStatus(connected)
    }

    // Os contatos e os Recentes dos quadros do canvas: os cinco contatos; hoje, uma perdida, duas feitas e uma recebida;
    // ontem, uma perdida e uma feita.
    private fun fillTheBoards() {
        contacts += emulator.insertContact("Ana", "Souza", "2003")
        contacts += emulator.insertContact("Atendimento", "Starsonic", "(11) 5060-3000")
        contacts += emulator.insertContact("Carlos", "Lima", "(11) 98888-7777")
        contacts += emulator.insertContact("Financeiro", "", "2010")
        contacts += emulator.insertContact("Marcos", "Lima", "2005")
        val now = System.currentTimeMillis()
        val midnight = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        // As de hoje ficam em hoje mesmo logo depois da meia-noite (e na mesma ordem).
        fun today(minutesAgo: Int) = maxOf(now - minutesAgo * 60_000L, midnight + (300 - minutesAgo) * 1_000L)
        app.recents.add(Recent("2003", "", CallKind.PERDIDA, today(8), 0))
        app.recents.add(Recent("2005", "", CallKind.FEITA, today(80), 125))
        app.recents.add(Recent("(11) 5060-3000", "", CallKind.FEITA, today(207), 258))
        app.recents.add(Recent("2010", "Financeiro", CallKind.RECEBIDA, today(285), 62))
        app.recents.add(Recent("3001", "", CallKind.PERDIDA, midnight - 362 * 60_000L, 0))   // ontem, 17:58
        app.recents.add(Recent("(11) 98888-7777", "", CallKind.FEITA, midnight - 460 * 60_000L, 760))   // ontem, 16:20
    }

    // Os três quadros do canvas (Main, Recentes e Contatos) no tema [theme] ("claro" ou "escuro"): cada tela com as
    // etiquetas no lugar, e a foto dela.
    private fun drawTheBoards(theme: String) {
        // Teclado: o 2003 digitado, a sugestão do contato e o Rediscar da feita mais nova (o 2005, do Marcos Lima).
        for (digit in "2003") compose.onNodeWithTag("tecla-$digit").performScrollTo().performClick()
        emulator.waitUntil("a sugestão do contato") { emulator.showsTag("sugestao-Ana Souza") }
        emulator.waitUntil("o Rediscar da feita mais nova", details = { "Rediscar: ${redialDescription()}" }) {
            redialDescription() == "Rediscar 2005 · Marcos Lima"
        }
        for (tag in MAIN_TAGS) assertTrue("$tag na tela", emulator.showsTag(tag))
        compose.onNodeWithTag("aba-teclado").assertIsSelected()
        emulator.saveScreen("teclado-$theme.png")
        // Recentes, com o Não perturbe ligado, como no quadro.
        compose.onNodeWithTag(DND).performClick()
        waitForStatus(DND_LINE)
        compose.onNodeWithTag("aba-recentes").performClick()
        compose.onNodeWithTag("aba-recentes").assertIsSelected()
        emulator.waitUntil("as linhas do Recentes") { showsTagWithText("recente", "Marcos Lima") }
        for (text in listOf("Todas", "Perdidas · 2", "Hoje", "Ontem")) assertTrue("\"$text\" no Recentes", emulator.showsText(text))
        emulator.saveScreen("recentes-$theme.png")
        compose.onNodeWithTag(DND).performClick()
        waitForStatus(connected)
        // Contatos, com o Atender automático ligado, como no quadro.
        compose.onNodeWithTag(AUTO).performClick()
        compose.onNodeWithTag(AUTO).assertIsOn()
        compose.onNodeWithTag("aba-contatos").performClick()
        compose.onNodeWithTag("aba-contatos").assertIsSelected()
        emulator.waitUntil("os contatos") { emulator.showsTag("contato-Ana Souza") && emulator.showsTag("contato-Marcos Lima") }
        assertTrue("a busca", emulator.showsTag("contatos-busca"))
        emulator.saveScreen("contatos-$theme.png")
        compose.onNodeWithTag(AUTO).performClick()
        compose.onNodeWithTag(AUTO).assertIsOff()
    }

    private fun assertTheme(mode: Int) {
        scenario!!.onActivity { activity ->
            val shown = activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
            assertEquals("o tema da tela", mode, shown)
        }
    }

    // Disca no Teclado do app (na frente) e toca Ligar.
    private fun dial(number: String) {
        emulator.waitUntil("o Teclado") { emulator.showsTag("ligar") }
        for (digit in number) compose.onNodeWithTag("tecla-$digit").performScrollTo().performClick()
        compose.onNodeWithTag("ligar").performScrollTo().performClick()
    }

    // A ligação atendida pelo registrador acaba no Desligar da tela de chamada, e o Teclado volta.
    private fun hangUpOnTheCallScreen() {
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        emulator.waitUntil("o Desligar da tela de chamada") { emulator.showsTag("desligar") }
        compose.onNodeWithTag("desligar").performClick()
        emulator.waitUntil("a ligação acabar") { app.calls.state.value == null }
        emulator.waitUntil("a tela de chamada sair") { !emulator.showsTag("chamada") }
        emulator.waitUntil("o Teclado de volta") { emulator.showsTag(REDIAL) }
    }

    private fun waitForLog(before: Int, line: String) =
        emulator.waitUntil("\"$line\" no LOG do registrador", details = { "LOG: ${emulator.callLog().drop(before)}" }) {
            line in emulator.callLog().drop(before)
        }

    private fun waitForStatus(line: String) =
        emulator.waitUntil("\"$line\" na linha do status", details = { "Na linha: ${statusLine()}" }) { statusLine() == line }

    // A linha do status (no cartão da conta), ou null sem a tela principal na frente.
    private fun statusLine(): String? =
        try {
            compose.onNodeWithTag("status").fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)
                ?.joinToString { it.text }
        } catch (e: AssertionError) {
            null
        } catch (e: IllegalStateException) {
            null
        }

    // O nome do Rediscar para o leitor de tela, ou null sem o Teclado na frente.
    private fun redialDescription(): String? =
        try {
            compose.onNodeWithTag(REDIAL).fetchSemanticsNode().config.getOrNull(SemanticsProperties.ContentDescription)
                ?.joinToString()
        } catch (e: AssertionError) {
            null
        } catch (e: IllegalStateException) {
            null
        }

    // Uma tela do app na frente tem o elemento [tag] com o texto [text] (nele ou dentro dele), como no CallFlowTest.
    private fun showsTagWithText(tag: String, text: String): Boolean =
        try {
            compose.onAllNodes(hasTestTag(tag) and (hasText(text) or hasAnyDescendant(hasText(text))), useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        } catch (e: IllegalStateException) {
            false   // sem nenhuma tela do Compose na frente
        }

    // A área de toque do elemento [tag] tem pelo menos 48 × 48 dp (spec 3.3), mesmo com o desenho menor.
    private fun assertTouchAtLeast48(tag: String) {
        val node = compose.onNodeWithTag(tag).fetchSemanticsNode()
        val minimum = with(node.layoutInfo.density) { 48.dp.toPx() }
        val touch = node.touchBoundsInRoot
        assertTrue(
            "a área de toque de $tag tem ${touch.width} × ${touch.height} px (pelo menos $minimum)",
            touch.width >= minimum - 0.5f && touch.height >= minimum - 0.5f,
        )
    }

    // O lugar inteiro do elemento [tag] na tela (também a parte que a rolagem esconde).
    private fun layoutBounds(tag: String): Rect =
        compose.onNodeWithTag(tag).fetchSemanticsNode().let { Rect(it.positionInRoot, it.size.toSize()) }

    // A parte do elemento [tag] que aparece (cortada pela rolagem).
    private fun visibleBounds(tag: String): Rect = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot

    // A largura do elemento [tag], em dp.
    private fun widthDp(tag: String): Float {
        val node = compose.onNodeWithTag(tag).fetchSemanticsNode()
        return with(node.layoutInfo.density) { node.size.width.toDp().value }
    }

    // O texto do nó [node] como foi desenhado (as linhas e o corte).
    private fun textLayout(node: SemanticsNodeInteraction): TextLayoutResult {
        val results = mutableListOf<TextLayoutResult>()
        node.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(results) }
        return results.single()
    }

    private fun assertInside(what: String, inner: Rect, outer: Rect) {
        val inside = inner.left >= outer.left - EPSILON && inner.top >= outer.top - EPSILON &&
            inner.right <= outer.right + EPSILON && inner.bottom <= outer.bottom + EPSILON
        assertTrue("$what: $inner fora de $outer", inside)
    }

    private fun assertNoOverlap(parts: Map<String, Rect>) {
        val entries = parts.entries.toList()
        for (i in entries.indices) {
            for (j in i + 1 until entries.size) {
                val (a, first) = entries[i]
                val (b, second) = entries[j]
                val overlap = first.intersect(second)
                assertTrue(
                    "$a ($first) por cima de $b ($second)",
                    overlap.width <= EPSILON || overlap.height <= EPSILON,
                )
            }
        }
    }

    private companion object {
        const val DND = "nao-perturbe"
        const val AUTO = "atender-auto"
        const val REDIAL = "rediscar"
        const val DND_LINE = "Não perturbe · as ligações não tocam"
        const val EPSILON = 0.5f

        // Mais que os 1,5 s em que a dica do Material fica na tela, com a animação da saída.
        const val TOOLTIP_MILLIS = 2_000L
        val KEYS = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#")
        val TABS = listOf("aba-teclado", "aba-recentes", "aba-contatos")
        val TAB_LABELS = listOf("Teclado", "Recentes", "Contatos")
        val MAIN_TAGS = listOf("status", "menu", DND, AUTO, "numero", "apagar", REDIAL, "ligar") +
            KEYS.map { "tecla-$it" } + TABS
    }
}
