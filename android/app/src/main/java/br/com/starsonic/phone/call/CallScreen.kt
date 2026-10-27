package br.com.starsonic.phone.call

import android.telecom.CallAudioState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import br.com.starsonic.phone.contacts.Contact
import br.com.starsonic.phone.contacts.initials
import br.com.starsonic.phone.contacts.rememberSuggestions
import br.com.starsonic.phone.data.Recent
import br.com.starsonic.phone.main.KEYS
import br.com.starsonic.phone.main.Redial
import br.com.starsonic.phone.main.Suggestions
import br.com.starsonic.phone.service.Status
import br.com.starsonic.phone.ui.CyanButton
import br.com.starsonic.phone.ui.DISABLED_ALPHA
import br.com.starsonic.phone.ui.Eyebrow
import br.com.starsonic.phone.ui.ListRowSub
import br.com.starsonic.phone.ui.ListRowTitle
import br.com.starsonic.phone.ui.OutlineButton
import br.com.starsonic.phone.ui.PlusJakartaSans
import br.com.starsonic.phone.ui.Starsonic
import br.com.starsonic.phone.ui.StarsonicIcons
import br.com.starsonic.phone.ui.StatusDot
import br.com.starsonic.phone.ui.Toast
import java.util.Locale
import kotlin.math.sqrt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * O que a tela de chamada pede (ao CallManager e ao Telecom). Atender e Recusar valem para a recebida que toca (a
 * única, ou a segunda na faixa); Desligar, Espera, Teclado e Transferir (o Transferir agora), para a ativa (na
 * conferência, Desligar desliga as duas); [activate] é o Alternar, e [dial] faz a Nova ligação (false: não ligou),
 * também pelo Rediscar dela. [consult] é o Consultar (false: não ligou), e [completeTransfer] e [cancelConsult], o
 * Concluir transferência e o Cancelar da consulta. [join] e [split] são o Juntar e o Separar da conferência. [suggest] e
 * [contactNumber] dão as sugestões dos contatos no número do Transferir e da Nova ligação (a busca da agenda e a regra
 * dos números dos contatos, como no Teclado).
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
    val suggest: (String) -> List<Contact>,
    val contactNumber: (String) -> String,
)

/**
 * A tela de chamada no visual do Windows (spec 3.2, 3.4 e 7; os quadros Chamada, DuasLigacoes e Recebida do canvas), sempre
 * escura: o gradiente da marca com o brilho ciano no canto de baixo. As medidas são as dos quadros (390 × 844 dp); numa
 * tela mais baixa, as do Compacto do Windows ([CallSizes]); e, se nem assim couber (a letra grande), a tela rola. Com a
 * letra grande nada é cortado (spec 3.3): os selos e os nomes dos cartões quebram em linhas inteiras, e o que fica à direita
 * de um cartão desce para baixo do nome quando não cabe ao lado dele.
 *
 * - No alto (menos na recebida, que tem o título dela), a linha do status ([status]: "Ocupado · em ligação", com a bolinha
 *   vermelha, e o [ramal]; etiqueta `status-ligacao`), porque o cabeçalho fica escondido (spec 7).
 * - Recebida tocando, sozinha (a tela cheia): "Ligação recebida · <ramal>", o avatar com os anéis, o nome e o número e, com o
 *   Atender automático marcado para ela ([CallUi.autoAnswerSeconds]), a linha "Atender automático · em <n> s", que conta os
 *   segundos desde que o celular tocou (etiqueta `atender-em`, R7, R32 e R33); embaixo, Recusar (vermelho) e Atender
 *   (ciano).
 * - Feita ou em andamento: "Em ligação", o avatar com as iniciais (sem nome, o fone), o nome (ou o número), o número e
 *   "Chamando…", "Conectando…" ou o tempo (com o selo "Em espera"); os controles redondos em grade de 3 (o ligado em ciano)
 *   — Mudo, Teclado, o áudio (Viva-voz; ou Celular, Viva-voz e Bluetooth com um fone Bluetooth), Espera (ou Retomar),
 *   Transferir e Nova ligação — e o Desligar vermelho. Uma feita que não completou mostra o motivo ([endMessage], etiqueta
 *   `aviso-ligacao`) no lugar do tempo; com a ligação de pé, o aviso da outra (a em espera que caiu, a Nova ligação que não
 *   completou) aparece por 2 s no alto.
 * - Duas ligações (spec da 0.2, 7.1 e 7.2): "Duas ligações", o cartão da ativa ("Ativa") e o da outra ("Em espera",
 *   etiqueta `cartao-espera`), cada um com o número e o tempo; os controles Mudo, Teclado, o áudio, Alternar, Juntar e
 *   Transferir (e Retomar, se o Telecom pôs as duas em espera). A segunda que chega toca na faixa "Ligação de <nome ou
 *   número>" no alto, com Recusar e Atender. Desligar desliga a ativa (a em espera volta sozinha).
 * - O Transferir abre o número com Consultar e Transferir agora; a Nova ligação, o número com o Rediscar ([redial], a feita
 *   mais nova dos Recentes, com o nome do Rediscar do Teclado: [redialName]; etiqueta `rediscar-nova`, spec 6) e o Ligar.
 *   Os dois números têm as sugestões dos contatos, como o Teclado. O teclado dos tons (DTMF) não tem o Rediscar.
 * - Na consulta (spec da 0.2, 7.3), o colega em cima e o cliente no cartão "Em espera · transferência" (depois do Alternar,
 *   o cliente em cima e o colega "Em espera"), com Concluir transferência (com o colega já atendido), Alternar e Cancelar
 *   no lugar de Espera, Transferir e Nova ligação.
 * - Na conferência (spec da 0.2, 7.4): "Conferência" e o tempo desde o Juntar, os cartões das duas, e Mudo, Teclado, o
 *   áudio, Separar e Desligar (as duas); Separar volta aos dois cartões, com a última que entrou em espera.
 *
 * Os nomes são os do contato do celular quando o número está na agenda (spec da 0.2, 7.5: o CallManager os resolve), senão
 * os que a central mandou; o número embaixo do nome, num ramal (de 2 a 6 dígitos), é "Ramal <n>", como no Windows (R35).
 * Com duas ligações fora da conferência, o leitor de tela chama o Desligar de "Desligar a ligação ativa" (R39). Os botões
 * desligados ficam apagados (0,45, sem sombra: R22).
 */
