package br.com.starsonic.phone.update

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/**
 * O aviso de atualização sobre a tela principal (como a confirmação do Sair, spec 7.6): a versão nova (a pergunta, as
 * notas embaixo, Atualizar e Agora não), o download ("Baixando atualização…") e os avisos com OK (a ligação em
 * andamento, o download que falhou). Fechar o aviso (voltar, ou tocar fora) vale como Agora não ou OK; um download
 * continua.
 */
@Composable
fun UpdateDialog(ui: UpdateUi, onUpdate: () -> Unit, onDismiss: () -> Unit) {
    when (ui) {
        is UpdateUi.Offer -> AlertDialog(
            onDismissRequest = onDismiss,
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text(UpdateDecider.question(ui.manifest.versionText))
                    if (ui.manifest.notes.isNotBlank()) {
                        Text(ui.manifest.notes, Modifier.padding(top = 12.dp))
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = onUpdate, modifier = Modifier.testTag("atualizar")) { Text(UPDATE) }
            },
            dismissButton = {
                TextButton(onClick = onDismiss, modifier = Modifier.testTag("agora-nao")) { Text(NOT_NOW) }
            },
        )
        UpdateUi.Downloading -> AlertDialog(
            onDismissRequest = onDismiss,
            text = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(24.dp))
                    Text(DOWNLOADING, Modifier.padding(start = 16.dp))
                }
            },
            confirmButton = {},
        )
        is UpdateUi.Notice -> AlertDialog(
            onDismissRequest = onDismiss,
            text = { Text(ui.text) },
            confirmButton = {
                TextButton(onClick = onDismiss, modifier = Modifier.testTag("atualizacao-ok")) { Text(OK) }
            },
        )
    }
}

private const val UPDATE = "Atualizar"
private const val NOT_NOW = "Agora não"
private const val DOWNLOADING = "Baixando atualização…"
private const val OK = "OK"
