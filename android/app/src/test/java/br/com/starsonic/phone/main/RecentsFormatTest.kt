package br.com.starsonic.phone.main

import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * O que as linhas do Recentes escrevem, como no app do Windows (o canvas): o grupo do dia, a hora, a duração e o título
 * (o nome com o ramal).
 */
class RecentsFormatTest {
    private val zone = ZoneId.of("America/Sao_Paulo")

    // Agora: 26/10/2026, 14:32, em São Paulo.
    private val now = at(2026, 10, 26, 14, 32)

    private fun at(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long =
        ZonedDateTime.of(year, month, day, hour, minute, 0, 0, zone).toInstant().toEpochMilli()

    @Test
    fun `today and yesterday name the group and older days show the date`() {
        assertEquals("Hoje", dayGroup(at(2026, 10, 26, 0, 0), now, zone))
        assertEquals("Hoje", dayGroup(at(2026, 10, 26, 14, 31), now, zone))
        assertEquals("Ontem", dayGroup(at(2026, 10, 25, 23, 59), now, zone))
        assertEquals("Ontem", dayGroup(at(2026, 10, 25, 0, 0), now, zone))
        assertEquals("24 de outubro", dayGroup(at(2026, 10, 24, 23, 59), now, zone))
        assertEquals("de outro ano, com o ano", "31 de dezembro de 2025", dayGroup(at(2025, 12, 31, 18, 0), now, zone))
    }

    @Test
    fun `the time of the call is the clock time`() {
        assertEquals("14:32", clockTime(at(2026, 10, 26, 14, 32), zone))
        assertEquals("09:05", clockTime(at(2026, 10, 25, 9, 5), zone))
    }

    @Test
    fun `the duration reads in hours, minutes and seconds`() {
        assertEquals("35 s", recentDuration(35))
        assertEquals("1 min 02 s", recentDuration(62))
        assertEquals("12 min 40 s", recentDuration(760))
        assertEquals("1 h 00 min", recentDuration(3_600))
        assertEquals("1 h 05 min", recentDuration(3_930))
    }

    @Test
    fun `the title shows the name with the ramal`() {
        assertEquals("Marcos Lima · 2005", recentTitle("2005", "Marcos Lima"))
        assertEquals("um número longo fica de fora", "Carlos Lima", recentTitle("(11) 98888-7777", "Carlos Lima"))
        assertEquals("sem nome, o número", "(11) 5060-3000", recentTitle("(11) 5060-3000", ""))
        assertEquals("3001", recentTitle("3001", ""))
    }
}
