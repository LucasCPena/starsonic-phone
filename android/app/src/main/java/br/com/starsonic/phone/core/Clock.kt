package br.com.starsonic.phone.core

import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/** Um aviso marcado num [Clock]; [cancel] antes da hora o desmarca. */
fun interface Scheduled {
    fun cancel()
}

/** A hora e os avisos com hora marcada (nos testes, um relógio falso que anda à mão). */
interface Clock {
    fun nowMillis(): Long

    /** Roda [action] daqui a [delayMillis] ms, fora da thread principal. */
    fun schedule(delayMillis: Long, action: () -> Unit): Scheduled
}

/** O relógio do celular: os avisos rodam numa thread própria ("starsonic-relogio"), um de cada vez. */
class DeviceClock : Clock {
    private val timer: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { task ->
        Thread(task, "starsonic-relogio").also { it.isDaemon = true }
    }

    override fun nowMillis(): Long = System.currentTimeMillis()

    override fun schedule(delayMillis: Long, action: () -> Unit): Scheduled {
        val pending = timer.schedule(Runnable { action() }, delayMillis, TimeUnit.MILLISECONDS)
        return Scheduled { pending.cancel(false) }
    }
}