@Composable
fun CallScreen(
    call: CallUi?,
    endMessage: String,
    routes: AudioRoutes,
    status: Status,
    ramal: String,
    redial: Recent?,
    redialName: String?,
    actions: CallActions,
) {
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
    val alone = active && call.second == null
    val keypad = keypadOpen && active && sameCall
    val transfer = transferOpen && active && sameCall
    val newCall = newCallOpen && alone
    // A Nova ligação fechada por outra ligação (a segunda que chega) não volta sozinha quando ela sai.
    LaunchedEffect(alone) { if (!alone) newCallOpen = false }
    val panel = keypad || transfer || newCall
    // A recebida que toca sozinha é a tela cheia (a que toca com outra é a faixa).
    val incoming = call?.phase == CallPhase.RINGING
    // Os dois cartões (uma em espera, fora da consulta e da conferência): o quadro DuasLigacoes junta tudo a 12 dp.
    val twoCards = call != null && !call.conference && call.second?.kind == SecondKind.HELD && call.consult == null
    // Com duas ligações fora da conferência, o Desligar desliga só a de cima: "Desligar a ligação ativa" (R39, o
    // aria-label do quadro DuasLigacoes). Na conferência ele desliga as duas, e com uma, é só "Desligar".
    val hangUpName = if (call?.second != null && !call.conference) HANG_UP_ACTIVE else null
    BoxWithConstraints(Modifier.fillMaxSize().callBackground().testTag("chamada")) {
        val bars = WindowInsets.systemBars.asPaddingValues()
        val sizes = if (maxHeight - bars.calculateTopPadding() - bars.calculateBottomPadding() < COMPACT_BELOW) Compact else Regular
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars).imePadding()) {
            if (!incoming) CallTop(status, ramal, sizes)
            CallBody(sizes, top = if (incoming) sizes.incomingTop else sizes.bodyTop) {
                // Em cima: quem fala (e a faixa da segunda, os cartões das duas, o cliente da consulta).
                Column(
                    Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(sizes.gap),
                ) {
                    when {
                        call == null -> shown?.let { Ended(it, endMessage, sizes) }
                        incoming -> Incoming(call, ramal, sizes)
                        call.conference -> Conference(call, if (keypad) digits else "", sizes, cards = !panel)
                        twoCards -> TwoCalls(call, call.second, sizes)
                        else -> {
                            val ringing = call.second?.takeIf { it.kind == SecondKind.RINGING }
                            if (ringing != null) SecondCallBar(ringing, actions)
                            val busy = ringing != null || call.consult != null
                            val avatar = !panel && !(busy && sizes == Compact)
                            Talking(
                                call, if (keypad) digits else "", sizes, avatar,
                                top = if (avatar && !busy) sizes.whoTop else 0.dp,
                            )
                            val held = call.second?.takeIf { it.kind == SecondKind.HELD }
                            if (held != null) {
                                // Na consulta com o colega em cima, o cartão é o cliente.
                                val label = if (call.consult?.colleagueActive == true) ON_HOLD_TRANSFER else ON_HOLD
                                HeldCard(held, label)
                            }
                        }
                    }
                }
                // No meio, o que a pessoa abriu: o teclado dos tons ou um número (Transferir e Nova ligação).
                when {
                    call == null -> {}
                    keypad -> CallKeypad(sizes, Modifier.padding(top = sizes.gap)) { key ->
                        digits += key
                        actions.dtmf(key)
                    }
                    transfer -> NumberPanel(
                        TRANSFER_TO, "transferir", actions, Modifier.padding(top = sizes.gap),
                        onCancel = { transferOpen = false }, onDone = null,
                    ) { number ->
                        // O Consultar é a segunda ligação: com duas, não.
                        OutlineButton(
                            CONSULT, tag = "transferir-consultar", enabled = number.isNotBlank() && call.second == null,
                            modifier = Modifier.weight(1f),
                        ) { if (actions.consult(number)) transferOpen = false }
                        CyanButton(
                            TRANSFER_NOW, tag = "transferir-agora", enabled = number.isNotBlank(), fadeWhenDisabled = true,
                            modifier = Modifier.weight(1f),
                        ) { if (actions.transfer(number)) transferOpen = false }
                    }
                    newCall -> {
                        val dial = { number: String -> if (actions.dial(number)) newCallOpen = false }
                        NumberPanel(
                            NEW_CALL, "nova", actions, Modifier.padding(top = sizes.gap),
                            onCancel = { newCallOpen = false }, onDone = dial,
                        ) { number ->
                            // O Rediscar da Nova ligação (spec 6): a feita mais nova, pelo mesmo caminho do Ligar daqui.
                            Redial(
                                redial, redialName, onDial = dial, modifier = Modifier.size(PANEL_BUTTON),
                                tag = "rediscar-nova", background = Color.Transparent,
                            )
                            CyanButton(
                                DIAL, tag = "nova-ligar", icon = StarsonicIcons.Phone, enabled = number.isNotBlank(),
                                fadeWhenDisabled = true, modifier = Modifier.weight(1f),
                            ) { dial(number) }
                        }
                    }
                    else -> {}
                }
                // Embaixo, os controles e o Desligar (ou Recusar e Atender).
                Column(
                    Modifier.fillMaxWidth().padding(top = sizes.gap),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(if (twoCards) minOf(sizes.gap, CARD_GAP) else sizes.gap),
                ) {
                    when {
                        call == null -> Spacer(Modifier.height(sizes.hang + sizes.hangGap + END_LABEL))
                        incoming -> IncomingActions(actions, sizes)
                        keypad -> Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.Bottom,
                        ) {
                            Box(Modifier.width(SIDE_SLOT), contentAlignment = Alignment.Center) {
                                Ctrl(StarsonicIcons.Keypad, KEYPAD, "teclado-chamada", sizes, on = true, toggle = true) {
                                    keypadOpen = false
                                }
                            }
                            HangUp(sizes, actions.hangup, description = hangUpName)
                            Spacer(Modifier.width(SIDE_SLOT))
                        }
                        panel -> HangUp(sizes, actions.hangup, description = hangUpName)
                        else -> {
                            Controls(
                                call, routes, actions, sizes,
                                onKeypad = { keypadOpen = true },
                                onTransfer = { transferOpen = true },
                                onNewCall = { newCallOpen = true },
                            )
                            HangUp(sizes, actions.hangup, Modifier.padding(top = sizes.hangTop), description = hangUpName)
                        }
                    }
                }
            }
        }
        // Com a ligação de pé, o aviso de 2 s da outra ("<nome ou número> desligou", o da Nova ligação, o da transferência
        // recusada), no alto, por cima da tela, como no Windows (.call .toast).
        if (call != null) {
            Toast(
                endMessage,
                tag = "aviso-ligacao",
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(start = 16.dp, top = TOAST_TOP, end = 16.dp),
            )
        }
    }
}

