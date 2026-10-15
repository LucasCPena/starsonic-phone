package br.com.starsonic.phone.engine

/** O protocolo da conta: o Transport do núcleo (sem TLS no Android). */
enum class Transport { UDP, TCP }

/** Os estados de uma ligação em [EngineEvents.onCallState]: os valores do CallState do motor. */
object CallState {
    const val INCOMING = 0
    const val CALLING = 1
    const val EARLY = 2
    const val CONNECTING = 3
    const val CONFIRMED = 4
    const val DISCONNECTED = 5
}

/**
 * Os avisos do motor (EngineListener, starsonic/phone/SipEngine.h). Chegam numa thread do gateway, nunca
 * na principal, um de cada vez e na ordem em que aconteceram; quem recebe pode chamar o gateway. Depois de
 * [SipGateway.stop] só chegam as linhas de log do motor saindo.
 */
interface EngineEvents {
    /**
     * Cada resposta do registro, com o id da conta ([SipGateway.setAccount]): (200, true) registrou ou
     * renovou; (200, false) a conta saiu ([SipGateway.removeAccount], com o id da que saiu; não é um
     * registro); 4xx a 6xx falhou; sem resposta do servidor, 503 ou 408. Uma resposta de uma conta anterior
     * ainda pode chegar depois da troca, com o id dela: quem espera o resultado de uma conta confere o id.
     */
    fun onRegistration(code: Int, active: Boolean, accountId: Int)

    /** Chegou uma ligação, que toca: o número de quem liga e o nome de exibição (pode ser vazio). */
    fun onIncomingCall(callId: Int, remoteUser: String, remoteName: String)

    /** Chegou uma ligação com outra em andamento: o motor já respondeu 486 (Ocupado). */
    fun onRejectedBusy(remoteUser: String, remoteName: String)

    /** A ligação mudou de estado ([CallState]); code é o último código SIP dela. DISCONNECTED é o último. */
    fun onCallState(callId: Int, state: Int, code: Int)

    /** Uma linha do log do motor; level como no PJSIP (1 erro, 2 aviso, 3 informação, 4 detalhe). Sem senhas. */
    fun onLog(level: Int, line: String)
}

/**
 * O motor de ligações (SipEngine) para o app. Toda chamada ao motor roda numa thread só do gateway, na
 * ordem em que foi pedida. As que devolvem valor ([start], [setAccount], [makeCall] e [hasCall]) esperam o
 * motor e não podem ser chamadas da thread principal ([start] e [setAccount] podem levar segundos); as
 * outras só põem o pedido na fila e voltam na hora (o resultado chega pelos [EngineEvents]).
 */
interface SipGateway {
    /** Sobe o motor com o User-Agent e o perfil (o texto do perfil.ini); false se não subiu (o motivo vai ao log). */
    fun start(userAgent: String, profileText: String, events: EngineEvents): Boolean

    /** Desliga a ligação, tira a conta do servidor e desliga o motor. Daqui em diante, nenhum evento. */
    fun stop()

    /**
     * Troca a conta e registra. Devolve o id da conta (> 0, maior que o de todas as anteriores), que vem em
     * cada onRegistration dela; 0: o motor recusou a conta (não há conta, e nada chega).
     */
    fun setAccount(address: String, transport: Transport, ramal: String, senha: String): Int

    /** Tira a conta do servidor e do motor; no fim chega onRegistration(200, false, <id da conta que saiu>). */
    fun removeAccount()

    /** Renova o registro agora. */
    fun reregister()

    /** A rede mudou: o motor refaz os transportes e registra de novo. */
    fun handleIpChange()

    /** Liga para o número (já sem separadores); o id da ligação, ou -1 se não ligou. */
    fun makeCall(number: String): Int

    fun answer(id: Int)

    /** Recusa com Ocupado (486) a ligação que está tocando. */
    fun reject(id: Int)

    fun hangup(id: Int)

    fun setHold(id: Int, hold: Boolean)

    fun setMute(mute: Boolean)

    fun sendDtmf(id: Int, digits: String)

    fun transfer(id: Int, number: String)

    /** Há uma ligação (tocando, chamando ou em andamento). */
    fun hasCall(): Boolean
}
