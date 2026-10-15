package br.com.starsonic.phone.about

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * O log de diagnóstico (spec 6.4): as linhas do motor, das ligações e do app, cada uma com a data e a hora, num
 * arquivo no armazenamento privado do app ([dir]), com até [maxBytes] (1 MB): passando disso, as linhas mais antigas
 * saem. Sem senhas: o motor e o app nunca escrevem a senha, e a resposta Digest das mensagens SIP (com ela, dá para
 * tentar adivinhar a senha fora do celular) chega ao arquivo escondida. O arquivo só sai do celular pelo "Enviar
 * diagnóstico" ([shareIntent]), para onde a pessoa escolher.
 *
 * Threads: [append] serve a qualquer thread, inclusive à do log do motor, que pode chegar com travas do PJSIP
 * presas: a linha vai para uma fila de [capacity] linhas e volta, sem tocar o disco; com a fila cheia, a linha é
 * descartada, e o arquivo ganha um aviso de quantas foram. Uma thread própria ("starsonic-diagnostico") grava, em
 * blocos. [file] e [shareIntent] esperam o que já estava na fila chegar ao arquivo: fora da thread principal.
 */
class DiagnosticsLog(
    dir: () -> File,
    private val maxBytes: Int = MAX_BYTES,
    capacity: Int = QUEUE_LINES,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    /** [dir]: a pasta do arquivo (criada na primeira gravação). */
    constructor(dir: File, maxBytes: Int = MAX_BYTES) : this({ dir }, maxBytes)

    // Uma linha (com a hora em que chegou), ou o pedido de [file] para saber quando a fila anterior foi gravada.
    private class Entry(val atMillis: Long, val line: String?, val written: CountDownLatch? = null)

    // A pasta é procurada só na primeira gravação (ou no primeiro [file]), fora da thread de quem escreve.
    private val directory: File by lazy(dir)
    private val queue = ArrayBlockingQueue<Entry>(capacity)
    private val dropped = AtomicInteger()

    init {
        Thread(::run, "starsonic-diagnostico").apply {
            isDaemon = true
            start()
        }
    }

    /** Uma linha para o log (sem o fim de linha; pode ter várias, como uma mensagem SIP). Volta na hora. */
    fun append(line: String) {
        val text = if (line.length > MAX_LINE_CHARS) line.substring(0, MAX_LINE_CHARS) + "…" else line
        if (!queue.offer(Entry(clock(), text))) dropped.incrementAndGet()
    }

    /** O arquivo do log, com o que já estava na fila (espera a gravação por até alguns segundos). */
    fun file(): File {
        val written = CountDownLatch(1)
        if (queue.offer(Entry(0, null, written), WAIT_SECONDS, TimeUnit.SECONDS)) {
            written.await(WAIT_SECONDS, TimeUnit.SECONDS)
        }
        return File(directory, FILE_NAME)
    }

    /**
     * O pedido para mandar o log (ACTION_SEND, text/plain): o arquivo pelo FileProvider do app, só para ler, com a
     * permissão de leitura da URI para quem a pessoa escolher. Espera a gravação ([file]): fora da thread principal.
     */
    fun shareIntent(context: Context): Intent {
        val uri = FileProvider.getUriForFile(context, authority(context), file())
        return Intent(Intent.ACTION_SEND)
            .setType(MIME_TYPE)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, SUBJECT)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .apply { clipData = ClipData.newRawUri(FILE_NAME, uri) }
    }

    // A thread do log: grava a fila em blocos, na ordem.
    private fun run() {
        val batch = ArrayList<Entry>()
        try {
            while (true) {
                batch += queue.take()
                queue.drainTo(batch, BATCH_LINES)
                try {
                    write(batch)
                } catch (e: Exception) {
                    // Sem espaço ou sem a pasta: estas linhas ficam de fora, e o log segue.
                } finally {
                    batch.forEach { it.written?.countDown() }
                    batch.clear()
                }
            }
        } catch (e: InterruptedException) {
            // Ninguém interrompe esta thread; se acontecer, o log para.
        }
    }

    // Na thread do log: acrescenta o bloco ao arquivo. Passando de [maxBytes], ficam só as linhas mais novas, até
    // 3/4 do limite (a folga evita reescrever o arquivo a cada bloco).
    private fun write(batch: List<Entry>) {
        val file = File(directory.apply { mkdirs() }, FILE_NAME)
        val text = StringBuilder()
        for (entry in batch) {
            val line = entry.line ?: continue
            text.append(STAMP.format(Instant.ofEpochMilli(entry.atMillis))).append(' ').append(hideDigest(line)).append('\n')
        }
        val lost = dropped.getAndSet(0)
        if (lost > 0) {
            text.append(STAMP.format(Instant.ofEpochMilli(clock()))).append(" (").append(lost)
                .append(" linhas do log descartadas: a fila encheu)\n")
        }
        val bytes = text.toString().toByteArray(Charsets.UTF_8)
        val size = file.length()
        if (size + bytes.size <= maxBytes) {
            FileOutputStream(file, true).use { it.write(bytes) }   // um log vazio também cria o arquivo
            return
        }
        val all = (if (size > 0) file.readBytes() else ByteArray(0)) + bytes
        // O começo de uma linha, sem passar de 3/4 do limite.
        var start = all.size - (maxBytes - maxBytes / 4)
        while (start < all.size && all[start - 1] != NEWLINE) start++
        // Grava ao lado e troca de uma vez: uma gravação cortada no meio não estraga o log.
        val temporary = File(file.path + ".tmp")
        FileOutputStream(temporary).use { it.write(all, start, all.size - start) }
        if (!temporary.renameTo(file)) {
            file.delete()
            temporary.renameTo(file)
        }
    }

    companion object {
        /** O tamanho máximo do arquivo (spec 6.4). */
        const val MAX_BYTES = 1_048_576

        /** As linhas que esperam a gravação; passando disso, as novas são descartadas. */
        const val QUEUE_LINES = 1024

        /** O nome do arquivo (o nome que o anexo ganha no app que a pessoa escolher). */
        const val FILE_NAME = "starsonic-diagnostico.txt"

        /** O FileProvider do app (AndroidManifest.xml e res/xml/file_paths.xml). */
        fun authority(context: Context): String = "${context.packageName}.arquivos"

        private const val MIME_TYPE = "text/plain"
        private const val SUBJECT = "Diagnóstico do Starsonic Phone"
        private const val MAX_LINE_CHARS = 4_000
        private const val BATCH_LINES = 256
        private const val WAIT_SECONDS = 5L
        private const val NEWLINE = '\n'.code.toByte()
        private val STAMP: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS").withZone(ZoneId.systemDefault())

        // A resposta Digest (Authorization e Proxy-Authorization das mensagens SIP), até a aspa que a fecha ou até o
        // fim da linha: uma linha cortada no limite pode terminar no meio dela.
        private val DIGEST_RESPONSE = Regex("""(\bresponse\s*=\s*)"[^"\n]*"?""", RegexOption.IGNORE_CASE)

        private fun hideDigest(line: String): String =
            if (line.contains("response", ignoreCase = true)) DIGEST_RESPONSE.replace(line, "$1\"…\"") else line
    }
}
