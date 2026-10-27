package br.com.starsonic.phone.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import br.com.starsonic.phone.data.AUTO_ANSWER_SECONDS
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.data.CallSettingsStore
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.service.Status
import br.com.starsonic.phone.ui.BlueButton
import br.com.starsonic.phone.ui.ButtonSize
import br.com.starsonic.phone.ui.DarkBar
import br.com.starsonic.phone.ui.DialogText
import br.com.starsonic.phone.ui.Eyebrow
import br.com.starsonic.phone.ui.LocalStarsonicColors
import br.com.starsonic.phone.ui.OutlineButton
import br.com.starsonic.phone.ui.PlusJakartaSans
import br.com.starsonic.phone.ui.Popover
import br.com.starsonic.phone.ui.PopoverOption
import br.com.starsonic.phone.ui.RowIconButton
import br.com.starsonic.phone.ui.SettingRow
import br.com.starsonic.phone.ui.SettingsCard
import br.com.starsonic.phone.ui.Starsonic
import br.com.starsonic.phone.ui.StarsonicDialog
import br.com.starsonic.phone.ui.StarsonicIcons
import br.com.starsonic.phone.ui.StarsonicSwitch
import br.com.starsonic.phone.ui.StatusDot

/**
 * As Configurações (spec 3.3 e 8, os quadros Configuracoes e ConfiguracoesEscuro do canvas), abertas pelo menu do
 * cabeçalho: a barra escura com o Voltar ([onBack], como o voltar do Android) e três partes.
 * - Conta: a bolinha do [status], o ramal e "servidor · protocolo" da conta gravada ([account], lida fora da thread
 *   principal; null enquanto isso), o Editar conta (o Entrar preenchido, [onEdit]) e o Sair da conta, que pergunta antes
 *   ([onSignOut] depois da confirmação).
 * - Ligações: as chaves do bipe no fim da ligação, do Bipe ao digitar (0.2.0-rc.3: o tom de telefone de cada tecla, no
 *   Teclado e no teclado da ligação) e do Atender automático, e o Tempo para atender (as opções do Windows, num menu).
 *   Cada mudança vai para as configurações de ligação ([settings]) na hora (o Bipe ao digitar vale já na próxima tecla, as
 *   outras na próxima ligação) e fica anotada no log de diagnóstico ([note]); as pílulas do cabeçalho mostram as mesmas.
 * - Celular: Permissões e bateria, que abre a tela Permissões ([onPermissions]).
 */
@Composable
fun SettingsScreen(
    status: Status,
    account: Account?,
    settings: CallSettingsStore,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onSignOut: () -> Unit,
    onPermissions: () -> Unit,
    note: (String) -> Unit,
) {
    val colors = LocalStarsonicColors.current
    val current by settings.settings.collectAsState()
    var confirmingSignOut by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(colors.surface)) {
        DarkBar(TITLE, onBack = onBack)
        Column(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(start = 20.dp, top = 18.dp, end = 20.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Eyebrow(ACCOUNT)
            SettingsCard {
                SettingRow(
                    title = account?.ramal.orEmpty(),
                    tag = "config-conta",
                    help = account?.let { "${it.address} · ${transportLabel(it.transport)}" },
                    leading = { StatusDot(status.dot) },
                    trailing = { RowIconButton(StarsonicIcons.Edit, EDIT, tag = "config-editar", onClick = onEdit) },
                )
                SettingRow(
                    title = SIGN_OUT,
                    tag = "config-sair",
                    help = SIGN_OUT_HELP,
                    last = true,
                    onClick = { confirmingSignOut = true },
                    leading = {
                        Icon(StarsonicIcons.SignOut, contentDescription = null, tint = Starsonic.Danger, modifier = Modifier.size(20.dp))
                    },
                )
            }
            // O margin-top de 8 do canvas, além dos 10 entre as partes.
            Eyebrow(CALLS, Modifier.padding(top = 8.dp))
            SettingsCard {
                SettingRow(
                    title = END_BEEP,
                    tag = "config-linha-bipe",
                    help = END_BEEP_HELP,
                    trailing = {
                        StarsonicSwitch(current.endBeep, END_BEEP, tag = "config-bipe") { on ->
                            settings.update { it.copy(endBeep = on) }
                            note("Configurações: o bipe no fim da ligação ${onOrOff(on)}")
                        }
                    },
                )
                SettingRow(
                    title = KEY_TONES,
                    tag = "config-linha-teclas",
                    help = KEY_TONES_HELP,
                    trailing = {
                        StarsonicSwitch(current.keyTones, KEY_TONES, tag = "config-teclas") { on ->
                            settings.update { it.copy(keyTones = on) }
                            note("Configurações: o bipe ao digitar ${onOrOff(on)}")
                        }
                    },
                )
                SettingRow(
                    title = AUTO_ANSWER,
                    tag = "config-linha-atender",
                    help = autoAnswerLine(current.autoAnswerSeconds),
                    trailing = {
                        StarsonicSwitch(current.autoAnswer, AUTO_ANSWER, tag = "config-atender") { on ->
                            settings.update { it.copy(autoAnswer = on) }
                            note("Configurações: o Atender automático ${onOrOff(on)}")
                        }
                    },
                )
                AutoAnswerTime(current.autoAnswerSeconds) { seconds ->
                    settings.update { it.copy(autoAnswerSeconds = seconds) }
                    note("Configurações: o tempo para atender em ${autoAnswerOption(seconds)}")
                }
            }
            Eyebrow(PHONE, Modifier.padding(top = 8.dp))
            SettingsCard {
                SettingRow(
                    title = PERMISSIONS,
                    tag = "config-permissoes",
                    help = PERMISSIONS_HELP,
                    last = true,
                    onClick = onPermissions,
                    trailing = {
                        Icon(
                            StarsonicIcons.ChevronRight,
                            contentDescription = null,
                            tint = colors.textMuted,
                            modifier = Modifier.size(16.dp),
                        )
                    },
                )
            }
        }
    }
    if (confirmingSignOut) {
        SignOutDialog(
            onConfirm = {
                confirmingSignOut = false
                onSignOut()
            },
            onDismiss = { confirmingSignOut = false },
        )
    }
}

