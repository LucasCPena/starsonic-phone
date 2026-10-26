package br.com.starsonic.phone.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.center
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.LinearGradientShader
import androidx.compose.ui.graphics.Shader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import br.com.starsonic.phone.R
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/**
 * As cores fixas do visual do Windows (spec 3.1): os tokens do design system Starsonic, com os valores exatos do
 * windows/ui/src/app.css. Iguais nos dois temas; o que muda com o tema são os papéis ([StarsonicColors]).
 */
object Starsonic {
    /** `cyan`: a cor da ação (Ligar, as pílulas e as chaves ligadas). */
    val Cyan = Color(0xFF00C2CB)

    /** `cyan-d`. */
    val CyanDark = Color(0xFF00A5AD)

    /** `blue`. */
    val Blue = Color(0xFF0C2671)

    /** `blue-2`. */
    val Blue2 = Color(0xFF0A1E57)

    /** `ink`. */
    val Ink = Color(0xFF0A0E1A)

    /** `muted`. */
    val Muted = Color(0xFF5B6478)

    /** `line`. */
    val Line = Color(0xFFE7EAF2)

    /** `soft`. */
    val Soft = Color(0xFFF5F7FB)

    /** `white`. */
    val White = Color(0xFFFFFFFF)

    /** `navy-950`. */
    val Navy950 = Color(0xFF070B18)

    /** `navy-900`. */
    val Navy900 = Color(0xFF0A1330)

    /** `navy-850`. */
    val Navy850 = Color(0xFF07143D)

    /** `navy-800`. */
    val Navy800 = Color(0xFF0A1A4D)

    /** `on-cyan`: o texto sobre o ciano. */
    val OnCyan = Color(0xFF03222A)

    /** `danger`: o Desligar, o Recusar, a perdida e a bolinha ocupada. */
    val Danger = Color(0xFFD64545)

    /** O verde da bolinha conectada (`status-online`, o mesmo do Windows). */
    val StatusOnline = Color(0xFF22C55E)

    /** O cinza da bolinha sem internet, no erro e sem conexão (`.dot-off`). */
    val StatusOff = Color(0xFFB9C4E6)

    /** O triângulo de atenção do erro no cadastro (`.ic-warn`). */
    val Warning = Color(0xFFFFB703)

    /** `gradient-hero`: linear-gradient(150deg, #070b18 0%, #0a1330 48%, #0c2671 100%), o fundo escuro da marca. */
    val HeroGradient: Brush = CssLinearGradient(150f, listOf(0f to Navy950, 0.48f to Navy900, 1f to Blue))

    /** O brilho ciano do canto do cabeçalho (`glow-cyan`: rgba(0, 194, 203, 0.22) no centro do círculo). */
    val HeroGlow = Cyan.copy(alpha = 0.22f)

    /** `gradient-brand`: linear-gradient(135deg, #00c2cb, #0c2671), o fundo dos avatares. */
    val BrandGradient: Brush = CssLinearGradient(135f, listOf(0f to Cyan, 1f to Blue))
}

/**
 * Os papéis das cores nos temas claro ([Light]) e escuro ([Dark]), os mesmos do app do Windows (os `--surface`,
 * `--card`… do app.css). Os componentes os leem em [LocalStarsonicColors].
 */
