package br.com.starsonic.phone.call

/**
 * A notificação da recebida que está lá, para a decisão do Atender automático: a ligação dela ([callId]), se ela toca
 * ([ringing]: no canal "ligacoes", com o toque que se repete), se é a chamada em espera ([waiting]) e os segundos do
 * Atender automático que o texto dela mostra ([autoAnswerSeconds]; null: nenhum).
 */
data class ShownIncoming(val callId: Int, val ringing: Boolean, val waiting: Boolean, val autoAnswerSeconds: Int?)

/**
 * R38: a decisão do Atender automático sobre a recebida [callId] mudou para [seconds] (null: não vai atender). A
 * notificação [shown] (null: nenhuma) é postada de novo, uma vez, se é a dela, não é a chamada em espera (que nunca tem
 * a linha) e mostra outra decisão.
 */
fun repostsForAutoAnswer(shown: ShownIncoming?, callId: Int, seconds: Int?): Boolean =
    shown != null && shown.callId == callId && !shown.waiting && shown.autoAnswerSeconds != seconds
