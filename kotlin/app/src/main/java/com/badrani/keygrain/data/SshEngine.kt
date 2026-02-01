package com.badrani.keygrain.data

import android.util.Base64
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters

data class SshKeypair(
    val seed: ByteArray,
    val publicKey: ByteArray
)

object SshEngine {
    fun deriveSshKeypair(
        secret: ByteArray,
        email: String,
        keyName: String,
        counter: Int = 1
    ): SshKeypair {
        require(keyName.isNotEmpty()) { "keyName must not be empty" }
        require(!keyName.contains(Regex("\\s"))) { "keyName must not contain whitespace" }
        require(counter >= 1) { "counter must be >= 1" }
        require(!email.contains(Regex("[\\x00-\\x1f\\x7f]"))) { "email must not contain control characters" }

        val strengthened = Keygrain.strengthenSecret(secret, email)
        val message = "${email.lowercase()}:${keyName.lowercase()}:$counter:keygrain-ssh".toByteArray(Charsets.UTF_8)
        val seed = Keygrain.hmacSha256(strengthened, message)

        val privateKey = Ed25519PrivateKeyParameters(seed, 0)
        val publicKey = privateKey.generatePublicKey().encoded

        return SshKeypair(seed, publicKey)
    }

    fun formatAuthorizedKeys(publicKey: ByteArray, comment: String): String {
        require(!comment.contains(Regex("[\\x00-\\x1f\\x7f]"))) { "comment must not contain control characters" }
        val keyType = "ssh-ed25519".toByteArray(Charsets.UTF_8)
        val blob = ByteArray(4 + keyType.size + 4 + publicKey.size)
        var offset = 0
        putUint32(blob, offset, keyType.size); offset += 4
        keyType.copyInto(blob, offset); offset += keyType.size
        putUint32(blob, offset, publicKey.size); offset += 4
        publicKey.copyInto(blob, offset)

        val b64 = Base64.encodeToString(blob, Base64.NO_WRAP)
        return "ssh-ed25519 $b64 $comment"
    }

    private fun putUint32(buf: ByteArray, offset: Int, value: Int) {
        buf[offset] = (value shr 24 and 0xFF).toByte()
        buf[offset + 1] = (value shr 16 and 0xFF).toByte()
        buf[offset + 2] = (value shr 8 and 0xFF).toByte()
        buf[offset + 3] = (value and 0xFF).toByte()
    }
}
