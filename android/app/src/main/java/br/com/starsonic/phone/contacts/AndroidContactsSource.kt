package br.com.starsonic.phone.contacts

import android.content.Context

/** A agenda do Android. */
class AndroidContactsSource(private val context: Context) : ContactsSource {
    override fun available(): Boolean = false

    override fun lookup(number: String): String? = null

    override fun search(text: String): List<Contact> = emptyList()
}
