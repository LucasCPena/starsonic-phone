package br.com.starsonic.phone.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import br.com.starsonic.phone.R
import br.com.starsonic.phone.service.Dot
import br.com.starsonic.phone.service.Status
import kotlin.math.sqrt

// Os componentes do visual do Windows, nas medidas do canvas aprovado (o app.css do canvas do Android, em que 1 px é
// 1 dp; a classe do CSS de cada um está no KDoc dele), com as cores dos papéis do tema ([LocalStarsonicColors]).
// - As letras ficam em sp e as alturas do canvas são mínimas: com a letra grande do celular, o controle cresce.
// - O toque tem pelo menos 48 dp: num controle que parece menor (as pílulas de 36, a chave de 46 × 28, os redondos de
//   44), o Compose estende o toque até o minimumTouchTargetSize do ViewConfiguration (48 dp), sem mudar o desenho.
// - Os ícones são enfeite, menos os que têm nome (Menu, Voltar e Atenção, aqui).

/**
 * O cabeçalho da marca (o .brand do canvas): o gradiente escuro com o brilho ciano no canto, de ponta a ponta (começa
 * por baixo da barra de status, com a altura dela de respiro a mais em cima), o logo negativo (o do Windows, reduzido a
 * 800 px de largura) à esquerda e o [menu] à direita (o [HeaderMenuButton] com o menu dele). Embaixo, o [content] (o
 * cartão da conta e as pílulas), com 12 dp entre as partes e o texto em branco.
 */
@Composable
fun BrandHeader(menu: @Composable () -> Unit, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    CompositionLocalProvider(LocalContentColor provides Color.White) {
        Column(
            modifier
                .fillMaxWidth()
                .hero(glowSize = 420.dp, glowRight = (-230).dp, glowTop = (-250).dp, glow = Starsonic.HeroGlow)
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(start = 18.dp, top = 14.dp, end = 18.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Image(painterResource(R.drawable.logo_negativo), contentDescription = LOGO, modifier = Modifier.width(160.dp))
                menu()
            }
            content()
        }
    }
}

/** O botão do menu do cabeçalho (o .icon-btn do canvas): redondo, de 44 dp, translúcido, com o ícone "Menu". */
@Composable
fun HeaderMenuButton(modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.06f))
            .border(Hairline, Color.White.copy(alpha = 0.14f), CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .testTag("menu"),
        contentAlignment = Alignment.Center,
    ) {
        Icon(StarsonicIcons.Menu, contentDescription = MENU, tint = Color.White, modifier = Modifier.size(20.dp))
    }
}

/**
 * O cartão da conta no cabeçalho (o .account do canvas): a bolinha, o [ramal] e a linha do [status] (etiqueta `status`) e,
 * no erro do cadastro, o triângulo amarelo "Atenção". A linha fica numa só, com "…" se não couber, menos no erro e no sem
 * conexão (F5): aí ela é o aviso do núcleo, com o conselho no fim ("Confira o endereço e a sua internet", "Fale com o
 * suporte da Starsonic"), e quebra em até [ERROR_LINES] linhas (duas, na letra padrão; o aviso mais longo, inteiro na maior
 * letra numa tela de 360 dp). Fora o 401, o 403 e o 407 (que abrem o Entrar com o aviso), este é o único lugar do app que
 * mostra o aviso.
 */
@Composable
fun AccountCard(status: Status, ramal: String, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(14.dp)
    val warning = status.dot == Dot.ERROR || status.dot == Dot.NO_CONNECTION
    Row(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Color.White.copy(alpha = 0.06f))
            .border(Hairline, Color.White.copy(alpha = 0.12f), shape)
            .padding(horizontal = Hairline + 14.dp, vertical = Hairline + 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusDot(status.dot)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(ramal, style = AccountName, color = Color.White)
            Text(
                status.line,
                style = AccountSub,
                // O cabeçalho é escuro nos dois temas: o cinza claro do escuro.
                color = StarsonicColors.Dark.textMuted,
                maxLines = if (warning) ERROR_LINES else 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.testTag("status"),
            )
        }
        if (status.dot == Dot.ERROR) {
            Icon(StarsonicIcons.Warning, contentDescription = ATTENTION, tint = Starsonic.Warning, modifier = Modifier.size(18.dp))
        }
    }
}

