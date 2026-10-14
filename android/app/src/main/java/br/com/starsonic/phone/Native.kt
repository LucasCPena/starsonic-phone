package br.com.starsonic.phone

/**
 * Funções do núcleo em C++ (starsonic/core) pela ponte JNI de libstarsonic.so (src/main/cpp).
 * Os textos vêm prontos do núcleo, em pt-BR, os mesmos do Windows.
 */
object Native {
    init {
        System.loadLibrary("starsonic")
    }

    /** ValidateServerAddress: [ok|empty|invalid, endereço normalizado (vazio quando não é ok)]. */
    external fun validateServer(raw: String): Array<String>

    /** ValidateRamal: [ok|empty|invalid, ramal normalizado (vazio quando não é ok)]. */
    external fun validateRamal(raw: String): Array<String>

    /** RegistrationMessage (sem TLS no Android): o aviso de uma falha do registro; "" para 100 a 299. */
    external fun registrationMessage(code: Int): String

    /** CallEndMessage: o aviso de uma ligação que não completou; "" quando não há o que avisar. */
    external fun callEndMessage(code: Int): String

    /** NormalizeDialString: o número a discar, sem espaços, traços, pontos e parênteses. */
    external fun normalizeDialString(raw: String): String
}
