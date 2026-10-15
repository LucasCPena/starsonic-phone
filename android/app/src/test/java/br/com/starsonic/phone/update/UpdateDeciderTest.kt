package br.com.starsonic.phone.update

import br.com.starsonic.phone.core.Manifest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * O decisor da atualização (spec 7.6): o canal pela versão instalada, a espera de 24 h entre as verificações e o que
 * fazer com o versao-android.json (o núcleo falso tem as regras do ParseManifest e do CompareVersions).
 */
class UpdateDeciderTest {
    private val log = mutableListOf<String>()
    private val decider = UpdateDecider(ManifestCore(), log = { log += it })
    private var fetches = 0

    // O canal respondendo [json] (null: não respondeu), contando os pedidos.
    private fun channel(json: String?): () -> String? = {
        fetches++
        json
    }

    private fun published(version: String, notes: String? = "Correções.") =
        channel(manifestJson(version, apkUrl(version), SHA, notes))

    private fun decide(installed: String, json: () -> String?, last: Long = NEVER, inCall: Boolean = false) =
        decider.decide(installed, json, last, NOW, inCall)

    @Test
    fun `a newer version is offered with its notes`() {
        val decision = decide("0.1.0", published("0.1.1", notes = "Correção do áudio no Bluetooth."))
        assertEquals(
            Decision.PROMPT(Manifest("0.1.1", apkUrl("0.1.1"), SHA, "Correção do áudio no Bluetooth.")),
            decision,
        )
        decision as Decision.PROMPT
        assertEquals("0.1.1", decision.version)
        assertEquals("Correção do áudio no Bluetooth.", decision.notes)
        // A final depois das rc dela, a rc seguinte, e um manifesto sem notas.
        assertTrue(decide("0.1.0-rc.2", published("0.1.0")) is Decision.PROMPT)
        assertTrue(decide("0.1.0-rc.2", published("0.1.0-rc.3")) is Decision.PROMPT)
        assertEquals("", (decide("0.1.0", published("0.2.0", notes = null)) as Decision.PROMPT).notes)
    }

    @Test
    fun `the same or an older version is not offered`() {
        assertEquals(Decision.NONE, decide("0.1.1", published("0.1.1")))
        assertEquals(Decision.NONE, decide("0.1.1", published("0.1.0")))
        assertEquals(Decision.NONE, decide("0.1.0", published("0.1.0-rc.9")))
        assertEquals(Decision.NONE, decide("0.1.0-rc.2", published("0.1.0-rc.1")))
        assertEquals(Decision.NONE, decide("1.0.0", published("0.9.9"), inCall = true))
        assertTrue(log.toString(), log.any { "0.1.0-rc.9" in it })
    }

    @Test
    fun `an invalid channel or an installer outside the prefix is not offered`() {
        val releases = "https://github.com/LucasCPena/starsonic-phone/releases/download/"
        val invalid = listOf(
            "",
            "{",
            "[1,2]",
            "<html><body>Not Found</body></html>",
            """{"versao":"0.2.0"}""",
            manifestJson("0.2", apkUrl("0.2"), SHA),
            manifestJson("0.2.0", apkUrl("0.2.0"), "123"),
            // O instalador do Windows, o APK de outra conta, por HTTP, ou de fora das tags android-v.
            manifestJson("0.2.0", "${releases}v0.2.0/StarsonicPhone-0.2.0-setup.exe", SHA),
            manifestJson("0.2.0", "https://github.com/outra/starsonic-phone/releases/download/android-v0.2.0/x.apk", SHA),
            manifestJson("0.2.0", apkUrl("0.2.0").replace("https://", "http://"), SHA),
            manifestJson("0.2.0", "https://exemplo.com/StarsonicPhone-android-0.2.0.apk", SHA),
        )
        for (json in invalid) {
            assertEquals(json, Decision.NONE, decide("0.1.0", channel(json)))
        }
        // O canal que não respondeu (sem rede, HTTP 404).
        assertEquals(Decision.NONE, decide("0.1.0", channel(null)))
        assertTrue(log.toString(), log.any { "versao.json" in it })
    }

    @Test
    fun `a newer version during a call is blocked with the message`() {
        assertEquals(Decision.BLOCKED_BY_CALL, decide("0.1.0", published("0.1.1"), inCall = true))
        assertEquals("Termine a chamada para atualizar.", Decision.BLOCKED_BY_CALL.message)
    }

    @Test
    fun `less than 24 hours after the last check the channel is not fetched`() {
        assertEquals(Decision.NONE, decide("0.1.0", published("0.1.1"), last = NOW - DAY + 1))
        assertEquals(Decision.NONE, decide("0.1.0", published("0.1.1"), last = NOW))
        assertEquals("nenhum pedido ao canal", 0, fetches)
        assertTrue(decide("0.1.0", published("0.1.1"), last = NOW - DAY) is Decision.PROMPT)
        // Uma verificação "no futuro" (o relógio do celular voltou) não segura as próximas.
        assertTrue(decide("0.1.0", published("0.1.1"), last = NOW + 60_000) is Decision.PROMPT)
        assertEquals(2, fetches)
    }

    @Test
    fun `the channel follows the installed version`() {
        val releases = "https://github.com/LucasCPena/starsonic-phone/releases/download/"
        assertEquals("${releases}canal-teste-android/versao-android.json", UpdateDecider.channelUrl("0.1.0-rc.1"))
        assertEquals("${releases}canal-teste-android/versao-android.json", UpdateDecider.channelUrl("1.2.3-rc.12"))
        assertEquals("${releases}canal-android/versao-android.json", UpdateDecider.channelUrl("0.1.0"))
        assertEquals("${releases}canal-android/versao-android.json", UpdateDecider.channelUrl("1.2.3"))
        assertEquals("${releases}android-v", UpdateDecider.INSTALLER_PREFIX)
        assertEquals(24L * 60 * 60 * 1000, UpdateDecider.CHECK_INTERVAL_MILLIS)
    }

    @Test
    fun `the installer prefix can be another one for the test channel`() {
        val local = UpdateDecider(ManifestCore(), allowedPrefix = "http://10.0.2.2:8000/")
        val served = manifestJson("9.9.9", "http://10.0.2.2:8000/StarsonicPhone-android-9.9.9.apk", SHA)
        assertTrue(local.decide("0.0.0", { served }, NEVER, NOW, false) is Decision.PROMPT)
        // E o APK do GitHub não vale no canal de teste.
        assertEquals(Decision.NONE, local.decide("0.0.0", published("9.9.9"), NEVER, NOW, false))
    }

    private companion object {
        const val NOW = 1_760_000_000_000L
        const val DAY = 24L * 60 * 60 * 1000
        const val NEVER = 0L
        val SHA = "ab".repeat(32)
    }
}
