package com.secbytech.keygrain.data

import android.content.Context
import android.util.Base64
import java.io.IOException
import javax.crypto.AEADBadTagException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class SyncManager(
    private val baseUrl: String = "https://keygrain.com"
) {
    private val transport = SyncTransport(baseUrl)

    // --- Facade over SyncStore, kept so UI call sites are unchanged --------------------

    fun getSyncEmail(context: Context): String? = SyncStore.getSyncEmail(context)

    fun setSyncEmail(context: Context, email: String) = SyncStore.setSyncEmail(context, email)

    fun clearLocalData(context: Context) = SyncStore.clearLocalData(context)

    fun migrateFromKnownUUIDs(context: Context, serviceManager: ServiceManager) =
        SyncStore.migrateFromKnownUUIDs(context, serviceManager)

    fun getWallets(context: Context): List<WalletEntry> = SyncStore.getWallets(context)

    fun saveWallets(context: Context, wallets: List<WalletEntry>) =
        SyncStore.saveWallets(context, wallets)

    fun getAuditLog(context: Context): List<WalletAuditEntry> = SyncStore.getAuditLog(context)

    fun saveAuditLog(context: Context, log: List<WalletAuditEntry>) =
        SyncStore.saveAuditLog(context, log)


    internal fun conflictBackoffMs(retryCount: Int): Long =
        when (retryCount) {
            0 -> 250L
            1 -> 1000L
            else -> 3000L
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
            val getResult = transport.doGet(lookupId, authHeader)
            val localServices = serviceManager.getServices()
            val localTombstones = serviceManager.getTombstones()
            val lastSyncAt = SyncStore.getLastSuccessfulSyncAt(context)
            var knownWKeys = SyncStore.getKnownWalletKeys(context)

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
                    val checksum = SyncIntegrity.sha256Hex(blobBytes)
                    if (checksum != getResult.checksum) {
                        return@withContext SyncResult.IntegrityError("checksum mismatch")
                    }

                    // Decrypt with AAD, fallback to no-AAD only for first-time migration
                    val aad = lookupId.toByteArray(Charsets.UTF_8)
                    val plaintext = try {
                        SyncCrypto.decrypt(encryptionKey, blobBytes, aad).also {
                            SyncStore.setAadEnabled(context, true)
                        }
                    } catch (e: AEADBadTagException) {
                        if (SyncStore.isAadEnabled(context)) throw e
                        SyncCrypto.decrypt(encryptionKey, blobBytes)
                    }
                    val json = String(plaintext, Charsets.UTF_8)
                    val blobContent = SyncBlob.parseBlobContent(json, serviceManager)
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
                    val cachedMeta = SyncStore.getMetadataCache(context)
                    if (cachedMeta != null) {
                        val violation = SyncIntegrity.validateMetadataIntegrity(remoteMetadata, cachedMeta)
                        if (violation != null) {
                            return@withContext SyncResult.IntegrityError("metadata tamper: $violation")
                        }
                    }
                }
                is GetResult.NotFound -> {
                    // Frozen Req 11: no remote record. NEVER inferred as deletions — see
                    // SyncReconciler.reconcileServices(remoteExists=false). Wallet known-keys are also
                    // reset so local wallets are not read as "deleted remotely".
                    remoteExists = false
                    knownWKeys = emptySet()
                    SyncStore.setKnownWalletKeys(context, emptySet())
                }
                is GetResult.AuthError -> return@withContext SyncResult.AuthError(getResult.code)
                is GetResult.Error -> return@withContext SyncResult.ServerError(getResult.code, getResult.body)
                is GetResult.NetworkError -> return@withContext SyncResult.NetworkError(getResult.cause)
            }

            // Step 2: Reconcile
            val recResult = SyncReconciler.reconcileServices(
                localServices, localTombstones, remoteServices, remoteMetadata, lastSyncAt, remoteExists
            )
            val merged = recResult.merged
            val newConflicts = recResult.syncConflicts
            val localWallets = SyncStore.getWallets(context)
            val localAuditLog = SyncStore.getAuditLog(context)
            val (mergedWallets, newWKeys) = SyncMerge.mergeWallets(localWallets, remoteWallets, knownWKeys)
            val mergedAuditLog = SyncMerge.mergeAuditLog(localAuditLog, remoteAuditLog)

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
            val conflictsDismissed = SyncStore.areConflictsDismissed(context)
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
                val localCanon = SyncBlob.canonicalBlobPayload(merged, mergedWallets, mergedAuditLog, syncConflicts)
                val remoteWithMeta = remoteMetadata.indices.mapNotNull { i ->
                    val id = remoteMetadata[i].first ?: return@mapNotNull null
                    remoteServices[i].copy(id = id, updatedAt = remoteMetadata[i].second)
                }
                val remoteCanon = SyncBlob.canonicalBlobPayload(remoteWithMeta, remoteWallets, remoteAuditLog, remoteConflicts)
                if (localCanon == remoteCanon) {
                    serviceManager.replaceAll(merged)
                    serviceManager.setTombstones(emptyList())
                    if (recResult.review.isNotEmpty()) {
                        serviceManager.setDeletionReview(serviceManager.getDeletionReview() + recResult.review)
                    }
                    SyncStore.setKnownWalletKeys(context, newWKeys)
                    SyncStore.setLastSuccessfulSyncAt(context, System.currentTimeMillis())
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
            val checksum = SyncIntegrity.sha256Hex(encrypted)

            val putBody = JSONObject().apply {
                put("services", metadataArray)
                put("encrypted_blob", encryptedB64)
                put("checksum", checksum)
                put("deleted_ids", JSONArray().apply { recResult.deletedIds.forEach { put(it) } })
            }.toString()

            // Step 4: PUT
            val putResult = transport.doPut(lookupId, authHeader, putBody, etag)

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
                    SyncStore.setMetadataCache(context, putResult.services)
                    SyncStore.setKnownWalletKeys(context, newWKeys)
                    SyncStore.saveWallets(context, mergedWallets)
                    SyncStore.saveAuditLog(context, mergedAuditLog)
                    SyncStore.setLastSuccessfulSyncAt(context, System.currentTimeMillis())
                    SyncStore.setConflictsDismissed(context, false)

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
            transport.doDelete(lookupId, authHeader)
        }

}
