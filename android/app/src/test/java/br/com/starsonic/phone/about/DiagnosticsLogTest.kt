package br.com.starsonic.phone.about

import java.io.File
import java.util.concurrent.CountDownLatch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * O log de diagnóstico (spec 6.4): até 1 MB, o mais antigo sai primeiro, sem senhas. Quem escreve nunca espera o
 * disco (o log do motor pode chegar com travas do PJSIP presas): a linha vai para uma fila, e a thread do log grava.
 */
class DiagnosticsLogTest {
    @get:Rule
    val folder = TemporaryFolder()

    // Uma linha numerada, de uns 100 bytes.
    private fun line(number: Int) = "linha %06d %s".format(number, "x".repeat(80))

    // Os números das linhas do arquivo, na ordem.
    private fun numbers(file: File): List<Int> =
        file.readLines().mapNotNull { NUMBER.find(it)?.groupValues?.get(1)?.toInt() }

    @Test
    fun `past 1 MB the file keeps up to 1 MB with the newest lines`() {
        val log = DiagnosticsLog(folder.root)
        var next = 0
        // Uns 1,9 MB, em blocos que cabem na fila: cada bloco vai para o disco antes do próximo.
        repeat(32) {
            repeat(500) { log.append(line(next++)) }
            log.file()
        }
        val file = log.file()
        assertTrue("tamanho ${file.length()}", file.length() <= 1_048_576)
        val kept = numbers(file)
        assertEquals("as mais novas, em ordem e sem buracos, até a última", (kept.first() until next).toList(), kept)
        assertTrue("as mais antigas saíram", kept.first() > 0)
        assertTrue("o arquivo não encolhe demais: ${file.length()}", file.length() >= 512 * 1024)
    }

    @Test(timeout = 20_000)
    fun `append does not wait for the disk and drops what does not fit in the queue`() {
        val disk = CountDownLatch(1)
        // O disco parado: a thread do log fica esperando a pasta do arquivo.
        val log = DiagnosticsLog({ disk.await(); folder.root }, capacity = 16)
        repeat(100) { log.append(line(it)) }   // volta na hora, mesmo com o disco parado
        disk.countDown()
        val file = log.file()
        val kept = numbers(file)
        assertTrue("algumas linhas não couberam: ${kept.size}", kept.size < 100)
        // Cabem as 16 primeiras; depois, a linha que chega com a fila cheia sai (a fila esvazia quando a thread do
        // log pega um bloco, e as seguintes voltam a caber).
        assertEquals("as primeiras couberam", (0 until 16).toList(), kept.take(16))
        assertEquals("em ordem, sem repetir", kept.distinct().sorted(), kept)
        val dropped = DROPPED.findAll(file.readText()).sumOf { it.groupValues[1].toInt() }
        assertEquals("o aviso conta as descartadas", 100 - kept.size, dropped)
    }

    @Test
    fun `the digest response of the SIP messages does not reach the file`() {
        val log = DiagnosticsLog(folder.root)
        log.append(
            "motor: TX 520 bytes Request msg REGISTER/cseq=2 to TCP 10.0.2.2:5060:\n" +
                "REGISTER sip:10.0.2.2 SIP/2.0\n" +
                "Authorization: Digest username=\"2001\", realm=\"ci\", nonce=\"8f1c\", uri=\"sip:10.0.2.2\", " +
                "response=\"0123456789abcdef0123456789abcdef\", algorithm=MD5",
        )
        val text = log.file().readText()
        assertFalse(text, "0123456789abcdef0123456789abcdef" in text)
        assertTrue(text, "REGISTER sip:10.0.2.2 SIP/2.0" in text)
        assertTrue(text, "username=\"2001\"" in text)
    }

    @Test
    fun `the file of an empty log exists to be shared`() {
        assertTrue(DiagnosticsLog(folder.root).file().exists())
    }

    private companion object {
        val NUMBER = Regex("""linha (\d{6})""")
        val DROPPED = Regex("""(\d+) linhas do log descartadas""")
    }
}
