package br.com.starsonic.phone.main

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipAnchorPosition
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import br.com.starsonic.phone.contacts.Contact
import br.com.starsonic.phone.contacts.ContactsSource
import br.com.starsonic.phone.contacts.Suggestion
import br.com.starsonic.phone.contacts.initials
import br.com.starsonic.phone.contacts.rememberSuggestions
import br.com.starsonic.phone.data.Recent
import br.com.starsonic.phone.data.RecentsStore
import br.com.starsonic.phone.data.lastDialed
import br.com.starsonic.phone.data.redialLabel
import br.com.starsonic.phone.ui.Avatar
import br.com.starsonic.phone.ui.ButtonSize
import br.com.starsonic.phone.ui.CyanButton
import br.com.starsonic.phone.ui.DISABLED_ALPHA
import br.com.starsonic.phone.ui.DialKey
import br.com.starsonic.phone.ui.ListRowSub
import br.com.starsonic.phone.ui.ListRowTitle
import br.com.starsonic.phone.ui.LocalStarsonicColors
import br.com.starsonic.phone.ui.PlusJakartaSans
import br.com.starsonic.phone.ui.RedialButton
import br.com.starsonic.phone.ui.Starsonic
import br.com.starsonic.phone.ui.StarsonicIcons
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** As teclas do Teclado e do teclado da ligação (DTMF), em linhas. */
internal val KEYS = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("*", "0", "#"))

/**
 * O Teclado (spec 3.2 e 4.1, o quadro Main do canvas): o número digitado, com o Apagar e a linha embaixo; as sugestões
 * dos contatos; as 12 teclas; e, na última linha, o Rediscar e o Ligar. [onDial] liga e diz se ligou (sem registro, não
 * liga, e a tela principal mostra o aviso); ligou pelo Ligar, o número sai do campo. Com espaço sobrando, o Rediscar e o
 * Ligar ficam no fim da tela, como no canvas; sem, a tela rola (o tamanho da letra segue o do celular).
 *
 * As sugestões (spec da 0.2, 4.1): ao digitar, até três contatos do celular com um número que tem os dígitos digitados
 * ([suggest], a busca da agenda, chamada fora da thread principal), com o nome e o número; um toque preenche o campo
 * com o número como ele é discado ([contactNumber], a regra dos números dos contatos: o que vai à central aparece no
 * campo, e o Ligar disca como um número digitado).
 *
 * O Rediscar (spec 6): liga para [redial], a feita mais nova dos Recentes ([rememberRedial]; null sem nenhuma, e ele
 * fica apagado), pelo mesmo [onDial] do botão de ligar da linha do Recentes, com o número como foi discado. O nome dele
 * ("Rediscar <número> · <nome>", com o [redialName]) vale para o leitor de tela e para a dica do aperto longo.
 */
@Composable
fun DialerScreen(
    onDial: (String) -> Boolean,
    suggest: (String) -> List<Contact>,
    contactNumber: (String) -> String,
    redial: Recent?,
    redialName: String?,
) {
    var number by rememberSaveable { mutableStateOf("") }
    val suggestions = rememberSuggestions(number, suggest, contactNumber)
    BoxWithConstraints(Modifier.fillMaxSize()) {
        // A coluna tem pelo menos a altura da tela: o espaço que sobra fica entre as teclas e a última linha.
        val screen = maxHeight
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = screen)
                .padding(start = 20.dp, top = 18.dp, end = 20.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(Modifier.padding(bottom = GAP), verticalArrangement = Arrangement.spacedBy(GAP)) {
                NumberLine(number, onErase = { number = number.dropLast(1) })
                Suggestions(suggestions, onPick = { number = it })
                Keys(onKey = { number += it })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Redial(redial, redialName, onDial = { onDial(it) })
                CyanButton(
                    DIAL,
                    tag = "ligar",
                    icon = StarsonicIcons.Phone,
                    enabled = number.isNotEmpty(),
                    size = ButtonSize.Call,
                    modifier = Modifier.weight(1f),
                ) {
                    if (onDial(number)) number = ""
                }
            }
        }
    }
}

/**
 * A feita mais nova dos Recentes ([lastDialed]) e o nome dela (o do contato do celular com o número, senão o que a
 * central mandou; null sem nenhum), para o Rediscar do Teclado. Lidos fora da thread principal, de novo a cada mudança
 * dos Recentes.
 */
@Composable
fun rememberRedial(store: RecentsStore, contacts: ContactsSource): Pair<Recent?, String?> {
    val version by store.version.collectAsState()
    var redial by remember { mutableStateOf<Pair<Recent?, String?>>(null to null) }
    LaunchedEffect(version) {
        redial = withContext(Dispatchers.IO) {
            val last = lastDialed(store.list())
            last to last?.let { contacts.lookup(it.number) ?: it.name.ifEmpty { null } }
        }
    }
    return redial
}

