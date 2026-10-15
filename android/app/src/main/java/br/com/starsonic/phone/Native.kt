package br.com.starsonic.phone

/**
 * Funções do núcleo em C++ (starsonic/core) pela ponte JNI de libstarsonic.so (src/main/cpp).
 * Os textos vêm prontos do núcleo, em pt-BR, os mesmos do Windows.
 */
object Native {
    init {
        System.loadLibrary("starsonic")
    }

    /** ValidateServerAddress: [ok, endereço normalizado] ou [empty|invalid, aviso da tela Entrar]. */
    external fun validateServer(raw: String): Array<String>

    /** ValidateRamal: [ok, ramal normalizado] ou [empty|invalid, aviso da tela Entrar]. */
    external fun validateRamal(raw: String): Array<String>

    /** RegistrationMessage (sem TLS no Android): o aviso de uma falha do registro; "" para 100 a 299. */
    external fun registrationMessage(code: Int): String

    /** CallEndMessage: o aviso de uma ligação que não completou; "" quando não há o que avisar. */
    external fun callEndMessage(code: Int): String

    /** NormalizeDialString: o número a discar, sem espaços, traços, pontos e parênteses. */
    external fun normalizeDialString(raw: String): String

    /** O protocolo padrão do perfil (o texto do perfil.ini), o do campo Protocolo: "udp", "tcp" ou "" (perfil inválido). */
    external fun profileTransport(profileText: String): String

    /**
     * ParseManifest com o endereço permitido do APK: [motivo, versão, APK, SHA-256, notas]. O motivo (em ASCII, para o
     * log) é "" quando o arquivo vale; quando não vale, os outros quatro ficam vazios.
     */
    external fun parseManifest(json: String, allowedPrefix: String): Array<String>

    /** CompareVersions de duas versões em texto (ParseVersion): -1, 0 ou 1; 0 se alguma não é versão. */
    external fun compareVersions(a: String, b: String): Int
}
