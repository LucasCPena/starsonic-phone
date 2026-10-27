package br.com.starsonic.phone.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// Com a letra grande do celular (spec 3.3: "as telas rolando onde não cabem"), nenhuma palavra quebra no meio por causa de
// um controle ao lado dela (F4): o que fica lado a lado na letra padrão (os quadros do canvas) desce para baixo quando uma
// palavra não cabe inteira ali. "Cabe" é o minIntrinsicWidth do Compose: a largura da maior palavra (de um texto), ou a
// menor largura de um botão sem quebrar o nome dele no meio.

/**
 * Uma linha com o [leading] (opcional: um ícone, a bolinha), os textos ([content], um elemento só) e um controle no fim
 * ([trailing], opcional: uma chave, um botão, um link), [spacing] entre eles e cada um centrado na altura, como uma Row com
 * o [content] no weight(1f). O [trailing] fica à direita, ao lado dos textos, só se cada palavra deles cabe ao lado dele;
 * senão (a letra grande, uma tela estreita), ele desce para baixo dos textos, [underGap] abaixo deles e no começo deles
 * ([underShift] a mais: o respiro de dentro do controle, para o texto dele alinhar com o dos textos), e os textos ficam com a
 * largura toda depois do [leading]. Na letra padrão (os quadros do canvas), tudo cabe ao lado, como numa Row.
 */
@Composable
fun BesideOrUnder(
    spacing: Dp,
    underGap: Dp,
    modifier: Modifier = Modifier,
    underShift: Dp = 0.dp,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Layout(contents = listOf(leading ?: {}, content, trailing ?: {}), modifier = modifier) { (starts, texts, ends), constraints ->
        val gap = spacing.roundToPx()
        val width = constraints.maxWidth
        val loose = Constraints(maxWidth = width, maxHeight = constraints.maxHeight)
        val start = starts.firstOrNull()?.measure(loose)
        val textStart = if (start != null) start.width + gap else 0
        val textMax = (width - textStart).coerceAtLeast(0)
        val end = ends.firstOrNull()?.measure(loose.copy(maxWidth = textMax))
        val beside = if (end != null) (textMax - gap - end.width).coerceAtLeast(0) else textMax
        val besideIt = end == null || texts.all { it.minIntrinsicWidth(Constraints.Infinity) <= beside }
        val textWidth = if (besideIt) beside else textMax
        val text = texts.single().measure(Constraints(minWidth = textWidth, maxWidth = textWidth, maxHeight = constraints.maxHeight))
        val under = if (end != null && !besideIt) underGap.roundToPx() + end.height else 0
        val block = text.height + under
        val height = maxOf(start?.height ?: 0, block, if (besideIt) end?.height ?: 0 else 0)
            .coerceIn(constraints.minHeight, constraints.maxHeight)
        layout(width, height) {
            start?.placeRelative(0, middle(start.height, height))
            val top = middle(block, height)
            text.placeRelative(textStart, top)
            if (end != null) {
                if (besideIt) {
                    end.placeRelative(width - end.width, middle(end.height, height))
                } else {
                    end.placeRelative((textStart + underShift.roundToPx()).coerceAtLeast(0), top + text.height + underGap.roundToPx())
                }
            }
        }
    }
}

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
                    placeable.placeRelative(x, middle(placeable.height, shown))
                    x += placeable.width + gap
                } else {
                    placeable.placeRelative(0, y)
                    y += placeable.height + gap
                }
            }
        }
    }
}

// O lugar de cima de algo de altura [size] centrado em [space], arredondado como o CenterVertically de uma Row: na letra
// padrão, as linhas ficam no mesmo pixel de antes (a divisão inteira punha uma parte 1 px acima quando a sobra era ímpar).
private fun middle(size: Int, space: Int): Int = Alignment.CenterVertically.align(size, space)
