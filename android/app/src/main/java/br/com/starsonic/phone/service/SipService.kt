package br.com.starsonic.phone.service

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
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
 * - Entra em primeiro plano só como specialUse (Android 14+). Durante uma ligação que usa o microfone (a feita
 *   desde o Ligar; a recebida depois de atendida), acrescenta phoneCall e microphone; no fim, volta a só
 *   specialUse. O Android 14+ não deixa acrescentar o microphone com o app em segundo plano: a troca acontece
 *   quando a ligação muda e a cada início do serviço (a tela de chamada o inicia ao aparecer, com o app na
 *   frente); se o Android recusa, o serviço fica como estava e a ligação segue.
 * - Numa thread própria ("starsonic-servico"), lê a conta gravada (Keystore e disco), sobe o motor (uma vez
 *   por processo) e segura a conta ([Connection.adopt]): a que a tela Entrar acabou de registrar fica, sem
 *   outro REGISTER. Sem conta gravada, sai na hora.
 * - Parar ([stop]) tira a conta do motor ([Connection.release]); o motor fica de pé.
 * - O [NetworkMonitor] refaz o registro nas trocas de rede e marca "Sem internet".
 * - Com a conta gravada e com rede, segura o processador acordado ([KeepAwake], wake lock parcial
 *   "starsonic:conexao"; spec 7.2, item 6): com a tela apagada, a renovação do registro e o keep-alive não
 *   param. Sem rede, ou depois de parar, solta.
 */
class SipService : Service() {
    private val app: App
        get() = application as App

    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var worker: ExecutorService
    private lateinit var keepAwake: KeepAwake
    private lateinit var monitor: NetworkMonitor
    private var notifications: Job? = null   // só na thread principal
    private var inCall = false               // os tipos da ligação estão no serviço (só na thread principal)
    private var monitoring = false           // só na thread do serviço

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        app.connection.claim(this)
        worker = Executors.newSingleThreadExecutor { task -> Thread(task, "starsonic-servico") }
        keepAwake = KeepAwake(cpuLock())
        // Na hora, dentro do aviso do Android: na volta da rede, o processador fica acordado antes de o motor
        // registrar de novo.
        monitor = NetworkMonitor(app.connection) { online ->
            keepAwake.setOnline(online)
            app.connection.setOnline(this, online)
        }
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
            // Os tipos da ligação entram e saem com ela.
            scope.launch {
                app.calls.state.map { it?.usesMicrophone == true }.distinctUntilChanged().collect { call ->
                    if (call != inCall) enterForeground()
                }
            }
        }
        worker.execute { connect(startId) }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()   // nenhuma notificação depois daqui
        keepAwake.close()   // o processador volta a dormir (de vez para este serviço)
        app.connection.release(this)
        worker.execute { monitor.stop() }   // na mesma thread que o ligou, depois dele
        worker.shutdown()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        running = false
        super.onDestroy()
    }

    // Na thread do serviço: a conta gravada, o motor e a rede. A conta lida aqui pode ficar velha (a tela Entrar
    // grava outra logo depois): a conexão não a põe por cima de uma conta da tela Entrar, e o início do serviço
    // que vem depois do Entrar lê a nova.
    private fun connect(startId: Int) {
        val account = app.store.load()
        if (account == null) {
            // Sem conta gravada (ou a senha não abre): nada a manter, e o serviço sai (se nenhum outro pedido
            // chegou depois deste).
            main.post { stopSelf(startId) }
            return
        }
        // O processador fica acordado já no registro (que a adoção pode fazer); se o serviço não ficou com a
        // conta, solta.
        keepAwake.setAccount(true)
        val adoption = app.connection.adopt(this, account)
        if (adoption == Adoption.STOPPED || adoption == Adoption.REFUSED) keepAwake.setAccount(false)
        if (adoption == Adoption.STOPPED) return
        if (!monitoring) {
            monitoring = true
            monitor.start(this)   // o começo já diz se há rede (Connection e KeepAwake)
        }
    }

    // O wake lock parcial da conexão, sem contagem (pegar duas vezes é pegar uma).
    private fun cpuLock(): CpuLock {
        val wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
            .apply { setReferenceCounted(false) }
        return object : CpuLock {
            // Sem prazo, de propósito: fica preso enquanto a conta está conectada (decisão 6 da spec) e sai
            // pelo KeepAwake (sem rede, ou quando o serviço para).
            @SuppressLint("WakelockTimeout")
            override fun acquire() = wakeLock.acquire()

            override fun release() = wakeLock.release()
        }
    }

    // Na thread principal: entra (ou continua) em primeiro plano com os tipos de agora. Com uma ligação, tenta
    // os tipos dela, do mais completo ao só specialUse; false se nem esse o Android aceitou.
    private fun enterForeground(): Boolean {
        val call = app.calls.state.value?.usesMicrophone == true
        for (type in foregroundTypes(call)) {
            try {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(app.connection.status.value.notificationTitle), type)
                inCall = call && type != foregroundTypes(false).single()
                return true
            } catch (e: IllegalStateException) {
                // ForegroundServiceStartNotAllowedException: recriado em segundo plano sem poder (Android 12+).
                Log.w(TAG, "o serviço não entrou em primeiro plano (tipos $type)", e)
            } catch (e: SecurityException) {
                // O microfone com o app em segundo plano (Android 14+), ou uma permissão que falta.
                Log.w(TAG, "o serviço não entrou em primeiro plano (tipos $type)", e)
            }
        }
        return false
    }

    // Os tipos a tentar, em ordem: com a ligação, phoneCall e microphone (só com a permissão do microfone), depois
    // só phoneCall; por último, os de sempre (specialUse no Android 14+; nenhum antes).
    private fun foregroundTypes(call: Boolean): List<Int> {
        val base = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        if (!call || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return listOf(base)
        val phoneCall = base or ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
        val microphone = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        return if (microphone) {
            listOf(phoneCall or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE, phoneCall, base)
        } else {
            listOf(phoneCall, base)
        }
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

        /** A etiqueta do wake lock da conexão (aparece no dumpsys power; o CI confere). */
        const val WAKE_LOCK_TAG = "starsonic:conexao"

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

        /** Renova agora o registro da conta do serviço. Esboço: não faz nada. */
        fun reregister(): Boolean = false

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
