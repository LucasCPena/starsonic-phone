package br.com.starsonic.phone.call

import br.com.starsonic.phone.core.Check
import br.com.starsonic.phone.core.Clock
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.Manifest
import br.com.starsonic.phone.core.Scheduled
import br.com.starsonic.phone.engine.EngineEvents
import br.com.starsonic.phone.engine.SipGateway
import br.com.starsonic.phone.engine.Transport

/**
 * O núcleo falso, com marcadores no lugar das regras (as de verdade são testadas no núcleo e no NativeLoadTest):
 * o aviso de fim é "fim <código>" de 400 a 699, e nada para o 487 e para tudo fora de 400 a 699, como no contrato
 * do CallEndMessage (starsonic/core/CallMessages.h); o número a discar vem de [DIAL], e o que não está lá fica
 * como veio; o número de um contato fica como veio, e o perfil dá o ddi 55 sem prefixo externo.
 */
internal class CallCore : CoreRules {
    override fun validateServer(raw: String): Pair<Check, String> = Check.OK to raw

    override fun validateRamal(raw: String): Pair<Check, String> = Check.OK to raw

    override fun registrationMessage(code: Int) = ""

    override fun callEndMessage(code: Int): String = if (code in 400..699 && code != 487) "fim $code" else ""

    override fun normalizeDialString(raw: String): String = DIAL[raw] ?: raw

    override fun contactDialString(raw: String, ddi: String, prefix: String) = raw

    override fun profileDial(profileText: String) = "55" to ""

    override fun parseManifest(json: String, allowedPrefix: String, onError: (String) -> Unit): Manifest? = null

    override fun compareVersions(a: String, b: String) = 0

    companion object {
        /** O exemplo do brief e o número da transferência dos testes. */
        val DIAL = mapOf("+55 (11) 5060-3000" to "+551150603000", " 20-03 " to "2003")
    }
}

/**
 * O motor falso das ligações: anota os pedidos. makeCall devolve [nextCallId] (e o próximo sobe); [duringMakeCall]
 * roda dentro dele, antes de ele voltar (um evento do motor que chega antes). callCount() devolve [callCount], que o
 * teste ajusta.
 */
internal class CallGateway : SipGateway {
    val made = mutableListOf<String>()
    val answers = mutableListOf<Int>()
    val rejects = mutableListOf<Int>()
    val hangups = mutableListOf<Int>()
    val holds = mutableListOf<Pair<Int, Boolean>>()
    val activated = mutableListOf<Int>()
    val mutes = mutableListOf<Boolean>()
    val dtmfs = mutableListOf<Pair<Int, String>>()
    val transfers = mutableListOf<Pair<Int, String>>()

    /** As transferências com consulta: (o cliente, o colega). */
    val attended = mutableListOf<Pair<Int, Int>>()

    /** As conferências pedidas e as desfeitas: (id, otherId), na ordem dos argumentos. */
    val joined = mutableListOf<Pair<Int, Int>>()
    val split = mutableListOf<Pair<Int, Int>>()
    var callCount = 0
    var nextCallId = 10
    var refuse = false
    var duringMakeCall: ((Int) -> Unit)? = null

    override fun start(userAgent: String, profileText: String, events: EngineEvents) = true

    override fun stop() {}

    override fun setAccount(address: String, transport: Transport, ramal: String, senha: String) = 1

    override fun removeAccount() {}

    override fun reregister() {}

    override fun handleIpChange() {}

    override fun makeCall(number: String): Int {
        made += number
        if (refuse) return -1
        val id = nextCallId++
        duringMakeCall?.invoke(id)
        return id
    }

    override fun answer(id: Int) {
        answers += id
    }

    override fun reject(id: Int) {
        rejects += id
    }

    override fun hangup(id: Int) {
        hangups += id
    }

    override fun setHold(id: Int, hold: Boolean) {
        holds += id to hold
    }

    override fun activate(id: Int) {
        activated += id
    }

    override fun setMute(mute: Boolean) {
        mutes += mute
    }

    override fun sendDtmf(id: Int, digits: String) {
        dtmfs += id to digits
    }

    override fun transfer(id: Int, number: String) {
        transfers += id to number
    }

    override fun transferAttended(id: Int, targetId: Int) {
        attended += id to targetId
    }

    override fun join(id: Int, otherId: Int) {
        joined += id to otherId
    }

    override fun split(id: Int, otherId: Int) {
        split += id to otherId
    }

    override fun hasCall() = false

    override fun callCount() = callCount
}

/** O Telecom falso: anota o que o CallManager pediu. */
internal class FakeTelecom : TelecomAdapter {
    var permitted = true
    val incoming = mutableListOf<Triple<Int, String, String>>()
    val placed = mutableListOf<String>()
    val active = mutableListOf<Int>()
    val disconnected = mutableListOf<Pair<Int, Int>>()

    override fun incomingPermitted() = permitted

    override fun addIncoming(callId: Int, number: String, name: String) {
        incoming += Triple(callId, number, name)
    }

    override fun placeOutgoing(number: String) {
        placed += number
    }

    override fun setActive(callId: Int) {
        active += callId
    }

    override fun disconnect(callId: Int, cause: Int) {
        disconnected += callId to cause
    }
}

/** As notificações falsas. */
internal class FakeNotifier : CallNotifier {
    val missed = mutableListOf<String>()
    val stopped = mutableListOf<Int>()

    override fun showMissed(text: String) {
        missed += text
    }

    override fun stopRinging(callId: Int) {
        stopped += callId
    }
}

/** O relógio falso: só anda com [advance], que roda na hora os avisos vencidos. */
internal class CallClock(private var now: Long = 1_000_000L) : Clock {
    private class Task(val at: Long, val action: () -> Unit)

    private val tasks = mutableListOf<Task>()

    override fun nowMillis() = now

    override fun schedule(delayMillis: Long, action: () -> Unit): Scheduled {
        val task = Task(now + delayMillis, action)
        tasks += task
        return Scheduled { tasks.remove(task) }
    }

    fun advance(millis: Long) {
        now += millis
        while (true) {
            val due = tasks.filter { it.at <= now }.minByOrNull { it.at } ?: return
            tasks.remove(due)
            due.action()
        }
    }
}
