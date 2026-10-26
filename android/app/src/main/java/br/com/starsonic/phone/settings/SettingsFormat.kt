package br.com.starsonic.phone.settings

/**
 * A linha de baixo do "Atender automaticamente" nas Configurações (spec 8 e 10, R27), como no Windows
 * (windows/ui/src/format.ts, autoAnswerLine): "Assim que tocar" na hora (0 s), "Depois de 1 segundo tocando" e
 * "Depois de <n> segundos tocando".
 */
fun autoAnswerLine(seconds: Int): String = when {
    seconds <= 0 -> "Assim que tocar"
    seconds == 1 -> "Depois de 1 segundo tocando"
    else -> "Depois de $seconds segundos tocando"
}

/**
 * O nome de uma opção do "Tempo para atender" (spec 5 e 10), como no Windows (Configuracoes.tsx): "Na hora" para 0 s e
 * "<n> s" para as outras.
 */
fun autoAnswerOption(seconds: Int): String = if (seconds == 0) "Na hora" else "$seconds s"
