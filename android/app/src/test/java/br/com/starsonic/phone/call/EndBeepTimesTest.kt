package br.com.starsonic.phone.call

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * O fim do bipe no AudioTrack (R43) na JVM ([endBeepTimes] e [endBeepPlayed]): a marca um pouco antes do último quadro
 * (num AudioTrack estático, a marca no último quadro, em alguns celulares, só chega quando o som falta, e o done vinha do
 * limite de 1,5 s, com a linha falsa "o som não acabou" no diagnóstico), o done depois do resto do som e da folga, como
 * antes, e o fim pelo tempo, bem antes do limite, para o bipe que tocou sem dar a marca; o som parado fica para o limite.
 */
class EndBeepTimesTest {
    @Test
    fun `the marker comes a few frames before the last one`() {
        for (rate in RATES) {
            val frames = endBeepPcm(rate).size
            val early = frames - endBeepTimes(frames, rate).markerFrame
            assertTrue("$rate Hz: a marca $early quadros antes do fim (pelo menos 1 ms)", early >= rate / 1000)
            assertTrue("$rate Hz: a marca $early quadros antes do fim (no máximo 20 ms)", early <= rate * 20 / 1000)
        }
    }

    @Test
    fun `the done comes after the rest of the sound and the tail, as before`() {
        for (rate in RATES) {
            val frames = endBeepPcm(rate).size
            val times = endBeepTimes(frames, rate)
            // 650 ms de som e os 200 ms de folga, contados do começo do som.
            val doneMillis = times.markerFrame * 1000.0 / rate + times.afterMarkerMillis
            assertEquals("$rate Hz", 850.0, doneMillis, 1.0)
        }
    }

    @Test
    fun `a beep that played without the marker ends by the timed end, well before the cap`() {
        for (rate in RATES) {
            val times = endBeepTimes(endBeepPcm(rate).size, rate)
            // A conferência vem com o som e a folga (850 ms depois do play), e o done, uma folga depois: antes do limite,
            // com folga para um começo atrasado.
            assertEquals("$rate Hz", 850L, times.timedEndMillis)
            assertTrue("$rate Hz: o fim pelo tempo antes do limite", times.timedEndMillis + times.afterMarkerMillis <= END_BEEP_MAX_MILLIS - 400)
        }
    }

    @Test
    fun `the timed end counts a beep that stopped a few frames short of the end as played, and a stalled one as not`() {
        for (rate in RATES) {
            val frames = endBeepPcm(rate).size
            val times = endBeepTimes(frames, rate)
            assertTrue("$rate Hz: no fim", endBeepPlayed(frames, times))
            assertTrue("$rate Hz: parado 8 quadros antes do fim (o reamostrador)", endBeepPlayed(frames - 8, times))
            assertTrue("$rate Hz: na marca", endBeepPlayed(times.markerFrame, times))
            assertFalse("$rate Hz: no meio", endBeepPlayed(frames / 2, times))
            assertFalse("$rate Hz: parado no começo", endBeepPlayed(0, times))
        }
    }

    private companion object {
        val RATES = listOf(8_000, 16_000, 44_100, 48_000)
    }
}
