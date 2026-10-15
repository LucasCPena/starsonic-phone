package br.com.starsonic.phone.login

import androidx.lifecycle.ViewModel
import br.com.starsonic.phone.core.Check
import br.com.starsonic.phone.core.Clock
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.LoginFlowHandle
import br.com.starsonic.phone.core.Scheduled
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.data.AccountStore
import br.com.starsonic.phone.engine.SipGateway
import br.com.starsonic.phone.engine.Transport
import kotlin.concurrent.thread
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/** O que a tela Entrar mostra: os campos, o aviso, se espera o servidor e se já entrou (done). */
data class LoginState(
    val server: String = "",
    val transport: Transport = Transport.UDP,
    val ramal: String = "",
    val senha: String = "",
    val message: String = "",
    val loading: Boolean = false,
    val done: Boolean = false,
)

/**
 * A tela Entrar (spec 7.1). [submit] confere o servidor, o ramal e a senha, nessa ordem (os avisos do
 * servidor e do ramal vêm do núcleo), registra a conta e espera o resultado por até 15 s com o LoginFlow do
 * núcleo. Registrou: a conta é gravada e a tela acaba ([LoginState.done]). Falhou ou o tempo acabou: nada é
 * gravado, a conta anterior volta ao motor (sem ela, a tentada sai) e o aviso aparece.
 *
 * Com uma conta gravada, é a tela de Editar: servidor, protocolo e ramal preenchidos e a senha vazia.
 *
 * Threads: [submit] espera o motor aceitar a conta e não pode rodar na thread principal; os resultados
 * chegam por [onRegistration] (na thread dos eventos do motor) e o fim do tempo, na thread do relógio.
 */
class LoginViewModel(
    private val core: CoreRules,
    private val gateway: SipGateway,
    private val store: AccountStore,
    private val clock: Clock,
    defaultTransport: Transport = Transport.UDP,
) : ViewModel() {
    private val previous: Account? = store.load()

    private val mutableState = MutableStateFlow(
        previous?.let { LoginState(server = it.address, transport = it.transport, ramal = it.ramal) }
            ?: LoginState(transport = defaultTransport),
    )

    val state: StateFlow<LoginState> = mutableState

    // A trava guarda o LoginFlow, a conta tentada e o aviso de fim do tempo; nunca fica presa numa chamada
    // ao motor nem ao armazenamento.
    private val lock = Any()
    private val flow = LoginFlowHandle(core)
    private var attempt: Account? = null
    private var timeout: Scheduled? = null

    fun onServerChange(value: String) = mutableState.update { it.copy(server = value) }

    fun onTransportChange(value: Transport) = mutableState.update { it.copy(transport = value) }

    fun onRamalChange(value: String) = mutableState.update { it.copy(ramal = value) }

    fun onSenhaChange(value: String) = mutableState.update { it.copy(senha = value) }

    /**
     * Confere os campos e registra a conta. Espera o motor aceitar a conta (até alguns segundos com uma conta
     * anterior saindo): chame fora da thread principal. Enquanto espera o resultado, não faz nada.
     */
    fun submit() {
        val account = synchronized(lock) { begin() } ?: return
        if (!gateway.setAccount(account.address, account.transport, account.ramal, account.senha)) {
            finish(synchronized(lock) { flow.onRegistration(NO_ANSWER) })   // o motor recusou: nada vai chegar
        }
    }

    /** O resultado do registro ([br.com.starsonic.phone.engine.EngineEvents.onRegistration]). */
    fun onRegistration(code: Int, active: Boolean) {
        if (code in 200..299 && !active) return   // (200, false): uma conta saiu do servidor, não registrou
        finish(synchronized(lock) { flow.onRegistration(code) })
    }

    override fun onCleared() {
        // Sair da tela no meio da tentativa a desfaz, como no Windows; fora da thread principal, porque o
        // motor pode levar alguns segundos para voltar à conta anterior.
        val outcome = synchronized(lock) { flow.onTimeout() } ?: return
        thread(name = "starsonic-entrar") { finish(outcome) }
    }

    private fun onTimeout() = finish(synchronized(lock) { flow.onTimeout() })

    // Com a trava: confere os campos, na ordem, e começa a tentativa. A conta a registrar, ou null.
    private fun begin(): Account? {
        val fields = mutableState.value
        if (fields.loading || fields.done) return null
        val (serverCheck, server) = core.validateServer(fields.server)
        if (serverCheck != Check.OK) return refuse(server)
        val (ramalCheck, ramal) = core.validateRamal(fields.ramal)
        if (ramalCheck != Check.OK) return refuse(ramal)
        if (fields.senha.isEmpty()) return refuse(EMPTY_PASSWORD)
        val account = Account(server, fields.transport, ramal, fields.senha)
        attempt = account
        flow.start()
        mutableState.update { it.copy(message = "", loading = true) }
        timeout = clock.schedule(LOGIN_TIMEOUT_MILLIS) { onTimeout() }
        return account
    }

    private fun refuse(message: String): Account? {
        mutableState.update { it.copy(message = message) }
        return null
    }

    // O desfecho da tentativa (o LoginFlow dá um só por tentativa; null = nada a fazer). A tela continua
    // esperando (loading) até o motor voltar à conta anterior, então nenhuma tentativa nova passa à frente.
    private fun finish(outcome: LoginFlowHandle.Outcome?) {
        if (outcome == null) return
        val tried = synchronized(lock) {
            timeout?.cancel()
            timeout = null
            attempt.also { attempt = null }
        }
        if (outcome.commit) {
            if (tried != null) store.save(tried)
            mutableState.update { it.copy(loading = false, done = true) }
            return
        }
        if (previous != null) {
            gateway.setAccount(previous.address, previous.transport, previous.ramal, previous.senha)
        } else {
            gateway.removeAccount()
        }
        mutableState.update { it.copy(message = outcome.message, loading = false) }
    }

    private companion object {
        const val LOGIN_TIMEOUT_MILLIS = 15_000L
        const val NO_ANSWER = 0
        const val EMPTY_PASSWORD = "Digite a senha."
    }
}
