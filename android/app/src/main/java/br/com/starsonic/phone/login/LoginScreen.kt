package br.com.starsonic.phone.login

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import br.com.starsonic.phone.R
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.main.StarsonicBlue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

private const val SUPPORT_TEXT = "Precisa de ajuda? (11) 5060-3000"
private const val SUPPORT_NUMBER = "tel:+551150603000"

/**
 * A tela Entrar (spec 4.1): o logo no cartão branco; o servidor com o protocolo ao lado; o ramal; a senha
 * (com o olho para mostrar); o botão Entrar; e o telefone de suporte, que abre o discador do celular.
 */
@Composable
fun LoginScreen(model: LoginViewModel) {
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var showSenha by rememberSaveable { mutableStateOf(false) }
    // O submit espera o motor aceitar a conta: fora da thread principal.
    val submit: () -> Unit = { scope.launch(Dispatchers.IO) { model.submit() } }
    val editable = !state.loading

    Column(
        Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState()),
    ) {
        Header()
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 24.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = state.server,
                    onValueChange = model::onServerChange,
                    label = { Text("Servidor (endereço ou IP)") },
                    singleLine = true,
                    enabled = editable,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                    modifier = Modifier.weight(1f).testTag("servidor"),
                )
                ProtocolField(
                    value = state.transport,
                    enabled = editable,
                    onChange = model::onTransportChange,
                    modifier = Modifier.width(112.dp),
                )
            }
            OutlinedTextField(
                value = state.ramal,
                onValueChange = model::onRamalChange,
                label = { Text("Ramal") },
                singleLine = true,
                enabled = editable,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth().testTag("ramal"),
            )
            OutlinedTextField(
                value = state.senha,
                onValueChange = model::onSenhaChange,
                label = { Text("Senha") },
                singleLine = true,
                enabled = editable,
                visualTransformation = if (showSenha) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }),
                trailingIcon = {
                    IconButton(onClick = { showSenha = !showSenha }) {
                        Icon(
                            painter = painterResource(if (showSenha) R.drawable.ic_senha_esconder else R.drawable.ic_senha_mostrar),
                            contentDescription = if (showSenha) "Esconder a senha" else "Mostrar a senha",
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth().testTag("senha"),
            )
            if (state.loading) {
                Text("Conectando…", style = MaterialTheme.typography.bodyMedium)
            } else if (state.message.isNotEmpty()) {
                Text(
                    text = state.message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag("aviso"),
                )
            }
            Button(onClick = submit, enabled = editable, modifier = Modifier.fillMaxWidth().testTag("entrar")) {
                Text("Entrar")
            }
            TextButton(onClick = { dialSupport(context) }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text(SUPPORT_TEXT)
            }
        }
    }
}

/** O logo completo (branding/logo-entrar.png) no cartão branco, sobre o azul que fica atrás da barra de status. */
@Composable
private fun Header() {
    Box(
        Modifier
            .fillMaxWidth()
            .background(StarsonicBlue)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Card(shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = Color.White)) {
            Image(
                painter = painterResource(R.drawable.logo_entrar),
                contentDescription = "Starsonic",
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            )
        }
    }
}

/** O campo Protocolo: mostra UDP ou TCP, e um toque abre o menu com os dois. */
@Composable
private fun ProtocolField(value: Transport, enabled: Boolean, onChange: (Transport) -> Unit, modifier: Modifier) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedTextField(
            value = value.name,
            onValueChange = {},
            readOnly = true,
            singleLine = true,
            enabled = enabled,
            label = { Text("Protocolo") },
            trailingIcon = { Icon(painter = painterResource(R.drawable.ic_seta_menu), contentDescription = null) },
            modifier = Modifier.fillMaxWidth(),
        )
        // O campo só mostra o protocolo; o toque em qualquer ponto dele abre o menu.
        Box(
            Modifier
                .matchParentSize()
                .clickable(enabled = enabled) { open = true }
                .testTag("protocolo"),
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Transport.entries.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.name) },
                    onClick = {
                        open = false
                        onChange(option)
                    },
                )
            }
        }
    }
}

/** Abre o discador do celular com o telefone de suporte (sem ligar). */
private fun dialSupport(context: Context) {
    try {
        context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse(SUPPORT_NUMBER)))
    } catch (e: ActivityNotFoundException) {
        // Sem discador (alguns tablets): nada a fazer.
    }
}
