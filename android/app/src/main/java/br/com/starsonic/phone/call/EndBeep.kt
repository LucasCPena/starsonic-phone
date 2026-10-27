package br.com.starsonic.phone.call

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * O bipe no fim da ligação (spec 9). O [CallManager] o pede quando uma ligação atendida acaba sem outra de pé, e a
 * Connection dela só sai do Telecom no done: até lá o Telecom mantém o som da ligação (o fone do celular, o headset ou
 * o Bluetooth), e o bipe sai nele, nunca no alto-falante de toque.
 *
 * O contrato do [play]: volta na hora, sem esperar o som; o done roda uma vez só, de qualquer thread, quando o bipe
 * acaba, num erro ou em [END_BEEP_MAX_MILLIS] no máximo, o que vier primeiro. (O CallManager não depende dele para
 * soltar a Connection: no mesmo limite, ela sai de qualquer jeito.)
 */
fun interface EndBeep {
    fun play(done: () -> Unit)
}

/** O máximo que a Connection da ligação que acabou espera pelo bipe do fim (spec 9). */
const val END_BEEP_MAX_MILLIS = 1_500L

/** Sem bipe: o done na hora (o padrão do [CallManager]). */
object NoBeep : EndBeep {
    override fun play(done: () -> Unit) = done()
}

/**
 * O som do bipe do fim, o do Windows, em PCM de 16 bits e mono, com [sampleRate] amostras por segundo: 425 Hz por
 * 0,25 s, 0,15 s de silêncio e 425 Hz por mais 0,25 s (0,65 s ao todo). Cada toque sobe e desce em 5 ms (sem o
 * estalo) e fica em 0,18 da escala, o volume do bipe do Windows.
 */
fun endBeepPcm(sampleRate: Int): ShortArray {
    val tone = sampleRate * TONE_MILLIS / 1000
    val gap = sampleRate * GAP_MILLIS / 1000
    val fade = sampleRate * FADE_MILLIS / 1000
    val pcm = ShortArray(tone * 2 + gap)
    for (start in intArrayOf(0, tone + gap)) {
        for (i in 0 until tone) {
            val ramp = minOf(1.0, i.toDouble() / fade, (tone - 1 - i).toDouble() / fade)
            val wave = sin(2 * PI * TONE_HZ * i / sampleRate)
            pcm[start + i] = (LEVEL * ramp * wave * Short.MAX_VALUE).roundToInt().toShort()
        }
    }
    return pcm
}

private const val TONE_HZ = 425.0
private const val TONE_MILLIS = 250
private const val GAP_MILLIS = 150
private const val FADE_MILLIS = 5
private const val LEVEL = 0.18

/**
 * O fim de um bipe de [frames] quadros tocado a [sampleRate] por segundo, no AudioTrack estático (R43):
 * - a marca ([markerFrame]) 10 ms antes do último quadro: em alguns celulares, a marca no último quadro só chega quando o
 *   som falta, ou nunca (a posição para uns quadros antes do fim), e o done vinha do limite de 1,5 s, com a linha falsa
 *   "o som não acabou" no diagnóstico;
 * - o tempo depois dela até o done ([afterMarkerMillis]): o resto do som e a folga para ele sair do celular (o Bluetooth
 *   atrasa), com o done no tempo de sempre, 200 ms depois do som;
 * - o fim pelo tempo ([timedEndMillis], contado do play): o som e a folga. Aí, se a posição do AudioTrack já passou da
 *   marca ([endBeepPlayed]), o bipe tocou, e o done vem depois da folga, mesmo sem a marca; senão (o som atrasou ou
 *   parou), a posição é conferida de novo até a marca, ou até o limite, que fica só para o som parado de verdade.
 */
internal data class EndBeepTimes(val markerFrame: Int, val afterMarkerMillis: Long, val timedEndMillis: Long)

/** Os tempos do fim do bipe de [frames] quadros a [sampleRate] por segundo ([EndBeepTimes]). */
internal fun endBeepTimes(frames: Int, sampleRate: Int): EndBeepTimes {
    val early = (sampleRate * END_BEEP_MARKER_EARLY_MILLIS / 1000).toInt()
    val sound = frames * 1000L / sampleRate
    return EndBeepTimes(
        markerFrame = frames - early,
        afterMarkerMillis = END_BEEP_MARKER_EARLY_MILLIS + END_BEEP_TAIL_MILLIS,
        timedEndMillis = sound + END_BEEP_TAIL_MILLIS,
    )
}

/** O bipe de [times] tocou até a marca: a posição do AudioTrack ([headFrames], em quadros) já passou dela. */
internal fun endBeepPlayed(headFrames: Int, times: EndBeepTimes): Boolean = headFrames >= times.markerFrame

/** A folga depois do último quadro tocado: o som ainda sai do celular (o Bluetooth atrasa mais). */
private const val END_BEEP_TAIL_MILLIS = 200L

/** Quanto antes do último quadro fica a marca do fim. */
private const val END_BEEP_MARKER_EARLY_MILLIS = 10L

