package br.com.starsonic.phone.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp

// Com a letra grande do celular (spec 3.3: "as telas rolando onde não cabem"), nenhuma palavra quebra no meio por causa de
// um controle ao lado dela (F4): o que fica lado a lado na letra padrão (os quadros do canvas) desce para baixo quando uma
// palavra não cabe inteira ali. "Cabe" é o minIntrinsicWidth do Compose: a largura da maior palavra (de um texto), ou a
// menor largura de um botão sem quebrar o nome dele no meio.

/**
 * Os botões de [content] lado a lado, com a mesma largura e [spacing] entre eles (o weight(1f) de cada um numa Row), se o
 * nome de cada um cabe na parte dele sem quebrar no meio de uma palavra; senão (a letra grande, uma tela estreita), um
 * embaixo do outro, na ordem, cada um com a largura toda e [spacing] entre eles. Precisa de uma largura definida (a do pai).
 */
@Composable
fun SideBySideOrStacked(spacing: Dp, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Layout(content, modifier) { measurables, constraints ->
        val gap = spacing.roundToPx()
        val width = constraints.maxWidth
        val gaps = gap * (measurables.size - 1).coerceAtLeast(0)
        val share = ((width - gaps) / measurables.size.coerceAtLeast(1)).coerceAtLeast(0)
        val sideBySide = measurables.all { it.minIntrinsicWidth(Constraints.Infinity) <= share }
        val each = if (sideBySide) share else width
        val placeables = measurables.map { it.measure(Constraints(minWidth = each, maxWidth = each)) }
        val height = if (sideBySide) placeables.maxOfOrNull { it.height } ?: 0 else placeables.sumOf { it.height } + gaps
        val shown = height.coerceIn(constraints.minHeight, constraints.maxHeight)
        layout(width, shown) {
            var x = 0
            var y = 0
            for (placeable in placeables) {
                if (sideBySide) {
                    placeable.placeRelative(x, (shown - placeable.height) / 2)
                    x += placeable.width + gap
                } else {
                    placeable.placeRelative(0, y)
                    y += placeable.height + gap
                }
            }
        }
    }
}
