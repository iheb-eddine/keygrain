package com.badrani.keygrain.data

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object Keygrain {
    const val UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    const val LOWER = "abcdefghjkmnpqrstuvwxyz"
    const val DIGITS = "23456789"
    const val DEFAULT_SYMBOLS = "!@#\$%&*-_=+?"

    fun derivePassword(
        secret: ByteArray,
        email: String,
        length: Int = 20,
        symbols: String = DEFAULT_SYMBOLS,
        salt: String = ""
    ): String {
        require(length >= 8) { "length must be >= 8" }
        require(symbols.isNotEmpty()) { "symbols must not be empty" }

        val normalizedEmail = email.lowercase()
        val message = "$normalizedEmail:$length:$salt".toByteArray()
        val key = hmacSha256(secret, message)

        // Build stream
        val stream = mutableListOf<Byte>()
        stream.addAll(key.toList())
        var counter = 1
        while (stream.size < length * 2) {
            stream.addAll(hmacSha256(key, byteArrayOf(counter.toByte())).toList())
            counter++
        }

        var pos = 0
        fun nextByte(): Int {
            val b = stream[pos].toInt() and 0xFF
            pos++
            return b
        }

        val fullCharset = UPPER + LOWER + DIGITS + symbols

        // Step 2: Force one char from each category
        val chars = mutableListOf(
            UPPER[nextByte() % UPPER.length],
            LOWER[nextByte() % LOWER.length],
            DIGITS[nextByte() % DIGITS.length],
            symbols[nextByte() % symbols.length],
        )

        // Step 3: Fill remaining
        repeat(length - 4) {
            chars.add(fullCharset[nextByte() % fullCharset.length])
        }

        // Step 4: Fisher-Yates shuffle
        for (i in (length - 1) downTo 1) {
            val j = nextByte() % (i + 1)
            val tmp = chars[i]
            chars[i] = chars[j]
            chars[j] = tmp
        }

        return chars.joinToString("")
    }

    fun deriveLookupId(secret: ByteArray, email: String): String {
        val message = "${email.lowercase()}:keygrain-id".toByteArray()
        return hmacSha256(secret, message).joinToString("") { "%02x".format(it) }
    }

    fun deriveAuthPassword(secret: ByteArray, email: String): String {
        return derivePassword(secret, email, length = 32, symbols = DEFAULT_SYMBOLS, salt = "keygrain-auth")
    }

    fun deriveEncryptionKey(secret: ByteArray, email: String): ByteArray {
        val message = "${email.lowercase()}:keygrain-encryption".toByteArray()
        return hmacSha256(secret, message)
    }

    fun secretFingerprint(secret: ByteArray): List<Int> {
        val hash = hmacSha256(secret, "keygrain-fingerprint".toByteArray())
        return (0 until 4).map { (hash[it].toInt() and 0xFF) % 8 }
    }

    internal fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }
}
