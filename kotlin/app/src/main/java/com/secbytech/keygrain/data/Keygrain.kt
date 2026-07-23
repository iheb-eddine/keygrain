package com.secbytech.keygrain.data

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object Keygrain {
    const val UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    const val LOWER = "abcdefghjkmnpqrstuvwxyz"
    const val DIGITS = "23456789"
    const val DEFAULT_SYMBOLS = "!@#\$%&*-_=+?"

    private val cacheLock = Any()

    /**
     * Max number of distinct strengthened keys kept in memory. A user can hold
     * services under several different emails; a single-entry cache would thrash
     * — re-running Argon2id on every email switch — which stalled the UI. Each
     * email needs exactly one strengthen (shared by password/id/auth/encryption).
     */
    private const val STRENGTHEN_CACHE_CAPACITY = 8

    private class StrengthenEntry(val secret: ByteArray, val result: ByteArray)

    // Access-ordered LRU. The eldest entry is evicted (and zeroed) past capacity.
    private val strengthenCache =
        object : LinkedHashMap<String, StrengthenEntry>(16, 0.75f, true) {
            override fun removeEldestEntry(
                eldest: MutableMap.MutableEntry<String, StrengthenEntry>
            ): Boolean {
                if (size > STRENGTHEN_CACHE_CAPACITY) {
                    eldest.value.secret.fill(0)
                    eldest.value.result.fill(0)
                    return true
                }
                return false
            }
        }

    fun strengthenSecret(secret: ByteArray, email: String): ByteArray = synchronized(cacheLock) {
        val emailLower = email.lowercase()
        strengthenCache[emailLower]?.let { cached ->
            if (cached.secret.contentEquals(secret)) {
                return cached.result.copyOf()
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
        // Insert; zero any previous entry stored under this email (e.g. secret changed).
        val previous = strengthenCache.put(emailLower, StrengthenEntry(secret.copyOf(), result))
        if (previous != null) {
            previous.secret.fill(0)
            previous.result.fill(0)
        }
        return result.copyOf()
    }

    fun clearStrengthenCache() = synchronized(cacheLock) {
        for (entry in strengthenCache.values) {
            entry.secret.fill(0)
            entry.result.fill(0)
        }
        strengthenCache.clear()
    }

    fun derivePassword(
        secret: ByteArray,
        email: String,
        site: String,
        length: Int = 20,
        symbols: String = DEFAULT_SYMBOLS,
        counter: Int = 1
    ): String {
        require(secret.isNotEmpty()) { "secret must not be empty" }
        require(email.isNotBlank()) { "email must not be empty" }
        require(length >= 8) { "length must be >= 8" }
        require(length <= 128) { "length must be <= 128" }
        require(counter >= 1) { "counter must be >= 1" }
        require(symbols.isNotEmpty()) { "symbols must not be empty" }
        require(UPPER.length + LOWER.length + DIGITS.length + symbols.length <= 256) { "symbols too long (full charset exceeds 256 characters)" }
        val normalizedSite = normalizeSite(site)
        require(normalizedSite.isNotEmpty()) { "site must not be empty" }

        val strengthened = strengthenSecret(secret, email)
        val message = "$normalizedSite:${email.lowercase()}:$length:$counter".toByteArray(Charsets.UTF_8)
        return buildPassword(strengthened, message, length, symbols)
    }

    fun deriveAuthPassword(secret: ByteArray, email: String): String {
        val strengthened = strengthenSecret(secret, email)
        val message = "${email.lowercase()}:32:keygrain-auth".toByteArray(Charsets.UTF_8)
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
        val message = "${email.lowercase()}:keygrain-id".toByteArray(Charsets.UTF_8)
        return hmacSha256(strengthened, message).joinToString("") { "%02x".format(it) }
    }

    fun deriveEncryptionKey(secret: ByteArray, email: String): ByteArray {
        val strengthened = strengthenSecret(secret, email)
        val message = "${email.lowercase()}:keygrain-encryption".toByteArray(Charsets.UTF_8)
        return hmacSha256(strengthened, message)
    }

    fun secretFingerprint(secret: ByteArray): List<Int> {
        val hash = hmacSha256(secret, "keygrain-fingerprint".toByteArray(Charsets.UTF_8))
        return (0 until 4).map { (hash[it].toInt() and 0xFF) % 8 }
    }

    internal fun normalizeSite(site: String): String {
        var s = site.replace(Regex("^https?://", RegexOption.IGNORE_CASE), "")
        s = s.split("/")[0].split("?")[0].split("#")[0]
            .trimEnd('/').lowercase()
        return s.removePrefix("www.")
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
