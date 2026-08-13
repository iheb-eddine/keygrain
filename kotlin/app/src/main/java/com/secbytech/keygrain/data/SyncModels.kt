package com.secbytech.keygrain.data

import org.json.JSONArray
import org.json.JSONObject

/** Classification of the optional server capability envelope on a sync GET. */
internal enum class CapabilityMetadataClassification {
    /** All capability fields are absent: this is a legacy v2 response. */
    LegacyAbsent,
    /** Complete strict-server metadata; this v2 Android writer cannot preserve it. */
    Strict,
    /** Some, but not all, capability fields are present. */
    Partial,
    /** A capability field has a null, wrong, or unsafe JSON type/value. */
    Malformed,
    /** min_writer_protocol=3 conflicts with the rest of the capability tuple. */
    Contradictory,
    /** Complete and well-typed metadata for an unsupported protocol/capability tuple. */
    Unsupported
}

internal enum class UpgradeRequiredReason {
    Http426,
    StrictMetadata,
    PartialMetadata,
    MalformedMetadata,
    ContradictoryMetadata,
    UnsupportedMetadata
}

/**
 * Exact parser/classifier for the three-field capability envelope. This deliberately does
 * not use JSONObject numeric coercion: accepting 3.0, null, or an out-of-range number would
 * make a malformed server response look compatible.
 */
internal object CapabilityMetadataClassifier {
    private const val PAYLOAD_VERSION = "payload_version"
    private const val MIN_WRITER_PROTOCOL = "min_writer_protocol"
    private const val CAPABILITIES = "capabilities"
    private const val STRICT_PAYLOAD_VERSION = 3
    private const val STRICT_MIN_WRITER_PROTOCOL = 3
    private const val STRICT_CAPABILITY = "account_defaults_immutable_v1"

    fun classify(json: JSONObject): CapabilityMetadataClassification {
        val keys = listOf(PAYLOAD_VERSION, MIN_WRITER_PROTOCOL, CAPABILITIES)
        if (keys.none { json.has(it) }) {
            return CapabilityMetadataClassification.LegacyAbsent
        }

        // Presence is checked separately from validity so null is never mistaken for absent.
        val payloadVersion = readInt(json, PAYLOAD_VERSION)
        val minWriterProtocol = readInt(json, MIN_WRITER_PROTOCOL)
        val capabilities = readCapabilities(json)
        if ((json.has(PAYLOAD_VERSION) && payloadVersion == null) ||
            (json.has(MIN_WRITER_PROTOCOL) && minWriterProtocol == null) ||
            (json.has(CAPABILITIES) && capabilities == null)
        ) {
            return CapabilityMetadataClassification.Malformed
        }
        if (keys.any { !json.has(it) }) {
            return CapabilityMetadataClassification.Partial
        }

        val strictTuple = payloadVersion == STRICT_PAYLOAD_VERSION &&
            minWriterProtocol == STRICT_MIN_WRITER_PROTOCOL &&
            capabilities!!.size == 1 && capabilities[0] == STRICT_CAPABILITY
        if (strictTuple) return CapabilityMetadataClassification.Strict
        if (minWriterProtocol == STRICT_MIN_WRITER_PROTOCOL) {
            return CapabilityMetadataClassification.Contradictory
        }
        return CapabilityMetadataClassification.Unsupported
    }

    fun reasonFor(classification: CapabilityMetadataClassification): UpgradeRequiredReason =
        when (classification) {
            CapabilityMetadataClassification.Strict -> UpgradeRequiredReason.StrictMetadata
            CapabilityMetadataClassification.Partial -> UpgradeRequiredReason.PartialMetadata
            CapabilityMetadataClassification.Malformed -> UpgradeRequiredReason.MalformedMetadata
            CapabilityMetadataClassification.Contradictory -> UpgradeRequiredReason.ContradictoryMetadata
            CapabilityMetadataClassification.Unsupported -> UpgradeRequiredReason.UnsupportedMetadata
            CapabilityMetadataClassification.LegacyAbsent ->
                error("legacy metadata does not require an upgrade reason")
        }

