package br.com.starsonic.phone.call

import android.telecom.CallAudioState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import br.com.starsonic.phone.R
import br.com.starsonic.phone.main.CallGreen
import br.com.starsonic.phone.main.CallRed
import br.com.starsonic.phone.main.Keypad
import br.com.starsonic.phone.main.StarsonicBlue
import br.com.starsonic.phone.main.StarsonicCyan
import br.com.starsonic.phone.main.duration
import kotlinx.coroutines.delay

/**
 * O que a tela de chamada pede (ao CallManager e ao Telecom). Atender e Recusar valem para a recebida que toca (a
 * única, ou a segunda na faixa); Desligar, Espera, Teclado e Transferir (o Transferir agora), para a ativa (na
 * conferência, Desligar desliga as duas); [activate] é o Alternar, e [dial] faz a Nova ligação (false: não ligou).
 * [consult] é o Consultar (false: não ligou), e [completeTransfer] e [cancelConsult], o Concluir transferência e o
 * Cancelar da consulta. [join] e [split] são o Juntar e o Separar da conferência.
 */
class CallActions(
    val answer: () -> Unit,
    val reject: () -> Unit,
    val hangup: () -> Unit,
    val mute: () -> Unit,
    val hold: () -> Unit,
    val activate: () -> Unit,
    val dtmf: (String) -> Unit,
    val transfer: (String) -> Boolean,
    val consult: (String) -> Boolean,
    val completeTransfer: () -> Unit,
    val cancelConsult: () -> Unit,
    val join: () -> Unit,
    val split: () -> Unit,
    val dial: (String) -> Boolean,
    val route: (Int) -> Unit,
)

/**
 * A tela de chamada (spec 4.1 e 7.5; com duas ligações, spec da 0.2, 4.1, 7.1 e 7.2). Recebida tocando: o número (e
 * o nome, se o PABX mandou), Recusar e Atender. Feita ou em andamento: o número, "Chamando…" ou o tempo, Mudo,
 * Teclado (DTMF), Viva-voz (ou a escolha Celular, Viva-voz e Bluetooth com um fone Bluetooth), Espera ou Retomar,
 * Transferir (o número para onde a ligação passa), Nova ligação (o número da segunda) e Desligar. Uma feita que
 * não completou mostra o motivo ([endMessage]) com o número; com a ligação de pé, o aviso da outra (a em espera que
 * caiu, a Nova ligação que não completou) aparece embaixo do estado.
 *
 * Com duas ligações: a ativa em cima, e a outra no cartão "Em espera" embaixo, com Alternar no lugar da Nova
 * ligação; a segunda que chega toca na faixa "Ligação de <nome ou número>" no alto, com Recusar e Atender. Desligar
 * desliga a ativa (a em espera volta sozinha).
 *
 * Transferir abre o número com Consultar e Transferir agora (a direta). Na consulta (spec da 0.2, 7.3), o colega em
 * cima e o cliente no cartão "Em espera · transferência" (depois do Alternar, o cliente em cima e o colega "Em
 * espera"), com Concluir transferência (com o colega já atendido), Alternar e Cancelar no lugar de Espera,
 * Transferir e Nova ligação.
 *
 * Com as duas em andamento (sem consulta), Juntar faz a conferência (spec da 0.2, 7.4): o título "Conferência", os
 * dois nomes (ou números) e o tempo desde o Juntar, com Mudo, Teclado, o áudio, Separar e Desligar (as duas); Separar
 * volta aos dois cartões, com a última que entrou em espera.
 */
