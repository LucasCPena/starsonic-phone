package br.com.starsonic.phone.settings

import br.com.starsonic.phone.data.AUTO_ANSWER_SECONDS
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * O que as Configurações escrevem do Atender automático, como no app do Windows (windows/ui/src/format.ts e
 * Configuracoes.tsx): a linha de baixo do "Atender automaticamente" (R27) e as opções do "Tempo para atender".
 */
class SettingsFormatTest {
    @Test
    fun `the auto answer help follows the Windows wording`() {
        assertEquals("na hora", "Assim que tocar", autoAnswerLine(0))
        assertEquals("um segundo, no singular", "Depois de 1 segundo tocando", autoAnswerLine(1))
        assertEquals("Depois de 2 segundos tocando", autoAnswerLine(2))
        assertEquals("o de fábrica", "Depois de 3 segundos tocando", autoAnswerLine(3))
        assertEquals("Depois de 5 segundos tocando", autoAnswerLine(5))
        assertEquals("Depois de 30 segundos tocando", autoAnswerLine(30))
    }

    @Test
    fun `the time options are na hora and the seconds`() {
        assertEquals(
            listOf("Na hora", "1 s", "2 s", "3 s", "5 s", "8 s", "10 s", "15 s", "20 s", "30 s"),
            AUTO_ANSWER_SECONDS.map(::autoAnswerOption),
        )
    }
}
