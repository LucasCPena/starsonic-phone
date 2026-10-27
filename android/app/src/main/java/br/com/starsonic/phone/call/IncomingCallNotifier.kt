package br.com.starsonic.phone.call

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
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
 * - "ligacoes-silenciadas" ("Ligações silenciadas", importância alta, sem som e sem vibração): a recebida depois
 *   do volume apertado durante o toque ([silence]). A notificação é atualizada no lugar, nesse canal: o Android
 *   para o toque e a vibração que se repetem, e ela continua no alto da tela.
 * - "perdidas" ("Ligações perdidas", importância padrão): "Ligação perdida de <nome do contato ou número>"; tocar abre
 *   o Recentes.
 * - "perdidas-nao-perturbe" ("Ligações perdidas no Não perturbe", importância baixa, sem som e sem vibração): a mesma
 *   perdida, a das recebidas que o Não perturbe recusou (spec 4).
 *
 * O nome de quem liga chega já resolvido pelo CallManager (pelo Telecom, nos extras da recebida): o do contato do
 * celular com o número, se há (spec da 0.2, 7.5), senão o que a central mandou. Com o Atender automático marcado para
 * ela (spec 5), o texto da notificação ganha a linha "Atender automático · em <n> s" (ou "· na hora"), com o tempo
 * escolhido (R33): a notificação não é postada de novo a cada segundo, o que poderia tocar de novo. Quando a decisão
 * muda (o Atender automático desligado, o Não perturbe ligado, o microfone recusado: [autoAnswerChanged]), ela é postada
 * de novo uma vez, sem alertar, para a linha nunca prometer um atender que não vem (R38).
 *
 * A chamada em espera (spec da 0.2, 7.1: a recebida com outra ligação em andamento) não toca o toque do celular, para
 * não cobrir a conversa: a notificação vai ao canal "ligacoes-silenciadas" (no alto da tela, sem som), sem a tela
 * cheia, e o app toca o bipe de chamada em espera no som da ligação (ToneGenerator, TONE_SUP_CALL_WAITING) a cada
 * 3 s, com a vibração curta a cada bipe, até ela parar de tocar ([stopRinging]) ou o volume ser apertado ([silence]).
 * Sem a tela cheia, o Android não aceita o estilo de ligação (CallStyle): ela é uma notificação comum de ligação,
 * "Ligação de <nome ou número>", com Recusar e Atender. Se a outra ligação acaba com ela tocando, ela passa a tocar
 * como uma primeira ligação (o toque do celular e a tela cheia): o bipe confere a cada segundo a ligação da tela de
 * chamada ([screenCall], o estado do CallManager).
 *
 * A notificação da recebida só aparece se a ligação ainda toca: um pedido do Telecom que chega depois de ela
 * parar (atendida pelo Bluetooth, desistência) não a põe de volta. Um processo novo não tem ligação: o notificador
 * que nasce tira a notificação que ficou de um processo que morreu com a ligação tocando, e o Atender e o Recusar
 * de uma ligação que já não toca também a tiram ([dismiss]). O volume apertado durante o toque ([silence]) a deixa
 * sem som. Qualquer thread.
 */