// A última ligação mostrada.
private class LastCall {
    var call: CallUi? = null
}

// As medidas das telas da ligação: as dos quadros do canvas ([Regular]: o .call-body, o .who, os .ctrl, o .hang) e, numa
// tela mais baixa, as do layout Compacto do Windows ([Compact]: windows/ui/src/app.css, .win.call[data-layout="compacto"]).
private data class CallSizes(
    val topPadding: Dp,
    val topSides: Dp,
    val sides: Dp,
    val bodyTop: Dp,
    val bodyBottom: Dp,
    val incomingTop: Dp,
    val gap: Dp,
    val whoTop: Dp,
    val whoGap: Dp,
    val avatar: Dp,
    val avatarLetters: TextUnit,
    val avatarTop: Dp,
    val avatarBottom: Dp,
    val ringTop: Dp,
    val ringBottom: Dp,
    val ring: Dp,
    val name: TextUnit,
    val sub: TextUnit,
    val timer: TextUnit,
    val ctrl: Dp,
    val ctrlGap: Dp,
    val rowGap: Dp,
    val columnGap: Dp,
    val key: Dp,
    val hang: Dp,
    val hangGap: Dp,
    val hangTop: Dp,
)

private val Regular = CallSizes(
    topPadding = 18.dp, topSides = 20.dp, sides = 22.dp, bodyTop = 22.dp, bodyBottom = 30.dp, incomingTop = 58.dp,
    gap = 16.dp, whoTop = 34.dp, whoGap = 6.dp, avatar = 96.dp, avatarLetters = 34.sp, avatarTop = 10.dp,
    avatarBottom = 6.dp, ringTop = 18.dp, ringBottom = 8.dp, ring = 14.dp, name = 28.sp, sub = 14.sp,
    timer = 18.sp, ctrl = 64.dp, ctrlGap = 8.dp, rowGap = 16.dp, columnGap = 10.dp, key = 54.dp, hang = 72.dp,
    hangGap = 8.dp, hangTop = 10.dp,
)

private val Compact = CallSizes(
    topPadding = 12.dp, topSides = 16.dp, sides = 16.dp, bodyTop = 12.dp, bodyBottom = 14.dp, incomingTop = 24.dp,
    gap = 10.dp, whoTop = 4.dp, whoGap = 4.dp, avatar = 64.dp, avatarLetters = 22.sp, avatarTop = 4.dp,
    avatarBottom = 2.dp, ringTop = 12.dp, ringBottom = 6.dp, ring = 10.dp, name = 22.sp, sub = 13.sp,
    timer = 16.sp, ctrl = 52.dp, ctrlGap = 6.dp, rowGap = 10.dp, columnGap = 6.dp, key = 44.dp, hang = 60.dp,
    hangGap = 6.dp, hangTop = 4.dp,
)

// A linha do status no alto (o .call-top do canvas): a bolinha, a linha do status e o ramal à direita, numa linha só
// (com "…" se não couber), lidos juntos pelo leitor de tela.
@Composable
private fun CallTop(status: Status, ramal: String, sizes: CallSizes) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = sizes.topSides, top = sizes.topPadding, end = sizes.topSides)
            .semantics(mergeDescendants = true) {}
            .testTag("status-ligacao"),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusDot(status.dot)
        Text(
            status.line,
            style = TopLine,
            color = Color.White,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Text(ramal, style = TopLine, color = Muted, maxLines = 1)
    }
}

// O corpo da tela (o .call-body): o que vem em cima, o do meio e o de baixo ([content], na ordem; os de baixo trazem o
// espaço mínimo deles em cima), com o espaço que sobra entre eles (o de baixo fica no fim da tela). Sem espaço para tudo
// (a letra grande), ele rola.
@Composable
private fun CallBody(sizes: CallSizes, top: Dp, content: @Composable ColumnScope.() -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight)
                .padding(start = sizes.sides, top = top, end = sizes.sides, bottom = sizes.bodyBottom),
            verticalArrangement = Arrangement.SpaceBetween,
            horizontalAlignment = Alignment.CenterHorizontally,
            content = content,
        )
    }
}

// A ligação que acabou (até a tela fechar): quem era e o motivo do fim, no lugar do tempo.
@Composable
private fun Ended(last: CallUi, message: String, sizes: CallSizes) {
    Who(last.name, last.number, eyebrow = null, avatar = true, sizes) {
        Text(
            message,
            style = EndText,
            color = Color.White,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag("aviso-ligacao"),
        )
    }
}

// A recebida que toca sozinha (o quadro Recebida): o título com o ramal, o avatar com os anéis, o nome e o número e, com
// o Atender automático marcado, a contagem dele.
@Composable
private fun Incoming(call: CallUi, ramal: String, sizes: CallSizes) {
    Who(call.name, call.number, incomingTitle(ramal), avatar = true, sizes, rings = true) {}
    val seconds = call.autoAnswerSeconds
    if (seconds != null) AutoAnswerLine(seconds, call.autoAnswerSinceMillis, Modifier.padding(top = AUTO_LINE_TOP))
}

// A linha do Atender automático (o .tag do quadro Recebida), que conta os segundos (R33): "Atender automático · em <n>
// s", ou "· na hora".
@Composable
private fun AutoAnswerLine(seconds: Int, sinceMillis: Long, modifier: Modifier = Modifier) {
    val now = rememberNow()
    Tag(autoAnswerCountdown(seconds, sinceMillis, now), modifier.testTag("atender-em"))
}

// A ligação de cima, sozinha, com a faixa da segunda ou na consulta: "Em ligação", o avatar ([avatar]), quem é, o estado
// (o tempo) com o selo "Em espera" se ela está em espera, e os dígitos do teclado dos tons ([digits]); [top] acima (o
// margin-top do .who no quadro Chamada).
@Composable
private fun Talking(call: CallUi, digits: String, sizes: CallSizes, avatar: Boolean, top: Dp) {
    Who(call.name, call.number, IN_CALL, avatar, sizes, top = top) {
        Ticking(style = TimerText.copy(fontSize = sizes.timer), color = Starsonic.Cyan) { now ->
            callStatus(call.phase, call.activeSinceMillis, now)
        }
        if (call.held) Tag(ON_HOLD)
        if (digits.isNotEmpty()) Digits(digits)
    }
}

