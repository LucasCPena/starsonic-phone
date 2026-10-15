package br.com.starsonic.phone.call

import android.util.Log
import br.com.starsonic.phone.BuildConfig

/**
 * O caminho das ligações: vai ao log de diagnóstico em qualquer build ([sink], que o App liga ao começar) e ao
 * logcat (tag "StarsonicLigacao") só no build de debug, como as linhas do motor: os testes no emulador mostram estas
 * linhas quando falham. As linhas falam de ids, números e estados, nunca da senha.
 */
internal object CallLog {
    const val TAG = "StarsonicLigacao"

    /** Para onde as linhas vão em qualquer build (o log de diagnóstico); null antes de o App começar. */
    @Volatile
    var sink: ((String) -> Unit)? = null

    inline fun i(line: () -> String) = write(Log.INFO, line())

    inline fun w(line: () -> String) = write(Log.WARN, line())

    fun write(priority: Int, line: String) {
        sink?.invoke(line)
        if (BuildConfig.DEBUG) Log.println(priority, TAG, line)
    }
}
