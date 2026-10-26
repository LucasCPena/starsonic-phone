package br.com.starsonic.phone.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.main.SignOutDialog
import br.com.starsonic.phone.service.Status
import br.com.starsonic.phone.ui.DarkBar
import br.com.starsonic.phone.ui.Eyebrow
import br.com.starsonic.phone.ui.LocalStarsonicColors
import br.com.starsonic.phone.ui.RowIconButton
import br.com.starsonic.phone.ui.SettingRow
import br.com.starsonic.phone.ui.SettingsCard
import br.com.starsonic.phone.ui.Starsonic
import br.com.starsonic.phone.ui.StarsonicIcons
import br.com.starsonic.phone.ui.StatusDot

/**
 * As Configurações (spec 3.3 e 8, o quadro Configuracoes do canvas), abertas pelo menu do cabeçalho: a barra escura com
 * o Voltar ([onBack], como o voltar do Android) e a parte Conta, com a bolinha do [status], o ramal e "servidor ·
 * protocolo" da conta gravada ([account], lida fora da thread principal; null enquanto isso), o Editar conta (o Entrar
 * preenchido, [onEdit]) e o Sair da conta, que pergunta antes ([onSignOut] depois da confirmação). As partes Ligações e
 * Celular vêm na próxima etapa (Task 5).
 */
@Composable
fun SettingsScreen(status: Status, account: Account?, onBack: () -> Unit, onEdit: () -> Unit, onSignOut: () -> Unit) {
    val colors = LocalStarsonicColors.current
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

// O protocolo como a tela Entrar o escreve.
private fun transportLabel(transport: Transport): String = if (transport == Transport.TCP) "TCP" else "UDP"

private const val TITLE = "Configurações"
private const val ACCOUNT = "Conta"
private const val EDIT = "Editar conta"
private const val SIGN_OUT = "Sair da conta"
private const val SIGN_OUT_HELP = "O celular deixa de receber as ligações do ramal."