@Immutable
data class StarsonicColors(
    /** O fundo das telas. */
    val surface: Color,
    /** O fundo dos cartões. */
    val card: Color,
    /** Os contornos e as linhas entre as partes. */
    val border: Color,
    /** Títulos, o número digitado e as teclas. */
    val textStrong: Color,
    /** O texto corrido. */
    val text: Color,
    /** As linhas de baixo, as ajudas e o que está apagado. */
    val textMuted: Color,
    /** O texto de destaque (o rótulo da seção, os links e a escolha do Tempo para atender). */
    val accentText: Color,
    /** Os ícones das linhas, dos menus e da aba ativa. */
    val icon: Color,
    /** O quadrado atrás do ícone, a pílula da aba ativa e o fundo da sugestão. */
    val iconTile: Color,
    /** O fundo das teclas. */
    val key: Color,
    /** O contorno das teclas. */
    val keyBorder: Color,
    /** O fundo dos campos e da busca. */
    val field: Color,
    /** O fundo do menu aberto. */
    val popover: Color,
    /** O fundo da pílula ligada (os filtros e o Protocolo). */
    val pillOnBackground: Color,
    /** O texto da pílula ligada. */
    val pillOnText: Color,
    /** A chave desligada. */
    val switchOff: Color,
) {
    companion object {
        /** O tema claro (o :root do app.css). */
        val Light = StarsonicColors(
            surface = Starsonic.White,
            card = Starsonic.White,
            border = Starsonic.Line,
            textStrong = Starsonic.Blue,
            text = Starsonic.Ink,
            textMuted = Starsonic.Muted,
            accentText = Starsonic.Blue,
            icon = Starsonic.Blue,
            iconTile = Starsonic.Cyan.copy(alpha = 0.14f),
            key = Starsonic.Soft,
            keyBorder = Starsonic.Line,
            field = Starsonic.Soft,
            popover = Starsonic.White,
            pillOnBackground = Starsonic.Blue,
            pillOnText = Starsonic.White,
            switchOff = Color(0xFFC9CFDD),
        )

        /** O tema escuro (o prefers-color-scheme: dark do app.css). */
        val Dark = StarsonicColors(
            surface = Starsonic.Navy900,
            card = Starsonic.White.copy(alpha = 0.045f),
            border = Starsonic.White.copy(alpha = 0.1f),
            textStrong = Starsonic.White,
            text = Starsonic.White,
            textMuted = Color(0xFFB9C4E6),
            accentText = Starsonic.Cyan,
            icon = Starsonic.Cyan,
            iconTile = Starsonic.Cyan.copy(alpha = 0.14f),
            key = Starsonic.White.copy(alpha = 0.045f),
            keyBorder = Starsonic.White.copy(alpha = 0.1f),
            field = Starsonic.White.copy(alpha = 0.06f),
            popover = Starsonic.Navy800,
            pillOnBackground = Starsonic.Cyan,
            pillOnText = Starsonic.OnCyan,
            switchOff = Starsonic.White.copy(alpha = 0.22f),
        )
    }
}

/** Os papéis do tema de agora ([StarsonicTheme]). */
val LocalStarsonicColors = staticCompositionLocalOf { StarsonicColors.Light }

/** Os papéis são os do tema escuro (o Sobre troca o logo: o principal no claro, o negativo no escuro). */
val StarsonicColors.isDark: Boolean
    get() = this == StarsonicColors.Dark

/**
 * A Plus Jakarta Sans, a letra do Windows (res/font, convertida do PlusJakartaSans-Variable.woff2 do Windows; a licença
 * OFL vai em assets/licencas): um arquivo só, de pesos variáveis, usado nos pesos 400, 500, 600, 700 e 800.
 */
val PlusJakartaSans: FontFamily = FontFamily(
    listOf(FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold, FontWeight.ExtraBold).map { weight ->
        Font(
            R.font.plus_jakarta_sans,
            weight,
            variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
        )
    },
)

/**
 * O tema do app: os papéis do claro ou do escuro ([dark]: o modo do celular; as telas da ligação passam true, porque
 * são sempre escuras) em [LocalStarsonicColors], e a Plus Jakarta Sans. O MaterialTheme embaixo ganha as mesmas cores
 * (os menus, os diálogos e os campos do Material, e as telas que ainda não usam os componentes daqui).
 */
@Composable
fun StarsonicTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalStarsonicColors provides if (dark) StarsonicColors.Dark else StarsonicColors.Light) {
        MaterialTheme(
            colorScheme = if (dark) DarkScheme else LightScheme,
            typography = StarsonicTypography,
            content = content,
        )
    }
}

