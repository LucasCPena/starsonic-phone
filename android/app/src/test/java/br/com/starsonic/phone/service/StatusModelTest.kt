package br.com.starsonic.phone.service

import org.junit.Assert.assertEquals
import org.junit.Test

/** O status da faixa e o título da notificação fixa, pelo último resultado do registro e pela rede. */
class StatusModelTest {
    private val core = FakeCore()

    @Test
    fun `registered shows Conectado with the ramal`() {
        val status = StatusModel.from(200, active = true, online = true, ramal = "2001", core = core)
        assertEquals("Conectado · 2001", status.band)
        assertEquals("Conectado (ramal 2001)", status.notificationTitle)
    }

    @Test
    fun `no answer yet shows Conectando`() {
        assertEquals(Status("Conectando…", "Conectando…"), StatusModel.from(null, false, true, "2001", core))
        // Uma resposta provisória, ou a conta saindo (200 sem registro), também.
        assertEquals(Status("Conectando…", "Conectando…"), StatusModel.from(100, false, true, "2001", core))
        assertEquals(Status("Conectando…", "Conectando…"), StatusModel.from(200, false, true, "2001", core))
    }

    @Test
    fun `offline shows Sem internet`() {
        // Sem rede, vale "Sem internet", mesmo com o último registro aceito ou com uma falha.
        assertEquals(Status("Sem internet", "Sem internet"), StatusModel.from(200, true, online = false, "2001", core))
        assertEquals(Status("Sem internet", "Sem internet"), StatusModel.from(null, false, online = false, "2001", core))
        assertEquals(Status("Sem internet", "Sem internet"), StatusModel.from(503, false, online = false, "2001", core))
    }

    @Test
    fun `a failure shows the core message`() {
        val status = StatusModel.from(403, false, true, "2001", core)
        assertEquals("Ramal ou senha incorretos.", status.band)
        assertEquals("Ramal ou senha incorretos.", status.notificationTitle)
        assertEquals(Status("registro 503", "registro 503"), StatusModel.from(503, false, true, "2001", core))
    }
}
