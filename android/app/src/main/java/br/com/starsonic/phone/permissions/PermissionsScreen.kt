package br.com.starsonic.phone.permissions

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import br.com.starsonic.phone.ui.BesideOrUnder
import br.com.starsonic.phone.ui.BlueButton
import br.com.starsonic.phone.ui.ButtonSize
import br.com.starsonic.phone.ui.CyanButton
import br.com.starsonic.phone.ui.DarkBar
import br.com.starsonic.phone.ui.Eyebrow
import br.com.starsonic.phone.ui.IconTile
import br.com.starsonic.phone.ui.LocalStarsonicColors
import br.com.starsonic.phone.ui.OutlineButton
import br.com.starsonic.phone.ui.PlusJakartaSans
import br.com.starsonic.phone.ui.SettingRow
import br.com.starsonic.phone.ui.SettingsCard
import br.com.starsonic.phone.ui.Starsonic
import br.com.starsonic.phone.ui.StarsonicIcons

/**
 * A tela Permissões (spec 3.4, 4.1 e 7.1 item 4, os quadros Permissoes e PermissoesEscuro do canvas): a barra escura com
 * o Voltar e, em "Para as ligações chegarem", os quatro avisos, cada um explicado pelo texto dele na faixa: o que falta
 * com "Permitir", que abre a janela do próprio Android (o pedido das notificações e do microfone, que, a partir do
 * segundo toque, o Android pode não mostrar mais: aí, a página do app; o ajuste da tela cheia; o pedido para sair da
 * otimização de bateria), e o que já está dado com o sinal de feito. Em Xiaomi e Samsung, o cartão com o passo a passo
 * dos ajustes do fabricante e "Abrir ajustes" (a página do app). No fim, "Continuar".
 *
 * Ela abre depois de um Entrar que começou sem conta gravada ([continuesAlone]: sem nada que falte nem passo a passo,
 * ela segue sozinha) e por Configurações → Permissões e bateria (fica até a pessoa sair). O Voltar, o voltar do Android
 * (na activity) e o Continuar levam a [onContinue]. [resumes] muda a cada volta ao app (ON_RESUME): a tela confere de
 * novo o que falta.
 */
@Composable
fun PermissionsScreen(resumes: Int, guide: Guide, continuesAlone: Boolean, onContinue: () -> Unit) {
    val context = LocalContext.current
    val colors = LocalStarsonicColors.current
    val grants = remember(resumes) { Grants.read(context) }
    val missing = grants.missing
    var askedNotifications by rememberSaveable { mutableStateOf(false) }
    var askedMicrophone by rememberSaveable { mutableStateOf(false) }
    // O resultado chega antes da volta ao app (ON_RESUME), que confere tudo de novo.
    val requestNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val requestMicrophone = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}

    LaunchedEffect(missing, guide, continuesAlone) {
        if (continuesAlone && missing.isEmpty() && guide == Guide.GENERIC) onContinue()
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

    Column(Modifier.fillMaxSize().background(colors.surface)) {
        DarkBar(TITLE, onBack = onContinue)
        BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)) {
            // A coluna tem pelo menos a altura da tela: o Continuar fica no fim dela (o margin-top: auto do canvas); sem
            // espaço, a tela rola.
            val screen = maxHeight
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .heightIn(min = screen)
                    .navigationBarsPadding()
                    .padding(start = 20.dp, top = 18.dp, end = 20.dp, bottom = 14.dp),
                verticalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Eyebrow(SECTION)
                    SettingsCard {
                        Banner.entries.forEachIndexed { index, banner ->
                            PermissionRow(banner, allowed = banner !in missing, last = index == Banner.entries.lastIndex) {
                                allow(banner)
                            }
                        }
                    }
                    if (guide != Guide.GENERIC) GuideCard(guide) { openSettings(context, appDetailsIntent(context)) }
                }
                CyanButton(
                    CONTINUE,
                    tag = "continuar",
                    size = ButtonSize.Large,
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    onClick = onContinue,
                )
            }
        }
    }
}

// Um aviso (o .set-row do quadro, etiqueta permissao-<aviso>): o quadrado do ícone, o texto dele e, no fim, o Permitir
// azul compacto (permitir-<aviso>) ou, já dado ([allowed]), o sinal de feito verde (permitida-<aviso>), que o leitor de
// tela lê "Permitida" (o nome do quadro, R29): sem ele, o aviso dado soaria como o pedido.
@Composable
private fun PermissionRow(banner: Banner, allowed: Boolean, last: Boolean, onAllow: () -> Unit) {
    val colors = LocalStarsonicColors.current
    SettingRow(
        tag = "permissao-${banner.name}",
        last = last,
        leading = { IconTile(bannerIcon(banner)) },
        trailing = {
            if (allowed) {
                Icon(
                    StarsonicIcons.Check,
                    contentDescription = GRANTED,
                    tint = Starsonic.StatusOnline,
                    modifier = Modifier.size(20.dp).testTag("permitida-${banner.name}"),
                )
            } else {
                BlueButton(ALLOW, tag = "permitir-${banner.name}", size = ButtonSize.Compact, onClick = onAllow)
            }
        },
    ) {
        Text(banner.text, style = BannerItemText, color = colors.text)
    }
}

