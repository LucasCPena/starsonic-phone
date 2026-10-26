package br.com.starsonic.phone.main

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import br.com.starsonic.phone.contacts.ContactsSource
import br.com.starsonic.phone.data.CallKind
import br.com.starsonic.phone.data.Recent
import br.com.starsonic.phone.data.RecentsStore
import br.com.starsonic.phone.ui.ListEmptyText
import br.com.starsonic.phone.ui.ListGroupTitle
import br.com.starsonic.phone.ui.ListRow
import br.com.starsonic.phone.ui.ListRowSub
import br.com.starsonic.phone.ui.ListRowTitle
import br.com.starsonic.phone.ui.LocalStarsonicColors
import br.com.starsonic.phone.ui.PlusJakartaSans
import br.com.starsonic.phone.ui.RowIconButton
import br.com.starsonic.phone.ui.Starsonic
import br.com.starsonic.phone.ui.StarsonicIcons
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * O Recentes (spec 3.2, 3.4 e 4.1, o quadro Recentes do canvas): os filtros "Todas" e "Perdidas · <n>" e as ligações
 * feitas, recebidas e perdidas, das mais novas para as mais antigas, em grupos por dia ("Hoje", "Ontem", a data). Cada
 * linha tem o ícone do tipo num quadrado (a perdida em vermelho claro), o nome (com o ramal) ou o número, o tipo, a hora
 * e a duração, e o botão de ligar redondo; tocar na linha também liga de volta ([onDial]). A lista é lida do disco fora
 * da thread principal, de novo a cada mudança.
 *
 * O nome (spec da 0.2, 7.5): o do contato do celular com o número ([ContactsSource.lookup], procurado na hora de
 * mostrar, na mesma leitura, uma vez por número), senão o que a central mandou (o que os Recentes guardam), senão o
 * número.
 */
@Composable
fun RecentsScreen(store: RecentsStore, contacts: ContactsSource, onDial: (String) -> Unit) {
    val version by store.version.collectAsState()
    var recents by remember { mutableStateOf<List<Pair<Recent, String>>?>(null) }
    var missedOnly by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(version) {
        recents = withContext(Dispatchers.IO) {
            val names = HashMap<String, String?>()
            store.list().map { recent ->
                val contact = if (recent.number in names) names[recent.number] else contacts.lookup(recent.number)
                names[recent.number] = contact
                recent to (contact ?: recent.name)
            }
        }
    }
    val all = recents ?: return
    val missed = all.count { it.first.kind == CallKind.PERDIDA }
    val groups = remember(all, missedOnly) {
        val now = System.currentTimeMillis()
        all.filter { !missedOnly || it.first.kind == CallKind.PERDIDA }.groupConsecutive { dayGroup(it.first.startMillis, now) }
    }
    val lastShown = groups.lastOrNull()?.second?.lastOrNull()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, top = 18.dp, end = 20.dp, bottom = 14.dp)) {
        item {
            Filters(missedOnly, missed, onChange = { missedOnly = it })
            Spacer(Modifier.height(6.dp))
        }
        if (all.isEmpty()) item { ListEmptyText(EMPTY) }
        for ((day, rows) in groups) {
            item { ListGroupTitle(day) }
            items(rows) { row ->
                val (recent, name) = row
                RecentRow(recent, name, last = row === lastShown, onDial = { onDial(recent.number) })
            }
        }
    }
}

// Os filtros (o .filters do canvas): "Todas" e "Perdidas · <n>" ([missed], só "Perdidas" sem nenhuma), em pílulas;
// a escolhida fica cheia. Sem espaço lado a lado (a letra grande numa tela estreita), a segunda desce, inteira.
@Composable
private fun Filters(missedOnly: Boolean, missed: Int, onChange: (Boolean) -> Unit) {
    FlowRow(
        Modifier.selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FilterPill(ALL, selected = !missedOnly, tag = "filtro-todas") { onChange(false) }
        FilterPill(if (missed > 0) "$MISSED · $missed" else MISSED, selected = missedOnly, tag = "filtro-perdidas") { onChange(true) }
    }
}

