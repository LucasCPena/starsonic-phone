package br.com.starsonic.phone

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.Person
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import br.com.starsonic.phone.call.CallActivity
import br.com.starsonic.phone.call.CallPhase
import br.com.starsonic.phone.call.IncomingCallNotifier
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.data.CallKind
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.main.MainActivity
import java.util.regex.Pattern
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestRule
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * Os contatos do celular no emulador (spec da 0.2, 7.5 e 11.2), com o motor de verdade e o registrador falso do CI
 * (ver [Emulator] e o CallFlowTest): antes de cada teste, o contato "Maria Silva" com o número 3001 (o de quem liga no
 * RING do registrador, "Cliente Teste" <sip:3001@ci>) entra na agenda do emulador pelo shell (content insert), e sai
 * depois (também um que sobrou de um teste que caiu), para não mudar o nome das ligações das outras classes. Cada teste
 * começa com a conta gravada por TCP e o app aberto, como no CallFlowTest.
 *
 * A ordem dos testes importa: o pm revoke de uma permissão concedida fecha o processo do app, que é o processo dos
 * testes. Então withoutThePermissionTheTabAsksForIt tem de rodar primeiro, com a permissão dos contatos nunca dada
 * desde a instalação (o run-emulator-tests.sh não a dá), e os outros dois a recebem (GrantPermissionRule, que não
 * fecha nada). O MethodSorters.DEFAULT do JUnit 4 ordena pelo hashCode do nome do método (String.hashCode) e, no
 * empate, pelo nome: withoutThePermissionTheTabAsksForIt (-1975807618) vem antes de contactsTabListsAndCalls
 * (881336785) e de incomingCallShowsTheContactName (908490252). Um nome novo ou trocado pode mudar a ordem: o primeiro
 * passo de withoutThePermissionTheTabAsksForIt confere que a permissão ainda não foi dada, e falha com o motivo (em vez
 * de o pm revoke fechar o processo no meio).
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.DEFAULT)
class ContactsFlowTest {
    // A permissão dos contatos para todos os testes menos o que confere o pedido dela.
    @get:Rule
    val contactsPermission: TestRule = TestRule { base, description ->
        if (description.methodName == WITHOUT_PERMISSION) {
            base
        } else {
            GrantPermissionRule.grant(Manifest.permission.READ_CONTACTS).apply(base, description)
        }
    }

    @get:Rule
    val compose = createEmptyComposeRule()

    private val emulator = Emulator(compose)
    private val app = emulator.app
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private var scenario: ActivityScenario<MainActivity>? = null

    @Before
    fun connect() {
        device.wakeUp()
        device.executeShellCommand("svc power stayon true")
        device.executeShellCommand("wm dismiss-keyguard")
        emulator.startClean()
        app.recents.clear()
        removeContacts()
        insertContact()
        app.store.save(Account(emulator.registrar, Transport.TCP, "2001", emulator.senha))
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitForText("Conectado · 2001")
    }

    @After
    fun close() {
        try {
            if (app.calls.state.value != null) {
                emulator.control("HANGUP 2001")
                app.calls.hangup()
            }
            scenario?.close()
        } finally {
            removeContacts()
        }
    }

    @Test
    fun withoutThePermissionTheTabAsksForIt() {
        assertFalse(
            "a permissão dos contatos já foi dada neste processo: o pm revoke fecharia o app (e os testes); " +
                "este teste precisa ser o primeiro da classe (ver a ordem no começo do ContactsFlowTest)",
            app.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED,
        )
        emulator.shell("pm revoke $PACKAGE ${Manifest.permission.READ_CONTACTS}")
        // Um "não perguntar de novo" que tenha ficado faria o Android negar sem a janela.
        emulator.shell("pm clear-permission-flags $PACKAGE ${Manifest.permission.READ_CONTACTS} user-set user-fixed")
        compose.onNodeWithTag("aba-contatos").performClick()
        // A primeira abertura da aba pede a permissão pela janela do Android (do PermissionController), e a pessoa
        // nega: o "Não permitir", ou, se o botão não for achado, o voltar (que também fecha a janela sem a permissão).
        emulator.waitUntil("a janela da permissão dos contatos", details = ::systemScreen) {
            device.currentPackageName.orEmpty().contains("permissioncontroller")
        }
        val deny = device.wait(Until.findObject(By.res(DENY_ID)), 3_000)
            ?: device.wait(Until.findObject(By.text(DENY_TEXT)), 2_000)
        if (deny != null) deny.click() else device.pressBack()
        emulator.waitUntil("o Permitir", details = ::systemScreen) { emulator.showsTag("contatos-permitir") }
        assertTrue(emulator.showsText("Permita o acesso aos contatos para ligar pelo nome."))
        assertFalse("a busca sem a permissão", emulator.showsTag("contatos-busca"))
    }

