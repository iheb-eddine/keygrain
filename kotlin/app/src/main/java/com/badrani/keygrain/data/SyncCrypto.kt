package com.badrani.keygrain.data

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

internal object SyncCrypto {
    private const val IV_SIZE = 12
    private const val TAG_BITS = 128
    private const val MIN_BLOB_SIZE = 28 // IV(12) + tag(16) + 0 bytes ciphertext

    fun encrypt(key: ByteArray, plaintext: ByteArray): ByteArray {
        val iv = ByteArray(IV_SIZE).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        val ciphertextWithTag = cipher.doFinal(plaintext)
        return iv + ciphertextWithTag
    }

    fun decrypt(key: ByteArray, blob: ByteArray): ByteArray {
        require(blob.size >= MIN_BLOB_SIZE) { "Blob too short: ${blob.size} bytes" }
        val iv = blob.copyOfRange(0, IV_SIZE)
        val ciphertextWithTag = blob.copyOfRange(IV_SIZE, blob.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        return cipher.doFinal(ciphertextWithTag)
    }
}
