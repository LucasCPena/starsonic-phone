package br.com.starsonic.phone.permissions

/**
 * O que falta no celular para o app receber ligações: cada item é um aviso da faixa (spec 11.1), na ordem da
 * prioridade. A tela Permissões explica cada um com o mesmo texto.
 */
enum class Banner(val text: String) {
    NOTIFICATIONS("Permita as notificações para receber ligações."),
    MICROPHONE("Permita o microfone para fazer e receber ligações."),
    FULL_SCREEN("Permita a tela cheia para ver as ligações com o celular bloqueado."),
    BATTERY("Libere o uso de bateria para receber ligações com o app fechado."),
}

/** Os avisos da faixa: um por vez, o primeiro que falta na ordem da prioridade. */
object Banners {
    /** O aviso da faixa, ou null se nada falta. */
    fun first(notificationsOk: Boolean, microphoneOk: Boolean, fullScreenOk: Boolean, batteryOk: Boolean): Banner? =
        missing(notificationsOk, microphoneOk, fullScreenOk, batteryOk).firstOrNull()

    /** Todos os que faltam, na ordem da prioridade (os itens da tela Permissões). */
    fun missing(notificationsOk: Boolean, microphoneOk: Boolean, fullScreenOk: Boolean, batteryOk: Boolean): List<Banner> =
        buildList {
            if (!notificationsOk) add(Banner.NOTIFICATIONS)
            if (!microphoneOk) add(Banner.MICROPHONE)
            if (!fullScreenOk) add(Banner.FULL_SCREEN)
            if (!batteryOk) add(Banner.BATTERY)
        }
}