@Composable
fun CallScreen(call: CallUi?, endMessage: String, routes: AudioRoutes, actions: CallActions) {
    // Depois do fim, a tela mostra a última ligação com o aviso, até sair (não é estado: só lembra).
    val last = remember { LastCall() }
    if (call != null) last.call = call
    val shown = call ?: last.call
    var keypadOpen by rememberSaveable { mutableStateOf(false) }
    var transferOpen by rememberSaveable { mutableStateOf(false) }
    var newCallOpen by rememberSaveable { mutableStateOf(false) }
    var digits by rememberSaveable { mutableStateOf("") }
    // O teclado e o Transferir abertos são da ligação de cima (a de [panelsOf]): quando ela troca (a segunda atendida,
    // Alternar, a volta da em espera), eles fecham e os dígitos saem, sem nunca aparecer para a outra. O id fica
    // guardado como o resto, para a rotação não fechar nada.
    var panelsOf by rememberSaveable { mutableIntStateOf(call?.id ?: CallManager.NO_ID) }
    val sameCall = call?.id == panelsOf
    LaunchedEffect(call?.id) {
        val id = call?.id ?: return@LaunchedEffect
        if (id != panelsOf) {
            panelsOf = id
            keypadOpen = false
            transferOpen = false
            digits = ""
        }
    }
    // O teclado e a transferência só valem com a ligação em andamento; a Nova ligação, com ela sozinha.
    val active = call?.phase == CallPhase.ACTIVE
    val alone = active && call?.second == null
    val keypad = keypadOpen && active && sameCall
    val transfer = transferOpen && active && sameCall
    val newCall = newCallOpen && alone
    // A Nova ligação fechada por outra ligação (a segunda que chega) não volta sozinha quando ela sai.
    LaunchedEffect(alone) { if (!alone) newCallOpen = false }
    val other = call?.second
    Column(
        Modifier
            .fillMaxSize()
            .background(StarsonicBlue)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag("chamada"),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (other?.kind == SecondKind.RINGING) SecondCallBar(other, actions)
        val conference = call?.takeIf { it.conference }
        if (conference != null) {
            ConferenceHeader(conference, endMessage, if (keypad) digits else "")
        } else {
            Header(shown, call, endMessage, if (keypad) digits else "")
        }
        // Na consulta com o colega em cima, o cartão de baixo é o cliente.
        val heldLabel = if (call?.consult?.colleagueActive == true) ON_HOLD_TRANSFER else ON_HOLD
        if (other?.kind == SecondKind.HELD) HeldCard(other, heldLabel)
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            when {
                call == null -> {}
                call.phase == CallPhase.RINGING -> {}
                keypad -> Keypad(
                    onKey = { key ->
                        digits += key
                        actions.dtmf(key)
                    },
                    tagPrefix = "dtmf-",
                    keyColor = Color.White,
                    keySize = 56.dp,
                )
                transfer -> NumberPanel(
                    title = TRANSFER_TO,
                    tagPrefix = "transferir",
                    onCancel = { transferOpen = false },
                    choices = listOf(
                        // O Consultar é a segunda ligação: com duas, não.
                        PanelChoice(
                            CONSULT, R.drawable.ic_consultar, "transferir-consultar", enabled = call.second == null,
                        ) { number ->
                            if (actions.consult(number)) transferOpen = false
                        },
                        PanelChoice(TRANSFER_NOW, R.drawable.ic_transferir_agora, "transferir-agora") { number ->
                            if (actions.transfer(number)) transferOpen = false
                        },
                    ),
                )
                newCall -> NumberPanel(
                    title = NEW_CALL,
                    tagPrefix = "nova",
                    onCancel = { newCallOpen = false },
                    choices = listOf(
                        PanelChoice(DIAL, null, "nova-ligar") { number -> if (actions.dial(number)) newCallOpen = false },
                    ),
                )
                else -> Controls(
                    call,
                    routes,
                    actions,
                    onKeypad = { keypadOpen = true },
                    onTransfer = { transferOpen = true },
                    onNewCall = { newCallOpen = true },
                )
            }
        }
        when {
            call == null -> Spacer(Modifier.height(72.dp))
            call.phase == CallPhase.RINGING -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                RoundAction(R.drawable.ic_desligar, REJECT, CallRed, "recusar", actions.reject)
                RoundAction(R.drawable.ic_ligar, ANSWER, CallGreen, "atender", actions.answer)
            }
            else -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                if (keypad) {
                    TextButton(onClick = { keypadOpen = false }, modifier = Modifier.testTag("teclado-chamada")) {
                        Text(KEYPAD, color = StarsonicCyan)
                    }
                }
                RoundAction(R.drawable.ic_desligar, HANG_UP, CallRed, "desligar", actions.hangup)
            }
        }
    }
}

// A última ligação mostrada.
private class LastCall {
    var call: CallUi? = null
}

// O nome (ou o número), o número e o estado da ligação (ou o aviso do fim).
@Composable
private fun Header(shown: CallUi?, call: CallUi?, endMessage: String, digits: String) {
    Column(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        if (shown != null) {
            Text(
                shown.name.ifEmpty { shown.number },
                color = Color.White,
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center,
            )
            if (shown.name.isNotEmpty()) {
                Text(shown.number, color = Color.White, style = MaterialTheme.typography.titleMedium)
            }
        }
        Spacer(Modifier.height(8.dp))
        when {
            call == null -> Text(
                endMessage,
                color = Color.White,
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
                modifier = Modifier.testTag("aviso-ligacao"),
            )
            digits.isNotEmpty() -> Text(digits, color = Color.White, style = MaterialTheme.typography.titleLarge)
            else -> Text(status(call), color = StarsonicCyan, style = MaterialTheme.typography.titleMedium)
        }
        // Com a ligação de pé, o aviso de 2 s da outra: "<nome ou número> desligou", ou o da Nova ligação.
        if (call != null && endMessage.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            Text(
                endMessage,
                color = Color.White,
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                modifier = Modifier.testTag("aviso-ligacao"),
            )
        }
    }
}

