package br.com.starsonic.phone.service

/** Um wake lock parcial: segura o processador acordado (a tela apaga normalmente). */
interface CpuLock {
    fun acquire()

    fun release()
}

/**
 * O processador acordado com a conta conectada (decisão 6 da spec; seção 7.2, item 6). Com a tela apagada, o
 * Android põe o processador para dormir mesmo com o serviço em primeiro plano, e aí a renovação do registro e
 * o keep-alive param. Por isso [lock] fica preso enquanto o serviço está com a conta gravada ([setAccount]), há rede
 * ([setOnline]) e a conta tem um registro a manter ([setRenewing]). Sem rede não há registro a manter; depois de uma
 * recusa que o pjsua não repete (a senha recusada, um 404...), também não: nada acontece sozinho até a rede mudar, o
 * serviço adotar outra conta ou o próximo Entrar. Depois de [close] (o serviço parou), nada o prende de novo: um aviso
 * atrasado da rede, de um resultado do registro ou de uma conta lida antes da parada não conta.
 *
 * Qualquer thread; o wake lock é pego e solto na hora, dentro da chamada (na volta da rede, ou com um REGISTER novo a
 * caminho, antes de o motor mandá-lo).
 */
class KeepAwake(private val lock: CpuLock) {
    private val guard = Any()
    private var account = false
    private var online = true   // até o NetworkMonitor dizer o contrário (como a Connection)
    private var renewing = true   // até a Connection dizer o contrário
    private var closed = false
    private var held = false

    /** O processador está seguro acordado. */
    val isHeld: Boolean
        get() = synchronized(guard) { held }

    /** O serviço está (ou não) com a conta gravada. */
    fun setAccount(has: Boolean) = update { account = has }

    /**
     * O que a conexão fez com a conta gravada ([Connection.adopt]). Só o serviço que parou no meio
     * ([Adoption.STOPPED]) fica sem ela. Recusada pelo motor ([Adoption.REFUSED]), a conta continua com o serviço, e a
     * conexão pode registrá-la depois sozinha, sem avisar o serviço (quando uma tentativa da tela Entrar deixa o
     * motor vazio): o processador fica acordado, para essa conta não ficar registrada com ele dormindo.
     */
    fun setAdoption(adoption: Adoption) = setAccount(adoption != Adoption.STOPPED)

    /** Há (ou não) rede. */
    fun setOnline(online: Boolean) = update { this.online = online }

    /**
     * A conta do serviço tem (ou não) um registro a manter ([Connection.claim]): registrada, à espera de uma resposta,
     * ou numa falha que o pjsua repete sozinho (aí o processador fica acordado, para a nova tentativa acontecer). false
     * depois de uma recusa que o pjsua não repete.
     */
    fun setRenewing(renewing: Boolean) = update { this.renewing = renewing }

    /** O serviço parou: o processador volta a dormir, de vez. */
    fun close() = update { closed = true }

    private fun update(change: () -> Unit) {
        synchronized(guard) {
            change()
            val wanted = account && online && renewing && !closed
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
