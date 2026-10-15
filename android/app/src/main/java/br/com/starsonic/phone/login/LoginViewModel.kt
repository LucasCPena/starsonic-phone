package br.com.starsonic.phone.login

import androidx.lifecycle.ViewModel
import br.com.starsonic.phone.core.Check
import br.com.starsonic.phone.core.Clock
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.LoginFlow
import br.com.starsonic.phone.core.LoginFlowHandle
import br.com.starsonic.phone.core.Scheduled
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.data.AccountStore
import br.com.starsonic.phone.engine.SipGateway
import br.com.starsonic.phone.engine.Transport
import java.util.concurrent.Executor
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
 * Só vale o resultado da conta tentada: o motor dá um id a cada conta, e um resultado de outra (a anterior,
 * que ainda estava na fila ou voltou depois de uma falha) é ignorado.
 *
 * Com uma conta gravada ([previous]), é a tela de Editar: servidor, protocolo e ramal preenchidos e a senha
 * vazia. A conta gravada vem de quem cria o modelo, já lida fora da thread principal (Keystore e disco).
 *
 * Threads: [submit] espera o motor aceitar a conta e não pode rodar na thread principal; os resultados
 * chegam por [onRegistration] (na thread dos eventos do motor) e o fim do tempo, na thread do relógio. A volta
 * à conta anterior depois do fim do tempo ou da saída da tela espera o motor: roda em [background].
 */
class LoginViewModel(
    private val core: CoreRules,
    private val gateway: SipGateway,
    private val store: AccountStore,
    private val clock: Clock,
    private val previous: Account?,
    defaultTransport: Transport = Transport.UDP,
    message: String = "",
    newFlow: (CoreRules) -> LoginFlow = ::LoginFlowHandle,
    private val background: Executor = Executor { task -> thread(name = "starsonic-entrar") { task.run() } },
    private val log: (String) -> Unit = {},
) : ViewModel() {
    private val mutableState = MutableStateFlow(
        previous?.let { LoginState(server = it.address, transport = it.transport, ramal = it.ramal) }
            ?: LoginState(transport = defaultTransport),
    )

    val state: StateFlow<LoginState> = mutableState

    // Uma tentativa: a conta e o id que o motor deu a ela (0 até o setAccount voltar). Os resultados que
    // chegam antes do id (o motor pode avisar antes de o setAccount voltar) esperam em early.
    private class Attempt(val account: Account) {
        var accountId = 0
        val early = mutableListOf<Pair<Int, Int>>()   // (código, id da conta)
    }

    // A trava guarda o LoginFlow, a tentativa, o id da conta do motor e o aviso de fim do tempo; nunca fica
    // presa numa chamada ao motor nem ao armazenamento.
    private val lock = Any()
    private val flow = newFlow(core)
    private var attempt: Attempt? = null
    private var currentAccountId = 0   // a conta que este modelo pôs no motor: a tentada, ou a que voltou
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
        val tried = synchronized(lock) { begin() } ?: return
        val account = tried.account
        val accountId = gateway.setAccount(account.address, account.transport, account.ramal, account.senha)
        finish(synchronized(lock) { accepted(tried, accountId) })
    }

    /** O resultado do registro de uma conta ([br.com.starsonic.phone.engine.EngineEvents.onRegistration]). */
    fun onRegistration(code: Int, active: Boolean, accountId: Int) {
        if (code in 200..299 && !active) return   // (200, false): uma conta saiu do servidor, não registrou
        finish(synchronized(lock) { result(code, accountId) })
    }

    override fun onCleared() {
        // Sair da tela no meio da tentativa a desfaz, como no Windows; fora da thread principal, porque o
        // motor pode levar alguns segundos para voltar à conta anterior.
        val outcome = synchronized(lock) {
            flow.onTimeout().also { flow.close() }
        } ?: return
        background.execute { finish(outcome) }
    }

    // Na thread do relógio: o desfecho sai dela, porque a volta à conta anterior espera o motor.
    private fun onTimeout() {
        val outcome = synchronized(lock) { flow.onTimeout() } ?: return
        background.execute { finish(outcome) }
    }

    // Com a trava: confere os campos, na ordem, e começa a tentativa (ou null).
    private fun begin(): Attempt? {
        val fields = mutableState.value
        if (fields.loading || fields.done) return null
        val (serverCheck, server) = core.validateServer(fields.server)
        if (serverCheck != Check.OK) return refuse(server)
        val (ramalCheck, ramal) = core.validateRamal(fields.ramal)
        if (ramalCheck != Check.OK) return refuse(ramal)
        if (fields.senha.isEmpty()) return refuse(EMPTY_PASSWORD)
        val tried = Attempt(Account(server, fields.transport, ramal, fields.senha))
        attempt = tried
        flow.start()
        mutableState.update { it.copy(message = "", loading = true) }
        timeout = clock.schedule(LOGIN_TIMEOUT_MILLIS) { onTimeout() }
        return tried
    }

    private fun refuse(message: String): Attempt? {
        mutableState.update { it.copy(message = message) }
        return null
    }

    // Com a trava: o motor deu o id da conta tentada (0: recusou a conta, e nada vai chegar). Os resultados
    // que chegaram antes do id valem agora, na ordem, se forem dela.
    private fun accepted(tried: Attempt, accountId: Int): LoginFlowHandle.Outcome? {
        if (attempt !== tried) return null   // a tentativa já acabou (o tempo esgotou)
        if (accountId == 0) return flow.onRegistration(NO_ANSWER)
        tried.accountId = accountId
        currentAccountId = accountId
        val early = tried.early.toList()
        tried.early.clear()
        for ((code, id) in early) {
            if (id != accountId) continue
            val outcome = flow.onRegistration(code)
            if (outcome != null) return outcome
        }
        return null
    }

    // Com a trava: um resultado de registro. Só vale o da conta deste modelo; enquanto o id da conta tentada
    // não chegou, o resultado espera.
    private fun result(code: Int, accountId: Int): LoginFlowHandle.Outcome? {
        val tried = attempt
        if (tried != null && tried.accountId == 0) {
            tried.early += code to accountId
            return null
        }
        return if (accountId == currentAccountId) flow.onRegistration(code) else null
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
            if (tried != null) store.save(tried.account)
            mutableState.update { it.copy(loading = false, done = true) }
            return
        }
        val restored = if (previous != null) {
            gateway.setAccount(previous.address, previous.transport, previous.ramal, previous.senha)
        } else {
            gateway.removeAccount()
            0
        }
        synchronized(lock) { currentAccountId = restored }
        mutableState.update { it.copy(message = outcome.message, loading = false) }
    }

    private companion object {
        const val LOGIN_TIMEOUT_MILLIS = 15_000L
        const val NO_ANSWER = 0
        const val EMPTY_PASSWORD = "Digite a senha."
    }
}
