package br.com.starsonic.phone.contacts

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A aba Contatos (spec da 0.2, 4.1 e 7.5): a busca ("Buscar contato") e a lista dos contatos do celular com número, em
 * ordem alfabética, com o nome e os números; tocar num contato com um número liga para ele ([onCall], com a regra dos
 * números dos contatos); com mais de um, a escolha do número. A lista é lida da agenda a cada abertura da aba e a cada
 * volta ao app, fora da thread principal; nada dela fica guardado.
 *
 * A permissão de contatos é pedida pela janela do Android na primeira abertura da aba (uma vez por processo: nada é
 * guardado). Sem ela, o aviso "Permita o acesso aos contatos para ligar pelo nome." e o Permitir, que pede de novo, ou
 * abre os ajustes do app quando o Android já não pergunta (negada de vez: depois de um pedido, o Android não dá mais a
 * explicação, shouldShowRequestPermissionRationale). A permissão dada nos ajustes vale na volta ao app.
 */
@Composable
fun ContactsScreen(source: ContactsSource, onCall: (String) -> Unit) {
    val activity = LocalContext.current.findActivity()
    var granted by remember { mutableStateOf(source.available()) }
    var blocked by remember { mutableStateOf(askedThisProcess && activity?.refusedForGood() == true) }
    var resumes by remember { mutableIntStateOf(0) }   // as voltas à aba: a permissão e a lista de novo
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        granted = ok
        blocked = !ok && activity?.refusedForGood() == true
    }
    LifecycleResumeEffect(Unit) {
        granted = source.available()
        resumes++
        onPauseOrDispose { }
    }
    LaunchedEffect(Unit) {
        if (!granted && !askedThisProcess) {
            askedThisProcess = true
            request.launch(READ_CONTACTS)
        }
    }
    if (!granted) {
        PermissionNeeded(
            onAllow = {
                if (blocked) {
                    openAppSettings(activity)
                } else {
                    askedThisProcess = true
                    request.launch(READ_CONTACTS)
                }
            },
        )
        return
    }
    var query by rememberSaveable { mutableStateOf("") }
    var contacts by remember { mutableStateOf<List<Contact>?>(null) }
    var choosing by remember { mutableStateOf<Contact?>(null) }
    LaunchedEffect(query, resumes) {
        contacts = withContext(Dispatchers.IO) { source.search(query) }
    }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text(SEARCH) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).testTag("contatos-busca"),
        )
        val shown = contacts ?: return@Column
        if (shown.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                Text(if (query.isBlank()) EMPTY else NOT_FOUND, style = MaterialTheme.typography.bodyLarge)
            }
            return@Column
        }
        LazyColumn(Modifier.fillMaxSize()) {
            items(shown) { contact ->
                ContactRow(contact) {
                    if (contact.numbers.size == 1) onCall(contact.numbers.single()) else choosing = contact
                }
                HorizontalDivider()
            }
        }
    }
    choosing?.let { contact ->
        NumberChoice(
            contact,
            onPick = { number ->
                choosing = null
                onCall(number)
            },
            onDismiss = { choosing = null },
        )
    }
}

