package br.com.starsonic.phone.update

import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.Manifest
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** O canal de atualização: o endereço do versao-android.json e o começo obrigatório do endereço do APK. */
data class UpdateChannel(val url: String, val installerPrefix: String) {
    companion object {
        /** O canal da versão instalada (o de teste para as -rc), com o APK das tags android-v do GitHub. */
        fun of(installedVersion: String) = UpdateChannel(UpdateDecider.channelUrl(installedVersion), UpdateDecider.INSTALLER_PREFIX)
    }
}

/** O que o aviso de atualização mostra. */
sealed interface UpdateUi {
    /** A versão nova: a pergunta, as notas, Atualizar e Agora não. */
    data class Offer(val manifest: Manifest) : UpdateUi

    /** O APK descendo (o aviso pode sair: o download continua). */
    data object Downloading : UpdateUi

    /** Um aviso com OK: a ligação em andamento, ou o download que falhou. */
    data class Notice(val text: String) : UpdateUi
}

/** A rede do atualizador: no app, o [HttpUpdateNetwork]; nos testes, uma falsa. */
interface UpdateNetwork {
    /** O texto (UTF-8) em [url], até [maxBytes] bytes. IOException sem rede, com HTTP diferente de 200 ou acima do limite. */
    fun text(url: String, maxBytes: Int): String

    /** O download de [url], depois dos redirecionamentos. IOException sem rede ou com HTTP diferente de 200. */
    fun open(url: String): InputStream
}

/** O pacote e o versionCode de um APK, ou do app instalado. */
data class ApkInfo(val packageName: String, val versionCode: Long)

/** A instalação pelo Android: no app, o [AndroidInstaller]; nos testes, uma falsa. */
interface UpdateInstaller {
    /** O Android deixa o app instalar apps (PackageManager.canRequestPackageInstalls). */
    fun allowed(): Boolean

    /** Abre o ajuste do Android em que a pessoa deixa o app instalar apps. */
    fun askPermission()

    /** O pacote e o versionCode do APK [apk] (esboço). */
    fun archive(apk: File): ApkInfo?

    /** O pacote e o versionCode do app instalado (esboço). */
    fun installedApp(): ApkInfo

    /** Entrega o APK conferido ao instalador do Android (uma sessão do PackageInstaller). IOException se não deu. */
    fun install(apk: File)
}

/** Por que o APK não serve (esboço). */
fun apkProblem(archive: ApkInfo?, installed: ApkInfo): String? = null

/** A confirmação segurada durante as ligações (esboço). */
fun <T> heldDuringCalls(pending: Flow<T?>, inCall: Flow<Boolean>): Flow<T?> = pending

/** Onde fica a hora da última verificação: no app, o [PreferencesUpdateStore]. */
interface UpdateStore {
    /** A hora da última verificação (System.currentTimeMillis); 0 = nunca. */
    var lastCheckMillis: Long
}

