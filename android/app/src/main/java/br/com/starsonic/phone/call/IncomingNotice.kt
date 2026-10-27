package br.com.starsonic.phone.call

/**
 * A notificação da recebida que está lá, para a decisão do Atender automático: a ligação dela ([callId]), se ela toca
 * ([ringing]: no canal "ligacoes", com o toque que se repete), se é a chamada em espera ([waiting]) e os segundos do
 * Atender automático que o texto dela mostra ([autoAnswerSeconds]; null: nenhum).
 */
data class ShownIncoming(val callId: Int, val ringing: Boolean, val waiting: Boolean, val autoAnswerSeconds: Int?)

/**
 * R41: a decisão do Atender automático sobre a recebida [callId] mudou para [seconds] (null: não vai atender). A
 * notificação [shown] (null: nenhuma) é postada de novo, uma vez, só se é a dela, não toca, não é a chamada em espera
 * (que nunca tem a linha) e mostra outra decisão. A que toca, nunca: uma atualização dela com o "alertar uma vez só" cala
 * o toque que se repete (o Android o para: o BuzzBeepBlinkTest.testNoisyOnceUpdateDoesCancelAudio do AOSP), e sem ele ela
 * alerta de novo. A linha dela pode ficar velha enquanto ela toca; a tela cheia mostra a de agora. A silenciada pelo
 * volume não toca: ela acompanha a decisão.
 */
fun repostsForAutoAnswer(shown: ShownIncoming?, callId: Int, seconds: Int?): Boolean =
    shown != null && shown.callId == callId && !shown.ringing && !shown.waiting && shown.autoAnswerSeconds != seconds
