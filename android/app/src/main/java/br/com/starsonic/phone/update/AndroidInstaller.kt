package br.com.starsonic.phone.update

import android.content.Context
import android.content.Intent
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** A instalação pelo Android (esboço). */
class AndroidInstaller(private val context: Context, private val log: (String) -> Unit = {}) : UpdateInstaller {
    private val mutableConfirmation = MutableStateFlow<Intent?>(null)

    val confirmation: StateFlow<Intent?> = mutableConfirmation

    override fun allowed(): Boolean = false

    override fun askPermission() {}

    override fun install(apk: File) {}
}

/** A hora da última verificação (esboço). */
class PreferencesUpdateStore(private val context: Context) : UpdateStore {
    override var lastCheckMillis: Long = 0L
}
