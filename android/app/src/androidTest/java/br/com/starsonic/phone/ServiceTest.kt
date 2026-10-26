package br.com.starsonic.phone

import android.app.Notification
import android.app.NotificationManager
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.main.MainActivity
import br.com.starsonic.phone.service.SipService
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * O serviço em primeiro plano no emulador, com o motor de verdade e o registrador falso do CI (ramal 2001,
 * visto em 10.0.2.2; ver [Emulator]). Os registros vão por TCP: o CI confere no fim que o último REGISTER
 * aceito veio por TCP.
 *
 * Os testes rodam em ordem alfabética, e o último deixa a conta gravada. O CI para o app à força em seguida e
 * confere que o BOOT_COMPLETED registra a conta de novo e segura o processador acordado
 * (build/android/check-boot.sh).
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class ServiceTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val emulator = Emulator(compose)
    private val app = emulator.app
    private var scenario: ActivityScenario<MainActivity>? = null

    @Before
    fun startClean() {
        emulator.startClean()
    }

    @After
    fun closeApp() {
        scenario?.close()
    }

    @Test
    fun loginShowsTheConnectedNotification() {
        val before = emulator.registers()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        login()
        emulator.waitForText("Conectado · ${emulator.registrar}")
        emulator.waitUntil("a notificação \"Conectado (ramal 2001)\"") { notificationTitle() == "Conectado (ramal 2001)" }
        // O serviço ficou com a conta que a tela Entrar registrou: nenhum REGISTER a mais.
        Thread.sleep(3_000)
        assertEquals("REGISTER aceitos do ramal 2001", before + 1, emulator.registers())
    }

    @Test
    fun noAccountServiceLeaves() {
        // Sem conta gravada, o serviço que começa sai sozinho, sem deixar a notificação.
        val starts = SipService.startCommands
        assertTrue("SipService.start", SipService.start(app))
        emulator.waitUntil("o serviço começar") { SipService.startCommands > starts }
        emulator.waitUntil("o serviço sair") { !SipService.running }
        emulator.waitUntil("a notificação sair") { notificationTitle() == null }
    }

    @Test
    fun savedAccountStartsTheServiceOnOpen() {
        // Com a conta gravada (como depois de um Entrar) e o serviço parado, abrir o app inicia o serviço, que
        // registra a conta uma vez só: 3 s depois, nenhum REGISTER a mais. A conta fica gravada para a
        // conferência do BOOT_COMPLETED.
        app.store.save(Account(emulator.registrar, Transport.TCP, "2001", emulator.senha))
        val before = emulator.registers()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitForText("Conectado · ${emulator.registrar}")
        emulator.waitUntil("a notificação \"Conectado (ramal 2001)\"") { notificationTitle() == "Conectado (ramal 2001)" }
        Thread.sleep(3_000)
        assertEquals("REGISTER aceitos do ramal 2001", before + 1, emulator.registers())
    }

    private fun login() {
        emulator.waitUntil("a tela Entrar") { compose.onAllNodesWithTag("entrar").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("servidor").performScrollTo().performTextInput(emulator.registrar)
        compose.onNodeWithTag("protocolo").performClick()
        compose.onNodeWithText("TCP").performClick()
        compose.onNodeWithTag("ramal").performScrollTo().performTextInput("2001")
        compose.onNodeWithTag("senha").performScrollTo().performTextInput(emulator.senha)
        compose.onNodeWithTag("entrar").performScrollTo().performClick()
    }

    /** O título da notificação fixa do app (canal "conexao"), ou null se ela não está lá. */
    private fun notificationTitle(): String? {
        val manager = app.getSystemService(NotificationManager::class.java)
        val shown = manager.activeNotifications.firstOrNull { it.notification.channelId == "conexao" } ?: return null
        assertTrue(
            "a notificação da conexão é a do serviço em primeiro plano",
            shown.notification.flags and Notification.FLAG_FOREGROUND_SERVICE != 0,
        )
        return shown.notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
    }
}
