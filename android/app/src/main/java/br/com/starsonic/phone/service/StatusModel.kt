package br.com.starsonic.phone.service

import br.com.starsonic.phone.core.CoreRules

/**
 * A bolinha (spec 7): cinza sem internet ([OFFLINE]), ciano conectando ([CONNECTING]), cinza com o triângulo de aviso
 * num erro do cadastro ([ERROR]), cinza sem o triângulo com a central sem responder ([NO_CONNECTION]), vermelha numa
 * ligação ou no Não perturbe ([BUSY]) e verde conectada ([ONLINE]).
 */
enum class Dot { OFFLINE, CONNECTING, ERROR, NO_CONNECTION, BUSY, ONLINE }

/** O status: a bolinha, a linha ao lado dela (no cartão da conta) e o título da notificação fixa. */
data class Status(val dot: Dot, val line: String, val notificationTitle: String)

/**
 * A tabela da bolinha (spec 7, a mesma do Windows), em que vale a primeira linha que bate:
 * 1. sem rede: "Sem internet · tentando de novo";
 * 2. sem resposta ainda (ou só uma provisória, ou a conta saindo): "Conectando…";
 * 3. uma falha do registro: o aviso do núcleo (RegistrationMessage), com o triângulo; a central sem responder (0 ou
 *    menos, 408 e os 5xx) é "sem conexão", sem o triângulo;
 * 4. numa ligação (tocando também): "Ocupado · em ligação";
 * 5. com o Não perturbe: "Não perturbe · as ligações não tocam" e, na notificação, "Não perturbe (ramal <ramal>)";
 * 6. registrada: "Conectado · <servidor>" e, na notificação, "Conectado (ramal <ramal>)".
 *
 * [account] dá as linhas 1, 2, 3 e 6, pelo último resultado do registro da conta e pela rede; [shown] põe as linhas 4 e
 * 5 por cima da conta registrada.
 */
object StatusModel {
    /** O status da conta [ramal] do servidor [server], pelo último resultado do registro ([code]) e pela rede. */
    fun account(code: Int?, active: Boolean, online: Boolean, ramal: String, server: String, core: CoreRules): Status {
        if (!online) return OFFLINE
        val registration = code ?: return CONNECTING
        if (registration in 200..299 && active) {
            return Status(Dot.ONLINE, "Conectado · $server", "Conectado (ramal $ramal)")
        }
        if (registration in 100..299) return CONNECTING
        val message = core.registrationMessage(registration).ifEmpty { return CONNECTING }
        val unreachable = registration <= 0 || registration == 408 || registration in 500..599
        return Status(if (unreachable) Dot.NO_CONNECTION else Dot.ERROR, message, message)
    }

    /**
     * O status que o app mostra: o da conta ([account]) e, só com ela registrada, a ligação ([inCall]: qualquer uma,
     * tocando também) e depois o Não perturbe, da conta [ramal].
     */
    fun shown(account: Status, ramal: String, inCall: Boolean, doNotDisturb: Boolean): Status = when {
        account.dot != Dot.ONLINE -> account
        inCall -> BUSY
        doNotDisturb -> Status(Dot.BUSY, "Não perturbe · as ligações não tocam", "Não perturbe (ramal $ramal)")
        else -> account
    }

    private const val NO_INTERNET = "Sem internet · tentando de novo"
    private val OFFLINE = Status(Dot.OFFLINE, NO_INTERNET, NO_INTERNET)
    private val CONNECTING = Status(Dot.CONNECTING, "Conectando…", "Conectando…")
    private val BUSY = Status(Dot.BUSY, "Ocupado · em ligação", "Ocupado · em ligação")
}
