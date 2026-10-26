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
 * acaba, num erro ou em 1,5 s no máximo, o que vier primeiro.
 */
fun interface EndBeep {
    fun play(done: () -> Unit)
}

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
 * O bipe do fim no celular: o [endBeepPcm] em 16 kHz, mono, num AudioTrack estático com o uso da voz da ligação
 * (USAGE_VOICE_COMMUNICATION e CONTENT_TYPE_SPEECH), que sai no caminho de áudio da ligação enquanto a Connection dela
 * espera o done.
 *
 * O [play] só pede: o AudioTrack nasce, toca e é liberado numa thread própria ("starsonic-bipe"). O done roda uma vez
 * só, no primeiro destes:
 * - a marca do último quadro, mais [TAIL_MILLIS] para o som sair do celular (o Bluetooth atrasa);
 * - um erro do Android, na hora;
 * - [MAX_MILLIS] desde o pedido, contados na thread principal: o limite vale mesmo com a thread do bipe presa no
 *   Android (o servidor de áudio reiniciando), e o bipe que nascer depois dele já não toca.
 *
 * O começo vai ao log de diagnóstico ([CallLog]), com o modo do áudio de então (3 é o da ligação), e um erro também.
 */
class AudioTrackEndBeep(context: Context) : EndBeep {
    private val audio: AudioManager? = context.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val handler: Handler by lazy { Handler(HandlerThread(THREAD).apply { start() }.looper) }
    private val pcm: ShortArray by lazy { endBeepPcm(SAMPLE_RATE) }

    override fun play(done: () -> Unit) {
        val beep = Beep(done)
        main.postDelayed(beep.cap, MAX_MILLIS)
        handler.post(beep::start)
    }

    // Um bipe, do pedido ao done. O AudioTrack só é usado na thread do bipe (o começo, a marca, a folga e a
    // liberação); o fim pode vir de lá ou do limite, na thread principal, e só o primeiro vale.
    private inner class Beep(private val done: () -> Unit) : AudioTrack.OnPlaybackPositionUpdateListener {
        private val finished = AtomicBoolean(false)
        private var track: AudioTrack? = null   // só na thread do bipe

        val cap = Runnable {
            if (!finished.get()) CallLog.w { "bipe do fim: o som não acabou em $MAX_MILLIS ms" }
            finish()
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
                val marked = created.setNotificationMarkerPosition(pcm.size)
                check(marked == AudioTrack.SUCCESS) { "marca: $marked" }
                created.play()
                CallLog.i { "bipe do fim: tocando (modo do áudio ${audio?.mode})" }
            } catch (e: RuntimeException) {
                Log.w(TAG, "o bipe do fim não tocou", e)
                CallLog.w { "bipe do fim: não tocou (${e.message})" }
                finish()
            }
        }

        override fun onMarkerReached(audioTrack: AudioTrack) {
            handler.postDelayed(::finish, TAIL_MILLIS)
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
            track?.release()
            track = null
        }
    }

    private companion object {
        const val THREAD = "starsonic-bipe"
        const val TAG = "StarsonicBipe"
        const val SAMPLE_RATE = 16_000

        /** A folga depois do último quadro tocado: o som ainda sai do celular (o Bluetooth atrasa mais). */
        const val TAIL_MILLIS = 200L

        /** O máximo que a Connection espera pelo bipe (spec 9). */
        const val MAX_MILLIS = 1_500L
    }
}
