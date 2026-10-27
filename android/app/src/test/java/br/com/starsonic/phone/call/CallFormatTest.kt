package br.com.starsonic.phone.call

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * O que as telas da ligação e a notificação da recebida escrevem (spec 5, 7 e 10, os quadros Chamada, DuasLigacoes e
 * Recebida; R32, R33 e R35): o tempo da ligação, o estado dela, o título da recebida, a linha do Atender automático (a da
 * tela cheia, que conta os segundos, e a da notificação, com o tempo escolhido), o número embaixo do nome ("Ramal <n>"
 * num ramal) e a linha de baixo dos cartões.
 */
class CallFormatTest {
    private companion object {
        const val NBSP = '\u00A0'   // o espaço que não quebra
    }

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
        assertEquals("Atender automático · em\u00A03\u00A0s", autoAnswerIn(3))
        assertEquals("Atender automático · em\u00A01\u00A0s", autoAnswerIn(1))
        assertEquals("Atender automático · em\u00A030\u00A0s", autoAnswerIn(30))
        assertEquals("R32: com 0 s, na hora", "Atender automático · na\u00A0hora", autoAnswerIn(0))
    }

    @Test
    fun `em, the seconds and s stay together, and so does na hora`() {
        // R40: "em <n> s" (e o "na hora") com espaços que não quebram: com a letra grande, a linha quebra antes do "em",
        // nunca entre ele, o número e o "s". O que aparece é o texto do spec 10.
        assertEquals("Atender automático · em 23 s", autoAnswerIn(23).replace(NBSP, ' '))
        assertEquals("Atender automático · na hora", autoAnswerIn(0).replace(NBSP, ' '))
        assertEquals("só esses dois", 2, autoAnswerIn(23).count { it == NBSP })
        assertEquals("e esse", 1, autoAnswerIn(0).count { it == NBSP })
        assertEquals("a contagem também", "em${NBSP}2${NBSP}s", autoAnswerCountdown(3, 0, 1_000).substringAfterLast(' '))
    }

    @Test
    fun `the full screen counts the auto answer down each second from when the phone rings`() {
        val rang = 1_000_000L
        assertEquals("Atender automático · em\u00A03\u00A0s", autoAnswerCountdown(3, rang, rang))
        assertEquals("Atender automático · em\u00A03\u00A0s", autoAnswerCountdown(3, rang, rang + 999))
        assertEquals("Atender automático · em\u00A02\u00A0s", autoAnswerCountdown(3, rang, rang + 1_000))
        assertEquals("Atender automático · em\u00A02\u00A0s", autoAnswerCountdown(3, rang, rang + 1_999))
        assertEquals("Atender automático · em\u00A01\u00A0s", autoAnswerCountdown(3, rang, rang + 2_000))
        assertEquals("Atender automático · em\u00A01\u00A0s", autoAnswerCountdown(3, rang, rang + 2_999))
        // Na hora de atender (o atender ainda não chegou à tela), nada de "em 0 s".
        assertEquals("Atender automático · em\u00A01\u00A0s", autoAnswerCountdown(3, rang, rang + 3_000))
        assertEquals("Atender automático · em\u00A01\u00A0s", autoAnswerCountdown(3, rang, rang + 60_000))
        assertEquals(
            "um relógio que voltou não passa do tempo escolhido",
            "Atender automático · em\u00A03\u00A0s",
            autoAnswerCountdown(3, rang, rang - 5_000),
        )
        assertEquals("Atender automático · em\u00A030\u00A0s", autoAnswerCountdown(30, rang, rang + 400))
        assertEquals("Atender automático · em\u00A028\u00A0s", autoAnswerCountdown(30, rang, rang + 2_100))
        assertEquals("R32", "Atender automático · na\u00A0hora", autoAnswerCountdown(0, rang, rang + 500))
    }

    @Test
    fun `the incoming notification shows the number and the auto answer line once`() {
        assertEquals("o número embaixo do nome, como hoje", "3001", incomingNotificationText("3001", "Cliente Teste", null))
        assertNull("sem nome, o título já é o número", incomingNotificationText("3001", "", null))
        assertNull(incomingNotificationText("3001", "  ", null))
        assertEquals(
            "3001 · Atender automático · em\u00A03\u00A0s",
            incomingNotificationText("3001", "Cliente Teste", 3),
        )
        assertEquals("Atender automático · em\u00A03\u00A0s", incomingNotificationText("3001", "", 3))
        assertEquals("R32", "3001 · Atender automático · na\u00A0hora", incomingNotificationText("3001", "Cliente Teste", 0))
    }

    @Test
    fun `a ramal reads as Ramal and any other number as it is, as on Windows`() {
        // R35: o contactNumberLine do Windows (windows/ui/src/format.ts): de 2 a 6 dígitos, "Ramal <número>".
        assertEquals("Ramal 2003", contactNumberLine("2003"))
        assertEquals("Ramal 20", contactNumberLine("20"))
        assertEquals("Ramal 123456", contactNumberLine("123456"))
        assertEquals("sem os espaços em volta", "Ramal 2003", contactNumberLine(" 2003 "))
        assertEquals("um dígito", "7", contactNumberLine("7"))
        assertEquals("sete dígitos", "1234567", contactNumberLine("1234567"))
        assertEquals("(11) 98888-7777", contactNumberLine("(11) 98888-7777"))
        assertEquals("+5511988887777", contactNumberLine("+5511988887777"))
        assertEquals("*21", contactNumberLine("*21"))
        assertEquals("2003a", contactNumberLine("2003a"))
        assertEquals("os outros ficam como vieram", " 98888 7777", contactNumberLine(" 98888 7777"))
        assertEquals("", contactNumberLine(""))
    }

    @Test
    fun `a card of two calls shows the number next to the time`() {
        assertEquals("R35: o ramal", "Ramal 3001 · 00:12", cardLine("3001", "Cliente Teste", "00:12"))
        assertEquals("(11) 98888-7777 · 00:48", cardLine("(11) 98888-7777", "Carlos Lima", "00:48"))
        assertEquals("sem nome, o número já é o título", "00:12", cardLine("2002", "", "00:12"))
        assertEquals("Chamando…", cardLine("2002", "", "Chamando…"))
        assertEquals("sem o tempo (a conferência), só o número", "Ramal 3001", cardLine("3001", "Cliente Teste", ""))
        assertEquals("", cardLine("2002", "", ""))
    }
}
