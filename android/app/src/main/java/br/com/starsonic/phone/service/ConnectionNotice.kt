package br.com.starsonic.phone.service

/**
 * A ordem dos títulos da notificação fixa (R23): ela nunca fica num título velho.
 *
 * O Android põe na tela a notificação de um startForeground depois, pelo ActivityManager (o ServiceRecord a manda pela
 * fila dele), e a de um notify() vai direto ao NotificationManager. Um título mandado direto logo depois de um início
 * pode chegar antes do título do início, que então fica por cima; e um título que não muda não é mandado de novo.
 * Por isso:
 * - cada notificação leva um número de ordem ([nextSeq]), maior que o de todas as anteriores;
 * - depois de um início ([started]), os títulos novos ([titleChanged]) esperam a notificação dele aparecer na tela
 *   ([shown], com o número que está lá); aí vai o título de agora, se for outro;
 * - sem um início a caminho, cada título novo vai na hora, pelo mesmo caminho dos anteriores (o notify, que chega na
 *   ordem);
 * - a notificação mandada que não aparece a tempo ([timedOut]: a fila do Android a descartou, ou o início demorou
 *   demais) vai de novo, com o título de agora e um número novo.
 *
 * [post] manda um título com o número dele (o notify). Só na thread principal.
 */
internal class ConnectionNotice(private val post: (title: String, seq: Long) -> Unit) {
    private var lastSeq = 0L
    private var awaited: Long? = null      // a notificação mandada que a tela ainda não mostrou
    private var startOnItsWay = false       // a esperada é a de um início: os títulos novos esperam ela aparecer
    private var sentTitle: String? = null   // o título da última mandada (início ou notify)
    private var wanted: String? = null      // o título que o status pede agora

    /** Há uma notificação mandada que ainda não apareceu na tela: o serviço confere a tela até ela aparecer. */
    val waiting: Boolean
        get() = awaited != null

    /** O número de ordem da próxima notificação (a de um início). */
    fun nextSeq(): Long = ++lastSeq

    /** O startForeground com a notificação [seq] e o título [title] foi para o Android, que a põe na tela depois. */
    fun started(seq: Long, title: String) {
        awaited = seq
        startOnItsWay = true
        sentTitle = title
        wanted = title
    }

    /** O título do status passou a ser [title]. */
    fun titleChanged(title: String) {
        wanted = title
        if (!startOnItsWay && title != sentTitle) send(title)
    }

    /** A notificação fixa na tela agora tem o número [seq] (null: nenhuma, ou uma sem número). */
    fun shown(seq: Long?) {
        val expected = awaited ?: return
        if (seq == null || seq < expected) return
        awaited = null
        val startShown = startOnItsWay
        startOnItsWay = false
        val now = wanted
        if (startShown && now != null && now != sentTitle) send(now)
    }

    /** A notificação esperada não apareceu a tempo: o título de agora vai de novo, com um número novo. */
    fun timedOut() {
        if (awaited == null) return
        startOnItsWay = false
        send(wanted ?: sentTitle ?: return)
    }

    private fun send(title: String) {
        val seq = nextSeq()
        awaited = seq
        sentTitle = title
        post(title, seq)
    }
}
