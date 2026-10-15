package br.com.starsonic.phone.login

import androidx.lifecycle.ViewModel
import br.com.starsonic.phone.core.Clock
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.data.AccountStore
import br.com.starsonic.phone.engine.SipGateway
import br.com.starsonic.phone.engine.Transport
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/** O que a tela Entrar mostra: os campos, o aviso, se espera o servidor e se já entrou. */
data class LoginState(
    val server: String = "",
    val transport: Transport = Transport.UDP,
    val ramal: String = "",
    val senha: String = "",
    val message: String = "",
    val loading: Boolean = false,
    val done: Boolean = false,
)

/** A tela Entrar (spec 7.1). */
class LoginViewModel(
    private val core: CoreRules,
    private val gateway: SipGateway,
    private val store: AccountStore,
    private val clock: Clock,
    defaultTransport: Transport = Transport.UDP,
) : ViewModel() {
    private val mutableState = MutableStateFlow(LoginState(transport = defaultTransport))

    val state: StateFlow<LoginState> = mutableState

    fun onServerChange(value: String) = mutableState.update { it.copy(server = value) }

    fun onTransportChange(value: Transport) = mutableState.update { it.copy(transport = value) }

    fun onRamalChange(value: String) = mutableState.update { it.copy(ramal = value) }

    fun onSenhaChange(value: String) = mutableState.update { it.copy(senha = value) }

    fun submit() {}

    fun onRegistration(code: Int, active: Boolean) {}
}
