package br.com.starsonic.phone.permissions

/** Um aviso da faixa (stub). */
enum class Banner(val text: String) {
    NOTIFICATIONS(""),
    MICROPHONE(""),
    FULL_SCREEN(""),
    BATTERY(""),
}

/** Os avisos da faixa (stub). */
object Banners {
    fun first(notificationsOk: Boolean, microphoneOk: Boolean, fullScreenOk: Boolean, batteryOk: Boolean): Banner? = null

    fun missing(notificationsOk: Boolean, microphoneOk: Boolean, fullScreenOk: Boolean, batteryOk: Boolean): List<Banner> =
        emptyList()
}
