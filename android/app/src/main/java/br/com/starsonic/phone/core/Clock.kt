package br.com.starsonic.phone.core

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