/**
 * A bolinha do status (os .dot do canvas): 10 dp, com o anel de 4 dp em volta (o box-shadow, que não ocupa lugar), nas
 * cores do estado ([dotColors]). É enfeite: a linha ao lado diz o estado.
 */
@Composable
fun StatusDot(dot: Dot, modifier: Modifier = Modifier) {
    val (fill, ring) = dotColors(dot)
    Box(
        modifier
            .size(10.dp)
            .drawBehind {
                drawCircle(ring, radius = size.minDimension / 2 + 4.dp.toPx())
                drawCircle(fill)
            },
    )
}

/**
 * O miolo e o anel da bolinha de [dot]: ciano conectando (.dot); cinza sem internet, no erro e sem conexão (.dot-off);
 * vermelha numa ligação e no Não perturbe (.dot-busy); verde conectada (.dot-online).
 */
internal fun dotColors(dot: Dot): Pair<Color, Color> = when (dot) {
    Dot.CONNECTING -> Starsonic.Cyan to Starsonic.Cyan.copy(alpha = 0.18f)
    Dot.OFFLINE, Dot.ERROR, Dot.NO_CONNECTION -> Starsonic.StatusOff to Starsonic.StatusOff.copy(alpha = 0.16f)
    Dot.BUSY -> Starsonic.Danger to Starsonic.Danger.copy(alpha = 0.28f)
    Dot.ONLINE -> Starsonic.StatusOnline to Starsonic.StatusOnline.copy(alpha = 0.22f)
}

/**
 * Uma pílula do cabeçalho (o .chip do canvas: Não perturbe e Atender automático): 36 dp, contorno branco; ligada
 * ([on]), ciano com o texto escuro. É um botão de ligar e desligar: o leitor de tela diz se está ligada.
 */
@Composable
fun HeaderChip(
    label: String,
    icon: ImageVector,
    on: Boolean,
    tag: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val content = if (on) Starsonic.OnCyan else Color.White
    Row(
        modifier
            .heightIn(min = 36.dp)
            .clip(CircleShape)
            .background(if (on) Starsonic.Cyan else Color.Transparent)
            .border(Hairline, if (on) Starsonic.Cyan else Color.White.copy(alpha = 0.28f), CircleShape)
            .toggleable(value = on, role = Role.Button, onValueChange = { onClick() })
            .testTag(tag)
            .padding(start = Hairline + 12.dp, end = Hairline + 14.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(15.dp))
        Text(label, style = ChipLabel, color = content)
    }
}

/**
 * Uma tecla do Teclado (o .key do canvas): 60 dp de altura, cantos de 18 dp, o [digit] grande e as [letters] embaixo
 * (vazias no 1, no * e no #). O nome da tecla é o número: as letras são enfeite, como no Windows.
 */
@Composable
fun DialKey(digit: String, letters: String, tag: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val colors = LocalStarsonicColors.current
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier
            .heightIn(min = 60.dp)
            .clip(shape)
            .background(colors.key)
            .border(Hairline, colors.keyBorder, shape)
            .clickable(role = Role.Button, onClick = onClick)
            .testTag(tag),
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(digit, style = KeyDigit, color = colors.textStrong)
        Text(
            letters,
            style = KeyLetters,
            color = colors.textMuted,
            modifier = Modifier.heightIn(min = 11.dp).clearAndSetSemantics {},
        )
    }
}

/** A altura, a letra, o ícone e o respiro dos lados de um botão em pílula, nas medidas do canvas. */
enum class ButtonSize(internal val height: Dp, internal val fontSize: TextUnit, internal val iconSize: Dp, internal val padding: Dp) {
    /** O .btn: 48 dp (o Enviar diagnóstico). */
    Regular(48.dp, 15.sp, 16.dp, 22.dp),

    /** O Entrar e o Continuar, mais altos (height: 54px). */
    Large(54.dp, 15.sp, 16.dp, 22.dp),

    /** O Abrir ajustes das Permissões, mais baixo (height: 42px). */
    Small(42.dp, 15.sp, 16.dp, 22.dp),

    /** O Permitir das Permissões (40 dp, 16 dos lados e a letra de 13,5) e os botões das janelas de confirmação. */
    Compact(40.dp, 13.5.sp, 16.dp, 16.dp),

    /** O .btn-call do Ligar: 58 dp, tudo maior. */
    Call(58.dp, 16.sp, 20.dp, 22.dp),
}

