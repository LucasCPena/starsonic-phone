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

/**
 * A conta no armazenamento privado do app (SharedPreferences "conta"), com a senha cifrada pelo
 * [PasswordCipher]. Desinstalar o app apaga tudo; o manifesto não deixa a conta ir para o backup.
 */
class PreferencesAccountStore(
    context: Context,
    private val cipher: PasswordCipher = PasswordCipher(),
) : AccountStore {
    private val preferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    override fun load(): Account? {
        val address = preferences.getString(KEY_ADDRESS, null) ?: return null
        val ramal = preferences.getString(KEY_RAMAL, null) ?: return null
        val transport = if (preferences.getString(KEY_TRANSPORT, null) == TCP) Transport.TCP else Transport.UDP
        val sealed = preferences.getString(KEY_SENHA, null) ?: return null
        val senha = cipher.decrypt(sealed) ?: return null
        return Account(address, transport, ramal, senha)
    }

    override fun save(account: Account) {
        preferences.edit()
            .putString(KEY_ADDRESS, account.address)
            .putString(KEY_TRANSPORT, if (account.transport == Transport.TCP) TCP else UDP)
            .putString(KEY_RAMAL, account.ramal)
            .putString(KEY_SENHA, cipher.encrypt(account.senha))
            .commit()   // no disco antes de a tela Entrar acabar
    }

    override fun clear() {
        preferences.edit().clear().commit()
    }

    private companion object {
        const val FILE = "conta"
        const val KEY_ADDRESS = "servidor"
        const val KEY_TRANSPORT = "protocolo"
        const val KEY_RAMAL = "ramal"
        const val KEY_SENHA = "senha-cifrada"
        const val UDP = "udp"
        const val TCP = "tcp"
    }
}
