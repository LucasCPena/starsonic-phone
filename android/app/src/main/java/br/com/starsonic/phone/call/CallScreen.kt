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
import androidx.compose.ui.unit.dp
import br.com.starsonic.phone.R
import br.com.starsonic.phone.main.CallGreen
import br.com.starsonic.phone.main.CallRed
import br.com.starsonic.phone.main.Keypad
import br.com.starsonic.phone.main.StarsonicBlue
import br.com.starsonic.phone.main.StarsonicCyan
import br.com.starsonic.phone.main.duration
import kotlinx.coroutines.delay

/** O que a tela de chamada pede (ao CallManager e ao Telecom). */
class CallActions(
    val answer: () -> Unit,
    val reject: () -> Unit,
    val hangup: () -> Unit,
    val mute: () -> Unit,
    val hold: () -> Unit,
    val dtmf: (String) -> Unit,
    val transfer: (String) -> Boolean,
    val route: (Int) -> Unit,
)

/**
 * A tela de chamada (spec 4.1 e 7.5). Recebida tocando: o número (e o nome, se o PABX mandou), Recusar e
 * Atender. Feita ou em andamento: o número, "Chamando…" ou o tempo, Mudo, Teclado (DTMF), Viva-voz (ou a escolha
 * Celular, Viva-voz e Bluetooth com um fone Bluetooth), Espera ou Retomar, Transferir (o número para onde a
 * ligação passa) e Desligar. Uma feita que não completou mostra o motivo ([endMessage]) com o número.
 */
@Composable
fun CallScreen(call: CallUi?, endMessage: String, routes: AudioRoutes, actions: CallActions) {
    // Depois do fim, a tela mostra a última ligação com o aviso, até sair (não é estado: só lembra).
    val last = remember { LastCall() }
    if (call != null) last.call = call
    val shown = call ?: last.call
    var keypadOpen by rememberSaveable { mutableStateOf(false) }
    var transferOpen by rememberSaveable { mutableStateOf(false) }
    var digits by rememberSaveable { mutableStateOf("") }
    // O teclado e a transferência só valem com a ligação em andamento.
    val active = call?.phase == CallPhase.ACTIVE
    val keypad = keypadOpen && active
    val transfer = transferOpen && active
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
        Header(shown, call, endMessage, if (keypad) digits else "")
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
                transfer -> TransferPanel(
                    onCancel = { transferOpen = false },
                    onTransfer = { number -> if (actions.transfer(number)) transferOpen = false },
                )
                else -> Controls(call, routes, actions, onKeypad = { keypadOpen = true }, onTransfer = { transferOpen = true })
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
    }
}

// O estado: "Ligação recebida", "Chamando…", "Conectando…" ou o tempo (e "Em espera").
@Composable
private fun status(call: CallUi): String = when (call.phase) {
    CallPhase.RINGING -> INCOMING
    CallPhase.DIALING -> CALLING
    CallPhase.CONNECTING -> CONNECTING
    CallPhase.ACTIVE -> {
        var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
        LaunchedEffect(call.activeSinceMillis) {
            while (true) {
                now = System.currentTimeMillis()
                delay(1_000)
            }
        }
        val time = duration(((now - call.activeSinceMillis) / 1000).toInt().coerceAtLeast(0))
        if (call.held) "$time · $ON_HOLD" else time
    }
}

// Os botões da ligação: Mudo, Teclado e o áudio; Espera (ou Retomar) e Transferir.
@Composable
private fun Controls(call: CallUi, routes: AudioRoutes, actions: CallActions, onKeypad: () -> Unit, onTransfer: () -> Unit) {
    val active = call.phase == CallPhase.ACTIVE
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
            Toggle(R.drawable.ic_espera, if (call.held) RESUME else HOLD, call.held, active, "espera", actions.hold)
            Toggle(R.drawable.ic_transferir, TRANSFER, false, active, "transferir", onTransfer)
        }
    }
}

// O número para onde a ligação vai, com Transferir e Cancelar.
@Composable
private fun TransferPanel(onCancel: () -> Unit, onTransfer: (String) -> Unit) {
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
        Text(TRANSFER_TO, color = Color.White, style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = number,
            onValueChange = { number = it },
            label = { Text(NUMBER) },
            singleLine = true,
            colors = colors,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            keyboardActions = KeyboardActions(onDone = { onTransfer(number) }),
            modifier = Modifier.fillMaxWidth().testTag("transferir-numero"),
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            TextButton(onClick = onCancel, modifier = Modifier.testTag("transferir-cancelar")) {
                Text(CANCEL, color = Color.White)
            }
            Button(
                onClick = { onTransfer(number) },
                enabled = number.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = StarsonicCyan, contentColor = Color.White),
                modifier = Modifier.testTag("transferir-confirmar"),
            ) {
                Text(TRANSFER)
            }
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
    val alpha = if (enabled) 1f else 0.4f
    Column(
        Modifier
            .width(80.dp)
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
private const val NUMBER = "Número"
private const val CANCEL = "Cancelar"
private const val INCOMING = "Ligação recebida"
private const val CALLING = "Chamando…"
private const val CONNECTING = "Conectando…"
private const val ON_HOLD = "Em espera"
