package br.com.starsonic.phone.call

import br.com.starsonic.phone.contacts.Contact
import br.com.starsonic.phone.contacts.FakeContactsSource
import br.com.starsonic.phone.data.CallKind
import br.com.starsonic.phone.data.CallSettings
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
 * As ligações na JVM (spec 7.3 a 7.5; as duas ligações, a consulta e a conferência da 0.2, spec 7.1 a 7.4; o Não
 * perturbe, o Atender automático e o bipe no fim da rc.2, spec 4, 5 e 9), com o motor, o Telecom, as notificações, o
 * relógio e o bipe falsos e os Recentes de verdade numa pasta temporária. O makeCall roda na hora (no app, numa thread
 * própria), e o Telecom falso cria a Connection de cada recebida na hora em que a recebe (o celular toca), avisando o
 * CallManager como o CallConnectionService. As configurações de ligação são as de fábrica ([settings]), lidas a cada
 * uso; o bipe acaba na hora ([NoBeep]), a não ser nos testes do bipe, que usam o [beep] falso.
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
    private val contacts = FakeContactsSource()
    private var settings = CallSettings()
    private val beep = FakeBeep()
    private var endBeep: EndBeep = NoBeep
    private var microphone = CallMicrophone { ready -> ready(true) }
    private var microphoneRequests = 0
    private val calls by lazy {
        CallManager(
            gateway, telecom, recents, notifier, CallCore(), clock, { registered }, contacts, { raw -> raw },
            Executor { it.run() }, settings = { settings }, beep = { done -> endBeep.play(done) },
            microphone = { ready ->
                microphoneRequests++
                microphone.request(ready)
            },
        )
    }

    init {
        telecom.onIncomingCreated = { callId -> calls.onIncomingReady(callId) }
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

    // O Consultar para [raw] (com o cliente em andamento): o Telecom cria a Connection do colega e o motor liga (o id
    // do colega no motor).
    private fun consultOut(raw: String): Int {
        assertTrue(calls.consult(raw))
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
        val held = SecondUi(1, "3001", "Cliente Teste", SecondKind.HELD, activeSinceMillis = start)
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
    fun `the other of two calls shows since when it was answered`() {
        // O cartão da outra mostra o tempo dela (o quadro DuasLigacoes: "<número> · 00:48"): desde quando foi atendida.
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        ring(2, "3002", "Fulano")
        assertEquals("tocando, ainda sem tempo", 0L, calls.state.value?.second?.activeSinceMillis)
        clock.advance(2_000)
        answerCall(2)
        assertEquals("a primeira, em espera", start, calls.state.value?.second?.activeSinceMillis)
        assertEquals(start + 12_000, calls.state.value?.activeSinceMillis)
        calls.activate()
        assertEquals("a segunda, em espera depois do Alternar", start + 12_000, calls.state.value?.second?.activeSinceMillis)
        assertEquals(start, calls.state.value?.activeSinceMillis)
        // A feita da Nova ligação ainda chama: sem tempo, até atender.
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        val id = dialOut("2002")
        assertEquals(id, calls.state.value?.id)
        assertEquals(CallPhase.DIALING, calls.state.value?.phase)
        assertEquals("a primeira continua com o tempo dela", start, calls.state.value?.second?.activeSinceMillis)
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
            second = SecondUi(1, "3001", "Cliente Teste", SecondKind.HELD, activeSinceMillis = start),
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
            second = SecondUi(2, "3002", "", SecondKind.HELD, activeSinceMillis = start + 10_000),
        )
        assertEquals(first, calls.state.value)
        calls.activate()
        assertEquals(listOf(1, 2), gateway.activated)
        assertEquals(listOf(1, 2, 1), telecom.held)
        assertEquals(listOf(1, 2, 1, 2), telecom.active)
        assertEquals(
            CallUi(
                2, "3002", "", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000,
                second = SecondUi(1, "3001", "Cliente Teste", SecondKind.HELD, activeSinceMillis = start),
            ),
            calls.state.value,
        )
        // Com duas, a Espera da ativa é o Alternar (o motor troca as duas; nada de setHold).
        calls.hold()
        assertEquals(listOf(1, 2, 1), gateway.activated)
        assertTrue(gateway.holds.isEmpty())
        assertEquals(first, calls.state.value)
        // A retomada da em espera pelo Telecom, com a ativa com o som, também é o Alternar.
        calls.activateFromTelecom(2)
        assertEquals(listOf(1, 2, 1, 2), gateway.activated)
        assertEquals(2, calls.state.value?.id)
        calls.activate()
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
        val held = SecondUi(1, "3001", "Cliente Teste", SecondKind.HELD, activeSinceMillis = start)
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
    fun `Telecom holding the active call with two calls holds it without swapping`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        ring(2, "3002", "Fulano")
        answerCall(2)
        // Uma ligação da operadora atendida: o Telecom pede a espera da ativa.
        calls.holdFromTelecom(2)
        assertTrue("sem troca: a outra não ganha o som", gateway.activated.isEmpty())
        assertEquals(listOf(2 to true), gateway.holds)
        assertEquals(listOf(1, 2), telecom.held)
        assertEquals(listOf(1, 2), telecom.active)
        val bothHeld = CallUi(
            2, "3002", "Fulano", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000,
            held = true, second = SecondUi(1, "3001", "Cliente Teste", SecondKind.HELD, activeSinceMillis = start),
        )
        assertEquals("a de cima continua, em espera", bothHeld, calls.state.value)
        calls.holdFromTelecom(2)   // já em espera: nada
        calls.holdFromTelecom(1)
        assertEquals(listOf(2 to true), gateway.holds)
        assertEquals(listOf(1, 2), telecom.held)
        assertEquals(bothHeld, calls.state.value)
        // A de cima cai do outro lado com as duas em espera: a outra não volta sozinha (o som é da operadora).
        clock.advance(20_000)
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        assertTrue(gateway.activated.isEmpty())
        assertEquals(listOf(1, 2), telecom.active)
        assertEquals(
            CallUi(
                1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start,
                held = true,
            ),
            calls.state.value,
        )
        clock.advance(5_000)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertNull(calls.state.value)
        assertEquals(listOf(2 to EndCause.REMOTE, 1 to EndCause.REMOTE), telecom.disconnected)
        assertEquals(
            listOf(
                Recent("3002", "Fulano", CallKind.RECEBIDA, start + 10_000, 20),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 35),
            ),
            recents.list(),
        )
    }

    @Test
    fun `Telecom unholding a call with two calls resumes only it`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        ring(2, "3002", "Fulano")
        answerCall(2)
        calls.holdFromTelecom(2)   // as duas em espera (uma ligação da operadora)
        // A da operadora acabou: o Telecom retoma a de cima; só ela volta, e a outra continua em espera.
        calls.activateFromTelecom(2)
        assertEquals(listOf(2), gateway.activated)
        assertEquals("sem setHold(false): é o activate", listOf(2 to true), gateway.holds)
        assertEquals(listOf(1, 2, 2), telecom.active)
        assertEquals("nenhum pedido de espera novo", listOf(1, 2), telecom.held)
        val held1 = SecondUi(1, "3001", "Cliente Teste", SecondKind.HELD, activeSinceMillis = start)
        assertEquals(
            CallUi(
                2, "3002", "Fulano", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000,
                second = held1,
            ),
            calls.state.value,
        )
        // De novo as duas em espera, e o Telecom retoma a de baixo: só ela volta, e vira a de cima.
        calls.holdFromTelecom(2)
        calls.activateFromTelecom(1)
        assertEquals(listOf(2, 1), gateway.activated)
        assertEquals(listOf(1, 2, 2, 1), telecom.active)
        assertEquals(listOf(1, 2, 2), telecom.held)
        assertEquals(
            CallUi(
                1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start,
                second = SecondUi(2, "3002", "Fulano", SecondKind.HELD, activeSinceMillis = start + 10_000),
            ),
            calls.state.value,
        )
        calls.activateFromTelecom(1)   // já com o som: nada
        assertEquals(listOf(2, 1), gateway.activated)
        // A 1 acaba primeiro, do outro lado: a 2 volta sozinha (o Telecom já não segura nenhuma), e acaba depois.
        clock.advance(20_000)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertEquals(listOf(2, 1, 2), gateway.activated)
        assertEquals(listOf(1, 2, 2, 1, 2), telecom.active)
        assertEquals(
            CallUi(2, "3002", "Fulano", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000),
            calls.state.value,
        )
        clock.advance(5_000)
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        assertNull(calls.state.value)
        assertEquals(
            listOf(
                Recent("3002", "Fulano", CallKind.RECEBIDA, start + 10_000, 25),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 30),
            ),
            recents.list(),
        )
    }

    @Test
    fun `Telecom unholding the other call clears the hold on the first`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        ring(2, "3002", "Fulano")
        answerCall(2)
        // O "trocar" do fone Bluetooth ou do kit do carro: o Telecom segura a 2 (a ativa) e retoma a 1.
        calls.holdFromTelecom(2)
        calls.activateFromTelecom(1)
        assertEquals(listOf(1), gateway.activated)
        // A 1 acaba do outro lado: a 2 volta sozinha (o som não é de uma ligação da operadora).
        clock.advance(20_000)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertEquals(listOf(1, 2), gateway.activated)
        assertEquals(listOf(1, 2, 1, 2), telecom.active)
        assertEquals(
            CallUi(2, "3002", "Fulano", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000),
            calls.state.value,
        )
    }

    @Test
    fun `Alternar after a carrier call clears the Telecom hold and the other call returns by itself`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        ring(2, "3002", "Fulano")
        answerCall(2)
        calls.holdFromTelecom(2)   // uma ligação da operadora atendida: as duas em espera, a 2 pelo Telecom
        // A da operadora acabou, e o Telecom não retoma nenhuma (as duas em espera): a pessoa toca Alternar.
        calls.activate()
        assertEquals(listOf(1), gateway.activated)
        // A 1 acaba do outro lado: a 2 volta sozinha.
        clock.advance(20_000)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertEquals(listOf(1, 2), gateway.activated)
        assertEquals(listOf(1, 2, 1, 2), telecom.active)
        assertEquals(
            CallUi(2, "3002", "Fulano", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000),
            calls.state.value,
        )
    }

    @Test
    fun `a second Desligar while the active call is ending does nothing`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        ring(2, "3002", "Fulano")
        answerCall(2)
        clock.advance(20_000)
        calls.hangup()
        calls.hangup()    // o segundo toque, antes de o fim da ativa chegar
        calls.hangup(2)   // e o onDisconnect do Telecom da mesma
        assertEquals("a em espera não sai", listOf(2), gateway.hangups)
        val first = CallUi(1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start)
        assertEquals(first.copy(held = true), calls.state.value)
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        assertEquals(listOf(1), gateway.activated)
        assertEquals(first, calls.state.value)
        // Com outra tocando: o segundo toque não a recusa.
        ring(3, "3003", "")
        calls.hangup()
        calls.hangup()
        assertEquals(listOf(2, 1), gateway.hangups)
        assertTrue("a que toca não é recusada", gateway.rejects.isEmpty())
        val ringing = CallUi(3, "3003", "", incoming = true, phase = CallPhase.RINGING)
        assertEquals(ringing, calls.state.value)
        assertTrue(calls.isRinging(3))
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertEquals("nada volta: a outra toca", listOf(1), gateway.activated)
        assertEquals(ringing, calls.state.value)
        assertEquals(listOf(2 to EndCause.LOCAL, 1 to EndCause.LOCAL), telecom.disconnected)
        assertEquals(
            listOf(
                Recent("3002", "Fulano", CallKind.RECEBIDA, start + 10_000, 20),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 30),
            ),
            recents.list(),
        )
    }

    @Test
    fun `the held call dropping while the active one is ending shows no message`() {
        ring(1)
        answerCall(1)
        ring(2, "3002", "Fulano")
        answerCall(2)
        calls.hangup()   // a ativa sai
        calls.onCallState(1, CallState.DISCONNECTED, 200)   // a em espera cai do outro lado antes do fim da ativa
        assertEquals("nenhuma continua: sem aviso", "", calls.endMessage.value)
        assertNull(calls.state.value)
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        assertTrue(gateway.activated.isEmpty())
        assertEquals(listOf(1 to EndCause.REMOTE, 2 to EndCause.LOCAL), telecom.disconnected)
        assertEquals(2, recents.list().size)
    }

    @Test
    fun `a failed second dial does not resume a call Telecom is holding`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        calls.holdFromTelecom(1)   // uma ligação da operadora atendida: o Telecom põe esta em espera
        assertEquals(listOf(1 to true), gateway.holds)
        assertEquals(listOf(1), telecom.held)
        // O Android não deixa ligar (a da operadora em andamento), e depois o motor não liga.
        assertTrue(calls.dial("2002"))
        calls.onTelecomFailed(CallManager.NO_ID)
        assertEquals(CallManager.CARRIER_CALL, calls.endMessage.value)
        gateway.refuse = true
        assertTrue(calls.dial("2003"))
        calls.onOutgoingReady()
        assertTrue("nenhuma volta sozinha: o som é da operadora", gateway.activated.isEmpty())
        assertEquals("só o do CONFIRMED", listOf(1), telecom.active)
        assertEquals(listOf(1 to true), gateway.holds)
        assertEquals(listOf(1, 1, 1), telecom.held)
        val first = CallUi(1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start)
        assertEquals(first.copy(held = true), calls.state.value)
        // A da operadora acabou: o Telecom retoma esta.
        calls.activateFromTelecom(1)
        assertEquals(listOf(1 to true, 1 to false), gateway.holds)
        assertEquals(listOf(1, 1), telecom.active)
        assertEquals(first, calls.state.value)
        // Retomada, ela volta sozinha de novo quando outra feita falha.
        assertTrue(calls.dial("2004"))
        calls.onOutgoingReady()
        assertEquals(listOf(1), gateway.activated)
        assertEquals(listOf(1, 1, 1), telecom.active)
        assertEquals(first, calls.state.value)
        assertEquals(
            setOf("2002", "2003", "2004"),
            recents.list().filter { it.kind == CallKind.FEITA }.map { it.number }.toSet(),
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

    // A transferência com consulta (spec da 0.2, 7.3): o cliente (a recebida 1) em espera e o colega (a feita pelo
    // Consultar) a ativa; Concluir, Cancelar, o colega que não atende e o cliente que desliga. E o resultado da direta.

    @Test
    fun `Consultar holds the client and dials the colleague`() {
        val start = clock.nowMillis()
        assertFalse("sem ligação, nada a consultar", calls.consult("2002"))
        ring(1)
        assertFalse("com a recebida tocando, não", calls.consult("2002"))
        answerCall(1)
        clock.advance(10_000)
        assertFalse(calls.consult(""))
        assertTrue(calls.consult("2002"))
        assertEquals("o Telecom põe o cliente em espera", listOf(1), telecom.held)
        assertEquals(listOf("2002"), telecom.placed)
        assertTrue("o motor põe o cliente em espera no makeCall", gateway.holds.isEmpty() && gateway.made.isEmpty())
        val client = SecondUi(1, "3001", "Cliente Teste", SecondKind.HELD, activeSinceMillis = start)
        assertEquals(
            CallUi(
                CallManager.NO_ID, "2002", "", incoming = false, phase = CallPhase.DIALING, second = client,
                consult = ConsultUi(CallManager.NO_ID, colleagueActive = true),
            ),
            calls.state.value,
        )
        assertFalse("com duas, nenhuma outra", calls.consult("2003"))
        assertFalse(calls.dial("2003"))
        calls.onOutgoingReady()
        val id = gateway.nextCallId - 1
        assertEquals(listOf("2002"), gateway.made)
        calls.onCallState(id, CallState.CALLING, 0)
        assertEquals(ConsultUi(id, colleagueActive = true), calls.state.value?.consult)
        // Chamando: nem Concluir nem Alternar.
        calls.completeTransfer()
        calls.activate()
        assertTrue(gateway.attended.isEmpty() && gateway.activated.isEmpty())
        calls.onCallState(id, CallState.CONFIRMED, 200)
        assertEquals(listOf(1, id), telecom.active)
        assertEquals(
            CallUi(
                id, "2002", "", incoming = false, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000,
                second = client, consult = ConsultUi(id, colleagueActive = true),
            ),
            calls.state.value,
        )
        // Alternar: a pessoa fala com o cliente de novo, e o colega fica em espera (a consulta continua).
        calls.activate()
        assertEquals(listOf(1), gateway.activated)
        assertEquals(
            CallUi(
                1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start,
                second = SecondUi(id, "2002", "", SecondKind.HELD, activeSinceMillis = start + 10_000),
                consult = ConsultUi(id, colleagueActive = false),
            ),
            calls.state.value,
        )
        assertTrue("nada sai", gateway.hangups.isEmpty() && telecom.disconnected.isEmpty())
    }

    @Test
    fun `Concluir transferência sends the attended transfer and both calls end`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        val id = consultOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        clock.advance(20_000)
        calls.completeTransfer()
        assertEquals("o cliente para o colega", listOf(1 to id), gateway.attended)
        calls.completeTransfer()   // o segundo toque, antes do resultado: nada
        assertEquals(1, gateway.attended.size)
        // A central aceitou: o motor desliga as duas (os fins chegam por ele), e a tela de chamada fecha.
        calls.onTransfer(1, 200)
        assertNull(calls.state.value)
        assertEquals("", calls.endMessage.value)
        assertTrue("o motor é quem desliga", gateway.hangups.isEmpty())
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        assertEquals("sem aviso", "", calls.endMessage.value)
        assertTrue("nada volta", gateway.activated.isEmpty())
        assertNull(calls.state.value)
        assertEquals(listOf(1 to EndCause.LOCAL, id to EndCause.LOCAL), telecom.disconnected)
        assertTrue(notifier.missed.isEmpty())
        assertEquals(
            listOf(
                Recent("2002", "", CallKind.FEITA, start + 10_000, 20),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 30),
            ),
            recents.list(),
        )
    }

    @Test
    fun `a refused attended transfer shows the message and keeps both calls`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        val id = consultOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        calls.completeTransfer()
        val both = CallUi(
            id, "2002", "", incoming = false, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000,
            second = SecondUi(1, "3001", "Cliente Teste", SecondKind.HELD, activeSinceMillis = start),
            consult = ConsultUi(id, colleagueActive = true),
        )
        calls.onTransfer(1, 603)   // o REFER recusado
        assertEquals("O servidor não aceitou a transferência.", calls.endMessage.value)
        assertEquals("as duas continuam como estavam", both, calls.state.value)
        assertTrue(gateway.hangups.isEmpty() && gateway.activated.isEmpty() && telecom.disconnected.isEmpty())
        clock.advance(1_999)
        assertEquals("O servidor não aceitou a transferência.", calls.endMessage.value)
        clock.advance(1)
        assertEquals("", calls.endMessage.value)
        // De novo, do lado do cliente (Alternar): Concluir vale com qualquer um dos dois ativo.
        calls.activate()
        calls.completeTransfer()
        assertEquals(listOf(1 to id, 1 to id), gateway.attended)
        calls.onTransfer(1, 486)   // o NOTIFY com erro
        assertEquals("O servidor não aceitou a transferência.", calls.endMessage.value)
        assertEquals(1, calls.state.value?.id)
        assertEquals(ConsultUi(id, colleagueActive = false), calls.state.value?.consult)
        assertTrue(gateway.hangups.isEmpty() && telecom.disconnected.isEmpty())
        assertTrue(recents.list().isEmpty())
    }

    @Test
    fun `the colleague ending before the attended transfer is accepted frees the client for a new transfer`() {
        ring(1)
        answerCall(1)
        val id = consultOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        calls.completeTransfer()
        assertEquals(listOf(1 to id), gateway.attended)
        // O colega desliga junto com o toque em Concluir: o motor recusa o REFER (o colega já não está), e o resultado
        // nunca chega. O cliente volta sozinho, e pode ser transferido de novo.
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        assertEquals(listOf(1), gateway.activated)
        assertNull(calls.state.value?.consult)
        assertTrue(calls.transfer("2003"))
        assertEquals(listOf(1 to "2003"), gateway.transfers)
    }

    @Test
    fun `Cancelar ends the colleague and resumes the client`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        val id = consultOut("2002")
        calls.onCallState(id, CallState.CALLING, 0)
        calls.cancelConsult()
        assertEquals("o colega sai", listOf(id), gateway.hangups)
        assertTrue("o cliente volta quando o fim chega", gateway.activated.isEmpty())
        val client = CallUi(1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start)
        assertEquals("até lá, o cliente em espera, sem a consulta", client.copy(held = true), calls.state.value)
        calls.cancelConsult()   // repetido: nada
        assertEquals(listOf(id), gateway.hangups)
        calls.onCallState(id, CallState.DISCONNECTED, 487)
        assertEquals(listOf(1), gateway.activated)
        assertEquals(listOf(1, 1), telecom.active)
        assertEquals(listOf(id to EndCause.LOCAL), telecom.disconnected)
        assertEquals("o cliente voltou sozinho", client, calls.state.value)
        assertEquals("cancelada aqui: sem aviso", "", calls.endMessage.value)
        // Com o colega atendido e o cliente de volta pelo Alternar: o colega (em espera) sai, e o cliente segue.
        clock.advance(5_000)
        val next = consultOut("2003")
        calls.onCallState(next, CallState.CONFIRMED, 200)
        calls.activate()
        assertEquals(listOf(1, 1), gateway.activated)
        clock.advance(5_000)
        calls.cancelConsult()
        assertEquals(listOf(id, next), gateway.hangups)
        assertEquals(client, calls.state.value)
        calls.onCallState(next, CallState.DISCONNECTED, 200)
        assertEquals("o cliente já estava com o som", listOf(1, 1), gateway.activated)
        assertEquals("", calls.endMessage.value)
        assertEquals(client, calls.state.value)
        // O Telecom pôs o cliente em espera (uma ligação da operadora): o Cancelar não o retoma.
        calls.holdFromTelecom(1)
        val third = consultOut("2004")
        calls.cancelConsult()
        calls.onCallState(third, CallState.DISCONNECTED, 487)
        assertEquals("nada volta: o som é da operadora", listOf(1, 1), gateway.activated)
        assertEquals(client.copy(held = true), calls.state.value)
        assertEquals(
            listOf(
                Recent("2004", "", CallKind.FEITA, start + 20_000, 0),
                Recent("2003", "", CallKind.FEITA, start + 15_000, 5),
                Recent("2002", "", CallKind.FEITA, start + 10_000, 0),
            ),
            recents.list(),
        )
    }

    @Test
    fun `the colleague not answering resumes the client with the message`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        val id = consultOut("2002")
        calls.onCallState(id, CallState.CALLING, 0)
        clock.advance(30_000)
        calls.onCallState(id, CallState.DISCONNECTED, 480)
        assertEquals("o motivo do núcleo, com o número do colega", "2002: fim 480", calls.endMessage.value)
        assertEquals("o cliente volta sozinho", listOf(1), gateway.activated)
        assertEquals(listOf(1, 1), telecom.active)
        assertEquals(listOf(id to EndCause.ERROR), telecom.disconnected)
        val client = CallUi(1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start)
        assertEquals(client, calls.state.value)
        clock.advance(1_999)
        assertEquals("2002: fim 480", calls.endMessage.value)
        clock.advance(1)
        assertEquals("", calls.endMessage.value)
        calls.completeTransfer()   // sem consulta: nada
        assertTrue(gateway.attended.isEmpty())
        // Outra consulta, e o colega está ocupado.
        val next = consultOut("2003")
        calls.onCallState(next, CallState.DISCONNECTED, 486)
        assertEquals("2003: fim 486", calls.endMessage.value)
        assertEquals(next to EndCause.BUSY, telecom.disconnected.last())
        assertEquals(listOf(1, 1), gateway.activated)
        assertEquals(client, calls.state.value)
        assertEquals(
            listOf(
                Recent("2003", "", CallKind.FEITA, start + 42_000, 0),
                Recent("2002", "", CallKind.FEITA, start + 10_000, 0),
            ),
            recents.list(),
        )
    }

    @Test
    fun `the client hanging up during the consult leaves a normal call with the colleague`() {
        val start = clock.nowMillis()
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        val id = consultOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        clock.advance(20_000)
        calls.onCallState(1, CallState.DISCONNECTED, 200)   // o cliente, em espera, desligou
        assertEquals("Cliente Teste desligou", calls.endMessage.value)
        val colleague = CallUi(id, "2002", "", incoming = false, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000)
        assertEquals("uma ligação normal, sem o rótulo", colleague, calls.state.value)
        assertEquals(listOf(1 to EndCause.REMOTE), telecom.disconnected)
        assertTrue("o colega continua como estava", gateway.activated.isEmpty() && gateway.hangups.isEmpty())
        calls.completeTransfer()   // sem consulta: nada
        calls.cancelConsult()
        assertTrue(gateway.attended.isEmpty() && gateway.hangups.isEmpty())
        clock.advance(5_000)
        calls.hangup()
        assertEquals(listOf(id), gateway.hangups)
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        assertNull(calls.state.value)
        assertEquals(
            listOf(
                Recent("2002", "", CallKind.FEITA, start + 10_000, 25),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 30),
            ),
            recents.list(),
        )
    }

    @Test
    fun `a refused direct transfer shows the message`() {
        val id = dialOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        val call = calls.state.value
        assertTrue(calls.transfer("2003"))
        assertEquals(listOf(id to "2003"), gateway.transfers)
        calls.onTransfer(id, 603)
        assertEquals("O servidor não aceitou a transferência.", calls.endMessage.value)
        assertEquals("a ligação continua", call, calls.state.value)
        assertTrue(gateway.hangups.isEmpty() && telecom.disconnected.isEmpty())
        clock.advance(2_000)
        assertEquals("", calls.endMessage.value)
        calls.onTransfer(99, 603)   // de outra ligação: nada
        assertEquals("", calls.endMessage.value)
        // De novo, e o servidor aceita: nada, até o fim que o motor manda.
        assertTrue(calls.transfer("2003"))
        calls.onTransfer(id, 200)
        assertEquals("", calls.endMessage.value)
        assertEquals(call, calls.state.value)
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        assertNull(calls.state.value)
        assertEquals("", calls.endMessage.value)
        assertEquals(CallKind.FEITA, recents.list().single().kind)
    }

    @Test
    fun `a direct transfer waiting for its result refuses Consultar, and a consult refuses the direct transfer`() {
        ring(1)
        answerCall(1)
        assertTrue(calls.transfer("2003"))
        // O REFER espera o NOTIFY final (o destino ainda não atendeu): nem Consultar nem outro Transferir agora nela.
        assertFalse(calls.consult("2002"))
        assertFalse(calls.transfer("2004"))
        assertTrue("nada discado", telecom.placed.isEmpty() && gateway.made.isEmpty())
        assertEquals(listOf(1 to "2003"), gateway.transfers)
        assertNull(calls.state.value?.consult)
        // A central aceitou: o motor desliga só ela, e nada fica de pé escondido.
        calls.onTransfer(1, 200)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertNull(calls.state.value)
        assertTrue(gateway.hangups.isEmpty())
        assertTrue("uma ligação nova depois", calls.dial("2005"))
        calls.hangup()
        // Na consulta, a transferência é o Concluir: o Transferir agora não vale, de nenhum dos lados.
        ring(2, "3002", "")
        answerCall(2)
        val id = consultOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        assertFalse(calls.transfer("2004"))
        calls.activate()
        assertFalse(calls.transfer("2004"))
        assertEquals(listOf(1 to "2003"), gateway.transfers)
        // Um 2xx no cliente sem o Concluir pedido não é da consulta: as duas continuam.
        calls.onTransfer(2, 200)
        assertEquals(ConsultUi(id, colleagueActive = false), calls.state.value?.consult)
        assertEquals(SecondUi(id, "2002", "", SecondKind.HELD, activeSinceMillis = clock.nowMillis()), calls.state.value?.second)
        calls.completeTransfer()
        assertEquals(listOf(2 to id), gateway.attended)
        calls.onTransfer(2, 200)
        assertNull("o Concluir pedido: as duas saem", calls.state.value)
    }

    // A conferência (spec da 0.2, 7.4): as duas ligações juntas no celular (a mesa de áudio do motor), Separar,
    // Desligar para as duas, uma que sai e Sair. E a espera pedida pelo Telecom no meio dela.

    // Duas ligações em andamento: a recebida 1 ("Cliente Teste"), em espera, e a feita para 2002, a ativa, que liga e é
    // atendida 10 s depois da primeira (o id dela no motor).
    private fun twoCalls(): Int {
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        val id = dialOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        return id
    }

    @Test
    fun `Juntar joins both calls into a conference`() {
        val start = clock.nowMillis()
        ring(1)
        calls.join()   // tocando: nada
        answerCall(1)
        calls.join()   // uma só: nada
        clock.advance(10_000)
        val id = dialOut("2002")
        calls.join()   // a feita ainda chama: nada
        assertTrue(gateway.joined.isEmpty() && telecom.joined.isEmpty())
        calls.onCallState(id, CallState.CONFIRMED, 200)
        clock.advance(5_000)
        calls.join()
        assertEquals("a ativa e a outra", listOf(id to 1), gateway.joined)
        assertEquals(listOf(id to 1), telecom.joined)
        assertTrue("o motor retoma a em espera no join", gateway.activated.isEmpty() && gateway.holds.isEmpty())
        // Para o Telecom (o plano B, sem Conference), a de cima continua ACTIVE e a outra HOLDING, como estavam.
        assertEquals("só os do CONFIRMED", listOf(1, id), telecom.active)
        assertEquals("a outra em espera desde a Nova ligação", listOf(1), telecom.held)
        val conference = CallUi(
            id, "2002", "", incoming = false, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000,
            second = SecondUi(1, "3001", "Cliente Teste", SecondKind.ACTIVE, activeSinceMillis = start), conference = true,
            conferenceSinceMillis = start + 15_000,
        )
        assertEquals(conference, calls.state.value)
        calls.join()   // já em conferência: nada
        assertEquals(1, gateway.joined.size)
        assertEquals(1, telecom.joined.size)
        // Na conferência, nem Espera, nem Alternar, nem Transferir, nem Nova ligação.
        calls.hold()
        calls.activate()
        assertFalse(calls.transfer("2003"))
        assertFalse(calls.consult("2003"))
        assertFalse(calls.dial("2003"))
        assertTrue(gateway.holds.isEmpty() && gateway.activated.isEmpty() && gateway.transfers.isEmpty())
        assertEquals(listOf("2002"), telecom.placed)
        assertEquals(conference, calls.state.value)
        // O mudo vale para as duas, e o teclado manda na de cima.
        calls.mute()
        assertEquals(listOf(true), gateway.mutes)
        calls.dtmf("1")
        assertEquals(listOf(id to "1"), gateway.dtmfs)
        assertEquals(conference.copy(muted = true), calls.state.value)
        // Uma terceira recebe ocupado, e a conferência segue.
        calls.onIncoming(id + 1, "3003", "")
        assertEquals(listOf(id + 1), gateway.rejects)
        calls.onCallState(id + 1, CallState.DISCONNECTED, 486)
        assertEquals(conference.copy(muted = true), calls.state.value)
        assertEquals(listOf(Recent("3003", "", CallKind.PERDIDA, start + 15_000, 0)), recents.list())
        assertTrue(telecom.disconnected.isEmpty() && gateway.hangups.isEmpty())
        assertEquals(0, telecom.splits)
    }

    @Test
    fun `Separar holds the last call again`() {
        val start = clock.nowMillis()
        val id = twoCalls()
        calls.split()   // sem conferência: nada
        assertTrue(gateway.split.isEmpty())
        assertEquals(0, telecom.splits)
        calls.join()   // com a feita em cima
        clock.advance(5_000)
        calls.split()
        // A última que entrou (a feita) vai para a espera, e a primeira fica a ativa, em cima.
        assertEquals(listOf(1 to id), gateway.split)
        assertEquals("o split põe a outra em espera no motor", listOf("join $id 1", "split 1 $id"), gateway.order)
        assertEquals(1, telecom.splits)
        assertEquals(
            "o fim da conferência antes das esperas: a feita HOLDING e a primeira ACTIVE",
            listOf("join $id 1", "split", "hold $id", "active 1"), telecom.order.takeLast(4),
        )
        val first = CallUi(
            1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start,
            second = SecondUi(id, "2002", "", SecondKind.HELD, activeSinceMillis = start + 10_000),
        )
        assertEquals(first, calls.state.value)
        calls.split()   // repetido: nada
        assertEquals(1, gateway.split.size)
        assertEquals(1, telecom.splits)
        // Juntar de novo, agora com a primeira em cima: Separar põe de novo a feita (a última que entrou) em espera.
        calls.join()
        assertEquals(listOf(id to 1, 1 to id), gateway.joined)
        assertEquals(listOf(id to 1, 1 to id), telecom.joined)
        assertEquals(
            first.copy(
                second = SecondUi(id, "2002", "", SecondKind.ACTIVE, activeSinceMillis = start + 10_000), conference = true,
                conferenceSinceMillis = start + 15_000,
            ),
            calls.state.value,
        )
        calls.split()
        assertEquals(listOf(1 to id, 1 to id), gateway.split)
        assertEquals(2, telecom.splits)
        assertEquals(first, calls.state.value)
        // Separadas, o Alternar vale de novo.
        calls.activate()
        assertEquals(listOf(id), gateway.activated)
        assertEquals(id, calls.state.value?.id)
        assertTrue(gateway.holds.isEmpty() && gateway.hangups.isEmpty() && telecom.disconnected.isEmpty())
    }

    @Test
    fun `hanging up a conference ends both calls`() {
        val start = clock.nowMillis()
        val id = twoCalls()
        calls.join()
        clock.advance(20_000)
        calls.hangup()
        assertEquals("as duas saem", listOf(1, id), gateway.hangups)
        assertNull("a tela sai na hora", calls.state.value)
        calls.hangup()   // o segundo toque, antes dos fins: nada
        assertEquals(2, gateway.hangups.size)
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        assertEquals("o Telecom sabe do fim da conferência no primeiro fim", 1, telecom.splits)
        assertEquals(listOf(id to EndCause.LOCAL), telecom.disconnected)
        assertTrue("nada volta", gateway.activated.isEmpty())
        assertNull(calls.state.value)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertEquals(listOf(id to EndCause.LOCAL, 1 to EndCause.LOCAL), telecom.disconnected)
        assertEquals(1, telecom.splits)
        assertEquals(listOf("split", "disconnect $id", "disconnect 1"), telecom.order.takeLast(3))
        assertTrue(gateway.activated.isEmpty() && gateway.holds.isEmpty())
        assertEquals("só os do CONFIRMED de cada uma", listOf(1, id), telecom.active)
        assertEquals("desligadas aqui: sem aviso", "", calls.endMessage.value)
        assertNull(calls.state.value)
        assertEquals(
            listOf(
                Recent("2002", "", CallKind.FEITA, start + 10_000, 20),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 30),
            ),
            recents.list(),
        )
        assertTrue("uma ligação nova depois", calls.dial("2003"))
    }

    @Test
    fun `Telecom disconnecting the active connection of a conference ends both legs`() {
        telecomDisconnectsAConferenceLeg(top = true)
    }

    @Test
    fun `Telecom disconnecting the holding connection of a conference ends both legs`() {
        telecomDisconnectsAConferenceLeg(top = false)
    }

    // A conferência do [twoCalls] (a feita em cima: para o Telecom, a ACTIVE, e a 1 a HOLDING), e o Telecom desliga a
    // Connection de uma das duas ([top]: a ACTIVE), pelo fone Bluetooth ou pelo kit do carro: as duas saem, como no
    // Desligar da tela, e nenhuma fica com o som.
    private fun telecomDisconnectsAConferenceLeg(top: Boolean) {
        val start = clock.nowMillis()
        val id = twoCalls()
        calls.join()
        clock.advance(20_000)
        val leg = if (top) id else 1
        val other = if (top) 1 else id
        calls.hangup(leg)
        assertEquals("as duas saem", listOf(1, id), gateway.hangups)
        assertNull("a tela sai na hora", calls.state.value)
        calls.hangup(other)   // o pedido da outra Connection, antes dos fins: nada
        assertEquals(2, gateway.hangups.size)
        calls.onCallState(leg, CallState.DISCONNECTED, 200)
        assertNull(calls.state.value)
        assertTrue("a outra não volta", gateway.activated.isEmpty() && gateway.holds.isEmpty())
        assertEquals("só os do CONFIRMED de cada uma", listOf(1, id), telecom.active)
        calls.onCallState(other, CallState.DISCONNECTED, 200)
        assertNull(calls.state.value)
        assertEquals(listOf(leg to EndCause.LOCAL, other to EndCause.LOCAL), telecom.disconnected)
        assertEquals(1, telecom.splits)
        assertTrue(gateway.activated.isEmpty())
        assertEquals(listOf(1, id), telecom.active)
        assertEquals("desligadas aqui: sem aviso", "", calls.endMessage.value)
        assertEquals(
            listOf(
                Recent("2002", "", CallKind.FEITA, start + 10_000, 20),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 30),
            ),
            recents.list(),
        )
    }

    @Test
    fun `a party leaving the conference leaves a normal call`() {
        val start = clock.nowMillis()
        val id = twoCalls()
        calls.join()
        clock.advance(20_000)
        // O cliente (o de baixo) desliga: a conferência vira uma ligação normal com o colega.
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertEquals("Cliente Teste desligou", calls.endMessage.value)
        val colleague = CallUi(id, "2002", "", incoming = false, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000)
        assertEquals(colleague, calls.state.value)
        assertEquals(1, telecom.splits)
        assertEquals(listOf(1 to EndCause.REMOTE), telecom.disconnected)
        assertEquals(
            "a que fica é a ativa no Telecom", listOf("split", "disconnect 1", "active $id"), telecom.order.takeLast(3),
        )
        assertTrue(
            "o motor já a deixa com o som: nada de activate",
            gateway.activated.isEmpty() && gateway.holds.isEmpty() && gateway.hangups.isEmpty(),
        )
        clock.advance(1_999)
        assertEquals("Cliente Teste desligou", calls.endMessage.value)
        clock.advance(1)
        assertEquals("", calls.endMessage.value)
        // Uma ligação normal: Separar não faz nada, e a Espera é a de sempre.
        calls.split()
        assertTrue(gateway.split.isEmpty())
        calls.hold()
        calls.hold()
        assertEquals(listOf(id to true, id to false), gateway.holds)
        assertEquals(colleague, calls.state.value)
        // De novo com uma segunda, e quem sai é a de cima: a outra fica, também sem activate.
        clock.advance(5_000)
        ring(2, "3002", "Fulano")
        answerCall(2)
        calls.join()
        assertEquals(listOf(id to 1, 2 to id), gateway.joined)
        clock.advance(10_000)
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        assertEquals("Fulano desligou", calls.endMessage.value)
        assertEquals(colleague, calls.state.value)
        assertEquals(2, telecom.splits)
        assertEquals(listOf("split", "disconnect 2", "active $id"), telecom.order.takeLast(3))
        assertTrue(gateway.activated.isEmpty())
        clock.advance(7_000)
        calls.hangup()
        assertEquals(listOf(id), gateway.hangups)
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        assertNull(calls.state.value)
        assertEquals(
            listOf(
                Recent("3002", "Fulano", CallKind.RECEBIDA, start + 37_000, 10),
                Recent("2002", "", CallKind.FEITA, start + 10_000, 44),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 30),
            ),
            recents.list(),
        )
    }

    @Test
    fun `logout during a conference ends both calls`() {
        val start = clock.nowMillis()
        val id = twoCalls()
        calls.join()
        calls.mute()
        clock.advance(20_000)
        calls.onLogout()
        assertEquals(listOf(1, id), gateway.hangups)
        assertEquals(1, telecom.splits)
        assertEquals(listOf(1 to EndCause.LOCAL, id to EndCause.LOCAL), telecom.disconnected)
        assertEquals(listOf("split", "disconnect 1", "disconnect $id"), telecom.order.takeLast(3))
        assertTrue("nenhuma volta", gateway.activated.isEmpty())
        assertEquals("o Telecom não ativa nenhuma", listOf(1, id), telecom.active)
        assertEquals("o mudo sai", listOf(true, false), gateway.mutes)
        assertNull(calls.state.value)
        assertEquals("", calls.endMessage.value)
        calls.onCallState(1, CallState.DISCONNECTED, 200)   // os fins que chegam depois são ignorados
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        assertEquals(2, telecom.disconnected.size)
        assertEquals(1, telecom.splits)
        assertTrue(notifier.missed.isEmpty())
        assertEquals(
            listOf(
                Recent("2002", "", CallKind.FEITA, start + 10_000, 20),
                Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 30),
            ),
            recents.list(),
        )
        // A conferência não passa para o próximo Entrar: a ligação nova é uma só.
        calls.onLogin()
        ring(5, "3005", "")
        answerCall(5)
        assertEquals(
            CallUi(5, "3005", "", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start + 30_000),
            calls.state.value,
        )
    }

    @Test
    fun `Juntar during a consult is not offered`() {
        ring(1)
        answerCall(1)
        val id = consultOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        val consult = calls.state.value
        assertEquals(ConsultUi(id, colleagueActive = true), consult?.consult)
        calls.join()
        assertEquals(consult, calls.state.value)
        calls.activate()   // do lado do cliente, também não
        val client = calls.state.value
        calls.join()
        assertTrue(gateway.joined.isEmpty() && telecom.joined.isEmpty())
        assertEquals(client, calls.state.value)
        assertEquals(ConsultUi(id, colleagueActive = false), client?.consult)
        assertFalse(client!!.conference)
        // Nem com uma transferência esperando o resultado, em qualquer das duas.
        calls.cancelConsult()
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        ring(2, "3002", "")
        answerCall(2)
        assertTrue(calls.transfer("2003"))   // a direta da ativa (2), esperando o NOTIFY
        calls.join()
        calls.activate()   // a 2, com o pedido, vai para a espera
        calls.join()
        assertTrue(gateway.joined.isEmpty() && telecom.joined.isEmpty())
        calls.onTransfer(2, 603)   // recusada: as duas continuam, e o Juntar vale
        calls.join()
        assertEquals(listOf(1 to 2), gateway.joined)
        assertEquals(listOf(1 to 2), telecom.joined)
        assertTrue(calls.state.value!!.conference)
    }

    @Test
    fun `Telecom holding a conference splits it and holds both calls`() {
        val start = clock.nowMillis()
        val id = twoCalls()
        calls.join()
        calls.holdFromTelecom(99)   // de outra ligação: nada
        assertTrue(gateway.split.isEmpty() && gateway.holds.isEmpty())
        // Uma ligação da operadora atendida: o Telecom pede a espera da de cima (a ACTIVE para ele).
        calls.holdFromTelecom(id)
        assertEquals(
            "primeiro o Separar, depois a espera da que fica: nunca o setHold na conferência",
            listOf("join $id 1", "split 1 $id", "hold 1 true"), gateway.order,
        )
        assertEquals(1, telecom.splits)
        assertEquals(listOf("split", "hold $id", "hold 1"), telecom.order.takeLast(3))
        val bothHeld = CallUi(
            1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start,
            held = true, second = SecondUi(id, "2002", "", SecondKind.HELD, activeSinceMillis = start + 10_000),
        )
        assertEquals("sem troca: nenhuma tem o som", bothHeld, calls.state.value)
        calls.holdFromTelecom(1)   // já em espera: nada
        assertEquals(3, gateway.order.size)
        // A da operadora acabou: o Telecom retoma a de cima (como com duas: o activate), e a outra continua em espera.
        calls.activateFromTelecom(1)
        assertEquals(listOf(1), gateway.activated)
        assertEquals("active 1", telecom.order.last())
        assertEquals(bothHeld.copy(held = false), calls.state.value)
    }

    @Test
    fun `Juntar is refused while Telecom holds a call`() {
        val id = twoCalls()
        calls.holdFromTelecom(id)   // uma ligação da operadora atendida: as duas em espera, a de cima pelo Telecom
        calls.join()
        assertTrue(
            "juntar retomaria as duas e tiraria o som da operadora",
            gateway.joined.isEmpty() && telecom.joined.isEmpty(),
        )
        assertFalse(calls.state.value!!.conference)
        // A da operadora acabou: o Telecom retoma a dele, e o Juntar vale.
        calls.activateFromTelecom(id)
        assertEquals(id, calls.state.value?.id)
        calls.join()
        assertEquals(listOf(id to 1), gateway.joined)
        assertEquals(listOf(id to 1), telecom.joined)
        assertTrue(calls.state.value!!.conference)
        assertEquals(listOf("hold $id true", "activate $id", "join $id 1"), gateway.order)
        assertEquals(listOf(1, id, id), telecom.active)
        assertEquals("a outra fica HOLDING para o Telecom", listOf(1, id), telecom.held)
    }

    @Test
    fun `Alternar after a carrier call clears the Telecom hold and Juntar works`() {
        ring(1)
        answerCall(1)
        ring(2, "3002", "Fulano")
        answerCall(2)
        calls.holdFromTelecom(2)   // uma ligação da operadora atendida: as duas em espera, a 2 pelo Telecom
        // A da operadora acabou, e o Telecom não retoma nenhuma (as duas em espera): a pessoa toca Alternar.
        calls.activate()
        assertEquals(listOf(1), gateway.activated)
        // A 1 tem o som: o Telecom já não protege a ligação da operadora, e o Juntar vale.
        calls.join()
        assertEquals(listOf(1 to 2), gateway.joined)
        assertEquals(listOf(1 to 2), telecom.joined)
        assertTrue(calls.state.value!!.conference)
    }

    @Test
    fun `Telecom holding a conference marks the call it named, and a failed dial does not resume it`() {
        val start = clock.nowMillis()
        val id = twoCalls()
        calls.join()
        // Uma ligação da operadora atendida: o Telecom segura a feita (a ACTIVE para ele), e as duas ficam em espera.
        calls.holdFromTelecom(id)
        calls.join()   // a feita, segurada pelo Telecom, não deixa juntar de novo
        assertEquals(1, gateway.joined.size)
        // O cliente desliga do outro lado, e fica a feita, ainda segurada pelo Telecom. O Android não deixa a Nova
        // ligação (a da operadora em andamento), e a feita não volta sozinha.
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertTrue(calls.dial("2003"))
        calls.onTelecomFailed(CallManager.NO_ID)
        assertEquals(CallManager.CARRIER_CALL, calls.endMessage.value)
        assertTrue("o som é da operadora", gateway.activated.isEmpty())
        assertEquals("só os do CONFIRMED", listOf(1, id), telecom.active)
        val colleague = CallUi(id, "2002", "", incoming = false, phase = CallPhase.ACTIVE, activeSinceMillis = start + 10_000)
        assertEquals(colleague.copy(held = true), calls.state.value)
        // A da operadora acabou: o Telecom retoma a feita.
        calls.activateFromTelecom(id)
        assertEquals(listOf(1 to true, id to false), gateway.holds)
        assertEquals(colleague, calls.state.value)
    }

    @Test
    fun `the phone contact names the calls, the messages and Telecom, and the Recents keep the server name`() {
        contacts.contacts += Contact("Maria Silva", listOf("3001"))
        contacts.contacts += Contact("João Souza", listOf("3002"))
        val start = clock.nowMillis()
        ring(1, "3001", "Cliente Teste")
        assertEquals(
            "o Telecom (a notificação) recebe o nome do contato",
            Triple(1, "3001", "Maria Silva"),
            telecom.incoming.single(),
        )
        assertEquals(IncomingRequest(1, "3001", "Maria Silva"), calls.ringing())
        answerCall(1)
        // A segunda, de outro contato: a faixa e, atendida, o cartão de cima; a primeira no cartão "Em espera".
        ring(2, "3002", "Fulano")
        assertEquals(SecondUi(2, "3002", "João Souza", SecondKind.RINGING), calls.state.value?.second)
        answerCall(2)
        assertEquals("João Souza", calls.state.value?.name)
        assertEquals(SecondUi(1, "3001", "Maria Silva", SecondKind.HELD, activeSinceMillis = start), calls.state.value?.second)
        // A em espera cai do outro lado: o aviso com o nome do contato.
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertEquals("Maria Silva desligou", calls.endMessage.value)
        assertEquals(Recent("3001", "Cliente Teste", CallKind.RECEBIDA, start, 0), recents.list().single())
        assertEquals("cada número procurado uma vez, quando a ligação chegou", listOf("3001", "3002"), contacts.lookups)
    }

    @Test
    fun `a missed call from a phone contact names the contact`() {
        contacts.contacts += Contact("Maria Silva", listOf("3001"))
        ring(1, "3001", "Cliente Teste")
        calls.onCallState(1, CallState.DISCONNECTED, 487)
        calls.onRejectedBusy("3001", "Cliente Teste")
        calls.onRejectedBusy("3005", "Fulano")
        assertEquals(
            listOf("Ligação perdida de Maria Silva", "Ligação perdida de Maria Silva", "Ligação perdida de 3005"),
            notifier.missed,
        )
        assertEquals(listOf("Cliente Teste", "Cliente Teste", "Fulano"), recents.list().map { it.name })
    }

    @Test
    fun `an outgoing call shows the phone contact name`() {
        contacts.contacts += Contact("Maria Silva", listOf("3001"))
        val id = dialOut("3001")
        assertEquals("Maria Silva", calls.state.value?.name)
        calls.onCallState(id, CallState.CONFIRMED, 200)
        assertEquals("Maria Silva", calls.state.value?.name)
        calls.hangup()
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        assertEquals("os Recentes guardam o nome que a central mandou (nenhum)", "", recents.list().single().name)
        assertEquals(listOf("3001"), contacts.lookups)
    }

    // O Não perturbe (spec 4): quem liga ouve ocupado, e a perdida avisa sem som; a que já toca continua tocando.

    @Test
    fun `do not disturb answers busy and logs a silent missed call`() {
        settings = CallSettings(doNotDisturb = true)
        val start = clock.nowMillis()
        calls.onIncoming(1, "3001", "Cliente Teste")
        assertEquals("ocupado", listOf(1), gateway.rejects)
        assertNull("não toca nem abre a tela", calls.state.value)
        assertFalse(calls.isRinging(1))
        assertEquals(listOf(Recent("3001", "Cliente Teste", CallKind.PERDIDA, start, 0)), recents.list())
        assertEquals(listOf("Ligação perdida de 3001"), notifier.missed)
        assertEquals("sem som e sem vibrar", listOf(true), notifier.missedSilent)
        calls.onCallState(1, CallState.DISCONNECTED, 486)   // o fim da recusada, no motor: nada mais
        assertEquals(1, notifier.missed.size)
        assertEquals(1, recents.list().size)
        assertTrue("nada vai ao Telecom", telecom.incoming.isEmpty() && telecom.disconnected.isEmpty())
        // A que o motor recusou sozinho (ocupado) também avisa sem som.
        calls.onRejectedBusy("3003", "Fulano")
        assertEquals(listOf("Ligação perdida de 3001", "Ligação perdida de 3003"), notifier.missed)
        assertEquals(listOf(true, true), notifier.missedSilent)
        // As feitas funcionam normalmente.
        val id = dialOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        assertEquals(CallPhase.ACTIVE, calls.state.value?.phase)
        assertEquals(listOf(id), telecom.active)
    }

    @Test
    fun `do not disturb spares the call already ringing`() {
        val start = clock.nowMillis()
        ring(1)
        settings = settings.copy(doNotDisturb = true)   // ligado com a 1 tocando: vale para as próximas
        assertTrue("a que já toca continua tocando", calls.isRinging(1))
        assertEquals(CallUi(1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.RINGING), calls.state.value)
        assertTrue(gateway.rejects.isEmpty() && notifier.missed.isEmpty())
        answerCall(1)
        // A próxima (que, sem o Não perturbe, tocaria como a segunda) recebe ocupado, com a perdida sem som.
        clock.advance(5_000)
        calls.onIncoming(2, "3002", "Fulano")
        assertEquals(listOf(2), gateway.rejects)
        assertEquals("só a 1 foi ao Telecom", listOf(1), telecom.incoming.map { it.first })
        assertEquals(listOf("Ligação perdida de 3002"), notifier.missed)
        assertEquals(listOf(true), notifier.missedSilent)
        assertEquals(listOf(Recent("3002", "Fulano", CallKind.PERDIDA, start + 5_000, 0)), recents.list())
        assertEquals(
            "a 1 continua",
            CallUi(1, "3001", "Cliente Teste", incoming = true, phase = CallPhase.ACTIVE, activeSinceMillis = start),
            calls.state.value,
        )
    }

    // O Atender automático (spec 5): só a recebida que toca sozinha, depois do tempo escolhido contado de quando o
    // celular toca (o Telecom criou a Connection dela), se ela ainda toca sozinha, com ele ligado e o Não perturbe
    // desligado.

    @Test
    fun `auto answer starts when the phone rings`() {
        settings = CallSettings(autoAnswer = true, autoAnswerSeconds = 3)
        telecom.createsConnections = false
        // Até o Telecom criar a Connection, o celular não toca, e nada é atendido.
        ring(1)
        clock.advance(10_000)
        assertTrue(gateway.answers.isEmpty())
        assertTrue(calls.isRinging(1))
        // O celular toca: o tempo conta daqui, e uma criação repetida não recomeça a contagem.
        telecom.createConnection(1)
        clock.advance(2_000)
        telecom.createConnection(1)
        clock.advance(999)
        assertTrue("2999 ms depois de tocar: ainda não", gateway.answers.isEmpty())
        clock.advance(1)
        assertEquals(listOf(1), gateway.answers)
        calls.onCallState(1, CallState.CONFIRMED, 200)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        // Na hora: logo depois de a Connection nascer, na próxima volta do relógio.
        settings = settings.copy(autoAnswerSeconds = 0)
        ring(2, "3002", "")
        clock.advance(5_000)
        assertEquals(listOf(1), gateway.answers)
        telecom.createConnection(2)
        assertEquals(listOf(1), gateway.answers)
        clock.advance(0)
        assertEquals(listOf(1, 2), gateway.answers)
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        // O Telecom não criou a Connection (recusou a ligação): nada é atendido.
        ring(3, "3003", "")
        calls.onTelecomFailed(3)
        clock.advance(10_000)
        calls.onCallState(3, CallState.DISCONNECTED, 486)
        // A Connection nasce depois de quem ligou desistir: nada.
        ring(4, "3004", "")
        calls.onCallState(4, CallState.DISCONNECTED, 487)
        telecom.createConnection(4)
        clock.advance(10_000)
        assertEquals(listOf(1, 2), gateway.answers)
        // Ligado só depois de o celular tocar: vale para a próxima.
        settings = settings.copy(autoAnswer = false)
        ring(5, "3005", "")
        telecom.createConnection(5)
        settings = settings.copy(autoAnswer = true)
        clock.advance(10_000)
        assertEquals(listOf(1, 2), gateway.answers)
        assertTrue(calls.isRinging(5))
    }

    @Test
    fun `auto answer answers the only ringing call after the chosen seconds`() {
        settings = CallSettings(autoAnswer = true, autoAnswerSeconds = 3)
        ring(1)
        clock.advance(1_000)
        calls.onIncoming(2, "3002", "")   // outra, com a 1 tocando: ocupado, e a 1 continua sozinha
        assertEquals(listOf(2), gateway.rejects)
        clock.advance(1_999)
        assertTrue("2999 ms: ainda não", gateway.answers.isEmpty())
        assertEquals(CallPhase.RINGING, calls.state.value?.phase)
        clock.advance(1)
        assertEquals(listOf(1), gateway.answers)
        assertTrue("o toque para", 1 in notifier.stopped)
        assertEquals(CallPhase.CONNECTING, calls.state.value?.phase)
        calls.onCallState(1, CallState.CONFIRMED, 200)
        assertEquals(CallPhase.ACTIVE, calls.state.value?.phase)
        assertEquals(listOf(1), telecom.active)
        clock.advance(30_000)
        assertEquals("uma vez só", listOf(1), gateway.answers)
    }

    @Test
    fun `auto answer na hora answers at once`() {
        settings = CallSettings(autoAnswer = true, autoAnswerSeconds = 0)
        calls.onIncoming(1, "3001", "Cliente Teste")   // o Telecom a recebe e cria a Connection na hora: ela toca
        assertTrue("não dentro dos avisos: na próxima volta do relógio", gateway.answers.isEmpty())
        assertEquals(listOf(Triple(1, "3001", "Cliente Teste")), telecom.incoming)
        clock.advance(0)
        assertEquals(listOf(1), gateway.answers)
        assertEquals(CallPhase.CONNECTING, calls.state.value?.phase)
    }

    @Test
    fun `auto answer skips a second call`() {
        settings = CallSettings(autoAnswer = true)
        ring(1)
        clock.advance(3_000)
        assertEquals(listOf(1), gateway.answers)
        calls.onCallState(1, CallState.CONFIRMED, 200)
        ring(2, "3002", "Fulano")   // a segunda, com a 1 em andamento: toca normalmente
        assertEquals(SecondUi(2, "3002", "Fulano", SecondKind.RINGING), calls.state.value?.second)
        // A primeira acaba antes do tempo, e a segunda fica sozinha, tocando: ninguém a atende sozinho (ele se decide
        // quando o celular começa a tocar).
        clock.advance(1_000)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertTrue(calls.isRinging(2))
        clock.advance(60_000)
        assertEquals("a segunda não é atendida sozinha", listOf(1), gateway.answers)
        assertTrue(calls.isRinging(2))
    }

    @Test
    fun `do not disturb wins over auto answer`() {
        settings = CallSettings(doNotDisturb = true, autoAnswer = true, autoAnswerSeconds = 0)
        calls.onIncoming(1, "3001", "")
        clock.advance(5_000)
        assertTrue(gateway.answers.isEmpty())
        assertEquals("ocupado", listOf(1), gateway.rejects)
        assertEquals(listOf(true), notifier.missedSilent)
        calls.onCallState(1, CallState.DISCONNECTED, 486)
        // Ligado durante a contagem: a que toca continua tocando, e ninguém a atende sozinho.
        settings = CallSettings(autoAnswer = true)
        ring(2, "3002", "")
        clock.advance(1_000)
        settings = settings.copy(doNotDisturb = true)
        clock.advance(10_000)
        assertTrue("o Não perturbe vale mais", gateway.answers.isEmpty())
        assertTrue("ela continua tocando", calls.isRinging(2))
        assertEquals(listOf(1), gateway.rejects)
    }

    @Test
    fun `auto answer never answers a call that stopped ringing`() {
        settings = CallSettings(autoAnswer = true)   // 3 s
        // Atendida à mão antes do tempo.
        ring(1)
        clock.advance(1_000)
        answerCall(1)
        clock.advance(10_000)
        assertEquals("só o toque da pessoa", listOf(1), gateway.answers)
        calls.hangup()
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        // Atendida à mão, e uma segunda chega antes do tempo da primeira: ninguém atende sozinho.
        ring(2, "3002", "")
        clock.advance(1_000)
        answerCall(2)
        clock.advance(1_000)
        ring(3, "3003", "")
        clock.advance(10_000)
        assertEquals(listOf(1, 2), gateway.answers)
        assertTrue(calls.isRinging(3))
        calls.reject()
        calls.onCallState(3, CallState.DISCONNECTED, 486)
        calls.hangup()
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        // Recusada antes do tempo.
        ring(4, "3004", "")
        clock.advance(1_000)
        calls.reject()
        clock.advance(5_000)
        calls.onCallState(4, CallState.DISCONNECTED, 486)
        assertEquals(listOf(1, 2), gateway.answers)
        // Quem ligou desistiu antes do tempo, e outra chega sozinha logo depois: a contagem é a dela.
        ring(5, "3005", "")
        clock.advance(1_000)
        calls.onCallState(5, CallState.DISCONNECTED, 487)
        clock.advance(1_000)
        ring(6, "3006", "")
        clock.advance(2_999)
        assertEquals("o tempo da que desistiu não vale para a nova", listOf(1, 2), gateway.answers)
        clock.advance(1)
        assertEquals(listOf(1, 2, 6), gateway.answers)
        calls.onCallState(6, CallState.DISCONNECTED, 200)
        // Sair durante a contagem.
        ring(7, "3007", "")
        clock.advance(1_000)
        calls.onLogout()
        clock.advance(5_000)
        assertEquals(listOf(1, 2, 6), gateway.answers)
    }

    @Test
    fun `auto answer switched off while the call rings does not answer it`() {
        settings = CallSettings(autoAnswer = true)
        ring(1)
        clock.advance(1_000)
        settings = settings.copy(autoAnswer = false)
        clock.advance(10_000)
        assertTrue(gateway.answers.isEmpty())
        assertTrue("ela continua tocando", calls.isRinging(1))
        // Ligado de novo com ela tocando: vale para a próxima.
        settings = settings.copy(autoAnswer = true)
        clock.advance(10_000)
        assertTrue(gateway.answers.isEmpty())
    }

    @Test
    fun `auto answer never starts during a carrier call`() {
        settings = CallSettings(autoAnswer = true)
        telecom.permitted = false   // uma ligação da operadora em andamento
        calls.onIncoming(1, "3001", "Cliente Teste")
        clock.advance(5_000)
        assertTrue(gateway.answers.isEmpty())
        assertEquals("o ocupado de hoje", listOf(1), gateway.rejects)
        assertTrue(telecom.incoming.isEmpty())
        assertNull(calls.state.value)
        assertEquals(listOf("Ligação perdida de 3001"), notifier.missed)
        assertEquals("com som: o Não perturbe está desligado", listOf(false), notifier.missedSilent)
    }

    // A recebida mostra quando o Atender automático vai atendê-la (R7 e R33): o tempo marcado e quando o celular começou a
    // tocar, só enquanto as regras dele valem para ela com as configurações de agora (a tela cheia e a notificação).

    @Test
    fun `the ringing call shows when auto answer will answer it`() {
        settings = CallSettings(autoAnswer = true, autoAnswerSeconds = 3)
        telecom.createsConnections = false
        ring(1)
        assertNull("o celular ainda não toca", calls.state.value?.autoAnswerSeconds)
        assertNull(calls.autoAnswerSeconds(1))
        clock.advance(500)
        telecom.createConnection(1)
        val rang = clock.nowMillis()
        assertEquals(3, calls.state.value?.autoAnswerSeconds)
        assertEquals("a contagem começa quando o celular toca", rang, calls.state.value?.autoAnswerSinceMillis)
        assertEquals("a notificação pergunta pelo id", 3, calls.autoAnswerSeconds(1))
        assertNull("outra ligação", calls.autoAnswerSeconds(2))
        // O Não perturbe ligado na contagem: ninguém a atende sozinho, e a linha sai; desligado antes da hora, ela volta.
        clock.advance(1_000)
        settings = settings.copy(doNotDisturb = true)
        calls.onSettingsChanged()
        assertNull(calls.state.value?.autoAnswerSeconds)
        assertNull(calls.autoAnswerSeconds(1))
        settings = settings.copy(doNotDisturb = false)
        calls.onSettingsChanged()
        assertEquals(3, calls.state.value?.autoAnswerSeconds)
        assertEquals("a contagem de quando tocou", rang, calls.state.value?.autoAnswerSinceMillis)
        // O Atender automático desligado e ligado de novo antes da hora.
        settings = settings.copy(autoAnswer = false)
        calls.onSettingsChanged()
        assertNull(calls.state.value?.autoAnswerSeconds)
        settings = settings.copy(autoAnswer = true)
        calls.onSettingsChanged()
        assertEquals(3, calls.state.value?.autoAnswerSeconds)
        // Outro tempo escolhido na contagem vale para a próxima: a linha mostra o marcado, o que vai valer.
        settings = settings.copy(autoAnswerSeconds = 10)
        calls.onSettingsChanged()
        assertEquals(3, calls.state.value?.autoAnswerSeconds)
        assertEquals(3, calls.autoAnswerSeconds(1))
        clock.advance(1_999)
        assertTrue("2999 ms depois de tocar: ainda não", gateway.answers.isEmpty())
        clock.advance(1)
        assertEquals(listOf(1), gateway.answers)
        assertNull("atendida: a linha sai", calls.state.value?.autoAnswerSeconds)
        assertNull(calls.autoAnswerSeconds(1))
        assertEquals(0L, calls.state.value?.autoAnswerSinceMillis)
    }

    @Test
    fun `auto answer shows na hora and never shows for a second call`() {
        settings = CallSettings(autoAnswer = true, autoAnswerSeconds = 0)
        calls.onIncoming(1, "3001", "Cliente Teste")   // o Telecom cria a Connection na hora: ela toca
        assertEquals("R32: na hora", 0, calls.state.value?.autoAnswerSeconds)
        assertEquals(0, calls.autoAnswerSeconds(1))
        clock.advance(0)
        assertEquals(listOf(1), gateway.answers)
        assertNull(calls.state.value?.autoAnswerSeconds)
        calls.onCallState(1, CallState.CONFIRMED, 200)
        // A segunda, com a primeira em andamento, toca normalmente: nem a tela nem a notificação falam do Atender
        // automático.
        ring(2, "3002", "Fulano")
        assertNull(calls.state.value?.autoAnswerSeconds)
        assertEquals(SecondKind.RINGING, calls.state.value?.second?.kind)
        assertNull(calls.autoAnswerSeconds(2))
        // A primeira acaba e a segunda fica sozinha, tocando: ninguém a atende sozinho, e a linha não aparece.
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertEquals(CallPhase.RINGING, calls.state.value?.phase)
        assertEquals(2, calls.state.value?.id)
        assertNull(calls.state.value?.autoAnswerSeconds)
        assertNull(calls.autoAnswerSeconds(2))
        calls.onSettingsChanged()
        assertNull(calls.state.value?.autoAnswerSeconds)
        assertTrue("a notificação da segunda nunca ganha a linha", notifier.autoAnswer.none { it.first == 2 })
    }

    // O microfone (spec 12): com o app fechado, o Android pode não deixar o app usar o microfone. O Atender automático o
    // pede antes de atender; sem ele, a recebida continua tocando, e a pessoa ainda atende à mão.

    @Test
    fun `auto answer keeps the call ringing when Android refuses the microphone`() {
        settings = CallSettings(autoAnswer = true, autoAnswerSeconds = 3)
        microphone = CallMicrophone { ready -> ready(false) }
        ring(1)
        clock.advance(2_999)
        assertEquals("nada pedido antes da hora", 0, microphoneRequests)
        clock.advance(1)
        assertEquals(1, microphoneRequests)
        assertTrue("não atendeu", gateway.answers.isEmpty())
        assertTrue("continua tocando", calls.isRinging(1))
        assertTrue("o toque continua", 1 !in notifier.stopped)
        assertNull("a linha sai: ela não vai ser atendida sozinha", calls.state.value?.autoAnswerSeconds)
        assertNull(calls.autoAnswerSeconds(1))
        clock.advance(30_000)
        assertTrue(gateway.answers.isEmpty())
        assertEquals("uma vez só", 1, microphoneRequests)
        // A pessoa atende à mão.
        answerCall(1)
        assertEquals(listOf(1), gateway.answers)
        assertEquals(CallPhase.ACTIVE, calls.state.value?.phase)
    }

    @Test
    fun `auto answer waits for the microphone and answers only the call still ringing alone`() {
        settings = CallSettings(autoAnswer = true, autoAnswerSeconds = 3)
        val pending = mutableListOf<(Boolean) -> Unit>()
        microphone = CallMicrophone { ready -> pending += ready }
        // O Android deixa: ela é atendida quando a resposta chega.
        ring(1)
        clock.advance(3_000)
        assertEquals(1, pending.size)
        assertTrue("esperando o Android", gateway.answers.isEmpty())
        assertEquals("ainda vai ser atendida", 3, calls.state.value?.autoAnswerSeconds)
        pending.removeAt(0)(true)
        assertEquals(listOf(1), gateway.answers)
        calls.onCallState(1, CallState.CONFIRMED, 200)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        // Atendida à mão enquanto o Android responde: a resposta não atende de novo.
        ring(2, "3002", "")
        clock.advance(3_000)
        answerCall(2)
        pending.removeAt(0)(true)
        assertEquals(listOf(1, 2), gateway.answers)
        calls.hangup()
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        // Quem ligou desistiu enquanto o Android responde: nada.
        ring(3, "3003", "")
        clock.advance(3_000)
        calls.onCallState(3, CallState.DISCONNECTED, 487)
        pending.removeAt(0)(true)
        assertEquals(listOf(1, 2), gateway.answers)
        // O Não perturbe ligado enquanto o Android responde: vale o Não perturbe, e ela continua tocando.
        ring(4, "3004", "")
        clock.advance(3_000)
        settings = settings.copy(doNotDisturb = true)
        pending.removeAt(0)(true)
        assertEquals(listOf(1, 2), gateway.answers)
        assertTrue(calls.isRinging(4))
        assertNull(calls.state.value?.autoAnswerSeconds)
        assertTrue("nada mais pedido", pending.isEmpty())
        assertEquals("a notificação perde a linha", 4 to null, notifier.autoAnswer.last())
    }

    // A notificação da recebida (R38): a linha do Atender automático nela segue a decisão dele. Cada mudança vai ao
    // notificador uma vez (que posta a notificação de novo, sem alertar), e nunca a cada segundo.

    @Test
    fun `the incoming notification follows the auto answer decision once per change`() {
        settings = CallSettings(autoAnswer = true, autoAnswerSeconds = 30)
        microphone = CallMicrophone { ready -> ready(false) }
        ring(1)
        assertEquals("o celular toca: vai atender em 30 s", listOf(1 to 30), notifier.autoAnswer)
        clock.advance(5_000)
        assertEquals("nada a cada segundo", listOf(1 to 30), notifier.autoAnswer)
        settings = settings.copy(autoAnswer = false)
        calls.onSettingsChanged()
        assertEquals("desligado: não vai atender", listOf(1 to 30, 1 to null), notifier.autoAnswer)
        settings = settings.copy(endBeep = false)
        calls.onSettingsChanged()
        assertEquals("outra configuração: nada", 2, notifier.autoAnswer.size)
        settings = settings.copy(autoAnswer = true)
        calls.onSettingsChanged()
        settings = settings.copy(doNotDisturb = true)
        calls.onSettingsChanged()
        settings = settings.copy(doNotDisturb = false)
        calls.onSettingsChanged()
        assertEquals(listOf(1 to 30, 1 to null, 1 to 30, 1 to null, 1 to 30), notifier.autoAnswer)
        // Na hora, o Android não deixa o microfone (spec 12): ela continua tocando, e a notificação perde a linha.
        clock.advance(25_000)
        assertTrue("continua tocando", calls.isRinging(1))
        assertEquals(listOf(1 to 30, 1 to null, 1 to 30, 1 to null, 1 to 30, 1 to null), notifier.autoAnswer)
        // Depois disso, nada mais: nem as configurações, nem o tempo, nem atender à mão.
        settings = settings.copy(doNotDisturb = true)
        calls.onSettingsChanged()
        settings = settings.copy(doNotDisturb = false)
        calls.onSettingsChanged()
        clock.advance(10_000)
        answerCall(1)
        assertEquals(6, notifier.autoAnswer.size)
    }

    // O bipe no fim (spec 9): a atendida que acaba sem outra de pé toca o bipe, e a Connection dela só sai do Telecom
    // quando ele acaba (o bipe toca no som da ligação).

    @Test
    fun `an answered call that ends beeps once and then disconnects`() {
        endBeep = beep
        // A outra pessoa desliga.
        ring(1)
        answerCall(1)
        clock.advance(10_000)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertEquals(1, beep.dones.size)
        assertTrue("a Connection espera o bipe", telecom.disconnected.isEmpty())
        assertNull("a tela fecha na hora", calls.state.value)
        assertEquals("os Recentes na hora", CallKind.RECEBIDA, recents.list().single().kind)
        beep.dones[0]()
        assertEquals(listOf(1 to EndCause.REMOTE), telecom.disconnected)
        // A ligação cai (a feita, atendida, com 408 depois de uma troca de rede).
        val id = dialOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        calls.onCallState(id, CallState.DISCONNECTED, 408)
        assertEquals(2, beep.dones.size)
        assertEquals(1, telecom.disconnected.size)
        beep.dones[1]()
        assertEquals(id to EndCause.ERROR, telecom.disconnected.last())
        // A própria pessoa desliga.
        ring(3, "3003", "")
        answerCall(3)
        calls.hangup()
        calls.onCallState(3, CallState.DISCONNECTED, 200)
        assertEquals(3, beep.dones.size)
        assertEquals(2, telecom.disconnected.size)
        beep.dones[2]()
        assertEquals(listOf(1 to EndCause.REMOTE, id to EndCause.ERROR, 3 to EndCause.LOCAL), telecom.disconnected)
        assertEquals("um bipe por ligação", 3, beep.dones.size)
    }

    @Test
    fun `a rejected, missed or unanswered call never beeps`() {
        endBeep = beep
        ring(1)
        calls.reject()
        calls.onCallState(1, CallState.DISCONNECTED, 486)   // recusada
        ring(2, "3002", "")
        calls.onCallState(2, CallState.DISCONNECTED, 487)   // perdida: quem ligou desistiu
        ring(3, "3003", "")
        calls.answer()
        calls.onCallState(3, CallState.DISCONNECTED, 487)   // atendida aqui, mas não completou
        val busy = dialOut("486")
        calls.onCallState(busy, CallState.DISCONNECTED, 486)   // a feita que não completou
        assertTrue(beep.dones.isEmpty())
        assertEquals(
            "todas saem do Telecom na hora",
            listOf(1 to EndCause.REJECTED, 2 to EndCause.MISSED, 3 to EndCause.REMOTE, busy to EndCause.BUSY),
            telecom.disconnected,
        )
    }

    @Test
    fun `no beep while another call remains, one when the last answered call ends`() {
        endBeep = beep
        ring(1)
        answerCall(1)
        ring(2, "3002", "Fulano")
        answerCall(2)   // a 1 em espera
        calls.onCallState(2, CallState.DISCONNECTED, 200)   // a 2 acaba, e a 1 volta sozinha
        assertTrue("sobra a 1: sem bipe", beep.dones.isEmpty())
        assertEquals(listOf(2 to EndCause.REMOTE), telecom.disconnected)
        // A que acaba com outra tocando também não bipa.
        ring(3, "3003", "")
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertTrue(beep.dones.isEmpty())
        assertEquals(listOf(2 to EndCause.REMOTE, 1 to EndCause.REMOTE), telecom.disconnected)
        // A 3, atendida, é a última: o bipe.
        answerCall(3)
        calls.onCallState(3, CallState.DISCONNECTED, 200)
        assertEquals(1, beep.dones.size)
        assertEquals(2, telecom.disconnected.size)
        beep.dones[0]()
        assertEquals(3 to EndCause.REMOTE, telecom.disconnected.last())
        // Duas que acabam juntas (o Desligar da conferência): um bipe só, e as duas saem do Telecom depois dele.
        ring(4, "3004", "")
        answerCall(4)
        val id = dialOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        calls.join()
        calls.hangup()
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        calls.onCallState(4, CallState.DISCONNECTED, 200)
        assertEquals("um bipe só", 2, beep.dones.size)
        assertEquals("as duas esperam o bipe", 3, telecom.disconnected.size)
        beep.dones[1]()
        assertEquals(listOf(id to EndCause.LOCAL, 4 to EndCause.LOCAL), telecom.disconnected.drop(3))
    }

    @Test
    fun `no beep with the setting off`() {
        endBeep = beep
        settings = CallSettings(endBeep = false)
        ring(1)
        answerCall(1)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        assertTrue(beep.dones.isEmpty())
        assertEquals("sai do Telecom na hora", listOf(1 to EndCause.REMOTE), telecom.disconnected)
    }

    @Test
    fun `no beep after Sair`() {
        endBeep = beep
        ring(1)
        answerCall(1)
        calls.onLogout()
        assertTrue(beep.dones.isEmpty())
        assertEquals("sai do Telecom na hora", listOf(1 to EndCause.LOCAL), telecom.disconnected)
        calls.onCallState(1, CallState.DISCONNECTED, 200)   // o fim que chega depois é ignorado
        assertTrue(beep.dones.isEmpty())
        assertEquals(1, telecom.disconnected.size)
    }

    @Test
    fun `no beep for a call held by a carrier call`() {
        endBeep = beep
        ring(1)
        answerCall(1)
        calls.holdFromTelecom(1)   // uma ligação da operadora atendida: o som é dela
        calls.onCallState(1, CallState.DISCONNECTED, 200)   // quem ligou desliga, com a 1 em espera pelo Telecom
        assertTrue("nada de bipe no meio da ligação da operadora", beep.dones.isEmpty())
        assertEquals("sai do Telecom na hora", listOf(1 to EndCause.REMOTE), telecom.disconnected)
        // Retomada pelo Telecom (a da operadora acabou), o som volta a ser nosso: o bipe toca.
        ring(2, "3002", "")
        answerCall(2)
        calls.holdFromTelecom(2)
        calls.activateFromTelecom(2)
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        assertEquals(1, beep.dones.size)
        beep.dones[0]()
        // Na espera da própria pessoa, o som é nosso: o bipe também toca.
        ring(3, "3003", "")
        answerCall(3)
        calls.hold(true)
        calls.onCallState(3, CallState.DISCONNECTED, 200)
        assertEquals(2, beep.dones.size)
        beep.dones[1]()
        assertEquals(listOf(1 to EndCause.REMOTE, 2 to EndCause.REMOTE, 3 to EndCause.REMOTE), telecom.disconnected)
    }

    @Test
    fun `the end beep never holds the Connection more than 1500 ms`() {
        endBeep = beep   // o done só roda quando o teste o chama
        // O done se perde: a Connection sai 1,5 s depois do fim.
        ring(1)
        answerCall(1)
        calls.onCallState(1, CallState.DISCONNECTED, 200)
        clock.advance(1_499)
        assertTrue("ainda espera o bipe", telecom.disconnected.isEmpty())
        clock.advance(1)
        assertEquals(listOf(1 to EndCause.REMOTE), telecom.disconnected)
        beep.dones[0]()   // o done atrasado: nada
        assertEquals(1, telecom.disconnected.size)
        // O done chega antes: o limite sai, e nada desliga de novo.
        ring(2, "3002", "")
        answerCall(2)
        calls.onCallState(2, CallState.DISCONNECTED, 200)
        clock.advance(800)
        beep.dones[1]()
        assertEquals(2 to EndCause.REMOTE, telecom.disconnected.last())
        assertEquals("o limite foi desmarcado", 0, clock.pending)
        clock.advance(5_000)
        assertEquals(2, telecom.disconnected.size)
        // Duas que acabam juntas, e o done se perde: as duas saem no limite do primeiro fim, uma vez cada.
        ring(3, "3003", "")
        answerCall(3)
        val id = dialOut("2002")
        calls.onCallState(id, CallState.CONFIRMED, 200)
        calls.join()
        calls.hangup()
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        clock.advance(500)
        calls.onCallState(3, CallState.DISCONNECTED, 200)
        clock.advance(999)
        assertEquals(2, telecom.disconnected.size)
        clock.advance(1)
        assertEquals(listOf(id to EndCause.LOCAL, 3 to EndCause.LOCAL), telecom.disconnected.drop(2))
        beep.dones[2]()
        assertEquals(4, telecom.disconnected.size)
        // Sair durante o bipe não corta a espera, e o limite continua valendo.
        ring(4, "3004", "")
        answerCall(4)
        calls.onCallState(4, CallState.DISCONNECTED, 200)
        calls.onLogout()
        clock.advance(1_499)
        assertEquals(4, telecom.disconnected.size)
        clock.advance(1)
        assertEquals(4 to EndCause.REMOTE, telecom.disconnected.last())
        assertEquals("um fim por Connection", 5, telecom.disconnected.size)
        assertEquals(4, beep.dones.size)
    }

    @Test
    fun `a call during the end beep is not delayed or blocked`() {
        endBeep = beep
        ring(1)
        answerCall(1)
        calls.onCallState(1, CallState.DISCONNECTED, 200)   // o bipe começa, e a Connection da 1 espera por ele
        // Uma feita durante o bipe liga na hora.
        val id = dialOut("2002")
        assertEquals(listOf("2002"), telecom.placed)
        assertEquals(listOf("2002"), gateway.made)
        calls.onCallState(id, CallState.CONFIRMED, 200)
        assertEquals(CallPhase.ACTIVE, calls.state.value?.phase)
        assertEquals(listOf(1, id), telecom.active)
        assertTrue("a 1 ainda espera o bipe", telecom.disconnected.isEmpty())
        beep.dones[0]()
        assertEquals("a Connection da 1 sai, e só ela", listOf(1 to EndCause.REMOTE), telecom.disconnected)
        assertEquals(id, calls.state.value?.id)
        assertEquals(CallPhase.ACTIVE, calls.state.value?.phase)
        // Uma recebida durante o bipe da feita vai ao Telecom e toca na hora.
        calls.onCallState(id, CallState.DISCONNECTED, 200)
        assertEquals(2, beep.dones.size)
        ring(2, "3002", "Fulano")
        assertEquals(Triple(2, "3002", "Fulano"), telecom.incoming.last())
        assertTrue(calls.isRinging(2))
        answerCall(2)
        assertEquals(CallPhase.ACTIVE, calls.state.value?.phase)
        beep.dones[1]()
        assertEquals(listOf(1 to EndCause.REMOTE, id to EndCause.REMOTE), telecom.disconnected)
        assertEquals(CallPhase.ACTIVE, calls.state.value?.phase)
        assertEquals(listOf(1, id, 2), telecom.active)
    }

    @Test
    fun `the end beep's late disconnect never reaches a newer call`() {
        endBeep = beep
        ring(1)
        answerCall(1)
        calls.onCallState(1, CallState.DISCONNECTED, 200)   // o bipe da 1 começa
        // Durante o bipe, o Telecom pede o fim da Connection da 1 (o fone Bluetooth) e a pessoa sai da conta: nada sai
        // antes do fim do bipe (a Connection segue com o som da ligação até lá, e o fim dela é um só).
        calls.hangup(1)
        calls.onLogout()
        assertTrue(telecom.disconnected.isEmpty())
        assertTrue(gateway.hangups.isEmpty())
        // Entrar de novo e ligar, ainda no bipe: ele acaba com a feita ainda sem o id do motor (a Connection dela é a
        // que ganharia o id de um fim desconhecido).
        calls.onLogin()
        gateway.duringMakeCall = { beep.dones.single()() }
        val id = dialOut("2002")
        gateway.duringMakeCall = null
        assertEquals("o fim é o da Connection da 1", listOf(1 to EndCause.REMOTE), telecom.disconnected)
        beep.dones.single()()   // o done repetido (o fim do som e o limite de 1,5 s): nada
        assertEquals(listOf(1 to EndCause.REMOTE), telecom.disconnected)
        // A feita segue.
        calls.onCallState(id, CallState.CONFIRMED, 200)
        assertEquals(
            CallUi(id, "2002", "", incoming = false, phase = CallPhase.ACTIVE, activeSinceMillis = clock.nowMillis()),
            calls.state.value,
        )
        assertEquals(listOf(1, id), telecom.active)
        assertEquals(listOf(1 to EndCause.REMOTE), telecom.disconnected)
    }

    // Outra thread tenta usar o CallManager por até 1 s: true se não conseguiu (a trava estava presa).
    private fun lockedOut(): Boolean {
        val other = thread { calls.isRinging(1) }
        other.join(1_000)
        return other.isAlive
    }
}
