package br.com.starsonic.phone.data

import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** O tipo de uma ligação no Recentes. */
enum class CallKind { FEITA, RECEBIDA, PERDIDA }

/** Uma ligação no Recentes: o número, o nome (se o PABX mandou), o tipo, o começo e quanto durou (atendida). */
data class Recent(val number: String, val name: String, val kind: CallKind, val startMillis: Long, val durationSec: Int)

/** Os Recentes (stub da Task 8: a implementação vem no GREEN). */
class RecentsStore(private val file: File) {
    private val mutableVersion = MutableStateFlow(0)

    val version: StateFlow<Int> = mutableVersion

    fun add(recent: Recent) {}

    fun list(): List<Recent> = emptyList()

    fun clear() {}
}
