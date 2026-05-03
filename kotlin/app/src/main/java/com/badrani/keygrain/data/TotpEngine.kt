package com.badrani.keygrain.data

import java.net.URI
import java.net.URLDecoder
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

data class TotpParams(
    val seed: ByteArray,
    val digits: Int,
    val period: Int,
    val algorithm: String,
    val issuer: String?,
    val label: String?
)

object TotpEngine {
    private const val B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    private val HEX_FORCING = setOf('0', '1', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f')

    fun generateTotp(
        seed: ByteArray,
        time: Long,
        digits: Int = 6,
        period: Int = 30,
        algorithm: String = "SHA1"
    ): String {
        require(digits == 6 || digits == 8) { "digits must be 6 or 8" }
        require(period >= 1) { "period must be >= 1" }
        val macAlgo = when (algorithm.uppercase()) {
            "SHA1" -> "HmacSHA1"
            "SHA256" -> "HmacSHA256"
            "SHA512" -> "HmacSHA512"
            else -> throw IllegalArgumentException("Unsupported algorithm: $algorithm")
        }

        val t = time / period
        val tBytes = ByteArray(8)
        for (i in 7 downTo 0) { tBytes[7 - i] = ((t shr (i * 8)) and 0xFF).toByte() }

        val mac = Mac.getInstance(macAlgo)
        mac.init(SecretKeySpec(seed, macAlgo))
        val hmacResult = mac.doFinal(tBytes)

        val offset = (hmacResult[hmacResult.size - 1].toInt() and 0x0F)
        val code = (
            (hmacResult[offset].toInt() and 0x7F shl 24) or
            (hmacResult[offset + 1].toInt() and 0xFF shl 16) or
            (hmacResult[offset + 2].toInt() and 0xFF shl 8) or
            (hmacResult[offset + 3].toInt() and 0xFF)
        ).toLong() and 0xFFFFFFFFL

        val otp = code % pow10(digits)
        return otp.toString().padStart(digits, '0')
    }

    fun parseTotpInput(input: String): TotpParams {
        val trimmed = input.trim()
        require(trimmed.isNotEmpty()) { "Empty input" }

        // Priority 1: otpauth:// URI
        if (trimmed.startsWith("otpauth://")) return parseOtpauth(trimmed)

        // Priority 2: Hex
        if (trimmed.length >= 20 && trimmed.length % 2 == 0 && trimmed.all { it in "0123456789abcdefABCDEF" }) {
            if (trimmed.any { it in HEX_FORCING }) {
                val seed = hexDecode(trimmed)
                return TotpParams(seed, 6, 30, "SHA1", null, null)
            }
        }

        // Priority 3: Base32
        val cleaned = trimmed.replace(Regex("[\\s\\-=]"), "").uppercase()
        if (cleaned.isNotEmpty() && cleaned.all { it in B32_ALPHABET }) {
            val seed = base32Decode(trimmed)
            return TotpParams(seed, 6, 30, "SHA1", null, null)
        }

        throw IllegalArgumentException("Cannot parse TOTP input: $trimmed")
    }

    fun deriveTotpSeed(secret: ByteArray, email: String, site: String): ByteArray {
        val strengthened = Keygrain.strengthenSecret(secret, email)
        val normalizedSite = Keygrain.normalizeSite(site)
        val message = "$normalizedSite:${email.lowercase()}:keygrain-totp".toByteArray(Charsets.UTF_8)
        return Keygrain.hmacSha256(strengthened, message)
    }

    fun seedToBase32(seed: ByteArray): String {
        val bits = StringBuilder()
        for (b in seed) bits.append((b.toInt() and 0xFF).toString(2).padStart(8, '0'))
        val result = StringBuilder()
        var i = 0
        while (i < bits.length) {
            val chunk = bits.substring(i, minOf(i + 5, bits.length)).padEnd(5, '0')
            result.append(B32_ALPHABET[chunk.toInt(2)])
            i += 5
        }
        return result.toString()
    }

    private fun parseOtpauth(uri: String): TotpParams {
        val parsed = URI(uri)
        require(parsed.scheme == "otpauth") { "Not an otpauth URI" }
        require(parsed.host == "totp") { "Only TOTP is supported (not HOTP)" }

        val params = parseQueryParams(parsed.rawQuery ?: "")
        val secretParam = params["secret"] ?: throw IllegalArgumentException("Missing secret parameter")
        val seed = base32Decode(secretParam)

        val algo = (params["algorithm"] ?: "SHA1").uppercase()
        require(algo in listOf("SHA1", "SHA256", "SHA512")) { "Unsupported algorithm: $algo" }

        val digits = (params["digits"] ?: "6").toInt()
        require(digits == 6 || digits == 8) { "digits must be 6 or 8, got $digits" }

        val period = (params["period"] ?: "30").toInt()
        require(period in 1..300) { "period must be 1-300, got $period" }

        val issuer = params["issuer"]
        val label = if (parsed.path?.length ?: 0 > 1) URLDecoder.decode(parsed.path.removePrefix("/"), "UTF-8") else null

        return TotpParams(seed, digits, period, algo, issuer, label)
    }

    private fun parseQueryParams(query: String): Map<String, String> {
        if (query.isEmpty()) return emptyMap()
        return query.split("&").associate { param ->
            val parts = param.split("=", limit = 2)
            URLDecoder.decode(parts[0], "UTF-8") to URLDecoder.decode(parts.getOrElse(1) { "" }, "UTF-8")
        }
    }

    private fun base32Decode(input: String): ByteArray {
        val cleaned = input.replace(Regex("[\\s\\-=]"), "").uppercase()
        require(cleaned.isNotEmpty()) { "Empty base32 input" }
        require(cleaned.all { it in B32_ALPHABET }) { "Invalid base32 character" }
        val bits = StringBuilder()
        for (c in cleaned) bits.append(B32_ALPHABET.indexOf(c).toString(2).padStart(5, '0'))
        return ByteArray(bits.length / 8) { i -> bits.substring(i * 8, i * 8 + 8).toInt(2).toByte() }
    }

    private fun hexDecode(hex: String): ByteArray =
        ByteArray(hex.length / 2) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }

    private fun pow10(n: Int): Long = when (n) {
        6 -> 1_000_000L
        8 -> 100_000_000L
        else -> throw IllegalArgumentException("Unsupported digits: $n")
    }
}
