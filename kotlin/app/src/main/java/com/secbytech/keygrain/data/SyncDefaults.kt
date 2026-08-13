package com.secbytech.keygrain.data

/** The immutable semantic account-defaults value used by the v3 commitment. */
internal data class AccountDefaults(
    val schema: Int,
    val length: Int,
    val symbols: String,
    val policy: String
) {
    init {
        require(schema == SCHEMA) { "unsupported defaults schema" }
        require(length in MIN_LENGTH..MAX_LENGTH) { "defaults length is invalid" }
        require(policy == POLICY) { "defaults policy is invalid" }
        require(symbols.isNotEmpty() && symbols.all { it.code in PRINTABLE_ASCII }) {
            "defaults symbols are invalid"
        }
        require(UPPER.length + LOWER.length + DIGITS.length + symbols.length <= MAX_CHARSET) {
            "defaults charset is too large"
        }
    }

    fun canonicalJson(): String = SyncDefaults.canonicalJson(this)

    companion object {
        const val SCHEMA = 1
        const val MIN_LENGTH = 8
        const val MAX_LENGTH = 128
        const val POLICY = "ascii-printable-v1"
        private const val MAX_CHARSET = 256
        private val PRINTABLE_ASCII = 0x21..0x7e
        private const val UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
        private const val LOWER = "abcdefghjkmnpqrstuvwxyz"
        private const val DIGITS = "23456789"
    }
}

internal enum class DefaultsState {
    UNSEALED,
    ABSENT,
    PRESENT
}

internal object SyncDefaults {
    private const val COMMITMENT_DOMAIN = "keygrain-account-defaults-v1\u0000"
    private const val V3_AAD_DOMAIN = "keygrain-sync-v3\u0000"
    private const val EMAIL_MAX_BYTES = 254
    private val normalizedEmailPattern = Regex(
        "^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@" +
            "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" +
            "(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$"
    )
    private val lowercaseHex64Pattern = Regex("^[0-9a-f]{64}$")

    fun canonicalJson(defaults: AccountDefaults): String = buildString {
        append("{\"length\":")
        append(defaults.length)
        append(",\"policy\":\"")
        append(escapeJsonString(defaults.policy))
        append("\",\"schema\":")
        append(defaults.schema)
        append(",\"symbols\":\"")
        append(escapeJsonString(defaults.symbols))
        append("\"}")
    }

    fun deriveDefaultsCommitment(
        strengthened: ByteArray,
        normalizedEmail: String,
        defaults: AccountDefaults
    ): String {
        require(strengthened.size == 32) { "strengthened key must be exactly 32 bytes" }
        require(isNormalizedEmail(normalizedEmail)) { "normalized email is invalid" }

        val strengthenedCopy = strengthened.copyOf()
        val derivationMessage = normalizedEmail
            .plus(":keygrain-defaults-commitment")
            .toByteArray(Charsets.UTF_8)
        var commitKey: ByteArray? = null
        var commitmentMessage: ByteArray? = null
        var commitmentBytes: ByteArray? = null
        try {
            commitKey = Keygrain.hmacSha256(strengthenedCopy, derivationMessage)
            commitmentMessage = (COMMITMENT_DOMAIN + defaults.canonicalJson())
                .toByteArray(Charsets.UTF_8)
            commitmentBytes = Keygrain.hmacSha256(commitKey, commitmentMessage)
            return commitmentBytes.joinToString("") { "%02x".format(it) }
        } finally {
            strengthenedCopy.fill(0)
            derivationMessage.fill(0)
            commitmentMessage?.fill(0)
            commitKey?.fill(0)
            commitmentBytes?.fill(0)
        }
    }

    fun buildV3SyncAAD(
        lookupId: String,
        defaultsState: DefaultsState,
        commitment: String?
    ): ByteArray {
        require(lowercaseHex64Pattern.matches(lookupId)) { "lookup id is invalid" }
        when (defaultsState) {
            DefaultsState.PRESENT ->
                require(commitment != null && lowercaseHex64Pattern.matches(commitment)) {
                    "present defaults commitment is invalid"
                }
            DefaultsState.UNSEALED, DefaultsState.ABSENT ->
                require(commitment == null) { "unsealed or absent defaults must not have a commitment" }
        }
        return (V3_AAD_DOMAIN + lookupId + "\u0000" + defaultsState.name +
            "\u0000" + (commitment ?: "")).toByteArray(Charsets.UTF_8)
    }

    private fun isNormalizedEmail(email: String): Boolean {
        val bytes = email.toByteArray(Charsets.UTF_8)
        return bytes.isNotEmpty() && bytes.size <= EMAIL_MAX_BYTES &&
            bytes.all { (it.toInt() and 0xff) <= 0x7f } &&
            normalizedEmailPattern.matches(email)
    }

    private fun escapeJsonString(value: String): String = buildString {
        for (character in value) {
            when (character) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\b' -> append("\\b")
                '\t' -> append("\\t")
                '\n' -> append("\\n")
                '\u000C' -> append("\\f")
                '\r' -> append("\\r")
                else -> {
                    if (character.code < 0x20) {
                        append("\\u")
                        append(character.code.toString(16).padStart(4, '0'))
                    } else {
                        append(character)
                    }
                }
            }
        }
    }
}
