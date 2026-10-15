package br.com.starsonic.phone.call

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A recebida que o Telecom pede ao app (onCreateIncomingConnection): o id, o número e o nome vêm dos extras que
 * o app mandou, aninhados; o nível de cima, a recebida que toca no app e o endereço da ligação são só a reserva.
 * E o nome de quem liga na notificação nunca é vazio (o CallStyle não aceita).
 */
class IncomingExtrasTest {
    /** Extras de um mapa (no app, um android.os.Bundle). */
    private class MapExtras(private val values: Map<String, Any>) : Extras {
        override fun int(key: String): Int? = values[key] as? Int

        override fun string(key: String): String? = values[key] as? String
    }

    private fun extras(id: Int, number: String, name: String) = MapExtras(
        mapOf(IncomingExtras.CALL_ID to id, IncomingExtras.NUMBER to number, IncomingExtras.NAME to name),
    )

    private val nothing = MapExtras(emptyMap())

    @Test
    fun `the nested extras the app sent win`() {
        assertEquals(
            IncomingRequest(1, "3001", "Cliente Teste"),
            IncomingExtras.read(
                nested = extras(1, "3001", "Cliente Teste"),
                top = extras(9, "9999", "Outro"),
                ringing = IncomingRequest(8, "8888", "Mais um"),
                address = "7777",
            ),
        )
    }

    @Test
    fun `without the nested extras the top level counts`() {
        assertEquals(
            IncomingRequest(2, "3002", ""),
            IncomingExtras.read(nested = null, top = extras(2, "3002", ""), ringing = null, address = "3002"),
        )
    }

    @Test
    fun `without extras the call that rings in the app counts`() {
        assertEquals(
            IncomingRequest(3, "3003", "Fulano"),
            IncomingExtras.read(nested = nothing, top = nothing, ringing = IncomingRequest(3, "3003", "Fulano"), address = "3003"),
        )
    }

    @Test
    fun `the call that rings only fills a request for the same call`() {
        // O id veio, o número e o nome não: a que toca é outra ligação; o número vem do endereço da ligação.
        assertEquals(
            IncomingRequest(4, "3004", ""),
            IncomingExtras.read(
                nested = MapExtras(mapOf(IncomingExtras.CALL_ID to 4)),
                top = null,
                ringing = IncomingRequest(5, "3005", "Outra"),
                address = "3004",
            ),
        )
        assertEquals(
            IncomingRequest(CallManager.NO_ID, "3006", ""),
            IncomingExtras.read(nested = null, top = null, ringing = null, address = "3006"),
        )
    }

    @Test
    fun `the caller name is never empty`() {
        assertEquals("Cliente Teste", IncomingExtras.callerName("Cliente Teste", "3001", "3001"))
        assertEquals("3001", IncomingExtras.callerName("", "3001", "3001"))
        assertEquals("3001", IncomingExtras.callerName(" ", "", "3001"))
        assertEquals("Número desconhecido", IncomingExtras.callerName("", "", ""))
    }
}