/**
 * O atualizador (spec 7.6): confere o canal ao abrir o app ([checkSoon]: se a última verificação tem mais de 24 h) e a
 * cada 24 h ([checkNow], pelo UpdateWorker), mostra o aviso ([ui]) e, com o Atualizar ([accept]), baixa o APK para
 * cacheDir/update.apk, confere o SHA-256 e o entrega ao instalador do Android.
 *
 * - A hora da verificação ([UpdateStore]) conta quando o canal respondeu sem versão nova, ou quando a pessoa responde
 *   ao aviso (Agora não, Atualizar, ou o aviso da ligação). Um aviso que ninguém respondeu (o processo morreu, o app
 *   estava em segundo plano, a pessoa foi ao ajuste de instalar apps) volta na próxima abertura. Enquanto um aviso
 *   espera resposta, o canal não é pedido de novo.
 * - Versão nova com uma ligação em andamento: "Termine a chamada para atualizar.", só com o app na tela ([visible]); em
 *   segundo plano, nada, e a próxima abertura confere de novo. Atualizar durante uma ligação: o mesmo aviso, e nada
 *   mais acontece até a próxima verificação (24 h). Uma ligação que começa durante o download também para a
 *   instalação.
 * - Sem a permissão de instalar apps, o Atualizar abre o ajuste do Android e o aviso continua (de volta, Atualizar de
 *   novo). Download que falha, cortado ou com o SHA-256 diferente: o arquivo sai e aparece [DOWNLOAD_FAILED].
 * - Sem canal ([channel] null: o build de debug, que um APK de release, de outra assinatura, nem atualizaria), nada é
 *   conferido; os testes do emulador põem um canal de teste ([useTestChannel], só com [testChannels]: o debug).
 *
 * Threads: a rede, o disco e a instalação rodam em [background] (uma thread, "starsonic-atualizacao", uma coisa por
 * vez). [accept], [dismiss], [checkSoon] e [onScreen] voltam na hora (servem na thread principal); [checkNow] e
 * [useTestChannel] esperam.
 */
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
    private val background: Executor = Executors.newSingleThreadExecutor { task ->
        Thread(task, "starsonic-atualizacao").apply { isDaemon = true }
    },
) {
    @Volatile
    private var channel: UpdateChannel? = channel
    private val screens = AtomicInteger()
    private val mutableUi = MutableStateFlow<UpdateUi?>(null)

    /** O aviso de agora (null: nenhum). A tela principal o mostra. */
    val ui: StateFlow<UpdateUi?> = mutableUi

    /** O app está na tela (entre o onStart e o onStop de uma MainActivity). */
    val visible: Boolean
        get() = screens.get() > 0

    init {
        // O APK de um processo que morreu no meio do download (ou antes de entregá-lo ao Android) sai.
        later { apk().delete() }
    }

    /** Uma tela do app apareceu ([shown]) ou saiu: o onStart e o onStop da MainActivity. */
    fun onScreen(shown: Boolean) {
        if (shown) screens.incrementAndGet() else screens.decrementAndGet()
    }

    /** A verificação de ao abrir (o onStart da tela): o canal, se a última verificação tem mais de 24 h. */
    fun checkSoon() = later { checkChannel() }

    /** A verificação de 24 h (o UpdateWorker): espera e devolve a decisão. Nunca na thread principal. */
    fun checkNow(): Decision = FutureTask { checkChannel() }.also(background::execute).get()

    /** "Atualizar" no aviso de versão nova; o que acontece depois aparece em [ui]. */
    fun accept() {
        val offer = mutableUi.value as? UpdateUi.Offer ?: return
        later { update(offer) }
    }

    /** "Agora não", OK, ou o aviso fechado (voltar, tocar fora): ele sai na hora, e um download continua. */
    fun dismiss() {
        val shown = mutableUi.value ?: return
        if (!mutableUi.compareAndSet(shown, null)) return
        if (shown is UpdateUi.Offer) {
            later {
                store.lastCheckMillis = nowMillis()
                log("a versão ${shown.manifest.versionText} ficou para depois")
            }
        }
    }

    /**
     * O canal de teste dos testes do emulador (um servidor no computador do CI), só no build de debug. O canal de antes
     * deixa de valer: o aviso sai e a verificação recomeça (nunca conferido). Espera; nunca na thread principal.
     */
    fun useTestChannel(url: String, installerPrefix: String) {
        check(testChannels) { "o canal de teste só vale no build de debug" }
        FutureTask {
            channel = UpdateChannel(url, installerPrefix)
            store.lastCheckMillis = 0
            mutableUi.value = null
            log("canal de teste: $url")
        }.also(background::execute).get()
    }

    // Na thread do atualizador: confere o canal (UpdateDecider.decide) e põe o aviso em [ui].
    private fun checkChannel(): Decision {
        val channel = channel ?: return Decision.NONE
        if (mutableUi.value != null) return Decision.NONE   // um aviso espera resposta, ou um download segue
        val now = nowMillis()
        var answered = false
        val decision = UpdateDecider(core, channel.installerPrefix, log).decide(
            installedVersion,
            { fetch(channel.url)?.also { answered = true } },
            store.lastCheckMillis,
            now,
            inCall(),
        )
        when (decision) {
            Decision.NONE -> if (answered) store.lastCheckMillis = now
            is Decision.PROMPT -> mutableUi.value = UpdateUi.Offer(decision.manifest)
            Decision.BLOCKED_BY_CALL -> if (visible) {
                store.lastCheckMillis = now
                mutableUi.value = UpdateUi.Notice(UpdateDecider.CALL_MESSAGE)
            }
        }
        return decision
    }

    // O versao-android.json do canal, ou null se ele não respondeu.
    private fun fetch(url: String): String? =
        try {
            log("conferindo o canal $url")
            network.text(url, MANIFEST_MAX_BYTES)
        } catch (e: Exception) {
            log("o canal não respondeu: ${reason(e)}")
            null
        }

    // Na thread do atualizador: o Atualizar do aviso [offer].
    private fun update(offer: UpdateUi.Offer) {
        if (mutableUi.value != offer) return   // já respondido: um segundo toque, ou o aviso fechado
        val version = offer.manifest.versionText
        if (inCall()) {
            store.lastCheckMillis = nowMillis()
            mutableUi.value = UpdateUi.Notice(UpdateDecider.CALL_MESSAGE)
            log("Atualizar para a versão $version com uma ligação em andamento")
            return
        }
        if (!installer.allowed()) {
            // A resposta fica para a volta do ajuste: o aviso continua, e a verificação não conta.
            log("sem a permissão de instalar apps: o ajuste do Android")
            installer.askPermission()
            return
        }
        store.lastCheckMillis = nowMillis()
        mutableUi.value = UpdateUi.Downloading
        val apk = download(offer.manifest)
        if (apk == null) {
            mutableUi.value = UpdateUi.Notice(DOWNLOAD_FAILED)
            return
        }
        try {
            if (inCall()) {
                log("uma ligação começou durante o download: a versão $version fica para depois")
                mutableUi.value = UpdateUi.Notice(UpdateDecider.CALL_MESSAGE)
                return
            }
            installer.install(apk)
            log("a versão $version foi entregue ao instalador do Android")
            mutableUi.compareAndSet(UpdateUi.Downloading, null)
        } catch (e: Exception) {
            log("o instalador do Android não recebeu a versão $version: ${reason(e)}")
            mutableUi.value = UpdateUi.Notice(DOWNLOAD_FAILED)
        } finally {
            apk.delete()   // a sessão do Android já tem a cópia dela
        }
    }

    // Na thread do atualizador: o APK de [manifest] em cacheDir/update.apk, com o SHA-256 conferido; null se o download
    // falhou, foi cortado ou não confere (e o arquivo, inteiro ou não, sai).
    private fun download(manifest: Manifest): File? {
        val apk = apk()
        var verified = false
        try {
            log("baixando a versão ${manifest.versionText}: ${manifest.installerUrl}")
            apk.parentFile?.mkdirs()
            val digest = MessageDigest.getInstance("SHA-256")
            var size = 0L
            network.open(manifest.installerUrl).use { input ->
                FileOutputStream(apk).use { output ->
                    val buffer = ByteArray(BUFFER_BYTES)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        size += read
                        if (size > APK_MAX_BYTES) throw IOException("o APK passa de $APK_MAX_BYTES bytes")
                        digest.update(buffer, 0, read)
                        output.write(buffer, 0, read)
                    }
                }
            }
            if (hex(digest.digest()) != manifest.sha256) {
                log("o SHA-256 do APK baixado ($size bytes) não é o do versao-android.json")
                return null
            }
            log("o APK da versão ${manifest.versionText} foi conferido ($size bytes)")
            verified = true
            return apk
        } catch (e: Exception) {
            log("o download da versão ${manifest.versionText} falhou: ${reason(e)}")
            return null
        } finally {
            if (!verified) apk.delete()
        }
    }

    private fun apk() = File(cacheDir(), APK_NAME)

    // Põe [task] na thread do atualizador; um erro inesperado vai ao log e não derruba o app.
    private fun later(task: () -> Unit) {
        background.execute {
            try {
                task()
            } catch (e: Exception) {
                log("erro inesperado: ${reason(e)}")
            }
        }
    }

    companion object {
        /** O aviso de download que falhou, cortado ou com o SHA-256 diferente (spec 7.6.4 e 11.1). */
        const val DOWNLOAD_FAILED = "Não foi possível baixar a atualização. Tentaremos de novo mais tarde."

        /** O APK baixado, na pasta de cache do app (cacheDir). */
        const val APK_NAME = "update.apk"

        /** O tamanho máximo do versao-android.json e do APK (o mesmo do instalador do Windows). */
        const val MANIFEST_MAX_BYTES = 1024 * 1024
        const val APK_MAX_BYTES = 150L * 1024 * 1024

        private const val BUFFER_BYTES = 64 * 1024
        private val ADDRESS = Regex("""[A-Za-z][A-Za-z0-9+.-]*://\S+""")
        private val HEX = "0123456789abcdef".toCharArray()

        // O motivo de uma falha para o log, sem endereços: um redirecionamento do GitHub leva a um endereço assinado.
        private fun reason(e: Exception): String {
            val message = e.message?.replace(ADDRESS, "<endereço>")
            return if (message.isNullOrBlank()) e.javaClass.simpleName else "${e.javaClass.simpleName}: $message"
        }

        private fun hex(bytes: ByteArray): String =
            buildString(bytes.size * 2) {
                for (byte in bytes) {
                    val value = byte.toInt() and 0xff
                    append(HEX[value ushr 4])
                    append(HEX[value and 0x0f])
                }
            }
    }
}

