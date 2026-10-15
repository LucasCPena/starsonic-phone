package br.com.starsonic.phone.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import br.com.starsonic.phone.App
import kotlin.concurrent.thread

/**
 * Liga o [SipService] depois de o celular ligar (BOOT_COMPLETED, que chega depois do primeiro desbloqueio: a
 * senha fica no armazenamento cifrado do Android) e depois de o app ser atualizado (MY_PACKAGE_REPLACED), se
 * há conta gravada (spec 7.2). Os dois avisos deixam o app iniciar o serviço em primeiro plano estando em
 * segundo plano; o serviço entra só como specialUse, que o Android 15 ainda deixa começar no boot.
 *
 * A conta é lida fora da thread principal (Keystore e disco), com o aviso segurado por goAsync().
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val app = context.applicationContext as App
        val pending = goAsync()
        thread(name = "starsonic-boot") {
            try {
                if (app.store.load() != null) SipService.start(app)
            } finally {
                pending.finish()
            }
        }
    }
}
