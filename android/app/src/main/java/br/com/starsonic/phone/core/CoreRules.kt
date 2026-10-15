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

/**
 * O LoginFlow do núcleo (starsonic/core/LoginFlow.cpp) para a tela Entrar: a mesma espera pelo resultado do
 * registro, com os avisos do núcleo pelo [CoreRules] (o Android não tem TLS). Quem usa sincroniza as chamadas.
 */
class LoginFlowHandle(private val core: CoreRules) {
    /** commit: registrou (gravar a conta e sair); rollback: falhou (voltar à conta anterior e avisar). */
    data class Outcome(val commit: Boolean, val rollback: Boolean, val message: String)

    private enum class State { IDLE, PENDING, DONE }

    private var state = State.IDLE

    /** Começa a esperar (do estado inicial ou depois de uma falha; nos outros, nada). */
    fun start() {
        if (state == State.IDLE) state = State.PENDING
    }

    /** Só vale esperando: 100 a 199 continua esperando (null), 200 a 299 confirma, o resto desfaz. */
    fun onRegistration(code: Int): Outcome? {
        if (state != State.PENDING || code in 100..199) return null
        if (code in 200..299) {
            state = State.DONE
            return Outcome(commit = true, rollback = false, message = "")
        }
        state = State.IDLE
        return Outcome(commit = false, rollback = true, message = core.registrationMessage(code))
    }

    /** O tempo acabou: desfaz com o aviso de "sem resposta" (código 0); o que chegar depois é ignorado. */
    fun onTimeout(): Outcome? {
        if (state != State.PENDING) return null
        state = State.IDLE
        return Outcome(commit = false, rollback = true, message = core.registrationMessage(NO_ANSWER))
    }

    private companion object {
        const val NO_ANSWER = 0
    }
}
