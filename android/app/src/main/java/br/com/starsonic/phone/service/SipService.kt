package br.com.starsonic.phone.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import br.com.starsonic.phone.App
import br.com.starsonic.phone.R
import br.com.starsonic.phone.main.MainActivity
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * O serviço em primeiro plano que mantém a conta gravada registrada (spec 6.2 e 7.2), com a notificação fixa
 * (canal "conexao", importância baixa): o título é o status da conta ([Connection.status]), e tocar nela abre
 * o app.
 *
 * - Começa por [start] (ACTION_START): no fim do Entrar, ao abrir o app com a conta gravada, depois de ligar
 *   o celular e de atualizar o app ([BootReceiver]). O sistema também o recria sozinho depois de fechar o
 *   processo (START_STICKY, com a intent nula), e aí ele faz o mesmo.
 * - Entra em primeiro plano só como specialUse (Android 14+); phoneCall e microphone entram só durante uma
 *   ligação (Task 8).
 * - Numa thread própria ("starsonic-servico"), lê a conta gravada (Keystore e disco), sobe o motor (uma vez
 *   por processo) e segura a conta ([Connection.adopt]): a que a tela Entrar acabou de registrar fica, sem
 *   outro REGISTER. Sem conta gravada, sai na hora.
 * - Parar ([stop]) tira a conta do motor ([Connection.release]); o motor fica de pé.
 * - O [NetworkMonitor] refaz o registro nas trocas de rede e marca "Sem internet".
 */
class SipService : Service() {
    private val app: App
        get() = application as App

    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var worker: ExecutorService
    private lateinit var monitor: NetworkMonitor
    private var notifications: Job? = null   // só na thread principal
    private var monitoring = false           // só na thread do serviço

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        app.connection.claim(this)
        worker = Executors.newSingleThreadExecutor { task -> Thread(task, "starsonic-servico") }
        monitor = NetworkMonitor(app.connection)
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) },
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // intent nula: o sistema recriou o serviço depois de fechar o processo (START_STICKY); vale como
        // ACTION_START. Quem começa com startForegroundService precisa entrar em primeiro plano já, mesmo que
        // saia em seguida (sem conta gravada).
        startCommands++
        if (!enterForeground()) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        if (notifications == null) {
            notifications = scope.launch {
                app.connection.status.map { it.notificationTitle }.distinctUntilChanged().collect { title ->
                    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(title))
                }
            }
        }
        worker.execute { connect(startId) }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()   // nenhuma notificação depois daqui
        app.connection.release(this)
        worker.execute { monitor.stop() }   // na mesma thread que o ligou, depois dele
        worker.shutdown()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        running = false
        super.onDestroy()
    }

    // Na thread do serviço: a conta gravada, o motor e a rede.
    private fun connect(startId: Int) {
        val account = app.store.load()
        if (account == null) {
            // Sem conta gravada (ou a senha não abre): nada a manter, e o serviço sai (se nenhum outro pedido
            // chegou depois deste).
            main.post { stopSelf(startId) }
            return
        }
        if (!app.connection.adopt(this, account)) return
        if (!monitoring) {
            monitoring = true
            monitor.start(this)
            scope.launch(Dispatchers.Default) { monitor.online.collect { app.connection.setOnline(this@SipService, it) } }
        }
    }

    private fun enterForeground(): Boolean =
        try {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            } else {
                0
            }
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(app.connection.status.value.notificationTitle), type)
            true
        } catch (e: IllegalStateException) {
            // ForegroundServiceStartNotAllowedException: recriado em segundo plano sem poder (Android 12+).
            Log.w(TAG, "o serviço não entrou em primeiro plano", e)
            false
        } catch (e: SecurityException) {
            Log.w(TAG, "o serviço não entrou em primeiro plano", e)
            false
        }

    private fun notification(title: String): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_starsonic)
            .setContentTitle(title)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    companion object {
        /** O pedido para o serviço começar: o fim do Entrar, a abertura do app, o boot e a atualização. */
        const val ACTION_START = "br.com.starsonic.phone.action.START"

        /** O canal da notificação fixa. */
        const val CHANNEL_ID = "conexao"
        private const val CHANNEL_NAME = "Conexão"
        private const val NOTIFICATION_ID = 1
        private const val TAG = "SipService"

        /** O serviço está de pé (de onCreate a onDestroy). */
        @Volatile
        var running = false
            private set

        /** Quantos pedidos para começar o serviço recebeu neste processo (os testes esperam um). */
        @Volatile
        var startCommands = 0
            private set

        /**
         * Inicia o serviço em primeiro plano. false se o Android não deixa agora (Android 12+, com o app em
         * segundo plano e sem uma das exceções, como a isenção de bateria ou o BOOT_COMPLETED).
         */
        fun start(context: Context): Boolean =
            try {
                ContextCompat.startForegroundService(context, Intent(context, SipService::class.java).setAction(ACTION_START))
                true
            } catch (e: IllegalStateException) {
                Log.w(TAG, "o serviço não pôde começar", e)
                false
            } catch (e: SecurityException) {
                Log.w(TAG, "o serviço não pôde começar", e)
                false
            }

        /**
         * Para o serviço: a conta sai do motor (Sair, na Task 9). Chame depois de o serviço ter começado (o
         * Android derruba o app que para um serviço iniciado com startForegroundService antes de ele entrar em
         * primeiro plano).
         */
        fun stop(context: Context) {
            context.stopService(Intent(context, SipService::class.java))
        }
    }
}
