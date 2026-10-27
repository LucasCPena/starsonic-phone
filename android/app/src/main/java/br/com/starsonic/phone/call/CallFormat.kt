package br.com.starsonic.phone.call

// O que as telas da ligação e a notificação da recebida escrevem, como no app do Windows (windows/ui/src/format.ts e
// Ligacao.tsx) e nos quadros Chamada, DuasLigacoes e Recebida do canvas: o tempo, o estado, o título da recebida, a linha
// do Atender automático (spec 5 e 10, R32 e R33), o número embaixo do nome (R35) e a linha de baixo dos cartões.

/** O tempo da ligação (o callTimer do Windows): "00:42", "12:05" e, de uma hora em diante, "1:02:03". */
fun callTimer(seconds: Int): String {
    val total = seconds.coerceAtLeast(0)
    val hours = total / 3600
    val minutes = total % 3600 / 60
    val rest = total % 60
    return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, rest) else "%02d:%02d".format(minutes, rest)
}

/**
 * O estado da ligação embaixo do nome: "Chamando…" (a feita), "Conectando…" (a recebida atendida, esperando o motor) ou
 * o tempo desde [activeSinceMillis], visto em [nowMillis]; a recebida que toca tem o título dela ([incomingTitle]).
 */
fun callStatus(phase: CallPhase, activeSinceMillis: Long, nowMillis: Long): String = when (phase) {
    CallPhase.DIALING -> CALLING
    CallPhase.CONNECTING -> CONNECTING
    CallPhase.RINGING -> ""
    CallPhase.ACTIVE -> callTimer(((nowMillis - activeSinceMillis) / 1000).toInt())
}

/** O título da recebida (spec 10): "Ligação recebida · <ramal>"; sem o ramal, "Ligação recebida". */
fun incomingTitle(ramal: String): String = if (ramal.isEmpty()) INCOMING else "$INCOMING · $ramal"

/**
 * A linha do Atender automático com o tempo escolhido, a da notificação (R33: uma vez, sem contar): "Atender automático ·
 * em <n> s", e "Atender automático · na hora" com 0 s (R32). O "em", o número e o "s" (e o "na hora") vão juntos, com
 * espaços que não quebram (R40): com a letra grande, a linha quebra antes do "em", e o que aparece é o texto do spec 10.
 */
fun autoAnswerIn(seconds: Int): String =
    if (seconds <= 0) "$AUTO_ANSWER · na${NBSP}hora" else "$AUTO_ANSWER · em$NBSP$seconds${NBSP}s"

/**
 * A linha do Atender automático na recebida em tela cheia (R33): os segundos que faltam dos [seconds] escolhidos desde
 * [sinceMillis] (quando o celular começou a tocar), vistos em [nowMillis], de segundo em segundo ("em 3 s", "em 2 s",
 * "em 1 s"; na hora de atender, ainda "em 1 s", nunca "em 0 s"); "na hora" com 0 s.
 */
fun autoAnswerCountdown(seconds: Int, sinceMillis: Long, nowMillis: Long): String {
    if (seconds <= 0) return autoAnswerIn(0)
    val total = seconds * 1000L
    val elapsed = (nowMillis - sinceMillis).coerceIn(0L, total)
    val left = ((total - elapsed + 999) / 1000).toInt().coerceAtLeast(1)
    return autoAnswerIn(left)
}

/**
 * O texto da notificação da recebida (debaixo do nome de quem liga): o número, se o nome está no título, e, com o
 * Atender automático marcado ([autoAnswerSeconds]; null sem ele), a linha dele ([autoAnswerIn]); null sem nenhum dos dois.
 */
fun incomingNotificationText(number: String, name: String, autoAnswerSeconds: Int?): String? {
    val parts = listOfNotNull(number.takeIf { name.isNotBlank() }, autoAnswerSeconds?.let(::autoAnswerIn))
    return parts.joinToString(SEPARATOR).ifEmpty { null }
}

/**
 * O número embaixo do nome nas telas da ligação (R35; o contactNumberLine do Windows, windows/ui/src/format.ts): um ramal
 * (de 2 a 6 dígitos) é "Ramal <número>", como nos quadros Chamada e DuasLigacoes; qualquer outro número fica como veio.
 */
fun contactNumberLine(number: String): String {
    val trimmed = number.trim()
    return if (RAMAL.matches(trimmed)) "$RAMAL_LABEL $trimmed" else number
}

/**
 * A linha de baixo de um cartão das telas da ligação (o .row-sub dos quadros): o número ([contactNumberLine]), quando o
 * nome está no título, e o [status] (o tempo ou "Chamando…"; vazio na conferência), separados por " · ".
 */
fun cardLine(number: String, name: String, status: String): String =
    listOfNotNull(contactNumberLine(number).takeIf { name.isNotEmpty() }, status.ifEmpty { null }).joinToString(SEPARATOR)

private val RAMAL = Regex("[0-9]{2,6}")
private const val RAMAL_LABEL = "Ramal"
private const val SEPARATOR = " · "
private const val NBSP = '\u00A0'   // o espaço que não quebra
private const val CALLING = "Chamando…"
private const val CONNECTING = "Conectando…"
private const val INCOMING = "Ligação recebida"
private const val AUTO_ANSWER = "Atender automático"
