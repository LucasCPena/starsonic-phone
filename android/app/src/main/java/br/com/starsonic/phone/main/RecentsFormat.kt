package br.com.starsonic.phone.main

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

// O que as linhas do Recentes escrevem, como no app do Windows (o canvas aprovado): as ligações em grupos por dia, e em
// cada linha a hora e quanto durou.

/**
 * O grupo do dia de uma ligação que começou em [startMillis], visto em [nowMillis] no fuso [zone]: "Hoje", "Ontem" ou
 * a data ("24 de outubro"; com o ano, se for de outro ano).
 */
internal fun dayGroup(startMillis: Long, nowMillis: Long, zone: ZoneId = ZoneId.systemDefault()): String {
    val day = Instant.ofEpochMilli(startMillis).atZone(zone).toLocalDate()
    val today = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()
    return when (ChronoUnit.DAYS.between(day, today)) {
        0L -> TODAY
        1L -> YESTERDAY
        else -> day.format(if (day.year == today.year) DAY_MONTH else DAY_MONTH_YEAR)
    }
}

/** A hora em que a ligação começou: "14:32". */
internal fun clockTime(startMillis: Long, zone: ZoneId = ZoneId.systemDefault()): String =
    Instant.ofEpochMilli(startMillis).atZone(zone).format(HOUR_MINUTE)

/** Quanto a ligação durou, como no Windows: "35 s", "2 min 05 s" ou "1 h 05 min". */
internal fun recentDuration(seconds: Int): String {
    val hours = seconds / 3600
    val minutes = seconds % 3600 / 60
    val rest = seconds % 60
    return when {
        hours > 0 -> "%d h %02d min".format(hours, minutes)
        minutes > 0 -> "%d min %02d s".format(minutes, rest)
        else -> "$rest s"
    }
}

/** O título da linha de uma ligação: o [name] (ou o número) e, ao lado dele, o [ramal] ("Marcos Lima · 2005"). */
internal data class RecentTitle(val name: String, val ramal: String?)

/**
 * O título da linha de uma ligação com o [number] e o [name] (o do contato ou o da central; vazio sem nenhum): o nome
 * com o ramal, só o nome com um número longo, ou só o número.
 */
internal fun recentTitle(number: String, name: String): RecentTitle = when {
    name.isEmpty() -> RecentTitle(number, null)
    isRamal(number) -> RecentTitle(name, number)
    else -> RecentTitle(name, null)
}

// Um ramal: só dígitos, de 2 a 6 (a regra do Windows).
private fun isRamal(number: String): Boolean = number.length in 2..6 && number.all(Char::isDigit)

private const val TODAY = "Hoje"
private const val YESTERDAY = "Ontem"
private val PT_BR: Locale = Locale.forLanguageTag("pt-BR")
private val DAY_MONTH: DateTimeFormatter = DateTimeFormatter.ofPattern("d 'de' MMMM", PT_BR)
private val DAY_MONTH_YEAR: DateTimeFormatter = DateTimeFormatter.ofPattern("d 'de' MMMM 'de' yyyy", PT_BR)
private val HOUR_MINUTE: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm", PT_BR)
