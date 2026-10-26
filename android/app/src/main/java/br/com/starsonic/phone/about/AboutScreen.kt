package br.com.starsonic.phone.about

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import br.com.starsonic.phone.R
import br.com.starsonic.phone.ui.DarkBar
import br.com.starsonic.phone.ui.IconTile
import br.com.starsonic.phone.ui.LocalStarsonicColors
import br.com.starsonic.phone.ui.OutlineButton
import br.com.starsonic.phone.ui.PlusJakartaSans
import br.com.starsonic.phone.ui.SettingRow
import br.com.starsonic.phone.ui.SettingsCard
import br.com.starsonic.phone.ui.StarsonicIcons
import br.com.starsonic.phone.ui.isDark

/**
 * A tela Sobre (spec 3.4, 4.1 e 10, os quadros Sobre e SobreEscuro do canvas): a barra escura com o Voltar ([onBack],
 * como o voltar do Android); o logo (o principal no tema claro, o negativo no escuro); "Starsonic Phone <versão>", a
 * licença GPL v3 e os créditos do PJSIP e do Opus; o cartão com o site, o telefone de suporte (com o WhatsApp ao lado)
 * e o código-fonte; e "Enviar diagnóstico" ([onSendDiagnostics]), no fim da tela. Os links abrem no navegador (o
 * WhatsApp pelo wa.me, que abre o app dele se houver), e o telefone abre o discador do celular com o número, sem ligar.
 */
@Composable
fun AboutScreen(version: String, onBack: () -> Unit, onSendDiagnostics: () -> Unit) {
    val context = LocalContext.current
    val colors = LocalStarsonicColors.current
    Column(Modifier.fillMaxSize().background(colors.surface)) {
        DarkBar(TITLE, onBack = onBack)
        BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)) {
            // A coluna tem pelo menos a altura da tela: o Enviar diagnóstico fica no fim dela (o margin-top: auto do
            // canvas); sem espaço, a tela rola.
            val screen = maxHeight
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .heightIn(min = screen)
                    .navigationBarsPadding()
                    .padding(start = 24.dp, top = 40.dp, end = 24.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    // O logo do tema: o principal no claro, o negativo no escuro (etiquetas logo-principal e logo-negativo).
                    val (logo, logoTag) =
                        if (colors.isDark) R.drawable.logo_negativo to "logo-negativo" else R.drawable.logo_principal to "logo-principal"
                    Image(painterResource(logo), contentDescription = LOGO, modifier = Modifier.width(230.dp).testTag(logoTag))
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("$APP_NAME $version", style = VersionText, color = colors.textStrong, textAlign = TextAlign.Center)
                        Text(LICENSE, style = LicenseText, color = colors.textMuted, textAlign = TextAlign.Center)
                        Text(CREDITS, style = LicenseText, color = colors.textMuted, textAlign = TextAlign.Center)
                    }
                    SettingsCard {
                        Link(StarsonicIcons.Globe, SITE_TEXT, SITE_LABEL, "site") {
                            open(context, Intent(Intent.ACTION_VIEW, Uri.parse(SITE)))
                        }
                        Link(
                            StarsonicIcons.Phone,
                            PHONE_TEXT,
                            SUPPORT_LABEL,
                            "suporte",
                            trailing = {
                                // O WhatsApp do mesmo número, como no Windows: o link ao lado do telefone.
                                Text(
                                    WHATSAPP_LABEL,
                                    style = LinkText,
                                    color = colors.accentText,
                                    modifier = Modifier
                                        .clickable(role = Role.Button) { open(context, Intent(Intent.ACTION_VIEW, Uri.parse(WHATSAPP))) }
                                        .testTag("whatsapp")
                                        .padding(vertical = 4.dp),
                                )
                            },
                        ) {
                            open(context, Intent(Intent.ACTION_DIAL, Uri.parse(SUPPORT_NUMBER)))
                        }
                        Link(StarsonicIcons.Code, SOURCE_LABEL, SOURCE_TEXT, "codigo-fonte", last = true) {
                            open(context, Intent(Intent.ACTION_VIEW, Uri.parse(SOURCE)))
                        }
                    }
                }
                OutlineButton(
                    SEND_DIAGNOSTICS,
                    tag = "enviar-diagnostico",
                    icon = StarsonicIcons.Share,
                    modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
                    onClick = onSendDiagnostics,
                )
            }
        }
    }
}

// Uma linha do cartão que abre algo fora do app (o .set-row do quadro, com o .tile de 36 dp): o ícone, o [title] e o
// [sub] embaixo (o .row-title de 14 e o .row-sub), e o [trailing] ao lado; a linha toda é o botão ([onClick]).
@Composable
private fun Link(
    icon: ImageVector,
    title: String,
    sub: String,
    tag: String,
    last: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
    onClick: () -> Unit,
) {
    val colors = LocalStarsonicColors.current
    SettingRow(
        tag = tag,
        last = last,
        onClick = onClick,
        leading = { IconTile(icon, size = 36.dp, corner = 11.dp, iconSize = 16.dp) },
        trailing = trailing,
    ) {
        Text(title, style = RowTitle, color = colors.textStrong)
        Text(sub, style = RowSub, color = colors.textMuted)
    }
}

// Abre o link ou o discador; sem um app que abra (alguns tablets não têm discador), nada acontece.
private fun open(context: Context, intent: Intent) {
    try {
        context.startActivity(intent)
    } catch (e: ActivityNotFoundException) {
        // Nada a fazer.
    }
}

/** O texto do botão (e o título da janela de compartilhar do Android). */
const val SEND_DIAGNOSTICS = "Enviar diagnóstico"

private val Base = TextStyle(
    fontFamily = PlusJakartaSans,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

// A versão (20, 800, -0.02em) e a licença (.muted de 13,5, altura 1,5), do quadro.
private val VersionText = Base.copy(fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.02).em, lineHeight = 1.25.em)
private val LicenseText = Base.copy(fontSize = 13.5.sp, lineHeight = 1.5.em)

// O .row-title de 14 e o .row-sub do quadro, e o .link de 13.
private val RowTitle = Base.copy(fontSize = 14.sp, fontWeight = FontWeight.Bold, lineHeight = 1.25.em)
private val RowSub = Base.copy(fontSize = 12.5.sp, lineHeight = 1.35.em)
private val LinkText = Base.copy(fontSize = 13.sp, fontWeight = FontWeight.Bold, lineHeight = 1.3.em)

private const val TITLE = "Sobre"
private const val LOGO = "Starsonic"
private const val APP_NAME = "Starsonic Phone"
private const val LICENSE = "Licença GPL v3"
private const val CREDITS = "Usa o PJSIP (GPL v2 ou posterior) e o Opus (BSD)."
private const val SITE_LABEL = "Site"
private const val SITE_TEXT = "starsonic.com.br"
private const val SITE = "https://starsonic.com.br/"
private const val WHATSAPP_LABEL = "WhatsApp"
private const val WHATSAPP = "https://wa.me/551150603000"
private const val SUPPORT_LABEL = "Telefone de suporte"
private const val SUPPORT_NUMBER = "tel:+551150603000"
private const val PHONE_TEXT = "(11) 5060-3000"
private const val SOURCE_LABEL = "Código-fonte"
private const val SOURCE_TEXT = "github.com/LucasCPena/starsonic-phone"
private const val SOURCE = "https://github.com/LucasCPena/starsonic-phone"
