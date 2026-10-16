package br.com.starsonic.phone.call

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.PowerManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import br.com.starsonic.phone.App
import br.com.starsonic.phone.main.StarsonicTheme
import br.com.starsonic.phone.service.SipService
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * A tela de chamada ([CallScreen]): abre por cima da tela bloqueada e acende a tela (a notificação de ligação
 * a abre em tela cheia, e o Atender dela também), ou ao ligar do Teclado e do Recentes. Fecha quando a ligação
 * acaba (uma feita que não completou mostra o motivo por 2 s antes).
 *
 * - Com a ligação em andamento (ou chamando) e o som no alto-falante de ouvido, a tela apaga ao encostar no
 *   rosto (o sensor de proximidade); no viva-voz, no Bluetooth, no fone com fio e tocando, não.
 * - A cada volta à tela com a ligação usando o microfone, o serviço é iniciado de novo: com o app na frente,
 *   ele acrescenta os tipos phoneCall e microphone (o Android 14+ não deixa acrescentar o microfone com o app
 *   em segundo plano).
 */
class CallActivity : ComponentActivity() {
    private val app: App
        get() = application as App

    private var proximity: PowerManager.WakeLock? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        proximity = proximityLock()
        if (savedInstanceState == null) handle(intent)
        val calls = app.calls
        val telecom = app.telecom
        val actions = CallActions(
            answer = calls::answer,
            reject = calls::reject,
            hangup = calls::hangup,
            mute = { calls.mute() },
            hold = { calls.hold() },
            activate = calls::activate,
            dtmf = calls::dtmf,
            transfer = calls::transfer,
            consult = calls::consult,
            completeTransfer = calls::completeTransfer,
            cancelConsult = calls::cancelConsult,
            dial = calls::dial,
            route = telecom::setRoute,
        )
        setContent {
            StarsonicTheme {
                val call by calls.state.collectAsState()
                val message by calls.endMessage.collectAsState()
                val routes by telecom.routes.collectAsState()
                CallScreen(call, message, routes, actions)
            }
        }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                combine(calls.state, calls.endMessage, telecom.routes) { call, message, routes ->
                    Triple(call, message, routes)
                }.collect { (call, message, routes) ->
                    // A tela apaga no ouvido: chamando ou em andamento, com o som no alto-falante de ouvido.
                    setProximity(call != null && call.phase != CallPhase.RINGING && routes.atEar)
                    if (call == null && message.isEmpty()) finish()
                }
            }
            setProximity(false)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        if (app.calls.state.value?.usesMicrophone == true) SipService.start(this)
    }

    override fun onStop() {
        setProximity(false)
        super.onStop()
    }

    // O Atender da notificação: atende a recebida, se ela ainda toca.
    private fun handle(intent: Intent?) {
        if (intent?.action != ACTION_ANSWER) return
        val callId = intent.getIntExtra(EXTRA_CALL_ID, CallManager.NO_ID)
        val ringing = app.calls.isRinging(callId)
        CallLog.i { "tela de chamada: atender $callId (tocando: $ringing)" }
        // A notificação de uma ligação que já não toca (de um processo que morreu) sai.
        if (ringing) app.calls.answer() else app.notifier.dismiss(callId)
    }

    private fun proximityLock(): PowerManager.WakeLock? {
        val power = getSystemService(PowerManager::class.java) ?: return null
        if (!power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return null
        return power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, PROXIMITY_TAG).apply {
            setReferenceCounted(false)
        }
    }

    // Sem prazo, de propósito: fica preso enquanto a ligação está no ouvido e sai quando ela acaba, quando o
    // som sai do ouvido ou quando a tela de chamada sai da frente.
    @SuppressLint("WakelockTimeout")
    private fun setProximity(on: Boolean) {
        val lock = proximity ?: return
        if (on && !lock.isHeld) {
            lock.acquire()
        } else if (!on && lock.isHeld) {
            lock.release(PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY)
        }
    }

    companion object {
        /** O Atender da notificação de ligação. */
        const val ACTION_ANSWER = "br.com.starsonic.phone.action.ATENDER"

        /** O id (no motor) da ligação da notificação. */
        const val EXTRA_CALL_ID = "br.com.starsonic.phone.extra.LIGACAO"

        private const val PROXIMITY_TAG = "starsonic:proximidade"

        /** A tela de chamada, numa tarefa própria (fora dos Recentes do Android). */
        fun intent(context: Context): Intent =
            Intent(context, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
