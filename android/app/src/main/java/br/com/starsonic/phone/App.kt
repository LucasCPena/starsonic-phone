package br.com.starsonic.phone

import android.app.Application
import android.util.Log
import br.com.starsonic.phone.core.Clock
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.DeviceClock
import br.com.starsonic.phone.core.NativeCoreRules
import br.com.starsonic.phone.data.AccountStore
import br.com.starsonic.phone.data.PreferencesAccountStore
import br.com.starsonic.phone.engine.EngineEvents
import br.com.starsonic.phone.engine.NativeSipGateway
import br.com.starsonic.phone.engine.SipGateway
import br.com.starsonic.phone.engine.Transport
import kotlin.concurrent.thread
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** O último resultado do registro da conta: o código SIP e se ela ficou registrada. */
data class Registration(val code: Int, val active: Boolean)

/**
 * O aplicativo (android:name do manifesto): o que vive com o processo. Por enquanto ele também sobe o motor
 * e registra a conta gravada; a Task 7 leva isso para o serviço em primeiro plano.
 */
class App : Application() {
    val core: CoreRules
        get() = NativeCoreRules

    /** O motor de ligações (um por processo). */
    val gateway: SipGateway by lazy { NativeSipGateway() }

    /** A conta gravada no celular. */
    val store: AccountStore by lazy { PreferencesAccountStore(this) }

    val clock: Clock by lazy { DeviceClock() }

    /** O perfil das contas (branding/perfil.ini, que vai nos assets sem os comentários). */
    val profileText: String by lazy { assets.open("perfil.ini").use { String(it.readBytes(), Charsets.UTF_8) } }

    /** O protocolo da tela Entrar numa conta nova: o padrão do perfil. */
    val defaultTransport: Transport by lazy {
        if (Native.profileTransport(profileText) == "tcp") Transport.TCP else Transport.UDP
    }

    private val mutableRegistration = MutableStateFlow<Registration?>(null)

    /** O último resultado do registro (para a faixa). */
    val registration: StateFlow<Registration?> = mutableRegistration

    /** Quem espera o resultado do registro na tela Entrar (null fora dela). */
    @Volatile
    var loginEvents: ((Int, Boolean) -> Unit)? = null

    private val events = object : EngineEvents {
        override fun onRegistration(code: Int, active: Boolean) {
            mutableRegistration.value = Registration(code, active)
            loginEvents?.invoke(code, active)
        }

        override fun onIncomingCall(callId: Int, remoteUser: String, remoteName: String) {}

        override fun onRejectedBusy(remoteUser: String, remoteName: String) {}

        override fun onCallState(callId: Int, state: Int, code: Int) {}

        override fun onLog(level: Int, line: String) {
            // Só no build de debug, para o logcat (e para os testes no emulador mostrarem o motor quando falham).
            if (BuildConfig.DEBUG) Log.println(logPriority(level), LOG_TAG, line)
        }
    }

    override fun onCreate() {
        super.onCreate()
        // O motor sobe fora da thread principal (pode levar alguns segundos); a conta gravada registra.
        thread(name = "starsonic-inicio") {
            if (gateway.start("$USER_AGENT/${BuildConfig.VERSION_NAME}", profileText, events)) {
                store.load()?.let { gateway.setAccount(it.address, it.transport, it.ramal, it.senha) }
            }
        }
    }

    private companion object {
        const val USER_AGENT = "Starsonic Phone Android"
        const val LOG_TAG = "StarsonicMotor"

        fun logPriority(level: Int): Int = when (level) {
            1 -> Log.ERROR
            2 -> Log.WARN
            3 -> Log.INFO
            else -> Log.DEBUG
        }
    }
}