// Quem fala (o .who): o rótulo da seção ([eyebrow]), o avatar ([avatar]: as iniciais do nome, ou o fone sem nome; com
// [rings], os anéis da recebida), o nome (ou o número), o número embaixo (com o nome; um ramal como "Ramal <n>", R35) e o
// que vem depois ([below]).
@Composable
private fun Who(
    name: String,
    number: String,
    eyebrow: String?,
    avatar: Boolean,
    sizes: CallSizes,
    rings: Boolean = false,
    top: Dp = 0.dp,
    below: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().padding(top = top),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(sizes.whoGap),
    ) {
        if (eyebrow != null) Eyebrow(eyebrow, color = Starsonic.Cyan)
        if (avatar) {
            CallAvatar(
                name, sizes.avatar, sizes.avatarLetters,
                Modifier.padding(
                    top = if (rings) sizes.ringTop else sizes.avatarTop,
                    bottom = if (rings) sizes.ringBottom else sizes.avatarBottom,
                ),
                ring = if (rings) sizes.ring else 0.dp,
            )
        }
        Text(name.ifEmpty { number }, style = NameText.copy(fontSize = sizes.name), color = Color.White, textAlign = TextAlign.Center)
        if (name.isNotEmpty()) {
            Text(contactNumberLine(number), style = SubText.copy(fontSize = sizes.sub), color = Muted, textAlign = TextAlign.Center)
        }
        below()
    }
}

// O avatar das telas da ligação (o .avatar no gradiente da marca): as iniciais do nome, ou o fone sem nome; com [ring], os
// dois anéis ciano da recebida (o box-shadow do quadro Recebida: o de [ring] e o de duas vezes ele, mais claro). Enfeite.
@Composable
private fun CallAvatar(name: String, size: Dp, letters: TextUnit, modifier: Modifier = Modifier, ring: Dp = 0.dp) {
    Box(
        modifier
            .then(
                if (ring > 0.dp) {
                    Modifier.drawBehind {
                        val radius = this.size.minDimension / 2
                        drawCircle(Starsonic.Cyan.copy(alpha = 0.06f), radius = radius + ring.toPx() * 30 / 14)
                        drawCircle(Starsonic.Cyan.copy(alpha = 0.12f), radius = radius + ring.toPx())
                    }
                } else {
                    Modifier
                },
            )
            .size(size)
            .clip(CircleShape)
            .background(Starsonic.BrandGradient)
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        if (name.isBlank()) {
            Icon(StarsonicIcons.Phone, contentDescription = null, tint = Color.White, modifier = Modifier.size(size * 0.4f))
        } else {
            Text(initials(name), style = AvatarText.copy(fontSize = letters), color = Color.White, maxLines = 1)
        }
    }
}

// As duas ligações (o quadro DuasLigacoes): o título e o cartão da ativa, em ciano, com o selo "Ativa", e o da outra, com
// "Em espera"; cada um com o número e o tempo.
@Composable
private fun TwoCalls(call: CallUi, held: SecondUi, sizes: CallSizes) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(CARD_GAP)) {
        Eyebrow(TWO_CALLS, color = Starsonic.Cyan, modifier = Modifier.padding(top = if (sizes == Regular) 18.dp else 0.dp))
        CallCard(call.name, call.number, active = true, tag = "cartao-ativa", line = { now ->
            cardLine(call.number, call.name, callStatus(call.phase, call.activeSinceMillis, now))
        }) { Tag(ACTIVE) }
        HeldCard(held, ON_HOLD)
    }
}

// O cartão da outra de duas ligações, em espera ("Em espera", ou "Em espera · transferência" para o cliente da consulta,
// embaixo do nome: o selo comprido não deixaria o nome caber).
@Composable
private fun HeldCard(held: SecondUi, label: String) {
    val time = { now: Long ->
        cardLine(held.number, held.name, if (held.activeSinceMillis > 0) callStatus(CallPhase.ACTIVE, held.activeSinceMillis, now) else "")
    }
    if (label == ON_HOLD) {
        CallCard(held.name, held.number, active = false, tag = "cartao-espera", line = time) { Tag(label, muted = true) }
    } else {
        CallCard(held.name, held.number, active = false, tag = "cartao-espera", line = time, below = { Tag(label, muted = true) })
    }
}

// A conferência (spec da 0.2, 7.4; no Windows, o .who-conf e a .conf-list): "Conferência", o tempo desde o Juntar e os
// dígitos do teclado ([digits]); com [cards], os cartões das duas, com o alto-falante de quem fala.
@Composable
private fun Conference(call: CallUi, digits: String, sizes: CallSizes, cards: Boolean) {
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(sizes.whoGap),
    ) {
        Eyebrow(CONFERENCE, color = Starsonic.Cyan, modifier = Modifier.testTag("conferencia"))
        Ticking(style = TimerText.copy(fontSize = sizes.timer), color = Starsonic.Cyan) { now ->
            callTimer(((now - call.conferenceSinceMillis) / 1000).toInt())
        }
        if (digits.isNotEmpty()) Digits(digits)
    }
    if (cards) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(CARD_GAP)) {
            val parties = listOfNotNull(call.name to call.number, call.second?.let { it.name to it.number })
            for ((name, number) in parties) {
                CallCard(name, number, active = false, tag = "participante", line = { cardLine(number, name, "") }) {
                    Icon(StarsonicIcons.Speaking, contentDescription = null, tint = Starsonic.Cyan, modifier = Modifier.size(20.dp))
                }
            }
        }
    }
}

// A faixa da segunda ligação, que toca (o .vcard-on do Windows): "Ligação de <nome ou número>", o número embaixo (com o
// nome) e os redondos Recusar (vermelho) e Atender (ciano), que valem para ela; o leitor de tela a anuncia.
@Composable
private fun SecondCallBar(ringing: SecondUi, actions: CallActions) {
    CallCard(
        ringing.name, ringing.number, active = true, tag = "segunda-ligacao",
        title = "$CALL_FROM ${ringing.name.ifEmpty { ringing.number }}",
        line = { cardLine(ringing.number, ringing.name, "") },
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        SmallRound(StarsonicIcons.HangUp, REJECT, Starsonic.Danger, Color.White, "recusar-segunda", actions.reject)
        SmallRound(StarsonicIcons.Phone, ANSWER, Starsonic.Cyan, Starsonic.OnCyan, "atender-segunda", actions.answer)
    }
}

