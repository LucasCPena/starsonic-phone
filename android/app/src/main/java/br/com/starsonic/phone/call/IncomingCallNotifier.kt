package br.com.starsonic.phone.call

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import br.com.starsonic.phone.App
import br.com.starsonic.phone.R
import br.com.starsonic.phone.main.MainActivity

/**
 * As notificações das ligações (spec 7.3):
 * - "ligacoes" ("Ligações", importância alta): a ligação recebida, no estilo de ligação do Android
 *   (CallStyle.forIncomingCall: Atender e Recusar), com a tela cheia ([CallActivity]) quando o celular está
 *   bloqueado ou com a tela apagada, e no alto da tela com o celular em uso. O toque é o do celular
 *   (RingtoneManager.TYPE_RINGTONE, como toque de chamada) e vibra, pelo próprio canal: o Android o sujeita ao
 *   silencioso, ao vibrar e ao Não perturbe. Ele se repete (FLAG_INSISTENT) até a notificação sair
 *   ([stopRinging]).
 * - "perdidas" ("Ligações perdidas", importância padrão): "Ligação perdida de <número>"; tocar abre o Recentes.
 *
 * A notificação da recebida só aparece se a ligação ainda toca: um pedido do Telecom que chega depois de ela
 * parar (atendida pelo Bluetooth, desistência) não a põe de volta. Qualquer thread.
 */
class IncomingCallNotifier(private val context: Context) : CallNotifier {
    private val manager = context.getSystemService(NotificationManager::class.java)
    private val lock = Any()
    private var stoppedUpTo = 0   // as ligações com id até este já pararam de tocar
    private var shownId = 0       // a ligação da notificação que está lá

    init {
        val ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val ringing = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val calls = NotificationChannel(CHANNEL_CALLS, CHANNEL_CALLS_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(ringtone, ringing)
            enableVibration(true)
            vibrationPattern = VIBRATION
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        val missed = NotificationChannel(CHANNEL_MISSED, CHANNEL_MISSED_NAME, NotificationManager.IMPORTANCE_DEFAULT)
        manager.createNotificationChannels(listOf(calls, missed))
    }

    /** A notificação da recebida [callId] (o Telecom pede: onShowIncomingCallUi), se ela ainda toca. */
    fun showIncoming(callId: Int, number: String, name: String) {
        synchronized(lock) {
            if (callId <= stoppedUpTo) {
                CallLog.i("notificação: a recebida $callId já parou de tocar")
                return
            }
            shownId = callId
            manager.notify(INCOMING_ID, incoming(callId, number, name))
            CallLog.i("notificação: recebida $callId")
        }
    }

    override fun stopRinging(callId: Int) {
        synchronized(lock) {
            stoppedUpTo = maxOf(stoppedUpTo, callId)
            if (shownId <= stoppedUpTo) manager.cancel(INCOMING_ID)
        }
    }

    override fun showMissed(text: String) {
        val open = PendingIntent.getActivity(
            context,
            REQUEST_RECENTS,
            Intent(context, MainActivity::class.java)
                .setAction(MainActivity.ACTION_RECENTS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_MISSED)
            .setSmallIcon(R.drawable.ic_stat_starsonic)
            .setContentTitle(text)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis())
            .build()
        // Uma por número: outra perdida do mesmo número troca a anterior.
        manager.notify(text, MISSED_ID, notification)
    }

    private fun incoming(callId: Int, number: String, name: String): Notification {
        val screen = CallActivity.intent(context).putExtra(CallActivity.EXTRA_CALL_ID, callId)
        val fullScreen = PendingIntent.getActivity(context, REQUEST_SCREEN, screen, IMMUTABLE_UPDATE)
        val answer = PendingIntent.getActivity(
            context,
            REQUEST_ANSWER,
            CallActivity.intent(context).setAction(CallActivity.ACTION_ANSWER).putExtra(CallActivity.EXTRA_CALL_ID, callId),
            IMMUTABLE_UPDATE,
        )
        val decline = PendingIntent.getBroadcast(
            context,
            REQUEST_DECLINE,
            Intent(context, CallActionReceiver::class.java).setAction(ACTION_DECLINE).putExtra(CallActivity.EXTRA_CALL_ID, callId),
            IMMUTABLE_UPDATE,
        )
        val caller = Person.Builder().setName(name.ifEmpty { number }).setImportant(true).build()
        return NotificationCompat.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_stat_starsonic)
            .setContentText(if (name.isEmpty()) null else number)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(fullScreen)
            .setFullScreenIntent(fullScreen, true)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
            .build()
            .apply { flags = flags or Notification.FLAG_INSISTENT }
    }

    companion object {
        /** O canal da ligação recebida. */
        const val CHANNEL_CALLS = "ligacoes"

        /** O canal das perdidas. */
        const val CHANNEL_MISSED = "perdidas"

        const val ACTION_DECLINE = "br.com.starsonic.phone.action.RECUSAR"

        private const val CHANNEL_CALLS_NAME = "Ligações"
        private const val CHANNEL_MISSED_NAME = "Ligações perdidas"
        private const val INCOMING_ID = 2   // a notificação fixa do serviço é a 1
        private const val MISSED_ID = 3
        private const val REQUEST_SCREEN = 1
        private const val REQUEST_ANSWER = 2
        private const val REQUEST_DECLINE = 3
        private const val REQUEST_RECENTS = 4
        private const val IMMUTABLE_UPDATE = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        private val VIBRATION = longArrayOf(0, 1_000, 1_000)
    }
}

/** O Recusar da notificação de ligação: recusa a recebida, se ela ainda toca. */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != IncomingCallNotifier.ACTION_DECLINE) return
        val calls = (context.applicationContext as App).calls
        if (calls.isRinging(intent.getIntExtra(CallActivity.EXTRA_CALL_ID, CallManager.NO_ID))) calls.reject()
    }
}
