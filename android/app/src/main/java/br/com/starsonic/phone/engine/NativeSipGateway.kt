package br.com.starsonic.phone.engine

/** O [SipGateway] do app, pela ponte JNI de libstarsonic.so. */
class NativeSipGateway : SipGateway {
    override fun start(userAgent: String, profileText: String, events: EngineEvents): Boolean = false

    override fun stop() {}

    override fun setAccount(address: String, transport: Transport, ramal: String, senha: String): Boolean = false

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
