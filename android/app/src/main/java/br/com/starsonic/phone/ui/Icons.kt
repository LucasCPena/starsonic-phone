package br.com.starsonic.phone.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathData
import androidx.compose.ui.graphics.vector.PathNode
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * Os ícones de linha do canvas (os SVG de 24 × 24 do app do Windows: traço de 2, pontas e cantos redondos), com os
 * caminhos copiados dos quadros, para o Icon, que os pinta na cor de cada lugar (o tint). Cada um diz onde o canvas o
 * usa. São enfeite (contentDescription null), menos os que têm nome: Menu, Apagar, Voltar, Editar conta e Atenção.
 */
object StarsonicIcons {
    /** Os dois controles deslizantes: o Menu do cabeçalho e Configurações no menu. */
    val Menu: ImageVector by lazy {
        lineIcon("Menu", path("M4 7h10M18 7h2M4 17h4M12 17h8"), circle(16f, 7f, 2f), circle(10f, 17f, 2f))
    }

    /** O círculo com o traço: Não perturbe. */
    val DoNotDisturb: ImageVector by lazy { lineIcon("DoNotDisturb", circle(12f, 12f, 9f), path("M8 12h8")) }

    /** A seta para baixo e a esquerda: Atender automático, e a recebida e a perdida no Recentes. */
    val Incoming: ImageVector by lazy { lineIcon("Incoming", path("M17 7L7 17"), path("M15 17H7V9")) }

    /** A seta para cima e a direita: a feita no Recentes. */
    val Outgoing: ImageVector by lazy { lineIcon("Outgoing", path("M7 17L17 7"), path("M9 7h8v8")) }

    /** O apagar do número no Teclado (Apagar). */
    val Erase: ImageVector by lazy {
        lineIcon("Erase", path("M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"), path("M17 9l-5 5M12 9l5 5"))
    }

    /** A seta para a direita: a sugestão do Teclado, o Entrar e o Transferir. */
    val ArrowRight: ImageVector by lazy { lineIcon("ArrowRight", path("M5 12h14"), path("M13 6l6 6-6 6")) }

    /** A volta: Rediscar. */
    val Redial: ImageVector by lazy { lineIcon("Redial", path("M3 12a9 9 0 1 0 2.6-6.4"), path("M3 4v5h5")) }

    /** O fone: o Ligar, o ligar das linhas, o Atender e o Sobre. */
    val Phone: ImageVector by lazy { lineIcon("Phone", path(PHONE)) }

    /** O fone virado (135°, o .hang do canvas): Desligar e Recusar. */
    val HangUp: ImageVector by lazy { lineIcon("HangUp", path(PHONE), rotate = 135f) }

    /** As nove teclas: a aba Teclado e o teclado da ligação. */
    val Keypad: ImageVector by lazy {
        val keys = listOf(5f, 11f, 17f).flatMap { y -> listOf(6f, 12f, 18f).map { x -> circle(x, y, 1.3f) } }
        lineIcon("Keypad", *keys.toTypedArray())
    }

    /** O relógio: a aba Recentes. */
    val Recents: ImageVector by lazy { lineIcon("Recents", circle(12f, 12f, 9f), path("M12 7v5l3 2")) }

    /** As duas pessoas: a aba Contatos. */
    val Contacts: ImageVector by lazy {
        lineIcon(
            "Contacts",
            circle(9f, 8f, 3.5f),
            path("M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"),
            path("M16 4.5a3.5 3.5 0 0 1 0 7"),
            path("M18 14c2 .7 3 2.8 3 6"),
        )
    }

    /** A lupa: a busca dos Contatos. */
    val Search: ImageVector by lazy { lineIcon("Search", circle(11f, 11f, 7f), path("M20 20l-3.5-3.5")) }

    /** A seta para a esquerda: Voltar, na barra escura. */
    val Back: ImageVector by lazy { lineIcon("Back", path("M19 12H5"), path("M11 18l-6-6 6-6")) }

    /** O lápis: Editar conta, em Configurações. */
    val Edit: ImageVector by lazy { lineIcon("Edit", path("M4 20h4l10-10-4-4L4 16v4z"), path("M13.5 6.5l4 4")) }

    /** A porta com a seta: Sair da conta, em Configurações. */
    val SignOut: ImageVector by lazy {
        lineIcon(
            "SignOut",
            path("M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"),
            path("M10 17l-5-5 5-5"),
            path("M5 12h11"),
        )
    }

    /** A seta para baixo: o Tempo para atender, em Configurações. */
    val ChevronDown: ImageVector by lazy { lineIcon("ChevronDown", path("M6 9l6 6 6-6")) }

    /** A seta para a direita, pequena: Permissões e bateria, em Configurações. */
    val ChevronRight: ImageVector by lazy { lineIcon("ChevronRight", path("M9 6l6 6-6 6")) }

    /** O "i" no círculo: Sobre, no menu. */
    val Info: ImageVector by lazy { lineIcon("Info", circle(12f, 12f, 9f), path("M12 11v5"), path("M12 8h.01")) }

    /** O triângulo: Atenção, o erro no cadastro no cartão da conta. */
    val Warning: ImageVector by lazy { lineIcon("Warning", path("M12 3l10 18H2z"), path("M12 10v5"), path("M12 18h.01")) }

    /** O globo: o site, no Sobre. */
    val Globe: ImageVector by lazy {
        lineIcon("Globe", circle(12f, 12f, 9f), path("M3 12h18"), path("M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"))
    }

