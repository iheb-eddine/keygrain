package com.secbytech.keygrain.data

import org.json.JSONObject

sealed class SyncResult {
    data class Success(val services: List<ServiceEntry>, val wallets: List<WalletEntry>, val walletAuditLog: List<WalletAuditEntry>, val syncConflicts: List<SyncConflict>, val status: String) : SyncResult()
    data class AuthError(val httpCode: Int) : SyncResult()
    data class NetworkError(val cause: Throwable) : SyncResult()
    data class ServerError(val httpCode: Int, val body: String) : SyncResult()
    data class IntegrityError(val detail: String) : SyncResult()
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
