package br.com.starsonic.phone.contacts

import br.com.starsonic.phone.call.CallClock
import br.com.starsonic.phone.call.CallCore
import br.com.starsonic.phone.call.CallGateway
import br.com.starsonic.phone.call.CallManager
import br.com.starsonic.phone.call.FakeNotifier
import br.com.starsonic.phone.call.FakeTelecom
import br.com.starsonic.phone.data.RecentsStore
import br.com.starsonic.phone.engine.CallState
import java.io.File
import java.util.concurrent.Executor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Os contatos do celular na JVM (spec da 0.2, 4.2 e 7.5): a busca da aba Contatos e das sugestões ([searchContacts],
 * pela agenda falsa) e o CallManager com a agenda falsa (o nome do contato na ligação e a regra dos números dos
 * contatos).
 */
class ContactsTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val gateway = CallGateway()
    private val telecom = FakeTelecom()
    private val contacts = FakeContactsSource()

    // A regra de teste dos números dos contatos: o exemplo do brief (com o prefixo externo 0), "+55" sozinho não dá
    // número, e o resto fica como veio.
    private val dialRule: (String) -> String = { raw ->
        when (raw) {
            "+55 (11) 5060-3000" -> "01150603000"
            "+55" -> ""
            else -> raw
        }
    }

    private val calls by lazy {
        CallManager(
            gateway, telecom, RecentsStore(File(folder.root, "recentes.json")), FakeNotifier(), CallCore(), CallClock(),
            { true }, contacts, dialRule, Executor { it.run() },
        )
    }

    // Uma ligação chega e toca (o motor responde 180 sozinho).
    private fun ring(id: Int = 1, number: String = "3001", name: String = "Cliente Teste") {
        calls.onIncoming(id, number, name)
        calls.onCallState(id, CallState.EARLY, 180)
    }

    @Test
    fun `search filters by name and number`() {
        val maria = Contact("Maria Silva", listOf("3001", "+55 (11) 98765-4321"))
        val joao = Contact("João Souza", listOf("(11) 5060-3000"))
        val ana = Contact("Ana Lúcia", listOf("2003"))
        val source = FakeContactsSource(maria, joao, ana)
        assertEquals("todos, em ordem alfabética", listOf(ana, joao, maria), source.search(""))
        assertEquals("só espaços: todos", listOf(ana, joao, maria), source.search("  "))
        assertEquals("pelo nome", listOf(maria), source.search("Mar"))
        assertEquals("sem maiúsculas e sem acento", listOf(joao), source.search("JOAO"))
        assertEquals("com acento na busca", listOf(ana), source.search("lúc"))
        assertEquals("pelos dígitos do número", listOf(joao, maria), source.search("300"))
        assertEquals("com os separadores do número", listOf(joao), source.search("5060-3"))
        assertEquals("nenhum", emptyList<Contact>(), source.search("Zé"))
    }

    @Test
    fun `the avatar shows the initials of the first and last names`() {
        assertEquals("AS", initials("Ana Souza"))
        assertEquals("o primeiro e o último nome", "ML", initials("  Maria da Silva Lima "))
        assertEquals("um nome só: as duas primeiras letras", "FI", initials("Financeiro"))
        assertEquals("com o acento, em maiúsculas", "ÁS", initials("ágata souza"))
    }

    @Test
    fun `the group letter ignores accents and puts the rest under #`() {
        assertEquals("A", groupLetter("Ágata Souza"))
        assertEquals("C", groupLetter("carlos Lima"))
        assertEquals("#", groupLetter("2003 Portaria"))
        assertEquals("#", groupLetter("+55 Recepção"))
    }

    @Test
    fun `a contact without numbers is not listed`() {
        val source = FakeContactsSource(Contact("Bruno", emptyList()), Contact("Maria Silva", listOf("3001")))
        assertEquals(listOf("Maria Silva"), source.search("").map { it.name })
        assertEquals(emptyList<Contact>(), source.search("Bru"))
    }

    @Test
    fun `lookup prefers the phone contact over the server name`() {
        contacts.contacts += Contact("Maria Silva", listOf("3001"))
        ring(number = "3001", name = "Cliente Teste")
        assertEquals("Maria Silva", calls.state.value?.name)
        assertEquals("o número continua o da ligação", "3001", calls.state.value?.number)
        assertEquals("a notificação de ligação recebe o nome resolvido", "Maria Silva", telecom.incoming.single().third)
    }

    @Test
    fun `the dial rule is applied to contact numbers`() {
        assertTrue(calls.dialContact("+55 (11) 5060-3000"))
        calls.onOutgoingReady()
        assertEquals(listOf("01150603000"), telecom.placed)
        assertEquals(listOf("01150603000"), gateway.made)
        assertEquals("01150603000", calls.state.value?.number)
        calls.hangup()
        calls.onCallState(gateway.nextCallId - 1, CallState.DISCONNECTED, 487)
        // A regra que não dá número: nada é discado.
        assertFalse(calls.dialContact("+55"))
        assertEquals(listOf("01150603000"), telecom.placed)
    }
}
