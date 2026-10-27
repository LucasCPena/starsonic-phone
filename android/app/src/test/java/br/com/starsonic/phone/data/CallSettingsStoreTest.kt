package br.com.starsonic.phone.data

import br.com.starsonic.phone.engine.Transport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * As configurações de ligação no SharedPreferences "configuracoes", com o falso da memória ([FakePreferences]): as
 * chaves nao_perturbe, atender_auto, atender_segundos, bipe_fim e bipe_teclas, e os de fábrica (desligados, 3 s e os
 * dois bipes ligados).
 */
class CallSettingsStoreTest {
    private val preferences = FakePreferences()

    @Test
    fun `defaults are off, three seconds and both beeps on`() {
        val read = PreferencesCallSettingsStore(preferences).settings.value
        assertEquals(
            CallSettings(doNotDisturb = false, autoAnswer = false, autoAnswerSeconds = 3, endBeep = true, keyTones = true),
            read,
        )
        assertEquals("os de fábrica do CallSettings são os mesmos", CallSettings(), read)
    }

    @Test
    fun `changes are saved and read back`() {
        val store = PreferencesCallSettingsStore(preferences)
        store.update { it.copy(doNotDisturb = true) }
        // A segunda mudança parte da primeira.
        store.update { it.copy(autoAnswer = true, autoAnswerSeconds = 5, endBeep = false, keyTones = false) }
        val changed = CallSettings(doNotDisturb = true, autoAnswer = true, autoAnswerSeconds = 5, endBeep = false, keyTones = false)
        assertEquals("na hora", changed, store.settings.value)
        assertEquals(
            "no arquivo",
            mapOf(
                "nao_perturbe" to true, "atender_auto" to true, "atender_segundos" to 5, "bipe_fim" to false,
                "bipe_teclas" to false,
            ),
            preferences.values,
        )
        val reopened = PreferencesCallSettingsStore(preferences)
        assertEquals("o app aberto de novo lê as mudanças", changed, reopened.settings.value)
    }

    @Test
    fun `a file from before the key tones reads them as on`() {
        // O arquivo de quem atualiza da 0.2.0-rc.2, sem a chave bipe_teclas: o Bipe ao digitar vem ligado, e o resto fica
        // como estava.
        preferences.edit()
            .putBoolean("nao_perturbe", true)
            .putBoolean("atender_auto", true)
            .putInt("atender_segundos", 8)
            .putBoolean("bipe_fim", false)
            .commit()
        assertEquals(
            CallSettings(doNotDisturb = true, autoAnswer = true, autoAnswerSeconds = 8, endBeep = false, keyTones = true),
            PreferencesCallSettingsStore(preferences).settings.value,
        )
    }

    @Test
    fun `an unknown auto answer time reads as three seconds`() {
        fun readSeconds(stored: Int): Int {
            preferences.edit().putInt("atender_segundos", stored).commit()
            return PreferencesCallSettingsStore(preferences).settings.value.autoAnswerSeconds
        }
        for (unknown in listOf(4, 7, 31, -1)) assertEquals("$unknown s", 3, readSeconds(unknown))
        // As opções do "Tempo para atender" valem como estão.
        for (option in listOf(0, 1, 2, 3, 5, 8, 10, 15, 20, 30)) assertEquals("$option s", option, readSeconds(option))
    }

    @Test
    fun `the auto answer options are the Windows ones, in order`() {
        // O "Tempo para atender" das Configurações oferece estas, nesta ordem (spec 5).
        assertEquals(listOf(0, 1, 2, 3, 5, 8, 10, 15, 20, 30), AUTO_ANSWER_SECONDS)
    }

    @Test
    fun `call settings survive sign out`() {
        // Cada arquivo do app pelo nome, como no getSharedPreferences: o da conta e o das configurações de ligação.
        val files = HashMap<String, FakePreferences>()
        fun file(name: String) = files.getOrPut(name) { FakePreferences() }
        val account = PreferencesAccountStore(file(PreferencesAccountStore.FILE), FakeSeal())
        account.save(Account("sip.exemplo.com.br", Transport.TCP, "2001", "senha"))
        val changed = CallSettings(doNotDisturb = true, autoAnswer = true, autoAnswerSeconds = 10, endBeep = false, keyTones = false)
        PreferencesCallSettingsStore(file(PreferencesCallSettingsStore.FILE)).update { changed }
        account.clear()   // o Sair da conta
        assertNull("a conta saiu", account.load())
        assertEquals(
            "as configurações ficaram para o próximo Entrar",
            changed,
            PreferencesCallSettingsStore(file(PreferencesCallSettingsStore.FILE)).settings.value,
        )
    }
}