    /** Os sinais de menor e maior: o Código-fonte, no Sobre. */
    val Code: ImageVector by lazy { lineIcon("Code", path("M8 6l-6 6 6 6"), path("M16 6l6 6-6 6")) }

    /** A seta para cima saindo da bandeja: Enviar diagnóstico, no Sobre. */
    val Share: ImageVector by lazy {
        lineIcon("Share", path("M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"), path("M12 4v11"), path("M8 8l4-4 4 4"))
    }

    /** O olho: Mostrar a senha, no Entrar. */
    val Eye: ImageVector by lazy {
        lineIcon("Eye", path("M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"), circle(12f, 12f, 3f))
    }

    /** O sino: as notificações, em Permissões. */
    val Bell: ImageVector by lazy {
        lineIcon("Bell", path("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"), path("M10.3 21a1.94 1.94 0 0 0 3.4 0"))
    }

    /** O microfone das Permissões (o da ligação é o [Mic]). */
    val Microphone: ImageVector by lazy {
        lineIcon("Microphone", rect(9f, 2f, 6f, 12f, 3f), path("M5 10v1a7 7 0 0 0 14 0v-1"), path("M12 18v4"))
    }

    /** O celular: a tela cheia, em Permissões. */
    val FullScreen: ImageVector by lazy { lineIcon("FullScreen", rect(6f, 2f, 12f, 20f, 2f), path("M11 18h2")) }

    /** A bateria: o uso da bateria, em Permissões. */
    val Battery: ImageVector by lazy {
        lineIcon("Battery", rect(2f, 7f, 18f, 10f, 2f), path("M22 11v2"), path("M6 10v4"))
    }

    /** O sinal de feito: a permissão já dada, em Permissões. */
    val Check: ImageVector by lazy { lineIcon("Check", path("M20 6L9 17l-5-5")) }

    /** O microfone da ligação: o Mudo desligado. */
    val Mic: ImageVector by lazy {
        lineIcon("Mic", rect(9f, 3f, 6f, 11f, 3f), path("M5 11a7 7 0 0 0 14 0"), path("M12 18v3"))
    }

    /** O microfone riscado: o Mudo ligado. */
    val MicOff: ImageVector by lazy {
        lineIcon("MicOff", rect(9f, 3f, 6f, 11f, 3f), path("M5 11a7 7 0 0 0 14 0"), path("M12 18v3"), path("M4 4l16 16"))
    }

    /** O alto-falante: Viva-voz. */
    val Speaker: ImageVector by lazy {
        lineIcon("Speaker", path("M11 5L6 9H3v6h3l5 4V5z"), path("M15.5 8.5a5 5 0 0 1 0 7"), path("M18.5 5.5a9 9 0 0 1 0 13"))
    }

    /** As duas barras: Espera. */
    val Hold: ImageVector by lazy { lineIcon("Hold", path("M9 6v12M15 6v12")) }

    /** O mais: Nova ligação. */
    val Add: ImageVector by lazy { lineIcon("Add", path("M12 5v14M5 12h14")) }

    /** As duas setas: Alternar. */
    val Swap: ImageVector by lazy {
        lineIcon("Swap", path("M7 4L3 8l4 4"), path("M3 8h14"), path("M17 20l4-4-4-4"), path("M21 16H7"))
    }

    /** Os dois círculos: Juntar. */
    val Join: ImageVector by lazy { lineIcon("Join", circle(8f, 12f, 4f), circle(16f, 12f, 4f)) }
}

// O fone do canvas (o mesmo no Ligar, no Atender e, virado, no Desligar).
private const val PHONE =
    "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 " +
        "2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27" +
        "-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"

// Um ícone de 24 × 24 dp com os caminhos [parts] em traço de 2, pontas e cantos redondos (o .ic do canvas), girado
// [rotate] graus em volta do centro.
private fun lineIcon(name: String, vararg parts: List<PathNode>, rotate: Float = 0f): ImageVector =
    ImageVector.Builder(name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        .apply {
            addGroup(rotate = rotate, pivotX = 12f, pivotY = 12f)
            for (part in parts) {
                addPath(
                    part,
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
            clearGroup()
        }
        .build()

// Um <path d="…"> do SVG.
private fun path(data: String): List<PathNode> = addPathNodes(data)

// Um <circle cx cy r> do SVG: dois meios círculos.
private fun circle(cx: Float, cy: Float, r: Float): List<PathNode> = PathData {
    moveTo(cx - r, cy)
    arcToRelative(r, r, 0f, isMoreThanHalf = true, isPositiveArc = false, 2 * r, 0f)
    arcToRelative(r, r, 0f, isMoreThanHalf = true, isPositiveArc = false, -2 * r, 0f)
    close()
}

// Um <rect x y width height rx> do SVG: os quatro lados com os cantos redondos de raio [rx].
private fun rect(x: Float, y: Float, width: Float, height: Float, rx: Float): List<PathNode> = PathData {
    moveTo(x + rx, y)
    horizontalLineTo(x + width - rx)
    arcTo(rx, rx, 0f, isMoreThanHalf = false, isPositiveArc = true, x + width, y + rx)
    verticalLineTo(y + height - rx)
    arcTo(rx, rx, 0f, isMoreThanHalf = false, isPositiveArc = true, x + width - rx, y + height)
    horizontalLineTo(x + rx)
    arcTo(rx, rx, 0f, isMoreThanHalf = false, isPositiveArc = true, x, y + height - rx)
    verticalLineTo(y + rx)
    arcTo(rx, rx, 0f, isMoreThanHalf = false, isPositiveArc = true, x + rx, y)
    close()
}
