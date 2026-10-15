package br.com.starsonic.phone

import android.app.Application
import br.com.starsonic.phone.data.AccountStore
import br.com.starsonic.phone.data.PreferencesAccountStore
import br.com.starsonic.phone.engine.NativeSipGateway
import br.com.starsonic.phone.engine.SipGateway

/** O aplicativo (android:name do manifesto): o que vive com o processo. */
class App : Application() {
    /** O motor de ligações (um por processo). */
    val gateway: SipGateway by lazy { NativeSipGateway() }

    /** A conta gravada no celular. */
    val store: AccountStore by lazy { PreferencesAccountStore(this) }
}
