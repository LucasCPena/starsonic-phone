package br.com.starsonic.phone.contacts

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.PhoneLookup
import android.util.Log

/**
 * A agenda do Android ([ContactsSource]), pelo ContactsContract, com a permissão READ_CONTACTS: [lookup] pelo
 * PhoneLookup (o Android compara os números do jeito dele: com ou sem o DDI, com separadores...) e [search] pela lista
 * de números (Phone.CONTENT_URI), juntos por contato, sem números repetidos (iguais sem os separadores). Sem a
 * permissão, ou com uma falha da agenda (que vai ao logcat), nada é achado. Nunca na thread principal (ver
 * [ContactsSource]).
 */
class AndroidContactsSource(private val context: Context) : ContactsSource {
    override fun available(): Boolean =
        context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

    override fun lookup(number: String): String? {
        if (number.isBlank() || !available()) return null
        val uri = Uri.withAppendedPath(PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
        return read("o nome de um número") {
            context.contentResolver.query(uri, arrayOf(PhoneLookup.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0)?.takeIf { it.isNotBlank() } else null
            }
        }
    }

    override fun search(text: String): List<Contact> = searchContacts(all(), text)

    // Os contatos com algum número: o nome e os números de cada um, na ordem da agenda.
    private fun all(): List<Contact> {
        if (!available()) return emptyList()
        val projection = arrayOf(Phone.CONTACT_ID, Phone.DISPLAY_NAME, Phone.NUMBER)
        return read("a lista dos contatos") {
            context.contentResolver.query(Phone.CONTENT_URI, projection, null, null, null)?.use { cursor ->
                val found = LinkedHashMap<Long, Pair<String, LinkedHashMap<String, String>>>()
                while (cursor.moveToNext()) {
                    val number = cursor.getString(2)?.trim().orEmpty()
                    if (number.isEmpty()) continue
                    val name = cursor.getString(1)?.trim().orEmpty()
                    val (_, numbers) = found.getOrPut(cursor.getLong(0)) { name to LinkedHashMap() }
                    // O mesmo número gravado duas vezes (com outros separadores, ou de duas contas) aparece uma.
                    val key = number.filter { it.isDigit() || it in "+*#" }.ifEmpty { number }
                    numbers.putIfAbsent(key, number)
                }
                found.values.map { (name, numbers) ->
                    Contact(name.ifEmpty { numbers.values.first() }, numbers.values.toList())
                }
            }
        }.orEmpty()
    }

    // Uma leitura da agenda; a permissão tirada no meio ou uma falha do Android: nada (e o motivo vai ao logcat).
    private fun <T> read(what: String, query: () -> T?): T? =
        try {
            query()
        } catch (e: SecurityException) {
            null
        } catch (e: RuntimeException) {
            Log.w(TAG, "a agenda não deu $what", e)
            null
        }

    private companion object {
        const val TAG = "StarsonicContatos"
    }
}
