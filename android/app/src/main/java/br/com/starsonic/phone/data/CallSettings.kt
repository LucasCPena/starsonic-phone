package br.com.starsonic.phone.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * As configurações de ligação (spec 4, 5, 8 e 9): o Não perturbe, o Atender automático com o tempo dele (um de
 * [AUTO_ANSWER_SECONDS]) e o bipe no fim da ligação. As de fábrica: desligados, 3 s e o bipe ligado.
 */
data class CallSettings(
    val doNotDisturb: Boolean = false,
    val autoAnswer: Boolean = false,
    val autoAnswerSeconds: Int = 3,
    val endBeep: Boolean = true,
)

/** As opções do "Tempo para atender", em segundos, as do Windows (0 é "Na hora"). */
val AUTO_ANSWER_SECONDS: List<Int> = listOf(0, 1, 2, 3, 5, 8, 10, 15, 20, 30)

/** Onde as configurações de ligação ficam gravadas. */
interface CallSettingsStore {
    /** As configurações de agora. */
    val settings: StateFlow<CallSettings>

    /** Muda as configurações ([change] recebe as de agora) e as grava. Valem na hora, em [settings]. */
    fun update(change: (CallSettings) -> CallSettings)
}

/**
 * As configurações de ligação no armazenamento privado do app (SharedPreferences "configuracoes"), separado do da conta
 * ("conta", que o Sair da conta apaga): elas ficam depois do Sair e valem de novo no próximo Entrar. O arquivo é lido
 * uma vez, ao criar (o disco: nunca na thread principal); um tempo para atender fora das opções é lido como 3 s. Cada
 * mudança vale na hora e vai ao disco logo depois (apply): serve na thread principal.
 */
class PreferencesCallSettingsStore(private val preferences: SharedPreferences) : CallSettingsStore {
    /** As configurações no arquivo "configuracoes" do app. */
    constructor(context: Context) : this(context.getSharedPreferences(FILE, Context.MODE_PRIVATE))

    private val lock = Any()
    private val mutableSettings = MutableStateFlow(read())

    override val settings: StateFlow<CallSettings> = mutableSettings

    // Com a trava, a memória e o arquivo mudam na mesma ordem: duas mudanças ao mesmo tempo não se perdem. [change] só
    // calcula.
    override fun update(change: (CallSettings) -> CallSettings) {
        synchronized(lock) {
            val changed = change(mutableSettings.value)
            mutableSettings.value = changed
            preferences.edit()
                .putBoolean(KEY_DO_NOT_DISTURB, changed.doNotDisturb)
                .putBoolean(KEY_AUTO_ANSWER, changed.autoAnswer)
                .putInt(KEY_AUTO_ANSWER_SECONDS, changed.autoAnswerSeconds)
                .putBoolean(KEY_END_BEEP, changed.endBeep)
                .apply()
        }
    }

    private fun read(): CallSettings {
        val seconds = preferences.getInt(KEY_AUTO_ANSWER_SECONDS, DEFAULTS.autoAnswerSeconds)
        return CallSettings(
            doNotDisturb = preferences.getBoolean(KEY_DO_NOT_DISTURB, DEFAULTS.doNotDisturb),
            autoAnswer = preferences.getBoolean(KEY_AUTO_ANSWER, DEFAULTS.autoAnswer),
            autoAnswerSeconds = if (seconds in AUTO_ANSWER_SECONDS) seconds else DEFAULTS.autoAnswerSeconds,
            endBeep = preferences.getBoolean(KEY_END_BEEP, DEFAULTS.endBeep),
        )
    }

    internal companion object {
        /** O arquivo das configurações de ligação (o da conta é outro: [PreferencesAccountStore.FILE]). */
        const val FILE = "configuracoes"
        private const val KEY_DO_NOT_DISTURB = "nao_perturbe"
        private const val KEY_AUTO_ANSWER = "atender_auto"
        private const val KEY_AUTO_ANSWER_SECONDS = "atender_segundos"
        private const val KEY_END_BEEP = "bipe_fim"
        private val DEFAULTS = CallSettings()
    }
}
