package br.com.starsonic.phone.update

import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.IntentCompat
import br.com.starsonic.phone.App
import java.io.File
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * A instalação pelo Android (spec 7.6.5): a permissão de instalar apps (o "Instalar apps desconhecidos" do app, que a
 * pessoa dá na primeira vez) e uma sessão do PackageInstaller com o APK conferido. O Android responde pelo
 * [UpdateStatusReceiver]: a confirmação (STATUS_PENDING_USER_ACTION) espera em [confirmation] até uma tela do app
 * abri-la, com o app na frente (a MainActivity, que a tira daqui com [takeConfirmation]); a pessoa toca em "Atualizar"
 * e o Android troca o app (o serviço volta pelo MY_PACKAGE_REPLACED). As falhas do Android (a pessoa cancelou, um APK
 * de outra assinatura) só vão ao log, como no Windows: o app continua na versão de agora.
 */
class AndroidInstaller(private val context: Context, private val log: (String) -> Unit = {}) : UpdateInstaller {
    private val main = Handler(Looper.getMainLooper())
    private val mutableConfirmation = MutableStateFlow<Intent?>(null)

    /** A confirmação da instalação, esperando uma tela do app para abri-la (null: nenhuma). */
    val confirmation: StateFlow<Intent?> = mutableConfirmation

    override fun allowed(): Boolean = context.packageManager.canRequestPackageInstalls()

    // A pessoa acabou de tocar em Atualizar: o app está na frente. O ajuste abre pela thread principal.
    override fun askPermission() {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        main.post {
            try {
                context.startActivity(intent)
            } catch (e: ActivityNotFoundException) {
                log("o ajuste de instalar apps não abriu")
            }
        }
    }

    // Na thread do atualizador: copia o APK para uma sessão nova (só deste pacote) e a entrega ao Android.
    override fun install(apk: File) {
        val packageInstaller = context.packageManager.packageInstaller
        // A sessão de uma tentativa anterior (a confirmação cancelada) sai.
        for (old in packageInstaller.mySessions) {
            try {
                packageInstaller.abandonSession(old.sessionId)
            } catch (e: SecurityException) {
                // Já saiu.
            }
        }
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
            setInstallReason(PackageManager.INSTALL_REASON_USER)
        }
        val sessionId = packageInstaller.createSession(params)
        try {
            packageInstaller.openSession(sessionId).use { session ->
                session.openWrite(APK_IN_SESSION, 0, apk.length()).use { output ->
                    apk.inputStream().use { input -> input.copyTo(output, BUFFER_BYTES) }
                    session.fsync(output)
                }
                session.commit(statusReceiver(sessionId).intentSender)
            }
        } catch (e: Exception) {
            try {
                packageInstaller.abandonSession(sessionId)
            } catch (ignored: Exception) {
                // A sessão já não existe.
            }
            throw e as? IOException ?: IOException(e)
        }
    }

    /** O resultado da sessão (do [UpdateStatusReceiver]). Qualquer thread. */
    fun onStatus(intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
                if (confirm == null) {
                    log("o Android pediu a confirmação da instalação, sem a tela dela")
                    return
                }
                log("o Android pede a confirmação da instalação")
                mutableConfirmation.value = confirm
            }
            PackageInstaller.STATUS_SUCCESS -> log("a atualização foi instalada")
            else -> log(
                "o Android não instalou a atualização (status $status: " +
                    "${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)})",
            )
        }
    }

    /**
     * Uma tela do app vai abrir a confirmação [intent]: ela sai de [confirmation]. false se outra tela já a pegou (só uma
     * a abre).
     */
    fun takeConfirmation(intent: Intent): Boolean = mutableConfirmation.compareAndSet(intent, null)

    // O pedido em que o Android responde (EXTRA_STATUS e, para a confirmação, EXTRA_INTENT): por isso, mutável.
    private fun statusReceiver(sessionId: Int): PendingIntent {
        val intent = Intent(context, UpdateStatusReceiver::class.java).setAction(ACTION_STATUS)
        val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        return PendingIntent.getBroadcast(context, sessionId, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
    }

    companion object {
        /** A resposta da sessão do PackageInstaller (só para o [UpdateStatusReceiver], que não é exportado). */
        const val ACTION_STATUS = "br.com.starsonic.phone.action.ATUALIZACAO"

        private const val APK_IN_SESSION = "starsonic-phone.apk"
        private const val BUFFER_BYTES = 64 * 1024
    }
}

/** A resposta da sessão do PackageInstaller. Não é exportado: só o Android (pelo pedido do app) chega aqui. */
class UpdateStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AndroidInstaller.ACTION_STATUS) return
        (context.applicationContext as App).updateInstaller.onStatus(intent)
    }
}

/**
 * A hora da última verificação, no SharedPreferences "atualizacao" (separado do da conta, que o Sair apaga). Lê o disco:
 * só na thread do atualizador.
 */
class PreferencesUpdateStore(private val preferences: () -> SharedPreferences) : UpdateStore {
    constructor(context: Context) : this({ context.getSharedPreferences(FILE, Context.MODE_PRIVATE) })

    override var lastCheckMillis: Long
        get() = preferences().getLong(KEY_LAST_CHECK, 0L)
        set(value) {
            preferences().edit().putLong(KEY_LAST_CHECK, value).apply()
        }

    private companion object {
        const val FILE = "atualizacao"
        const val KEY_LAST_CHECK = "ultima-verificacao"
    }
}