class IncomingCallNotifier(
    private val context: Context,
    private val screenCall: () -> CallUi? = { null },
) : CallNotifier {
    private val manager = context.getSystemService(NotificationManager::class.java)
    private val lock = Any()
    private var stoppedUpTo = 0   // as ligações com id até este já pararam de tocar
    private var shownId = 0       // a ligação da notificação que está lá
    private var shownCall = ""    // ...o número...
    private var shownName = ""    // ...o nome...
    private var shownAddress = "" // ...e o endereço
    private var shownWaiting = false // ...se é a chamada em espera
    private var shownRinging = false // ...se está no canal que toca (e não no silenciado)
    private var shownAutoAnswer: Int? = null // ...e os segundos do Atender automático marcado (null: nenhum)
    private var decidedId = 0     // a recebida do último aviso do Atender automático (R38)...
    private var decidedSeconds: Int? = null // ...e a decisão dele
    private var beepingId = 0     // a chamada em espera que bipa (0: nenhuma)

    private val main = Handler(Looper.getMainLooper())
    private val vibrator: Vibrator? = context.getSystemService(Vibrator::class.java)
    private val ringing = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
    private var tone: ToneGenerator? = null   // o do bipe; só na thread principal
    private var lastBeepAt = 0L               // quando o último bipe tocou (0: nenhum ainda); só na thread principal

    // Na thread principal, a cada segundo enquanto a chamada em espera toca: se ela ficou sozinha na tela de chamada
    // (a outra acabou), ela passa a tocar como uma primeira ligação ([ringAlone]); senão, a cada 3 s, um bipe e a
    // vibração curta. Um por vez: o próximo pendente (de um começo anterior) sai.
    private val beep = object : Runnable {
        @Suppress("DEPRECATION")   // o vibrate com AudioAttributes ainda vale (o com VibrationAttributes é do Android 13+)
        override fun run() {
            main.removeCallbacks(this)
            val id = synchronized(lock) { beepingId }
            if (id == 0) return
            if (screenCall()?.let { it.id == id && it.phase == CallPhase.RINGING } == true) {
                ringAlone(id)
                return
            }
            val now = SystemClock.uptimeMillis()
            if (lastBeepAt == 0L || now - lastBeepAt >= BEEP_EVERY_MILLIS) {
                lastBeepAt = now
                val generator = tone ?: newTone()?.also { tone = it }
                generator?.startTone(ToneGenerator.TONE_SUP_CALL_WAITING, BEEP_MILLIS)
                vibrator?.vibrate(VibrationEffect.createWaveform(VIBRATION, -1), ringing)
            }
            main.postDelayed(this, CHECK_EVERY_MILLIS)
        }
    }

    // Na thread principal: sem chamada em espera tocando, o bipe para e o ToneGenerator é liberado.
    private val quiet = Runnable {
        if (synchronized(lock) { beepingId } != 0) return@Runnable
        main.removeCallbacks(beep)
        tone?.stopTone()
        tone?.release()
        tone = null
        lastBeepAt = 0L
        vibrator?.cancel()
    }

    init {
        val ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val calls = NotificationChannel(CHANNEL_CALLS, CHANNEL_CALLS_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(ringtone, ringing)
            enableVibration(true)
            vibrationPattern = VIBRATION
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        val silenced = NotificationChannel(CHANNEL_SILENCED, CHANNEL_SILENCED_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(null, null)
            enableVibration(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        val missed = NotificationChannel(CHANNEL_MISSED, CHANNEL_MISSED_NAME, NotificationManager.IMPORTANCE_DEFAULT)
        val missedSilent = NotificationChannel(
            CHANNEL_MISSED_SILENT, CHANNEL_MISSED_SILENT_NAME, NotificationManager.IMPORTANCE_LOW,
        ).apply {
            setSound(null, null)
            enableVibration(false)
        }
        manager.createNotificationChannels(listOf(calls, silenced, missed, missedSilent))
        // Um processo novo não tem ligação: a notificação que ficou de um processo que morreu (com o toque que se
        // repete) sai.
        manager.cancel(INCOMING_ID)
    }

    /**
     * A notificação da recebida [callId] (o Telecom pede: onShowIncomingCallUi), se ela ainda toca, com o [name] já
     * resolvido (o do contato do celular, ou o da central; vazio: o número). [address] é o endereço da ligação no
     * Telecom: o nome de quem liga, sem nome nem número. Com [waiting] (outra ligação em andamento), a chamada em
     * espera: sem o toque nem a tela cheia, com o bipe e a vibração curta a cada 3 s. Com [autoAnswerSeconds], o tempo do
     * Atender automático marcado para ela, no texto. Uma falha do Android ao mostrá-la vai ao log e não derruba a ligação.
     */
    fun showIncoming(
        callId: Int,
        number: String,
        name: String,
        address: String = "",
        waiting: Boolean = false,
        autoAnswerSeconds: Int? = null,
    ) {
        synchronized(lock) {
            if (callId <= stoppedUpTo) {
                CallLog.i { "notificação: a recebida $callId já parou de tocar" }
                return
            }
            shownId = callId
            shownCall = number
            shownName = name
            shownAddress = address
            shownWaiting = waiting
            // Uma decisão do Atender automático avisada depois da pergunta do Telecom é a mais nova (R38).
            shownAutoAnswer = if (callId == decidedId) decidedSeconds else autoAnswerSeconds
            if (waiting) {
                post(callId, ring = false, "chamada em espera $callId")
                beepingId = callId
                main.post(beep)
            } else {
                post(callId, ring = true, "recebida $callId")
            }
        }
    }

    /**
     * O volume apertado durante o toque (Telecom: onSilence, Android 10+): a notificação da recebida [callId], que
     * ainda toca, é atualizada no lugar (o mesmo id), no canal sem som e sem vibração e sem alertar de novo. O
     * Android para o toque e a vibração que se repetem (o canal novo não tem nenhum dos dois), e ela continua no
     * alto da tela. Na chamada em espera, que já está nesse canal, só o bipe (e a vibração dele) para.
     */
    fun silence(callId: Int) {
        synchronized(lock) {
            if (callId != shownId || callId <= stoppedUpTo) return
            if (shownWaiting) {
                // A chamada em espera já está no canal sem som: só o bipe para.
                if (beepingId == callId) stopBeep()
                CallLog.i { "notificação: chamada em espera $callId sem o bipe" }
                return
            }
            post(callId, ring = false, "recebida $callId sem o toque")
        }
    }

    /**
     * O Atender ou o Recusar de uma notificação cuja ligação [callId] já não toca (de um processo que morreu, ou
     * atrasada): ela sai, a não ser que seja de outra ligação que toca agora. Não mexe nas próximas ligações (os
     * ids de um processo novo recomeçam do 1).
     */
    fun dismiss(callId: Int) {
        synchronized(lock) {
            if (shownId != 0 && shownId != callId && shownId > stoppedUpTo) return
            manager.cancel(INCOMING_ID)
            if (beepingId != 0) stopBeep()
            CallLog.i { "notificação: a recebida $callId já não toca" }
        }
    }

    override fun stopRinging(callId: Int) {
        synchronized(lock) {
            stoppedUpTo = maxOf(stoppedUpTo, callId)
            if (shownId <= stoppedUpTo) manager.cancel(INCOMING_ID)
            if (beepingId != 0 && beepingId <= stoppedUpTo) stopBeep()
        }
    }

    /**
     * R38: a decisão do Atender automático sobre a recebida [callId] mudou. A notificação dela, se está lá (e não é a
     * chamada em espera, que nunca tem a linha), é postada de novo uma vez, no mesmo canal e sem alertar de novo (o toque
     * que se repete continua, sem recomeçar, e nem a tela cheia nem o alto da tela voltam), com a linha certa. A decisão
     * fica guardada: a notificação que o Telecom pede depois sai com ela.
     */
    override fun autoAnswerChanged(callId: Int, seconds: Int?) {
        synchronized(lock) {
            decidedId = callId
            decidedSeconds = seconds
            val shown = ShownIncoming(shownId, shownRinging, shownWaiting, shownAutoAnswer).takeIf { shownId > stoppedUpTo }
            if (!repostsForAutoAnswer(shown, callId, seconds)) return
            shownAutoAnswer = seconds
            val line = seconds?.let { "com o Atender automático em $it s" } ?: "sem o Atender automático"
            post(callId, ring = shownRinging, "recebida $callId, agora $line", alertOnce = true)
        }
    }

    override fun showMissed(text: String, silent: Boolean) {
        val open = PendingIntent.getActivity(
            context,
            REQUEST_RECENTS,
            Intent(context, MainActivity::class.java)
                .setAction(MainActivity.ACTION_RECENTS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, if (silent) CHANNEL_MISSED_SILENT else CHANNEL_MISSED)
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

    // Com a trava: o bipe da chamada em espera para (na thread principal).
    private fun stopBeep() {
        beepingId = 0
        main.post(quiet)
        CallLog.i { "notificação: o bipe da chamada em espera parou" }
    }

    // Na thread principal: a chamada em espera [id] ficou sozinha, ainda tocando (a outra ligação acabou): o bipe para
    // e ela toca como uma primeira ligação (canal "ligacoes", o toque do celular, a tela cheia e o CallStyle). A
    // notificação sai e volta nova: o Android só abre a tela cheia (com o celular bloqueado ou a tela apagada) de uma
    // notificação nova, e não de uma atualizada.
    private fun ringAlone(id: Int) {
        synchronized(lock) {
            if (beepingId != id || shownId != id || id <= stoppedUpTo) return
            shownWaiting = false
            stopBeep()
            manager.cancel(INCOMING_ID)
            post(id, ring = true, "recebida $id, agora sem outra ligação")
        }
    }

    // Na thread principal: o ToneGenerator do bipe, no som da ligação; null se o Android não deu um (vai ao log).
    private fun newTone(): ToneGenerator? =
        try {
            ToneGenerator(AudioManager.STREAM_VOICE_CALL, BEEP_VOLUME)
        } catch (e: RuntimeException) {
            Log.w(TAG, "o bipe da chamada em espera não tocou", e)
            null
        }

    // Com a trava: mostra ou atualiza a notificação da recebida ([alertOnce]: sem alertar de novo, se ela já está lá);
    // uma falha do Android vai ao log (a ligação segue).
    private fun post(callId: Int, ring: Boolean, what: String, alertOnce: Boolean = !ring) {
        try {
            manager.notify(INCOMING_ID, incoming(callId, ring, alertOnce))
            shownRinging = ring
            CallLog.i { "notificação: $what" }
        } catch (e: RuntimeException) {
            Log.w(TAG, "a notificação da $what não foi mostrada", e)
        }
    }

    // Com a trava: a notificação da recebida [callId] mostrada (shownCall, shownName, shownAddress, shownWaiting e
    // shownAutoAnswer: o texto é o número, com o nome no título, e a linha do Atender automático).
    // Tocando ([ring]): o canal "ligacoes", com o toque e a vibração repetidos até ela sair. Silenciada: o canal sem
    // som, sem alertar de novo. A chamada em espera: no canal sem som, sem a tela cheia e, por isso, sem o CallStyle
    // (o Android o recusa sem a tela cheia fora de um serviço em primeiro plano): Recusar e Atender como ações.
    // [alertOnce]: a atualização não toca, não vibra nem aparece de novo (a do Atender automático, R38, e a silenciada).
    private fun incoming(callId: Int, ring: Boolean, alertOnce: Boolean): Notification {
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
        // O CallStyle não aceita uma pessoa sem nome: o nome, o número, o endereço ou "Número desconhecido".
        val callerName = IncomingExtras.callerName(shownName, shownCall, shownAddress)
        val builder = NotificationCompat.Builder(context, if (ring) CHANNEL_CALLS else CHANNEL_SILENCED)
            .setSmallIcon(R.drawable.ic_stat_starsonic)
            .setContentText(incomingNotificationText(shownCall, shownName, shownAutoAnswer))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(fullScreen)
            .setOnlyAlertOnce(alertOnce)
        if (shownWaiting) {
            builder.setContentTitle("$CALL_FROM $callerName")
                .addAction(R.drawable.ic_desligar, REJECT, decline)
                .addAction(R.drawable.ic_ligar, ANSWER, answer)
        } else {
            val caller = Person.Builder().setName(callerName).setImportant(true).build()
            builder.setFullScreenIntent(fullScreen, true)
                .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
        }
        return builder.build().apply { if (ring) flags = flags or Notification.FLAG_INSISTENT }
    }

    companion object {
        /** O canal da ligação recebida. */
        const val CHANNEL_CALLS = "ligacoes"

        /** O canal das perdidas. */
        const val CHANNEL_MISSED = "perdidas"

        /** O canal da recebida silenciada pelo volume (sem som e sem vibração). */
        const val CHANNEL_SILENCED = "ligacoes-silenciadas"

        /** O canal das perdidas do Não perturbe (sem som e sem vibração). */
        const val CHANNEL_MISSED_SILENT = "perdidas-nao-perturbe"

        const val ACTION_DECLINE = "br.com.starsonic.phone.action.RECUSAR"

        private const val CHANNEL_CALLS_NAME = "Ligações"
        private const val CHANNEL_MISSED_NAME = "Ligações perdidas"
        private const val CHANNEL_SILENCED_NAME = "Ligações silenciadas"
        private const val CHANNEL_MISSED_SILENT_NAME = "Ligações perdidas no Não perturbe"
        private const val TAG = "StarsonicNotificacao"
        private const val INCOMING_ID = 2   // a notificação fixa do serviço é a 1
        private const val MISSED_ID = 3
        private const val REQUEST_SCREEN = 1
        private const val REQUEST_ANSWER = 2
        private const val REQUEST_DECLINE = 3
        private const val REQUEST_RECENTS = 4
        private const val IMMUTABLE_UPDATE = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        private val VIBRATION = longArrayOf(0, 1_000, 1_000)
        private const val CALL_FROM = "Ligação de"
        private const val ANSWER = "Atender"
        private const val REJECT = "Recusar"
        private const val BEEP_VOLUME = 80             // do ToneGenerator (0 a 100), sobre o volume da ligação
        private const val BEEP_MILLIS = 1_000          // um bipe de chamada em espera (o par de toques, no padrão CEPT)
        private const val BEEP_EVERY_MILLIS = 3_000L
        private const val CHECK_EVERY_MILLIS = 1_000L    // a conferência de que a outra ligação ainda está de pé
    }
}

/** O Recusar da notificação de ligação: recusa a recebida, se ela ainda toca. */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != IncomingCallNotifier.ACTION_DECLINE) return
        val calls = (context.applicationContext as App).calls
        val callId = intent.getIntExtra(CallActivity.EXTRA_CALL_ID, CallManager.NO_ID)
        val ringing = calls.isRinging(callId)
        CallLog.i { "notificação: recusar $callId (tocando: $ringing)" }
        if (ringing) calls.reject() else (context.applicationContext as App).notifier.dismiss(callId)
    }
}