    @Test
    fun contactsTabListsAndCalls() {
        val before = emulator.callLog().size
        compose.onNodeWithTag("aba-contatos").performClick()
        emulator.waitUntil("a busca dos contatos") { emulator.showsTag("contatos-busca") }
        compose.onNodeWithTag("contatos-busca").performTextInput("Mar")
        emulator.waitUntil("o contato na lista") { emulator.showsTag("contato-Maria Silva") }
        compose.onNodeWithTag("contato-Maria Silva").performClick()
        // Um número só: liga direto (o 3001 é um ramal: a regra dos números dos contatos o deixa como está).
        waitForLog(before, "inv-in 3001 200")
        emulator.waitUntil("a ligação atendida") { app.calls.state.value?.phase == CallPhase.ACTIVE }
        emulator.waitUntil("a tela de chamada com o nome do contato") { showsTagWithText("chamada", CONTACT) }
        compose.onNodeWithTag("desligar").performClick()
        emulator.waitUntil("a ligação acabar") { app.calls.state.value == null }
        // O Recentes guarda o número (e nenhum nome, o da central), e mostra o nome do contato.
        emulator.waitUntil("a feita no Recentes") { app.recents.list().firstOrNull()?.kind == CallKind.FEITA }
        assertEquals("" to "3001", app.recents.list().first().let { it.name to it.number })
        scenario?.close()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        emulator.waitUntil("a aba Recentes") { emulator.showsTag("aba-recentes") }
        compose.onNodeWithTag("aba-recentes").performClick()
        emulator.waitUntil("o nome do contato no Recentes") { showsTagWithText("recente", CONTACT) }
    }

    @Test
    fun incomingCallShowsTheContactName() {
        assertEquals("OK", emulator.control("RING 2001"))
        emulator.waitUntil("a ligação tocando") { app.calls.state.value?.phase == CallPhase.RINGING }
        assertEquals(CONTACT, app.calls.state.value?.name)
        // A notificação de ligação também (o nome vai pelo Telecom).
        emulator.waitUntil("a notificação com o nome do contato", details = ::notifications) {
            callNotificationPerson() == CONTACT
        }
        app.startActivity(CallActivity.intent(app))
        emulator.waitUntil("a tela de chamada com o nome do contato") {
            emulator.showsTag("atender") && showsTagWithText("chamada", CONTACT)
        }
        compose.onNodeWithTag("recusar").performClick()
        emulator.waitUntil("a ligação acabar") { app.calls.state.value == null }
        emulator.waitUntil("a perdida no Recentes") { app.recents.list().firstOrNull()?.kind == CallKind.PERDIDA }
        assertEquals("o Recentes guarda o nome da central", "Cliente Teste", app.recents.list().first().name)
    }

    // O contato "Maria Silva" (nome e sobrenome: o shell separa os argumentos nos espaços) com o número 3001, numa conta
    // local (sem conta do Google), conferido na lista de números da agenda.
    private fun insertContact() {
        val before = rawContactIds()
        emulator.shell("content insert --uri $RAW_CONTACTS --bind account_type:n: --bind account_name:n:")
        val id = (rawContactIds().keys - before.keys).singleOrNull()
            ?: throw AssertionError("o contato não entrou na agenda (raw_contacts: ${rawContactIds()})")
        emulator.shell(
            "content insert --uri $DATA --bind raw_contact_id:l:$id --bind mimetype:s:$NAME_TYPE " +
                "--bind data2:s:Maria --bind data3:s:Silva",
        )
        emulator.shell(
            "content insert --uri $DATA --bind raw_contact_id:l:$id --bind mimetype:s:$PHONE_TYPE " +
                "--bind data1:s:3001 --bind data2:i:2",
        )
        val phones = emulator.shell("content query --uri $PHONES --projection display_name:data1")
        assertTrue("o contato na agenda: $phones", phones.any { "display_name=$CONTACT" in it && "data1=3001" in it })
    }