// Uma pílula de filtro (o .pill do canvas): 36 dp, com contorno; a escolhida ([selected]) no pill-on do tema.
@Composable
private fun FilterPill(text: String, selected: Boolean, tag: String, onClick: () -> Unit) {
    val colors = LocalStarsonicColors.current
    Box(
        Modifier
            .heightIn(min = 36.dp)
            .clip(CircleShape)
            .background(if (selected) colors.pillOnBackground else Color.Transparent)
            .border(1.dp, if (selected) colors.pillOnBackground else colors.border, CircleShape)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .testTag(tag)
            .padding(horizontal = 1.dp + 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = PillLabel, color = if (selected) colors.pillOnText else colors.textMuted)
    }
}

// Uma ligação do Recentes (tag recente), com o nome [name] (o do contato ou o da central; vazio: só o número). O
// nome, o ramal e o tipo são textos à parte (o leitor de tela e os testes os acham como estão).
@Composable
private fun RecentRow(recent: Recent, name: String, last: Boolean, onDial: () -> Unit) {
    val colors = LocalStarsonicColors.current
    val missed = recent.kind == CallKind.PERDIDA
    val title = recentTitle(recent.number, name)
    ListRow(
        tag = "recente",
        last = last,
        onClick = onDial,
        leading = {
            // O .tile do canvas: a seta da feita, ou a da recebida e da perdida (esta em vermelho).
            Box(
                Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (missed) Starsonic.Danger.copy(alpha = 0.12f) else colors.iconTile),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (recent.kind == CallKind.FEITA) StarsonicIcons.Outgoing else StarsonicIcons.Incoming,
                    contentDescription = null,
                    tint = if (missed) Starsonic.Danger else colors.icon,
                    modifier = Modifier.size(20.dp),
                )
            }
        },
        trailing = { RowIconButton(StarsonicIcons.Phone, DIAL, tag = "recente-ligar", onClick = onDial) },
    ) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title.name, style = ListRowTitle, color = colors.textStrong)
            if (title.ramal != null) Text("· ${title.ramal}", style = ListRowTitle, color = colors.textStrong)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(kindLabel(recent.kind), style = ListRowSub, color = colors.textMuted)
            Text("· ${clockTime(recent.startMillis)}", style = ListRowSub, color = colors.textMuted)
            if (recent.durationSec > 0) {
                Text("· ${recentDuration(recent.durationSec)}", style = ListRowSub, color = colors.textMuted)
            }
        }
    }
}

/** O tipo da ligação, como o Recentes mostra. */
internal fun kindLabel(kind: CallKind): String = when (kind) {
    CallKind.FEITA -> "Feita"
    CallKind.RECEBIDA -> "Recebida"
    CallKind.PERDIDA -> "Perdida"
}

/** A duração como num relógio: 0:42, 12:05 ou 1:02:03 (o tempo da tela de chamada). */
internal fun duration(seconds: Int): String {
    val hours = seconds / 3600
    val minutes = seconds % 3600 / 60
    val rest = seconds % 60
    return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, rest) else "%d:%02d".format(minutes, rest)
}

// Os itens em grupos de vizinhos com a mesma chave ([key]), na ordem: (a chave, os itens).
private fun <T> List<T>.groupConsecutive(key: (T) -> String): List<Pair<String, List<T>>> {
    val groups = ArrayList<Pair<String, MutableList<T>>>()
    for (item in this) {
        val current = key(item)
        val last = groups.lastOrNull()
        if (last != null && last.first == current) last.second += item else groups += current to mutableListOf(item)
    }
    return groups
}

// .pill
private val PillLabel = TextStyle(
    fontFamily = PlusJakartaSans,
    fontSize = 13.sp,
    fontWeight = FontWeight.SemiBold,
    lineHeight = 1.em,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

private const val EMPTY = "Nenhuma ligação ainda."
private const val ALL = "Todas"
private const val MISSED = "Perdidas"
private const val DIAL = "Ligar"
