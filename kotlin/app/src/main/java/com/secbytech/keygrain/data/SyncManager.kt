package com.secbytech.keygrain.data

import android.content.Context
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import javax.crypto.AEADBadTagException

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

class SyncManager(
    private val baseUrl: String = "https://keygrain.com"
) {
    private val KEY_LAST_SUCCESSFUL_SYNC_AT = "last_successful_sync_at"

    private fun getPrefs(context: Context) =
        context.getSharedPreferences("keygrain_sync", Context.MODE_PRIVATE)

    fun getSyncEmail(context: Context): String? =
        getPrefs(context).getString("sync_email", null)

    fun setSyncEmail(context: Context, email: String) {
        getPrefs(context).edit().putString("sync_email", email).apply()
    }

    /**
     * Wipe all locally cached sync state: sync email, known UUIDs, wallet keys,
     * metadata cache, wallets, audit log, and conflict flags. Used by Switch
     * account and the local-delete path. Does NOT touch the server.
     */
    fun clearLocalData(context: Context) {
        getPrefs(context).edit().clear().apply()
    }

    /**
     * One-time migration from the v1 knownUUIDs model to v2 (synced + tombstones).
     * Design §8. Runs before the first v3 sync so a deletion that had not yet propagated
     * is preserved as a tombstone rather than lost (which would resurrect the service).
     *
     * `synced` is taken ONLY from knownUUIDs; anything unknown defaults to false. Never
     * default to true: a false `false` causes a harmless idempotent re-push under the
     * same UUID, whereas a false `true` risks deletion.
     */
    fun migrateFromKnownUUIDs(context: Context, serviceManager: ServiceManager) {
        val prefs = getPrefs(context)
        if (!prefs.contains("known_uuids")) return
        val known = prefs.getStringSet("known_uuids", emptySet()) ?: emptySet()
        val services = serviceManager.getServices()
        serviceManager.replaceAll(services.map { it.copy(synced = it.id != null && known.contains(it.id)) })
        val liveIds = services.mapNotNull { it.id }.toSet()
        val now = System.currentTimeMillis()
        val synthesized = known.filter { !liveIds.contains(it) }.map { Tombstone(it, now) }
        if (synthesized.isNotEmpty()) {
            serviceManager.setTombstones(serviceManager.getTombstones() + synthesized)
        }
        // Seed the barrier from the legacy last-sync timestamp when available.
        if (!prefs.contains(KEY_LAST_SUCCESSFUL_SYNC_AT)) {
            prefs.edit().putLong(KEY_LAST_SUCCESSFUL_SYNC_AT, prefs.getLong("last_sync_time", 0L)).apply()
        }
        prefs.edit().remove("known_uuids").apply()
    }

    /**
     * The causal barrier used to tell a routine remote deletion (apply silently) from one
     * that would destroy an unsynced local change (retain for review). Advanced ONLY on a
     * fully confirmed sync — Frozen Req 8.
     */
    private fun getLastSuccessfulSyncAt(context: Context): Long =
        getPrefs(context).getLong(KEY_LAST_SUCCESSFUL_SYNC_AT, 0L)

    private fun setLastSuccessfulSyncAt(context: Context, ts: Long) {
        getPrefs(context).edit().putLong(KEY_LAST_SUCCESSFUL_SYNC_AT, ts).apply()
    }

    internal fun conflictBackoffMs(retryCount: Int): Long =
        when (retryCount) {
            0 -> 250L
            1 -> 1000L
            else -> 3000L
        }

    /**
     * Canonical serialization of a sync blob payload, used ONLY to decide whether a PUT
     * can be skipped (Frozen Req 9). MUST stay byte-identical to canonicalBlobPayload()
     * in extension/shared/sync.js, so ordering and key order are fixed here. Local-only
     * fields (synced, frecency) are excluded because they never affect remote state.
     */
    internal fun canonicalBlobPayload(
        services: List<ServiceEntry>,
        wallets: List<WalletEntry>,
        auditLog: List<WalletAuditEntry>,
        syncConflicts: List<SyncConflict>
    ): String {
        val sb = StringBuilder()
        sb.append("{\"services\":[")
        services.sortedBy { it.id ?: "" }.forEachIndexed { i, s ->
            if (i > 0) sb.append(",")
            sb.append("{\"id\":").append(jsonStr(s.id))
                .append(",\"updated_at\":").append(s.updatedAt)
                .append(",\"name\":").append(jsonStr(s.name))
                .append(",\"site\":").append(jsonStr(s.site))
                .append(",\"email\":").append(jsonStr(s.email))
                .append(",\"length\":").append(s.length)
                .append(",\"symbols\":").append(jsonStr(s.symbols))
                .append(",\"counter\":").append(s.counter)
                .append(",\"totp\":").append(s.totp?.toString() ?: "null")
                .append(",\"ssh\":").append(s.ssh?.toString() ?: "null")
                .append("}")
        }
        sb.append("],\"wallets\":[")
        wallets.sortedBy { it.walletName.lowercase() + ":" + it.chain.lowercase() }
            .forEachIndexed { i, w ->
                if (i > 0) sb.append(",")
                sb.append(w.toJson().toString())
            }
        sb.append("],\"wallet_audit_log\":[")
        auditLog.sortedBy { "${it.timestamp}\u0000${it.walletName}\u0000${it.chain}\u0000${it.action}" }
            .forEachIndexed { i, e ->
                if (i > 0) sb.append(",")
                sb.append(e.toJson().toString())
            }
        sb.append("],\"sync_conflicts\":[")
        syncConflicts.sortedBy { it.dedupeKey() }.forEachIndexed { i, c ->
            if (i > 0) sb.append(",")
            sb.append(c.toJson().toString())
        }
        sb.append("]}")
        return sb.toString()
    }

    private fun jsonStr(s: String?): String =
        if (s == null) "null" else JSONObject.quote(s)

    private fun getMetadataCache(context: Context): List<Pair<String?, Long>>? {
        val json = getPrefs(context).getString("sync_metadata_cache", null) ?: return null
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                val id = if (obj.isNull("id")) null else obj.getString("id")
                Pair(id, obj.getLong("updated_at"))
            }
        } catch (_: Exception) { null }
    }

    private fun setMetadataCache(context: Context, metadata: List<Pair<String?, Long>>) {
        val arr = JSONArray()
        for ((id, updatedAt) in metadata) {
            arr.put(JSONObject().apply {
                put("id", id ?: JSONObject.NULL)
                put("updated_at", updatedAt)
            })
        }
        getPrefs(context).edit().putString("sync_metadata_cache", arr.toString()).apply()
    }

    private fun validateMetadataIntegrity(
        received: List<Pair<String?, Long>>,
        cached: List<Pair<String?, Long>>
    ): String? {
        val receivedById = mutableMapOf<String, Long>()
        for ((id, ts) in received) { if (id != null) receivedById[id] = ts }

        val cachedOrder = cached.mapNotNull { it.first }
        val receivedOrder = received.mapNotNull { it.first }
        val sharedIds = cachedOrder.filter { it in receivedById }.toSet()

        val sharedInCachedOrder = cachedOrder.filter { it in sharedIds }
        val sharedInReceivedOrder = receivedOrder.filter { it in sharedIds }

        for (i in sharedInCachedOrder.indices) {
            if (sharedInCachedOrder[i] != sharedInReceivedOrder[i]) {
                return "order: relative order of UUIDs changed"
            }
        }

        val cachedById = mutableMapOf<String, Long>()
        for ((id, ts) in cached) { if (id != null) cachedById[id] = ts }

        for ((id, ts) in received) {
            if (id != null && cachedById.containsKey(id)) {
                if (ts < cachedById[id]!!) {
                    return "timestamp: UUID $id went from ${cachedById[id]} to $ts"
                }
            }
        }

        return null
    }

    private fun getKnownWalletKeys(context: Context): Set<String> =
        getPrefs(context).getStringSet("known_wallet_keys", emptySet()) ?: emptySet()

    private fun setKnownWalletKeys(context: Context, keys: Set<String>) {
        getPrefs(context).edit().putStringSet("known_wallet_keys", keys).apply()
    }

    fun getWallets(context: Context): List<WalletEntry> {
        val json = getPrefs(context).getString("wallets", "[]") ?: "[]"
        val arr = JSONArray(json)
        return (0 until arr.length()).mapNotNull { i ->
            try { WalletEntry.fromJson(arr.getJSONObject(i)) } catch (_: Exception) { null }
        }
    }

    fun saveWallets(context: Context, wallets: List<WalletEntry>) {
        val arr = JSONArray().apply { wallets.forEach { put(it.toJson()) } }
        getPrefs(context).edit().putString("wallets", arr.toString()).apply()
    }

    fun getAuditLog(context: Context): List<WalletAuditEntry> {
        val json = getPrefs(context).getString("wallet_audit_log", "[]") ?: "[]"
        val arr = JSONArray(json)
        return (0 until arr.length()).mapNotNull { i ->
            try { WalletAuditEntry.fromJson(arr.getJSONObject(i)) } catch (_: Exception) { null }
        }
    }

    fun saveAuditLog(context: Context, log: List<WalletAuditEntry>) {
        val arr = JSONArray().apply { log.forEach { put(it.toJson()) } }
        getPrefs(context).edit().putString("wallet_audit_log", arr.toString()).apply()
    }

    private fun mergeWallets(
        local: List<WalletEntry>,
        remote: List<WalletEntry>,
        knownWalletKeys: Set<String>
    ): Pair<List<WalletEntry>, Set<String>> {
        val remoteByKey = remote.associateBy { WalletEntry.mergeKey(it) }
        val localByKey = local.associateBy { WalletEntry.mergeKey(it) }.toMutableMap()
        val merged = mutableListOf<WalletEntry>()

        for ((key, remoteW) in remoteByKey) {
            val localW = localByKey.remove(key)
            if (localW != null) {
                val localTs = localW.updatedAt.ifEmpty { localW.createdAt }
                val remoteTs = remoteW.updatedAt.ifEmpty { remoteW.createdAt }
                merged.add(if (localTs > remoteTs) localW else remoteW)
            } else {
                if (knownWalletKeys.contains(key)) { /* deleted locally */ }
                else merged.add(remoteW)
            }
        }

        for ((key, localW) in localByKey) {
            if (knownWalletKeys.contains(key)) { /* deleted remotely */ }
            else merged.add(localW)
        }

        val newKeys = merged.map { WalletEntry.mergeKey(it) }.toSet()
        return Pair(merged, newKeys)
    }

    private fun mergeAuditLog(
        local: List<WalletAuditEntry>,
        remote: List<WalletAuditEntry>
    ): List<WalletAuditEntry> {
        val seen = mutableSetOf<String>()
        val merged = mutableListOf<WalletAuditEntry>()
        for (entry in local + remote) {
            if (seen.add(entry.dedupeKey())) merged.add(entry)
        }
        return merged
    }

    private data class BlobContent(
        val services: List<ServiceEntry>,
        val wallets: List<WalletEntry>,
        val auditLog: List<WalletAuditEntry>,
        val syncConflicts: List<SyncConflict>
    )

    private fun parseBlobContent(json: String, serviceManager: ServiceManager): BlobContent {
        val trimmed = json.trim()
        if (trimmed.startsWith("[")) {
            return BlobContent(serviceManager.parseJson(trimmed), emptyList(), emptyList(), emptyList())
        }
        val obj = JSONObject(trimmed)
        val servicesArr = obj.optJSONArray("services") ?: JSONArray()
        val services = serviceManager.parseJson(servicesArr.toString())
        val walletsArr = obj.optJSONArray("wallets") ?: JSONArray()
        val auditArr = obj.optJSONArray("wallet_audit_log") ?: JSONArray()
        val conflictsArr = obj.optJSONArray("sync_conflicts") ?: JSONArray()
        val wallets = (0 until walletsArr.length()).mapNotNull { i ->
            try { WalletEntry.fromJson(walletsArr.getJSONObject(i)) } catch (_: Exception) { null }
        }
        val auditLog = (0 until auditArr.length()).mapNotNull { i ->
            try { WalletAuditEntry.fromJson(auditArr.getJSONObject(i)) } catch (_: Exception) { null }
        }
        val conflicts = (0 until conflictsArr.length()).mapNotNull { i ->
            try { SyncConflict.fromJson(conflictsArr.getJSONObject(i)) } catch (_: Exception) { null }
        }
        return BlobContent(services, wallets, auditLog, conflicts)
    }

    suspend fun sync(
        secret: ByteArray,
        email: String,
        serviceManager: ServiceManager,
        context: Context,
        retryCount: Int = 0
    ): SyncResult = withContext(Dispatchers.IO) {
        val lookupId = Keygrain.deriveLookupId(secret, email)
        val authPassword = Keygrain.deriveAuthPassword(secret, email)
        val encryptionKey = Keygrain.deriveEncryptionKey(secret, email)
        val authHeader = "Basic " + Base64.encodeToString(
            "$lookupId:$authPassword".toByteArray(), Base64.NO_WRAP
        )

        try {
            // Step 1: GET remote state
            val getResult = doGet(lookupId, authHeader)
            val localServices = serviceManager.getServices()
            val localTombstones = serviceManager.getTombstones()
            val lastSyncAt = getLastSuccessfulSyncAt(context)
            var knownWKeys = getKnownWalletKeys(context)

            var remoteServices: List<ServiceEntry> = emptyList()
            var remoteWallets: List<WalletEntry> = emptyList()
            var remoteAuditLog: List<WalletAuditEntry> = emptyList()
            var remoteConflicts: List<SyncConflict> = emptyList()
            var remoteMetadata: List<Pair<String?, Long>> = emptyList()
            var etag: String? = null
            var status = "created"
            var remoteExists = false

            when (getResult) {
                is GetResult.Success -> {
                    etag = getResult.etag
                    status = "synced"
                    remoteExists = true

                    // Validate checksum
                    val blobBytes = Base64.decode(getResult.encryptedBlob, Base64.DEFAULT)
                    val checksum = sha256Hex(blobBytes)
                    if (checksum != getResult.checksum) {
                        return@withContext SyncResult.IntegrityError("checksum mismatch")
                    }

                    // Decrypt with AAD, fallback to no-AAD only for first-time migration
                    val aad = lookupId.toByteArray(Charsets.UTF_8)
                    val plaintext = try {
                        SyncCrypto.decrypt(encryptionKey, blobBytes, aad).also {
                            getPrefs(context).edit().putBoolean("aad_enabled", true).apply()
                        }
                    } catch (e: AEADBadTagException) {
                        if (getPrefs(context).getBoolean("aad_enabled", false)) throw e
                        SyncCrypto.decrypt(encryptionKey, blobBytes)
                    }
                    val json = String(plaintext, Charsets.UTF_8)
                    val blobContent = parseBlobContent(json, serviceManager)
                    remoteServices = blobContent.services
                    remoteWallets = blobContent.wallets
                    remoteAuditLog = blobContent.auditLog
                    remoteConflicts = blobContent.syncConflicts
                    remoteMetadata = getResult.services

                    // Validate length
                    if (remoteMetadata.size != remoteServices.size) {
                        return@withContext SyncResult.IntegrityError("metadata length mismatch")
                    }

                    // Validate metadata integrity
                    val cachedMeta = getMetadataCache(context)
                    if (cachedMeta != null) {
                        val violation = validateMetadataIntegrity(remoteMetadata, cachedMeta)
                        if (violation != null) {
                            return@withContext SyncResult.IntegrityError("metadata tamper: $violation")
                        }
                    }
                }
                is GetResult.NotFound -> {
                    // Frozen Req 11: no remote record. NEVER inferred as deletions — see
                    // reconcileServices(remoteExists=false). Wallet known-keys are also
                    // reset so local wallets are not read as "deleted remotely".
                    remoteExists = false
                    knownWKeys = emptySet()
                    setKnownWalletKeys(context, emptySet())
                }
                is GetResult.AuthError -> return@withContext SyncResult.AuthError(getResult.code)
                is GetResult.Error -> return@withContext SyncResult.ServerError(getResult.code, getResult.body)
                is GetResult.NetworkError -> return@withContext SyncResult.NetworkError(getResult.cause)
            }

            // Step 2: Reconcile
            val recResult = reconcileServices(
                localServices, localTombstones, remoteServices, remoteMetadata, lastSyncAt, remoteExists
            )
            val merged = recResult.merged
            val newConflicts = recResult.syncConflicts
            val localWallets = getWallets(context)
            val localAuditLog = getAuditLog(context)
            val (mergedWallets, newWKeys) = mergeWallets(localWallets, remoteWallets, knownWKeys)
            val mergedAuditLog = mergeAuditLog(localAuditLog, remoteAuditLog)

            // Empty-push protection: an empty push is legitimate only when every remote
            // id it drops is explicitly declared as deleted.
            if (merged.isEmpty() && remoteMetadata.isNotEmpty()) {
                val declared = recResult.deletedIds.toSet()
                val allDeclared = remoteMetadata.all { it.first != null && declared.contains(it.first) }
                if (!allDeclared) {
                    return@withContext SyncResult.IntegrityError("empty push blocked: merge produced no services but remote had ${remoteMetadata.size}")
                }
            }

            // Step 3: Build push payload
            val contentArray = JSONArray()
            val metadataArray = JSONArray()
            for (svc in merged) {
                contentArray.put(svc.toJsonContent())
                metadataArray.put(JSONObject().apply {
                    put("id", svc.id)
                    put("updated_at", svc.updatedAt)
                })
            }

            val walletsArray = JSONArray().apply { mergedWallets.forEach { put(it.toJson()) } }
            val auditArray = JSONArray().apply { mergedAuditLog.forEach { put(it.toJson()) } }

            // Merge conflicts: remote + new, dedup by key, cap at 50
            val conflictsDismissed = getPrefs(context).getBoolean("conflicts_dismissed", false)
            val effectiveRemoteConflicts = if (conflictsDismissed) emptyList() else remoteConflicts
            val conflictKeySet = mutableSetOf<String>()
            val mergedConflicts = mutableListOf<SyncConflict>()
            for (c in effectiveRemoteConflicts + newConflicts) {
                if (conflictKeySet.add(c.dedupeKey())) mergedConflicts.add(c)
            }
            mergedConflicts.sortBy { it.detectedAt }
            val syncConflicts = mergedConflicts.takeLast(50)

            val conflictsArray = JSONArray().apply { syncConflicts.forEach { put(it.toJson()) } }

            // Step 3b: no-op skip (Frozen Req 9). An idle sync costs one GET and no PUT,
            // which also stops the random-IV/new-ETag churn that manufactures cross-device
            // 409s and exhausts the per-lookup rate-limit bucket.
            if (remoteExists && recResult.deletedIds.isEmpty()) {
                val localCanon = canonicalBlobPayload(merged, mergedWallets, mergedAuditLog, syncConflicts)
                val remoteWithMeta = remoteMetadata.indices.mapNotNull { i ->
                    val id = remoteMetadata[i].first ?: return@mapNotNull null
                    remoteServices[i].copy(id = id, updatedAt = remoteMetadata[i].second)
                }
                val remoteCanon = canonicalBlobPayload(remoteWithMeta, remoteWallets, remoteAuditLog, remoteConflicts)
                if (localCanon == remoteCanon) {
                    serviceManager.replaceAll(merged)
                    serviceManager.setTombstones(emptyList())
                    if (recResult.review.isNotEmpty()) {
                        serviceManager.setDeletionReview(serviceManager.getDeletionReview() + recResult.review)
                    }
                    setKnownWalletKeys(context, newWKeys)
                    setLastSuccessfulSyncAt(context, System.currentTimeMillis())
                    return@withContext SyncResult.Success(merged, mergedWallets, mergedAuditLog, syncConflicts, "unchanged")
                }
            }

            val blobPayload = JSONObject().apply {
                put("services", contentArray)
                put("wallets", walletsArray)
                put("wallet_audit_log", auditArray)
                put("sync_conflicts", conflictsArray)
            }

            val plaintext = blobPayload.toString().toByteArray(Charsets.UTF_8)
            val aadEnc = lookupId.toByteArray(Charsets.UTF_8)
            val encrypted = SyncCrypto.encrypt(encryptionKey, plaintext, aadEnc)
            val encryptedB64 = Base64.encodeToString(encrypted, Base64.NO_WRAP)
            val checksum = sha256Hex(encrypted)

            val putBody = JSONObject().apply {
                put("services", metadataArray)
                put("encrypted_blob", encryptedB64)
                put("checksum", checksum)
                put("deleted_ids", JSONArray().apply { recResult.deletedIds.forEach { put(it) } })
            }.toString()

            // Step 4: PUT
            val putResult = doPut(lookupId, authHeader, putBody, etag)

            when (putResult) {
                is PutResult.Success -> {
                    // Confirmed 2xx: only now is it safe to mark the pushed ids synced,
                    // clear the tombstones the server no longer holds, and advance the
                    // sync barrier (§3 steps 5-6, Frozen Reqs 1/5/8).
                    val pushedIds = merged.mapNotNull { it.id }.toSet()
                    val confirmed = merged.map {
                        if (it.id != null && pushedIds.contains(it.id)) it.copy(synced = true) else it
                    }
                    serviceManager.replaceAll(confirmed)
                    serviceManager.setTombstones(recResult.tombstones.filter { pushedIds.contains(it.id) })
                    if (recResult.review.isNotEmpty()) {
                        serviceManager.setDeletionReview(serviceManager.getDeletionReview() + recResult.review)
                    }
                    setMetadataCache(context, putResult.services)
                    setKnownWalletKeys(context, newWKeys)
                    saveWallets(context, mergedWallets)
                    saveAuditLog(context, mergedAuditLog)
                    setLastSuccessfulSyncAt(context, System.currentTimeMillis())
                    getPrefs(context).edit().putBoolean("conflicts_dismissed", false).apply()

                    SyncResult.Success(confirmed, mergedWallets, mergedAuditLog, syncConflicts, status)
                }
                is PutResult.Conflict -> {
                    if (retryCount < 3) {
                        // Bounded jittered backoff: immediate recursion could burn 8
                        // requests in milliseconds against the per-lookup bucket and
                        // self-inflict a 429.
                        delay(conflictBackoffMs(retryCount))
                        sync(secret, email, serviceManager, context, retryCount + 1)
                    } else {
                        SyncResult.ConflictError
                    }
                }
                is PutResult.AuthError -> SyncResult.AuthError(putResult.code)
                is PutResult.Error -> SyncResult.ServerError(putResult.code, putResult.body)
                is PutResult.NetworkError -> SyncResult.NetworkError(putResult.cause)
            }
        } catch (e: AEADBadTagException) {
            SyncResult.IntegrityError("decryption failed")
        } catch (e: IOException) {
            SyncResult.NetworkError(e)
        } finally {
            encryptionKey.fill(0)
        }
    }

    internal data class ReconcileResult(
        val merged: List<ServiceEntry>,
        val tombstones: List<Tombstone>,
        val deletedIds: List<String>,
        val review: List<DeletionReviewEntry>,
        val resurrected: List<String>,
        val syncConflicts: List<SyncConflict>
    )

    /**
     * Sync v3 deletion reconciliation — MUST stay behaviourally identical to
     * reconcileServices() in extension/shared/sync.js. See
     * designs/sync-deletion-reconciliation.md §2.
     */
    internal fun reconcileServices(
        local: List<ServiceEntry>,
        localTombstones: List<Tombstone>,
        remote: List<ServiceEntry>,
        remoteMeta: List<Pair<String?, Long>>,
        lastSyncAt: Long,
        remoteExists: Boolean
    ): ReconcileResult {
        val remoteByID = mutableMapOf<String, ServiceEntry>()
        for (i in remoteMeta.indices) {
            val id = remoteMeta[i].first ?: continue
            remoteByID[id] = remote[i].copy(id = id, updatedAt = remoteMeta[i].second)
        }

        val localByID = mutableMapOf<String, ServiceEntry>()
        val localWithoutId = mutableListOf<ServiceEntry>()
        for (svc in local) {
            if (svc.id != null) localByID[svc.id] = svc
            else localWithoutId.add(svc)
        }

        // Latest deletion intent per id.
        val tombByID = mutableMapOf<String, Long>()
        for (t in localTombstones) {
            val prev = tombByID[t.id]
            if (prev == null || t.deletedAt > prev) tombByID[t.id] = t.deletedAt
        }

        val merged = mutableListOf<ServiceEntry>()
        val tombstones = mutableListOf<Tombstone>()
        val deletedIds = mutableListOf<String>()
        val review = mutableListOf<DeletionReviewEntry>()
        val resurrected = mutableListOf<String>()

        if (!remoteExists) {
            // Frozen Req 11: no server record (fresh account, or server-side data loss).
            // NEVER interpreted as deletions — otherwise a lost blob would wipe every
            // device. Pending tombstones are dropped: the server holds nothing to delete.
            for (svc in localByID.values) merged.add(svc.copy(synced = false))
        } else {
            val allIds = localByID.keys + remoteByID.keys + tombByID.keys
            for (id in allIds) {
                val l = localByID[id]
                val r = remoteByID[id]
                val t = tombByID[id]

                if (t != null) {
                    if (r != null && r.updatedAt > t) {
                        // Rule 7: a newer remote edit supersedes this pending deletion.
                        merged.add(r.copy(synced = true))
                        resurrected.add(id)
                    } else {
                        // Stays deleted. Declared only if the server still holds it;
                        // otherwise the tombstone clears without forcing a PUT (§3, §4).
                        if (r != null) {
                            deletedIds.add(id)
                            tombstones.add(Tombstone(id, t))
                        }
                    }
                    continue
                }

                if (l != null && r != null) {
                    // Rules 1-3: newer wins, remote wins ties.
                    val winner = if (l.updatedAt > r.updatedAt) l else r
                    merged.add(winner.copy(id = id, synced = true))
                    continue
                }

                if (l != null) {
                    if (!l.synced) {
                        // Rule 4: never reached the server -> create remotely.
                        merged.add(l)
                    } else {
                        // Rule 6: was on the server, now gone -> deleted elsewhere.
                        // Retained for review ONLY when this device holds an unsynced
                        // change (Frozen Req 7).
                        if (l.updatedAt > lastSyncAt) {
                            review.add(DeletionReviewEntry(l, System.currentTimeMillis(), false))
                        }
                    }
                    continue
                }

                // Rule 5: remote-only -> create locally.
                if (r != null) merged.add(r.copy(synced = true))
            }
        }

        // Legacy records with no id yet: assign one and treat as unsynced creates.
        for (svc in localWithoutId) {
            merged.add(svc.copy(id = java.util.UUID.randomUUID().toString(), synced = false))
        }

        // Dedup by (normalizeSite(site), email) — keep highest updatedAt, lower UUID wins ties
        val conflicts = mutableListOf<SyncConflict>()
        val deduped = mutableMapOf<Pair<String, String>, ServiceEntry>()
        for (svc in merged) {
            val normalized = ServiceManager.normalizeSite(svc.site)
            val key = (normalized.ifEmpty { svc.id ?: svc.site }) to svc.email.lowercase()
            val existing = deduped[key]
            if (existing == null) { deduped[key] = svc; continue }
            val winner: ServiceEntry
            val loser: ServiceEntry
            if (svc.updatedAt > existing.updatedAt || (svc.updatedAt == existing.updatedAt && (svc.id ?: "") < (existing.id ?: ""))) {
                winner = svc; loser = existing
            } else {
                winner = existing; loser = svc
            }
            deduped[key] = winner
            if (loser.length != winner.length || loser.symbols != winner.symbols ||
                loser.counter != winner.counter ||
                (loser.totp?.toString() ?: "") != (winner.totp?.toString() ?: "") ||
                (loser.ssh?.toString() ?: "") != (winner.ssh?.toString() ?: "")) {
                val loserJson = loser.toJsonContent().apply {
                    put("id", loser.id ?: "")
                    put("updated_at", loser.updatedAt)
                }
                conflicts.add(SyncConflict(winner.id ?: "", loserJson, java.time.Instant.now().toString()))
            }
            // A SYNCED loser must be removed server-side too, not merely dropped locally,
            // so it is tombstoned and declared. This is INDEPENDENT of whether the two
            // records differed materially (which only controls conflict reporting) —
            // mirrors the two separate blocks in extension/shared/sync.js.
            val loserId = loser.id
            if (loser.synced && loserId != null && remoteByID.containsKey(loserId)) {
                if (!deletedIds.contains(loserId)) deletedIds.add(loserId)
                if (tombstones.none { it.id == loserId }) {
                    tombstones.add(Tombstone(loserId, System.currentTimeMillis()))
                }
            }
        }

        return ReconcileResult(deduped.values.toList(), tombstones, deletedIds, review, resurrected, conflicts)
    }

    private fun sha256Hex(data: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(data)
        return digest.joinToString("") { "%02x".format(it) }
    }

    // --- HTTP helpers ---

    private sealed class GetResult {
        data class Success(
            val services: List<Pair<String?, Long>>,
            val encryptedBlob: String,
            val checksum: String,
            val etag: String
        ) : GetResult()
        data class NotFound(val msg: String) : GetResult()
        data class AuthError(val code: Int) : GetResult()
        data class Error(val code: Int, val body: String) : GetResult()
        data class NetworkError(val cause: Throwable) : GetResult()
    }

    private fun doGet(lookupId: String, authHeader: String): GetResult {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("$baseUrl/api/sync/$lookupId").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                setRequestProperty("Authorization", authHeader)
                connectTimeout = 15000
                readTimeout = 15000
            }
            when (val code = conn.responseCode) {
                200 -> {
                    val body = conn.inputStream.bufferedReader().readText()
                    val json = JSONObject(body)
                    val svcs = json.getJSONArray("services")
                    val services = (0 until svcs.length()).map { i ->
                        val obj = svcs.getJSONObject(i)
                        val id = if (obj.isNull("id")) null else obj.getString("id")
                        Pair(id, obj.getLong("updated_at"))
                    }
                    val etag = conn.getHeaderField("ETag")?.trim('"') ?: ""
                    GetResult.Success(services, json.getString("encrypted_blob"), json.getString("checksum"), etag)
                }
                404 -> GetResult.NotFound("not found")
                401, 403 -> GetResult.AuthError(code)
                else -> GetResult.Error(code, conn.errorStream?.bufferedReader()?.readText() ?: "")
            }
        } catch (e: IOException) {
            GetResult.NetworkError(e)
        } finally {
            conn?.disconnect()
        }
    }

    private sealed class PutResult {
        data class Success(val services: List<Pair<String?, Long>>, val etag: String) : PutResult()
        data class Conflict(val currentEtag: String) : PutResult()
        data class AuthError(val code: Int) : PutResult()
        data class Error(val code: Int, val body: String) : PutResult()
        data class NetworkError(val cause: Throwable) : PutResult()
    }

    private fun doPut(lookupId: String, authHeader: String, body: String, etag: String?): PutResult {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("$baseUrl/api/sync/$lookupId").openConnection() as HttpURLConnection).apply {
                requestMethod = "PUT"
                setRequestProperty("Authorization", authHeader)
                setRequestProperty("Content-Type", "application/json")
                if (etag != null) setRequestProperty("If-Match", "\"$etag\"")
                doOutput = true
                connectTimeout = 15000
                readTimeout = 15000
            }
            conn.outputStream.use { it.write(body.toByteArray()) }
            when (val code = conn.responseCode) {
                200, 201 -> {
                    val respBody = conn.inputStream.bufferedReader().readText()
                    val json = JSONObject(respBody)
                    val svcs = json.getJSONArray("services")
                    val services = (0 until svcs.length()).map { i ->
                        val obj = svcs.getJSONObject(i)
                        val id = if (obj.isNull("id")) null else obj.getString("id")
                        Pair(id, obj.getLong("updated_at"))
                    }
                    PutResult.Success(services, json.getString("etag"))
                }
                409 -> {
                    val errBody = conn.errorStream?.bufferedReader()?.readText() ?: ""
                    val currentEtag = try { JSONObject(errBody).getString("current_etag") } catch (_: Exception) { "" }
                    PutResult.Conflict(currentEtag)
                }
                401, 403 -> PutResult.AuthError(code)
                else -> PutResult.Error(code, conn.errorStream?.bufferedReader()?.readText() ?: "")
            }
        } catch (e: IOException) {
            PutResult.NetworkError(e)
        } finally {
            conn?.disconnect()
        }
    }

    /**
     * Permanently delete this account's record from the sync server.
     *
     * Derives lookup_id/auth_password from [secret]/[email] and sends
     * DELETE /api/sync/:lookup_id with HTTP Basic auth. Returns a [DeleteResult];
     * the caller MUST treat only [DeleteResult.Success] (200) and
     * [DeleteResult.NotFound] (404) as a confirmed delete (Invariant #1).
     *
     * Does NOT read or parse the 200 response body: the informational
     * {"status":"deleted"} payload is irrelevant to the outcome.
     */
    suspend fun deleteServerData(secret: ByteArray, email: String, context: Context): DeleteResult =
        withContext(Dispatchers.IO) {
            val lookupId = Keygrain.deriveLookupId(secret, email)
            val authPassword = Keygrain.deriveAuthPassword(secret, email)
            val authHeader = "Basic " + Base64.encodeToString(
                "$lookupId:$authPassword".toByteArray(), Base64.NO_WRAP
            )
            doDelete(lookupId, authHeader)
        }

    /**
     * HTTP layer for [deleteServerData]. Mirrors [doGet]/[doPut]
     * (HttpURLConnection, 15s timeouts, disconnect in finally). Internal rather
     * than private so the plain-JVM unit test can drive the full
     * status-code -> DeleteResult mapping against an embedded HttpServer without
     * touching android.util.Base64 (which is not available in unit tests).
     */
    @androidx.annotation.VisibleForTesting
    internal fun doDelete(lookupId: String, authHeader: String): DeleteResult {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("$baseUrl/api/sync/$lookupId").openConnection() as HttpURLConnection).apply {
                requestMethod = "DELETE"
                setRequestProperty("Authorization", authHeader)
                connectTimeout = 15000
                readTimeout = 15000
            }
            when (val code = conn.responseCode) {
                200 -> DeleteResult.Success
                404 -> DeleteResult.NotFound
                401, 403 -> DeleteResult.AuthError(code)
                429 -> DeleteResult.RateLimited
                else -> DeleteResult.ServerError(code, conn.errorStream?.bufferedReader()?.readText() ?: "")
            }
        } catch (e: IOException) {
            DeleteResult.NetworkError(e)
        } finally {
            conn?.disconnect()
        }
    }

}
