package br.com.starsonic.phone.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import br.com.starsonic.phone.service.Dot
import kotlin.math.atan2
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * As cores do visual do Windows (spec 3.1): os tokens fixos e os papéis dos temas claro e escuro, com os valores do
 * windows/ui/src/app.css escritos aqui como lá; o gradient-hero; e a bolinha de cada estado (os .dot do canvas).
 */
class StarsonicColorsTest {
    @Test
    fun `fixed colors are the Windows tokens`() {
        assertCss("cyan", "#00c2cb", Starsonic.Cyan)
        assertCss("cyan-d", "#00a5ad", Starsonic.CyanDark)
        assertCss("blue", "#0c2671", Starsonic.Blue)
        assertCss("blue-2", "#0a1e57", Starsonic.Blue2)
        assertCss("ink", "#0a0e1a", Starsonic.Ink)
        assertCss("muted", "#5b6478", Starsonic.Muted)
        assertCss("line", "#e7eaf2", Starsonic.Line)
        assertCss("soft", "#f5f7fb", Starsonic.Soft)
        assertCss("white", "#ffffff", Starsonic.White)
        assertCss("navy-950", "#070b18", Starsonic.Navy950)
        assertCss("navy-900", "#0a1330", Starsonic.Navy900)
        assertCss("navy-850", "#07143d", Starsonic.Navy850)
        assertCss("navy-800", "#0a1a4d", Starsonic.Navy800)
        assertCss("on-cyan", "#03222a", Starsonic.OnCyan)
        assertCss("danger", "#d64545", Starsonic.Danger)
        assertCss("status-online", "#22c55e", Starsonic.StatusOnline)
        assertCss("dot-off", "#b9c4e6", Starsonic.StatusOff)
        assertCss("ic-warn", "#ffb703", Starsonic.Warning)
        // gradient-hero: linear-gradient(150deg, #070b18 0%, #0a1330 48%, #0c2671 100%), com o brilho ciano no canto.
        val hero = Starsonic.HeroGradient as CssLinearGradient
        assertEquals("gradient-hero: o ângulo", 150f, hero.angle)
        assertEquals("gradient-hero: as posições", listOf(0f, 0.48f, 1f), hero.stops.map { it.first })
        assertCss("gradient-hero 0%", "#070b18", hero.stops[0].second)
        assertCss("gradient-hero 48%", "#0a1330", hero.stops[1].second)
        assertCss("gradient-hero 100%", "#0c2671", hero.stops[2].second)
        assertCss("glow-cyan", "rgba(0, 194, 203, 0.22)", Starsonic.HeroGlow)
    }

    @Test
    fun `light and dark roles match the Windows app`() {
        assertRole("surface", "#ffffff", "#0a1330") { it.surface }
        assertRole("card", "#ffffff", "rgba(255, 255, 255, 0.045)") { it.card }
        assertRole("border", "#e7eaf2", "rgba(255, 255, 255, 0.1)") { it.border }
        assertRole("text-strong", "#0c2671", "#ffffff") { it.textStrong }
        assertRole("text", "#0a0e1a", "#ffffff") { it.text }
        assertRole("text-muted", "#5b6478", "#b9c4e6") { it.textMuted }
        assertRole("accent-text", "#0c2671", "#00c2cb") { it.accentText }
        assertRole("icon", "#0c2671", "#00c2cb") { it.icon }
        assertRole("icon-tile", "rgba(0, 194, 203, 0.14)", "rgba(0, 194, 203, 0.14)") { it.iconTile }
        assertRole("key", "#f5f7fb", "rgba(255, 255, 255, 0.045)") { it.key }
        assertRole("key-border", "#e7eaf2", "rgba(255, 255, 255, 0.1)") { it.keyBorder }
        assertRole("field", "#f5f7fb", "rgba(255, 255, 255, 0.06)") { it.field }
        assertRole("popover", "#ffffff", "#0a1a4d") { it.popover }
        assertRole("pill-on-bg", "#0c2671", "#00c2cb") { it.pillOnBackground }
        assertRole("pill-on-text", "#ffffff", "#03222a") { it.pillOnText }
        assertRole("switch-off", "#c9cfdd", "rgba(255, 255, 255, 0.22)") { it.switchOff }
    }

