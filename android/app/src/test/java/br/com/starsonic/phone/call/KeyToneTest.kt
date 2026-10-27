package br.com.starsonic.phone.call

import android.media.AudioManager
import android.media.ToneGenerator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * O Bipe ao digitar na JVM: o tom de telefone de cada tecla ([keyTone], o mesmo do app de telefone do Android) e quando
 * ele toca ([keyTonePlays]): com a chave das Configurações ligada; fora da ligação, só com o celular no modo normal (no
 * silencioso e no só vibrando, nada); na ligação, em qualquer modo, porque o bipe sai junto com o som dela.
 */
class KeyToneTest {
    @Test
    fun `each key of the keypads plays its own phone tone`() {
        // As 12 teclas do Teclado e do teclado da ligação.
        val tones = mapOf(
            "1" to ToneGenerator.TONE_DTMF_1, "2" to ToneGenerator.TONE_DTMF_2, "3" to ToneGenerator.TONE_DTMF_3,
            "4" to ToneGenerator.TONE_DTMF_4, "5" to ToneGenerator.TONE_DTMF_5, "6" to ToneGenerator.TONE_DTMF_6,
            "7" to ToneGenerator.TONE_DTMF_7, "8" to ToneGenerator.TONE_DTMF_8, "9" to ToneGenerator.TONE_DTMF_9,
            "*" to ToneGenerator.TONE_DTMF_S, "0" to ToneGenerator.TONE_DTMF_0, "#" to ToneGenerator.TONE_DTMF_P,
        )
        assertEquals(tones, tones.keys.associateWith(::keyTone))
        assertEquals("um tom diferente para cada tecla", 12, tones.values.toSet().size)
    }

    @Test
    fun `anything that is not a key has no tone`() {
        for (other in listOf("", " ", "+", "A", "a", "12")) assertNull("\"$other\"", keyTone(other))
    }

    @Test
    fun `with the setting off no key beeps`() {
        for (mode in RINGER_MODES) {
            for (inCall in listOf(false, true)) {
                assertFalse("modo $mode, na ligação: $inCall", keyTonePlays(enabled = false, ringerMode = mode, inCall = inCall))
            }
        }
    }

    @Test
    fun `outside a call the keys beep only with the phone in normal mode`() {
        assertTrue("normal", keyTonePlays(enabled = true, ringerMode = AudioManager.RINGER_MODE_NORMAL, inCall = false))
        assertFalse("só vibrando", keyTonePlays(enabled = true, ringerMode = AudioManager.RINGER_MODE_VIBRATE, inCall = false))
        assertFalse("silencioso", keyTonePlays(enabled = true, ringerMode = AudioManager.RINGER_MODE_SILENT, inCall = false))
    }

    @Test
    fun `in a call the keys beep in every ringer mode`() {
        for (mode in RINGER_MODES) assertTrue("modo $mode", keyTonePlays(enabled = true, ringerMode = mode, inCall = true))
    }

    private companion object {
        val RINGER_MODES = listOf(AudioManager.RINGER_MODE_NORMAL, AudioManager.RINGER_MODE_VIBRATE, AudioManager.RINGER_MODE_SILENT)
    }
}