/**
 * A rede do app: o HttpURLConnection, que segue os redirecionamentos de mesmo protocolo (o GitHub manda os assets do
 * release para outro endereço, também HTTPS), com o User-Agent do app ([userAgent]). O build de release só fala HTTPS
 * (o Android recusa HTTP sem TLS desde o targetSdk 28); o de debug deixa HTTP só para 10.0.2.2, o computador do
 * emulador (o canal de teste). Os erros não trazem o endereço (os redirecionamentos levam a endereços assinados).
 */
class HttpUpdateNetwork(
    private val userAgent: String,
    private val connectTimeoutMillis: Int = 15_000,
    private val readTimeoutMillis: Int = 30_000,
) : UpdateNetwork {
    override fun text(url: String, maxBytes: Int): String {
        val connection = connect(url)
        try {
            connection.inputStream.use { input ->
                val bytes = ByteArrayOutputStream()
                val buffer = ByteArray(8 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (bytes.size() + read > maxBytes) throw IOException("o canal passa de $maxBytes bytes")
                    bytes.write(buffer, 0, read)
                }
                return String(bytes.toByteArray(), Charsets.UTF_8)
            }
        } finally {
            connection.disconnect()
        }
    }

    override fun open(url: String): InputStream {
        val connection = connect(url)
        val input = try {
            connection.inputStream
        } catch (e: IOException) {
            connection.disconnect()
            throw e
        }
        return object : FilterInputStream(input) {
            override fun close() {
                try {
                    super.close()
                } finally {
                    connection.disconnect()
                }
            }
        }
    }

    // A conexão já com a resposta 200 (depois dos redirecionamentos); senão, IOException "HTTP <código>".
    private fun connect(url: String): HttpURLConnection {
        val connection = URI(url).toURL().openConnection() as? HttpURLConnection ?: throw IOException("não é HTTP")
        connection.connectTimeout = connectTimeoutMillis
        connection.readTimeout = readTimeoutMillis
        connection.instanceFollowRedirects = true
        connection.useCaches = false
        connection.setRequestProperty("User-Agent", userAgent)
        try {
            val status = connection.responseCode
            if (status != HttpURLConnection.HTTP_OK) throw IOException("HTTP $status")
        } catch (e: IOException) {
            connection.disconnect()
            throw e
        }
        return connection
    }
}