/**
 * O botão ciano (o .btn-cyan do canvas: o Ligar, o Entrar e o Continuar), com o texto escuro e a sombra ciano; o
 * [icon] vai antes do texto e o [trailingIcon], depois (a seta do Entrar).
 * Desligado, o do Windows (.btn-cyan:disabled): o ciano escuro (cyan-d), sem a sombra e sem apagar; nas telas da
 * ligação ([fadeWhenDisabled]), também apagado (.call .btn:disabled, R22).
 */
@Composable
fun CyanButton(
    text: String,
    tag: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    trailingIcon: ImageVector? = null,
    enabled: Boolean = true,
    size: ButtonSize = ButtonSize.Regular,
    fadeWhenDisabled: Boolean = false,
    onClick: () -> Unit,
) {
    val container = if (enabled) Starsonic.Cyan else Starsonic.CyanDark
    PillButton(
        text, icon, trailingIcon, tag, enabled, modifier, size, container, Starsonic.OnCyan, null, CyanShadow,
        fadeWhenDisabled, onClick,
    )
}

/** O botão azul (o .btn-blue do canvas: o Permitir), com o texto branco, igual nos dois temas; os ícones como no [CyanButton]. */
@Composable
fun BlueButton(
    text: String,
    tag: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    trailingIcon: ImageVector? = null,
    enabled: Boolean = true,
    size: ButtonSize = ButtonSize.Regular,
    onClick: () -> Unit,
) {
    PillButton(
        text, icon, trailingIcon, tag, enabled, modifier, size, Starsonic.Blue, Starsonic.White, null, null,
        fadeWhenDisabled = true, onClick,
    )
}

/** O botão de contorno (o .btn-outline do canvas: o Enviar diagnóstico e o Abrir ajustes), sem fundo; os ícones como no [CyanButton]. */
@Composable
fun OutlineButton(
    text: String,
    tag: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    trailingIcon: ImageVector? = null,
    enabled: Boolean = true,
    size: ButtonSize = ButtonSize.Regular,
    onClick: () -> Unit,
) {
    val colors = LocalStarsonicColors.current
    val border = BorderStroke(1.5.dp, colors.border)
    PillButton(
        text, icon, trailingIcon, tag, enabled, modifier, size, Color.Transparent, colors.textStrong, border, null,
        fadeWhenDisabled = true, onClick,
    )
}

/**
 * O Rediscar (o .redial do canvas): redondo, de 58 dp, com contorno, à esquerda do Ligar. O [label] ("Rediscar <número>
 * · <nome>", ou só "Rediscar" desligado) é o nome dele no leitor de tela. Desligado ([enabled] false), fica apagado.
 * A etiqueta é `rediscar` (o do Teclado); o da Nova ligação passa o [tag] dele e o fundo dele ([background]: o do
 * painel da ligação, transparente, como o .btn-redial do Windows; o padrão é o surface da tela).
 */
@Composable
fun RedialButton(
    label: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    tag: String = "rediscar",
    background: Color = LocalStarsonicColors.current.surface,
    onClick: () -> Unit,
) {
    val colors = LocalStarsonicColors.current
    Box(
        modifier
            .size(58.dp)
            .alpha(if (enabled) 1f else DISABLED_ALPHA)
            .clip(CircleShape)
            .background(background)
            .border(1.5.dp, colors.border, CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label }
            .testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        Icon(StarsonicIcons.Redial, contentDescription = null, tint = colors.textStrong, modifier = Modifier.size(24.dp))
    }
}

/**
 * O botão redondo de uma linha (o .row-call do canvas: o ligar das linhas do Recentes e dos Contatos, o Editar conta
 * das Configurações): 44 dp, com contorno, e o [icon] de 16 dp na cor dos ícones; [label] é o nome dele no leitor de
 * tela.
 */
@Composable
fun RowIconButton(icon: ImageVector, label: String, tag: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val colors = LocalStarsonicColors.current
    Box(
        modifier
            .size(44.dp)
            .clip(CircleShape)
            .border(1.5.dp, colors.border, CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label }
            .testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = colors.icon, modifier = Modifier.size(16.dp))
    }
}

/**
 * O avatar de um contato (o .avatar do canvas): o círculo de [size] no gradiente da marca, com as [initials] em branco.
 * É enfeite: o nome do contato vem ao lado.
 */
