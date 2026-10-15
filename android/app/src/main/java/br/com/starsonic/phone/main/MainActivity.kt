package br.com.starsonic.phone.main

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import br.com.starsonic.phone.App
import br.com.starsonic.phone.R
import br.com.starsonic.phone.call.CallActivity
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.login.LoginScreen
import br.com.starsonic.phone.login.LoginViewModel
import br.com.starsonic.phone.permissions.Grants
import br.com.starsonic.phone.permissions.Guide
import br.com.starsonic.phone.permissions.PermissionsScreen
import br.com.starsonic.phone.permissions.WarningBanner
import br.com.starsonic.phone.permissions.deviceGuide
import br.com.starsonic.phone.service.SipService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Sem conta gravada, a tela Entrar; com conta, a tela principal: a faixa com o status, a faixa de avisos e as
 * abas Teclado e Recentes (spec 4.1), com a volta para a ligação em andamento. Depois de um Entrar que começou
 * sem conta gravada, a tela Permissões, se falta alguma coisa. A notificação de ligação perdida abre o
 * Recentes ([ACTION_RECENTS]).
 *
 * A conta gravada é lida fora da thread principal (Keystore e disco), com a tela de abertura na frente. Com a
 * conta, a activity inicia o [SipService] ao abrir e a cada volta ao app (com a conta já no motor, ele não
 * registra de novo); o fim do Entrar também o inicia.
 */
class MainActivity : ComponentActivity() {
    private val app: App
        get() = application as App

    // O que o app leu ao abrir (null enquanto lê: a tela de abertura fica na frente).
    private var opening by mutableStateOf<Opening?>(null)

    // Há conta gravada (a de quando o app abriu, ou a do Entrar). Só na thread principal.
    private var signedIn = false

    // Cada volta ao app (ON_RESUME): a faixa de avisos e a tela Permissões conferem de novo as permissões.
    private var resumes by mutableIntStateOf(0)

    // A aba da tela principal (a notificação de perdida pede o Recentes).
    private var tab by mutableIntStateOf(TAB_KEYPAD)

