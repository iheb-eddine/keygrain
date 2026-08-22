package com.secbytech.keygrain.data

import android.app.assist.AssistStructure
import android.view.autofill.AutofillId
import org.json.JSONObject
import java.util.Base64
import java.util.Locale

internal sealed interface OtpCandidateResult {
    data object None : OtpCandidateResult
    data class One(val id: AutofillId) : OtpCandidateResult
    data object Ambiguous : OtpCandidateResult
}

internal data class OtpHtmlAttribute(val name: String?, val value: String?)

internal object OtpAutofillDetector {
    fun findCandidate(structure: AssistStructure): OtpCandidateResult {
        val ids = linkedSetOf<AutofillId>()
        for (windowIndex in 0 until structure.windowNodeCount) {
            collect(structure.getWindowNodeAt(windowIndex).rootViewNode, ids)
        }
        return when (ids.size) {
            0 -> OtpCandidateResult.None
            1 -> OtpCandidateResult.One(ids.single())
            else -> OtpCandidateResult.Ambiguous
        }
    }

    private fun collect(node: AssistStructure.ViewNode, ids: MutableSet<AutofillId>) {
        val id = node.autofillId
        if (id != null && hasExactOtpContract(node.htmlInfo?.tag, node.htmlInfo?.attributes)) {
            ids += id
        }
        for (childIndex in 0 until node.childCount) {
            collect(node.getChildAt(childIndex), ids)
        }
    }

    /** The sole HTML authority used by [findCandidate]; attributes are untrusted. */
    internal fun hasExactOtpContract(
        tag: String?,
        attributes: List<android.util.Pair<String?, String?>?>?
    ): Boolean = hasExactOtpContractInternal(
        tag,
        attributes?.map { OtpHtmlAttribute(it?.first, it?.second) }
    )

    internal fun hasExactOtpContractForTest(
        tag: String?,
        attributes: List<OtpHtmlAttribute>?
    ): Boolean = hasExactOtpContractInternal(tag, attributes)

    private fun hasExactOtpContractInternal(
        tag: String?,
        attributes: List<OtpHtmlAttribute>?
    ): Boolean {
        if (!tag.equals("input", ignoreCase = true) || attributes == null) return false
        val autocomplete = attributes.filter {
            it.name?.equals("autocomplete", ignoreCase = true) == true
        }
        if (autocomplete.size != 1) return false
        val value = autocomplete[0].value ?: return false
        return whitespaceTokens(value).any { it.equals("one-time-code", ignoreCase = true) }
    }

    private fun whitespaceTokens(value: String): Sequence<String> = sequence {
        var start = -1
        for (index in value.indices) {
            val separator = value[index].isWhitespace() || Character.isSpaceChar(value[index])
            if (!separator && start < 0) start = index
            if (separator && start >= 0) {
                yield(value.substring(start, index))
                start = -1
            }
        }
        if (start >= 0) yield(value.substring(start))
    }
}

internal enum class Mode { STORED, DERIVED }

internal class ValidatedTotpConfig private constructor(
    val mode: Mode,
    val digits: Int,
    val period: Int,
    val algorithm: String,
    private val seedBytes: ByteArray?
) {
    companion object {
        fun create(mode: Mode, digits: Int, period: Int, algorithm: String, seedBytes: ByteArray?): ValidatedTotpConfig =
            ValidatedTotpConfig(mode, digits, period, algorithm, seedBytes?.copyOf())
    }

    fun seedCopy(): ByteArray? = seedBytes?.copyOf()

    fun clear() {
        seedBytes?.fill(0)
    }
}

internal object TotpAutofillValidator {
    private const val MAX_SEED_BYTES = 128
    private val STANDARD_BASE64 = Regex("[A-Za-z0-9+/]*={0,2}")

    fun validate(totp: JSONObject): ValidatedTotpConfig? {
        return try {
            val modeValue = requiredString(totp, "mode") ?: return null
            val mode = when (modeValue) {
                "stored" -> Mode.STORED
                "derived" -> Mode.DERIVED
                else -> return null
            }

            val digits = optionalIntegral(totp, "digits") ?: 6
            if (digits != 6 && digits != 8) return null
            val period = optionalIntegral(totp, "period") ?: 30
            if (period !in 1..300) return null
            val algorithm = if (!totp.has("algorithm")) {
                "SHA1"
            } else {
                asciiUppercase(optionalString(totp, "algorithm") ?: return null) ?: return null
            }
            if (algorithm !in setOf("SHA1", "SHA256", "SHA512")) return null

            val seed = when (mode) {
                Mode.STORED -> {
                    if (!totp.has("seed") || totp.isNull("seed")) return null
                    decodeCanonicalSeed(requiredString(totp, "seed") ?: return null) ?: return null
                }
                Mode.DERIVED -> {
                    if (totp.has("seed")) return null
                    null
                }
            }
            ValidatedTotpConfig.create(mode, digits, period, algorithm, seed)
        } catch (_: Exception) {
            null
        }
    }

    private fun asciiUppercase(value: String): String? {
        if (value.any { it.code > 0x7F }) return null
        return value.uppercase(Locale.ROOT)
    }

    private fun requiredString(json: JSONObject, key: String): String? {
        if (!json.has(key) || json.isNull(key)) return null
        val value = json.get(key)
        return value as? String
    }

    private fun optionalString(json: JSONObject, key: String): String? {
        if (!json.has(key)) return null
        if (json.isNull(key)) throw IllegalArgumentException("null JSON type")
        val value = json.get(key)
        return value as? String ?: throw IllegalArgumentException("wrong JSON type")
    }

    private fun optionalIntegral(json: JSONObject, key: String): Int? {
        if (!json.has(key)) return null
        if (json.isNull(key)) throw IllegalArgumentException("null JSON type")
        val value = json.get(key)
        val number = when (value) {
            is Int -> value.toLong()
            is Long -> value
            else -> throw IllegalArgumentException("wrong JSON type")
        }
        return number.toInt().also {
            if (number != it.toLong()) throw IllegalArgumentException("out of range")
        }
    }

    private fun decodeCanonicalSeed(encoded: String): ByteArray? {
        if (encoded.isEmpty() || encoded.length % 4 != 0 || !STANDARD_BASE64.matches(encoded)) return null
        val paddingIndex = encoded.indexOf('=')
        if (paddingIndex >= 0 && paddingIndex < encoded.length - 2 && encoded[encoded.length - 1] != '=') return null
        val decoded = try { Base64.getDecoder().decode(encoded) } catch (_: Exception) { return null }
        if (decoded.isEmpty() || decoded.size > MAX_SEED_BYTES) return null
        val canonical = Base64.getEncoder().encodeToString(decoded)
        return if (canonical == encoded) decoded else {
            decoded.fill(0)
            null
        }
    }
}