// Um cartão de ligação (o .vcard dos quadros): o avatar, o [title] (o nome, ou o número) e a [line] embaixo (com a hora de
// agora: o número e o tempo; sem nada, nenhuma), o [below] e, à direita, o [trailing] (um selo, os botões da faixa);
// [active] é o da ativa (o .vcard-on, ciano). Nada é cortado (spec 3.3): o nome quebra nos espaços, e o [trailing] só fica
// à direita se ao lado dele cabem cada palavra do nome, a linha inteira numa linha só e o [below]; senão (a letra grande,
// uma tela estreita), ele desce para baixo deles, como o "Em espera · transferência" do cartão do cliente.
@Composable
private fun CallCard(
    name: String,
    number: String,
    active: Boolean,
    tag: String,
    modifier: Modifier = Modifier,
    title: String = name.ifEmpty { number },
    line: (Long) -> String,
    below: (@Composable () -> Unit)? = null,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    Layout(
        contents = listOf(
            { CallAvatar(name, CARD_AVATAR, CARD_AVATAR_LETTERS) },
            { Text(title, style = ListRowTitle, color = Color.White) },
            { Ticking(style = ListRowSub, color = Muted, maxLines = Int.MAX_VALUE, text = line) },
            { below?.invoke() },
            {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(CARD_SPACING),
                    verticalAlignment = Alignment.CenterVertically,
                    content = trailing,
                )
            },
        ),
        modifier = modifier
            .fillMaxWidth()
            .clip(CardShape)
            .background(if (active) Starsonic.Cyan.copy(alpha = 0.09f) else Color.White.copy(alpha = 0.045f))
            .border(1.dp, if (active) Starsonic.Cyan.copy(alpha = 0.5f) else Color.White.copy(alpha = 0.1f), CardShape)
            .padding(horizontal = 15.dp, vertical = 13.dp)
            .testTag(tag),
    ) { (avatarSlot, titleSlot, lineSlot, belowSlot, trailingSlot), constraints ->
        val spacing = CARD_SPACING.roundToPx()
        val gap = CARD_LINES.roundToPx()
        val avatar = avatarSlot.single().measure(Constraints())
        val end = trailingSlot.single()
        val endWidth = end.maxIntrinsicWidth(Constraints.Infinity)
        val textMax = (constraints.maxWidth - avatar.width - spacing).coerceAtLeast(0)
        val beside = textMax - (if (endWidth > 0) spacing + endWidth else 0)
        val sideBySide = endWidth == 0 ||
            titleSlot.all { it.minIntrinsicWidth(Constraints.Infinity) <= beside } &&
            lineSlot.all { it.maxIntrinsicWidth(Constraints.Infinity) <= beside } &&
            belowSlot.all { it.minIntrinsicWidth(Constraints.Infinity) <= beside }
        val texts = (titleSlot + lineSlot + belowSlot)
            .map { it.measure(Constraints(maxWidth = if (sideBySide) beside.coerceAtLeast(0) else textMax)) }
        val textsHeight = texts.sumOf { it.height } + gap * (texts.size - 1).coerceAtLeast(0)
        val endPlaceable = end.measure(Constraints(maxWidth = if (sideBySide) constraints.maxWidth else textMax))
        val under = if (sideBySide) 0 else CARD_BELOW.roundToPx() + endPlaceable.height
        val block = textsHeight + under
        val height = maxOf(avatar.height, block, if (sideBySide) endPlaceable.height else 0)
            .coerceIn(constraints.minHeight, constraints.maxHeight)
        val width = constraints.maxWidth
        layout(width, height) {
            val x = avatar.width + spacing
            avatar.placeRelative(0, (height - avatar.height) / 2)
            var y = (height - block) / 2
            for (text in texts) {
                text.placeRelative(x, y)
                y += text.height + gap
            }
            if (sideBySide) {
                endPlaceable.placeRelative(width - endPlaceable.width, (height - endPlaceable.height) / 2)
            } else {
                endPlaceable.placeRelative(x, (height - block) / 2 + textsHeight + CARD_BELOW.roundToPx())
            }
        }
    }
}

// Um selo (o .tag dos quadros): a pílula de 22 dp com o [text] em maiúsculas espaçadas, em ciano (ou, [muted], no cinza do
// "Em espera" do quadro DuasLigacoes). O leitor de tela o lê como está escrito. Com a letra grande, o texto quebra em
// linhas inteiras e centradas, e a pílula cresce com ele, de cantos redondos (spec 3.3: nada cortado).
@Composable
private fun Tag(text: String, modifier: Modifier = Modifier, muted: Boolean = false) {
    val color = if (muted) Muted else Starsonic.Cyan
    Box(
        modifier
            .heightIn(min = 22.dp)
            .background(if (muted) Color.White.copy(alpha = 0.06f) else Starsonic.Cyan.copy(alpha = 0.14f), TagShape)
            .border(1.dp, if (muted) Color.White.copy(alpha = 0.18f) else Starsonic.Cyan.copy(alpha = 0.35f), TagShape)
            .padding(horizontal = 10.dp, vertical = 3.dp)
            .clearAndSetSemantics { this.text = AnnotatedString(text) },
        contentAlignment = Alignment.Center,
    ) {
        Text(text.uppercase(PT_BR), style = TagText, color = color, textAlign = TextAlign.Center)
    }
}

// Os dígitos mandados pelo teclado dos tons (o .dtmf), numa linha só: sem lugar, os últimos.
@Composable
private fun Digits(digits: String) {
    Text(digits, style = DigitsText, color = Color.White, maxLines = 1, overflow = TextOverflow.StartEllipsis)
}

// Um texto que muda com a hora (o tempo da ligação, o dos cartões): [text] com a hora de agora; vazio, nada. Em até
// [maxLines] linhas (o tempo grande, numa só; a linha dos cartões quebra inteira).
@Composable
private fun Ticking(style: TextStyle, color: Color, maxLines: Int = 1, text: (Long) -> String) {
    val shown = text(rememberNow())
    if (shown.isNotEmpty()) Text(shown, style = style, color = color, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}

// A hora de agora, de [TICK_MILLIS] em [TICK_MILLIS] ms (o segundo novo aparece logo); só quem a lê recompõe. A espera é a
// do relógio de verdade, na thread principal (Dispatchers.Main), e não a da composição: nos testes no emulador, a da
// composição só anda quando o teste avança o relógio do Compose, e o tempo pararia.
@Composable
private fun rememberNow(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        withContext(Dispatchers.Main) {
            while (true) {
                now = System.currentTimeMillis()
                delay(TICK_MILLIS)
            }
        }
    }
    return now
}

