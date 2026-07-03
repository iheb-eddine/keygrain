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

    /**
     * Format an Ed25519 keypair as an OpenSSH PEM private key string.
     *
     * @param seed 32-byte Ed25519 seed
     * @param publicKey 32-byte Ed25519 public key
     * @param comment Key comment (e.g. "email:keyname")
     * @return OpenSSH PEM-formatted private key string
     */
    fun formatOpensshPrivateKey(seed: ByteArray, publicKey: ByteArray, comment: String): String {
        require(!comment.contains(Regex("[\\x00-\\x1f\\x7f]"))) { "comment must not contain control characters" }

        // Deterministic check bytes: HMAC-SHA256(seed, "openssh-check")[0:4] as big-endian uint32
        val checkBytes = Keygrain.hmacSha256(seed, "openssh-check".toByteArray(Charsets.UTF_8))
        val checkInt = ((checkBytes[0].toInt() and 0xFF) shl 24) or
                ((checkBytes[1].toInt() and 0xFF) shl 16) or
                ((checkBytes[2].toInt() and 0xFF) shl 8) or
                (checkBytes[3].toInt() and 0xFF)

        val keyType = "ssh-ed25519".toByteArray(Charsets.UTF_8)

        // Public key blob: string "ssh-ed25519" + string public_key
        val pubBlob = ByteArray(4 + keyType.size + 4 + publicKey.size)
        var po = 0
        putUint32(pubBlob, po, keyType.size); po += 4
        keyType.copyInto(pubBlob, po); po += keyType.size
        putUint32(pubBlob, po, publicKey.size); po += 4
        publicKey.copyInto(pubBlob, po)

        // Private section
        val commentBytes = comment.toByteArray(Charsets.UTF_8)
        val privLen = 4 + 4 + (4 + keyType.size) + (4 + publicKey.size) + (4 + 64) + (4 + commentBytes.size)
        val padLen = (8 - privLen % 8) % 8
        val privSection = ByteArray(privLen + padLen)
        var ps = 0
        putUint32(privSection, ps, checkInt); ps += 4
        putUint32(privSection, ps, checkInt); ps += 4
        putUint32(privSection, ps, keyType.size); ps += 4
        keyType.copyInto(privSection, ps); ps += keyType.size
        putUint32(privSection, ps, publicKey.size); ps += 4
        publicKey.copyInto(privSection, ps); ps += publicKey.size
        putUint32(privSection, ps, 64); ps += 4
        seed.copyInto(privSection, ps); ps += seed.size
        publicKey.copyInto(privSection, ps); ps += publicKey.size
        putUint32(privSection, ps, commentBytes.size); ps += 4
        commentBytes.copyInto(privSection, ps); ps += commentBytes.size
        // Padding: bytes 1, 2, 3, ..., N
        for (i in 0 until padLen) privSection[ps + i] = (i + 1).toByte()

        // Outer structure
        val authMagic = "openssh-key-v1".toByteArray(Charsets.UTF_8)
        val cipherName = "none".toByteArray(Charsets.UTF_8)
        val kdfName = "none".toByteArray(Charsets.UTF_8)
        val outerLen = authMagic.size + 1 + (4 + cipherName.size) + (4 + kdfName.size) + (4 + 0) + 4 + (4 + pubBlob.size) + (4 + privSection.size)
        val outer = ByteArray(outerLen)
        var oo = 0
        authMagic.copyInto(outer, oo); oo += authMagic.size
        outer[oo] = 0; oo += 1 // null terminator
        putUint32(outer, oo, cipherName.size); oo += 4
        cipherName.copyInto(outer, oo); oo += cipherName.size
        putUint32(outer, oo, kdfName.size); oo += 4
        kdfName.copyInto(outer, oo); oo += kdfName.size
        putUint32(outer, oo, 0); oo += 4 // kdfoptions (empty string)
        putUint32(outer, oo, 1); oo += 4 // number of keys
        putUint32(outer, oo, pubBlob.size); oo += 4
        pubBlob.copyInto(outer, oo); oo += pubBlob.size
        putUint32(outer, oo, privSection.size); oo += 4
        privSection.copyInto(outer, oo)

        // Base64 encode, split into 70-char lines
        val b64 = Base64.encodeToString(outer, Base64.NO_WRAP)
        val lines = b64.chunked(70).joinToString("\n")

        return "-----BEGIN OPENSSH PRIVATE KEY-----\n$lines\n-----END OPENSSH PRIVATE KEY-----\n"
    }

    private fun putUint32(buf: ByteArray, offset: Int, value: Int) {
        buf[offset] = (value shr 24 and 0xFF).toByte()
        buf[offset + 1] = (value shr 16 and 0xFF).toByte()
        buf[offset + 2] = (value shr 8 and 0xFF).toByte()
        buf[offset + 3] = (value and 0xFF).toByte()
    }
}