    // Tira da agenda os contatos "Maria Silva" (o deste teste, ou um que sobrou), de vez (como o adaptador de
    // sincronização: sem ficar marcado como apagado).
    private fun removeContacts() {
        for ((id, name) in rawContactIds()) {
            if (name == CONTACT) emulator.shell("content delete --uri $RAW_CONTACTS/$id?caller_is_syncadapter=true")
        }
    }

    // Os contatos da agenda (raw_contacts): o id e o nome.
    private fun rawContactIds(): Map<Long, String> =
        emulator.shell("content query --uri $RAW_CONTACTS --projection _id:display_name").mapNotNull { line ->
            ROW.find(line)?.let { it.groupValues[1].toLong() to it.groupValues[2] }
        }.toMap()

    // Uma tela do app na frente tem o elemento [tag] com o texto [text] (nele ou dentro dele), como no CallFlowTest.
    private fun showsTagWithText(tag: String, text: String): Boolean =
        try {
            compose.onAllNodes(hasTestTag(tag) and (hasText(text) or hasAnyDescendant(hasText(text))), useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        } catch (e: IllegalStateException) {
            false   // sem nenhuma tela do Compose na frente
        }

    private fun waitForLog(before: Int, line: String) =
        emulator.waitUntil("\"$line\" no LOG do registrador", details = { "LOG: ${emulator.callLog().drop(before)}" }) {
            line in emulator.callLog().drop(before)
        }

    // A pessoa da notificação de ligação do app (o CallStyle, Android 12+), ou null.
    @Suppress("DEPRECATION")   // o getParcelable com a classe é do Android 13+
    private fun callNotificationPerson(): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
        return app.getSystemService(NotificationManager::class.java).activeNotifications
            .firstOrNull { it.notification.channelId == IncomingCallNotifier.CHANNEL_CALLS }
            ?.notification?.extras?.getParcelable<Person>(Notification.EXTRA_CALL_PERSON)?.name?.toString()
    }

    // O que o Android mostra agora (o app na frente, a janela com o foco e os textos e ids à vista), para as falhas.
    private fun systemScreen(): String {
        val focus = emulator.shell("dumpsys window").filter { "mCurrentFocus" in it }.joinToString { it.trim() }
        val texts = device.findObjects(By.text(Pattern.compile(".+"))).take(30).joinToString {
            "${it.applicationPackage}:${it.resourceName}:${it.text}"
        }
        return "Na frente: ${device.currentPackageName}; $focus\nNa tela: $texts"
    }

    private fun notifications(): String =
        app.getSystemService(NotificationManager::class.java).activeNotifications.joinToString {
            "${it.notification.channelId}/${it.notification.extras.getCharSequence(Notification.EXTRA_TITLE)}"
        }

    companion object {
        private const val WITHOUT_PERMISSION = "withoutThePermissionTheTabAsksForIt"
        private const val PACKAGE = "br.com.starsonic.phone"
        private const val CONTACT = "Maria Silva"
        private const val RAW_CONTACTS = "content://com.android.contacts/raw_contacts"
        private const val DATA = "content://com.android.contacts/data"
        private const val PHONES = "content://com.android.contacts/data/phones"
        private const val NAME_TYPE = "vnd.android.cursor.item/name"
        private const val PHONE_TYPE = "vnd.android.cursor.item/phone_v2"
        private val DENY_ID = Pattern.compile(".*:id/permission_deny(_and_dont_ask_again)?_button")
        private val DENY_TEXT =
            Pattern.compile("Não permitir|Don.t allow", Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE)
        private val ROW = Regex("""_id=(\d+), display_name=(.*)$""")
    }
}
