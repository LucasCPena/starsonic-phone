package br.com.starsonic.phone.call

/** Os extras de um pedido do Telecom, lidos por chave (no app, um android.os.Bundle; nos testes, um mapa). */
interface Extras {
    fun int(key: String): Int?

    fun string(key: String): String?
}

/** A recebida de um pedido do Telecom: o id dela no motor, o número e o nome. */
data class IncomingRequest(val callId: Int, val number: String, val name: String)

/**
 * A recebida que o Telecom pede ao app (onCreateIncomingConnection e onCreateIncomingConnectionFailed).
 *
 * O app manda ao addNewIncomingCall o id, o número e o nome aninhados em TelecomManager.EXTRA_INCOMING_CALL_EXTRAS,
 * e o Telecom devolve o pacote inteiro como os extras do pedido: eles vêm do pacote aninhado. O nível de cima
 * (outras versões do Android), a recebida que toca no app (uma ligação por vez; só se for a mesma) e o endereço
 * da ligação são a reserva.
 */
object IncomingExtras {
    const val CALL_ID = "br.com.starsonic.phone.extra.LIGACAO"
    const val NUMBER = "br.com.starsonic.phone.extra.NUMERO"
    const val NAME = "br.com.starsonic.phone.extra.NOME"

    /** O nome de quem liga quando não há nome, número nem endereço (o CallStyle não aceita uma pessoa sem nome). */
    const val UNKNOWN_CALLER = "Número desconhecido"

    fun read(nested: Extras?, top: Extras?, ringing: IncomingRequest?, address: String): IncomingRequest {
        val callId = nested?.int(CALL_ID)?.takeIf { it != CallManager.NO_ID }
            ?: top?.int(CALL_ID)?.takeIf { it != CallManager.NO_ID }
            ?: ringing?.callId
            ?: CallManager.NO_ID
        val same = ringing?.takeIf { it.callId == callId }
        val number = nested?.string(NUMBER) ?: top?.string(NUMBER) ?: same?.number ?: address
        val name = nested?.string(NAME) ?: top?.string(NAME) ?: same?.name ?: ""
        return IncomingRequest(callId, number, name)
    }

    /** O nome de quem liga na notificação: o nome, o número ou o endereço da ligação; nunca vazio. */
    fun callerName(name: String, number: String, address: String): String =
        name.ifBlank { number }.ifBlank { address }.ifBlank { UNKNOWN_CALLER }
}
