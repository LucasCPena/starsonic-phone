package br.com.starsonic.phone.service

import br.com.starsonic.phone.core.CoreRules

/** O status da conta: o texto da faixa e o título da notificação fixa. */
data class Status(val band: String, val notificationTitle: String)

/** O status pelo último resultado do registro da conta e pela rede (stub). */
object StatusModel {
    fun from(registrationCode: Int?, active: Boolean, online: Boolean, ramal: String, core: CoreRules): Status =
        Status("", "")
}