// A conferência: o título "Conferência", os dois nomes (ou números) e o tempo desde o Juntar (ou os dígitos do
// teclado); com o aviso de 2 s embaixo, como no [Header].
@Composable
private fun ConferenceHeader(call: CallUi, endMessage: String, digits: String) {
    Column(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            CONFERENCE,
            color = Color.White,
            style = MaterialTheme.typography.headlineMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag("conferencia"),
        )
        Spacer(Modifier.height(8.dp))
        val parties = listOfNotNull(call.name.ifEmpty { call.number }, call.second?.let { it.name.ifEmpty { it.number } })
        for (party in parties) {
            Text(party, color = Color.White, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(8.dp))
        if (digits.isNotEmpty()) {
            Text(digits, color = Color.White, style = MaterialTheme.typography.titleLarge)
        } else {
            Text(elapsed(call.conferenceSinceMillis), color = StarsonicCyan, style = MaterialTheme.typography.titleMedium)
        }
        if (endMessage.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            Text(
                endMessage,
                color = Color.White,
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                modifier = Modifier.testTag("aviso-ligacao"),
            )
        }
    }
}

// A faixa da segunda ligação, que toca: "Ligação de <nome ou número>", com Recusar (em vermelho) e Atender (em
// verde), como a notificação. Os dois valem para ela (o CallManager atende ou recusa a que toca).
@Composable
private fun SecondCallBar(ringing: SecondUi, actions: CallActions) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Color.White.copy(alpha = 0.15f))
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag("segunda-ligacao"),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "$CALL_FROM ${ringing.name.ifEmpty { ringing.number }}",
            color = Color.White,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            BarButton(R.drawable.ic_desligar, REJECT, CallRed, "recusar-segunda", actions.reject)
            BarButton(R.drawable.ic_ligar, ANSWER, CallGreen, "atender-segunda", actions.answer)
        }
    }
}

// Um botão da faixa da segunda ligação: o ícone e o nome, na cor dele.
@Composable
private fun BarButton(icon: Int, label: String, color: Color, tag: String, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = Color.White),
        modifier = Modifier.testTag(tag),
    ) {
        Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(label)
    }
}

// O cartão da outra de duas ligações, embaixo da ativa: o nome (ou o número) e [label] ("Em espera", ou "Em espera ·
// transferência" para o cliente da consulta), em cinza.
@Composable
private fun HeldCard(held: SecondUi, label: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 16.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Color.White.copy(alpha = 0.1f))
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag("cartao-espera"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(held.name.ifEmpty { held.number }, color = Color.White, style = MaterialTheme.typography.titleMedium)
            if (held.name.isNotEmpty()) {
                Text(held.number, color = HeldGray, style = MaterialTheme.typography.bodyMedium)
            }
        }
        Spacer(Modifier.width(12.dp))
        Text(label, color = HeldGray, style = MaterialTheme.typography.labelLarge)
    }
}

// O estado: "Ligação recebida", "Chamando…", "Conectando…" ou o tempo (e "Em espera").
@Composable
private fun status(call: CallUi): String = when (call.phase) {
    CallPhase.RINGING -> INCOMING
    CallPhase.DIALING -> CALLING
    CallPhase.CONNECTING -> CONNECTING
    CallPhase.ACTIVE -> {
        val time = elapsed(call.activeSinceMillis)
        if (call.held) "$time · $ON_HOLD" else time
    }
}

// O tempo desde [sinceMillis], que anda a cada segundo.
@Composable
private fun elapsed(sinceMillis: Long): String {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(sinceMillis) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }
    return duration(((now - sinceMillis) / 1000).toInt().coerceAtLeast(0))
}

