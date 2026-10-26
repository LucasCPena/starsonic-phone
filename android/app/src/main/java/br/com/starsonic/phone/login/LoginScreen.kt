package br.com.starsonic.phone.login

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import br.com.starsonic.phone.R
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.ui.ButtonSize
import br.com.starsonic.phone.ui.CyanButton
import br.com.starsonic.phone.ui.Eyebrow
import br.com.starsonic.phone.ui.LocalStarsonicColors
import br.com.starsonic.phone.ui.PlusJakartaSans
import br.com.starsonic.phone.ui.Starsonic
import br.com.starsonic.phone.ui.StarsonicIcons
import br.com.starsonic.phone.ui.hero
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * A tela Entrar (spec 3.4 e 4.1, os quadros Entrar e EntrarEscuro do canvas), também a do Editar conta: o cabeçalho
 * escuro da marca com o logo, "Ramal no celular" e "Entre com o seu ramal"; os campos de sempre no visual do Windows (o
 * servidor, o protocolo, o ramal e a senha, com o olho para mostrar); o aviso ou "Conectando…"; o botão Entrar; e, no
 * fim da tela, o telefone de suporte, que abre o discador do celular. Com o teclado do celular aberto, a tela rola.
 */
@Composable
fun LoginScreen(model: LoginViewModel) {
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val colors = LocalStarsonicColors.current
    var showSenha by rememberSaveable { mutableStateOf(false) }
    // O submit espera o motor aceitar a conta: fora da thread principal.
    val submit: () -> Unit = { scope.launch(Dispatchers.IO) { model.submit() } }
    val editable = !state.loading

    BoxWithConstraints(Modifier.fillMaxSize().background(colors.surface).imePadding()) {
        // A coluna tem pelo menos a altura da tela: o telefone de suporte fica no fim dela (o margin: auto 0 0 do canvas);
        // sem espaço (a letra grande, o teclado do celular aberto), ele vem logo depois do Entrar, e a tela rola.
        val screen = maxHeight
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = screen),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Header()
                Column(
                    Modifier.fillMaxWidth().padding(start = 24.dp, top = 22.dp, end = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Field(
                        label = "Servidor (endereço ou IP)",
                        value = state.server,
                        onValueChange = model::onServerChange,
                        tag = "servidor",
                        enabled = editable,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                    )
                    ProtocolField(value = state.transport, enabled = editable, onChange = model::onTransportChange)
                    Field(
                        label = "Ramal",
                        value = state.ramal,
                        onValueChange = model::onRamalChange,
                        tag = "ramal",
                        enabled = editable,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
                    )
                    Field(
                        label = "Senha",
                        value = state.senha,
                        onValueChange = model::onSenhaChange,
                        tag = "senha",
                        enabled = editable,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submit() }),
                        visualTransformation = if (showSenha) VisualTransformation.None else PasswordVisualTransformation(),
                        trailing = { RevealButton(showSenha) { showSenha = !showSenha } },
                    )
                    if (state.loading) {
                        Text("Conectando…", style = NoticeText, color = colors.textMuted)
                    } else if (state.message.isNotEmpty()) {
                        // O aviso embaixo da senha (o .field-error do Windows): o triângulo vermelho e o texto.
                        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            Icon(
                                StarsonicIcons.Warning,
                                contentDescription = null,
                                tint = Starsonic.Danger,
                                modifier = Modifier.padding(top = 1.dp).size(16.dp),
                            )
                            Text(state.message, style = NoticeText, color = colors.text, modifier = Modifier.testTag("aviso"))
                        }
                    }
                    CyanButton(
                        "Entrar",
                        tag = "entrar",
                        trailingIcon = StarsonicIcons.ArrowRight,
                        enabled = editable,
                        size = ButtonSize.Large,
                        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                        onClick = submit,
                    )
                }
            }
            SupportLine(
                Modifier.navigationBarsPadding().padding(start = 24.dp, top = 14.dp, end = 24.dp, bottom = 24.dp),
            ) {
                dialSupport(context)
            }
        }
    }
}

// O cabeçalho escuro da marca (o .brand do quadro Entrar, de ponta a ponta como o da tela principal): o logo negativo
// e, embaixo, "Ramal no celular" em ciano e "Entre com o seu ramal" (um título para o leitor de tela).
@Composable
private fun Header() {
    Column(
        Modifier
            .fillMaxWidth()
            .hero(glowSize = 420.dp, glowRight = (-230).dp, glowTop = (-250).dp, glow = Starsonic.HeroGlow)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = 24.dp, top = 30.dp, end = 24.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Image(painterResource(R.drawable.logo_negativo), contentDescription = "Starsonic", modifier = Modifier.width(190.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Eyebrow(EYEBROW, color = Starsonic.Cyan)
            Text(HEADLINE, style = Headline, color = Color.White, modifier = Modifier.semantics { heading() })
        }
    }
}

// Um campo (o .field do canvas): o rótulo em cima e a caixa de 48 dp (o .input: o fundo dos campos, o contorno, os
// cantos de 12 dp e o texto de 15). Com o foco, o contorno ciano, o anel ciano claro em volta e o fundo da tela (o
// .input-focus). O rótulo fica dentro do campo para o leitor de tela (o nome dele) e para o toque (como o label do
// HTML). O [trailing] vai na ponta direita da caixa (o olho da senha).
@Composable
private fun Field(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    tag: String,
    enabled: Boolean,
    keyboardOptions: KeyboardOptions,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    trailing: (@Composable () -> Unit)? = null,
) {
    val colors = LocalStarsonicColors.current
    val interactions = remember { MutableInteractionSource() }
    val focused by interactions.collectIsFocusedAsState()
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        enabled = enabled,
        singleLine = true,
        textStyle = InputText.copy(color = if (enabled) colors.text else colors.textMuted),
        cursorBrush = SolidColor(Starsonic.Cyan),
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        visualTransformation = visualTransformation,
        interactionSource = interactions,
        modifier = Modifier.fillMaxWidth().testTag(tag),
        decorationBox = { input ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(label, style = FieldLabel, color = colors.textStrong)
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .then(if (focused) Modifier.focusRing() else Modifier)
                        .clip(InputShape)
                        .background(if (focused) colors.surface else colors.field)
                        .border(1.dp, if (focused) Starsonic.Cyan else colors.border, InputShape)
                        .padding(start = 15.dp, end = if (trailing != null) 5.dp else 15.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.weight(1f)) { input() }
                    trailing?.invoke()
                }
            }
        },
    )
}

