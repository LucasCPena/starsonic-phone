package br.com.starsonic.phone.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Cifra a senha da conta com AES-GCM e uma chave do Android Keystore (alias starsonic-senha), que não sai do
 * celular (spec 6.4). O texto cifrado é Base64 de: o tamanho do IV (1 byte), o IV e a senha cifrada com a tag.
 */
class PasswordCipher(private val alias: String = ALIAS, private val log: (String) -> Unit = {}) {
    fun encrypt(senha: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())   // o Keystore escolhe o IV
        val iv = cipher.iv
        val sealed = cipher.doFinal(senha.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(byteArrayOf(iv.size.toByte()) + iv + sealed)
    }

    /** A senha, ou null se o texto não abre (a chave sumiu do Keystore ou o dado está estragado). */
    fun decrypt(text: String): String? {
        return try {
            val key = existingKey() ?: return null
            val bytes = Base64.getDecoder().decode(text)
            val ivSize = bytes[0].toInt()
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, bytes, 1, ivSize))
            String(cipher.doFinal(bytes, 1 + ivSize, bytes.size - 1 - ivSize), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }

    // Uma chave só, criada na primeira vez (duas threads ao mesmo tempo não criam duas).
    @Synchronized
    private fun key(): SecretKey = existingKey() ?: newKey()

    private fun existingKey(): SecretKey? {
        val keyStore = KeyStore.getInstance(KEYSTORE)
        keyStore.load(null)
        return keyStore.getKey(alias, null) as? SecretKey
    }

    private fun newKey(): SecretKey {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(KEY_BITS)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val ALIAS = "starsonic-senha"
        const val KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val KEY_BITS = 256
        const val TAG_BITS = 128
    }
}
