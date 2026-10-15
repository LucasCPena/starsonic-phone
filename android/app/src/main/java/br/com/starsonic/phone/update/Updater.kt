package br.com.starsonic.phone.update

import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.Manifest
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.Executor
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** O canal de atualização: o endereço do versao-android.json e o começo obrigatório do endereço do APK. */
data class UpdateChannel(val url: String, val installerPrefix: String) {
    companion object {
        fun of(installedVersion: String) = UpdateChannel(UpdateDecider.channelUrl(installedVersion), UpdateDecider.INSTALLER_PREFIX)
    }
}

/** O que o aviso de atualização mostra. */
sealed interface UpdateUi {
    data class Offer(val manifest: Manifest) : UpdateUi

    data object Downloading : UpdateUi

    data class Notice(val text: String) : UpdateUi
}

/** A rede do atualizador. */
interface UpdateNetwork {
    fun text(url: String, maxBytes: Int): String

    fun open(url: String): InputStream
}

/** A instalação pelo Android. */
interface UpdateInstaller {
    fun allowed(): Boolean

    fun askPermission()

    fun install(apk: File)
}

/** A hora da última verificação. */
interface UpdateStore {
    var lastCheckMillis: Long
}

/** O atualizador (esboço). */
class Updater(
    private val core: CoreRules,
    private val network: UpdateNetwork,
    private val installer: UpdateInstaller,
    private val store: UpdateStore,
    private val installedVersion: String,
    private val inCall: () -> Boolean,
    private val cacheDir: () -> File,
    channel: UpdateChannel?,
    private val testChannels: Boolean = false,
    private val nowMillis: () -> Long = System::currentTimeMillis,
    private val log: (String) -> Unit = {},
    private val background: Executor = Executor { it.run() },
) {
    private val mutableUi = MutableStateFlow<UpdateUi?>(null)

    val ui: StateFlow<UpdateUi?> = mutableUi

    val visible: Boolean
        get() = false

    fun onScreen(shown: Boolean) {}

    fun checkSoon() {}

    fun checkNow(): Decision = Decision.NONE

    fun accept() {}

    fun dismiss() {}

    fun useTestChannel(url: String, installerPrefix: String) {}
}

/** A rede do app (esboço). */
class HttpUpdateNetwork(private val userAgent: String) : UpdateNetwork {
    override fun text(url: String, maxBytes: Int): String = throw IOException("esboço")

    override fun open(url: String): InputStream = throw IOException("esboço")
}
