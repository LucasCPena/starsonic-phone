package br.com.starsonic.phone.main

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import br.com.starsonic.phone.R

/** O menu da faixa (⋮, spec 4.1): Editar conta, Sair da conta e Sobre. Um toque abre; escolher fecha. */
@Composable
fun MenuButton(onEdit: () -> Unit, onSignOut: () -> Unit, onAbout: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, modifier = Modifier.testTag("menu")) {
            Icon(painterResource(R.drawable.ic_menu), contentDescription = MENU, tint = Color.White)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            MenuItem(EDIT) {
                open = false
                onEdit()
            }
            MenuItem(SIGN_OUT) {
                open = false
                onSignOut()
            }
            MenuItem(ABOUT) {
                open = false
                onAbout()
            }
        }
    }
}

@Composable
private fun MenuItem(text: String, onClick: () -> Unit) {
    DropdownMenuItem(text = { Text(text) }, onClick = onClick)
}

/**
 * A confirmação de Sair da conta: a conta e a senha saem do celular, e para entrar de novo a pessoa precisa da
 * senha (que, em muitos casos, quem tem é o administrador do PABX). [onConfirm] sai; [onDismiss] fica.
 */
@Composable
fun SignOutDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(SIGN_OUT_TITLE) },
        text = { Text(SIGN_OUT_TEXT) },
        confirmButton = {
            TextButton(onClick = onConfirm, modifier = Modifier.testTag("sair-confirmar")) { Text(SIGN_OUT_CONFIRM) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(CANCEL) }
        },
    )
}

private const val MENU = "Menu"
private const val EDIT = "Editar conta"
private const val SIGN_OUT = "Sair da conta"
private const val ABOUT = "Sobre"
private const val SIGN_OUT_TITLE = "Sair da conta?"
private const val SIGN_OUT_TEXT = "Este celular deixa de receber as ligações do ramal. Para entrar de novo, você vai precisar da senha."
private const val SIGN_OUT_CONFIRM = "Sair"
private const val CANCEL = "Cancelar"
