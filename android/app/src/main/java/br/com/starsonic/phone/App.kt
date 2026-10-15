package br.com.starsonic.phone

import android.app.Application
import android.util.Log
import br.com.starsonic.phone.call.AndroidTelecom
import br.com.starsonic.phone.call.CallManager
import br.com.starsonic.phone.call.IncomingCallNotifier
import br.com.starsonic.phone.core.Clock
import br.com.starsonic.phone.core.CoreRules
import br.com.starsonic.phone.core.DeviceClock
import br.com.starsonic.phone.core.NativeCoreRules
import br.com.starsonic.phone.data.AccountStore
import br.com.starsonic.phone.data.PreferencesAccountStore
import br.com.starsonic.phone.data.RecentsStore
import br.com.starsonic.phone.engine.NativeSipGateway
import br.com.starsonic.phone.engine.SipGateway
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.service.Connection
import java.io.File

/**
 * O aplicativo (android:name do manifesto): o que vive com o processo. Ele não sobe o motor nem registra
 * nada: com conta gravada, quem registra é o SipService (Android 12+ não deixa iniciar o serviço em primeiro
 * plano daqui, com o app em segundo plano). Ao começar, só registra a conta self-managed "Starsonic Phone" no
 * Telecom do Android. Tudo aqui nasce sob demanda, e o que lê o disco ou o Keystore nunca na thread principal.
 */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        telecom.register()
    }

    val core: CoreRules
        get() = NativeCoreRules

    /**
     * A conexão com o servidor: o motor de ligações (um por processo, que sobe na primeira vez que alguém
     * precisa dele), a conta que está nele e o status da faixa e da notificação.
     */
    val connection: Connection by lazy {
        Connection(::NativeSipGateway, core, "$USER_AGENT/${BuildConfig.VERSION_NAME}", { profileText }, ::log, { calls })
    }

    /** O motor para quem troca a conta (a tela Entrar e os testes): a própria conexão, que anota a conta. */
    val gateway: SipGateway
        get() = connection

    /** A conta gravada no celular. */
    val store: AccountStore by lazy { PreferencesAccountStore(this) }

    val clock: Clock by lazy { DeviceClock() }

    /** Os Recentes (o arquivo só é procurado no primeiro uso, fora da thread principal). */
    val recents: RecentsStore by lazy { RecentsStore { File(filesDir, "recentes.json") } }

    /** O Telecom do Android: a conta self-managed, a Connection da ligação e as rotas de áudio. */
    val telecom: AndroidTelecom by lazy { AndroidTelecom(this) }

    /** As notificações das ligações (a recebida e as perdidas). */
    val notifier: IncomingCallNotifier by lazy { IncomingCallNotifier(this) }

    /**
     * As ligações: os avisos do motor chegam pela conexão; só liga com a conta do serviço registrada
     * ([Connection.registered]).
     */
    val calls: CallManager by lazy {
        CallManager(connection, telecom, recents, notifier, core, clock, { connection.registered.value })
    }

    /** O perfil das contas (branding/perfil.ini, que vai nos assets sem os comentários). Lê o disco. */
    val profileText: String by lazy { assets.open("perfil.ini").use { String(it.readBytes(), Charsets.UTF_8) } }

    /** O protocolo da tela Entrar numa conta nova: o padrão do perfil. Lê o disco e o núcleo (JNI). */
    val defaultTransport: Transport by lazy {
        if (Native.profileTransport(profileText) == "tcp") Transport.TCP else Transport.UDP
    }

    // As linhas do motor vão ao logcat só no build de debug (os testes no emulador mostram o motor quando falham).
    private fun log(level: Int, line: String) {
        if (BuildConfig.DEBUG) Log.println(logPriority(level), LOG_TAG, line)
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
