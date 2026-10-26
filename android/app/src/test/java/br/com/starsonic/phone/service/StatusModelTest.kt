package br.com.starsonic.phone.service

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A tabela da bolinha (spec 7), em que vale a primeira linha que bate: o status da conta pelo último resultado do
 * registro e pela rede ([StatusModel.account]) e, só com a conta registrada, a ligação e o Não perturbe por cima
 * ([StatusModel.shown]).
 */
class StatusModelTest {
    private val core = FakeCore()

    private val offline = Status(Dot.OFFLINE, "Sem internet · tentando de novo", "Sem internet · tentando de novo")
    private val connecting = Status(Dot.CONNECTING, "Conectando…", "Conectando…")
    private val refused = Status(Dot.ERROR, "Ramal ou senha incorretos.", "Ramal ou senha incorretos.")
    private val unreachable = Status(Dot.NO_CONNECTION, "registro 503", "registro 503")
    private val registered = Status(Dot.ONLINE, "Conectado · starcloud1-starsonic.com.br", "Conectado (ramal 2001)")
    private val busy = Status(Dot.BUSY, "Ocupado · em ligação", "Ocupado · em ligação")

    // O status da conta 2001 do servidor starcloud1-starsonic.com.br.
    private fun account(code: Int?, active: Boolean = code in 200..299, online: Boolean = true): Status =
        StatusModel.account(code, active, online, ramal = "2001", server = "starcloud1-starsonic.com.br", core = core)

    @Test
    fun `offline wins over every other state`() {
        // Sem rede, vale "Sem internet", com o último registro aceito, sem resposta, numa falha, numa ligação e no
        // Não perturbe.
        for (code in listOf(200, null, 100, 403, 503, 0)) {
            val status = account(code, online = false)
            assertEquals("$code", offline, status)
            assertEquals("$code", offline, StatusModel.shown(status, "2001", inCall = true, doNotDisturb = true))
        }
    }

    @Test
    fun `connecting shows cyan`() {
        // Sem resposta ainda, uma provisória, ou a conta saindo (200 sem registro).
        assertEquals(connecting, account(null))
        assertEquals(connecting, account(100))
        assertEquals(connecting, account(180))
        assertEquals(connecting, account(200, active = false))
    }

    @Test
    fun `a refused password shows the error with the warning`() {
        for (code in listOf(401, 403, 407)) assertEquals("$code", refused, account(code))
        // As outras recusas do servidor também são o erro, com o aviso do núcleo.
        assertEquals(Status(Dot.ERROR, "registro 404", "registro 404"), account(404))
    }

    @Test
    fun `an unreachable server shows no warning`() {
        // A central não responde (0 ou menos), 408 e os 5xx: "sem conexão", cinza e sem o triângulo, com o aviso do
        // núcleo.
        for (code in listOf(0, -1, 408, 500, 503, 599)) {
            assertEquals("$code", Status(Dot.NO_CONNECTION, "registro $code", "registro $code"), account(code))
        }
        // Logo fora deles, o erro, com o triângulo.
        for (code in listOf(404, 409, 499, 600, 603)) assertEquals("$code", Dot.ERROR, account(code).dot)
    }

    @Test
    fun `a call turns the registered dot red`() {
        assertEquals(busy, StatusModel.shown(registered, "2001", inCall = true, doNotDisturb = false))
    }

    @Test
    fun `do not disturb turns the registered dot red`() {
        assertEquals(
            Status(Dot.BUSY, "Não perturbe · as ligações não tocam", "Não perturbe (ramal 2001)"),
            StatusModel.shown(registered, "2001", inCall = false, doNotDisturb = true),
        )
    }

    @Test
    fun `a call wins over do not disturb`() {
        assertEquals(busy, StatusModel.shown(registered, "2001", inCall = true, doNotDisturb = true))
    }

    @Test
    fun `registered shows the server and the ramal`() {
        assertEquals(registered, account(200))
        assertEquals(registered, StatusModel.shown(registered, "2001", inCall = false, doNotDisturb = false))
    }

    @Test
    fun `errors and offline ignore calls and do not disturb`() {
        // Só a conta registrada fica vermelha: sem rede, conectando, no erro e sem conexão, vale a linha da conta.
        for (status in listOf(offline, connecting, refused, unreachable)) {
            for ((inCall, doNotDisturb) in listOf(true to false, false to true, true to true)) {
                assertEquals("$status", status, StatusModel.shown(status, "2001", inCall, doNotDisturb))
            }
        }
    }
}
