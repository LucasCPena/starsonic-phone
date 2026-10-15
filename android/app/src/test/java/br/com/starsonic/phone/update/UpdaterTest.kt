package br.com.starsonic.phone.update

import java.io.File
import java.util.concurrent.Executor
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * O atualizador (spec 7.6) com a rede e a instalação falsas: o aviso, o download para cacheDir/update.apk, o SHA-256, a
 * ligação em andamento, a permissão de instalar apps e a hora da última verificação. Tudo roda na hora (o executor
 * do teste roda na thread de quem pede).
 */
class UpdaterTest {
    @get:Rule
    val folder = TemporaryFolder()

    private var now = 1_760_000_000_000L
    private var inCall = false
    private val network = FakeNetwork()
    private val installer = FakeInstaller()
    private val store = MemoryStore()
    private val log = mutableListOf<String>()
    private lateinit var cache: File

    @Before
    fun createCache() {
        cache = folder.newFolder("cache")
    }

    private fun updater(channel: UpdateChannel? = CHANNEL, testChannels: Boolean = false) = Updater(
        core = ManifestCore(),
        network = network,
        installer = installer,
        store = store,
        installedVersion = "0.1.0",
        inCall = { inCall },
        cacheDir = { cache },
        channel = channel,
        testChannels = testChannels,
        nowMillis = { now },
        log = { log += it },
        background = Executor { it.run() },
    )

    // O canal com a versão 0.1.1, cujo APK é [apk] (com o SHA-256 [sha], o certo se nada for dito); a verificação de
    // ao abrir, e o aviso que ela mostrou.
    private fun offered(updater: Updater, apk: ByteArray = APK, sha: String = sha256(apk)): UpdateUi.Offer {
        network.texts[CHANNEL.url] = manifestJson("0.1.1", APK_URL, sha, "Correções.")
        network.files[APK_URL] = apk
        updater.checkSoon()
        val shown = updater.ui.value
        assertTrue("o aviso da versão nova: $shown\n$log", shown is UpdateUi.Offer)
        return shown as UpdateUi.Offer
    }

    private fun downloaded(): File = File(cache, "update.apk")

    @Test
    fun `a newer version is offered with the question and the notes`() {
        val updater = updater()
        val offer = offered(updater)
        assertEquals("0.1.1", offer.manifest.versionText)
        assertEquals("Correções.", offer.manifest.notes)
        assertEquals("Nova versão do Starsonic Phone disponível (0.1.1). Atualizar agora?", UpdateDecider.question("0.1.1"))
        assertEquals(listOf(CHANNEL.url), network.fetched)
    }

    @Test
    fun `a download whose SHA-256 does not match is deleted and shows the message`() {
        val updater = updater()
        offered(updater, sha = sha256("outro APK".toByteArray()))
        updater.accept()
        assertEquals(UpdateUi.Notice(DOWNLOAD_FAILED), updater.ui.value)
        assertEquals("o download aconteceu", listOf(APK_URL), network.opened)
        assertFalse("o APK que não confere foi apagado", downloaded().exists())
        assertTrue("nada foi para o instalador", installer.installed.isEmpty())
        assertTrue(log.toString(), log.any { "SHA-256" in it })
    }

    @Test
    fun `a download cut in the middle is deleted and shows the same message`() {
        val updater = updater()
        offered(updater)
        network.cutAfter = 3 * FakeNetwork.CHUNK
        updater.accept()
        assertEquals(UpdateUi.Notice(DOWNLOAD_FAILED), updater.ui.value)
        assertFalse("o pedaço baixado foi apagado", downloaded().exists())
        assertTrue(installer.installed.isEmpty())
    }

    @Test
    fun `a download that ends early without an error is deleted and shows the same message`() {
        val updater = updater()
        offered(updater)
        network.endAfter = APK.size / 2
        updater.accept()
        assertEquals(UpdateUi.Notice(DOWNLOAD_FAILED), updater.ui.value)
        assertFalse(downloaded().exists())
        assertTrue(installer.installed.isEmpty())
    }

