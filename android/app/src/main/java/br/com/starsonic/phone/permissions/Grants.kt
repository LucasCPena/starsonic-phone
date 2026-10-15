package br.com.starsonic.phone.permissions

import android.Manifest
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * O que o celular permite ao app agora (spec 7.1 item 4 e 11.1): notificações, microfone, tela cheia (só o
 * Android 14+ pede) e uso de bateria sem restrição. Ler isso não toca o disco do app: pode ser na thread
 * principal, a cada volta ao app.
 */
data class Grants(val notifications: Boolean, val microphone: Boolean, val fullScreen: Boolean, val battery: Boolean) {
    /** O aviso da faixa (um por vez), ou null. */
    val banner: Banner?
        get() = Banners.first(notifications, microphone, fullScreen, battery)

    /** O que falta, na ordem da prioridade (os itens da tela Permissões). */
    val missing: List<Banner>
        get() = Banners.missing(notifications, microphone, fullScreen, battery)

    companion object {
        fun read(context: Context): Grants = Grants(
            notifications = NotificationManagerCompat.from(context).areNotificationsEnabled(),
            microphone = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED,
            fullScreen = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
                context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent(),
            battery = context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName),
        )
    }
}

/** O passo a passo do fabricante deste celular (Build.MANUFACTURER; se não diz, a marca). */
fun deviceGuide(): Guide =
    OemGuide.forManufacturer(Build.MANUFACTURER).takeIf { it != Guide.GENERIC } ?: OemGuide.forManufacturer(Build.BRAND)

/**
 * O ajuste certo do Android para cada aviso (o botão "Abrir ajustes" da faixa): as notificações do app, a
 * página do app (as permissões, onde fica o microfone), a tela cheia e o pedido para sair da otimização de
 * bateria.
 */
fun settingsIntent(context: Context, banner: Banner): Intent = when (banner) {
    Banner.NOTIFICATIONS ->
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
    Banner.MICROPHONE -> appDetailsIntent(context)
    Banner.FULL_SCREEN ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, packageUri(context))
        } else {
            appDetailsIntent(context)
        }
    Banner.BATTERY -> Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, packageUri(context))
}

/** A página do app nos ajustes do Android (o passo a passo do fabricante começa nela). */
fun appDetailsIntent(context: Context): Intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri(context))

/** Abre [intent]; se o celular não tem essa tela (alguns fabricantes tiram), a página do app. */
fun openSettings(context: Context, intent: Intent) {
    try {
        context.startActivity(intent)
    } catch (e: ActivityNotFoundException) {
        try {
            context.startActivity(appDetailsIntent(context))
        } catch (e: ActivityNotFoundException) {
            // Sem nem a página do app: nada a fazer.
        }
    }
}

private fun packageUri(context: Context): Uri = Uri.fromParts("package", context.packageName, null)
