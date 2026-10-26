package br.com.starsonic.phone.data

/**
 * O Rediscar (spec 6): a ligação feita mais nova dos Recentes (pelo começo dela), ou null sem nenhuma feita. O número vai
 * para o Ligar como foi discado (o que os Recentes guardam), sem nenhuma regra por cima, pelo mesmo caminho do botão de
 * ligar da linha do Recentes.
 */
fun lastDialed(recents: List<Recent>): Recent? =
    recents.filter { it.kind == CallKind.FEITA }.maxByOrNull { it.startMillis }

/**
 * O nome do Rediscar, para o leitor de tela e para a dica do aperto longo (spec 6 e 10): "Rediscar <número> · <nome>"
 * com o nome da feita [redial] ([name]: o do contato, ou o que a central mandou), "Rediscar <número>" sem ele, e só
 * "Rediscar" sem nenhuma feita (o botão apagado).
 */
fun redialLabel(redial: Recent?, name: String?): String = when {
    redial == null -> REDIAL
    name.isNullOrEmpty() -> "$REDIAL ${redial.number}"
    else -> "$REDIAL ${redial.number} · $name"
}

private const val REDIAL = "Rediscar"