    private fun readInt(json: JSONObject, key: String): Int? {
        if (!json.has(key) || json.isNull(key)) return null
        return when (val value = json.get(key)) {
            is Int -> value
            is Long -> value.takeIf { it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt()
            else -> null
        }
    }

    private fun readCapabilities(json: JSONObject): List<String>? {
        if (!json.has(CAPABILITIES) || json.isNull(CAPABILITIES)) return null
        val array = json.get(CAPABILITIES) as? JSONArray ?: return null
        return buildList(array.length()) {
            for (i in 0 until array.length()) {
                val value = array.get(i)
                if (value !is String) return null
                add(value)
            }
        }
    }
}

sealed class SyncResult {
    data class Success(val services: List<ServiceEntry>, val wallets: List<WalletEntry>, val walletAuditLog: List<WalletAuditEntry>, val syncConflicts: List<SyncConflict>, val status: String) : SyncResult()
    data class AuthError(val httpCode: Int) : SyncResult()
    data class NetworkError(val cause: Throwable) : SyncResult()
    data class ServerError(val httpCode: Int, val body: String) : SyncResult()
    data class IntegrityError(val detail: String) : SyncResult()
    data object UpgradeRequired : SyncResult()
    data object ConflictError : SyncResult()
}

/**
 * Outcome of a server-side delete (DELETE /api/sync/:lookup_id).
 *
 * SAFETY (Invariant #1): the caller MUST treat ONLY [Success] (HTTP 200) and
 * [NotFound] (HTTP 404) as a confirmed delete. Every other variant means the
 * server state is unknown or unchanged — the caller must NOT wipe local data or
 * flip offline_mode, and should allow the user to retry.
 */
sealed class DeleteResult {
    /** HTTP 200 — the record was removed. */
    data object Success : DeleteResult()
    /** HTTP 404 — no record existed. Idempotent; caller treats as success. */
    data object NotFound : DeleteResult()
    /** HTTP 401/403 — credentials rejected; record left unchanged. */
    data class AuthError(val httpCode: Int) : DeleteResult()
    /** HTTP 429 — rate limited; record left unchanged. */
    data object RateLimited : DeleteResult()
    /** Any other non-2xx HTTP status; record state unknown. */
    data class ServerError(val httpCode: Int, val body: String) : DeleteResult()
    /** Transport failure (timeout, connection reset, unreachable). */
    data class NetworkError(val cause: Throwable) : DeleteResult()
}

data class SyncConflict(
    val winnerId: String,
    val loser: JSONObject,
    val detectedAt: String
) {
    fun dedupeKey(): String = "$winnerId+${loser.optString("id", "")}"
    fun toJson(): JSONObject = JSONObject().apply {
        put("winner_id", winnerId)
        put("loser", loser)
        put("detected_at", detectedAt)
    }
    companion object {
        fun fromJson(obj: JSONObject): SyncConflict = SyncConflict(
            winnerId = obj.optString("winner_id", ""),
            loser = obj.optJSONObject("loser") ?: JSONObject(),
            detectedAt = obj.optString("detected_at", "")
        )
    }
}

data class WalletEntry(
    val walletName: String,
    val chain: String,
    val counter: Int = 1,
    val email: String = "",
    val mode: String = "keygrain",
    val createdAt: String = "",
    val updatedAt: String = "",
    val notes: String = ""
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("wallet_name", walletName)
        put("chain", chain)
        put("counter", counter)
        put("email", email)
        put("mode", mode)
        put("created_at", createdAt)
        put("updated_at", updatedAt)
        put("notes", notes)
    }

    companion object {
        fun fromJson(obj: JSONObject): WalletEntry = WalletEntry(
            walletName = obj.optString("wallet_name", ""),
            chain = obj.optString("chain", ""),
            counter = obj.optInt("counter", 1),
            email = obj.optString("email", ""),
            mode = obj.optString("mode", "keygrain"),
            createdAt = obj.optString("created_at", ""),
            updatedAt = obj.optString("updated_at", ""),
            notes = obj.optString("notes", "")
        )

        fun mergeKey(w: WalletEntry): String = "${w.walletName.lowercase()}:${w.chain.lowercase()}"
    }
}

data class WalletAuditEntry(
    val action: String,
    val walletName: String,
    val chain: String,
    val counter: Int,
    val timestamp: String,
    val verification: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("action", action)
        put("wallet_name", walletName)
        put("chain", chain)
        put("counter", counter)
        put("timestamp", timestamp)
        put("verification", verification)
    }

    fun dedupeKey(): String = "$timestamp:$walletName:$chain:$action"

    companion object {
        fun fromJson(obj: JSONObject): WalletAuditEntry = WalletAuditEntry(
            action = obj.optString("action", ""),
            walletName = obj.optString("wallet_name", ""),
            chain = obj.optString("chain", ""),
            counter = obj.optInt("counter", 1),
            timestamp = obj.optString("timestamp", ""),
            verification = obj.optString("verification", "")
        )
    }
}
