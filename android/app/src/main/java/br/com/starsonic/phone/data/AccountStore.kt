package br.com.starsonic.phone.data

import android.content.Context
import br.com.starsonic.phone.engine.Transport
import java.io.IOException

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

    /** Grava a conta (Keystore e disco: nunca na thread principal). Lança exceção se o Keystore ou o disco falham. */
    fun save(account: Account)

    /** Apaga a conta e a senha: quem lê depois já não acha a conta. Não espera o disco. */
    fun clear()
}

/**
 * A conta no armazenamento privado do app (SharedPreferences "conta"), com a senha cifrada pelo
 * [PasswordCipher]. Desinstalar o app apaga tudo; o manifesto deixa os dados do app fora do backup na nuvem e da
 * transferência para outro celular.
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
        val sealed = cipher.encrypt(account.senha)   // antes de mexer no arquivo: o Keystore pode falhar
        val written = preferences.edit()
            .putString(KEY_ADDRESS, account.address)
            .putString(KEY_TRANSPORT, if (account.transport == Transport.TCP) TCP else UDP)
            .putString(KEY_RAMAL, account.ramal)
            .putString(KEY_SENHA, sealed)
            .commit()   // no disco antes de a tela Entrar acabar
        if (!written) throw IOException("a conta não foi gravada no disco")
    }

    // Na memória na hora e no disco logo depois (apply): serve na thread principal (Sair), e uma gravação que vem
    // depois (o próximo Entrar) vai ao disco depois desta.
    override fun clear() {
        preferences.edit().clear().apply()
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