@Composable
fun Avatar(initials: String, modifier: Modifier = Modifier, size: Dp = 36.dp) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(Starsonic.BrandGradient)
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Text(initials, style = AvatarLetters, color = Color.White, maxLines = 1)
    }
}

/**
 * O quadrado de um ícone (o .tile do canvas: as linhas do Sobre e das Permissões): o fundo ciano claro e o [icon] na cor
 * dos ícones, no quadrado de [size] com os cantos de [corner] e o ícone de [iconSize] (40, 12 e 20 do canvas; 36, 11 e
 * 16 no Sobre). É enfeite: o texto ao lado diz o que é.
 */
@Composable
fun IconTile(icon: ImageVector, modifier: Modifier = Modifier, size: Dp = 40.dp, corner: Dp = 12.dp, iconSize: Dp = 20.dp) {
    val colors = LocalStarsonicColors.current
    Box(
        modifier
            .size(size)
            .clip(RoundedCornerShape(corner))
            .background(colors.iconTile),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = colors.icon, modifier = Modifier.size(iconSize))
    }
}

/**
 * Uma linha de lista (o .row do canvas: o Recentes e os Contatos): o [leading] (o quadrado do tipo, o avatar), o
 * [content] (o título em [ListRowTitle] e a linha de baixo em [ListRowSub]) e o [trailing] (o ligar redondo), com a
 * linha embaixo, menos na última da lista ([last]). A linha toda é o botão ([onClick]); a etiqueta é [tag].
 */
@Composable
fun ListRow(
    tag: String,
    last: Boolean,
    onClick: () -> Unit,
    leading: @Composable () -> Unit,
    trailing: @Composable () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalStarsonicColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .testTag(tag)
            .then(if (last) Modifier else Modifier.bottomLine(colors.border))
            .padding(start = 2.dp, top = 10.dp, end = 2.dp, bottom = 10.dp + if (last) 0.dp else Hairline),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        leading()
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp), content = content)
        trailing()
    }
}

/** O título de uma [ListRow] e da sugestão do Teclado (o .row-title do canvas), na cor text-strong. */
val ListRowTitle: TextStyle = TextStyle(
    fontFamily = PlusJakartaSans,
    fontSize = 15.sp,
    fontWeight = FontWeight.Bold,
    lineHeight = 18.75.sp,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

/** A linha de baixo de uma [ListRow] e da sugestão do Teclado (o .row-sub do canvas), na cor text-muted. */
val ListRowSub: TextStyle = ListRowTitle.copy(fontSize = 12.5.sp, fontWeight = FontWeight.Normal, lineHeight = 16.875.sp)

/** O aviso de uma lista vazia (o .empty do Windows): no meio, apagado, 24 dp abaixo do que vem antes. */
@Composable
fun ListEmptyText(text: String, modifier: Modifier = Modifier) {
    val colors = LocalStarsonicColors.current
    Text(
        text,
        style = EmptyLabel,
        color = colors.textMuted,
        textAlign = TextAlign.Center,
        modifier = modifier.fillMaxWidth().padding(top = 24.dp),
    )
}

/**
 * O aviso de 2 s (o .toast do Windows: a caixa escura de cantos de 14 dp, com o texto branco no meio): aparece com
 * [message] não vazio, por cima do que está embaixo (sem empurrar nada), e o leitor de tela o lê na hora. A etiqueta é
 * [tag]; o [modifier] o põe no lugar.
 */
@Composable
fun Toast(message: String, tag: String, modifier: Modifier = Modifier) {
    val rise = with(LocalDensity.current) { 6.dp.roundToPx() }
    AnimatedVisibility(
        visible = message.isNotEmpty(),
        modifier = modifier,
        enter = fadeIn(tween(180)) + slideInVertically(tween(180)) { rise },
        exit = ExitTransition.None,
    ) {
        Text(
            message,
            color = Color.White,
            style = ToastLabel,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .dropShadow(ToastShape, ModalShadow)
                .clip(ToastShape)
                .background(Starsonic.Navy950)
                .border(Hairline, Color.White.copy(alpha = 0.12f), ToastShape)
                .padding(horizontal = Hairline + 15.dp, vertical = Hairline + 10.dp)
                .semantics { liveRegion = LiveRegionMode.Polite }
                .testTag(tag),
        )
    }
}

/**
 * O título de um grupo de uma lista (o .group do canvas: "Hoje" e "Ontem" no Recentes, as letras nos Contatos), em
 * maiúsculas espaçadas, apagado. O leitor de tela o lê como está escrito ([text], sem as maiúsculas) e como um título.
 */
@Composable
fun ListGroupTitle(text: String, modifier: Modifier = Modifier) {
    val colors = LocalStarsonicColors.current
    Text(
        text.uppercase(),
        style = GroupLabel,
        color = colors.textMuted,
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 2.dp, top = 10.dp, end = 2.dp, bottom = 6.dp)
            .clearAndSetSemantics {
                this.text = AnnotatedString(text)
                heading()
            },
    )
}

