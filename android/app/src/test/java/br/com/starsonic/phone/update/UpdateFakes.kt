package br.com.starsonic.phone.update

import br.com.starsonic.phone.core.Check
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.Manifest
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import org.json.JSONException
import org.json.JSONObject

/**
 * O núcleo falso do atualizador: lê o versao-android.json com o org.json e as regras do ParseManifest e do
 * CompareVersions do núcleo (as de verdade são testadas no núcleo, em tests/test_update_manifest.cpp, e pela ponte, no
 * NativeLoadTest). As outras regras não interessam aqui.
 */
internal class ManifestCore : CoreRules {
    override fun validateServer(raw: String): Pair<Check, String> = Check.OK to raw

    override fun validateRamal(raw: String): Pair<Check, String> = Check.OK to raw

    override fun registrationMessage(code: Int) = ""

    override fun callEndMessage(code: Int) = ""

    override fun normalizeDialString(raw: String) = raw

    override fun parseManifest(json: String, allowedPrefix: String, onError: (String) -> Unit): Manifest? {
        val fields = try {
            JSONObject(json)
        } catch (e: JSONException) {
            onError("versao.json: JSON invalido")
            return null
        }
        val version = text(fields, "versao")?.takeIf { VERSION.matches(it) }
        val installer = text(fields, "instalador")?.takeIf { it.length > allowedPrefix.length && it.startsWith(allowedPrefix) }
        val sha256 = text(fields, "sha256")?.takeIf { SHA256.matches(it) }
        val notes = if (fields.has("notas")) text(fields, "notas") else ""
        if (version == null || installer == null || sha256 == null || notes == null) {
            onError("versao.json: campo ausente ou invalido")
            return null
        }
        return Manifest(version, installer, sha256.lowercase(), notes)
    }

    override fun compareVersions(a: String, b: String): Int {
        val first = parts(a) ?: return 0
        val second = parts(b) ?: return 0
        for (i in first.indices) {
            if (first[i] != second[i]) return if (first[i] < second[i]) -1 else 1
        }
        return 0
    }

    // [maior, menor, correção, rc]: a final vem depois de qualquer rc dela.
    private fun parts(text: String): List<Long>? =
        VERSION.matchEntire(text)?.groupValues?.let { groups ->
            listOf(groups[1].toLong(), groups[2].toLong(), groups[3].toLong(), groups[4].ifEmpty { null }?.toLong() ?: Long.MAX_VALUE)
        }

    private fun text(fields: JSONObject, key: String): String? =
        if (!fields.has(key)) {
            null
        } else {
            try {
                fields.getString(key)
            } catch (e: JSONException) {
                null
            }
        }

    private companion object {
        val VERSION = Regex("""(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-rc\.([1-9]\d{0,8}))?""")
        val SHA256 = Regex("[0-9a-fA-F]{64}")
    }
}

/**
 * A rede falsa: os textos ([texts]) e os arquivos ([files]) por endereço; o que não está lá falha como sem rede. O
 * download vem em pedaços de [CHUNK] bytes: [cutAfter] o quebra (IOException) depois de tantos bytes, [endAfter] o acaba
 * antes da hora sem erro, e [duringDownload] roda uma vez, depois do primeiro pedaço.
 */
internal class FakeNetwork : UpdateNetwork {
    val texts = mutableMapOf<String, String>()
    val files = mutableMapOf<String, ByteArray>()
    val fetched = mutableListOf<String>()
    val opened = mutableListOf<String>()
    var cutAfter: Int? = null
    var endAfter: Int? = null
    var duringDownload: () -> Unit = {}

    override fun text(url: String, maxBytes: Int): String {
        fetched += url
        return texts[url] ?: throw IOException("sem rede")
    }

    override fun open(url: String): InputStream {
        opened += url
        return Download(files[url] ?: throw IOException("HTTP 404"))
    }

    private inner class Download(private val bytes: ByteArray) : InputStream() {
        private var position = 0
        private var first = true

        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            val cut = cutAfter
            if (cut != null && position >= cut) throw IOException("a conexão caiu")
            val end = minOf(bytes.size, endAfter ?: bytes.size, cut ?: bytes.size)
            if (position >= end) return -1
            val count = minOf(length, end - position, CHUNK)
            System.arraycopy(bytes, position, buffer, offset, count)
            position += count
            if (first) {
                first = false
                duringDownload()
            }
            return count
        }
    }

    companion object {
        const val CHUNK = 1024
    }
}

/** A instalação falsa: guarda o conteúdo de cada APK entregue (lido na hora: o atualizador o apaga depois). */
internal class FakeInstaller : UpdateInstaller {
    var allowed = true
    var asked = 0
    var fails = false
    val installed = mutableListOf<ByteArray>()

    override fun allowed() = allowed

    override fun askPermission() {
        asked++
    }

    override fun install(apk: File) {
        if (fails) throw IOException("sem espaço para a sessão")
        installed += apk.readBytes()
    }
}

/** A hora da última verificação, na memória. */
internal class MemoryStore : UpdateStore {
    override var lastCheckMillis = 0L
}

/** O SHA-256 em hexadecimal minúsculo. */
internal fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xff) }

/** Um versao-android.json (os campos como o release publica; [notes] null = sem o campo). */
internal fun manifestJson(version: String, installer: String, sha256: String, notes: String? = "Correções.") =
    JSONObject()
        .put("versao", version)
        .put("instalador", installer)
        .put("sha256", sha256)
        .apply { if (notes != null) put("notas", notes) }
        .toString()

/** O endereço do APK de [version] nas tags android-v (o que o release publica). */
internal fun apkUrl(version: String) = "${UpdateDecider.INSTALLER_PREFIX}$version/StarsonicPhone-android-$version.apk"
