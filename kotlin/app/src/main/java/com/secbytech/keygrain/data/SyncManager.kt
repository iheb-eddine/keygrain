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


    /**
     * Remote state as of the GET, after every integrity check has passed.
     *
     * [knownWalletKeys] is part of this snapshot rather than read separately because the
     * NotFound branch deliberately resets it -- local wallets must not be read as
     * "deleted remotely" when the server simply holds no record.
     */
    private data class RemoteState(
        val services: List<ServiceEntry>,
        val wallets: List<WalletEntry>,
        val auditLog: List<WalletAuditEntry>,
        val conflicts: List<SyncConflict>,
        val metadata: List<Pair<String?, Long>>,
        val etag: String?,
        val status: String,
        val exists: Boolean,
        val knownWalletKeys: Set<String>
    )

    /**
     * Total result of the fetch phase. A sealed type rather than a nullable so that
     * failing to propagate an error is a compile error, not a silent fall-through into a
     * push against an empty remote snapshot.
     */
    private sealed interface FetchOutcome {
        data class Fetched(val remote: RemoteState) : FetchOutcome
        data class Failed(val result: SyncResult) : FetchOutcome
    }

    /** Local state merged against [RemoteState]. */
    private data class MergedState(
        val rec: SyncReconciler.ReconcileResult,
        val services: List<ServiceEntry>,
        val wallets: List<WalletEntry>,
        val auditLog: List<WalletAuditEntry>,
        val newWalletKeys: Set<String>
    )

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
            val remote = when (
                val outcome = fetchRemote(lookupId, authHeader, encryptionKey, serviceManager, context)
            ) {
                is FetchOutcome.Failed -> return@withContext outcome.result
                is FetchOutcome.Fetched -> outcome.remote
            }

            // Step 2: Reconcile
            val m = reconcile(remote, serviceManager, context)

            // Empty-push protection: an empty push is legitimate only when every remote
            // id it drops is explicitly declared as deleted.
            if (m.services.isEmpty() && remote.metadata.isNotEmpty()) {
                val declared = m.rec.deletedIds.toSet()
                val allDeclared = remote.metadata.all { it.first != null && declared.contains(it.first) }
                if (!allDeclared) {
                    return@withContext SyncResult.IntegrityError("empty push blocked: merge produced no services but remote had ${remote.metadata.size}")
                }
            }

            // Merge conflicts: remote + new, dedup by key, cap at 50
            val syncConflicts = mergeConflicts(context, remote.conflicts, m.rec.syncConflicts)

            // Step 3b: no-op skip (Frozen Req 9).
            trySkipPush(remote, m, syncConflicts, serviceManager, context)
                ?.let { return@withContext it }

            // Step 3: Build push payload
            val putBody = encodePushBody(lookupId, encryptionKey, m, syncConflicts)

            // Step 4: PUT
            val putResult = transport.doPut(lookupId, authHeader, putBody, remote.etag)

            when (putResult) {
                is PutResult.Success -> {
                    val confirmed = persistPushed(putResult, remote, m, serviceManager, context)
                    SyncResult.Success(confirmed, m.wallets, m.auditLog, syncConflicts, remote.status)
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
     * Step 1: GET, verify checksum, decrypt, then verify metadata length and that the
     * metadata has not been tampered with against the local cache.
     *
     * Does NOT zero [encryptionKey] -- the push phase still needs it; [sync] owns its
     * lifetime and wipes it in a `finally`.
     */
    private fun fetchRemote(
        lookupId: String,
        authHeader: String,
        encryptionKey: ByteArray,
        serviceManager: ServiceManager,
        context: Context
    ): FetchOutcome {
        when (val getResult = transport.doGet(lookupId, authHeader)) {
            is GetResult.Success -> {
                // Validate checksum
                val blobBytes = Base64.decode(getResult.encryptedBlob, Base64.DEFAULT)
                val checksum = SyncIntegrity.sha256Hex(blobBytes)
                if (checksum != getResult.checksum) {
                    return FetchOutcome.Failed(SyncResult.IntegrityError("checksum mismatch"))
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
                val remoteMetadata = getResult.services

                // Validate length
                if (remoteMetadata.size != blobContent.services.size) {
                    return FetchOutcome.Failed(SyncResult.IntegrityError("metadata length mismatch"))
                }

                // Validate metadata integrity
                val cachedMeta = SyncStore.getMetadataCache(context)
                if (cachedMeta != null) {
                    val violation = SyncIntegrity.validateMetadataIntegrity(remoteMetadata, cachedMeta)
                    if (violation != null) {
                        return FetchOutcome.Failed(SyncResult.IntegrityError("metadata tamper: $violation"))
                    }
                }

                return FetchOutcome.Fetched(
                    RemoteState(
                        services = blobContent.services,
                        wallets = blobContent.wallets,
                        auditLog = blobContent.auditLog,
                        conflicts = blobContent.syncConflicts,
                        metadata = remoteMetadata,
                        etag = getResult.etag,
                        status = "synced",
                        exists = true,
                        knownWalletKeys = SyncStore.getKnownWalletKeys(context)
                    )
                )
            }
            is GetResult.NotFound -> {
                // Frozen Req 11: no remote record. NEVER inferred as deletions — see
                // SyncReconciler.reconcileServices(remoteExists=false). Wallet known-keys are also
                // reset so local wallets are not read as "deleted remotely".
                SyncStore.setKnownWalletKeys(context, emptySet())
                return FetchOutcome.Fetched(
                    RemoteState(
                        services = emptyList(),
                        wallets = emptyList(),
                        auditLog = emptyList(),
                        conflicts = emptyList(),
                        metadata = emptyList(),
                        etag = null,
                        status = "created",
                        exists = false,
                        knownWalletKeys = emptySet()
                    )
                )
            }
            is GetResult.AuthError -> return FetchOutcome.Failed(SyncResult.AuthError(getResult.code))
            is GetResult.Error ->
                return FetchOutcome.Failed(SyncResult.ServerError(getResult.code, getResult.body))
            is GetResult.NetworkError ->
                return FetchOutcome.Failed(SyncResult.NetworkError(getResult.cause))
        }
    }

    /** Step 2: reconcile services, then merge wallets and the wallet audit log. */
    private fun reconcile(
        remote: RemoteState,
        serviceManager: ServiceManager,
        context: Context
    ): MergedState {
        val rec = SyncReconciler.reconcileServices(
            serviceManager.getServices(),
            serviceManager.getTombstones(),
            remote.services,
            remote.metadata,
            SyncStore.getLastSuccessfulSyncAt(context),
            remote.exists
        )
        val (mergedWallets, newWKeys) =
            SyncMerge.mergeWallets(SyncStore.getWallets(context), remote.wallets, remote.knownWalletKeys)
        val mergedAuditLog =
            SyncMerge.mergeAuditLog(SyncStore.getAuditLog(context), remote.auditLog)
        return MergedState(rec, rec.merged, mergedWallets, mergedAuditLog, newWKeys)
    }

    /** Remote + newly detected conflicts, deduped by key, oldest first, newest 50 kept. */
    private fun mergeConflicts(
        context: Context,
        remoteConflicts: List<SyncConflict>,
        newConflicts: List<SyncConflict>
    ): List<SyncConflict> {
        val effectiveRemoteConflicts =
            if (SyncStore.areConflictsDismissed(context)) emptyList() else remoteConflicts
        val conflictKeySet = mutableSetOf<String>()
        val mergedConflicts = mutableListOf<SyncConflict>()
        for (c in effectiveRemoteConflicts + newConflicts) {
            if (conflictKeySet.add(c.dedupeKey())) mergedConflicts.add(c)
        }
        mergedConflicts.sortBy { it.detectedAt }
        return mergedConflicts.takeLast(50)
    }

    /**
     * Step 3b: skip the PUT when the canonical local and remote payloads are identical
     * (Frozen Req 9). An idle sync then costs one GET and no PUT, which also stops the
     * random-IV/new-ETag churn that manufactures cross-device 409s and exhausts the
     * per-lookup rate-limit bucket.
     *
     * Returns the success result when the push was skipped, or null to continue to PUT.
     * Deliberately narrower than [persistPushed]: nothing was pushed, so the metadata
     * cache, the wallet/audit blobs and the conflicts-dismissed flag are left alone.
     */
    private fun trySkipPush(
        remote: RemoteState,
        m: MergedState,
        syncConflicts: List<SyncConflict>,
        serviceManager: ServiceManager,
        context: Context
    ): SyncResult.Success? {
        if (!remote.exists || m.rec.deletedIds.isNotEmpty()) return null
        val localCanon =
            SyncBlob.canonicalBlobPayload(m.services, m.wallets, m.auditLog, syncConflicts)
        val remoteWithMeta = remote.metadata.indices.mapNotNull { i ->
            val id = remote.metadata[i].first ?: return@mapNotNull null
            remote.services[i].copy(id = id, updatedAt = remote.metadata[i].second)
        }
        val remoteCanon = SyncBlob.canonicalBlobPayload(
            remoteWithMeta, remote.wallets, remote.auditLog, remote.conflicts
        )
        if (localCanon != remoteCanon) return null

        serviceManager.replaceAll(m.services)
        serviceManager.setTombstones(emptyList())
        if (m.rec.review.isNotEmpty()) {
            serviceManager.setDeletionReview(serviceManager.getDeletionReview() + m.rec.review)
        }
        SyncStore.setKnownWalletKeys(context, m.newWalletKeys)
        SyncStore.setLastSuccessfulSyncAt(context, System.currentTimeMillis())
        return SyncResult.Success(m.services, m.wallets, m.auditLog, syncConflicts, "unchanged")
    }

    /** Step 3: build the encrypted PUT body. */
    private fun encodePushBody(
        lookupId: String,
        encryptionKey: ByteArray,
        m: MergedState,
        syncConflicts: List<SyncConflict>
    ): String {
        val contentArray = JSONArray()
        val metadataArray = JSONArray()
        for (svc in m.services) {
            contentArray.put(svc.toJsonContent())
            metadataArray.put(JSONObject().apply {
                put("id", svc.id)
                put("updated_at", svc.updatedAt)
            })
        }

        val walletsArray = JSONArray().apply { m.wallets.forEach { put(it.toJson()) } }
        val auditArray = JSONArray().apply { m.auditLog.forEach { put(it.toJson()) } }
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
        val checksum = SyncIntegrity.sha256Hex(encrypted)

        return JSONObject().apply {
            put("services", metadataArray)
            put("encrypted_blob", encryptedB64)
            put("checksum", checksum)
            put("deleted_ids", JSONArray().apply { m.rec.deletedIds.forEach { put(it) } })
        }.toString()
    }

    /**
     * Confirmed 2xx: only now is it safe to mark the pushed ids synced, clear the
     * tombstones the server no longer holds, and advance the sync barrier
     * (§3 steps 5-6, Frozen Reqs 1/5/8).
     */
    private fun persistPushed(
        putResult: PutResult.Success,
        remote: RemoteState,
        m: MergedState,
        serviceManager: ServiceManager,
        context: Context
    ): List<ServiceEntry> {
        val pushedIds = m.services.mapNotNull { it.id }.toSet()
        val confirmed = m.services.map {
            if (it.id != null && pushedIds.contains(it.id)) it.copy(synced = true) else it
        }
        serviceManager.replaceAll(confirmed)
        serviceManager.setTombstones(m.rec.tombstones.filter { pushedIds.contains(it.id) })
        if (m.rec.review.isNotEmpty()) {
            serviceManager.setDeletionReview(serviceManager.getDeletionReview() + m.rec.review)
        }
        SyncStore.setMetadataCache(context, putResult.services)
        SyncStore.setKnownWalletKeys(context, m.newWalletKeys)
        SyncStore.saveWallets(context, m.wallets)
        SyncStore.saveAuditLog(context, m.auditLog)
        SyncStore.setLastSuccessfulSyncAt(context, System.currentTimeMillis())
        SyncStore.setConflictsDismissed(context, false)
        return confirmed
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
