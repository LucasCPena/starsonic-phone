package br.com.starsonic.phone.service

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
    fun `NetworkMonitor starts offline without a network`() {
        val monitor = NetworkMonitor(engine)
        monitor.begin(null)
        assertFalse(monitor.online.value)
        monitor.onAvailable("wi-fi")
        assertTrue(monitor.online.value)
        assertEquals(1, engine.ipChanges)
    }
}
