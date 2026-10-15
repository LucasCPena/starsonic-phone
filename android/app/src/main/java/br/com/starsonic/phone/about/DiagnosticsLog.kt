package br.com.starsonic.phone.about

import android.content.Context
import android.content.Intent
import java.io.File

/** O log de diagnóstico (spec 6.4). Esboço: ainda não grava nada. */
class DiagnosticsLog(
    dir: () -> File,
    private val maxBytes: Int = MAX_BYTES,
    capacity: Int = QUEUE_LINES,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    constructor(dir: File, maxBytes: Int = MAX_BYTES) : this({ dir }, maxBytes)

    private val directory: File by lazy(dir)

    fun append(line: String) {}

    fun file(): File = File(directory, FILE_NAME)

    fun shareIntent(context: Context): Intent = Intent(Intent.ACTION_SEND).setType(MIME_TYPE)

    companion object {
        const val MAX_BYTES = 1_048_576
        const val QUEUE_LINES = 1024
        const val FILE_NAME = "starsonic-diagnostico.txt"
        private const val MIME_TYPE = "text/plain"
    }
}