/**
 * O rótulo de uma seção (o .eyebrow do canvas): o traço ciano e o [text] em maiúsculas, espaçado, na [color] (a do
 * destaque; no cabeçalho escuro do Entrar, o ciano). O leitor de tela o lê como está escrito ([text], sem as
 * maiúsculas) e como um título.
 */
@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier, color: Color = LocalStarsonicColors.current.accentText) {
    Row(
        modifier.clearAndSetSemantics {
            this.text = AnnotatedString(text)
            heading()
        },
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(width = 26.dp, height = 2.dp).background(Starsonic.Cyan, RoundedCornerShape(2.dp)))
        Text(text.uppercase(), style = EyebrowLabel, color = color)
    }
}

/**
 * Um cartão de linhas (o .card do canvas: as seções de Configurações, do Sobre e das Permissões), de cantos de 18 dp, 16
 * dp dos lados e [verticalPadding] em cima e embaixo (4 nos cartões de linhas; 14 no cartão do fabricante, nas
 * Permissões).
 */
@Composable
fun SettingsCard(modifier: Modifier = Modifier, verticalPadding: Dp = 4.dp, content: @Composable ColumnScope.() -> Unit) {
    val colors = LocalStarsonicColors.current
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(colors.card)
            .border(Hairline, colors.border, shape)
            .padding(horizontal = Hairline + 16.dp, vertical = Hairline + verticalPadding),
        content = content,
    )
}

/**
 * Uma linha de um [SettingsCard] (o .set-row do canvas) com o [title] (o .set-title) e a [help] embaixo (o .set-help);
 * o resto como na [SettingRow] de textos livres. Com [onClick], a linha toda é o botão (Sair da conta, Tempo para
 * atender, Permissões e bateria).
 */
@Composable
fun SettingRow(
    title: String,
    tag: String,
    modifier: Modifier = Modifier,
    help: String? = null,
    last: Boolean = false,
    onClick: (() -> Unit)? = null,
    role: Role = Role.Button,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val colors = LocalStarsonicColors.current
    SettingRow(tag, modifier, last, onClick, role, leading, trailing) {
        Text(title, style = SetTitle, color = colors.textStrong)
        if (help != null) Text(help, style = SetHelp, color = colors.textMuted)
    }
}

/**
 * Uma linha de um [SettingsCard] (o .set-row do canvas) com os textos livres do meio ([content], um embaixo do outro, 3
 * dp entre eles: os do Sobre e os avisos das Permissões): pelo menos 56 dp, o [leading] (a bolinha, um ícone, o quadrado
 * do ícone) e o [trailing] (uma chave, a escolha, a seta, um botão). A linha embaixo dela separa da próxima: a última do
 * cartão ([last]) vai sem. Com [onClick], a linha toda é o botão, com o papel [role] para o leitor de tela. O [trailing]
 * fica ao lado dos textos se cada palavra deles cabe ali; com a letra grande, ele desce para baixo deles, e nenhuma palavra
 * quebra no meio ([BesideOrUnder], F4: na 0.2, o Permitir das Permissões vinha embaixo do texto).
 */
@Composable
fun SettingRow(
    tag: String,
    modifier: Modifier = Modifier,
    last: Boolean = false,
    onClick: (() -> Unit)? = null,
    role: Role = Role.Button,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalStarsonicColors.current
    BesideOrUnder(
        spacing = 12.dp,
        underGap = SET_UNDER_GAP,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .then(if (onClick != null) Modifier.clickable(role = role, onClick = onClick) else Modifier)
            .testTag(tag)
            .then(
                if (last) {
                    Modifier
                } else {
                    Modifier.drawBehind {
                        val line = Hairline.toPx()
                        drawRect(colors.border, topLeft = Offset(0f, size.height - line), size = Size(size.width, line))
                    }
                },
            )
            .padding(top = 13.dp, bottom = 13.dp + if (last) 0.dp else Hairline),
        leading = leading,
        trailing = trailing,
    ) {
        Column(
            // Sem o clique na linha, os textos são lidos juntos; com ele, eles são o nome do botão.
            if (onClick == null) Modifier.semantics(mergeDescendants = true) {} else Modifier,
            verticalArrangement = Arrangement.spacedBy(3.dp),
            content = content,
        )
    }
}