// O Protocolo (o .seg do canvas): o rótulo e a pílula com UDP e TCP lado a lado, o escolhido na pílula ligada
// (etiquetas protocolo, protocolo-udp e protocolo-tcp); para o leitor de tela, duas opções, uma escolhida.
@Composable
private fun ProtocolField(value: Transport, enabled: Boolean, onChange: (Transport) -> Unit) {
    val colors = LocalStarsonicColors.current
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Protocolo", style = FieldLabel, color = colors.textStrong)
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .clip(CircleShape)
                .background(colors.field)
                .border(1.dp, colors.border, CircleShape)
                .padding(5.dp)
                .selectableGroup()
                .testTag("protocolo"),
        ) {
            for (option in Transport.entries) {
                val on = option == value
                Box(
                    Modifier
                        .weight(1f)
                        .heightIn(min = 38.dp)
                        .clip(CircleShape)
                        .background(if (on) colors.pillOnBackground else Color.Transparent)
                        .selectable(selected = on, enabled = enabled, role = Role.RadioButton) { onChange(option) }
                        .testTag("protocolo-${option.name.lowercase()}"),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(option.name, style = SegmentText, color = if (on) colors.pillOnText else colors.textMuted)
                }
            }
        }
    }
}

// O olho da senha (o .ghost de 40 dp do quadro, dentro da caixa): mostra ou esconde a senha; o nome diz o que ele faz.
@Composable
private fun RevealButton(showing: Boolean, onClick: () -> Unit) {
    val colors = LocalStarsonicColors.current
    val label = if (showing) "Esconder a senha" else "Mostrar a senha"
    Box(
        Modifier
            .size(40.dp)
            .clip(CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (showing) StarsonicIcons.EyeOff else StarsonicIcons.Eye,
            contentDescription = null,
            tint = colors.textMuted,
            modifier = Modifier.size(16.dp),
        )
    }
}

// "Precisa de ajuda? (11) 5060-3000" no fim da tela, com o número no destaque (o .link): o toque abre o discador. A
// linha parece baixa, mas o toque tem 48 dp (o Compose o estende).
@Composable
private fun SupportLine(modifier: Modifier, onClick: () -> Unit) {
    val colors = LocalStarsonicColors.current
    val text = buildAnnotatedString {
        append(SUPPORT_QUESTION)
        withStyle(SpanStyle(color = colors.accentText, fontWeight = FontWeight.Bold)) { append(SUPPORT_PHONE) }
    }
    Text(
        text,
        style = SupportText,
        color = colors.textMuted,
        textAlign = TextAlign.Center,
        modifier = modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick),
    )
}

// O anel do campo com o foco (o box-shadow 0 0 0 4px rgba(0, 194, 203, 0.14) do .input-focus), por fora da caixa.
private fun Modifier.focusRing(): Modifier = drawBehind {
    val ring = 4.dp.toPx()
    drawRoundRect(
        Starsonic.Cyan.copy(alpha = 0.14f),
        topLeft = Offset(-ring, -ring),
        size = Size(size.width + 2 * ring, size.height + 2 * ring),
        cornerRadius = CornerRadius(12.dp.toPx() + ring),
    )
}

/** Abre o discador do celular com o telefone de suporte (sem ligar). */
private fun dialSupport(context: Context) {
    try {
        context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse(SUPPORT_NUMBER)))
    } catch (e: ActivityNotFoundException) {
        // Sem discador (alguns tablets): nada a fazer.
    }
}

private val InputShape = RoundedCornerShape(12.dp)

private val Base = TextStyle(
    fontFamily = PlusJakartaSans,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

// O .h1 do quadro (25, 800, -0.02em, altura 1,12), o .label, o .input, o .seg, o aviso (o .field-error) e a ajuda.
private val Headline = Base.copy(fontSize = 25.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.02).em, lineHeight = 1.12.em)
private val FieldLabel = Base.copy(fontSize = 12.5.sp, fontWeight = FontWeight.Bold, lineHeight = 1.3.em)
private val InputText = Base.copy(fontSize = 15.sp, lineHeight = 1.3.em)
private val SegmentText = Base.copy(fontSize = 14.sp, fontWeight = FontWeight.Bold, lineHeight = 1.3.em)
private val NoticeText = Base.copy(fontSize = 13.sp, fontWeight = FontWeight.SemiBold, lineHeight = 1.35.em)
private val SupportText = Base.copy(fontSize = 14.sp, lineHeight = 1.4.em)

private const val EYEBROW = "Ramal no celular"
private const val HEADLINE = "Entre com o seu ramal"

// "Precisa de ajuda? (11) 5060-3000", o texto de sempre, com o número em destaque.
private const val SUPPORT_QUESTION = "Precisa de ajuda? "
private const val SUPPORT_PHONE = "(11) 5060-3000"
private const val SUPPORT_NUMBER = "tel:+551150603000"