    @Test
    fun `the hero gradient runs at 150 degrees like the CSS`() {
        // No CSS, a linha do gradiente passa pelo centro da caixa, e as perpendiculares nas pontas dela tocam os cantos:
        // com 150°, o 0% fica no canto de cima à esquerda e o 100%, no de baixo à direita, em qualquer tamanho (o
        // cabeçalho, a barra escura, um quadrado).
        val hero = Starsonic.HeroGradient as CssLinearGradient
        for (size in listOf(Size(390f, 218f), Size(390f, 98f), Size(100f, 100f))) {
            val (start, end) = hero.line(size)
            assertEquals("$size: o canto de cima à esquerda", 0f, along(Offset.Zero, start, end), 1e-4f)
            assertEquals("$size: o canto de baixo à direita", 1f, along(Offset(size.width, size.height), start, end), 1e-4f)
            // 0° aponta para cima e o ângulo cresce no sentido do relógio (o y da tela cresce para baixo).
            val degrees = Math.toDegrees(atan2((end.x - start.x).toDouble(), (start.y - end.y).toDouble()))
            assertEquals("$size: a direção", 150.0, degrees, 1e-3)
        }
    }

    @Test
    fun `each dot state has the canvas color`() {
        // O miolo e o anel de 4 dp (o box-shadow): .dot conectando; .dot-off sem internet, no erro e sem conexão;
        // .dot-busy numa ligação e no Não perturbe; .dot-online conectado.
        assertDot(Dot.CONNECTING, "#00c2cb", "rgba(0, 194, 203, 0.18)")
        for (dot in listOf(Dot.OFFLINE, Dot.ERROR, Dot.NO_CONNECTION)) assertDot(dot, "#b9c4e6", "rgba(185, 196, 230, 0.16)")
        assertDot(Dot.BUSY, "#d64545", "rgba(214, 69, 69, 0.28)")
        assertDot(Dot.ONLINE, "#22c55e", "rgba(34, 197, 94, 0.22)")
    }

    // O papel [role] vale [light] no tema claro e [dark] no escuro.
    private fun assertRole(role: String, light: String, dark: String, of: (StarsonicColors) -> Color) {
        assertCss("$role (claro)", light, of(StarsonicColors.Light))
        assertCss("$role (escuro)", dark, of(StarsonicColors.Dark))
    }

    private fun assertDot(dot: Dot, fill: String, ring: String) {
        val (actualFill, actualRing) = dotColors(dot)
        assertCss("$dot: o miolo", fill, actualFill)
        assertCss("$dot: o anel", ring, actualRing)
    }

    // A cor [css] do app.css ("#rrggbb" ou "rgba(r, g, b, a)") é [actual]: o RGB exato e o alfa a menos de um degrau de
    // 8 bits (a Color do Compose guarda o sRGB em 8 bits por canal).
    private fun assertCss(what: String, css: String, actual: Color) {
        val (rgb, alpha) = parseCss(css)
        assertEquals("$what: o RGB", "#%06x".format(rgb), "#%06x".format(actual.toArgb() and 0xFFFFFF))
        assertEquals("$what: o alfa", alpha, actual.alpha, 1f / 255f)
    }

    private fun parseCss(css: String): Pair<Int, Float> {
        if (css.startsWith("#")) return css.drop(1).toInt(16) to 1f
        val parts = css.removePrefix("rgba(").removeSuffix(")").split(",").map { it.trim() }
        val (red, green, blue) = parts.take(3).map { it.toInt() }
        return ((red shl 16) or (green shl 8) or blue) to parts[3].toFloat()
    }

    // Onde [point] cai na linha de [start] (0) a [end] (1).
    private fun along(point: Offset, start: Offset, end: Offset): Float {
        val line = end - start
        val toPoint = point - start
        return (toPoint.x * line.x + toPoint.y * line.y) / (line.x * line.x + line.y * line.y)
    }
}