    @Test
    fun `a download that does not start shows the same message`() {
        val updater = updater()
        offered(updater)
        network.files.clear()   // o APK não está lá (HTTP 404)
        updater.accept()
        assertEquals(UpdateUi.Notice(DOWNLOAD_FAILED), updater.ui.value)
        assertFalse(downloaded().exists())
    }

    @Test
    fun `a verified download goes to the Android installer and leaves no copy behind`() {
        val updater = updater()
        offered(updater)
        updater.accept()
        assertEquals(1, installer.installed.size)
        assertArrayEquals("o APK inteiro, conferido", APK, installer.installed.single())
        assertNull("o aviso sai: o Android mostra a confirmação", updater.ui.value)
        assertFalse("a cópia em cacheDir sai depois de entregue à sessão", downloaded().exists())
        assertEquals("a resposta conta como verificação", now, store.lastCheckMillis)
    }

    @Test
    fun `a session that cannot be opened deletes the APK and shows the message`() {
        val updater = updater()
        offered(updater)
        installer.fails = true
        updater.accept()
        assertEquals(UpdateUi.Notice(DOWNLOAD_FAILED), updater.ui.value)
        assertFalse(downloaded().exists())
    }

    @Test
    fun `Atualizar during a call shows the message and nothing else happens`() {
        val updater = updater()
        offered(updater)
        inCall = true
        updater.accept()
        assertEquals(UpdateUi.Notice("Termine a chamada para atualizar."), updater.ui.value)
        assertTrue("nada foi baixado", network.opened.isEmpty())
        assertTrue(installer.installed.isEmpty())
        assertEquals("a próxima verificação, em 24 h", now, store.lastCheckMillis)
        // OK: o aviso sai, e nada volta antes de 24 h.
        updater.dismiss()
        inCall = false
        now += 60 * 60 * 1000
        updater.checkSoon()
        assertNull(updater.ui.value)
        assertEquals(1, network.fetched.size)
    }

    @Test
    fun `a call that starts during the download stops the installation`() {
        val updater = updater()
        offered(updater)
        network.duringDownload = { inCall = true }
        updater.accept()
        assertEquals(UpdateUi.Notice("Termine a chamada para atualizar."), updater.ui.value)
        assertTrue("nada foi para o instalador", installer.installed.isEmpty())
        assertFalse(downloaded().exists())
    }

    @Test
    fun `without permission to install apps the setting opens and the offer stays`() {
        val updater = updater()
        val offer = offered(updater)
        installer.allowed = false
        updater.accept()
        assertEquals("o ajuste do Android abriu", 1, installer.asked)
        assertEquals("o aviso continua", offer, updater.ui.value)
        assertTrue("nada foi baixado", network.opened.isEmpty())
        assertEquals("sem resposta, a verificação não conta (o processo pode morrer no ajuste)", 0L, store.lastCheckMillis)
        // De volta do ajuste, com a permissão: Atualizar de novo baixa e instala.
        installer.allowed = true
        updater.accept()
        assertEquals(1, installer.installed.size)
    }

    @Test
    fun `the time of the check is kept only when the channel answered`() {
        val updater = updater()
        updater.checkSoon()   // sem rede
        assertEquals(0L, store.lastCheckMillis)
        assertNull(updater.ui.value)
        network.texts[CHANNEL.url] = manifestJson("0.1.0", "${UpdateDecider.INSTALLER_PREFIX}0.1.0/a.apk", sha256(APK))
        updater.checkSoon()   // a mesma versão
        assertEquals(now, store.lastCheckMillis)
        assertNull(updater.ui.value)
        // Uma versão nova publicada 1 h depois só é vista 24 h depois da última verificação.
        network.texts[CHANNEL.url] = manifestJson("0.1.1", APK_URL, sha256(APK))
        now += 60 * 60 * 1000
        updater.checkSoon()
        assertEquals(2, network.fetched.size)
        assertNull(updater.ui.value)
        now += 23 * 60 * 60 * 1000
        updater.checkSoon()
        assertEquals(3, network.fetched.size)
        assertTrue(updater.ui.value is UpdateUi.Offer)
    }