// O Tempo para atender (o .select do canvas): a escolha de agora em destaque, com a seta para baixo. Um toque na linha
// abre o menu (o .popover) com as opções do Windows (AUTO_ANSWER_SECONDS: "Na hora" e "<n> s", nesta ordem, etiquetas
// tempo-<n>), a de agora marcada; escolher fecha o menu e chama [onPick].
@Composable
private fun AutoAnswerTime(seconds: Int, onPick: (Int) -> Unit) {
    val colors = LocalStarsonicColors.current
    var open by remember { mutableStateOf(false) }
    SettingRow(
        title = AUTO_ANSWER_TIME,
        tag = "config-tempo",
        last = true,
        role = Role.DropdownList,
        onClick = { open = true },
        trailing = {
            Box {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(autoAnswerOption(seconds), style = SelectValue, color = colors.accentText, maxLines = 1)
                    Icon(StarsonicIcons.ChevronDown, contentDescription = null, tint = colors.accentText, modifier = Modifier.size(16.dp))
                }
                Popover(expanded = open, onDismiss = { open = false }, offset = DpOffset(0.dp, 8.dp)) {
                    Column(Modifier.selectableGroup()) {
                        for (option in AUTO_ANSWER_SECONDS) {
                            PopoverOption(autoAnswerOption(option), selected = option == seconds, tag = "tempo-$option") {
                                open = false
                                onPick(option)
                            }
                        }
                    }
                }
            }
        },
    )
}

/**
 * A confirmação de Sair da conta (a janela do Windows): a conta e a senha saem do celular, e para entrar de novo a
 * pessoa precisa da senha (que, em muitos casos, quem tem é o administrador do PABX). [onConfirm] sai (o Sair, azul,
 * etiqueta sair-confirmar); [onDismiss] fica (o Cancelar, etiqueta sair-cancelar, o voltar do Android e o toque fora).
 */
@Composable
private fun SignOutDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    StarsonicDialog(
        onDismiss = onDismiss,
        title = SIGN_OUT_TITLE,
        buttons = {
            OutlineButton(CANCEL, tag = "sair-cancelar", size = ButtonSize.Compact, onClick = onDismiss)
            BlueButton(SIGN_OUT_CONFIRM, tag = "sair-confirmar", size = ButtonSize.Compact, onClick = onConfirm)
        },
    ) {
        DialogText(SIGN_OUT_TEXT)
    }
}

// O protocolo como a tela Entrar o escreve.
private fun transportLabel(transport: Transport): String = if (transport == Transport.TCP) "TCP" else "UDP"

// O que o log de diagnóstico anota quando uma chave muda.
private fun onOrOff(on: Boolean): String = if (on) "ligado" else "desligado"

// .select
private val SelectValue = TextStyle(
    fontFamily = PlusJakartaSans,
    fontSize = 13.sp,
    fontWeight = FontWeight.Bold,
    lineHeight = 1.3.em,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

private const val TITLE = "Configurações"
private const val ACCOUNT = "Conta"
private const val EDIT = "Editar conta"
private const val SIGN_OUT = "Sair da conta"
private const val SIGN_OUT_HELP = "O celular deixa de receber as ligações do ramal."
private const val CALLS = "Ligações"
private const val END_BEEP = "Bipe quando a ligação cai ou termina"
private const val END_BEEP_HELP = "Vem ligado. Um bipe curto no fone quando a outra pessoa desliga ou a ligação cai."
private const val KEY_TONES = "Bipe ao digitar"
private const val KEY_TONES_HELP = "Vem ligado. Cada tecla faz o bipe de telefone. Com o celular no silencioso, só toca durante a ligação."
private const val AUTO_ANSWER = "Atender automaticamente"
private const val AUTO_ANSWER_TIME = "Tempo para atender"
private const val PHONE = "Celular"
private const val PERMISSIONS = "Permissões e bateria"
private const val PERMISSIONS_HELP = "Notificações, microfone e o uso da bateria, para as ligações chegarem com a tela apagada"
private const val SIGN_OUT_TITLE = "Sair da conta?"
private const val SIGN_OUT_TEXT = "Este celular deixa de receber as ligações do ramal. Para entrar de novo, você vai precisar da senha."
private const val SIGN_OUT_CONFIRM = "Sair"
private const val CANCEL = "Cancelar"
