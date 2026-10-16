package br.com.starsonic.phone.call

import br.com.starsonic.phone.data.CallKind
import br.com.starsonic.phone.data.Recent
import br.com.starsonic.phone.data.RecentsStore
import br.com.starsonic.phone.engine.CallState
import java.io.File
import java.util.concurrent.Executor
import kotlin.concurrent.thread
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * As ligações na JVM (spec 7.3 a 7.5; as duas ligações da 0.2, spec 7.1 e 7.2), com o motor, o Telecom, as
 * notificações e o relógio falsos e os Recentes de verdade numa pasta temporária. O makeCall roda na hora (no app,
 * numa thread própria).
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
        assertEquals(CallUi(1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.RINGING), calls.state.value)
        assertTrue(gateway.rejects.isEmpty())
        assertTrue(recents.list().isEmpty())
        // O Telecom pergunta antes de criar a Connection (sem esperar o estado publicado).
        assertTrue(calls.isRinging(1))
        assertEquals(IncomingRequest(1, "3001", "Cliente Teste"), calls.ringing())
        calls.answer()
        assertFalse(calls.isRinging(1))
        assertNull(calls.ringing())
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
        assertEquals(
            CallUi(CallManager.NO_ID, "+551150603000", "", incoming = false, phase = CallPhase.DIALING),
            calls.state.value,
        )
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
        assertEquals("o aviso do núcleo para o 486 (Ocupado)", "fim 486", calls.endMessage.value)
        assertNull(calls.state.value)
        assertEquals(listOf(id to EndCause.BUSY), telecom.disconnected)
        assertEquals(listOf(Recent("486", "", CallKind.FEITA, start, 0)), recents.list())
        clock.advance(1_999)
        assertEquals("fim 486", calls.endMessage.value)
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
        assertEquals("fim 404", calls.endMessage.value)
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

    @Test
    fun `Telecom refusing the incoming call rejects it busy and notifies the missed call`() {
        ring(1)
        calls.onTelecomFailed(2)   // de outra ligação: nada
        assertTrue(gateway.rejects.isEmpty())
        calls.onTelecomFailed(1)
        assertEquals(listOf(1), gateway.rejects)
        assertTrue("o toque para", 1 in notifier.stopped)
        assertNull(calls.state.value)
        calls.onTelecomFailed(1)   // repetido: nada
        assertEquals(1, gateway.rejects.size)
        calls.onCallState(1, CallState.DISCONNECTED, 486)
        assertEquals(CallKind.PERDIDA, recents.list().single().kind)
        assertEquals("a pessoa não viu a ligação", listOf("Ligação perdida de 3001"), notifier.missed)
        assertEquals(listOf(1 to EndCause.REJECTED), telecom.disconnected)
    }

    @Test
    fun `Telecom refusing the outgoing call ends it without dialing`() {
        assertTrue(calls.dial("2002"))
        calls.onTelecomFailed(CallManager.NO_ID)
        assertNull(calls.state.value)
        assertEquals(listOf(CallManager.NO_ID to EndCause.ERROR), telecom.disconnected)
        calls.onOutgoingReady()   // atrasado
        assertTrue(gateway.made.isEmpty())
        assertEquals(CallKind.FEITA, recents.list().single().kind)
    }

    @Test
    fun `Telecom refusing the outgoing call shows the message for 2 seconds`() {
        // O Android não deixa ligar (uma ligação do celular em andamento): o aviso na tela de chamada e acima das abas.
        assertTrue(calls.dial("2002"))
        calls.onTelecomFailed(CallManager.NO_ID)
        assertEquals("Termine a ligação do celular para ligar pelo ramal.", calls.endMessage.value)
        clock.advance(1_999)
        assertEquals("Termine a ligação do celular para ligar pelo ramal.", calls.endMessage.value)
        clock.advance(1)
        assertEquals("", calls.endMessage.value)
    }

    @Test
    fun `hanging up while makeCall is on the way hangs up the call it returns`() {
        gateway.duringMakeCall = { calls.hangup() }   // o makeCall ainda não voltou: a feita não tem id
        val id = dialOut("2002")
        assertEquals(listOf(id), gateway.hangups)
        assertNull(calls.state.value)
        calls.onCallState(id, CallState.DISCONNECTED, 487)
        assertEquals(listOf(id to EndCause.LOCAL), telecom.disconnected)
        assertEquals("", calls.endMessage.value)
    }

    @Test
    fun `logout while makeCall is on the way hangs up the call it returns`() {
        gateway.duringMakeCall = { calls.onLogout() }
        val id = dialOut("2002")
        assertEquals("a ligação que ficou no motor sai", listOf(id), gateway.hangups)
        assertNull(calls.state.value)
        assertEquals(listOf(CallManager.NO_ID to EndCause.LOCAL), telecom.disconnected)
    }

    @Test
    fun `an answered outgoing call that drops shows no message`() {
        val id = dialOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        clock.advance(30_000)
        calls.onCallState(id, CallState.DISCONNECTED, 408)   // caiu depois da conversa (ex.: troca de rede)
        assertEquals("", calls.endMessage.value)
        assertEquals(id to EndCause.ERROR, telecom.disconnected.last())
        assertEquals(30, recents.list().single().durationSec)
    }

    @Test
    fun `a call ignored after logout is not taken for the outgoing call after login`() {
        calls.onLogout()
        calls.onIncoming(5, "3005", "")   // ignorada: a conta saiu
        calls.onLogin()
        gateway.duringMakeCall = { id ->
            calls.onCallState(5, CallState.DISCONNECTED, 480)   // o fim dela chega com a feita esperando o id
            calls.onCallState(id, CallState.CALLING, 0)
        }
        val id = dialOut("2002")
        assertEquals(CallPhase.DIALING, calls.state.value?.phase)
        assertEquals("", calls.endMessage.value)
        calls.onCallState(id, CallState.CONFIRMED, 200)
        assertEquals(CallPhase.ACTIVE, calls.state.value?.phase)
    }

    @Test
    fun `the id from makeCall wins over an event of another call taken before it`() {
        gateway.duringMakeCall = { calls.onCallState(7, CallState.CALLING, 0) }   // de uma ligação nunca vista
        val id = dialOut("2002")
        assertEquals(10, id)
        assertEquals("a outra sai", listOf(7), gateway.hangups)
        calls.onCallState(7, CallState.CONFIRMED, 200)   // não é dela
        assertEquals(CallPhase.DIALING, calls.state.value?.phase)
        calls.onCallState(id, CallState.CONFIRMED, 200)
        assertEquals(CallPhase.ACTIVE, calls.state.value?.phase)
        assertEquals(listOf(id), telecom.active)
    }

    @Test
    fun `an end of another call taken before makeCall returns does not leave the call in the engine`() {
        gateway.duringMakeCall = { calls.onCallState(7, CallState.DISCONNECTED, 404) }
        val id = dialOut("2002")
        assertNull(calls.state.value)
        assertEquals("a ligação do motor, sem dono, sai", listOf(id), gateway.hangups)
    }

    @Test
    fun `state collectors run without the CallManager lock`() {
        // Coletores que rodam na hora, na thread de quem publica (como os de Dispatchers.Main.immediate na
        // thread principal): se a publicação fosse com a trava presa, outra thread não conseguiria usar o
        // CallManager enquanto eles rodam.
        val heldDuring = mutableListOf<String>()
        val scope = CoroutineScope(Dispatchers.Unconfined)
        scope.launch { calls.state.collect { if (it != null && lockedOut()) heldDuring += "estado ${it.phase}" } }
        scope.launch { calls.endMessage.collect { if (it.isNotEmpty() && lockedOut()) heldDuring += "aviso $it" } }
        calls.onIncoming(1, "3001", "")
        calls.answer()
        calls.onCallState(1, CallState.CONFIRMED, 200)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        registered = false
        calls.dial("2002")
        scope.cancel()
        assertEquals(emptyList<String>(), heldDuring)
    }

    @Test
    fun `hanging up an outgoing call that took another call's event hangs up the call from makeCall`() {
        // O evento de outra ligação foi tomado pela feita, e a pessoa desligou antes de o makeCall voltar.
        gateway.duringMakeCall = {
            calls.onCallState(7, CallState.CALLING, 0)
            calls.hangup()
        }
        val id = dialOut("2002")
        assertTrue("a ligação do makeCall sai: ${gateway.hangups}", id in gateway.hangups)
        assertTrue("a outra também: ${gateway.hangups}", 7 in gateway.hangups)
        assertNull(calls.state.value)
        calls.onCallState(id, CallState.DISCONNECTED, 487)
        assertEquals(id to EndCause.LOCAL, telecom.disconnected.last())
    }

    // Duas ligações (spec da 0.2, 7.1 e 7.2): até duas, uma ativa; a outra toca, chama ou fica em espera.

    @Test
    fun `a second incoming call rings while one is active`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        ring(2, "3002", "Fulano")
        assertEquals(listOf(Triple(1, "3001", "Cliente Teste"), Triple(2, "3002", "Fulano")), telecom.incoming)
        assertTrue("a segunda toca, sem ocupado", gateway.rejects.isEmpty())
        val first = CallUi(1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start)
        assertEquals(first.copy(second = SecondUi(2, "3002", "Fulano", SecondKind.RINGING)), calls.state.value)
        assertTrue(calls.isRinging(2))
        assertEquals(IncomingRequest(2, "3002", "Fulano"), calls.ringing())
        assertTrue("a primeira fica com o som até atender", telecom.held.isEmpty() && gateway.activated.isEmpty())
        // Recusar: ocupado na segunda, perdida sem a notificação, e a primeira segue.
        calls.reject()
        assertEquals(listOf(2), gateway.rejects)
        assertTrue("o toque da segunda para", 2 in notifier.stopped)
        assertEquals("a faixa sai na hora", first, calls.state.value)
        calls.onCallState(2, CallState.DISCONNECTED, 486)
        assertEquals(listOf(2 to EndCause.REJECTED), telecom.disconnected)
        assertTrue(notifier.missed.isEmpty())
        assertEquals(first, calls.state.value)
        // Com a primeira em espera, outra também toca; quem ligou desiste: perdida, com a notificação.
        calls.hold(true)
        assertEquals(listOf(1), telecom.held)
        clock.advance(1_000)
        ring(3, "3003", "")
        assertEquals(first.copy(held = true, second = SecondUi(3, "3003", "", SecondKind.RINGING)), calls.state.value)
        calls.onCallState(3, CallState.DISCONNECTED, 487)
        assertEquals(listOf("Ligação perdida de 3003"), notifier.missed)
        assertEquals(listOf(2 to EndCause.REJECTED, 3 to EndCause.MISSED), telecom.disconnected)
        assertEquals(first.copy(held = true), calls.state.value)
        assertTrue("a em espera não volta sozinha", gateway.activated.isEmpty())
        assertEquals(
            listOf(
                Recent("3003", "", CallKind.PERDIDA, start + 11_000, 0),
                Recent("3002", "Fulano", CallKind.PERDIDA, start + 10_000, 0),
            ),
            recents.list(),
        )
    }

    @Test
    fun `answering the second call holds the first`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        ring(2, "3002", "Fulano")
        clock.advance(2_000)
        calls.answer()
        assertEquals(listOf(1, 2), gateway.answers)
        assertTrue("o toque da segunda para", 2 in notifier.stopped)
        assertEquals("o Telecom põe a primeira em espera", listOf(1), telecom.held)
        assertTrue("o motor põe a primeira em espera no answer", gateway.holds.isEmpty() && gateway.activated.isEmpty())
        val held = SecondUi(1, "3001", "Cliente Teste", SecondKind.HELD)
        assertEquals(
            CallUi(2, "3002", "Fulano", incoming = true, phase = CallPhase.CONNECTING, second = held),
            calls.state.value,
        )
        assertFalse(calls.isRinging(2))
        assertNull(calls.ringing())
        calls.onCallState(2, CallState.CONNECTING, 200)
        calls.onCallState(2, CallState.CONFIRMED, 200)
        assertEquals(listOf(1, 2), telecom.active)
        assertEquals(
            CallUi(
                2, "3002", "Fulano", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start + 12_000,
                second = held,
            ),
            calls.state.value,
        )
        // As duas acabam do outro lado, cada uma com a sua duração.
        clock.advance(30_000)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        clock.advance(5_000)
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        assertNull(calls.state.value)
        assertEquals(listOf(1 to EndCause.REMOTE, 2 to EndCause.REMOTE), telecom.disconnected)
        assertEquals(
            listOf(
                Recent("3002", "Fulano", CallKind.RECEBIDA, start + 10_000, 35),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 42),
            ),
            recents.list(),
        )
    }

    @Test
    fun `a second incoming call while dialing is rejected busy`() {
        val id = dialOut("2002")
        calls.onCallState(id, CallState.CALLING, 0)
        calls.onIncoming(id + 1, "3002", "")
        assertEquals(listOf(id + 1), gateway.rejects)
        assertTrue("não vai ao Telecom", telecom.incoming.isEmpty())
        assertEquals(listOf(Recent("3002", "", CallKind.PERDIDA, clock.nowMillis(), 0)), recents.list())
        assertEquals(listOf("Ligação perdida de 3002"), notifier.missed)
        assertEquals(CallUi(id, "2002", "", incoming = false, phase = CallPhase.DIALING), calls.state.value)
        calls.onCallState(id + 1, CallState.DISCONNECTED, 486)   // o fim da recusada não mexe na feita
        assertEquals(CallPhase.DIALING, calls.state.value?.phase)
        calls.onCallState(id, CallState.CONFIRMED, 200)
        assertEquals(
            CallUi(id, "2002", "", incoming = false, phase = CallPhase.ACTIVE, activeSinceMillis = clock.nowMillis()),
            calls.state.value,
        )
        assertEquals(listOf(id), telecom.active)
        assertTrue(telecom.held.isEmpty() && telecom.disconnected.isEmpty())
        assertEquals(1, recents.list().size)
    }

    @Test
    fun `a second incoming call not permitted by Telecom is rejected busy`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        telecom.permitted = false   // uma ligação da operadora tocando
        calls.onIncoming(2, "3002", "Fulano")
        assertEquals(listOf(2), gateway.rejects)
        assertEquals("só a primeira vai ao Telecom", 1, telecom.incoming.size)
        assertEquals(listOf(Recent("3002", "Fulano", CallKind.PERDIDA, start, 0)), recents.list())
        assertEquals(listOf("Ligação perdida de 3002"), notifier.missed)
        assertEquals(
            CallUi(1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start),
            calls.state.value,
        )
        assertTrue(telecom.held.isEmpty() && gateway.activated.isEmpty())
    }

    @Test
    fun `a third incoming call is rejected busy`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        ring(2, "3002", "Fulano")
        answerCall(2)
        clock.advance(1_000)
        calls.onIncoming(3, "3003", "")
        assertEquals(listOf(3), gateway.rejects)
        assertEquals("só as duas primeiras vão ao Telecom", listOf(1, 2), telecom.incoming.map { it.first })
        assertEquals(listOf(Recent("3003", "", CallKind.PERDIDA, start + 1_000, 0)), recents.list())
        assertEquals(listOf("Ligação perdida de 3003"), notifier.missed)
        val both = CallUi(
            2, "3002", "Fulano", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start,
            second = SecondUi(1, "3001", "Cliente Teste", SecondKind.HELD),
        )
        assertEquals(both, calls.state.value)
        calls.onCallState(3, CallState.DISCONNECTED, 486)   // o fim da recusada não mexe nas duas
        assertEquals(both, calls.state.value)
        assertTrue(telecom.disconnected.isEmpty())
        assertEquals(1, recents.list().size)
    }

    @Test
    fun `Alternar swaps the active call`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        ring(2, "3002", "")
        calls.activate()   // a segunda ainda toca: nada
        assertTrue(gateway.activated.isEmpty())
        answerCall(2)
        calls.activate()
        assertEquals(listOf(1), gateway.activated)
        assertEquals(listOf(1, 2), telecom.held)
        assertEquals(listOf(1, 2, 1), telecom.active)
        val first = CallUi(
            1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start,
            second = SecondUi(2, "3002", "", SecondKind.HELD),
        )
        assertEquals(first, calls.state.value)
        calls.activate()
        assertEquals(listOf(1, 2), gateway.activated)
        assertEquals(listOf(1, 2, 1), telecom.held)
        assertEquals(listOf(1, 2, 1, 2), telecom.active)
        assertEquals(
            CallUi(
                2, "3002", "", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000,
                second = SecondUi(1, "3001", "Cliente Teste", SecondKind.HELD),
            ),
            calls.state.value,
        )
        // Com duas, a Espera da ativa é o Alternar (o motor troca as duas; nada de setHold).
        calls.hold()
        assertEquals(listOf(1, 2, 1), gateway.activated)
        assertTrue(gateway.holds.isEmpty())
        assertEquals(first, calls.state.value)
        // Os pedidos do Telecom: a espera da ativa troca, a da que já está em espera não muda nada, e a retomada da
        // em espera troca.
        calls.holdFromTelecom(1)
        assertEquals(2, calls.state.value?.id)
        calls.holdFromTelecom(1)
        assertEquals(listOf(1, 2, 1, 2), gateway.activated)
        calls.activateFromTelecom(1)
        assertEquals(listOf(1, 2, 1, 2, 1), gateway.activated)
        assertEquals(first, calls.state.value)
        // A em espera (sem nome) cai, e a ativa acaba depois: cada uma com a sua duração.
        clock.advance(20_000)
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        assertEquals("3002 desligou", calls.endMessage.value)
        clock.advance(10_000)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertNull(calls.state.value)
        assertEquals(
            listOf(
                Recent("3002", "", CallKind.RECEBIDA, start + 10_000, 20),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 40),
            ),
            recents.list(),
        )
    }

    @Test
    fun `hanging up the active call resumes the held one`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        ring(2, "3002", "Fulano")
        answerCall(2)
        clock.advance(20_000)
        calls.hangup()
        assertEquals("desliga a ativa", listOf(2), gateway.hangups)
        assertTrue("a outra volta quando o fim chega", gateway.activated.isEmpty())
        val first = CallUi(1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start)
        assertEquals("até lá, a tela mostra a em espera", first.copy(held = true), calls.state.value)
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        assertEquals(listOf(1), gateway.activated)
        assertEquals(listOf(1, 2, 1), telecom.active)
        assertEquals(listOf(1), telecom.held)
        assertEquals(listOf(2 to EndCause.LOCAL), telecom.disconnected)
        assertEquals("a outra voltou sozinha", first, calls.state.value)
        assertEquals("", calls.endMessage.value)
        clock.advance(5_000)
        calls.hangup()
        assertEquals(listOf(2, 1), gateway.hangups)
        assertNull(calls.state.value)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertEquals(listOf(2 to EndCause.LOCAL, 1 to EndCause.LOCAL), telecom.disconnected)
        assertEquals("nada mais volta", listOf(1), gateway.activated)
        assertEquals(
            listOf(
                Recent("3002", "Fulano", CallKind.RECEBIDA, start + 10_000, 20),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 35),
            ),
            recents.list(),
        )
    }

    @Test
    fun `the held call dropping shows the message and keeps the active one`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        ring(2, "3002", "")
        answerCall(2)
        clock.advance(20_000)
        calls.onCallState(1, CallState.DISCONNECTED, 200)   // a em espera desligou do outro lado
        assertEquals("o nome que a central mandou", "Cliente Teste desligou", calls.endMessage.value)
        assertEquals(
            CallUi(2, "3002", "", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000),
            calls.state.value,
        )
        assertEquals(listOf(1 to EndCause.REMOTE), telecom.disconnected)
        assertTrue("a ativa continua como estava", gateway.activated.isEmpty() && gateway.hangups.isEmpty())
        assertEquals(listOf(1, 2), telecom.active)
        clock.advance(1_999)
        assertEquals("Cliente Teste desligou", calls.endMessage.value)
        clock.advance(1)
        assertEquals("", calls.endMessage.value)
        clock.advance(13_000)
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        assertNull(calls.state.value)
        assertEquals("", calls.endMessage.value)
        assertEquals(
            listOf(
                Recent("3002", "", CallKind.RECEBIDA, start + 10_000, 35),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 30),
            ),
            recents.list(),
        )
    }

    @Test
    fun `dialing during an active call holds it and places the second`() {
        val start = clock.nowMillis()
        ring(1)
        assertFalse("com uma ligação que ainda toca, não", calls.dial("2002"))
        answerCall(1)
        clock.advance(10_000)
        assertTrue(calls.dial("2002"))
        assertEquals(listOf(1), telecom.held)
        assertEquals(listOf("2002"), telecom.placed)
        assertTrue("o motor põe a primeira em espera no makeCall", gateway.holds.isEmpty() && gateway.made.isEmpty())
        val held = SecondUi(1, "3001", "Cliente Teste", SecondKind.HELD)
        assertEquals(
            CallUi(CallManager.NO_ID, "2002", "", incoming = false, phase = CallPhase.DIALING, second = held),
            calls.state.value,
        )
        assertFalse("com duas, nenhuma outra", calls.dial("2003"))
        assertTrue(calls.isDialing())
        calls.onOutgoingReady()
        val id = gateway.nextCallId - 1
        assertEquals(listOf("2002"), gateway.made)
        calls.onCallState(id, CallState.CALLING, 0)
        assertEquals(id, calls.state.value?.id)
        calls.onCallState(id, CallState.CONFIRMED, 200)
        assertEquals(listOf(1, id), telecom.active)
        assertEquals(
            CallUi(
                id, "2002", "", incoming = false, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000,
                second = held,
            ),
            calls.state.value,
        )
        // O outro lado da feita desliga: a primeira volta sozinha.
        clock.advance(20_000)
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        assertEquals(listOf(1), gateway.activated)
        assertEquals(listOf(1, id, 1), telecom.active)
        assertEquals(listOf(id to EndCause.REMOTE), telecom.disconnected)
        assertEquals(
            CallUi(1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start),
            calls.state.value,
        )
        assertEquals("", calls.endMessage.value)
        clock.advance(5_000)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertNull(calls.state.value)
        assertEquals(
            listOf(
                Recent("2002", "", CallKind.FEITA, start + 10_000, 20),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 35),
            ),
            recents.list(),
        )
    }

    @Test
    fun `disconnecting the held call from Telecom ends only that call`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        ring(2, "3002", "Fulano")
        answerCall(2)
        clock.advance(20_000)
        calls.hangup(1)   // o Telecom desligou a Connection da em espera (onDisconnect)
        assertEquals(listOf(1), gateway.hangups)
        val second = CallUi(
            2, "3002", "Fulano", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000,
        )
        assertEquals("o cartão da em espera sai na hora", second, calls.state.value)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertEquals(listOf(1 to EndCause.LOCAL), telecom.disconnected)
        assertEquals("desligada aqui: sem aviso", "", calls.endMessage.value)
        assertTrue("a ativa continua como estava", gateway.activated.isEmpty())
        assertEquals(listOf(1, 2), telecom.active)
        assertEquals(second, calls.state.value)
        clock.advance(5_000)
        calls.hangup(2)
        assertEquals(listOf(1, 2), gateway.hangups)
        assertNull(calls.state.value)
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        assertEquals(listOf(1 to EndCause.LOCAL, 2 to EndCause.LOCAL), telecom.disconnected)
        assertEquals(
            listOf(
                Recent("3002", "Fulano", CallKind.RECEBIDA, start + 10_000, 25),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 30),
            ),
            recents.list(),
        )
    }

    @Test
    fun `logout with two calls hangs up both`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        ring(2, "3002", "Fulano")
        answerCall(2)
        clock.advance(20_000)
        calls.onLogout()
        assertEquals(listOf(1, 2), gateway.hangups)
        assertEquals(listOf(1 to EndCause.LOCAL, 2 to EndCause.LOCAL), telecom.disconnected)
        assertTrue("nenhuma volta", gateway.activated.isEmpty())
        assertNull(calls.state.value)
        assertEquals("", calls.endMessage.value)
        calls.onCallState(2, CallState.DISCONNECTED, 200)   // os fins que chegam depois são ignorados
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertEquals(2, telecom.disconnected.size)
        assertTrue(notifier.missed.isEmpty())
        assertEquals(
            listOf(
                Recent("3002", "Fulano", CallKind.RECEBIDA, start + 10_000, 20),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 30),
            ),
            recents.list(),
        )
    }

    // Outra thread tenta usar o CallManager por até 1 s: true se não conseguiu (a trava estava presa).
    private fun lockedOut(): Boolean {
        val other = thread { calls.isRinging(1) }
        other.join(1_000)
        return other.isAlive
    }
}
