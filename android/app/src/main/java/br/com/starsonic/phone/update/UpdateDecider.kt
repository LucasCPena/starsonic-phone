package br.com.starsonic.phone.update

import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.Manifest

/** O que fazer depois de conferir o canal de atualização (spec 7.6). */
sealed interface Decision {
    /** Nada a oferecer. */
    data object NONE : Decision

    /** Versão maior que a instalada: o aviso, com a versão e as notas. */
    data class PROMPT(val manifest: Manifest) : Decision {
        val version: String
            get() = manifest.versionText

        val notes: String
            get() = manifest.notes
    }

    /** Versão maior, mas com uma ligação em andamento: só o aviso [message], e nada mais acontece. */
    data object BLOCKED_BY_CALL : Decision {
        val message: String
            get() = UpdateDecider.CALL_MESSAGE
    }
}

/** O decisor da atualização (esboço). */
class UpdateDecider(
    private val core: CoreRules,
    private val allowedPrefix: String = INSTALLER_PREFIX,
    private val log: (String) -> Unit = {},
) {
    fun decide(installed: String, manifest: () -> String?, lastCheckMillis: Long, nowMillis: Long, inCall: Boolean): Decision =
        Decision.NONE

    companion object {
        const val CHECK_INTERVAL_MILLIS = 0L
        const val INSTALLER_PREFIX = ""
        const val CALL_MESSAGE = ""

        fun channelUrl(installedVersion: String): String = ""

        fun question(version: String): String = ""
    }
}
