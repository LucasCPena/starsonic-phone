package br.com.starsonic.phone.contacts

/**
 * A agenda falsa, em memória: os contatos de [contacts] e a permissão [granted] (sem ela, como no Android, nada é
 * achado). A busca é a do app ([searchContacts]); o [lookup] acha o contato com um número de dígitos iguais (o do
 * Android, pelo PhoneLookup, é mais solto).
 */
class FakeContactsSource(vararg contacts: Contact) : ContactsSource {
    val contacts = contacts.toMutableList()
    var granted = true

    /** Os números procurados pelo [lookup], na ordem. */
    val lookups = mutableListOf<String>()

    override fun available() = granted

    override fun lookup(number: String): String? {
        lookups += number
        val digits = number.filter(Char::isDigit)
        if (!granted || digits.isEmpty()) return null
        return contacts.firstOrNull { contact -> contact.numbers.any { it.filter(Char::isDigit) == digits } }?.name
    }

    override fun search(text: String): List<Contact> = if (granted) searchContacts(contacts, text) else emptyList()
}
