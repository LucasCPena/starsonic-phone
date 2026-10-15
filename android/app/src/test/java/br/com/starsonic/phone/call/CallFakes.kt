package br.com.starsonic.phone.call

import br.com.starsonic.phone.core.Check
import br.com.starsonic.phone.core.Clock
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.Scheduled
import br.com.starsonic.phone.engine.EngineEvents
import br.com.starsonic.phone.engine.SipGateway
import br.com.starsonic.phone.engine.Transport

/** O núcleo falso: o CallEndMessage e o NormalizeDialString com as regras do núcleo (CallMessages.cpp). */
internal class CallCore : CoreRules {
    override fun validateServer(raw: String): Pair<Check, String> = Check.OK to raw

    override fun validateRamal(raw: String): Pair<Check, String> = Check.OK to raw

    override fun registrationMessage(code: Int) = ""

    override fun callEndMessage(code: Int): String = when (code) {
        486, 600 -> "Ocupado"
        404, 484, 604 -> "Número não encontrado"
        408, 480 -> "Não atendeu"
        487 -> ""
        in 400..699 -> "Não foi possível completar a ligação (código $code)."
        else -> ""
    }

    override fun normalizeDialString(raw: String): String {
        val number = StringBuilder()
        for (ch in raw) {
            when (ch) {
                ' ', '\t', '-', '.', '(', ')' -> {}
                '+' -> if (number.isEmpty()) number.append(ch)
                else -> number.append(ch)
            }
        }
        return number.toString()
    }
}

/**
 * O motor falso das ligações: anota os pedidos. makeCall devolve [nextCallId] (e o próximo sobe); [duringMakeCall]
 * roda dentro dele, antes de ele voltar (um evento do motor que chega antes).
 */
internal class CallGateway : SipGateway {
    val made = mutableListOf<String>()
    val answers = mutableListOf<Int>()
    val rejects = mutableListOf<Int>()
    val hangups = mutableListOf<Int>()
    val holds = mutableListOf<Pair<Int, Boolean>>()
    val mutes = mutableListOf<Boolean>()
    val dtmfs = mutableListOf<Pair<Int, String>>()
    val transfers = mutableListOf<Pair<Int, String>>()
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

    override fun setMute(mute: Boolean) {
        mutes += mute
    }

    override fun sendDtmf(id: Int, digits: String) {
        dtmfs += id to digits
    }

    override fun transfer(id: Int, number: String) {
        transfers += id to number
    }

    override fun hasCall() = false
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
