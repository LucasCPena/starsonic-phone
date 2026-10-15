package br.com.starsonic.phone.call

import br.com.starsonic.phone.data.CallKind
import br.com.starsonic.phone.data.Recent
import br.com.starsonic.phone.data.RecentsStore
import br.com.starsonic.phone.engine.CallState
import java.io.File
import java.util.concurrent.Executor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * As ligações na JVM (spec 7.3 a 7.5), com o motor, o Telecom, as notificações e o relógio falsos e os
 * Recentes de verdade numa pasta temporária. O makeCall roda na hora (no app, numa thread própria).
 */
class CallManagerTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val gateway = CallGateway()
    private val telecom = FakeTelecom()
    private val notifier = FakeNotifier()
    private val clock = CallClock()
    private var registered = true
    private val recents by lazy { RecentsStore(File(folder.root, "recentes.json")) }
    private val calls by lazy {
        CallManager(gateway, telecom, recents, notifier, CallCore(), clock, { registered }, Executor { it.run() })
    }

    // Uma ligação chega e toca (o motor responde 180 sozinho).
    private fun ring(id: Int = 1, number: String = "3001", name: String = "Cliente Teste") {
        calls.onIncoming(id, number, name)
        calls.onCallState(id, CallState.EARLY, 180)
    }

    // A pessoa atende, e o motor confirma.
    private fun answerCall(id: Int = 1) {
        calls.answer()
        calls.onCallState(id, CallState.CONNECTING, 200)
        calls.onCallState(id, CallState.CONFIRMED, 200)
    }

    // Uma ligação feita: o Telecom cria a Connection e o motor liga (o id da ligação no motor).
    private fun dialOut(raw: String): Int {
        assertTrue(calls.dial(raw))
        calls.onOutgoingReady()
        return gateway.nextCallId - 1
    }

    @Test
    fun `incoming call while idle goes to Telecom`() {
        calls.onIncoming(1, "3001", "Cliente Teste")
        assertEquals(listOf(Triple(1, "3001", "Cliente Teste")), telecom.incoming)
        assertEquals(CallUi("3001", "Cliente Teste", incoming = true, phase = CallPhase.RINGING), calls.state.value)
        assertTrue(gateway.rejects.isEmpty())
        assertTrue(recents.list().isEmpty())
        // O Telecom pergunta antes de criar a Connection.
        assertTrue(calls.isRinging(1))
        assertEquals(1, calls.ringingId())
        calls.answer()
        assertFalse(calls.isRinging(1))
        assertEquals(CallManager.NO_ID, calls.ringingId())
    }

    @Test
    fun `incoming call during another call is rejected busy and missed`() {
        ring(1)
        answerCall(1)
        calls.onIncoming(2, "3002", "")
        assertEquals(listOf(2), gateway.rejects)
        assertEquals("só a primeira vai ao Telecom", 1, telecom.incoming.size)
        assertEquals(Recent("3002", "", CallKind.PERDIDA, clock.nowMillis(), 0), recents.list().single())
        assertEquals(listOf("Ligação perdida de 3002"), notifier.missed)
        assertEquals("a primeira segue", CallPhase.ACTIVE, calls.state.value?.phase)
        calls.onCallState(2, CallState.DISCONNECTED, 486)   // o fim da recusada não mexe na primeira
        assertEquals(CallPhase.ACTIVE, calls.state.value?.phase)
        assertEquals(1, recents.list().size)
    }

    @Test
    fun `incoming call not permitted by Telecom is rejected busy`() {
        telecom.permitted = false   // uma ligação da operadora em andamento
        val start = clock.nowMillis()
        calls.onIncoming(1, "3001", "Cliente Teste")
        assertEquals(listOf(1), gateway.rejects)
        assertTrue(telecom.incoming.isEmpty())
        assertNull(calls.state.value)
        calls.onCallState(1, CallState.DISCONNECTED, 486)
        assertEquals(listOf(Recent("3001", "Cliente Teste", CallKind.PERDIDA, start, 0)), recents.list())
        assertEquals(listOf("Ligação perdida de 3001"), notifier.missed)
    }

    @Test
    fun `a call the engine refused as busy is missed`() {
        calls.onRejectedBusy("3003", "Fulano")
        assertEquals(listOf(Recent("3003", "Fulano", CallKind.PERDIDA, clock.nowMillis(), 0)), recents.list())
        assertEquals(listOf("Ligação perdida de 3003"), notifier.missed)
    }

    @Test
    fun `caller giving up before answer is a missed call`() {
        val start = clock.nowMillis()
        ring(1)
        clock.advance(5_000)
        calls.onCallState(1, CallState.DISCONNECTED, 487)
        assertEquals(listOf("Ligação perdida de 3001"), notifier.missed)
        assertEquals(listOf(Recent("3001", "Cliente Teste", CallKind.PERDIDA, start, 0)), recents.list())
        assertEquals(listOf(1 to EndCause.MISSED), telecom.disconnected)
        assertTrue("o toque para", 1 in notifier.stopped)
        assertNull(calls.state.value)
        assertEquals("o CallEndMessage é só das feitas", "", calls.endMessage.value)
    }

    @Test
    fun `answered incoming call is received with its duration`() {
        val start = clock.nowMillis()
        ring(1)
        clock.advance(3_000)
        calls.answer()
        assertEquals(listOf(1), gateway.answers)
        assertTrue("o toque para ao atender", 1 in notifier.stopped)
        assertEquals(CallPhase.CONNECTING, calls.state.value?.phase)
        calls.onCallState(1, CallState.CONNECTING, 200)
        calls.onCallState(1, CallState.CONFIRMED, 200)
        assertEquals(listOf(1), telecom.active)
        assertEquals(CallPhase.ACTIVE, calls.state.value?.phase)
        assertEquals(clock.nowMillis(), calls.state.value?.activeSinceMillis)
        clock.advance(42_000)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertEquals(listOf(Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 42)), recents.list())
        assertEquals(listOf(1 to EndCause.REMOTE), telecom.disconnected)
        assertTrue(notifier.missed.isEmpty())
        assertNull(calls.state.value)
    }

    @Test
    fun `Recusar records a missed call without the notification`() {
        ring(1)
        calls.reject()
        assertEquals(listOf(1), gateway.rejects)
        assertTrue("o toque para ao recusar", 1 in notifier.stopped)
        assertNull("a tela sai na hora", calls.state.value)
        calls.onCallState(1, CallState.DISCONNECTED, 486)
        assertEquals(CallKind.PERDIDA, recents.list().single().kind)
        assertTrue(notifier.missed.isEmpty())
        assertEquals(listOf(1 to EndCause.REJECTED), telecom.disconnected)
        assertEquals("o 486 é a resposta daqui", "", calls.endMessage.value)
    }

    @Test
    fun `dial without registration shows the message`() {
        registered = false
        assertFalse(calls.dial("2002"))
        assertEquals("Sem conexão com o servidor. Tente de novo em instantes.", calls.endMessage.value)
        assertTrue(telecom.placed.isEmpty())
        assertTrue(gateway.made.isEmpty())
        assertNull(calls.state.value)
    }

    @Test
    fun `dial normalizes the number`() {
        assertTrue(calls.dial("+55 (11) 5060-3000"))
        assertEquals(listOf("+551150603000"), telecom.placed)
        assertEquals(CallUi("+551150603000", "", incoming = false, phase = CallPhase.DIALING), calls.state.value)
        assertTrue("o motor liga quando o Telecom cria a Connection", gateway.made.isEmpty())
        calls.onOutgoingReady()
        assertEquals(listOf("+551150603000"), gateway.made)
        calls.onOutgoingReady()   // um aviso repetido não liga de novo
        assertEquals(1, gateway.made.size)
    }

    @Test
    fun `busy outgoing call shows Ocupado for 2 seconds`() {
        val start = clock.nowMillis()
        val id = dialOut("486")
        calls.onCallState(id, CallState.CALLING, 0)
        calls.onCallState(id, CallState.DISCONNECTED, 486)
        assertEquals("Ocupado", calls.endMessage.value)
        assertNull(calls.state.value)
        assertEquals(listOf(id to EndCause.BUSY), telecom.disconnected)
        assertEquals(listOf(Recent("486", "", CallKind.FEITA, start, 0)), recents.list())
        clock.advance(1_999)
        assertEquals("Ocupado", calls.endMessage.value)
        clock.advance(1)
        assertEquals("", calls.endMessage.value)
    }

    @Test
    fun `events before makeCall returns belong to the outgoing call`() {
        // O motor avisa o CALLING (e até o fim) antes de o makeCall voltar a quem ligou.
        gateway.duringMakeCall = { id -> calls.onCallState(id, CallState.CALLING, 0) }
        val id = dialOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        assertEquals(CallPhase.ACTIVE, calls.state.value?.phase)
        assertEquals(listOf(id), telecom.active)
        gateway.duringMakeCall = null
        calls.hangup()
        assertEquals(listOf(id), gateway.hangups)
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        assertEquals(listOf(id to EndCause.LOCAL), telecom.disconnected)

        gateway.duringMakeCall = { next ->
            calls.onCallState(next, CallState.CALLING, 0)
            calls.onCallState(next, CallState.DISCONNECTED, 404)
        }
        val next = dialOut("9999")
        assertEquals("Número não encontrado", calls.endMessage.value)
        assertNull(calls.state.value)
        assertEquals(next to EndCause.ERROR, telecom.disconnected.last())
        assertTrue("uma ligação nova depois", calls.dial("2002"))
    }

    @Test
    fun `a late event of another call is not taken for the outgoing call`() {
        assertTrue(calls.dial("2002"))
        calls.onIncoming(1, "3001", "")   // chegou enquanto o Telecom prepara a feita: ocupado
        assertEquals(listOf(1), gateway.rejects)
        gateway.duringMakeCall = { id ->
            calls.onCallState(1, CallState.DISCONNECTED, 486)   // o fim da recusada não é da feita
            calls.onCallState(id, CallState.CALLING, 0)
        }
        calls.onOutgoingReady()
        val id = gateway.nextCallId - 1
        assertEquals(CallPhase.DIALING, calls.state.value?.phase)
        assertEquals("", calls.endMessage.value)
        calls.onCallState(1, CallState.CONFIRMED, 200)   // de outra ligação: nada
        assertEquals(CallPhase.DIALING, calls.state.value?.phase)
        calls.onCallState(id, CallState.CONFIRMED, 200)
        assertEquals(CallPhase.ACTIVE, calls.state.value?.phase)
        assertEquals(listOf(id), telecom.active)
    }

    @Test
    fun `a new call waits for the end of the rejected one`() {
        calls.onIncoming(1, "3001", "")
        calls.reject()
        assertFalse("a recusada ainda não acabou no motor", calls.dial("2002"))
        calls.onCallState(1, CallState.DISCONNECTED, 486)
        assertTrue(calls.dial("2002"))
    }

    @Test
    fun `failed makeCall ends the outgoing call`() {
        gateway.refuse = true
        dialOut("2002")
        assertNull(calls.state.value)
        assertEquals(listOf(CallManager.NO_ID to EndCause.ERROR), telecom.disconnected)
        assertEquals(CallKind.FEITA, recents.list().single().kind)
    }

    @Test
    fun `hanging up before Telecom places the call dials nothing`() {
        assertTrue(calls.dial("2002"))
        calls.hangup()
        assertNull(calls.state.value)
        assertEquals(listOf(CallManager.NO_ID to EndCause.LOCAL), telecom.disconnected)
        calls.onOutgoingReady()   // o Telecom chegou atrasado
        assertTrue(gateway.made.isEmpty())
    }

    @Test
    fun `hold, mute, keypad and transfer act on the active call`() {
        val id = dialOut("2002")
        calls.hold()   // ainda chamando: nada
        calls.transfer("2003")
        assertTrue(gateway.holds.isEmpty())
        assertTrue(gateway.transfers.isEmpty())
        calls.onCallState(id, CallState.CONFIRMED, 200)
        calls.hold()
        assertEquals(listOf(id to true), gateway.holds)
        assertTrue(calls.state.value!!.held)
        calls.hold()
        assertEquals(listOf(id to true, id to false), gateway.holds)
        calls.mute()
        assertEquals(listOf(true), gateway.mutes)
        assertTrue(calls.state.value!!.muted)
        calls.dtmf("5")
        assertEquals(listOf(id to "5"), gateway.dtmfs)
        assertTrue(calls.transfer(" 20-03 "))
        assertEquals(listOf(id to "2003"), gateway.transfers)
        calls.onCallState(id, CallState.DISCONNECTED, 200)   // o PABX aceitou a transferência e o motor desligou
        assertEquals("o mudo sai no fim da ligação", listOf(true, false), gateway.mutes)
        assertEquals(CallKind.FEITA, recents.list().single().kind)
    }

    @Test
    fun `CallManager ignores engine events after logout`() {
        ring(1)
        calls.onLogout()
        assertNull(calls.state.value)
        assertEquals("a que tocava sai", listOf(1), gateway.hangups)
        assertTrue(1 in notifier.stopped)
        assertEquals(listOf(1 to EndCause.LOCAL), telecom.disconnected)
        val saved = recents.list()
        calls.onIncoming(2, "3002", "")
        calls.onCallState(1, CallState.CONFIRMED, 200)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        calls.onRejectedBusy("3003", "")
        assertEquals(1, telecom.incoming.size)
        assertTrue(gateway.rejects.isEmpty())
        assertTrue(telecom.active.isEmpty())
        assertEquals(1, telecom.disconnected.size)
        assertNull(calls.state.value)
        assertTrue(notifier.missed.isEmpty())
        assertEquals(saved, recents.list())
        assertFalse(calls.dial("2002"))
        calls.onLogin()   // o próximo Entrar
        calls.onIncoming(4, "3004", "")
        assertEquals(Triple(4, "3004", ""), telecom.incoming.last())
    }
}
