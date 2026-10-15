package br.com.starsonic.phone.service

import br.com.starsonic.phone.core.Check
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.engine.EngineEvents
import br.com.starsonic.phone.engine.SipGateway
import br.com.starsonic.phone.engine.Transport

/** O núcleo falso: o aviso do registro como o do núcleo (401, 403 e 407; nada de 100 a 299). */
internal class FakeCore : CoreRules {
    override fun validateServer(raw: String): Pair<Check, String> = Check.OK to raw

    override fun validateRamal(raw: String): Pair<Check, String> = Check.OK to raw

    override fun registrationMessage(code: Int): String = when (code) {
        in 100..299 -> ""
        401, 403, 407 -> "Ramal ou senha incorretos."
        else -> "registro $code"
    }

    override fun callEndMessage(code: Int) = ""

    override fun normalizeDialString(raw: String) = raw
}

/**
 * O motor falso: cada conta recebe um id (1, 2, 3...), como no motor de verdade; a saída de uma conta
 * avisa (200, false) com o id dela. Os resultados do registro chegam à mão, por [registration].
 */
internal class FakeEngine : SipGateway {
    var starts = 0
    val accounts = mutableListOf<Account>()
    var lastId = 0
    var removals = 0
    var ipChanges = 0
    private var events: EngineEvents? = null
    private var current = 0   // o id da conta que está no motor (0: nenhuma)

    /** Roda dentro do setAccount, antes de ele voltar com o id (um aviso do motor que chega antes). */
    var duringSetAccount: ((Int) -> Unit)? = null

    /** Um resultado do registro da conta [id] (a última, se nada for dito). */
    fun registration(code: Int, active: Boolean, id: Int = lastId) {
        events!!.onRegistration(code, active, id)
    }

    override fun start(userAgent: String, profileText: String, events: EngineEvents): Boolean {
        starts++
        this.events = events
        return true
    }

    override fun stop() {}

    override fun setAccount(address: String, transport: Transport, ramal: String, senha: String): Int {
        accounts += Account(address, transport, ramal, senha)
        val id = ++lastId
        current = id
        duringSetAccount?.invoke(id)
        return id
    }

    override fun removeAccount() {
        removals++
        val id = current
        current = 0
        if (id > 0) events?.onRegistration(200, false, id)
    }

    override fun reregister() {}

    override fun handleIpChange() {
        ipChanges++
    }

    override fun makeCall(number: String) = -1

    override fun answer(id: Int) {}

    override fun reject(id: Int) {}

    override fun hangup(id: Int) {}

    override fun setHold(id: Int, hold: Boolean) {}

    override fun setMute(mute: Boolean) {}

    override fun sendDtmf(id: Int, digits: String) {}

    override fun transfer(id: Int, number: String) {}

    override fun hasCall() = false
}