// Um contato da lista: o nome e os números (tag contato-<nome>).
@Composable
private fun ContactRow(contact: Contact, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag("contato-${contact.name}"),
    ) {
        Text(contact.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(
            contact.numbers.joinToString(" · "),
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// A escolha do número de um contato com mais de um (tags numero-<n>, n a partir de 0).
@Composable
private fun NumberChoice(contact: Contact, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(contact.name) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                contact.numbers.forEachIndexed { index, number ->
                    TextButton(
                        onClick = { onPick(number) },
                        modifier = Modifier.fillMaxWidth().testTag("numero-$index"),
                    ) {
                        Text(number, style = MaterialTheme.typography.titleMedium, modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(CANCEL) }
        },
    )
}

// Sem a permissão: o aviso e o Permitir.
@Composable
private fun PermissionNeeded(onAllow: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(PERMISSION_NEEDED, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
        Spacer(Modifier.height(16.dp))
        Button(onClick = onAllow, modifier = Modifier.testTag("contatos-permitir")) { Text(ALLOW) }
    }
}

/** Uma sugestão ao digitar um número: o nome do contato, o número como está gravado e o número como é discado. */
internal data class Suggestion(val name: String, val number: String, val dial: String)

/**
 * As sugestões (até três) para o número digitado [typed] (spec da 0.2, 4.1): os contatos que têm um número com os
 * dígitos dele ([suggest], a busca da agenda), com esse número e, para preencher o campo, o número como ele é discado
 * ([contactNumber], a regra dos números dos contatos). Lidas fora da thread principal a cada mudança; sem dígitos,
 * nenhuma.
 */
@Composable
internal fun rememberSuggestions(
    typed: String,
    suggest: (String) -> List<Contact>,
    contactNumber: (String) -> String,
): List<Suggestion> {
    var found by remember { mutableStateOf(emptyList<Suggestion>()) }
    LaunchedEffect(typed) {
        val digits = digitsOf(typed)
        found = if (digits.isEmpty()) {
            emptyList()
        } else {
            withContext(Dispatchers.IO) {
                suggest(typed).asSequence()
                    .mapNotNull { contact ->
                        contact.numbers.firstOrNull { digits in digitsOf(it) }?.let { contact.name to it }
                    }
                    .take(MAX_SUGGESTIONS)
                    .map { (name, number) -> Suggestion(name, number, contactNumber(number)) }
                    .toList()
            }
        }
    }
    return found
}

/**
 * As sugestões do Teclado e do número da tela de chamada, lado a lado numa faixa de altura fixa (no tamanho da letra do
 * celular). O Teclado a deixa mesmo vazia: elas aparecem e somem sem empurrar o teclado embaixo do dedo. Cada uma (tag
 * sugestao-<nome>) mostra o nome e o número, em [color], e encolhe (com "…") para as três caberem; o toque passa o
 * número como é discado a [onPick].
 */
@Composable
internal fun ContactSuggestions(suggestions: List<Suggestion>, color: Color, onPick: (String) -> Unit) {
    val name = MaterialTheme.typography.labelLarge
    val number = MaterialTheme.typography.bodySmall
    val height = with(LocalDensity.current) { name.lineHeight.toDp() + number.lineHeight.toDp() } + 12.dp
    Row(
        Modifier.fillMaxWidth().height(height),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (suggestion in suggestions) {
            Column(
                Modifier
                    .weight(1f, fill = false)
                    .widthIn(max = 200.dp)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(12.dp))
                    .background(color.copy(alpha = 0.08f))
                    .clickable { onPick(suggestion.dial) }
                    .padding(horizontal = 12.dp, vertical = 6.dp)
                    .testTag("sugestao-${suggestion.name}"),
                verticalArrangement = Arrangement.Center,
            ) {
                Text(suggestion.name, color = color, style = name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    suggestion.number,
                    color = color.copy(alpha = 0.75f),
                    style = number,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

// A permissão já foi pedida neste processo (a primeira abertura da aba pede uma vez). Só na thread principal.
private var askedThisProcess = false

// Negada de vez: o Android já não mostra a janela (sem a explicação depois de um pedido negado).
private fun Activity.refusedForGood(): Boolean = !shouldShowRequestPermissionRationale(READ_CONTACTS)

// Os ajustes do app no Android (onde a pessoa dá a permissão negada de vez).
private fun openAppSettings(activity: Activity?) {
    val context = activity ?: return
    val settings = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.fromParts("package", context.packageName, null),
    )
    try {
        context.startActivity(settings)
    } catch (e: ActivityNotFoundException) {
        // Um Android sem a tela dos ajustes do app: nada a fazer.
    }
}

// A activity da tela (o LocalContext do setContent é ela, ou um embrulho dela).
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

private const val READ_CONTACTS = Manifest.permission.READ_CONTACTS
private const val MAX_SUGGESTIONS = 3
private const val SEARCH = "Buscar contato"
private const val EMPTY = "Nenhum contato com número no celular."
private const val NOT_FOUND = "Nenhum contato encontrado."
private const val PERMISSION_NEEDED = "Permita o acesso aos contatos para ligar pelo nome."
private const val ALLOW = "Permitir"
private const val CANCEL = "Cancelar"
