package com.badrani.keygrain.data

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object Keygrain {
    const val UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    const val LOWER = "abcdefghjkmnpqrstuvwxyz"
    const val DIGITS = "23456789"
    const val DEFAULT_SYMBOLS = "!@#\$%&*-_=+?"

    private var strengthenCache: Triple<ByteArray, String, ByteArray>? = null

    fun strengthenSecret(secret: ByteArray, email: String): ByteArray {
        val emailLower = email.lowercase()
        strengthenCache?.let { (cachedSecret, cachedEmail, cachedResult) ->
            if (cachedSecret.contentEquals(secret) && cachedEmail == emailLower) {
                return cachedResult
            }
        }
        val salt = "keygrain-strengthen:$emailLower".toByteArray(Charsets.UTF_8)
        val params = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
            .withSalt(salt)
            .withIterations(3)
            .withMemoryAsKB(65536)
            .withParallelism(1)
            .build()
        val generator = Argon2BytesGenerator()
        generator.init(params)
        val result = ByteArray(32)
        generator.generateBytes(secret, result)
        strengthenCache = Triple(secret.copyOf(), emailLower, result)
        return result
    }

    fun clearStrengthenCache() {
        strengthenCache?.let { (cachedSecret, _, cachedResult) ->
            cachedSecret.fill(0)
            cachedResult.fill(0)
        }
        strengthenCache = null
    }

    fun derivePassword(
        secret: ByteArray,
        email: String,
        site: String,
        length: Int = 20,
        symbols: String = DEFAULT_SYMBOLS,
        counter: Int = 1
    ): String {
        require(length >= 8) { "length must be >= 8" }
        require(length <= 128) { "length must be <= 128" }
        require(symbols.isNotEmpty()) { "symbols must not be empty" }
        require(site.isNotEmpty()) { "site must not be empty" }

        val strengthened = strengthenSecret(secret, email)
        val message = "${site.lowercase()}:${email.lowercase()}:$length:$counter".toByteArray()
        return buildPassword(strengthened, message, length, symbols)
    }

    fun deriveAuthPassword(secret: ByteArray, email: String): String {
        val strengthened = strengthenSecret(secret, email)
        val message = "${email.lowercase()}:32:keygrain-auth".toByteArray()
        return buildPassword(strengthened, message, 32, DEFAULT_SYMBOLS)
    }

    private fun buildPassword(secret: ByteArray, message: ByteArray, length: Int, symbols: String): String {
        val key = hmacSha256(secret, message)
        val stream = mutableListOf<Byte>()
        stream.addAll(key.toList())
        var ctr = 1
        var pos = 0

        fun nextByte(): Int {
            if (pos >= stream.size) {
                val ctrBytes = java.nio.ByteBuffer.allocate(4).putInt(ctr).array()
                stream.addAll(hmacSha256(key, ctrBytes).toList())
                ctr++
            }
            val b = stream[pos].toInt() and 0xFF
            pos++
            return b
        }

        fun unbiasedIndex(n: Int): Int {
            val limit = (256 / n) * n
            while (true) {
                val b = nextByte()
                if (b < limit) return b % n
            }
        }

        val fullCharset = UPPER + LOWER + DIGITS + symbols
        val chars = mutableListOf(
            UPPER[unbiasedIndex(UPPER.length)],
            LOWER[unbiasedIndex(LOWER.length)],
            DIGITS[unbiasedIndex(DIGITS.length)],
            symbols[unbiasedIndex(symbols.length)],
        )
        repeat(length - 4) {
            chars.add(fullCharset[unbiasedIndex(fullCharset.length)])
        }
        for (i in (length - 1) downTo 1) {
            val j = unbiasedIndex(i + 1)
            val tmp = chars[i]
            chars[i] = chars[j]
            chars[j] = tmp
        }
        return chars.joinToString("")
    }

    fun deriveLookupId(secret: ByteArray, email: String): String {
        val strengthened = strengthenSecret(secret, email)
        val message = "${email.lowercase()}:keygrain-id".toByteArray()
        return hmacSha256(strengthened, message).joinToString("") { "%02x".format(it) }
    }

    fun deriveEncryptionKey(secret: ByteArray, email: String): ByteArray {
        val strengthened = strengthenSecret(secret, email)
        val message = "${email.lowercase()}:keygrain-encryption".toByteArray()
        return hmacSha256(strengthened, message)
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

    fun estimateEntropy(secret: String): Double {
        if (secret.isEmpty()) return 0.0
        var charsetSize = 0
        if (secret.any { it in 'a'..'z' }) charsetSize += 26
        if (secret.any { it in 'A'..'Z' }) charsetSize += 26
        if (secret.any { it.isDigit() }) charsetSize += 10
        if (secret.any { !it.isLetterOrDigit() }) charsetSize += 32
        return if (charsetSize > 0) secret.length * kotlin.math.ln(charsetSize.toDouble()) / kotlin.math.ln(2.0) else 0.0
    }

    fun entropyLabel(bits: Double): Pair<String, String> = when {
        bits >= 80 -> "Strong" to "strong"
        bits >= 60 -> "Good" to "good"
        bits >= 40 -> "Fair" to "fair"
        else -> "Weak" to "weak"
    }
}