/**
 * A chave (o .switch do canvas): 46 × 28 dp, a bolinha branca de 20 dp que corre para a direita e o fundo ciano quando
 * ligada ([checked]). Para o leitor de tela, uma chave com o nome [label].
 */
@Composable
fun StarsonicSwitch(checked: Boolean, label: String, tag: String, modifier: Modifier = Modifier, onChange: (Boolean) -> Unit) {
    val colors = LocalStarsonicColors.current
    // A transição do Windows (160 ms). A posição e a cor são lidas no layout e no desenho: a corrida da bolinha não
    // recompõe a chave a cada quadro.
    val thumb by animateDpAsState(if (checked) 22.dp else 4.dp, tween(160), label = "chave")
    val track by animateColorAsState(if (checked) Starsonic.Cyan else colors.switchOff, tween(160), label = "chave")
    Box(
        modifier
            .size(width = 46.dp, height = 28.dp)
            .clip(CircleShape)
            .drawBehind { drawRect(track) }
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange)
            .semantics { contentDescription = label }
            .testTag(tag),
    ) {
        Box(
            Modifier
                .offset { IntOffset(thumb.roundToPx(), 4.dp.roundToPx()) }
                .size(20.dp)
                .dropShadow(CircleShape, ThumbShadow)
                .background(Color.White, CircleShape),
        )
    }
}

/**
 * A barra escura das telas de dentro (o .bar do canvas: Configurações, Sobre e Permissões): o gradiente com o brilho,
 * de ponta a ponta como o cabeçalho, o Voltar (etiqueta `voltar`) e o [title] (um título para o leitor de tela).
 */
@Composable
fun DarkBar(title: String, modifier: Modifier = Modifier, onBack: () -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .hero(glowSize = 360.dp, glowRight = (-220).dp, glowTop = (-230).dp, glow = Starsonic.Cyan.copy(alpha = 0.2f))
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = 10.dp, top = 14.dp, end = 10.dp, bottom = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // O .ghost: redondo, de 44 dp, sem fundo.
        Box(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .clickable(role = Role.Button, onClick = onBack)
                .testTag("voltar"),
            contentAlignment = Alignment.Center,
        ) {
            Icon(StarsonicIcons.Back, contentDescription = BACK, tint = Color.White, modifier = Modifier.size(24.dp))
        }
        Text(title, style = BarTitle, color = Color.White, modifier = Modifier.weight(1f).semantics { heading() })
    }
}

/**
 * A navegação de baixo (o .nav do canvas): Teclado (0), Recentes (1) e Contatos (2), com as etiquetas aba-teclado,
 * aba-recentes e aba-contatos. A aba [selected] fica na pílula ciano clara e é a escolhida para o leitor de tela;
 * [onSelect] recebe a tocada. Embaixo, o respiro da barra de gestos do Android.
 */
@Composable
fun BottomNav(selected: Int, modifier: Modifier = Modifier, onSelect: (Int) -> Unit) {
    val colors = LocalStarsonicColors.current
    Row(
        modifier
            .fillMaxWidth()
            .background(colors.surface)
            .drawBehind { drawRect(colors.border, size = Size(size.width, Hairline.toPx())) }
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(start = 12.dp, top = Hairline + 8.dp, end = 12.dp, bottom = 10.dp)
            .selectableGroup(),
    ) {
        NavTab(KEYPAD, StarsonicIcons.Keypad, "aba-teclado", selected == 0, Modifier.weight(1f)) { onSelect(0) }
        NavTab(RECENTS, StarsonicIcons.Recents, "aba-recentes", selected == 1, Modifier.weight(1f)) { onSelect(1) }
        NavTab(CONTACTS, StarsonicIcons.Contacts, "aba-contatos", selected == 2, Modifier.weight(1f)) { onSelect(2) }
    }
}

