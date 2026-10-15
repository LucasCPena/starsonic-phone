package br.com.starsonic.phone.data

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Os Recentes num arquivo JSON (spec 4.1 e 6.4): até 200, das mais novas para as mais antigas. */
class RecentsStoreTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val file by lazy { File(folder.root, "recentes.json") }

    @Test
    fun `newest first`() {
        val store = RecentsStore(file)
        store.add(Recent("2002", "", CallKind.FEITA, 1_000, 10))
        store.add(Recent("3001", "Cliente Teste", CallKind.RECEBIDA, 3_000, 20))
        // Uma que chegou ocupada durante a recebida entra antes dela, mas começou depois.
        store.add(Recent("3002", "", CallKind.PERDIDA, 4_000, 0))
        store.add(Recent("3003", "", CallKind.PERDIDA, 2_000, 0))
        assertEquals(listOf("3002", "3001", "3003", "2002"), store.list().map { it.number })
        assertEquals(4, store.version.value)
    }

    @Test
    fun `201 entries keep 200 and the oldest leaves`() {
        val store = RecentsStore(file)
        for (i in 0..200) store.add(Recent("$i", "", CallKind.FEITA, 1_000L * i, 0))
        val kept = store.list()
        assertEquals(200, kept.size)
        assertEquals("200", kept.first().number)
        assertEquals("a mais antiga saiu", "1", kept.last().number)
        assertEquals("no disco também", kept, RecentsStore(file).list())
    }

    @Test
    fun `kinds and durations are written and read back`() {
        val written = listOf(
            Recent("+551150603000", "Cliente \"Teste\" ç", CallKind.RECEBIDA, 3_000, 125),
            Recent("3002", "", CallKind.PERDIDA, 2_000, 0),
            Recent("2002", "", CallKind.FEITA, 1_000, 7),
        )
        val store = RecentsStore(file)
        written.reversed().forEach { store.add(it) }
        assertEquals(written, RecentsStore(file).list())
    }

    @Test
    fun `a damaged file reads as empty and is replaced`() {
        file.writeText("{não é json")
        val store = RecentsStore(file)
        assertTrue(store.list().isEmpty())
        store.add(Recent("2002", "", CallKind.FEITA, 1_000, 0))
        assertEquals(1, RecentsStore(file).list().size)
    }

    @Test
    fun `clear empties the list`() {
        val store = RecentsStore(file)
        store.add(Recent("2002", "", CallKind.FEITA, 1_000, 0))
        store.clear()
        assertTrue(store.list().isEmpty())
        assertTrue(RecentsStore(file).list().isEmpty())
    }
}
