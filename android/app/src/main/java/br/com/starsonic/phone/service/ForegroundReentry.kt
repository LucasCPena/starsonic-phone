package br.com.starsonic.phone.service

import br.com.starsonic.phone.call.CallUi

/**
 * Quando o [SipService] entra de novo em primeiro plano, e com que tipos, conforme a ligação muda (F1). [onCall] recebe
 * cada mudança da ligação e o tipo que o Android aceitou da última vez, e compara o que a ligação pede com ele (não com o
 * que o serviço pediu: o Android pode ter recusado o microfone):
 * - uma ligação que usa o microfone (a feita; a recebida depois de atendida) pede os tipos dela ([callTypes]: phoneCall e
 *   microphone, do mais completo ao de sempre). Se o aceito não é o primeiro deles, o serviço pede de novo: o Android
 *   recusou o microfone ao Atender automático (com o app fechado, spec 12), e a pessoa atendeu à mão, com o app na frente;
 * - sem ligação, os de sempre ([baseTypes]): se o aceito é outro, o serviço volta a eles, também depois de uma recebida que
 *   o Atender automático preparou (os tipos dela entram antes do atender) e que parou de tocar sem ser atendida;
 * - a recebida que toca, que ainda não usa o microfone, fica com os que estão: os de antes dela, os que o Atender
 *   automático acabou de pôr para atendê-la ou os da ligação que acabou (a segunda que sobrou tocando).
 *
 * O que a ligação pede é conferido só quando muda: o microfone recusado no meio de uma ligação não é pedido de novo a
 * cada mudança dela (o mudo, a espera); o próximo início do serviço (a tela de chamada o inicia ao aparecer) pede.
 * Só na thread principal.
 */
internal class ForegroundReentry(private val callTypes: () -> List<Int>, private val baseTypes: () -> List<Int>) {
    private var need: Need? = null   // o que a última ligação vista pedia (null: nenhuma vista ainda)

    /**
     * A ligação agora é [call] (null: nenhuma), e o Android aceitou [accepted] da última vez (null: nenhum ainda): os tipos
     * a pedir agora, do mais completo ao de sempre, ou null se nada muda.
     */
    fun onCall(call: CallUi?, accepted: Int?): List<Int>? {
        val now = when {
            call == null -> Need.NONE
            call.usesMicrophone -> Need.CALL
            else -> Need.RINGING
        }
        if (now == need) return null
        need = now
        val wanted = when (now) {
            Need.CALL -> callTypes()
            Need.NONE -> baseTypes()
            Need.RINGING -> return null
        }
        return if (accepted == wanted.first()) null else wanted
    }

    // O que a ligação pede do primeiro plano: nada (sem ligação), os que estão (a recebida que toca) ou os dela.
    private enum class Need { NONE, RINGING, CALL }
}