// Os botões da ligação, em grade de 3 (o .ctrls): Mudo, Teclado e o áudio; depois, com uma ligação só (ou com a faixa da
// segunda), Espera (ou Retomar), Transferir e a Nova ligação (com ela sozinha, em andamento); com duas, Alternar, Juntar e
// Transferir (com as duas em andamento: a feita que chama ainda não alterna nem junta), e Retomar se a de cima está em
// espera (o Telecom pôs as duas: uma ligação da operadora); na consulta, Concluir transferência e Alternar (com o colega
// já atendido) e Cancelar; na conferência, Separar.
@Composable
private fun Controls(
    call: CallUi,
    routes: AudioRoutes,
    actions: CallActions,
    sizes: CallSizes,
    onKeypad: () -> Unit,
    onTransfer: () -> Unit,
    onNewCall: () -> Unit,
) {
    val active = call.phase == CallPhase.ACTIVE
    val other = call.second
    val both = active && other?.kind == SecondKind.HELD   // as duas em andamento
    val hold = CtrlSpec(
        StarsonicIcons.Hold, if (call.held) RESUME else HOLD, "espera", on = call.held, enabled = active, toggle = true,
    ) { actions.hold() }
    val transfer = CtrlSpec(StarsonicIcons.ArrowRight, TRANSFER, "transferir", enabled = active, onClick = onTransfer)
    val swap = CtrlSpec(StarsonicIcons.Swap, SWAP, "alternar", enabled = both, onClick = actions.activate)
    val specs = buildList {
        val mic = if (call.muted) StarsonicIcons.MicOff else StarsonicIcons.Mic
        add(CtrlSpec(mic, MUTE, "mudo", on = call.muted, toggle = true) { actions.mute() })
        add(CtrlSpec(StarsonicIcons.Keypad, KEYPAD, "teclado-chamada", enabled = active, onClick = onKeypad))
        if (routes.bluetoothAvailable) {
            add(CtrlSpec(StarsonicIcons.Phone, HANDSET, "celular", on = !routes.speaker && !routes.bluetooth, toggle = true) {
                actions.route(routes.handsetRoute)
            })
            add(CtrlSpec(StarsonicIcons.Speaker, SPEAKER, "viva-voz", on = routes.speaker, toggle = true) {
                actions.route(CallAudioState.ROUTE_SPEAKER)
            })
            add(CtrlSpec(StarsonicIcons.Bluetooth, BLUETOOTH, "bluetooth", on = routes.bluetooth, toggle = true) {
                actions.route(CallAudioState.ROUTE_BLUETOOTH)
            })
        } else {
            add(CtrlSpec(StarsonicIcons.Speaker, SPEAKER, "viva-voz", on = routes.speaker, toggle = true) {
                actions.route(if (routes.speaker) routes.handsetRoute else CallAudioState.ROUTE_SPEAKER)
            })
        }
        when {
            call.conference -> add(CtrlSpec(StarsonicIcons.Split, SPLIT, "separar", onClick = actions.split))
            call.consult != null -> {
                add(
                    CtrlSpec(
                        StarsonicIcons.Check, COMPLETE_TRANSFER, "concluir-transferencia", enabled = both,
                        onClick = actions.completeTransfer,
                    ),
                )
                add(swap)
                add(CtrlSpec(StarsonicIcons.Close, CANCEL, "cancelar-consulta", onClick = actions.cancelConsult))
            }
            other?.kind == SecondKind.HELD -> {
                add(swap)
                add(CtrlSpec(StarsonicIcons.Join, JOIN, "juntar", enabled = both, onClick = actions.join))
                add(transfer)
                if (call.held) add(hold)
            }
            else -> {
                add(hold)
                add(transfer)
                add(CtrlSpec(StarsonicIcons.Add, NEW_CALL, "nova-ligacao", enabled = active && other == null, onClick = onNewCall))
            }
        }
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(sizes.rowGap)) {
        for (row in specs.chunked(GRID_COLUMNS)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(sizes.columnGap)) {
                for (spec in row) {
                    Ctrl(spec.icon, spec.label, spec.tag, sizes, Modifier.weight(1f), spec.on, spec.enabled, spec.toggle, spec.onClick)
                }
                // A última linha incompleta fica à esquerda, como na grade do CSS.
                repeat(GRID_COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

// Um botão da grade: o ícone, o nome, a etiqueta, se está ligado (o ciano), se vale agora e se é de ligar e desligar.
private class CtrlSpec(
    val icon: ImageVector,
    val label: String,
    val tag: String,
    val on: Boolean = false,
    val enabled: Boolean = true,
    val toggle: Boolean = false,
    val onClick: () -> Unit,
)

// Um botão da ligação (o .ctrl): o círculo de [CallSizes.ctrl] com o ícone (ligado, [on], em ciano com o ícone escuro) e o
// nome embaixo, o toque nos dois; desligado ([enabled] false), apagado (0,45). Os de ligar e desligar ([toggle]: Mudo, o
// áudio, Espera e o Teclado aberto) dizem ao leitor de tela se estão ligados.
@Composable
private fun Ctrl(
    icon: ImageVector,
    label: String,
    tag: String,
    sizes: CallSizes,
    modifier: Modifier = Modifier,
    on: Boolean = false,
    enabled: Boolean = true,
    toggle: Boolean = false,
    onClick: () -> Unit,
) {
    Column(
        modifier
            .alpha(if (enabled) 1f else DISABLED_ALPHA)
            .clip(RoundedCornerShape(12.dp))
            .then(
                if (toggle) {
                    Modifier.toggleable(value = on, enabled = enabled, role = Role.Button, onValueChange = { onClick() })
                } else {
                    Modifier.clickable(enabled = enabled, role = Role.Button, onClick = onClick)
                },
            )
            .testTag(tag),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(sizes.ctrlGap),
    ) {
        Box(
            Modifier
                .size(sizes.ctrl)
                .clip(CircleShape)
                .background(if (on) Starsonic.Cyan else Color.White.copy(alpha = 0.07f))
                .border(1.dp, if (on) Starsonic.Cyan else Color.White.copy(alpha = 0.14f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = if (on) Starsonic.OnCyan else Color.White, modifier = Modifier.size(20.dp))
        }
        Text(label, style = CtrlText, color = Color.White, textAlign = TextAlign.Center)
    }
}

// O Desligar (o .hang do quadro Chamada): o redondo vermelho com o fone virado e o nome embaixo.
@Composable
private fun HangUp(sizes: CallSizes, onClick: () -> Unit, modifier: Modifier = Modifier, description: String? = null) {
    RoundAction(
        StarsonicIcons.HangUp, HANG_UP, "desligar", Starsonic.Danger, Color.White, sizes, HangLabel, modifier,
        description = description, onClick = onClick,
    )
}

// Recusar e Atender da recebida (o quadro Recebida): o vermelho e o ciano, afastados, com os nomes embaixo.
@Composable
private fun IncomingActions(actions: CallActions, sizes: CallSizes) {
    Row(
        Modifier.fillMaxWidth().padding(bottom = if (sizes == Regular) 18.dp else 4.dp),
        horizontalArrangement = Arrangement.SpaceAround,
        verticalAlignment = Alignment.Top,
    ) {
        RoundAction(
            StarsonicIcons.HangUp, REJECT, "recusar", Starsonic.Danger, Color.White, sizes, IncomingLabel,
            gap = sizes.hangGap + 2.dp, onClick = actions.reject,
        )
        RoundAction(
            StarsonicIcons.Phone, ANSWER, "atender", Starsonic.Cyan, Starsonic.OnCyan, sizes, IncomingLabel,
            gap = sizes.hangGap + 2.dp, shadow = true, onClick = actions.answer,
        )
    }
}

// Um botão redondo grande com o nome embaixo (o toque vale nos dois): o círculo de [CallSizes.hang] na cor [background],
// com o ícone de 24 dp; o Atender com a sombra ciano ([shadow]). Sem margem em volta, como o .hang dos quadros, e a
// sombra por fora do recorte do toque (dentro dele, ela saía cortada num retângulo).
@Composable
private fun RoundAction(
    icon: ImageVector,
    label: String,
    tag: String,
    background: Color,
    tint: Color,
    sizes: CallSizes,
    labelStyle: TextStyle,
    modifier: Modifier = Modifier,
    gap: Dp = sizes.hangGap,
    shadow: Boolean = false,
    description: String? = null,
    onClick: () -> Unit,
) {
    Box(modifier, contentAlignment = Alignment.TopCenter) {
        if (shadow) Box(Modifier.size(sizes.hang).dropShadow(CircleShape, CyanShadow))
        Column(
            Modifier
                .clip(RoundedCornerShape(16.dp))
                .clickable(role = Role.Button, onClick = onClick)
                .then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier)
                .testTag(tag),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(gap),
        ) {
            Box(Modifier.size(sizes.hang).clip(CircleShape).background(background), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(24.dp))
            }
            // Com outro nome para o leitor de tela ([description]), o nome embaixo é só o desenho (como o <span> do quadro).
            val shown = if (description != null) Modifier.clearAndSetSemantics {} else Modifier
            Text(label, style = labelStyle, color = Color.White, modifier = shown)
        }
    }
}

// Um redondo pequeno da faixa da segunda (o .round-sm do Windows): 40 dp (o toque, 48), o ícone de 18 e o [label] para o
// leitor de tela.
@Composable
private fun SmallRound(icon: ImageVector, label: String, background: Color, tint: Color, tag: String, onClick: () -> Unit) {
    Box(
        Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(background)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label }
            .testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
    }
}

// O teclado dos tons (as .call-keys do Windows): as 12 teclas em 3 colunas, só com o número (etiquetas dtmf-<tecla>).
@Composable
private fun CallKeypad(sizes: CallSizes, modifier: Modifier = Modifier, onKey: (String) -> Unit) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(sizes.columnGap + 2.dp)) {
        for (row in KEYS) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (key in row) {
                    Box(
                        Modifier
                            .weight(1f)
                            .heightIn(min = sizes.key)
                            .clip(KeyShape)
                            .background(Color.White.copy(alpha = 0.045f))
                            .border(1.dp, Color.White.copy(alpha = 0.1f), KeyShape)
                            .clickable(role = Role.Button) { onKey(key) }
                            .testTag("dtmf-$key"),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(key, style = KeyText, color = Color.White)
                    }
                }
            }
        }
    }
}

