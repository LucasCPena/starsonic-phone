package br.com.starsonic.phone.core

/**
 * A espera da tela Entrar pelo resultado do registro (o LoginFlow do núcleo). No app, [LoginFlowHandle];
 * nos testes na JVM, um falso. Quem usa sincroniza as chamadas.
 */
interface LoginFlow {
    /** Começa a esperar (do estado inicial ou depois de uma falha; nos outros, nada). */
    fun start()

    /** Só vale esperando: 100 a 199 continua esperando (null), 200 a 299 confirma, o resto desfaz. */
    fun onRegistration(code: Int): LoginFlowHandle.Outcome?

    /** O tempo acabou: desfaz, com o aviso de "sem resposta"; o que chegar depois é ignorado. */
    fun onTimeout(): LoginFlowHandle.Outcome?

    /** Solta o que o fluxo segura; depois disso nada vale (tudo devolve null). */
    fun close()
}

/**
 * O LoginFlow do núcleo (starsonic/core/LoginFlow.cpp) pela ponte JNI: as decisões são as do núcleo, e o
 * aviso de cada falha vem do [CoreRules] (RegistrationMessage; no fim do tempo, o do código 0, "sem
 * resposta"). O objeto nativo é solto em [close].
 */
class LoginFlowHandle(private val core: CoreRules) : LoginFlow {
    /** commit: registrou (gravar a conta e sair); rollback: falhou (voltar à conta anterior e avisar). */
    data class Outcome(val commit: Boolean, val rollback: Boolean, val message: String)

    init {
        System.loadLibrary("starsonic")   // a segunda carga não faz nada
    }

    private var handle: Long = nativeCreate()

    init {
        if (handle == 0L) throw OutOfMemoryError("LoginFlow")
    }

    override fun start() {
        if (handle != 0L) nativeStart(handle)
    }

    override fun onRegistration(code: Int): Outcome? =
        if (handle == 0L) null else outcome(nativeOnRegistration(handle, code), code)

    override fun onTimeout(): Outcome? = if (handle == 0L) null else outcome(nativeOnTimeout(handle), NO_ANSWER)

    override fun close() {
        if (handle != 0L) {
            nativeRelease(handle)
            handle = 0L
        }
    }

    // O desfecho que a ponte devolve: 0 = nada a fazer, 1 = confirmou, 2 = desfez.
    private fun outcome(kind: Int, code: Int): Outcome? = when (kind) {
        COMMIT -> Outcome(commit = true, rollback = false, message = "")
        ROLLBACK -> Outcome(commit = false, rollback = true, message = core.registrationMessage(code))
        else -> null
    }

    private external fun nativeCreate(): Long

    private external fun nativeStart(handle: Long)

    private external fun nativeOnRegistration(handle: Long, code: Int): Int

    private external fun nativeOnTimeout(handle: Long): Int

    private external fun nativeRelease(handle: Long)

    private companion object {
        const val COMMIT = 1
        const val ROLLBACK = 2
        const val NO_ANSWER = 0
    }
}
