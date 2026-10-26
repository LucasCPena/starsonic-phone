package br.com.starsonic.phone.permissions

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import br.com.starsonic.phone.main.Band
import br.com.starsonic.phone.ui.LocalStarsonicColors
import br.com.starsonic.phone.ui.PlusJakartaSans
import br.com.starsonic.phone.ui.Starsonic
import br.com.starsonic.phone.ui.StarsonicIcons

/**
 * A tela Permissões (spec 4.1 e 7.1 item 4), depois de um Entrar que começou sem conta gravada. Mostra só o
 * que falta, cada item explicado pelo aviso dele na faixa, com "Permitir", que abre a janela do próprio
 * Android: o pedido das notificações e do microfone (a partir do segundo toque, que o Android pode não mostrar
 * mais, a página do app), o ajuste da tela cheia e o pedido para sair da otimização de bateria. Em Xiaomi e
 * Samsung, o passo a passo dos ajustes do fabricante, com "Abrir ajustes" (a página do app). "Continuar" segue
 * para a tela principal; sem nada que falte nem passo a passo, ela segue sozinha.
 *
 * [resumes] muda a cada volta ao app (ON_RESUME): a tela confere de novo o que falta.
 */
@Composable
fun PermissionsScreen(status: String, resumes: Int, guide: Guide, onContinue: () -> Unit) {
    val context = LocalContext.current
    val grants = remember(resumes) { Grants.read(context) }
    val missing = grants.missing
    var askedNotifications by rememberSaveable { mutableStateOf(false) }
    var askedMicrophone by rememberSaveable { mutableStateOf(false) }
    // O resultado chega antes da volta ao app (ON_RESUME), que confere tudo de novo.
    val requestNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val requestMicrophone = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}

    LaunchedEffect(missing, guide) {
        if (missing.isEmpty() && guide == Guide.GENERIC) onContinue()
    }

    val allow: (Banner) -> Unit = { banner ->
        when {
            banner == Banner.NOTIFICATIONS && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !askedNotifications -> {
                askedNotifications = true
                requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
            banner == Banner.MICROPHONE && !askedMicrophone -> {
                askedMicrophone = true
                requestMicrophone.launch(Manifest.permission.RECORD_AUDIO)
            }
            else -> openSettings(context, settingsIntent(context, banner))
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Band(status = status)
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 24.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(TITLE, style = MaterialTheme.typography.titleLarge)
            for (banner in missing) {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(banner.text, style = MaterialTheme.typography.bodyLarge)
                        Button(onClick = { allow(banner) }, modifier = Modifier.testTag("permitir-${banner.name}")) {
                            Text(ALLOW)
                        }
                    }
                }
            }
            if (guide != Guide.GENERIC) {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(guide.title, style = MaterialTheme.typography.bodyLarge)
                        guide.steps.forEachIndexed { index, step ->
                            Text("${index + 1}. $step", style = MaterialTheme.typography.bodyMedium)
                        }
                        OutlinedButton(onClick = { openSettings(context, appDetailsIntent(context)) }) {
                            Text(OPEN_SETTINGS)
                        }
                    }
                }
            }
            Button(onClick = onContinue, modifier = Modifier.fillMaxWidth().testTag("continuar")) {
                Text(CONTINUE)
            }
        }
    }
}

/**
 * A faixa de avisos da tela principal (spec 11.1), embaixo do cabeçalho: um aviso por vez, o primeiro que falta, com o
 * triângulo de atenção amarelo do Windows e "Abrir ajustes" (o link do tema) para o ajuste certo do Android.
 */
@Composable
fun WarningBanner(banner: Banner) {
    val context = LocalContext.current
    val colors = LocalStarsonicColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .background(Starsonic.Warning.copy(alpha = 0.14f))
            .padding(start = 18.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(StarsonicIcons.Warning, contentDescription = null, tint = Starsonic.Warning, modifier = Modifier.size(18.dp))
        Text(banner.text, color = colors.text, style = BannerText, modifier = Modifier.weight(1f).testTag("aviso-faixa"))
        TextButton(onClick = { openSettings(context, settingsIntent(context, banner)) }) {
            Text(OPEN_SETTINGS, color = colors.accentText, style = BannerLink)
        }
    }
}

private const val TITLE = "Permissões"
private const val ALLOW = "Permitir"
private const val CONTINUE = "Continuar"
private const val OPEN_SETTINGS = "Abrir ajustes"

// O texto da faixa e o link dela (o .link do canvas).
private val BannerText = TextStyle(
    fontFamily = PlusJakartaSans,
    fontSize = 13.sp,
    fontWeight = FontWeight.SemiBold,
    lineHeight = 1.35.em,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)
private val BannerLink = BannerText.copy(fontSize = 13.5.sp, fontWeight = FontWeight.Bold)
