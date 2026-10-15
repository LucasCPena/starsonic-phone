package br.com.starsonic.phone.service

import br.com.starsonic.phone.engine.SipGateway
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** A rede padrão do celular (stub). */
class NetworkMonitor(private val gateway: SipGateway) {
    private val mutableOnline = MutableStateFlow(true)

    val online: StateFlow<Boolean> = mutableOnline

    fun begin(network: Any?) {}

    fun onAvailable(network: Any) {}

    fun onLost(network: Any) {}
}
