package br.com.starsonic.phone.update

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import br.com.starsonic.phone.ui.BlueButton
import br.com.starsonic.phone.ui.ButtonSize
import br.com.starsonic.phone.ui.CyanButton
import br.com.starsonic.phone.ui.DialogNotes
import br.com.starsonic.phone.ui.DialogText
import br.com.starsonic.phone.ui.LocalStarsonicColors
import br.com.starsonic.phone.ui.OutlineButton
import br.com.starsonic.phone.ui.StarsonicDialog

/**
 * O aviso de atualização sobre a tela principal (spec 7.6), na janela do Windows ([StarsonicDialog]), como a
 * confirmação do Sair: a versão nova (a pergunta, as notas embaixo, Agora não e Atualizar, o ciano), o download
 * ("Baixando atualização…") e os avisos com OK (a ligação em andamento, o download que falhou). Fechar o aviso (voltar,
 * ou tocar fora) vale como Agora não ou OK; um download continua.
 */
@Composable
fun UpdateDialog(ui: UpdateUi, onUpdate: () -> Unit, onDismiss: () -> Unit) {
    when (ui) {
        is UpdateUi.Offer -> StarsonicDialog(
            onDismiss = onDismiss,
            buttons = {
                OutlineButton(NOT_NOW, tag = "agora-nao", size = ButtonSize.Compact, onClick = onDismiss)
                CyanButton(UPDATE, tag = "atualizar", size = ButtonSize.Compact, onClick = onUpdate)
            },
        ) {
            DialogText(UpdateDecider.question(ui.manifest.versionText))
            if (ui.manifest.notes.isNotBlank()) DialogNotes(ui.manifest.notes)
        }
        UpdateUi.Downloading -> StarsonicDialog(onDismiss = onDismiss) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(24.dp), color = LocalStarsonicColors.current.icon, strokeWidth = 3.dp)
                DialogText(DOWNLOADING)
            }
        }
        is UpdateUi.Notice -> StarsonicDialog(
            onDismiss = onDismiss,
            buttons = { BlueButton(OK, tag = "atualizacao-ok", size = ButtonSize.Compact, onClick = onDismiss) },
        ) {
            DialogText(ui.text)
        }
    }
}

private const val UPDATE = "Atualizar"
private const val NOT_NOW = "Agora não"
private const val DOWNLOADING = "Baixando atualização…"
private const val OK = "OK"