    /** A conta gravada (null: a tela Entrar) e o protocolo da tela Entrar numa conta nova. */
    private class Opening(val account: Account?, val transport: Transport)

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen().setKeepOnScreenCondition { opening == null }
        // A faixa é azul nos dois modos: ícones claros na barra de status, que fica por cima dela.
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null && intent?.action == ACTION_RECENTS) tab = TAB_RECENTS
        lifecycleScope.launch {
            val read = withContext(Dispatchers.IO) {
                val account = app.store.load()
                Opening(account, if (account == null) app.defaultTransport else account.transport)
            }
            if (read.account != null) {
                signedIn = true
                SipService.start(this@MainActivity)
            } else {
                // O motor sobe enquanto a pessoa preenche a tela Entrar (uma vez por processo).
                launch(Dispatchers.IO) { app.connection.ensureStarted() }
            }
            opening = read
        }
        setContent {
            StarsonicTheme {
                Surface(Modifier.fillMaxSize()) {
                    var entered by rememberSaveable { mutableStateOf(false) }
                    var askPermissions by rememberSaveable { mutableStateOf(false) }
                    val start = opening
                    when {
                        start == null -> {}   // a tela de abertura está na frente
                        start.account == null && !entered -> Entrar(start.transport) {
                            entered = true
                            app.calls.onLogin()   // depois de um Sair, as ligações voltam a valer
                            askPermissions = needsPermissions()
                        }
                        askPermissions -> {
                            val status by app.connection.status.collectAsState()
                            PermissionsScreen(status.band, resumes, deviceGuide()) { askPermissions = false }
                        }
                        else -> MainScreen()
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_RECENTS) tab = TAB_RECENTS
    }

    override fun onStart() {
        super.onStart()
        // A cada volta ao app com a conta gravada: se o Android fechou o serviço, ele volta.
        if (signedIn) SipService.start(this)
    }

    override fun onResume() {
        super.onResume()
        resumes++
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) app.connection.loginEvents = null
    }

    /** A tela Entrar sem conta gravada; no fim, o serviço fica com a conta que ela registrou. */
    @Composable
    private fun Entrar(transport: Transport, onDone: () -> Unit) {
        val model = remember { loginModel(transport) }
        val state by model.state.collectAsState()
        LaunchedEffect(state.done) {
            if (state.done) {
                app.connection.loginEvents = null
                signedIn = true
                // Sem o serviço, a conta não fica registrada; ele começa na próxima volta ao app.
                if (!SipService.start(this@MainActivity)) app.gateway.removeAccount()
                onDone()
            }
        }
        LoginScreen(model)
    }

    @Composable
    private fun MainScreen() {
        val status by app.connection.status.collectAsState()
        val banner = remember(resumes) { Grants.read(this@MainActivity).banner }
        val call by app.calls.state.collectAsState()
        val message by app.calls.endMessage.collectAsState()
        Column(Modifier.fillMaxSize()) {
            Band(status = status.band)
            if (banner != null) WarningBanner(banner)
            if (call != null) ReturnToCall()
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (tab) {
                    TAB_RECENTS -> RecentsScreen(app.recents, onDial = { dial(it) })
                    else -> DialerScreen(message, onDial = ::dial)
                }
            }
            NavigationBar(Modifier.navigationBarsPadding()) {
                NavigationBarItem(
                    selected = tab == TAB_KEYPAD,
                    onClick = { tab = TAB_KEYPAD },
                    icon = { Icon(painterResource(R.drawable.ic_teclado), contentDescription = null) },
                    label = { Text(KEYPAD) },
                    modifier = Modifier.testTag("aba-teclado"),
                )
                NavigationBarItem(
                    selected = tab == TAB_RECENTS,
                    onClick = { tab = TAB_RECENTS },
                    icon = { Icon(painterResource(R.drawable.ic_recentes), contentDescription = null) },
                    label = { Text(RECENTS) },
                    modifier = Modifier.testTag("aba-recentes"),
                )
            }
        }
    }

    // A faixa verde da ligação em andamento: tocar volta à tela de chamada.
    @Composable
    private fun ReturnToCall() {
        Text(
            RETURN_TO_CALL,
            color = Color.White,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier
                .fillMaxWidth()
                .background(CallGreen)
                .clickable { startActivity(CallActivity.intent(this)) }
                .padding(horizontal = 16.dp, vertical = 10.dp)
                .testTag("voltar-ligacao"),
        )
    }

    // Liga (do Teclado ou do Recentes) e abre a tela de chamada; sem registro, o aviso aparece no Teclado.
    private fun dial(number: String): Boolean {
        val dialed = app.calls.dial(number)
        if (dialed) startActivity(CallActivity.intent(this))
        return dialed
    }

    // A tela Permissões aparece se falta alguma permissão, ou num celular com o passo a passo do fabricante.
    private fun needsPermissions(): Boolean = Grants.read(this).missing.isNotEmpty() || deviceGuide() != Guide.GENERIC

    // O modelo da tela Entrar (sobrevive às recriações da activity), ligado aos resultados do registro.
    private fun loginModel(transport: Transport): LoginViewModel {
        val model = ViewModelProvider(this, LoginModelFactory(app, transport))[LoginViewModel::class.java]
        app.connection.loginEvents = model::onRegistration
        return model
    }

    companion object {
        /** A notificação de ligação perdida: abre o app no Recentes. */
        const val ACTION_RECENTS = "br.com.starsonic.phone.action.RECENTES"

        private const val TAB_KEYPAD = 0
        private const val TAB_RECENTS = 1
        private const val KEYPAD = "Teclado"
        private const val RECENTS = "Recentes"
        private const val RETURN_TO_CALL = "Ligação em andamento. Toque para voltar."
    }

    // Só sem conta gravada (previous = null); a tela de Editar, com a conta, vem na Task 9.
    private class LoginModelFactory(private val app: App, private val transport: Transport) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            LoginViewModel(app.core, app.gateway, app.store, app.clock, previous = null, defaultTransport = transport) as T
    }
}