/**
 * O bipe do fim no celular: o [endBeepPcm] em 16 kHz, mono, num AudioTrack estático com o uso da voz da ligação
 * (USAGE_VOICE_COMMUNICATION e CONTENT_TYPE_SPEECH), que sai no caminho de áudio da ligação enquanto a Connection dela
 * espera o done.
 *
 * O [play] só pede: o AudioTrack nasce, toca e é liberado numa thread própria ("starsonic-bipe"). O done roda uma vez
 * só, no primeiro destes ([endBeepTimes], R43):
 * - a marca, 10 ms antes do último quadro, mais o resto do som e a folga para ele sair do celular (o Bluetooth atrasa);
 * - o fim pelo tempo: o som e a folga depois do play, com a posição do AudioTrack já depois da marca (o celular que não
 *   deu a marca), mais a folga;
 * - um erro do Android, na hora;
 * - [END_BEEP_MAX_MILLIS] desde o pedido, contados na thread principal: o limite vale mesmo com a thread do bipe
 *   presa no Android (o servidor de áudio reiniciando), e o bipe que nascer depois dele já não toca.
 *
 * O começo vai ao log de diagnóstico ([CallLog]), com o modo do áudio de então (3 é o da ligação), e um erro também; o
 * fim pelo tempo e o limite também (o limite só com o som parado de verdade).
 */
class AudioTrackEndBeep(context: Context) : EndBeep {
    private val audio: AudioManager? = context.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val handler: Handler by lazy { Handler(HandlerThread(THREAD).apply { start() }.looper) }
    private val pcm: ShortArray by lazy { endBeepPcm(SAMPLE_RATE) }
    private val times: EndBeepTimes by lazy { endBeepTimes(pcm.size, SAMPLE_RATE) }

    override fun play(done: () -> Unit) {
        val beep = Beep(done)
        main.postDelayed(beep.cap, END_BEEP_MAX_MILLIS)
        handler.post(beep::start)
    }

    // Um bipe, do pedido ao done. O AudioTrack só é usado na thread do bipe (o começo, a marca, o fim pelo tempo, a folga e
    // a liberação); o fim pode vir de lá ou do limite, na thread principal, e só o primeiro vale.
    private inner class Beep(private val done: () -> Unit) : AudioTrack.OnPlaybackPositionUpdateListener {
        private val finished = AtomicBoolean(false)
        private var track: AudioTrack? = null   // só na thread do bipe
        private var ending = false              // a marca ou o fim pelo tempo já marcaram o done (só na thread do bipe)

        val cap = Runnable {
            if (!finished.get()) CallLog.w { "bipe do fim: o som não acabou em $END_BEEP_MAX_MILLIS ms" }
            finish()
        }

        // Na thread do bipe: o fim pelo tempo. A posição já passou da marca: o bipe tocou (o celular não deu a marca), e o
        // done vem depois da folga. Senão (o som atrasou ou parou), confere de novo daqui a pouco, até a marca ou o limite.
        private val timedEnd: Runnable = object : Runnable {
            override fun run() {
                val playing = track ?: return
                if (ending || finished.get()) return
                val head = try {
                    playing.playbackHeadPosition
                } catch (e: IllegalStateException) {
                    return
                }
                if (endBeepPlayed(head, times)) {
                    ending = true
                    CallLog.i { "bipe do fim: sem a marca do fim, acabou pelo tempo" }
                    handler.postDelayed(::finish, times.afterMarkerMillis)
                } else {
                    handler.postDelayed(this, POLL_MILLIS)
                }
            }
        }

        // Na thread do bipe.
        fun start() {
            if (finished.get()) return
            try {
                val created = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build(),
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build(),
                    )
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .setBufferSizeInBytes(pcm.size * Short.SIZE_BYTES)
                    .build()
                track = created
                if (finished.get()) {
                    release()   // o limite passou enquanto o Android criava o AudioTrack: ele não toca mais
                    return
                }
                val written = created.write(pcm, 0, pcm.size)
                check(written == pcm.size) { "write: $written" }
                created.setPlaybackPositionUpdateListener(this, handler)
                val marked = created.setNotificationMarkerPosition(times.markerFrame)
                check(marked == AudioTrack.SUCCESS) { "marca: $marked" }
                created.play()
                handler.postDelayed(timedEnd, times.timedEndMillis)
                CallLog.i { "bipe do fim: tocando (modo do áudio ${audio?.mode})" }
            } catch (e: RuntimeException) {
                Log.w(TAG, "o bipe do fim não tocou", e)
                CallLog.w { "bipe do fim: não tocou (${e.message})" }
                finish()
            }
        }

        override fun onMarkerReached(audioTrack: AudioTrack) {
            if (ending) return
            ending = true
            handler.postDelayed(::finish, times.afterMarkerMillis)
        }

        override fun onPeriodicNotification(audioTrack: AudioTrack) {}

        // Em qualquer thread: o fim do bipe, uma vez só. O AudioTrack sai na thread do bipe (depois do começo, se ela
        // ainda está nele), e o done roda aqui.
        fun finish() {
            if (!finished.compareAndSet(false, true)) return
            main.removeCallbacks(cap)
            handler.post(::release)
            done()
        }

        // Na thread do bipe.
        private fun release() {
            handler.removeCallbacks(timedEnd)
            track?.release()
            track = null
        }
    }

    private companion object {
        const val THREAD = "starsonic-bipe"
        const val TAG = "StarsonicBipe"
        const val SAMPLE_RATE = 16_000

        /** De quanto em quanto tempo o fim pelo tempo confere de novo a posição de um bipe que atrasou. */
        const val POLL_MILLIS = 50L
    }
}
