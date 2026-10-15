package br.com.starsonic.phone.core

/** O resultado das conferências do núcleo (ValidateServerAddress e ValidateRamal). */
enum class Check { OK, EMPTY, INVALID }

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
}

/** O LoginFlow do núcleo para a tela Entrar. */
class LoginFlowHandle(private val core: CoreRules) {
    /** commit: registrou (gravar a conta e sair); rollback: falhou (voltar à conta anterior e avisar). */
    data class Outcome(val commit: Boolean, val rollback: Boolean, val message: String)

    fun start() {}

    fun onRegistration(code: Int): Outcome? = null

    fun onTimeout(): Outcome? = null
}
