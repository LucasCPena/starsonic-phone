package br.com.starsonic.phone.call

/** O tom de telefone da tecla [key]; null para o que não é tecla. */
fun keyTone(key: String): Int? = null

/** Se a tecla bipa. */
fun keyTonePlays(enabled: Boolean, ringerMode: Int, inCall: Boolean): Boolean = false
