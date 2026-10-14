package br.com.starsonic.phone.main

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import br.com.starsonic.phone.R

private val StarsonicBlue = Color(0xFF383881)
private val StarsonicCyan = Color(0xFF3DB1CC)

/** Tela provisória: a faixa azul com o logo; as telas do app entram nas próximas tarefas. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        // A faixa é azul nos dois modos: ícones claros na barra de status, que fica por cima dela.
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        setContent {
            StarsonicTheme {
                Surface(Modifier.fillMaxSize()) {
                    Column {
                        Band()
                    }
                }
            }
        }
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

/** A faixa do topo: azul, com "starsonic" em branco e ciano (branding/logo-faixa.png). */
@Composable
private fun Band() {
    Box(
        Modifier
            .fillMaxWidth()
            .background(StarsonicBlue)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Image(
            painter = painterResource(R.drawable.logo_faixa),
            contentDescription = "Starsonic",
            modifier = Modifier.height(32.dp),
        )
    }
}