// Os botões da ligação: Mudo, Teclado e o áudio; Espera (ou Retomar), Transferir e a Nova ligação (com uma ligação
// só, em andamento) ou, com duas, Alternar e Juntar (com as duas em andamento: a feita que chama ainda não alterna nem
// junta). Na consulta: Concluir transferência e Alternar (com o colega já atendido) e Cancelar. Na conferência, só
// Separar.
@Composable
private fun Controls(
    call: CallUi,
    routes: AudioRoutes,
    actions: CallActions,
    onKeypad: () -> Unit,
    onTransfer: () -> Unit,
    onNewCall: () -> Unit,
) {
    val active = call.phase == CallPhase.ACTIVE
    val other = call.second
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            Toggle(R.drawable.ic_mudo, MUTE, call.muted, true, "mudo", actions.mute)
            Toggle(R.drawable.ic_teclado, KEYPAD, false, active, "teclado-chamada", onKeypad)
            if (!routes.bluetoothAvailable) {
                Toggle(R.drawable.ic_viva_voz, SPEAKER, routes.speaker, true, "viva-voz") {
                    actions.route(if (routes.speaker) routes.handsetRoute else CallAudioState.ROUTE_SPEAKER)
                }
            }
        }
        if (routes.bluetoothAvailable) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                Toggle(R.drawable.ic_ligar, HANDSET, !routes.speaker && !routes.bluetooth, true, "celular") {
                    actions.route(routes.handsetRoute)
                }
                Toggle(R.drawable.ic_viva_voz, SPEAKER, routes.speaker, true, "viva-voz") {
                    actions.route(CallAudioState.ROUTE_SPEAKER)
                }
                Toggle(R.drawable.ic_bluetooth, BLUETOOTH, routes.bluetooth, true, "bluetooth") {
                    actions.route(CallAudioState.ROUTE_BLUETOOTH)
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            val both = active && other?.kind == SecondKind.HELD   // as duas em andamento
            if (call.conference) {
                Toggle(R.drawable.ic_separar, SPLIT, false, true, "separar", actions.split)
            } else if (call.consult != null) {
                Toggle(
                    104.dp, R.drawable.ic_concluir, COMPLETE_TRANSFER, false, both, "concluir-transferencia",
                    actions.completeTransfer,
                )
                Toggle(R.drawable.ic_alternar, SWAP, false, both, "alternar", actions.activate)
                Toggle(R.drawable.ic_desligar, CANCEL, false, true, "cancelar-consulta", actions.cancelConsult)
            } else if (other != null && other.kind != SecondKind.RINGING) {
                // Quatro botões: um pouco mais estreitos, para caber nos celulares de 320 dp.
                val hold = if (call.held) RESUME else HOLD
                Toggle(TWO_CALLS_WIDTH, R.drawable.ic_espera, hold, call.held, active, "espera", actions.hold)
                Toggle(TWO_CALLS_WIDTH, R.drawable.ic_transferir, TRANSFER, false, active, "transferir", onTransfer)
                Toggle(TWO_CALLS_WIDTH, R.drawable.ic_alternar, SWAP, false, both, "alternar", actions.activate)
                Toggle(TWO_CALLS_WIDTH, R.drawable.ic_juntar, JOIN, false, both, "juntar", actions.join)
            } else {
                Toggle(R.drawable.ic_espera, if (call.held) RESUME else HOLD, call.held, active, "espera", actions.hold)
                Toggle(R.drawable.ic_transferir, TRANSFER, false, active, "transferir", onTransfer)
                Toggle(R.drawable.ic_nova_ligacao, NEW_CALL, false, active && other == null, "nova-ligacao", onNewCall)
            }
        }
    }
}

// Um botão do [NumberPanel]: o nome, o ícone (null: nenhum), a etiqueta, se vale agora (além de um número digitado)
// e o que ele faz com o número.
private class PanelChoice(
    val label: String,
    val icon: Int?,
    val tag: String,
    val enabled: Boolean = true,
    val onPick: (String) -> Unit,
)

