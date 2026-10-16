package br.com.starsonic.phone.main

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import br.com.starsonic.phone.R
import br.com.starsonic.phone.contacts.ContactsSource
import br.com.starsonic.phone.data.CallKind
import br.com.starsonic.phone.data.Recent
import br.com.starsonic.phone.data.RecentsStore
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * O Recentes (spec 4.1): as ligações feitas, recebidas e perdidas, das mais novas para as mais antigas, com o
 * número (e o nome), o tipo, a data, a hora e a duração; tocar numa delas liga de volta ([onDial]). A lista
 * é lida do disco fora da thread principal, de novo a cada mudança.
 *
 * O nome (spec da 0.2, 7.5): o do contato do celular com o número ([ContactsSource.lookup], procurado na hora de
 * mostrar, na mesma leitura, uma vez por número), senão o que a central mandou (o que os Recentes guardam), senão o
 * número.
 */
@Composable
fun RecentsScreen(store: RecentsStore, contacts: ContactsSource, onDial: (String) -> Unit) {
    val version by store.version.collectAsState()
    var recents by remember { mutableStateOf<List<Pair<Recent, String>>?>(null) }
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
    val shown = recents ?: return
    if (shown.isEmpty()) {
        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
            Text(EMPTY, style = MaterialTheme.typography.bodyLarge)
        }
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(shown) { (recent, name) ->
            RecentRow(recent, name, onClick = { onDial(recent.number) })
            HorizontalDivider()
        }
    }
}

// Uma ligação do Recentes, com o nome [name] (o do contato ou o da central; vazio: só o número).
@Composable
private fun RecentRow(recent: Recent, name: String, onClick: () -> Unit) {
    val (icon, tint) = when (recent.kind) {
        CallKind.FEITA -> R.drawable.ic_feita to StarsonicCyan
        CallKind.RECEBIDA -> R.drawable.ic_recebida to CallGreen
        CallKind.PERDIDA -> R.drawable.ic_perdida to CallRed
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag("recente"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(painterResource(icon), contentDescription = null, tint = tint)
        Column(Modifier.weight(1f)) {
            Text(
                name.ifEmpty { recent.number },
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (recent.kind == CallKind.PERDIDA) CallRed else Color.Unspecified,
            )
            if (name.isNotEmpty()) Text(recent.number, style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(kindLabel(recent.kind), style = MaterialTheme.typography.bodySmall)
                Text("·", style = MaterialTheme.typography.bodySmall)
                Text(DATE_TIME.format(Date(recent.startMillis)), style = MaterialTheme.typography.bodySmall)
                if (recent.durationSec > 0) {
                    Text("·", style = MaterialTheme.typography.bodySmall)
                    Text(duration(recent.durationSec), style = MaterialTheme.typography.bodySmall)
                }
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

/** A duração como num relógio: 0:42, 12:05 ou 1:02:03. */
internal fun duration(seconds: Int): String {
    val hours = seconds / 3600
    val minutes = seconds % 3600 / 60
    val rest = seconds % 60
    return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, rest) else "%d:%02d".format(minutes, rest)
}

private const val EMPTY = "Nenhuma ligação ainda."
private val DATE_TIME: DateFormat = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, Locale("pt", "BR"))
