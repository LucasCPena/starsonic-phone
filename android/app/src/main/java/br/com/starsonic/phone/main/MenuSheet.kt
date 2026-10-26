package br.com.starsonic.phone.main

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import br.com.starsonic.phone.ui.HeaderMenuButton
import br.com.starsonic.phone.ui.Popover
import br.com.starsonic.phone.ui.PopoverEntry
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
    Box {
        HeaderMenuButton(onClick = onExpand)
        // O .popover do quadro Menu: 230 dp por dentro, 6 dp de folga e o contorno de cada lado (no quadro, ele fica fora
        // da .win, sem o border-box: 244 dp ao todo); 2 dp mais perto da borda que o botão. Com a letra grande, o menu
        // cresce com o texto, e nada quebra no meio da palavra.
        Popover(
            expanded = expanded,
            onDismiss = onDismiss,
            modifier = Modifier.widthIn(min = 244.dp),
            offset = DpOffset(2.dp, 8.dp),
        ) {
            PopoverEntry(SETTINGS, StarsonicIcons.Menu, "menu-configuracoes") {
                onDismiss()
                onSettings()
            }
            PopoverEntry(ABOUT, StarsonicIcons.Info, "menu-sobre") {
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

// O véu do .scrim do canvas: rgba(7, 11, 24, 0.32).
private const val SCRIM_ALPHA = 0.32f

private const val SETTINGS = "Configurações"
private const val ABOUT = "Sobre"
