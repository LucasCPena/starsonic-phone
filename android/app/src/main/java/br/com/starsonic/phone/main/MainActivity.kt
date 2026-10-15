package br.com.starsonic.phone.main

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import br.com.starsonic.phone.App
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.login.LoginScreen
import br.com.starsonic.phone.login.LoginViewModel

/**
 * Sem conta gravada, a tela Entrar; com conta, a tela principal (provisória: a faixa com o status; o
 * Teclado e os Recentes entram depois).
 */
class MainActivity : ComponentActivity() {
    private val app: App
        get() = application as App

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        // A faixa é azul nos dois modos: ícones claros na barra de status, que fica por cima dela.
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        val saved = app.store.load()
        setContent {
            StarsonicTheme {
                Surface(Modifier.fillMaxSize()) {
                    var account by remember { mutableStateOf(saved) }
                    val current = account
                    if (current == null) {
                        val model = remember { loginModel() }
                        val state by model.state.collectAsState()
                        LaunchedEffect(state.done) {
                            if (state.done) {
                                app.loginEvents = null
                                account = app.store.load()
                            }
                        }
                        LoginScreen(model)
                    } else {
                        MainScreen(current)
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) app.loginEvents = null
    }

    // O modelo da tela Entrar (sobrevive à rotação e às outras recriações da activity), ligado aos
    // resultados do registro.
    private fun loginModel(): LoginViewModel {
        val model = ViewModelProvider(this, LoginModelFactory(app))[LoginViewModel::class.java]
        app.loginEvents = model::onRegistration
        return model
    }

    @Composable
    private fun MainScreen(account: Account) {
        val registration by app.registration.collectAsState()
        Column(Modifier.fillMaxSize()) {
            Band(status = bandStatus(registration, account.ramal, app.core))
        }
    }

    private class LoginModelFactory(private val app: App) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            LoginViewModel(app.core, app.gateway, app.store, app.clock, previous = null, defaultTransport = app.defaultTransport) as T
    }
}

/** Segue o modo claro ou escuro do celular. */
@Composable
private fun StarsonicTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) {
        darkColorScheme(primary = StarsonicCyan, secondary = StarsonicCyan)
    } else {
        lightColorScheme(primary = StarsonicBlue, secondary = StarsonicCyan)
    }
    MaterialTheme(colorScheme = colors, content = content)
}
