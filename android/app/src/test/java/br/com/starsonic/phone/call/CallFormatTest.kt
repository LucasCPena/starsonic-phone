package br.com.starsonic.phone.call

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * O que as telas da ligação e a notificação da recebida escrevem (spec 5, 7 e 10, os quadros Chamada, DuasLigacoes e
 * Recebida; R32 e R33): o tempo da ligação, o estado dela, o título da recebida, a linha do Atender automático (a da tela
 * cheia, que conta os segundos, e a da notificação, com o tempo escolhido) e a linha de baixo dos cartões.
 */
class CallFormatTest {
    @Test
    fun `the call time reads as on Windows`() {
        assertEquals("00:00", callTimer(0))
        assertEquals("00:42", callTimer(42))
        assertEquals("03:12", callTimer(192))
        assertEquals("59:59", callTimer(3_599))
        assertEquals("de uma hora em diante, as horas na frente", "1:00:00", callTimer(3_600))
        assertEquals("1:02:03", callTimer(3_723))
        assertEquals("10:00:05", callTimer(36_005))
        assertEquals("um relógio que voltou não dá tempo negativo", "00:00", callTimer(-5))
    }

    @Test
    fun `the state of the call is calling, connecting or the time`() {
        val since = 1_000_000L
        assertEquals("Chamando…", callStatus(CallPhase.DIALING, 0, since))
        assertEquals("Conectando…", callStatus(CallPhase.CONNECTING, 0, since))
        assertEquals("00:00", callStatus(CallPhase.ACTIVE, since, since))
        assertEquals("03:12", callStatus(CallPhase.ACTIVE, since, since + 192_999))
        assertEquals("tocando, a recebida tem o título dela", "", callStatus(CallPhase.RINGING, 0, since))
    }

    @Test
    fun `the incoming call names the ramal`() {
        assertEquals("Ligação recebida · 2001", incomingTitle("2001"))
        assertEquals("sem o ramal", "Ligação recebida", incomingTitle(""))
    }

    @Test
    fun `the auto answer line names the chosen time`() {
        assertEquals("Atender automático · em 3 s", autoAnswerIn(3))
        assertEquals("Atender automático · em 1 s", autoAnswerIn(1))
        assertEquals("Atender automático · em 30 s", autoAnswerIn(30))
        assertEquals("R32: com 0 s, na hora", "Atender automático · na hora", autoAnswerIn(0))
    }

    @Test
    fun `the full screen counts the auto answer down each second from when the phone rings`() {
        val rang = 1_000_000L
        assertEquals("Atender automático · em 3 s", autoAnswerCountdown(3, rang, rang))
        assertEquals("Atender automático · em 3 s", autoAnswerCountdown(3, rang, rang + 999))
        assertEquals("Atender automático · em 2 s", autoAnswerCountdown(3, rang, rang + 1_000))
        assertEquals("Atender automático · em 2 s", autoAnswerCountdown(3, rang, rang + 1_999))
        assertEquals("Atender automático · em 1 s", autoAnswerCountdown(3, rang, rang + 2_000))
        assertEquals("Atender automático · em 1 s", autoAnswerCountdown(3, rang, rang + 2_999))
        // Na hora de atender (o atender ainda não chegou à tela), nada de "em 0 s".
        assertEquals("Atender automático · em 1 s", autoAnswerCountdown(3, rang, rang + 3_000))
        assertEquals("Atender automático · em 1 s", autoAnswerCountdown(3, rang, rang + 60_000))
        assertEquals(
            "um relógio que voltou não passa do tempo escolhido",
            "Atender automático · em 3 s",
            autoAnswerCountdown(3, rang, rang - 5_000),
        )
        assertEquals("Atender automático · em 30 s", autoAnswerCountdown(30, rang, rang + 400))
        assertEquals("Atender automático · em 28 s", autoAnswerCountdown(30, rang, rang + 2_100))
        assertEquals("R32", "Atender automático · na hora", autoAnswerCountdown(0, rang, rang + 500))
    }

    @Test
    fun `the incoming notification shows the number and the auto answer line once`() {
        assertEquals("o número embaixo do nome, como hoje", "3001", incomingNotificationText("3001", "Cliente Teste", null))
        assertNull("sem nome, o título já é o número", incomingNotificationText("3001", "", null))
        assertNull(incomingNotificationText("3001", "  ", null))
        assertEquals(
            "3001 · Atender automático · em 3 s",
            incomingNotificationText("3001", "Cliente Teste", 3),
        )
        assertEquals("Atender automático · em 3 s", incomingNotificationText("3001", "", 3))
        assertEquals("R32", "3001 · Atender automático · na hora", incomingNotificationText("3001", "Cliente Teste", 0))
    }

    @Test
    fun `a card of two calls shows the number next to the time`() {
        assertEquals("3001 · 00:12", cardLine("3001", "Cliente Teste", "00:12"))
        assertEquals("sem nome, o número já é o título", "00:12", cardLine("2002", "", "00:12"))
        assertEquals("Chamando…", cardLine("2002", "", "Chamando…"))
        assertEquals("sem o tempo (a conferência), só o número", "3001", cardLine("3001", "Cliente Teste", ""))
        assertEquals("", cardLine("2002", "", ""))
    }
}