// O número digitado (o .number do canvas): grande, numa linha só, com o Apagar à direita e a linha embaixo.
@Composable
private fun NumberLine(number: String, onErase: () -> Unit) {
    val colors = LocalStarsonicColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .drawBehind {
                val line = 1.dp.toPx()
                drawRect(colors.border, topLeft = Offset(0f, size.height - line), size = Size(size.width, line))
            }
            .padding(top = 2.dp, bottom = 10.dp + 1.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Sem espaço para todos os dígitos, a reticência vai no começo: os últimos digitados ficam à vista (no Windows,
        // o campo rola até o cursor).
        Text(
            number,
            style = NumberText,
            color = colors.textStrong,
            maxLines = 1,
            overflow = TextOverflow.StartEllipsis,
            modifier = Modifier.weight(1f).testTag("numero"),
        )
        // O Apagar (o .ghost do canvas): redondo, de 44 dp, sem fundo; apagado sem número.
        Box(
            Modifier
                .size(44.dp)
                .alpha(if (number.isEmpty()) DISABLED_ALPHA else 1f)
                .clip(CircleShape)
                .clickable(enabled = number.isNotEmpty(), role = Role.Button, onClick = onErase)
                .testTag("apagar"),
            contentAlignment = Alignment.Center,
        ) {
            Icon(StarsonicIcons.Erase, contentDescription = ERASE, tint = colors.textMuted, modifier = Modifier.size(24.dp))
        }
    }
}

/**
 * As sugestões dos contatos numa vaga de altura fixa (a de uma sugestão do canvas, no tamanho da letra do celular): a
 * vaga fica mesmo vazia, e as sugestões aparecem e somem sem empurrar as teclas embaixo do dedo. Uma sugestão sozinha é
 * o .suggest do canvas (o avatar, o nome, o número e a seta); duas ou três dividem a vaga, só com o nome e o número. O
 * número do Transferir e o da Nova ligação, na tela da ligação, usam as mesmas (lá, só quando há alguma).
 */
@Composable
internal fun Suggestions(suggestions: List<Suggestion>, onPick: (String) -> Unit) {
    val lines = with(LocalDensity.current) { ListRowTitle.lineHeight.toDp() + ListRowSub.lineHeight.toDp() } + 2.dp
    Row(
        Modifier.fillMaxWidth().height(maxOf(lines, AVATAR) + 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val alone = suggestions.size == 1
        for (suggestion in suggestions) {
            SuggestionCard(suggestion, alone, Modifier.weight(1f).fillMaxHeight()) { onPick(suggestion.dial) }
        }
    }
}

// Uma sugestão (tag sugestao-<nome>): o fundo ciano claro, o nome e o número como estão gravados; sozinha ([alone]),
// também o avatar e a seta.
@Composable
private fun SuggestionCard(suggestion: Suggestion, alone: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val colors = LocalStarsonicColors.current
    Row(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(colors.iconTile)
            .clickable(onClick = onClick)
            .testTag("sugestao-${suggestion.name}")
            .padding(horizontal = 10.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (alone) Avatar(initials(suggestion.name), size = AVATAR)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(suggestion.name, style = ListRowTitle, color = colors.textStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(suggestion.number, style = ListRowSub, color = colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (alone) Icon(StarsonicIcons.ArrowRight, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(16.dp))
    }
}

// As 12 teclas (o .keys do canvas): três colunas iguais, 10 dp entre elas, com as letras embaixo dos números.
@Composable
private fun Keys(onKey: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (row in KEYS) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (key in row) {
                    DialKey(key, KEY_LETTERS[key].orEmpty(), tag = "tecla-$key", modifier = Modifier.weight(1f)) { onKey(key) }
                }
            }
        }
    }
}

/**
 * O Rediscar (spec 6): liga para a feita [redial] ([onDial] com o número dela), com o nome dele ([redialLabel], com o
 * [name]) também na dica do aperto longo (a do Android), no balão escuro do Windows (.redial-tip); apagado sem nenhuma
 * feita. O do Teclado tem a etiqueta `rediscar`; o da Nova ligação, na tela da ligação, passa a dele ([tag]), o tamanho
 * ([modifier]) e o fundo ([background]).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun Redial(
    redial: Recent?,
    name: String?,
    onDial: (String) -> Unit,
    modifier: Modifier = Modifier,
    tag: String = "rediscar",
    background: Color = LocalStarsonicColors.current.surface,
) {
    val label = redialLabel(redial, name)
    TooltipBox(
        positionProvider = TooltipDefaults.rememberTooltipPositionProvider(TooltipAnchorPosition.Above),
        tooltip = {
            PlainTooltip(
                modifier = Modifier.border(1.dp, Color.White.copy(alpha = 0.12f), TIP_SHAPE),
                shape = TIP_SHAPE,
                containerColor = Starsonic.Navy900,
                contentColor = Color.White,
                shadowElevation = 8.dp,
            ) {
                Text(label, style = TipText, modifier = Modifier.padding(horizontal = 2.dp, vertical = 2.dp))
            }
        },
        state = rememberTooltipState(),
    ) {
        RedialButton(label, enabled = redial != null, modifier = modifier, tag = tag, background = background) {
            if (redial != null) onDial(redial.number)
        }
    }
}

// As letras de cada tecla do Teclado (as do canvas e do Windows); o 1, o * e o # vão sem.
private val KEY_LETTERS = mapOf(
    "2" to "ABC", "3" to "DEF", "4" to "GHI", "5" to "JKL", "6" to "MNO", "7" to "PQRS", "8" to "TUV", "9" to "WXYZ", "0" to "+",
)

// O espaço entre as partes do Teclado (o gap do .body do canvas).
private val GAP = 14.dp

// O avatar da sugestão (o .avatar do canvas).
private val AVATAR = 36.dp

// O balão da dica do Rediscar (o .redial-tip do Windows).
private val TIP_SHAPE = RoundedCornerShape(10.dp)

private val Base = TextStyle(
    fontFamily = PlusJakartaSans,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

// .number-text
private val NumberText = Base.copy(fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.02).em, lineHeight = 1.1.em)

// .redial-tip
private val TipText = Base.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold, lineHeight = 1.3.em)

private const val DIAL = "Ligar"
private const val ERASE = "Apagar"
