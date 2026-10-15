package br.com.starsonic.phone.service

import br.com.starsonic.phone.core.CoreRules

/** O status da conta: o texto da faixa e o título da notificação fixa (Global Constraints). */
data class Status(val band: String, val notificationTitle: String)

/**
 * O status pelo último resultado do registro da conta e pela rede (spec 7.2): sem rede, "Sem internet";
 * registrada, "Conectado · <ramal>" na faixa e "Conectado (ramal <ramal>)" na notificação; sem resposta
 * ainda (ou só uma provisória, ou a conta saindo), "Conectando…"; uma falha, o aviso do núcleo
 * (RegistrationMessage) nos dois.
 */
object StatusModel {
    fun from(registrationCode: Int?, active: Boolean, online: Boolean, ramal: String, core: CoreRules): Status {
        if (!online) return Status(NO_INTERNET, NO_INTERNET)
        val code = registrationCode ?: return CONNECTING
        if (code in 200..299 && active) return Status("Conectado · $ramal", "Conectado (ramal $ramal)")
        if (code in 100..299) return CONNECTING
        val message = core.registrationMessage(code).ifEmpty { return CONNECTING }
        return Status(message, message)
    }

    private const val NO_INTERNET = "Sem internet"
    private val CONNECTING = Status("Conectando…", "Conectando…")
}
