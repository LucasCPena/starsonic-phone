package br.com.starsonic.phone.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * O Rediscar (spec 6 e 11): a feita mais nova dos Recentes, com o número como foi discado, e o nome dele para o leitor
 * de tela e para a dica do aperto longo.
 */
class RedialTest {
    @Test
    fun `the newest dialed call is the redial`() {
        val older = Recent("2002", "", CallKind.FEITA, 1_000, 30)
        val newest = Recent("2005", "", CallKind.FEITA, 3_000, 125)
        // Na ordem dos Recentes (a mais nova primeiro), com uma recebida e uma perdida mais novas que as feitas.
        val recents = listOf(
            Recent("3001", "Cliente Teste", CallKind.RECEBIDA, 5_000, 62),
            Recent("3002", "", CallKind.PERDIDA, 4_000, 0),
            newest,
            older,
        )
        assertSame(newest, lastDialed(recents))
        // Vale o começo da ligação, não a posição na lista.
        assertSame(newest, lastDialed(recents.reversed()))
    }

    @Test
    fun `received and missed calls are not redialed`() {
        val recents = listOf(
            Recent("3001", "Cliente Teste", CallKind.RECEBIDA, 5_000, 62),
            Recent("3002", "", CallKind.PERDIDA, 4_000, 0),
        )
        assertNull(lastDialed(recents))
    }

    @Test
    fun `nothing to redial with no dialed call`() {
        assertNull(lastDialed(emptyList()))
        assertEquals("apagado, só \"Rediscar\"", "Rediscar", redialLabel(null, null))
    }

    @Test
    fun `the redial keeps the number as it was dialed`() {
        // Um número com o prefixo e os espaços com que foi discado.
        val dialed = Recent("0 (11) 5060-3000", "", CallKind.FEITA, 2_000, 258)
        val redial = lastDialed(listOf(dialed, Recent("2002", "", CallKind.FEITA, 1_000, 0)))
        assertEquals("0 (11) 5060-3000", redial?.number)
        assertEquals("Rediscar 0 (11) 5060-3000", redialLabel(redial, null))
    }

    @Test
    fun `the redial label names the number and the contact`() {
        val dialed = Recent("2005", "", CallKind.FEITA, 2_000, 125)
        assertEquals("Rediscar 2005 · Marcos Lima", redialLabel(dialed, "Marcos Lima"))
        assertEquals("sem o contato, só o número", "Rediscar 2005", redialLabel(dialed, null))
        assertEquals("um nome vazio é sem nome", "Rediscar 2005", redialLabel(dialed, ""))
    }
}
