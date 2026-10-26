package br.com.starsonic.phone.call

import kotlin.math.abs
import kotlin.math.sign
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * O som do bipe do fim (spec 9) na JVM ([endBeepPcm]): 425 Hz por 0,25 s, 0,15 s de silêncio e 425 Hz por mais 0,25 s,
 * com 5 ms de subida e de descida em cada toque.
 */
class EndBeepToneTest {
    @Test
    fun `the beep is 650 ms long at the given rate`() {
        for (rate in RATES) {
            assertEquals("$rate Hz", rate * 65 / 100, endBeepPcm(rate).size)
        }
    }

    @Test
    fun `the tone parts are 425 Hz`() {
        for (rate in RATES) {
            val pcm = endBeepPcm(rate)
            for (start in toneStarts(rate)) {
                // Duas trocas de sinal por ciclo, em 0,25 s.
                val hertz = zeroCrossings(pcm, start, start + rate / 4) / 2.0 / 0.25
                assertEquals("$rate Hz, a parte em $start", 425.0, hertz, 425.0 * 0.02)
            }
        }
    }

    @Test
    fun `the gap is silent`() {
        for (rate in RATES) {
            val gap = endBeepPcm(rate).copyOfRange(rate / 4, rate / 4 + rate * 15 / 100)
            assertEquals(rate * 15 / 100, gap.size)
            assertTrue("$rate Hz", gap.all { it == 0.toShort() })
        }
    }

    @Test
    fun `each tone fades in and out in 5 ms`() {
        val rate = 16_000
        val pcm = endBeepPcm(rate)
        val fade = rate / 200
        for (start in toneStarts(rate)) {
            val end = start + rate / 4
            assertEquals("começa do zero", 0, pcm[start].toInt())
            assertEquals("acaba no zero", 0, pcm[end - 1].toInt())
            val full = peak(pcm, start + fade, end - fade)
            assertTrue("o toque soa", full > 1_000)
            assertTrue("a subida", peak(pcm, start, start + fade / 4) < full / 3)
            assertTrue("a descida", peak(pcm, end - fade / 4, end) < full / 3)
        }
    }

    // O começo de cada um dos dois toques, em amostras.
    private fun toneStarts(rate: Int) = listOf(0, rate / 4 + rate * 15 / 100)

    // As trocas de sinal entre [from] e [to] (os zeros não contam: a subida e a descida passam por eles).
    private fun zeroCrossings(pcm: ShortArray, from: Int, to: Int): Int {
        var crossings = 0
        var last = 0
        for (i in from until to) {
            val sign = pcm[i].toInt().sign
            if (sign == 0) continue
            if (last != 0 && sign != last) crossings++
            last = sign
        }
        return crossings
    }

    private fun peak(pcm: ShortArray, from: Int, to: Int): Int = (from until to).maxOf { abs(pcm[it].toInt()) }

    private companion object {
        // As de sempre (a do app é 16 kHz): nelas, as partes de 0,25 s e de 0,15 s têm um número inteiro de amostras.
        val RATES = listOf(8_000, 16_000, 44_100, 48_000)
    }
}