// O cartão do fabricante (o segundo .card do quadro): o título, os passos numerados e o Abrir ajustes ([onOpen]).
@Composable
private fun GuideCard(guide: Guide, onOpen: () -> Unit) {
    val colors = LocalStarsonicColors.current
    SettingsCard(verticalPadding = 14.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(guide.title, style = GuideTitle, color = colors.textStrong)
            // A lista numerada (o ol do quadro: os números na margem de 20 dp, encostados no texto). Com a letra grande,
            // a margem cresce com o número, que nunca quebra nem corta (R30).
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                guide.steps.forEachIndexed { index, step ->
                    Row(Modifier.semantics(mergeDescendants = true) {}) {
                        Text(
                            "${index + 1}.",
                            style = GuideStep,
                            color = colors.textMuted,
                            textAlign = TextAlign.End,
                            modifier = Modifier.widthIn(min = 20.dp).padding(end = 4.dp),
                        )
                        Text(step, style = GuideStep, color = colors.textMuted, modifier = Modifier.weight(1f))
                    }
                }
            }
            OutlineButton(OPEN_SETTINGS, tag = "abrir-ajustes", size = ButtonSize.Small, onClick = onOpen)
        }
    }
}

// O ícone de cada aviso: o sino, o microfone, o celular e a bateria.
private fun bannerIcon(banner: Banner): ImageVector = when (banner) {
    Banner.NOTIFICATIONS -> StarsonicIcons.Bell
    Banner.MICROPHONE -> StarsonicIcons.Microphone
    Banner.FULL_SCREEN -> StarsonicIcons.FullScreen
    Banner.BATTERY -> StarsonicIcons.Battery
}

/**
 * A faixa de avisos da tela principal (spec 11.1), embaixo do cabeçalho (etiqueta `faixa-aviso`; o texto, `aviso-faixa`):
 * um aviso por vez, o primeiro que falta, com o triângulo de atenção amarelo do Windows e "Abrir ajustes" (o link do tema)
 * para o ajuste certo do Android. O link fica ao lado do texto se cada palavra dele cabe ali; com a letra grande, ele
 * desce para baixo do texto, alinhado com ele, e nenhuma palavra quebra no meio (F3, F4).
 */
@Composable
fun WarningBanner(banner: Banner) {
    val context = LocalContext.current
    val colors = LocalStarsonicColors.current
    val layoutDirection = LocalLayoutDirection.current
    BesideOrUnder(
        spacing = 10.dp,
        underGap = 0.dp,
        // O texto do link (dentro do respiro do TextButton) alinhado com o do aviso quando desce.
        underShift = -ButtonDefaults.TextButtonContentPadding.calculateStartPadding(layoutDirection),
        modifier = Modifier
            .fillMaxWidth()
            .background(Starsonic.Warning.copy(alpha = 0.14f))
            .testTag("faixa-aviso")
            .padding(start = 18.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        leading = {
            Icon(StarsonicIcons.Warning, contentDescription = null, tint = Starsonic.Warning, modifier = Modifier.size(18.dp))
        },
        trailing = {
            TextButton(onClick = { openSettings(context, settingsIntent(context, banner)) }) {
                Text(OPEN_SETTINGS, color = colors.accentText, style = BannerLink)
            }
        },
    ) {
        Text(banner.text, color = colors.text, style = BannerText, modifier = Modifier.testTag("aviso-faixa"))
    }
}

private const val TITLE = "Permissões"
private const val SECTION = "Para as ligações chegarem"
private const val ALLOW = "Permitir"
private const val GRANTED = "Permitida"
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

// O texto de um aviso nas Permissões (o .set-help na cor do texto), o título do cartão do fabricante (o .set-title) e
// os passos dele (13,5, altura 1,45).
private val BannerItemText = BannerText.copy(fontSize = 12.5.sp, fontWeight = FontWeight.Normal, lineHeight = 1.4.em)
private val GuideTitle = BannerText.copy(fontSize = 14.5.sp, fontWeight = FontWeight.Bold, lineHeight = 1.3.em)
private val GuideStep = BannerText.copy(fontSize = 13.5.sp, fontWeight = FontWeight.Normal, lineHeight = 1.45.em)
