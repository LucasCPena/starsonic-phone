package br.com.starsonic.phone.call

// O que as telas da ligação e a notificação da recebida escrevem, como no app do Windows (windows/ui/src/format.ts e
// Ligacao.tsx) e nos quadros Chamada, DuasLigacoes e Recebida do canvas: o tempo, o estado, o título da recebida, a linha
// do Atender automático (spec 5 e 10, R32 e R33) e a linha de baixo dos cartões.

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
 * em <n> s", e "Atender automático · na hora" com 0 s (R32).
 */
fun autoAnswerIn(seconds: Int): String = if (seconds <= 0) "$AUTO_ANSWER · na hora" else "$AUTO_ANSWER · em $seconds s"

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
 * A linha de baixo de um cartão das telas da ligação (o .row-sub dos quadros): o número, quando o nome está no título, e o
 * [status] (o tempo ou "Chamando…"; vazio na conferência), separados por " · ".
 */
fun cardLine(number: String, name: String, status: String): String =
    listOfNotNull(number.takeIf { name.isNotEmpty() }, status.ifEmpty { null }).joinToString(SEPARATOR)

private const val SEPARATOR = " · "
private const val CALLING = "Chamando…"
private const val CONNECTING = "Conectando…"
private const val INCOMING = "Ligação recebida"
private const val AUTO_ANSWER = "Atender automático"