// Uma aba da navegação de baixo (o .tab do canvas): o ícone na pílula de 60 × 32 dp (o toque mostra a onda nela) e o
// nome embaixo, numa linha só (com a letra grande do celular, ele encolhe até caber, em vez de quebrar no meio da
// palavra); a ativa ([on]) em negrito, com a pílula ciano clara.
@Composable
private fun NavTab(label: String, icon: ImageVector, tag: String, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val colors = LocalStarsonicColors.current
    val interactions = remember { MutableInteractionSource() }
    Column(
        modifier
            .selectable(selected = on, interactionSource = interactions, indication = null, role = Role.Tab, onClick = onClick)
            .testTag(tag)
            .padding(vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(width = 60.dp, height = 32.dp)
                .clip(CircleShape)
                .background(if (on) colors.iconTile else Color.Transparent)
                .indication(interactions, LocalIndication.current),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = if (on) colors.icon else colors.textMuted, modifier = Modifier.size(20.dp))
        }
        Text(
            label,
            style = if (on) TabLabel.copy(fontWeight = FontWeight.Bold) else TabLabel,
            color = if (on) colors.textStrong else colors.textMuted,
            textAlign = TextAlign.Center,
            maxLines = 1,
            autoSize = TextAutoSize.StepBased(minFontSize = TAB_LABEL_MIN, maxFontSize = TabLabel.fontSize, stepSize = 0.5.sp),
        )
    }
}

// O .btn do canvas: a pílula de [size] com o [icon] antes do [text] e o [trailingIcon] depois dele (os dois opcionais),
// o respiro de [size] dos lados e 9 dp entre as partes; o [border] fica por dentro (border-box). Desligado, sem a sombra
// e, com [fadeWhenDisabled], apagado (a opacidade do Windows); o ciano desligado troca de cor em vez de apagar
// ([CyanButton]).
@Composable
private fun PillButton(
    text: String,
    icon: ImageVector?,
    trailingIcon: ImageVector?,
    tag: String,
    enabled: Boolean,
    modifier: Modifier,
    size: ButtonSize,
    container: Color,
    content: Color,
    border: BorderStroke?,
    shadow: Shadow?,
    fadeWhenDisabled: Boolean,
    onClick: () -> Unit,
) {
    CompositionLocalProvider(LocalContentColor provides content) {
        Row(
            modifier
                .then(if (shadow != null && enabled) Modifier.dropShadow(CircleShape, shadow) else Modifier)
                .alpha(if (enabled || !fadeWhenDisabled) 1f else DISABLED_ALPHA)
                .heightIn(min = size.height)
                .clip(CircleShape)
                .background(container)
                .then(if (border != null) Modifier.border(border, CircleShape) else Modifier)
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
                .testTag(tag)
                .padding(horizontal = (border?.width ?: 0.dp) + size.padding),
            horizontalArrangement = Arrangement.spacedBy(9.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(size.iconSize))
            Text(text, style = ButtonLabel.copy(fontSize = size.fontSize), textAlign = TextAlign.Center)
            if (trailingIcon != null) Icon(trailingIcon, contentDescription = null, modifier = Modifier.size(size.iconSize))
        }
    }
}

// A linha de 1 dp na cor [color] embaixo do elemento (o border-bottom do canvas; o padding fica por dentro dela).
internal fun Modifier.bottomLine(color: Color): Modifier = drawBehind {
    val line = Hairline.toPx()
    drawRect(color, topLeft = Offset(0f, size.height - line), size = Size(size.width, line))
}

// O fundo escuro da marca (o cabeçalho, as barras escuras e o cabeçalho do Entrar): o gradient-hero com o brilho ciano,
// o círculo de [glowSize] do ::after do canvas, que passa [glowRight] da borda direita e [glowTop] do alto (o right e o
// top do CSS: negativos, para fora da caixa). O brilho é o [glow] no centro e some a 62% do raio (o
// radial-gradient(circle, …) vai até o canto do quadrado do círculo), dentro da caixa (o overflow: hidden).
internal fun Modifier.hero(glowSize: Dp, glowRight: Dp, glowTop: Dp, glow: Color): Modifier =
    background(Starsonic.HeroGradient).drawWithCache {
        val diameter = glowSize.toPx()
        val center = Offset(size.width - glowRight.toPx() - diameter / 2, glowTop.toPx() + diameter / 2)
        val radius = diameter / 2 * sqrt(2f) * 0.62f
        val brush = Brush.radialGradient(listOf(glow, glow.copy(alpha = 0f)), center = center, radius = radius)
        onDrawBehind { clipRect { drawCircle(brush, radius = radius, center = center) } }
    }

