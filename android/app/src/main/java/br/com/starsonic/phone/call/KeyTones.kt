package br.com.starsonic.phone.call

import android.media.AudioManager
import android.media.ToneGenerator
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleResumeEffect
import br.com.starsonic.phone.BuildConfig

/**
 * O tom de telefone (DTMF) da tecla [key] do Teclado ou do teclado da ligação, o do ToneGenerator: cada tecla com o seu,
 * como no app de telefone do Android. Null para o que não é tecla.
 */
fun keyTone(key: String): Int? = when (key) {
    "0" -> ToneGenerator.TONE_DTMF_0
    "1" -> ToneGenerator.TONE_DTMF_1
    "2" -> ToneGenerator.TONE_DTMF_2
    "3" -> ToneGenerator.TONE_DTMF_3
    "4" -> ToneGenerator.TONE_DTMF_4
    "5" -> ToneGenerator.TONE_DTMF_5
    "6" -> ToneGenerator.TONE_DTMF_6
    "7" -> ToneGenerator.TONE_DTMF_7
    "8" -> ToneGenerator.TONE_DTMF_8
    "9" -> ToneGenerator.TONE_DTMF_9
    "*" -> ToneGenerator.TONE_DTMF_S
    "#" -> ToneGenerator.TONE_DTMF_P
    else -> null
}

/**
 * Se a tecla bipa, com o Bipe ao digitar [enabled] (a chave das Configurações): fora da ligação, só com o celular no modo
 * normal ([ringerMode], o do AudioManager; no silencioso e no só vibrando, nada, como no app de telefone do Android); no
 * teclado da ligação ([inCall]), em qualquer modo, porque o bipe sai junto com o som da ligação.
 */
fun keyTonePlays(enabled: Boolean, ringerMode: Int, inCall: Boolean): Boolean =
    enabled && (inCall || ringerMode == AudioManager.RINGER_MODE_NORMAL)

/**
 * O Bipe ao digitar de um teclado na tela: a função que toca o tom de uma tecla ([keyTone]) quando [keyTonePlays], por
 * 150 ms, no som do teclado de discagem do Android (STREAM_DTMF, a 80 do ToneGenerator), como no app de telefone dele:
 * fora da ligação, ele segue o volume do toque (em alguns celulares, como os Samsung, o do sistema) e sai no alto-falante
 * (ou no fone de ouvido); na ligação, segue o volume dela e sai junto com o som dela. [inCall]: o teclado da ligação. [enabled]: a chave das Configurações, lida a cada
 * tecla. O som fica pronto quando a tela vem para a frente (com a chave ligada) e é solto quando ela sai, ou quando o
 * teclado some.
 */
@Composable
fun rememberKeyTones(inCall: Boolean, enabled: () -> Boolean): (String) -> Unit {
    val context = LocalContext.current
    val currentEnabled by rememberUpdatedState(enabled)
    val tones = remember(context, inCall) {
        KeyTones(context.getSystemService(AudioManager::class.java), inCall) { currentEnabled() }
    }
    LifecycleResumeEffect(tones) {
        tones.prepare()
        onPauseOrDispose { tones.release() }
    }
    return remember(tones) { tones::play }
}

/**
 * O tom das teclas de um teclado ([rememberKeyTones]), com um ToneGenerator que nasce no [prepare] (ou na primeira tecla)
 * e sai no [release]. Só na thread principal. Nos builds de debug, cada tecla deixa uma linha no logcat (tag
 * StarsonicTeclas, sem o número), como "bipe da tecla (Teclado): tocou"; os testes no emulador a leem.
 */
internal class KeyTones(
    private val audio: AudioManager?,
    private val inCall: Boolean,
    private val enabled: () -> Boolean,
) {
    private var generator: ToneGenerator? = null

    /** Deixa o som pronto antes da primeira tecla, com a chave ligada. */
    fun prepare() {
        if (enabled()) open()
    }

    /** O tom da tecla [key]; o que não é tecla não bipa. */
    fun play(key: String) {
        val tone = keyTone(key) ?: return
        val ringerMode = audio?.ringerMode ?: AudioManager.RINGER_MODE_NORMAL
        val outcome = when {
            !enabled() -> "desligado nas Configurações"
            !keyTonePlays(enabled = true, ringerMode, inCall) -> "sem som, o celular no silencioso ou só vibrando"
            open()?.startTone(tone, TONE_MILLIS) == true -> "tocou"
            else -> "o Android não tocou"
        }
        if (BuildConfig.DEBUG) Log.i(TAG, "bipe da tecla (${if (inCall) "ligação" else "Teclado"}): $outcome")
    }

    /** Solta o som (a tela saiu da frente, ou o teclado sumiu). */
    fun release() {
        generator?.release()
        generator = null
    }

    // O ToneGenerator de agora, ou um novo; null se o Android não deu um (a primeira vez vai ao log de diagnóstico).
    private fun open(): ToneGenerator? =
        generator ?: try {
            ToneGenerator(AudioManager.STREAM_DTMF, VOLUME).also { generator = it }
        } catch (e: RuntimeException) {
            if (!failureNoted) {
                failureNoted = true
                CallLog.w { "bipe ao digitar: o Android não deu o som do teclado (${e.message})" }
            }
            null
        }

    private companion object {
        const val TAG = "StarsonicTeclas"
        const val TONE_MILLIS = 150   // os do app de telefone do Android
        const val VOLUME = 80         // do ToneGenerator (0 a 100), sobre o volume do som do teclado

        // A falha do ToneGenerator vai ao log de diagnóstico uma vez só (ela se repetiria a cada tela e a cada tecla).
        var failureNoted = false
    }
}
