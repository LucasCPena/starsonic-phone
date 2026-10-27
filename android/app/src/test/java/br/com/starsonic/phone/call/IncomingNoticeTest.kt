package br.com.starsonic.phone.call

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * R41: a notificação da recebida quando a decisão do Atender automático muda. A que toca nunca é postada de novo: uma
 * atualização com o "alertar uma vez só" cala o toque que se repete (o BuzzBeepBlinkTest.testNoisyOnceUpdateDoesCancelAudio
 * do AOSP) e, sem ele, ela alerta de novo; a linha dela pode ficar velha (a tela cheia mostra a de agora). A silenciada pelo
 * volume, que não toca, é postada de novo uma vez a cada mudança; a chamada em espera nunca tem a linha.
 */
class IncomingNoticeTest {
    @Test
    fun `a ringing notification is never posted again when the decision changes`() {
        val ringing = ShownIncoming(callId = 1, ringing = true, waiting = false, autoAnswerSeconds = 30)
        for (seconds in listOf(null, 0, 10)) {
            assertFalse("a que toca, com a decisão $seconds", repostsForAutoAnswer(ringing, 1, seconds))
        }
        val without = ringing.copy(autoAnswerSeconds = null)
        assertFalse("a que toca sem a linha, com a decisão 30", repostsForAutoAnswer(without, 1, 30))
    }

    @Test
    fun `a silenced notification is posted again once per change`() {
        val silenced = ShownIncoming(callId = 1, ringing = false, waiting = false, autoAnswerSeconds = 30)
        assertTrue("perde a linha", repostsForAutoAnswer(silenced, 1, null))
        assertTrue("na hora", repostsForAutoAnswer(silenced, 1, 0))
        assertFalse("a mesma decisão", repostsForAutoAnswer(silenced, 1, 30))
        val without = silenced.copy(autoAnswerSeconds = null)
        assertTrue("ganha a linha", repostsForAutoAnswer(without, 1, 30))
        assertFalse("a mesma decisão, sem a linha", repostsForAutoAnswer(without, 1, null))
    }

    @Test
    fun `the waiting call, another call and no notification are never posted again`() {
        val waiting = ShownIncoming(callId = 1, ringing = false, waiting = true, autoAnswerSeconds = null)
        assertFalse("a chamada em espera", repostsForAutoAnswer(waiting, 1, 30))
        val silenced = ShownIncoming(callId = 1, ringing = false, waiting = false, autoAnswerSeconds = 30)
        assertFalse("a decisão de outra recebida", repostsForAutoAnswer(silenced, 2, null))
        assertFalse("nenhuma notificação", repostsForAutoAnswer(null, 1, null))
    }
}
