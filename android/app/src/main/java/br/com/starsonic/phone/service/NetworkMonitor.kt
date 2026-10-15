package br.com.starsonic.phone.service

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import br.com.starsonic.phone.engine.SipGateway
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * A rede padrão do celular (spec 7.2): quando ela muda (Wi-Fi ↔ 4G, ou uma rede nova depois de ficar sem
 * nenhuma), o motor refaz os transportes e o registro ([SipGateway.handleIpChange], que só põe na fila);
 * sem rede, [online] fica false (o status mostra "Sem internet"). [onOnline] ouve o mesmo na hora, dentro do
 * aviso do Android: no começo ([begin]) e a cada mudança.
 *
 * [start] liga o monitor ao Android (ConnectivityManager.registerDefaultNetworkCallback); [begin],
 * [onAvailable] e [onLost] são os avisos dele, abertos para os testes (a rede é qualquer objeto: no app, o
 * android.net.Network). Os avisos do Android chegam numa thread dele, nunca na principal.
 */
class NetworkMonitor(private val gateway: SipGateway, private val onOnline: (Boolean) -> Unit = {}) {
    private val mutableOnline = MutableStateFlow(true)

    /** Há rede (false: "Sem internet"). */
    val online: StateFlow<Boolean> = mutableOnline

    // A trava guarda a rede padrão de agora (null: nenhuma) e o registro no Android.
    private val lock = Any()
    private var network: Any? = null
    private var manager: ConnectivityManager? = null
    private var callback: ConnectivityManager.NetworkCallback? = null

    /** O começo: a rede padrão de agora (null: sem rede). O aviso dela que o Android manda em seguida não é uma troca. */
    fun begin(network: Any?) {
        synchronized(lock) {
            this.network = network
            mutableOnline.value = network != null
        }
        onOnline(network != null)
    }

    /**
     * A rede padrão passou a ser [network]: outra que a de antes (ou a volta da rede) refaz o registro. Na volta
     * da rede, [onOnline] vem antes: o serviço segura o processador antes de o motor pôr o registro na fila.
     */
    fun onAvailable(network: Any) {
        var cameBack = false
        val changed = synchronized(lock) {
            val changed = network != this.network
            cameBack = !mutableOnline.value
            this.network = network
            mutableOnline.value = true
            changed
        }
        if (cameBack) onOnline(true)
        if (changed) gateway.handleIpChange()
    }

    /** A rede padrão [network] caiu sem outra no lugar (a de uma rede que já tinha saído não conta). */
    fun onLost(network: Any) {
        synchronized(lock) {
            if (network != this.network) return
            this.network = null
            mutableOnline.value = false
        }
        onOnline(false)
    }

    /** Passa a ouvir a rede padrão do celular (precisa de ACCESS_NETWORK_STATE). */
    fun start(context: Context) {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                this@NetworkMonitor.onAvailable(network)
            }

            override fun onLost(network: Network) {
                this@NetworkMonitor.onLost(network)
            }
        }
        begin(manager.activeNetwork)
        manager.registerDefaultNetworkCallback(callback)
        synchronized(lock) {
            this.manager = manager
            this.callback = callback
        }
    }

    /** Para de ouvir a rede. */
    fun stop() {
        val registered = synchronized(lock) {
            val manager = manager
            val callback = callback
            this.manager = null
            this.callback = null
            if (manager != null && callback != null) manager to callback else null
        } ?: return
        try {
            registered.first.unregisterNetworkCallback(registered.second)
        } catch (e: IllegalArgumentException) {
            // Já tinha saído: nada a fazer.
        }
    }
}
