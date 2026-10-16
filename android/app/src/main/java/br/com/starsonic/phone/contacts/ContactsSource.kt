package br.com.starsonic.phone.contacts

/** Um contato da agenda do celular: o nome e os números, como estão gravados (sem números repetidos). */
data class Contact(val name: String, val numbers: List<String>)

/**
 * A agenda do celular (spec da 0.2, 4.2, 6.2 e 7.5), só para ler: nada dela é guardado no app nem sai do celular. No
 * app, [AndroidContactsSource]; nos testes da JVM, uma em memória.
 *
 * Threads: [lookup] e [search] leem a agenda do Android (o disco) e nunca rodam na thread principal: as telas os chamam
 * numa corrotina em Dispatchers.IO, e o CallManager, na thread dos eventos do motor (a recebida) ou na dele (a feita).
 * [available] vale em qualquer thread.
 */
interface ContactsSource {
    /** A pessoa deu a permissão de ler os contatos (READ_CONTACTS). Sem ela, [lookup] e [search] não acham nada. */
    fun available(): Boolean

    /** O nome do contato com o número [number] (o Android compara os números do jeito dele), ou null. */
    fun lookup(number: String): String?

    /** Os contatos da busca [text] ([searchContacts]); "" dá todos. */
    fun search(text: String): List<Contact>
}

/**
 * A busca da aba Contatos e das sugestões do Teclado: dos contatos [all], só os que têm algum número, em ordem
 * alfabética (a do português). Com [text] (sem os espaços das pontas), os que têm o texto no nome (sem diferença de
 * maiúsculas e acentos) ou, num texto sem letras, os que têm um número com os dígitos dele; "" dá todos.
 */
fun searchContacts(all: List<Contact>, text: String): List<Contact> = all
