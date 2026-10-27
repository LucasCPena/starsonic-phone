package br.com.starsonic.phone.call

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * O fim do bipe no AudioTrack (R43) na JVM ([endBeepTimes]): a marca um pouco antes do último quadro (num AudioTrack
 * estático, a marca no último quadro, em alguns celulares, só chega quando o som falta, e o done vinha do limite de 1,5 s,
 * com a linha falsa "o som não acabou" no diagnóstico), e o done depois do resto do som e da folga, como antes.
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

    private companion object {
        val RATES = listOf(8_000, 16_000, 44_100, 48_000)
    }
}
