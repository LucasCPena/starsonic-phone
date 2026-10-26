package br.com.starsonic.phone.main

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import br.com.starsonic.phone.ui.HeaderMenuButton
import br.com.starsonic.phone.ui.LocalStarsonicColors
import br.com.starsonic.phone.ui.PlusJakartaSans
import br.com.starsonic.phone.ui.Starsonic
import br.com.starsonic.phone.ui.StarsonicIcons

/**
 * O menu do cabeçalho (spec 3.3, o quadro Menu do canvas): o botão (etiqueta menu) e, aberto ([expanded]), o menu com
 * Configurações e Sobre (etiquetas menu-configuracoes e menu-sobre), 8 dp abaixo do botão, junto da borda direita. Um
 * toque no botão abre ([onExpand]); escolher, tocar fora ou o voltar do Android fecham ([onDismiss]). O véu sobre a tela
 * enquanto ele está aberto é o [MenuScrim], da tela principal.
 */
@Composable
fun HeaderMenu(expanded: Boolean, onExpand: () -> Unit, onDismiss: () -> Unit, onSettings: () -> Unit, onAbout: () -> Unit) {
    val colors = LocalStarsonicColors.current
    Box {
        HeaderMenuButton(onClick = onExpand)
        // O .popover do quadro Menu: 230 dp por dentro, 6 dp de folga e o contorno de cada lado (no quadro, ele fica fora
        // da .win, sem o border-box: 244 dp ao todo), cantos de 18; 2 dp mais perto da borda que o botão. O contorno do
        // Surface fica por dentro, sobre o primeiro dp dos 7 de folga.
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = onDismiss,
            offset = DpOffset(2.dp, 8.dp),
            modifier = Modifier.width(244.dp).padding(horizontal = 7.dp),
            shape = RoundedCornerShape(18.dp),
            containerColor = colors.popover,
            tonalElevation = 0.dp,
            shadowElevation = 12.dp,
            border = BorderStroke(1.dp, colors.border),
        ) {
            MenuEntry(SETTINGS, StarsonicIcons.Menu, "menu-configuracoes") {
                onDismiss()
                onSettings()
            }
            MenuEntry(ABOUT, StarsonicIcons.Info, "menu-sobre") {
                onDismiss()
                onAbout()
            }
        }
    }
}

/** O véu escuro sobre a tela enquanto o menu do cabeçalho está aberto ([visible]), como no canvas (o .scrim). */
@Composable
fun MenuScrim(visible: Boolean) {
    val alpha by animateFloatAsState(if (visible) SCRIM_ALPHA else 0f, tween(120), label = "véu do menu")
    if (alpha > 0f) Box(Modifier.fillMaxSize().drawBehind { drawRect(Starsonic.Navy950.copy(alpha = alpha)) })
}

// Uma linha do menu (o .menu-item do canvas): 48 dp, o ícone na cor dos ícones e o texto, com o toque nos cantos de 12.
@Composable
private fun MenuEntry(text: String, icon: ImageVector, tag: String, onClick: () -> Unit) {
    val colors = LocalStarsonicColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .testTag(tag)
            .padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = colors.icon, modifier = Modifier.size(20.dp))
        Text(text, style = EntryLabel, color = colors.textStrong)
    }
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

// .menu-item
private val EntryLabel = TextStyle(
    fontFamily = PlusJakartaSans,
    fontSize = 14.5.sp,
    fontWeight = FontWeight.SemiBold,
    lineHeight = 1.25.em,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

// O véu do .scrim do canvas: rgba(7, 11, 24, 0.32).
private const val SCRIM_ALPHA = 0.32f

private const val SETTINGS = "Configurações"
private const val ABOUT = "Sobre"
private const val SIGN_OUT_TITLE = "Sair da conta?"
private const val SIGN_OUT_TEXT = "Este celular deixa de receber as ligações do ramal. Para entrar de novo, você vai precisar da senha."
private const val SIGN_OUT_CONFIRM = "Sair"
private const val CANCEL = "Cancelar"
