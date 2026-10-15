package br.com.starsonic.phone.core

import br.com.starsonic.phone.Native

/** As [CoreRules] do app: o núcleo em C++ pela ponte JNI (libstarsonic.so). */
object NativeCoreRules : CoreRules {
    override fun validateServer(raw: String): Pair<Check, String> = checked(Native.validateServer(raw))

    override fun validateRamal(raw: String): Pair<Check, String> = checked(Native.validateRamal(raw))

    override fun registrationMessage(code: Int): String = Native.registrationMessage(code)

    override fun callEndMessage(code: Int): String = Native.callEndMessage(code)

    override fun normalizeDialString(raw: String): String = Native.normalizeDialString(raw)

    override fun parseManifest(json: String, allowedPrefix: String, onError: (String) -> Unit): Manifest? {
        val (error, version, installer, sha256, notes) = Native.parseManifest(json, allowedPrefix)
        if (error.isNotEmpty()) {
            onError(error)
            return null
        }
        return Manifest(version, installer, sha256, notes)
    }

    override fun compareVersions(a: String, b: String): Int = Native.compareVersions(a, b)

    // [ok|empty|invalid, texto] da ponte.
    private fun checked(result: Array<String>): Pair<Check, String> {
        val check = when (result[0]) {
            "ok" -> Check.OK
            "empty" -> Check.EMPTY
            else -> Check.INVALID
        }
        return check to result[1]
    }
}
