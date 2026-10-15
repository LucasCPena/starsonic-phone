package br.com.starsonic.phone.call

import android.util.Log
import br.com.starsonic.phone.BuildConfig

/**
 * O caminho das ligações no logcat (tag "StarsonicLigacao"), só no build de debug, como as linhas do motor: os
 * testes no emulador mostram estas linhas quando falham.
 */
internal object CallLog {
    const val TAG = "StarsonicLigacao"

    fun i(line: String) {
        if (BuildConfig.DEBUG) Log.i(TAG, line)
    }

    fun w(line: String, error: Throwable? = null) {
        if (BuildConfig.DEBUG) Log.w(TAG, line, error)
    }
}
