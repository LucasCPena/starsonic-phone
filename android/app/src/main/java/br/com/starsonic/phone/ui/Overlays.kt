package br.com.starsonic.phone.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

// O que abre por cima da tela, no visual do Windows: o menu aberto (o .popover do canvas) e a janela de confirmação (o
// .dialog do Windows), nas cores dos papéis do tema ([LocalStarsonicColors]) e com o toque de pelo menos 48 dp.

/**
 * O menu aberto (o .popover do canvas: o do cabeçalho e o do Tempo para atender), junto do que o abre, [offset] mais
 * para o lado e para baixo: o DropdownMenu do Material com os cantos de 18 dp, o fundo popover, o contorno e a sombra,
 * e 6 dp de folga dos lados (em cima e embaixo, a do Material: 8 dp). As linhas são [PopoverEntry] ou [PopoverOption].
 * Fechar (tocar fora, o voltar do Android) chama [onDismiss]. O Material mede as linhas pelo maior texto: com a letra
 * grande, o menu cresce com ele, e uma lista que não cabe na tela rola.
 */
@Composable
fun Popover(
    expanded: Boolean,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    offset: DpOffset = DpOffset(0.dp, 0.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalStarsonicColors.current
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        offset = offset,
        // O contorno do Surface fica por dentro, sobre o primeiro dp dos 7 de folga.
        modifier = modifier.padding(horizontal = 7.dp),
        shape = RoundedCornerShape(18.dp),
        containerColor = colors.popover,
        tonalElevation = 0.dp,
        shadowElevation = 12.dp,
        border = BorderStroke(1.dp, colors.border),
        content = content,
    )
}

/**
 * Uma linha do menu aberto (o .menu-item do canvas: Configurações e Sobre): 48 dp, o [icon] na cor dos ícones e o
 * [text], com o toque nos cantos de 12 dp; um botão para o leitor de tela.
 */
@Composable
fun PopoverEntry(text: String, icon: ImageVector, tag: String, onClick: () -> Unit) {
    val colors = LocalStarsonicColors.current
    PopoverRow(tag, Modifier.clickable(role = Role.Button, onClick = onClick)) {
        Icon(icon, contentDescription = null, tint = colors.icon, modifier = Modifier.size(20.dp))
        Text(text, style = PopoverLabel, color = colors.textStrong)
    }
}

/**
 * Uma opção de um menu de escolha (as do Tempo para atender): a linha do menu com o [text] e, na escolhida
 * ([selected]), o sinal de feito no fim; para o leitor de tela, uma das opções, escolhida ou não.
 */
@Composable
fun PopoverOption(text: String, selected: Boolean, tag: String, onClick: () -> Unit) {
    val colors = LocalStarsonicColors.current
    PopoverRow(tag, Modifier.selectable(selected = selected, role = Role.RadioButton, onClick = onClick)) {
        Text(text, style = PopoverLabel, color = colors.textStrong, modifier = Modifier.weight(1f))
        // A vaga do sinal fica em todas as opções: o texto não muda de lugar.
        Box(Modifier.size(16.dp)) {
            if (selected) Icon(StarsonicIcons.Check, contentDescription = null, tint = colors.icon, modifier = Modifier.size(16.dp))
        }
    }
}

// A linha do menu (o .menu-item): 48 dp, o toque (o clickable ou o selectable em [modifier]) nos cantos de 12 dp, 12 dp
// dos lados e entre as partes.
@Composable
private fun PopoverRow(tag: String, modifier: Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(12.dp))
            .then(modifier)
            .testTag(tag)
            .padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/**
 * A janela de confirmação por cima da tela (o .dialog do Windows: a do Sair da conta e os avisos de atualização): o
 * cartão de cantos de 22 dp no fundo da tela, com o contorno, de 340 dp de largura (numa tela estreita, a largura dela
 * menos 24 dp de cada lado). Dentro, o [title] (opcional: 18, em negrito, um título para o leitor de tela), os textos do
 * [content] ([DialogText], [DialogNotes]; rolam se não cabem) e os [buttons] (os compactos, [ButtonSize.Compact]), à
 * direita, 10 dp entre eles, um embaixo do outro quando não cabem lado a lado. O texto vem na cor apagada embaixo de um
 * título, como no Windows; sem título, ele é a mensagem, na cor do texto. Fechar (o voltar do Android, tocar fora) chama
 * [onDismiss]. O véu escuro atrás é o do Android.
 */
@Composable
fun StarsonicDialog(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    buttons: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalStarsonicColors.current
    val screen = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp() }
    // Sem a largura do Android: a janela tem o tamanho do cartão, e um toque fora dele fecha.
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            modifier
                .width(minOf(DIALOG_WIDTH, screen - 48.dp))
                .clip(DialogShape)
                .background(colors.surface)
                .border(1.dp, colors.border, DialogShape)
                .padding(start = 23.dp, top = 23.dp, end = 23.dp, bottom = 19.dp),
        ) {
            if (title != null) {
                Text(
                    title,
                    style = DialogTitle,
                    color = colors.textStrong,
                    modifier = Modifier.padding(bottom = 8.dp).semantics { heading() },
                )
            }
            CompositionLocalProvider(LocalContentColor provides if (title != null) colors.textMuted else colors.text) {
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), content = content)
            }
            if (buttons != null) {
                FlowRow(
                    Modifier.fillMaxWidth().padding(top = 18.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    buttons()
                }
            }
        }
    }
}

/** Um texto de uma [StarsonicDialog] (o .dialog p do Windows): 14, na cor da janela (a apagada embaixo do título). */
@Composable
fun DialogText(text: String, modifier: Modifier = Modifier) {
    Text(text, style = DialogParagraph, color = LocalContentColor.current, modifier = modifier)
}

/**
 * As notas de uma versão nova numa [StarsonicDialog] (o .dialog-notes do Windows): 13, apagadas, 10 dp abaixo do texto,
 * com as quebras de linha delas e até 160 dp de altura (o resto rola).
 */
@Composable
fun DialogNotes(text: String, modifier: Modifier = Modifier) {
    val colors = LocalStarsonicColors.current
    Text(
        text,
        style = DialogNotesText,
        color = colors.textMuted,
        modifier = modifier
            .padding(top = 10.dp)
            .heightIn(max = 160.dp)
            .verticalScroll(rememberScrollState()),
    )
}

// A largura do .dialog do Windows (max-width: 340px) e os cantos dele.
private val DIALOG_WIDTH = 340.dp
private val DialogShape = RoundedCornerShape(22.dp)

private val Base = TextStyle(
    fontFamily = PlusJakartaSans,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

// .menu-item
private val PopoverLabel = Base.copy(fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, lineHeight = 1.25.em)

// .dialog h2, .dialog p e .dialog-notes
private val DialogTitle = Base.copy(fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.02).em, lineHeight = 1.2.em)
private val DialogParagraph = Base.copy(fontSize = 14.sp, lineHeight = 1.5.em)
private val DialogNotesText = Base.copy(fontSize = 13.sp, lineHeight = 1.5.em)
