package br.com.starsonic.phone

import android.app.Activity
import android.app.Instrumentation
import android.app.Notification
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.Intents.intending
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import br.com.starsonic.phone.call.CallPhase
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.main.MainActivity
import br.com.starsonic.phone.update.Decision
import br.com.starsonic.phone.update.UpdateWorker
import java.io.File
import java.util.concurrent.TimeUnit
import org.junit.After
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
 * O atualizador no emulador (spec 7.6), com um canal de teste servido por um `python3 -m http.server` no computador do
 * CI (build/android/run-update-test.sh: a versão 9.9.9 e um APK qualquer, cujo SHA-256 não confere; o emulador o vê em
 * 10.0.2.2). Argumentos do am instrument, além dos do [Emulator]: canal (o endereço do versao-android.json) e prefixo
 * (o começo obrigatório do endereço do APK). O canal de teste só vale no build de debug (Updater.useTestChannel), que
 * deixa o HTTP sem TLS só para 10.0.2.2 (o network security config de src/debug).
 *
 * Cada teste começa com a conta gravada por TCP (o CI confere que o último REGISTER aceito veio por TCP), o canal de
 * teste nunca conferido, o app podendo instalar apps (appops REQUEST_INSTALL_PACKAGES) e o app aberto e conectado: a
 * abertura confere o canal (a última verificação tem mais de 24 h) e mostra o aviso.
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class UpdatePromptTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val emulator = Emulator(compose)
    private val app = emulator.app
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private val arguments = InstrumentationRegistry.getArguments()
    private val channelUrl = arguments.getString("canal") ?: "http://10.0.2.2:8000/versao-android.json"
    private val installerPrefix = arguments.getString("prefixo") ?: "http://10.0.2.2:8000/"
    private val notifications = app.getSystemService(NotificationManager::class.java)
    private var scenario: ActivityScenario<MainActivity>? = null
    private var recording = false

    @Before
    fun openWithTheTestChannel() {
        // A tela acesa e sem bloqueio, como num celular em uso.
        device.wakeUp()
        device.executeShellCommand("svc power stayon true")
        device.executeShellCommand("wm dismiss-keyguard")
        emulator.startClean()
        app.store.save(Account(emulator.registrar, Transport.TCP, "2001", emulator.senha))
        app.updater.useTestChannel(channelUrl, installerPrefix)
        allowInstallingApps("allow")
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitForText("Conectado · 2001")
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
        allowInstallingApps("default")
        notifications.cancelAll()
        scenario?.close()
        // A abertura pela notificação pode criar outra MainActivity, fora do ActivityScenario: ela sai também.
        emulator.waitUntil("as telas do app fecharem") { finishActivities() == 0 }
    }

    @Test
    fun aNewVersionIsOfferedAndAFailedDownloadKeepsTheAppOpen() {
        emulator.waitForText(QUESTION)
        emulator.waitForText(NOTES)
        compose.onNodeWithTag("atualizar").performClick()
        // O SHA-256 do canal não é o do APK servido: o arquivo é apagado e o aviso aparece.
        emulator.waitForText(DOWNLOAD_FAILED)
        assertFalse("o APK que não confere foi apagado", downloaded().exists())
        compose.onNodeWithTag("atualizacao-ok").performClick()
        emulator.waitUntil("o aviso sair") { !emulator.showsText(DOWNLOAD_FAILED) }
        // O app continua aberto, na tela principal e conectado, sem pedir a instalação ao Android.
        emulator.waitUntil("a tela principal") { emulator.showsTag("aba-teclado") }
        assertEquals(Lifecycle.State.RESUMED, scenario!!.state)
        emulator.waitForText("Conectado · 2001")
        assertNull("nenhuma confirmação do instalador do Android", app.updateInstaller.confirmation.value)
    }

    @Test
    fun aVersionFoundInTheBackgroundIsNotifiedAndTheNotificationOpensThePrompt() {
        emulator.waitForText(QUESTION)
        compose.onNodeWithTag("agora-nao").performClick()
        emulator.waitUntil("o aviso sair") { !emulator.showsText(QUESTION) }
        device.pressHome()
        emulator.waitUntil("o app em segundo plano") { !app.updater.visible }
        // A verificação de 24 h (o que o UpdateWorker roda), com o canal de teste ainda não conferido.
        app.updater.useTestChannel(channelUrl, installerPrefix)
        assertTrue(UpdateWorker.check(app) is Decision.PROMPT)
        val shown = updateNotification()
        assertNotNull("a notificação da versão nova", shown)
        assertEquals(QUESTION, shown!!.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString())
        val channel = notifications.getNotificationChannel(UPDATE_CHANNEL)
        assertEquals("Atualizações", channel.name.toString())
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, channel.importance)
        // Tocar na notificação (na gaveta do Android) abre o app com o aviso.
        device.openNotification()
        val title = device.wait(Until.findObject(By.pkg(SYSTEM_UI).textContains("Nova versão do Starsonic Phone")), 10_000)
        assertNotNull("a notificação na gaveta", title)
        title.click()
        emulator.waitForText(QUESTION)
        emulator.waitUntil("a notificação sair") { updateNotification() == null }
    }

    @Test
    fun theDailyCheckIsScheduledWithNetwork() {
        val works = WorkManager.getInstance(app).getWorkInfosForUniqueWork(UpdateWorker.NAME).get()
        assertEquals("um trabalho único: $works", 1, works.size)
        val work = works.single()
        assertEquals(WorkInfo.State.ENQUEUED, work.state)
        assertEquals("a cada 24 h", TimeUnit.HOURS.toMillis(24), work.periodicityInfo?.repeatIntervalMillis)
        assertEquals("com rede", NetworkType.CONNECTED, work.constraints.requiredNetworkType)
    }

    @Test
    fun updateDuringACallShowsTheMessageAndNothingElseHappens() {
        emulator.waitForText(QUESTION)
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a ligação tocando") { app.calls.state.value?.phase == CallPhase.RINGING }
        app.calls.answer()
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        compose.onNodeWithTag("atualizar").performClick()
        emulator.waitForText("Termine a chamada para atualizar.")
        assertFalse("nada foi baixado", downloaded().exists())
        compose.onNodeWithTag("atualizacao-ok").performClick()
        assertEquals("OK", emulator.control("HANGUP 2001"))
        emulator.waitUntil("a ligação acabar") { app.calls.state.value == null }
        // Nada mais acontece: o aviso não volta depois da ligação (a próxima verificação é em 24 h).
        Thread.sleep(2_000)
        assertFalse("o aviso de novo", emulator.showsTag("atualizar"))
        assertNull(app.updater.ui.value)
    }

    @Test
    fun withoutPermissionToInstallAppsUpdateOpensTheAndroidSetting() {
        allowInstallingApps("deny")
        // O ajuste não abre de verdade: o pedido fica no lugar.
        intending(hasAction(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES))
            .respondWith(Instrumentation.ActivityResult(Activity.RESULT_OK, null))
        emulator.waitForText(QUESTION)
        compose.onNodeWithTag("atualizar").performClick()
        val setting = sentIntent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
        assertEquals(Uri.parse("package:${app.packageName}"), setting.data)
        // O aviso continua (de volta do ajuste, Atualizar de novo), e nada foi baixado.
        assertTrue(emulator.showsText(QUESTION))
        assertFalse(downloaded().exists())
    }

    // O APK baixado (cacheDir/update.apk).
    private fun downloaded() = File(app.cacheDir, "update.apk")

    // A permissão de instalar apps (o "Instalar apps desconhecidos" do app): allow, deny ou default.
    private fun allowInstallingApps(mode: String) {
        device.executeShellCommand("appops set ${app.packageName} REQUEST_INSTALL_PACKAGES $mode")
    }

    // A notificação de versão nova (canal "atualizacao"), ou null.
    private fun updateNotification(): Notification? =
        notifications.activeNotifications.firstOrNull { it.notification.channelId == UPDATE_CHANNEL }?.notification

    // O último pedido com [action] que o app mandou (o Espresso-Intents guarda todos e os lê na thread principal).
    private fun sentIntent(action: String): Intent {
        var found: Intent? = null
        emulator.waitUntil("o pedido $action", 10_000) {
            found = Intents.getIntents().lastOrNull { it.action == action }
            found != null
        }
        return found!!
    }

    // Pede o fim das MainActivity que ainda não acabaram e diz quantas eram.
    private fun finishActivities(): Int {
        var alive = 0
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val monitor = ActivityLifecycleMonitorRegistry.getInstance()
            val activities = LIVE_STAGES.flatMap { monitor.getActivitiesInStage(it) }.filterIsInstance<MainActivity>()
            activities.filter { !it.isFinishing }.forEach { it.finish() }
            alive = activities.size
        }
        return alive
    }

    private companion object {
        // O canal servido pelo run-update-test.sh.
        const val QUESTION = "Nova versão do Starsonic Phone disponível (9.9.9). Atualizar agora?"
        const val NOTES = "Versão de teste do atualizador."
        const val DOWNLOAD_FAILED = "Não foi possível baixar a atualização. Tentaremos de novo mais tarde."
        const val UPDATE_CHANNEL = "atualizacao"
        const val SYSTEM_UI = "com.android.systemui"
        val LIVE_STAGES = listOf(
            Stage.PRE_ON_CREATE, Stage.CREATED, Stage.STARTED, Stage.RESUMED, Stage.PAUSED, Stage.STOPPED, Stage.RESTARTED,
        )
    }
}
