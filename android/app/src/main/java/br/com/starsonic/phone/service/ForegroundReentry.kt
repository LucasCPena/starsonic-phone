package br.com.starsonic.phone.service

import br.com.starsonic.phone.call.CallUi

/**
 * Quando o [SipService] entra de novo em primeiro plano, e com que tipos, conforme a ligação muda: os tipos da ligação
 * ([callTypes]: phoneCall e microphone, do mais completo ao de sempre) entram com uma ligação que usa o microfone e saem
 * quando ela acaba, voltando aos de sempre ([baseTypes]). [onCall] recebe cada mudança da ligação e o tipo que o Android
 * aceitou da última vez. Só na thread principal.
 */
internal class ForegroundReentry(private val callTypes: () -> List<Int>, private val baseTypes: () -> List<Int>) {
    private var microphone: Boolean? = null   // a última ligação vista usa o microfone (null: nenhuma vista ainda)

    /**
     * A ligação agora é [call] (null: nenhuma), e o Android aceitou [accepted] da última vez (null: nenhum ainda): os tipos
     * a pedir agora, do mais completo ao de sempre, ou null se nada muda.
     */
    fun onCall(call: CallUi?, accepted: Int?): List<Int>? {
        val now = call?.usesMicrophone == true
        if (now == microphone) return null
        microphone = now
        val inCall = accepted != null && accepted != baseTypes().first()
        return when {
            now == inCall -> null
            now -> callTypes()
            else -> baseTypes()
        }
    }
}
