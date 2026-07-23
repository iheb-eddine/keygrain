package com.secbytech.keygrain.data

import android.content.Context
import android.util.Base64
import kotlinx.coroutines.Dispatchers
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

    private fun getKnownUUIDs(context: Context): Set<String> =
        getPrefs(context).getStringSet("known_uuids", emptySet()) ?: emptySet()

    private fun setKnownUUIDs(context: Context, uuids: Set<String>) {
        getPrefs(context).edit().putStringSet("known_uuids", uuids).apply()
    }

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
            val knownUUIDs = getKnownUUIDs(context).toMutableSet()
            var knownWKeys = getKnownWalletKeys(context)

            var remoteServices: List<ServiceEntry> = emptyList()
            var remoteWallets: List<WalletEntry> = emptyList()
            var remoteAuditLog: List<WalletAuditEntry> = emptyList()
            var remoteConflicts: List<SyncConflict> = emptyList()
            var remoteMetadata: List<Pair<String?, Long>> = emptyList()
            var etag: String? = null
            var status = "created"

            when (getResult) {
                is GetResult.Success -> {
                    etag = getResult.etag
                    status = "synced"

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
                    // No remote state — treat as fresh first sync to prevent data loss.
                    // If knownUUIDs is populated, server data was lost; clear to avoid
                    // interpreting all local services as "deleted remotely."
                    // Persist immediately so the fix survives a subsequent PUT failure.
                    knownUUIDs.clear()
                    knownWKeys = emptySet()
                    setKnownUUIDs(context, emptySet())
                    setKnownWalletKeys(context, emptySet())
                }
                is GetResult.AuthError -> return@withContext SyncResult.AuthError(getResult.code)
                is GetResult.Error -> return@withContext SyncResult.ServerError(getResult.code, getResult.body)
                is GetResult.NetworkError -> return@withContext SyncResult.NetworkError(getResult.cause)
            }

            // Step 2: Merge
            val mergeResult = mergeServices(localServices, remoteServices, remoteMetadata, knownUUIDs)
            val merged = mergeResult.merged
            val allMergedIds = mergeResult.allMergedIds
            val newConflicts = mergeResult.syncConflicts
            val localWallets = getWallets(context)
            val localAuditLog = getAuditLog(context)
            val (mergedWallets, newWKeys) = mergeWallets(localWallets, remoteWallets, knownWKeys)
            val mergedAuditLog = mergeAuditLog(localAuditLog, remoteAuditLog)

            // Empty-push protection: refuse to push empty if remote had data
            if (merged.isEmpty() && remoteMetadata.isNotEmpty()) {
                return@withContext SyncResult.IntegrityError("empty push blocked: merge produced no services but remote had ${remoteMetadata.size}")
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
            }.toString()

            // Step 4: PUT
            val putResult = doPut(lookupId, authHeader, putBody, etag)

            when (putResult) {
                is PutResult.Success -> {
                    serviceManager.replaceAll(merged)
                    setMetadataCache(context, putResult.services)

                    // Update known UUIDs (from pre-dedup set to include loser UUIDs) and wallet keys
                    setKnownUUIDs(context, allMergedIds)
                    setKnownWalletKeys(context, newWKeys)
                    saveWallets(context, mergedWallets)
                    saveAuditLog(context, mergedAuditLog)
                    getPrefs(context).edit().putBoolean("conflicts_dismissed", false).apply()

                    SyncResult.Success(merged, mergedWallets, mergedAuditLog, syncConflicts, status)
                }
                is PutResult.Conflict -> {
                    if (retryCount < 3) {
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

    private data class MergeResult(
        val merged: List<ServiceEntry>,
        val allMergedIds: Set<String>,
        val syncConflicts: List<SyncConflict>
    )

    private fun mergeServices(
        local: List<ServiceEntry>,
        remote: List<ServiceEntry>,
        remoteMeta: List<Pair<String?, Long>>,
        knownUUIDs: Set<String>
    ): MergeResult {
        val remoteByID = mutableMapOf<String, Pair<ServiceEntry, Long>>()
        for (i in remoteMeta.indices) {
            val id = remoteMeta[i].first ?: continue
            remoteByID[id] = Pair(remote[i], remoteMeta[i].second)
        }

        val localByID = mutableMapOf<String, ServiceEntry>()
        val localWithoutId = mutableListOf<ServiceEntry>()
        for (svc in local) {
            if (svc.id != null) localByID[svc.id] = svc
            else localWithoutId.add(svc)
        }

        val merged = mutableListOf<ServiceEntry>()

        // Remote services
        for ((id, pair) in remoteByID) {
            val (remoteSvc, remoteTs) = pair
            val localSvc = localByID.remove(id)
            if (localSvc != null) {
                // Both have it — newer wins, remote wins ties
                if (localSvc.updatedAt > remoteTs) merged.add(localSvc)
                else merged.add(remoteSvc.copy(id = id, updatedAt = remoteTs))
            } else {
                // Remote-only
                if (knownUUIDs.contains(id)) {
                    // Deleted locally — don't include
                } else {
                    // New from another device
                    merged.add(remoteSvc.copy(id = id, updatedAt = remoteTs))
                }
            }
        }

        // Local-only services
        for ((id, svc) in localByID) {
            if (knownUUIDs.contains(id)) {
                // Was previously seen from server but now gone → deleted remotely
            } else {
                // Never seen from server → new local service → preserve
                merged.add(svc)
            }
        }

        // Preserve local services without ID (assign UUIDs)
        for (svc in localWithoutId) {
            merged.add(svc.copy(id = java.util.UUID.randomUUID().toString()))
        }

        // Compute all pre-dedup UUIDs (includes losers) for knownUUIDs tracking
        val allMergedIds = merged.mapNotNull { it.id }.toSet()

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
        }

        return MergeResult(deduped.values.toList(), allMergedIds, conflicts)
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
