package br.com.starsonic.phone.service

import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.engine.EngineEvents
import br.com.starsonic.phone.engine.SipGateway
import br.com.starsonic.phone.engine.Transport
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** A conexão do processo com o servidor (stub). */
class Connection(
    private val newEngine: () -> SipGateway,
    private val core: CoreRules,
    private val userAgent: String,
    private val profileText: () -> String,
    private val log: (Int, String) -> Unit = { _, _ -> },
) : SipGateway {
    private val mutableStatus = MutableStateFlow(Status("", ""))

    val status: StateFlow<Status> = mutableStatus

    @Volatile
    var loginEvents: ((Int, Boolean, Int) -> Unit)? = null

    fun ensureStarted(): Boolean = false

    fun claim(owner: Any) {}

    fun adopt(owner: Any, account: Account): Boolean = false

    fun release(owner: Any) {}

    fun setOnline(online: Boolean) {}

    override fun start(userAgent: String, profileText: String, events: EngineEvents): Boolean = false

    override fun stop() {}

    override fun setAccount(address: String, transport: Transport, ramal: String, senha: String): Int = 0

    override fun removeAccount() {}

    override fun reregister() {}

    override fun handleIpChange() {}

    override fun makeCall(number: String): Int = -1

    override fun answer(id: Int) {}

    override fun reject(id: Int) {}

    override fun hangup(id: Int) {}

    override fun setHold(id: Int, hold: Boolean) {}

    override fun setMute(mute: Boolean) {}

    override fun sendDtmf(id: Int, digits: String) {}

    override fun transfer(id: Int, number: String) {}

    override fun hasCall(): Boolean = false
}
