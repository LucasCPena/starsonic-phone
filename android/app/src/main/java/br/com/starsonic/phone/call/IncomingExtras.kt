package br.com.starsonic.phone.call

/** Os extras de um pedido do Telecom, lidos por chave (no app, um android.os.Bundle; nos testes, um mapa). */
interface Extras {
    fun int(key: String): Int?

    fun string(key: String): String?
}

/** A recebida de um pedido do Telecom: o id dela no motor, o número e o nome. */
data class IncomingRequest(val callId: Int, val number: String, val name: String)

/** Os extras da recebida (stub do fix round 2: a implementação vem no verde). */
object IncomingExtras {
    const val CALL_ID = "br.com.starsonic.phone.extra.LIGACAO"
    const val NUMBER = "br.com.starsonic.phone.extra.NUMERO"
    const val NAME = "br.com.starsonic.phone.extra.NOME"

    fun read(nested: Extras?, top: Extras?, ringing: IncomingRequest?, address: String): IncomingRequest =
        IncomingRequest(CallManager.NO_ID, "", "")

    fun callerName(name: String, number: String, address: String): String = name
}
