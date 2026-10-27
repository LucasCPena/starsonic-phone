package br.com.starsonic.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.ScrollableState
import androidx.compose.foundation.gestures.scrollable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import kotlin.math.roundToInt

/**
 * O cabeçalho que sobe com a aba quando toma a tela (spec 3.3: "as telas rolando onde não cabem"; F3). Com a letra maior
 * que a padrão, se o [header] (na tela principal: o cabeçalho da marca, a faixa de avisos e a da ligação em andamento)
 * passa da metade da altura daqui, ele sobe quando a pessoa rola a aba para o fim, antes de a aba rolar, e desce de volta
 * quando ela volta ao começo, depois da aba; arrastar nele mesmo, ou numa aba que não rola, também o move. Subindo, ele
 * vai até sair, e uma faixa no navy-950 fica atrás da barra de status (os ícones dela são claros). O [content] (a aba)
 * fica com a altura que sobra embaixo do que o cabeçalho ainda mostra: a navegação de baixo, fora daqui, nunca sai da tela.
 * Na letra padrão (os quadros do canvas), ou com espaço, o cabeçalho fica parado, como sempre, e a aba fica com o resto.
 * O [header] e o [content] são um elemento cada.
 */
@Composable
fun ScrollAwayHeader(modifier: Modifier = Modifier, header: @Composable () -> Unit, content: @Composable () -> Unit) {
    val away = remember { HeaderAway() }
    val statusBars = WindowInsets.statusBars
    Layout(
        contents = listOf(header, content, { Box(Modifier.background(Starsonic.Navy950)) }),
        modifier = modifier
            .clipToBounds()
            .nestedScroll(away)
            .scrollable(away.state, Orientation.Vertical, enabled = away.movable),
    ) { (headers, contents, bars), constraints ->
        val width = constraints.maxWidth
        val height = constraints.maxHeight
        val top = headers.single().measure(Constraints(minWidth = width, maxWidth = width))
        val bar = statusBars.getTop(this)
        val movable = fontScale > 1f && top.height * 2 > height
        away.movable = movable
        away.range = if (movable) (top.height - bar).coerceAtLeast(0).toFloat() else 0f
        val offset = away.offset.coerceIn(0f, away.range).roundToInt()
        val tabTop = top.height - offset
        val tab = contents.single().measure(Constraints.fixed(width, (height - tabTop).coerceAtLeast(0)))
        val strip = bars.single().measure(Constraints.fixed(width, bar))
        layout(width, height) {
            top.placeRelative(0, -offset)
            tab.placeRelative(0, tabTop)
            if (offset > 0) strip.placeRelative(0, 0)
        }
    }
}

// Quanto o cabeçalho subiu ([offset], de 0 ao [range]: a altura dele sem a da barra de status, ou 0 parado). O dedo que
// sobe numa aba que rola sobe o cabeçalho antes dela ([onPreScroll]); o que sobra da aba no começo e o arrasto fora dela o
// movem pelo [state], o scrollable do lugar todo ([movable]: só quando ele toma a tela). Só na thread principal.
private class HeaderAway : NestedScrollConnection {
    var offset by mutableFloatStateOf(0f)
    var range = 0f
    var movable by mutableStateOf(false)

    // [delta] > 0: o dedo desce, e o cabeçalho volta; < 0: o dedo sobe, e ele sai. Devolve o que usou.
    val state = ScrollableState { delta ->
        val before = offset.coerceIn(0f, range)
        val after = (before - delta).coerceIn(0f, range)
        offset = after
        before - after
    }

    override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset =
        if (available.y < 0f) Offset(0f, state.dispatchRawDelta(available.y)) else Offset.Zero
}
