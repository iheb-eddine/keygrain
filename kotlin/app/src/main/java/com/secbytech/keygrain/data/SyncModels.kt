package com.secbytech.keygrain.data

import org.json.JSONObject

sealed class SyncResult {
    data class Success(
        val services: List<ServiceEntry>,
        val sshKeys: List<SshKeyEntry> = emptyList(),
        val wallets: List<WalletEntry>,
        val walletAuditLog: List<WalletAuditEntry>,
        val syncConflicts: List<SyncConflict>,
        val status: String
    ) : SyncResult()
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
    val id: String = java.util.UUID.randomUUID().toString(),
    val walletId: String = "",
    val label: String = "",
    val words: Int = 24,
    val counter: Int = 1,
    val createdAt: String = "",
    val updatedAt: String = "",
    val notes: String = "",
    val synced: Boolean = false,
    val walletName: String = walletId,
    val chain: String = "universal",
    val email: String = "",
    val mode: String = "keygrain"
) {
    fun toJson(): JSONObject = JSONObject().apply {
        // If legacy format (wallet_name present without wallet_id), preserve legacy keys
        if (walletId.isEmpty() && walletName.isNotEmpty()) {
            put("wallet_name", walletName)
            put("chain", chain)
            put("counter", counter)
            put("email", email)
            put("mode", mode)
            put("created_at", createdAt)
            put("updated_at", updatedAt)
            put("notes", notes)
        } else {
            put("id", id)
            put("wallet_id", if (walletId.isNotEmpty()) walletId else walletName)
            put("label", if (label.isNotEmpty()) label else walletName)
            put("words", words)
            put("counter", counter)
            put("created_at", createdAt)
            put("updated_at", updatedAt)
            put("notes", notes)
        }
    }

    companion object {
        fun fromJson(obj: JSONObject): WalletEntry {
            val wid = if (obj.has("wallet_id")) obj.optString("wallet_id", "") else obj.optString("wallet_name", "")
            val lbl = if (obj.has("label")) obj.optString("label", "") else obj.optString("wallet_name", wid)
            val wName = if (obj.has("wallet_name")) obj.optString("wallet_name", wid) else wid
            val idVal = if (obj.has("id")) obj.optString("id", "") else java.util.UUID.randomUUID().toString()
            return WalletEntry(
                id = idVal,
                walletId = wid,
                label = lbl,
                words = obj.optInt("words", 24),
                counter = obj.optInt("counter", 1),
                createdAt = obj.optString("created_at", ""),
                updatedAt = obj.optString("updated_at", ""),
                notes = obj.optString("notes", ""),
                walletName = wName,
                chain = obj.optString("chain", "universal"),
                email = obj.optString("email", ""),
                mode = obj.optString("mode", "keygrain")
            )
        }

        fun mergeKey(w: WalletEntry): String {
            val primary = if (w.walletId.isNotEmpty()) w.walletId else w.walletName
            val secondary = if (w.chain.isNotEmpty()) w.chain else "universal"
            return "${primary.lowercase()}:${secondary.lowercase()}"
        }
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

data class SshKeyEntry(
    val id: String = java.util.UUID.randomUUID().toString(),
    val keyName: String = "",
    val counter: Int = 1,
    val email: String = "",
    val comment: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("key_name", keyName)
        put("counter", counter)
        if (email.isNotEmpty()) put("email", email)
        if (comment.isNotEmpty()) put("comment", comment)
        put("created_at", createdAt)
        put("updated_at", updatedAt)
    }

    companion object {
        fun fromJson(obj: JSONObject): SshKeyEntry {
            val kn = obj.optString("key_name", "")
            val emailVal = obj.optString("email", "")
            val commentVal = obj.optString("comment", kn)
            return SshKeyEntry(
                id = if (obj.has("id")) obj.optString("id", "") else java.util.UUID.randomUUID().toString(),
                keyName = kn,
                counter = obj.optInt("counter", 1),
                email = emailVal,
                comment = commentVal,
                createdAt = obj.optLong("created_at", System.currentTimeMillis()),
                updatedAt = obj.optLong("updated_at", System.currentTimeMillis())
            )
        }

        fun mergeKey(entry: SshKeyEntry): String {
            val kn = entry.keyName.trim().lowercase()
            val em = entry.email.trim().lowercase()
            return if (em.isNotEmpty()) "$em:$kn" else kn
        }
    }
}