// Um número (o .call-panel do Windows) com o [title], o campo, os botões ([buttons], lado a lado, com o número digitado),
// as sugestões dos contatos (as do Teclado; só quando há alguma, embaixo dos botões: com o teclado do Android aberto, a
// tela tem pouco espaço, e os botões nunca saem do lugar por causa delas; um toque preenche o número como ele é discado) e
// Cancelar: para onde a ligação vai (Transferir) ou para quem ligar (Nova ligação). O Concluído do teclado do Android é o
// [onDone] (null: só fecha o teclado). As etiquetas: <tagPrefix>-numero, <tagPrefix>-cancelar e sugestao-<nome>.
@Composable
private fun NumberPanel(
    title: String,
    tagPrefix: String,
    actions: CallActions,
    modifier: Modifier = Modifier,
    onCancel: () -> Unit,
    onDone: ((String) -> Unit)?,
    buttons: @Composable RowScope.(String) -> Unit,
) {
    var number by rememberSaveable { mutableStateOf("") }
    val suggestions = rememberSuggestions(number, actions.suggest, actions.contactNumber)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = PanelTitle, color = Color.White)
        NumberField(number, onChange = { number = it }, tag = "$tagPrefix-numero", onDone = onDone)
        Row(
            Modifier.fillMaxWidth().padding(top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) { buttons(number) }
        if (suggestions.isNotEmpty()) Suggestions(suggestions, onPick = { number = it })
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 40.dp)
                .clip(CircleShape)
                .clickable(role = Role.Button, onClick = onCancel)
                .testTag("$tagPrefix-cancelar"),
            contentAlignment = Alignment.Center,
        ) {
            Text(CANCEL, style = GhostLabel, color = Color.White)
        }
    }
}

// O campo do número (o .call-number do Windows): 52 dp, o fundo dos campos do escuro, o contorno (ciano com o foco), o
// número grande e, vazio, "Número" (o nome dele também para o leitor de tela).
@Composable
private fun NumberField(value: String, onChange: (String) -> Unit, tag: String, onDone: ((String) -> Unit)?) {
    val interactions = remember { MutableInteractionSource() }
    val focused by interactions.collectIsFocusedAsState()
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        textStyle = NumberText.copy(color = Color.White),
        cursorBrush = SolidColor(Starsonic.Cyan),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
        keyboardActions = onDone?.let { done -> KeyboardActions(onDone = { done(value) }) } ?: KeyboardActions.Default,
        interactionSource = interactions,
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = NUMBER }.testTag(tag),
        decorationBox = { input ->
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 52.dp)
                    .clip(FieldShape)
                    .background(Color.White.copy(alpha = 0.06f))
                    .border(1.dp, if (focused) Starsonic.Cyan else Color.White.copy(alpha = 0.14f), FieldShape)
                    .padding(horizontal = 15.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (value.isEmpty()) Text(NUMBER, style = PlaceholderText, color = Muted)
                input()
            }
        },
    )
}