/**
 * Um linear-gradient do CSS com ângulo: [angle] em graus (0 aponta para cima e cresce no sentido do relógio) e as
 * paradas [stops] (a posição, de 0 a 1, e a cor). Como no CSS, a linha do gradiente passa pelo centro da caixa e as
 * perpendiculares nas pontas dela tocam os cantos ([line]): o 0% e o 100% ficam nos cantos, em qualquer tamanho.
 */
internal class CssLinearGradient(val angle: Float, val stops: List<Pair<Float, Color>>) : ShaderBrush() {
    /** O começo (0%) e o fim (100%) da linha do gradiente numa caixa de [size]. */
    fun line(size: Size): Pair<Offset, Offset> {
        val radians = Math.toRadians(angle.toDouble())
        // A direção na tela, em que o y cresce para baixo.
        val dx = sin(radians).toFloat()
        val dy = -cos(radians).toFloat()
        // O comprimento da linha no CSS: |largura · sen| + |altura · cos|.
        val half = (abs(size.width * dx) + abs(size.height * dy)) / 2f
        val center = size.center
        return Offset(center.x - dx * half, center.y - dy * half) to Offset(center.x + dx * half, center.y + dy * half)
    }

    override fun createShader(size: Size): Shader {
        val (start, end) = line(size)
        return LinearGradientShader(start, end, stops.map { it.second }, stops.map { it.first })
    }

    override fun equals(other: Any?): Boolean = other is CssLinearGradient && other.angle == angle && other.stops == stops

    override fun hashCode(): Int = 31 * angle.hashCode() + stops.hashCode()
}

// As cores do Material saem dos papéis. Os papéis translúcidos (os do escuro) vão compostos sobre o surface: o
// Material pinta os fundos com cores opacas.
private fun StarsonicColors.materialScheme(base: ColorScheme): ColorScheme = base.copy(
    primary = pillOnBackground,
    onPrimary = pillOnText,
    secondary = Starsonic.Cyan,
    onSecondary = Starsonic.OnCyan,
    secondaryContainer = iconTile.compositeOver(surface),
    onSecondaryContainer = icon,
    background = surface,
    onBackground = text,
    surface = surface,
    onSurface = text,
    surfaceVariant = field.compositeOver(surface),
    onSurfaceVariant = textMuted,
    surfaceTint = pillOnBackground,
    surfaceContainerLowest = surface,
    surfaceContainerLow = surface,
    surfaceContainer = popover,
    surfaceContainerHigh = popover,
    surfaceContainerHighest = field.compositeOver(surface),
    outline = textMuted,
    outlineVariant = border.compositeOver(surface),
    error = Starsonic.Danger,
    onError = Starsonic.White,
    scrim = Starsonic.Navy950,
)

private val LightScheme = StarsonicColors.Light.materialScheme(lightColorScheme())
private val DarkScheme = StarsonicColors.Dark.materialScheme(darkColorScheme())

// Os tamanhos do Material, na Plus Jakarta Sans.
private val StarsonicTypography: Typography = Typography().run {
    fun TextStyle.jakarta() = copy(fontFamily = PlusJakartaSans)
    copy(
        displayLarge = displayLarge.jakarta(),
        displayMedium = displayMedium.jakarta(),
        displaySmall = displaySmall.jakarta(),
        headlineLarge = headlineLarge.jakarta(),
        headlineMedium = headlineMedium.jakarta(),
        headlineSmall = headlineSmall.jakarta(),
        titleLarge = titleLarge.jakarta(),
        titleMedium = titleMedium.jakarta(),
        titleSmall = titleSmall.jakarta(),
        bodyLarge = bodyLarge.jakarta(),
        bodyMedium = bodyMedium.jakarta(),
        bodySmall = bodySmall.jakarta(),
        labelLarge = labelLarge.jakarta(),
        labelMedium = labelMedium.jakarta(),
        labelSmall = labelSmall.jakarta(),
    )
}
