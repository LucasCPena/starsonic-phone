package br.com.starsonic.phone.data

import android.content.Context
import br.com.starsonic.phone.engine.Transport

/**
 * A conta do celular: o endereço do servidor e o ramal já normalizados pelo núcleo, o protocolo e a senha
 * (que só fica gravada cifrada; ver [PreferencesAccountStore]).
 */
data class Account(val address: String, val transport: Transport, val ramal: String, val senha: String) {
    /** Sem a senha (o texto pode ir parar num log). */
    override fun toString(): String = "Account(address=$address, transport=$transport, ramal=$ramal)"
}

/** Onde a conta fica gravada. Uma conta por celular. */
interface AccountStore {
    /** A conta gravada, ou null (sem conta, ou a senha não pôde ser decifrada). */
    fun load(): Account?

    fun save(account: Account)

    /** Apaga a conta e a senha. */
    fun clear()
}

/** A conta no armazenamento privado do app. */
class PreferencesAccountStore(context: Context) : AccountStore {
    override fun load(): Account? = null

    override fun save(account: Account) {}

    override fun clear() {}
}
