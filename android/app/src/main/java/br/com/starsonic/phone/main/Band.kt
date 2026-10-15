package br.com.starsonic.phone.main

import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import br.com.starsonic.phone.R

internal val StarsonicBlue = Color(0xFF383881)
internal val StarsonicCyan = Color(0xFF3DB1CC)

/** Ligar e Atender (Global Constraints: verde). */
internal val CallGreen = Color(0xFF2E9E4F)

/** Recusar e Desligar (Global Constraints: vermelho). */
internal val CallRed = Color(0xFFD93025)

/** O tema do app: segue o modo claro ou escuro do celular (a faixa e o logo não mudam). */
@Composable
internal fun StarsonicTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) {
        darkColorScheme(primary = StarsonicCyan, secondary = StarsonicCyan)
    } else {
        lightColorScheme(primary = StarsonicBlue, secondary = StarsonicCyan)
    }
    MaterialTheme(colorScheme = colors, content = content)
}

/**
 * A faixa do topo: azul, por baixo da barra de status, com "starsonic" em branco e ciano
 * (branding/logo-faixa.png), o status da conta (o StatusModel: ex.: "Conectado · 2001") e, na tela principal, o
 * menu (⋮) à direita ([menu]).
 */
@Composable
fun Band(status: String, menu: (@Composable () -> Unit)? = null) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(StarsonicBlue)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = 16.dp, end = if (menu == null) 16.dp else 4.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Image(
                painter = painterResource(R.drawable.logo_faixa),
                contentDescription = "Starsonic",
                modifier = Modifier.height(32.dp),
            )
            Text(
                text = status,
                color = Color.White,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 4.dp).testTag("status"),
            )
        }
        menu?.invoke()
    }
}