    @Test
    fun `Agora nao closes the offer and the next one comes after 24 hours`() {
        val updater = updater()
        offered(updater)
        updater.dismiss()
        assertNull(updater.ui.value)
        assertEquals(now, store.lastCheckMillis)
        now += 23 * 60 * 60 * 1000
        updater.checkSoon()
        assertNull(updater.ui.value)
        assertEquals(1, network.fetched.size)
        now += 60 * 60 * 1000
        updater.checkSoon()
        assertTrue(updater.ui.value is UpdateUi.Offer)
    }

    @Test
    fun `an offer not answered yet is not fetched again and is not counted`() {
        val updater = updater()
        offered(updater)
        now += 25 * 60 * 60 * 1000
        updater.checkSoon()
        assertEquals("nenhum pedido a mais", 1, network.fetched.size)
        // Sem resposta (o processo morreu com o aviso aberto), a próxima abertura confere de novo.
        assertEquals(0L, store.lastCheckMillis)
    }

    @Test
    fun `a newer version found during a call shows the message only with the app on screen`() {
        val updater = updater()
        network.texts[CHANNEL.url] = manifestJson("0.1.1", APK_URL, sha256(APK))
        inCall = true
        // Em segundo plano (a verificação de 24 h): nada aparece e nada conta; a próxima abertura confere de novo.
        assertEquals(Decision.BLOCKED_BY_CALL, updater.checkNow())
        assertNull(updater.ui.value)
        assertEquals(0L, store.lastCheckMillis)
        // Na frente: o aviso, uma vez (a próxima verificação, em 24 h).
        updater.onScreen(true)
        assertTrue(updater.visible)
        updater.checkSoon()
        assertEquals(UpdateUi.Notice("Termine a chamada para atualizar."), updater.ui.value)
        assertEquals(now, store.lastCheckMillis)
        updater.onScreen(false)
        assertFalse(updater.visible)
    }

    @Test
    fun `the background check answers with the decision`() {
        val updater = updater()
        network.texts[CHANNEL.url] = manifestJson("0.1.1", APK_URL, sha256(APK))
        val decision = updater.checkNow()
        assertTrue(decision is Decision.PROMPT)
        assertEquals("o aviso espera a abertura do app", UpdateUi.Offer((decision as Decision.PROMPT).manifest), updater.ui.value)
    }

    @Test
    fun `without a channel nothing is checked`() {
        val updater = updater(channel = null)
        updater.checkSoon()
        assertEquals(Decision.NONE, updater.checkNow())
        assertTrue(network.fetched.isEmpty())
        assertNull(updater.ui.value)
    }

    @Test
    fun `the test channel is only for debug builds and starts over`() {
        val release = updater(testChannels = false)
        assertTrue(runCatching { release.useTestChannel(TEST_URL, TEST_PREFIX) }.exceptionOrNull() is IllegalStateException)

        store.lastCheckMillis = now   // conferido agora há pouco, no canal de antes
        val debug = updater(channel = null, testChannels = true)
        debug.useTestChannel(TEST_URL, TEST_PREFIX)
        assertEquals("o canal novo nunca foi conferido", 0L, store.lastCheckMillis)
        network.texts[TEST_URL] = manifestJson("9.9.9", "${TEST_PREFIX}StarsonicPhone-android-9.9.9.apk", sha256(APK))
        debug.checkSoon()
        assertEquals(listOf(TEST_URL), network.fetched)
        assertEquals("9.9.9", (debug.ui.value as UpdateUi.Offer).manifest.versionText)
    }

    @Test
    fun `an APK left by a process that died is removed`() {
        downloaded().writeText("pedaço de um download que não acabou")
        updater()
        assertFalse(downloaded().exists())
    }

    private companion object {
        val CHANNEL = UpdateChannel.of("0.1.0")
        val APK_URL = apkUrl("0.1.1")
        val APK = ByteArray(10 * FakeNetwork.CHUNK + 123) { (it * 31 + 7).toByte() }
        const val DOWNLOAD_FAILED = "Não foi possível baixar a atualização. Tentaremos de novo mais tarde."
        const val TEST_URL = "http://10.0.2.2:8000/versao-android.json"
        const val TEST_PREFIX = "http://10.0.2.2:8000/"
    }
}
