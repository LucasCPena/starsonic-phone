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

    /**
     * O resultado de [SipGateway.transfer] ou de [SipGateway.transferAttended] na ligação, uma vez por pedido que o
     * motor aceitou: o código do NOTIFY quando o servidor aceitou o REFER (202), senão o da resposta ao REFER. Com 2xx o
     * motor desliga a ligação (e, na consulta, também a do colega) logo depois, com os DISCONNECTED de sempre; fora de
     * 2xx nada mais muda. Não chega se a ligação acaba antes do resultado.
     */
    fun onTransfer(callId: Int, code: Int)

    /** Uma linha do log do motor; level como no PJSIP (1 erro, 2 aviso, 3 informação, 4 detalhe). Sem senhas. */
    fun onLog(level: Int, line: String)
}

/**
 * O motor de ligações (SipEngine) para o app. Toda chamada ao motor roda numa thread só do gateway, na
 * ordem em que foi pedida. As que devolvem valor ([start], [setAccount], [makeCall], [hasCall] e [callCount])
 * esperam o motor e não podem ser chamadas da thread principal ([start] e [setAccount] podem levar segundos); as
 * outras só põem o pedido na fila e voltam na hora (o resultado chega pelos [EngineEvents]).
 *
 * Até duas ligações, uma delas a ativa (a única com o som); a outra fica em espera. Na conferência ([join]), as
 * duas ficam com o som e se ouvem.
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

    /**
     * A ligação vira a ativa: a outra vai para a espera, e ela é retomada se estava em espera. Já ativa, nada muda; na
     * conferência, é o [split] dela com a outra. Ligação desconhecida ou ainda não confirmada: nada muda.
     */
    fun activate(id: Int)

    fun setMute(mute: Boolean)

    fun sendDtmf(id: Int, digits: String)

    /** Transfere a ligação para o número (REFER); o resultado chega por [EngineEvents.onTransfer]. */
    fun transfer(id: Int, number: String)

    /**
     * A transferência com consulta: REFER com Replaces na ligação [id] (o cliente) apontando para a [targetId] (o
     * colega), para o outro lado ligar um ao outro. O resultado chega por [EngineEvents.onTransfer] com o [id]; com 2xx
     * o motor desliga as duas. Ligação desconhecida ou não confirmada, ou ids iguais: nada acontece (e nada chega).
     */
    fun transferAttended(id: Int, targetId: Int)

    /**
     * A conferência a três, aqui no celular: a que está em espera é retomada, e as duas ficam com o som e se ouvem.
     * Nenhuma é a ativa: o [activate] de uma delas desfaz a conferência. Se uma acaba, a outra segue como a ativa. Não
     * começa com ligação desconhecida ou não confirmada, ids iguais ou uma transferência com consulta em andamento.
     */
    fun join(id: Int, otherId: Int)

    /** Desfaz a conferência: [otherId] vai para a espera, e [id] fica a ativa. Fora dela, é o [activate] de [id]. */
    fun split(id: Int, otherId: Int)

    /** Há uma ligação (tocando, chamando ou em andamento). */
    fun hasCall(): Boolean

    /**
     * Quantas ligações há no motor (tocando, chamando ou em andamento): 0, 1 ou 2. A conta cai antes de o DISCONNECTED
     * da ligação chegar pelos [EngineEvents]: quem acompanha as ligações pelos eventos não a usa logo depois de um pedido.
     */
    fun callCount(): Int
}
