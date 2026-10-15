package br.com.starsonic.phone.service

import br.com.starsonic.phone.engine.SipGateway
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A rede padrão do celular: a troca refaz o registro, e a perda marca o celular sem internet. */
class NetworkMonitorTest {
    private val engine = FakeEngine()

    @Test
    fun `NetworkMonitor re-registers on network change`() {
        val monitor = NetworkMonitor(engine)
        monitor.begin("wi-fi")
        assertTrue(monitor.online.value)
        monitor.onAvailable("wi-fi")   // o primeiro aviso do Android é a rede de agora: nada a refazer
        assertEquals(0, engine.ipChanges)

        monitor.onAvailable("4g")   // trocou de rede
        assertEquals(1, engine.ipChanges)
        assertTrue(monitor.online.value)

        monitor.onLost("wi-fi")   // a rede que já tinha saído: nada muda
        assertTrue(monitor.online.value)
        monitor.onLost("4g")
        assertFalse(monitor.online.value)
        assertEquals(1, engine.ipChanges)

        monitor.onAvailable("wi-fi de novo")   // a rede voltou: registra de novo
        assertTrue(monitor.online.value)
        assertEquals(2, engine.ipChanges)
    }

    @Test
    fun `the service hears the network come back before the engine registers again`() {
        // O serviço segura o processador na volta da rede (spec 7.2, item 6) antes de o motor pôr o novo
        // registro na fila: sem isso, o celular poderia dormir no meio.
        val heard = mutableListOf<String>()
        val gateway = object : SipGateway by engine {
            override fun handleIpChange() {
                heard += "registra de novo"
            }
        }
        val monitor = NetworkMonitor(gateway) { online -> heard += if (online) "com rede" else "sem rede" }
        monitor.begin("wi-fi")
        monitor.onAvailable("wi-fi")   // o primeiro aviso do Android: nada muda
        monitor.onAvailable("4g")      // trocou de rede, sem ficar sem: o serviço segue como está
        monitor.onLost("4g")
        monitor.onLost("4g")           // um aviso repetido não conta de novo
        monitor.onAvailable("wi-fi de novo")
        assertEquals(
            listOf("com rede", "registra de novo", "sem rede", "com rede", "registra de novo"),
            heard,
        )
    }

    @Test
    fun `NetworkMonitor starts offline without a network`() {
        val monitor = NetworkMonitor(engine)
        monitor.begin(null)
        assertFalse(monitor.online.value)
        monitor.onAvailable("wi-fi")
        assertTrue(monitor.online.value)
        assertEquals(1, engine.ipChanges)
    }
}
