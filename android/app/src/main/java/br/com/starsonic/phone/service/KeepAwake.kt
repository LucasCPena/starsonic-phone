package br.com.starsonic.phone.service

/** Um wake lock parcial: segura o processador acordado (a tela apaga normalmente). */
interface CpuLock {
    fun acquire()

    fun release()
}

/**
 * O processador acordado com a conta conectada (decisão 6 da spec; seção 7.2, item 6). Com a tela apagada, o
 * Android põe o processador para dormir mesmo com o serviço em primeiro plano, e aí a renovação do registro e
 * o keep-alive param. Por isso [lock] fica preso enquanto o serviço está com a conta gravada ([setAccount]) e
 * há rede ([setOnline]); sem rede não há registro a manter. Depois de [close] (o serviço parou), nada o
 * prende de novo: um aviso atrasado da rede ou de uma conta lida antes da parada não conta.
 *
 * Qualquer thread; o wake lock é pego e solto na hora, dentro da chamada (na volta da rede, antes de o motor
 * pôr o novo registro na fila).
 */
class KeepAwake(private val lock: CpuLock) {
    private val guard = Any()
    private var account = false
    private var online = true   // até o NetworkMonitor dizer o contrário (como a Connection)
    private var closed = false
    private var held = false

    /** O processador está seguro acordado. */
    val isHeld: Boolean
        get() = synchronized(guard) { held }

    /** O serviço está (ou não) com a conta gravada. */
    fun setAccount(has: Boolean) = update { account = has }

    /** O que a conexão fez com a conta gravada. Esboço: como antes, solta na recusa. */
    fun setAdoption(adoption: Adoption) = setAccount(adoption != Adoption.STOPPED && adoption != Adoption.REFUSED)

    /** Há (ou não) rede. */
    fun setOnline(online: Boolean) = update { this.online = online }

    /** O serviço parou: o processador volta a dormir, de vez. */
    fun close() = update { closed = true }

    private fun update(change: () -> Unit) {
        synchronized(guard) {
            change()
            val wanted = account && online && !closed
            if (wanted && !held) {
                lock.acquire()
                held = true
            } else if (!wanted && held) {
                lock.release()
                held = false
            }
        }
    }
}
