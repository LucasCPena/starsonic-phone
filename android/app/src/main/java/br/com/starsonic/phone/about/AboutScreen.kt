package br.com.starsonic.phone.about

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import br.com.starsonic.phone.main.Band

/**
 * A tela Sobre (spec 4.1 e 10): "Starsonic Phone <versão>"; o site, o WhatsApp e o telefone de suporte; a licença
 * GPL v3 com o link do código-fonte; os créditos do PJSIP e do Opus; e "Enviar diagnóstico" ([onSendDiagnostics]).
 * Os links abrem no navegador (o WhatsApp pelo wa.me, que abre o app dele se houver), e o telefone abre o discador
 * do celular com o número, sem ligar. A faixa continua mostrando o status ([status]); o voltar do Android sai.
 */
@Composable
fun AboutScreen(status: String, version: String, onSendDiagnostics: () -> Unit) {
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Band(status = status)
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 24.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("$APP_NAME $version", style = MaterialTheme.typography.titleLarge)
            Link(SITE_LABEL, SITE_TEXT, "site") { open(context, Intent(Intent.ACTION_VIEW, Uri.parse(SITE))) }
            Link(WHATSAPP_LABEL, PHONE_TEXT, "whatsapp") { open(context, Intent(Intent.ACTION_VIEW, Uri.parse(WHATSAPP))) }
            Link(SUPPORT_LABEL, PHONE_TEXT, "suporte") { open(context, Intent(Intent.ACTION_DIAL, Uri.parse(SUPPORT_NUMBER))) }
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            Text(LICENSE, style = MaterialTheme.typography.titleMedium)
            Link(SOURCE_LABEL, SOURCE_TEXT, "codigo-fonte") { open(context, Intent(Intent.ACTION_VIEW, Uri.parse(SOURCE))) }
            Text(CREDITS, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
            Button(
                onClick = onSendDiagnostics,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 16.dp)
                    .testTag("enviar-diagnostico"),
            ) {
                Text(SEND_DIAGNOSTICS)
            }
        }
    }
}

/** Uma linha que abre algo fora do app: o que é ([label]) e o endereço ou número ([text]). */
@Composable
private fun Link(label: String, text: String, tag: String, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp)
            .testTag(tag),
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary)
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
