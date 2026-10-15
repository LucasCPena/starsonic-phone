package br.com.starsonic.phone.update

import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.Manifest

/** O que fazer depois de conferir o canal de atualização (spec 7.6). */
sealed interface Decision {
    /**
     * Nada a oferecer: conferido há menos de 24 h (sem pedir o canal), canal sem resposta, versao-android.json que não
     * vale (JSON, versão, APK fora do endereço permitido, SHA-256), ou versão igual ou menor que a instalada.
     */
    data object NONE : Decision

    /** Versão maior que a instalada: o aviso, com a versão e as notas. */
    data class PROMPT(val manifest: Manifest) : Decision {
        val version: String
            get() = manifest.versionText

        val notes: String
            get() = manifest.notes
    }

    /** Versão maior, mas com uma ligação em andamento: só o aviso [message], e nada mais acontece (spec 7.6.3). */
    data object BLOCKED_BY_CALL : Decision {
        val message: String
            get() = UpdateDecider.CALL_MESSAGE
    }
}

/**
 * O decisor da atualização (spec 7.6), sem rede e sem Android: o canal pela versão instalada ([channelUrl]) e, a cada
 * verificação, o que fazer com o versao-android.json, lido pelo núcleo (ParseManifest com [allowedPrefix], o começo
 * obrigatório do endereço do APK; CompareVersions). Os motivos de nada oferecer vão para [log] (o diagnóstico).
 */
class UpdateDecider(
    private val core: CoreRules,
    private val allowedPrefix: String = INSTALLER_PREFIX,
    private val log: (String) -> Unit = {},
) {
    /**
     * Confere o canal para a versão [installed]. Menos de 24 h depois da última verificação ([lastCheckMillis]; 0 =
     * nunca), [NONE][Decision.NONE] sem buscar: [manifest] (o texto do versao-android.json, ou null se o canal não
     * respondeu) só é chamado quando passou o prazo. Uma verificação "no futuro" (o relógio do celular voltou) não
     * segura as próximas.
     */
    fun decide(installed: String, manifest: () -> String?, lastCheckMillis: Long, nowMillis: Long, inCall: Boolean): Decision {
        if (checkedRecently(lastCheckMillis, nowMillis)) return Decision.NONE
        val json = manifest() ?: return Decision.NONE
        val published = core.parseManifest(json, allowedPrefix) { reason -> log("o canal não vale: $reason") }
            ?: return Decision.NONE
        if (core.compareVersions(published.versionText, installed) <= 0) {
            log("nada novo (publicada ${published.versionText}, instalada $installed)")
            return Decision.NONE
        }
        if (inCall) {
            log("versão nova ${published.versionText}, com uma ligação em andamento")
            return Decision.BLOCKED_BY_CALL
        }
        log("versão nova ${published.versionText} (instalada $installed)")
        return Decision.PROMPT(published)
    }

    companion object {
        /** O prazo entre duas verificações (spec 7.6.1). */
        const val CHECK_INTERVAL_MILLIS = 24L * 60 * 60 * 1000

        private const val RELEASES = "https://github.com/LucasCPena/starsonic-phone/releases/download/"

        /** O começo obrigatório do endereço do APK: os assets das tags android-v (spec 7.7). */
        const val INSTALLER_PREFIX = RELEASES + "android-v"

        /** O canal das versões estáveis (o release fixo canal-android). */
        const val STABLE_CHANNEL = RELEASES + "canal-android/versao-android.json"

        /** O canal das versões de teste, -rc (o pre-release fixo canal-teste-android). */
        const val TEST_CHANNEL = RELEASES + "canal-teste-android/versao-android.json"

        /** O aviso de quando há versão nova com uma ligação em andamento (spec 7.6.3 e 11.1). */
        const val CALL_MESSAGE = "Termine a chamada para atualizar."

        /** O canal da versão instalada: o de teste para as -rc, o estável para as finais. */
        fun channelUrl(installedVersion: String): String = if ("-rc." in installedVersion) TEST_CHANNEL else STABLE_CHANNEL

        /** A pergunta do aviso de versão nova (spec 7.6.2). */
        fun question(version: String): String = "Nova versão do Starsonic Phone disponível ($version). Atualizar agora?"

        private fun checkedRecently(lastCheckMillis: Long, nowMillis: Long): Boolean =
            nowMillis - lastCheckMillis in 0 until CHECK_INTERVAL_MILLIS
    }
}
