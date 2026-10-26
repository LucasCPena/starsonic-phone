package br.com.starsonic.phone.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A notificação fixa nunca fica num título velho (R23). O Android põe na tela a notificação do startForeground depois,
 * pelo ActivityManager, e a de um notify() vai direto: um título mandado direto logo depois de um início chegaria antes
 * do título do início, que ficaria por cima. Os títulos novos esperam o início aparecer na tela; e um título que não
 * aparece a tempo vai de novo.
 */
class ConnectionNoticeTest {
    private val posts = mutableListOf<Pair<String, Long>>()
    private val notice = ConnectionNotice { title, seq -> posts += title to seq }

    // Um startForeground com [title]: o número da notificação dele.
    private fun start(title: String): Long = notice.nextSeq().also { notice.started(it, title) }

    private fun titles() = posts.map { it.first }

    @Test
    fun `a title that changes while the start is on its way goes out after the start shows`() {
        // A corrida: o "Conectado" mandado na hora chegaria antes do "Conectando…" do início, e o início ficaria por cima.
        val start = start(CONNECTING)
        notice.titleChanged(CONNECTED)
        assertEquals("nada vai antes de o início aparecer", emptyList<String>(), titles())
        assertTrue(notice.waiting)
        notice.shown(null)   // o início ainda não chegou à tela
        assertEquals(emptyList<String>(), titles())
        notice.shown(start)
        assertEquals(listOf(CONNECTED), titles())
        assertTrue("o número novo vem depois do do início", posts.single().second > start)
        assertTrue("confere até o Conectado aparecer", notice.waiting)
        notice.shown(posts.single().second)
        assertFalse(notice.waiting)
    }

    @Test
    fun `a start that shows with the title of now needs nothing more`() {
        val start = start(CONNECTED)
        notice.titleChanged(CONNECTED)
        notice.shown(start)
        assertEquals(emptyList<String>(), titles())
        assertFalse(notice.waiting)
    }

    @Test
    fun `after the start shows, each new title goes out at once and in order`() {
        notice.shown(start(CONNECTING))
        notice.titleChanged(CONNECTED)
        notice.titleChanged(DO_NOT_DISTURB)
        assertEquals(listOf(CONNECTED, DO_NOT_DISTURB), titles())
        assertTrue(posts[1].second > posts[0].second)
    }

    @Test
    fun `an older start on the screen does not release a newer one`() {
        // A ligação começa: outro startForeground (com os tipos dela) e o título dela.
        notice.shown(start(CONNECTED))
        val call = start(BUSY)
        notice.titleChanged(CONNECTED)   // e acaba logo
        notice.shown(call - 1)
        assertEquals("o início da ligação ainda não apareceu", emptyList<String>(), titles())
        notice.shown(call)
        assertEquals(listOf(CONNECTED), titles())
    }

    @Test
    fun `a start that never shows lets the title of now go out`() {
        start(CONNECTING)
        notice.titleChanged(CONNECTED)
        notice.timedOut()
        assertEquals(listOf(CONNECTED), titles())
    }

    @Test
    fun `a title that never shows goes out again`() {
        notice.shown(start(CONNECTING))
        notice.titleChanged(CONNECTED)
        notice.timedOut()   // o Android não o pôs na tela
        assertEquals(listOf(CONNECTED, CONNECTED), titles())
        assertTrue(posts[1].second > posts[0].second)
        notice.shown(posts[1].second)
        assertFalse(notice.waiting)
    }

    @Test
    fun `an old title back on the screen is replaced again`() {
        val start = start(CONNECTING)
        notice.shown(start)
        notice.titleChanged(CONNECTED)
        notice.shown(start)   // o velho por cima do Conectado
        assertTrue("o Conectado ainda não apareceu", notice.waiting)
        notice.timedOut()
        assertEquals(listOf(CONNECTED, CONNECTED), titles())
    }

    @Test
    fun `the same title does not go out twice`() {
        notice.shown(start(CONNECTED))
        notice.titleChanged(CONNECTED)
        assertEquals(emptyList<String>(), titles())
        assertFalse(notice.waiting)
    }

    private companion object {
        const val CONNECTING = "Conectando…"
        const val CONNECTED = "Conectado (ramal 2001)"
        const val DO_NOT_DISTURB = "Não perturbe (ramal 2001)"
        const val BUSY = "Ocupado · em ligação"
    }
}
