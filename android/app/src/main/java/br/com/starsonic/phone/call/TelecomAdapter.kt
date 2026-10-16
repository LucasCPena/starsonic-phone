package br.com.starsonic.phone.call

/**
 * O Telecom do Android (modo self-managed) visto pelo [CallManager]. Uma ligação por vez: a feita só ganha o
 * id do motor depois do makeCall, então [setActive] e [disconnect] com [CallManager.NO_ID] valem para a feita
 * que ainda não tem id.
 */
interface TelecomAdapter {
    /** O Android deixa entrar uma ligação agora (false: uma ligação da operadora em andamento). */
    fun incomingPermitted(): Boolean

    /** Uma ligação chegou e toca: o Android cria a Connection dela e pede a notificação de ligação. */
    fun addIncoming(callId: Int, number: String, name: String)

    /** Pede ao Android para ligar pela conta do app; quando ele cria a Connection, o motor liga. */
    fun placeOutgoing(number: String)

    /** A ligação foi atendida (dos dois lados). */
    fun setActive(callId: Int)

    /** A ligação foi para a espera. */
    fun setOnHold(callId: Int)

    /** A ligação acabou; cause é um android.telecom.DisconnectCause ([EndCause]). */
    fun disconnect(callId: Int, cause: Int)
}
