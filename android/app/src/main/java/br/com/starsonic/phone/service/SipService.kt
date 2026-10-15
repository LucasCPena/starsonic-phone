package br.com.starsonic.phone.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder

/** O serviço em primeiro plano que mantém a conta registrada (stub). */
class SipService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "br.com.starsonic.phone.action.START"

        @Volatile
        var running = false
            private set

        @Volatile
        var startCommands = 0
            private set

        fun start(context: Context): Boolean = false

        fun stop(context: Context) {}
    }
}
