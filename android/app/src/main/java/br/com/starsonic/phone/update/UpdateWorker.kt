package br.com.starsonic.phone.update

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.Operation
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import br.com.starsonic.phone.App
import br.com.starsonic.phone.R
import br.com.starsonic.phone.core.Manifest
import br.com.starsonic.phone.main.MainActivity
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A verificação de 24 h (spec 7.6.1): um trabalho periódico e único do WorkManager ([NAME]), a cada 24 h, com rede; a
 * primeira, 24 h depois de agendar (a abertura do app confere antes). Ela decide sem a regra das 24 h da abertura (já
 * roda a cada 24 h, como o timer do Windows). Versão nova com o app em segundo plano: a notificação
 * ([UpdateNotification]), a cada rodada, cujo toque abre o app com o aviso; com o app na tela, o aviso aparece direto.
 */
class UpdateWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        withContext(Dispatchers.IO) { check(applicationContext as App) }
        return Result.success()
    }

    companion object {
        /** O nome único do trabalho no WorkManager. */
        const val NAME = "atualizacao"

        /**
         * Agenda a verificação de 24 h, a cada começo do processo. Um agendamento que já existe passa a ser este (UPDATE:
         * o de uma versão anterior do app ganha o intervalo e as condições de agora, sem recomeçar a contagem).
         */
        fun schedule(context: Context): Operation {
            val request = PeriodicWorkRequestBuilder<UpdateWorker>(24, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInitialDelay(24, TimeUnit.HOURS)
                .build()
            return WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
        }

        /**
         * A verificação de 24 h, fora da thread principal: a decisão, e a notificação se há versão nova com o app em
         * segundo plano (sem a permissão de notificações, fica o aviso da próxima abertura).
         */
        fun check(app: App): Decision {
            val decision = try {
                app.updater.checkNow()
            } catch (e: Exception) {
                app.note("atualização: a verificação de 24 h falhou (${e.javaClass.simpleName})")
                return Decision.NONE
            }
            if (decision is Decision.PROMPT && !app.updater.visible) UpdateNotification.show(app, decision.manifest)
            return decision
        }
    }
}

/**
 * A notificação de versão nova encontrada com o app em segundo plano: canal "atualizacao" ("Atualizações", importância
 * padrão), com a pergunta e as notas. Tocar nela abre o app, que mostra o aviso; ela sai quando o aviso aparece.
 */
object UpdateNotification {
    /** O canal das notificações de atualização. */
    const val CHANNEL_ID = "atualizacao"

    private const val CHANNEL_NAME = "Atualizações"
    private const val ID = 4   // 1: a fixa do serviço; 2: a da ligação recebida; 3: as perdidas
    private const val REQUEST_OPEN = 5

    /** Mostra a notificação de [manifest], se o app pode mostrar notificações. */
    fun show(context: Context, manifest: Manifest) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (!manager.areNotificationsEnabled()) return
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(
            context,
            REQUEST_OPEN,
            Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_starsonic)
            .setContentTitle(UpdateDecider.question(manifest.versionText))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
        if (manifest.notes.isNotBlank()) {
            builder.setContentText(manifest.notes).setStyle(NotificationCompat.BigTextStyle().bigText(manifest.notes))
        }
        try {
            manager.notify(ID, builder.build())
        } catch (e: SecurityException) {
            // A permissão de notificações saiu agora há pouco: fica o aviso da próxima abertura.
        }
    }

    /** Tira a notificação (o aviso apareceu na tela). */
    fun cancel(context: Context) {
        context.getSystemService(NotificationManager::class.java).cancel(ID)
    }
}