// Um número, com os botões [choices] (lado a lado) e Cancelar embaixo: para onde a ligação vai (Transferir: Consultar
// ou Transferir agora) ou para quem ligar (Nova ligação). Com um botão só, o Concluído do teclado é ele. As
// etiquetas: <tagPrefix>-numero, <tagPrefix>-cancelar e a de cada botão.
@Composable
private fun NumberPanel(title: String, tagPrefix: String, onCancel: () -> Unit, choices: List<PanelChoice>) {
    var number by rememberSaveable { mutableStateOf("") }
    val colors = OutlinedTextFieldDefaults.colors(
        focusedTextColor = Color.White,
        unfocusedTextColor = Color.White,
        focusedBorderColor = StarsonicCyan,
        unfocusedBorderColor = Color.White,
        focusedLabelColor = StarsonicCyan,
        unfocusedLabelColor = Color.White,
        cursorColor = StarsonicCyan,
    )
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(title, color = Color.White, style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = number,
            onValueChange = { number = it },
            label = { Text(NUMBER) },
            singleLine = true,
            colors = colors,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            // Com mais de um botão, o Concluído só fecha o teclado (a pessoa escolhe o botão).
            keyboardActions = choices.singleOrNull()?.let { only -> KeyboardActions(onDone = { only.onPick(number) }) }
                ?: KeyboardActions.Default,
            modifier = Modifier.fillMaxWidth().testTag("$tagPrefix-numero"),
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for (choice in choices) {
                Button(
                    onClick = { choice.onPick(number) },
                    enabled = choice.enabled && number.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(containerColor = StarsonicCyan, contentColor = Color.White),
                    modifier = Modifier.weight(1f).testTag(choice.tag),
                ) {
                    if (choice.icon != null) {
                        Icon(painterResource(choice.icon), contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(choice.label, textAlign = TextAlign.Center)
                }
            }
        }
        TextButton(onClick = onCancel, modifier = Modifier.testTag("$tagPrefix-cancelar")) {
            Text(CANCEL, color = Color.White)
        }
    }
}

// Um botão redondo de ligar ou desligar, com o nome embaixo (o toque vale nos dois).
@Composable
private fun RoundAction(icon: Int, label: String, color: Color, tag: String, onClick: () -> Unit) {
    Column(
        Modifier
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(8.dp)
            .testTag(tag),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(color), contentAlignment = Alignment.Center) {
            Icon(painterResource(icon), contentDescription = null, tint = Color.White, modifier = Modifier.size(32.dp))
        }
        Spacer(Modifier.height(8.dp))
        Text(label, color = Color.White, style = MaterialTheme.typography.labelLarge)
    }
}

// Um botão da ligação, com o nome embaixo (o toque vale nos dois): aceso ([on]) em branco, apagado transparente.
@Composable
private fun Toggle(icon: Int, label: String, on: Boolean, enabled: Boolean, tag: String, onClick: () -> Unit) {
    Toggle(80.dp, icon, label, on, enabled, tag, onClick)
}

// O mesmo, na largura [width]: um nome comprido (Concluir transferência) pede uma maior, para quebrar entre as palavras.
@Composable
private fun Toggle(width: Dp, icon: Int, label: String, on: Boolean, enabled: Boolean, tag: String, onClick: () -> Unit) {
    val alpha = if (enabled) 1f else 0.4f
    Column(
        Modifier
            .width(width)
            .clip(RoundedCornerShape(16.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 4.dp)
            .testTag(tag),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(56.dp)
                .clip(CircleShape)
                .background(if (on) Color.White else Color.White.copy(alpha = 0.15f * alpha)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painterResource(icon),
                contentDescription = null,
                tint = if (on) StarsonicBlue else Color.White.copy(alpha = alpha),
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(label, color = Color.White.copy(alpha = alpha), style = MaterialTheme.typography.labelLarge, textAlign = TextAlign.Center)
    }
}

private const val ANSWER = "Atender"
private const val REJECT = "Recusar"
private const val HANG_UP = "Desligar"
private const val MUTE = "Mudo"
private const val KEYPAD = "Teclado"
private const val SPEAKER = "Viva-voz"
private const val HANDSET = "Celular"
private const val BLUETOOTH = "Bluetooth"
private const val HOLD = "Espera"
private const val RESUME = "Retomar"
private const val TRANSFER = "Transferir"
private const val TRANSFER_TO = "Transferir para"
private const val TRANSFER_NOW = "Transferir agora"
private const val CONSULT = "Consultar"
private const val COMPLETE_TRANSFER = "Concluir transferência"
private const val SWAP = "Alternar"
private const val JOIN = "Juntar"
private const val SPLIT = "Separar"
private const val CONFERENCE = "Conferência"
private const val NEW_CALL = "Nova ligação"
private const val DIAL = "Ligar"
private const val CALL_FROM = "Ligação de"
private const val NUMBER = "Número"
private const val CANCEL = "Cancelar"
private const val INCOMING = "Ligação recebida"
private const val CALLING = "Chamando…"
private const val CONNECTING = "Conectando…"
private const val ON_HOLD = "Em espera"
private const val ON_HOLD_TRANSFER = "Em espera · transferência"

// O cinza de "Em espera" no cartão da outra ligação, sobre o azul da tela.
private val HeldGray = Color.White.copy(alpha = 0.6f)

// A largura dos botões da fileira de duas ligações (Espera, Transferir, Alternar e Juntar).
private val TWO_CALLS_WIDTH = 72.dp