// O fundo da tela da ligação (o .call do canvas): o gradient-hero com o brilho ciano do canto de baixo à esquerda (o
// ::before: o círculo de 520 dp que passa 300 dp da esquerda e 280 dp de baixo, rgba(0, 194, 203, 0.22) no meio, sumindo a
// 62% do raio).
private fun Modifier.callBackground(): Modifier =
    background(Starsonic.HeroGradient).drawWithCache {
        val diameter = 520.dp.toPx()
        val center = Offset(-300.dp.toPx() + diameter / 2, size.height + 280.dp.toPx() - diameter / 2)
        val radius = diameter / 2 * sqrt(2f) * 0.62f
        val glow = Starsonic.HeroGlow
        val brush = Brush.radialGradient(listOf(glow, glow.copy(alpha = 0f)), center = center, radius = radius)
        onDrawBehind { clipRect { drawCircle(brush, radius = radius, center = center) } }
    }

// Abaixo desta altura (sem as barras do Android), as medidas do Compacto: os quadros têm 772 dp entre elas, e a consulta,
// a mais alta, pede uns 750 nas medidas deles.
private val COMPACT_BELOW = 760.dp

// O que fica de lado na última linha com o teclado dos tons aberto (o .call-side do Windows: o Teclado, para fechar).
private val SIDE_SLOT = 80.dp

// A altura do nome embaixo do Desligar (12,5 sp × 1,2), para a tela do fim não mudar de altura.
private val END_LABEL = 15.dp

// O aviso no alto, embaixo da linha do status (.call .toast { top: 44px }).
private val TOAST_TOP = 44.dp

// O espaço entre o nome e a linha do Atender automático (o margin-top do .tag no quadro Recebida).
private val AUTO_LINE_TOP = 14.dp

// O Rediscar ao lado do Ligar do número (o .btn de 48 dp do canvas; no Windows, o .call-panel .btn-redial).
private val PANEL_BUTTON = 48.dp

private const val GRID_COLUMNS = 3
private const val TICK_MILLIS = 250L
private val CARD_GAP = 12.dp
private val CARD_AVATAR = 36.dp
private val CARD_AVATAR_LETTERS = 13.sp
private val CardShape = RoundedCornerShape(18.dp)

// Dentro do cartão: o espaço entre o avatar, os textos e o que fica à direita (o gap do .vcard), entre os textos e o que
// desce para baixo deles (a letra grande, a tela estreita), e entre o nome, a linha e o que vem embaixo deles.
private val CARD_SPACING = 12.dp
private val CARD_BELOW = 6.dp
private val CARD_LINES = 2.dp

// O selo: uma pílula com uma linha (o raio é a metade dos 22 dp), de cantos redondos com mais.
private val TagShape = RoundedCornerShape(11.dp)
private val KeyShape = RoundedCornerShape(18.dp)
private val FieldShape = RoundedCornerShape(14.dp)
private val PT_BR: Locale = Locale.forLanguageTag("pt-BR")

// O cinza claro das linhas de baixo na tela escura (#b9c4e6).
private val Muted = Color(0xFFB9C4E6)

// A sombra do Atender (--shadow-cyan: 0 14px 30px -12px rgba(0, 194, 203, 0.7)).
private val CyanShadow =
    Shadow(radius = 30.dp, color = Starsonic.Cyan.copy(alpha = 0.7f), spread = (-12).dp, offset = DpOffset(0.dp, 14.dp))

private val Base = TextStyle(
    fontFamily = PlusJakartaSans,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

// .call-top e .busy
private val TopLine = Base.copy(fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, lineHeight = 1.3.em)

// .who-name, .who-sub, .timer e .avatar-lg (os tamanhos vêm do CallSizes; o .who-sub e o .timer, sem altura de linha
// no CSS, ficam na "normal" da Plus Jakarta Sans, 1,26)
private val NameText = Base.copy(fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.02).em, lineHeight = 1.12.em)
private val SubText = Base.copy(lineHeight = 1.26.em)
private val TimerText = Base.copy(fontWeight = FontWeight.Bold, letterSpacing = 0.02.em, fontFeatureSettings = "tnum")
private val AvatarText = Base.copy(fontWeight = FontWeight.ExtraBold, lineHeight = 1.em)
private val EndText = Base.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, lineHeight = 1.35.em)

// .ctrl, o nome do .hang e o da recebida
private val CtrlText = Base.copy(fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, lineHeight = 1.2.em)
private val HangLabel = CtrlText
private val IncomingLabel = Base.copy(fontSize = 13.sp, fontWeight = FontWeight.Bold, lineHeight = 1.2.em)

// .tag e .dtmf
private val TagText = Base.copy(fontSize = 10.5.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.12.em, lineHeight = 1.26.em)
private val DigitsText = Base.copy(fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.14.em)

// .call-keys .key b
private val KeyText = Base.copy(fontSize = 23.sp, fontWeight = FontWeight.Bold, lineHeight = 1.em)

// .call-panel-title, .call-number (e o placeholder) e o .btn-ghost-dark
private val PanelTitle = Base.copy(fontSize = 15.sp, fontWeight = FontWeight.Bold, lineHeight = 1.3.em)
private val NumberText = Base.copy(fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.01).em, lineHeight = 1.2.em)
private val PlaceholderText = Base.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, lineHeight = 1.2.em)
private val GhostLabel = Base.copy(fontSize = 15.sp, fontWeight = FontWeight.Bold, lineHeight = 1.em)

private const val ANSWER = "Atender"
private const val REJECT = "Recusar"
private const val HANG_UP = "Desligar"
private const val HANG_UP_ACTIVE = "Desligar a ligação ativa"   // R39: o aria-label do quadro DuasLigacoes
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
private const val IN_CALL = "Em ligação"
private const val TWO_CALLS = "Duas ligações"
private const val ACTIVE = "Ativa"
private const val ON_HOLD = "Em espera"
private const val ON_HOLD_TRANSFER = "Em espera · transferência"
