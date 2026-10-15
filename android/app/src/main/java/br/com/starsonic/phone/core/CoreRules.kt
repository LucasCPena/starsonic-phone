package br.com.starsonic.phone.core

/** O resultado das conferências do núcleo (ValidateServerAddress e ValidateRamal). */
enum class Check { OK, EMPTY, INVALID }

/**
 * O versao-android.json que o núcleo aceitou (ParseManifest, spec 7.7): a versão (X.Y.Z ou X.Y.Z-rc.N), o endereço do
 * APK (dentro do endereço permitido), o SHA-256 dele em minúsculas e as notas (até 500 caracteres e "…").
 */
data class Manifest(val versionText: String, val installerUrl: String, val sha256: String, val notes: String)

/**
 * As regras e os textos do núcleo em C++ (starsonic/core), os mesmos do Windows. No app, [NativeCoreRules];
 * nos testes na JVM, uma falsa.
 */
interface CoreRules {
    /** ValidateServerAddress: (OK, o endereço normalizado) ou (EMPTY ou INVALID, o aviso da tela Entrar). */
    fun validateServer(raw: String): Pair<Check, String>

    /** ValidateRamal: (OK, o ramal normalizado) ou (EMPTY ou INVALID, o aviso da tela Entrar). */
    fun validateRamal(raw: String): Pair<Check, String>

    /** RegistrationMessage: o aviso de uma falha do registro (0 = sem resposta); "" para 100 a 299. */
    fun registrationMessage(code: Int): String

    /** CallEndMessage: o aviso de uma ligação que não completou; "" quando não há o que avisar. */
    fun callEndMessage(code: Int): String

    /** NormalizeDialString: o número a discar, sem espaços, traços, pontos e parênteses. */
    fun normalizeDialString(raw: String): String

    /**
     * ParseManifest: o versao-android.json, se ele vale (JSON; versão; APK começando com [allowedPrefix] e, depois dele,
     * só com letras, dígitos, '.', '_', '-' e '/', sem ".."; SHA-256 com 64 dígitos hexadecimais). Senão, null, e o motivo
     * (em ASCII, para o log) vai para [onError].
     */
    fun parseManifest(json: String, allowedPrefix: String, onError: (String) -> Unit = {}): Manifest?

    /**
     * CompareVersions de duas versões em texto (ParseVersion: X.Y.Z ou X.Y.Z-rc.N): negativo se [a] vem antes de [b], 0 se
     * são iguais, positivo se [a] vem depois; a final vem depois de qualquer rc dela. Um texto que não é versão não tem
     * ordem: dá 0, como se fossem iguais (o atualizador não oferece nada).
     */
    fun compareVersions(a: String, b: String): Int
}
