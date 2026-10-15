package br.com.starsonic.phone.main

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import br.com.starsonic.phone.R
import br.com.starsonic.phone.Registration
import br.com.starsonic.phone.core.CoreRules

internal val StarsonicBlue = Color(0xFF383881)
internal val StarsonicCyan = Color(0xFF3DB1CC)

/**
 * A faixa do topo: azul, por baixo da barra de status, com "starsonic" em branco e ciano
 * (branding/logo-faixa.png) e o status da conta (ex.: "Conectado · 2001").
 */
@Composable
fun Band(status: String) {
    Column(
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
        Text(
            text = status,
            color = Color.White,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 4.dp).testTag("status"),
        )
    }
}

/**
 * O status da faixa pelo último resultado do registro: registrada, "Conectado · <ramal>"; ainda sem resposta
 * (ou a conta saindo), "Conectando…"; uma falha, o aviso do núcleo. (Provisório: a Task 7 traz o
 * StatusModel, com "Sem internet".)
 */
fun bandStatus(registration: Registration?, ramal: String, core: CoreRules): String = when {
    registration == null || registration.code in 100..299 && !registration.active -> "Conectando…"
    registration.code in 200..299 -> "Conectado · $ramal"
    else -> core.registrationMessage(registration.code).ifEmpty { "Conectando…" }
}
