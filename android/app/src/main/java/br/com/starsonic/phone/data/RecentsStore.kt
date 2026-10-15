package br.com.starsonic.phone.data

import java.io.File
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** O tipo de uma ligação no Recentes. */
enum class CallKind { FEITA, RECEBIDA, PERDIDA }

/** Uma ligação no Recentes: o número, o nome (se o PABX mandou), o tipo, o começo e quanto durou (atendida). */
data class Recent(val number: String, val name: String, val kind: CallKind, val startMillis: Long, val durationSec: Int)

/**
 * Os Recentes (spec 4.1 e 6.4): até [MAX] ligações, das mais novas (pelo começo) para as mais antigas, num
 * arquivo JSON no armazenamento privado do app. Ficam também na memória, lidos do arquivo na primeira vez.
 *
 * [add], [list] e [clear] leem ou gravam o disco: nunca na thread principal. Qualquer thread, uma de cada vez.
 * Um arquivo estragado vale como vazio (e é trocado na próxima gravação). O arquivo só é procurado no primeiro
 * uso ([location]): criar a lista não toca o disco.
 */
class RecentsStore(location: () -> File) {
    constructor(file: File) : this({ file })

    private val file: File by lazy(location)
    private val lock = Any()
    private var cache: List<Recent>? = null   // com a trava
    private val mutableVersion = MutableStateFlow(0)

    /** Sobe a cada mudança (a tela Recentes lê de novo). */
    val version: StateFlow<Int> = mutableVersion

    /** Anota uma ligação; passando de [MAX], a mais antiga sai. */
    fun add(recent: Recent) {
        synchronized(lock) {
            val current = load()
            // Depois das que começaram depois dela (ou junto): a lista fica do começo mais novo ao mais antigo.
            val position = current.indexOfFirst { it.startMillis < recent.startMillis }.let { if (it < 0) current.size else it }
            val updated = (current.subList(0, position) + recent + current.subList(position, current.size)).take(MAX)
            cache = updated
            write(updated)
        }
        mutableVersion.update { it + 1 }
    }

    /** As ligações, da mais nova para a mais antiga. */
    fun list(): List<Recent> = synchronized(lock) { load() }

    /** Apaga os Recentes. */
    fun clear() {
        synchronized(lock) {
            cache = emptyList()
            file.delete()
        }
        mutableVersion.update { it + 1 }
    }

    // Com a trava.
    private fun load(): List<Recent> = cache ?: read().also { cache = it }

    private fun read(): List<Recent> {
        if (!file.exists()) return emptyList()
        return try {
            val array = JSONArray(file.readText(Charsets.UTF_8))
            (0 until array.length()).mapNotNull { index -> array.optJSONObject(index)?.let(::fromJson) }.take(MAX)
        } catch (e: IOException) {
            emptyList()
        } catch (e: JSONException) {
            emptyList()
        }
    }

    // Grava num arquivo ao lado e troca de uma vez: uma gravação cortada no meio não estraga a lista.
    private fun write(recents: List<Recent>) {
        val array = JSONArray()
        recents.forEach { array.put(toJson(it)) }
        val temporary = File(file.path + ".tmp")
        try {
            file.parentFile?.mkdirs()
            temporary.writeText(array.toString(), Charsets.UTF_8)
            if (!temporary.renameTo(file)) {
                file.delete()
                temporary.renameTo(file)
            }
        } catch (e: IOException) {
            // Sem espaço ou sem o diretório: a lista fica só na memória até a próxima gravação.
        }
    }

    private fun toJson(recent: Recent): JSONObject = JSONObject()
        .put(NUMBER, recent.number)
        .put(NAME, recent.name)
        .put(KIND, recent.kind.name)
        .put(START, recent.startMillis)
        .put(DURATION, recent.durationSec)

    // Uma entrada que não dá para ler (de um formato que este app não conhece) fica de fora.
    private fun fromJson(entry: JSONObject): Recent? =
        try {
            val kind = CallKind.entries.firstOrNull { it.name == entry.getString(KIND) } ?: return null
            Recent(entry.getString(NUMBER), entry.optString(NAME, ""), kind, entry.getLong(START), entry.getInt(DURATION))
        } catch (e: JSONException) {
            null
        }

    companion object {
        /** Quantas ligações o Recentes guarda. */
        const val MAX = 200

        private const val NUMBER = "numero"
        private const val NAME = "nome"
        private const val KIND = "tipo"
        private const val START = "inicio"
        private const val DURATION = "duracao"
    }
}