// A base das letras do canvas: a Plus Jakarta Sans e a altura da linha do CSS, com o respiro dividido em cima e embaixo.
private val Base = TextStyle(
    fontFamily = PlusJakartaSans,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

// .account-name e .account-sub
private val AccountName = Base.copy(fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 1.2.em)
private val AccountSub = Base.copy(fontSize = 12.5.sp, fontWeight = FontWeight.Medium, lineHeight = 1.3.em)

// As linhas do aviso do núcleo no cartão da conta, no erro e no sem conexão (F5).
private const val ERROR_LINES = 4

// .chip
private val ChipLabel = Base.copy(fontSize = 13.sp, fontWeight = FontWeight.Bold, lineHeight = 1.em)

// .key b e .key small
private val KeyDigit = Base.copy(fontSize = 25.sp, fontWeight = FontWeight.Bold, lineHeight = 1.em)
private val KeyLetters =
    Base.copy(fontSize = 9.5.sp, fontWeight = FontWeight.Bold, lineHeight = 1.2.em, letterSpacing = 0.14.em)

// .btn (o tamanho vem do ButtonSize)
private val ButtonLabel = Base.copy(fontWeight = FontWeight.Bold, lineHeight = 1.em)

// .eyebrow
private val EyebrowLabel = Base.copy(fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.14.em)

// .avatar, .group, .empty e .toast-box
private val AvatarLetters = Base.copy(fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 1.em)
private val GroupLabel = Base.copy(fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.14.em)
private val EmptyLabel = Base.copy(fontSize = 13.5.sp, lineHeight = 1.4.em)
private val ToastLabel = Base.copy(fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, lineHeight = 1.4.em)
private val ToastShape = RoundedCornerShape(14.dp)

// A sombra das caixas por cima da tela (--shadow-modal: 0 40px 100px -30px rgba(7, 11, 24, 0.6)).
private val ModalShadow = Shadow(
    radius = 100.dp,
    color = Starsonic.Navy950.copy(alpha = 0.6f),
    spread = (-30).dp,
    offset = DpOffset(0.dp, 40.dp),
)

// .set-title e .set-help
private val SetTitle = Base.copy(fontSize = 14.5.sp, fontWeight = FontWeight.Bold, lineHeight = 1.3.em)
private val SetHelp = Base.copy(fontSize = 12.5.sp, lineHeight = 1.4.em)

// O espaço entre os textos de uma linha e o controle que desce para baixo deles (com a letra grande, F4).
private val SET_UNDER_GAP = 8.dp

// .bar-title
private val BarTitle = Base.copy(fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.01).em)

// .tab (a ativa, em negrito)
private val TabLabel = Base.copy(fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, lineHeight = 1.2.em)

// O menor tamanho do nome de uma aba quando ele encolhe para caber numa linha.
private val TAB_LABEL_MIN = 8.sp

// O contorno de 1 px do canvas. O CSS é border-box: o padding fica por dentro do contorno.
private val Hairline = 1.dp

/** A opacidade de um controle desligado (a do Windows: .btn-blue:disabled, .btn-redial:disabled, .ctrl:disabled). */
internal const val DISABLED_ALPHA = 0.45f

// A sombra do botão ciano (--shadow-cyan: 0 14px 30px -12px rgba(0, 194, 203, 0.7)).
private val CyanShadow = Shadow(
    radius = 30.dp,
    color = Starsonic.Cyan.copy(alpha = 0.7f),
    spread = (-12).dp,
    offset = DpOffset(0.dp, 14.dp),
)

// A sombra da bolinha da chave (0 1px 3px rgba(7, 11, 24, 0.3)).
private val ThumbShadow = Shadow(radius = 3.dp, color = Starsonic.Navy950.copy(alpha = 0.3f), offset = DpOffset(0.dp, 1.dp))

private const val LOGO = "Starsonic"
private const val MENU = "Menu"
private const val ATTENTION = "Atenção"
private const val BACK = "Voltar"
private const val KEYPAD = "Teclado"
private const val RECENTS = "Recentes"
private const val CONTACTS = "Contatos"
