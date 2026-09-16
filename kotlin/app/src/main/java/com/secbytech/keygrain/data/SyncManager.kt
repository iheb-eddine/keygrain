package com.secbytech.keygrain.data

import android.content.Context
import java.util.Base64
import java.io.IOException
import javax.crypto.AEADBadTagException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Seam representing local persistence for sync orchestration. */
internal interface SyncLocalState {
    fun getServices(): List<ServiceEntry>
    fun replaceServices(services: List<ServiceEntry>)
    fun getDeletionReview(): List<DeletionReviewEntry>
    fun setDeletionReview(review: List<DeletionReviewEntry>)
    fun parseServicesJson(json: String): List<ServiceEntry>

    fun getSshKeys(): List<SshKeyEntry>
    fun saveSshKeys(keys: List<SshKeyEntry>)

    fun getWallets(): List<WalletEntry>
    fun saveWallets(wallets: List<WalletEntry>)

    fun getTombstones(): List<SyncTombstone>
    fun setTombstones(tombstones: List<SyncTombstone>)

    fun getServiceTombstones(): List<SyncTombstone> = getTombstones()
    fun setServiceTombstones(tombstones: List<SyncTombstone>) = setTombstones(tombstones)
    fun getSshTombstones(): List<SyncTombstone> = getTombstones()
    fun setSshTombstones(tombstones: List<SyncTombstone>) = setTombstones(tombstones)
    fun getWalletTombstones(): List<SyncTombstone> = getTombstones()
    fun setWalletTombstones(tombstones: List<SyncTombstone>) = setTombstones(tombstones)

    fun getLastSuccessfulSyncAt(): Long
    fun setLastSuccessfulSyncAt(ts: Long)

    fun getSyncVersion(): Int
    fun setSyncVersion(version: Int)

    fun isAadEnabled(): Boolean
    fun setAadEnabled(enabled: Boolean)

    fun areConflictsDismissed(): Boolean
    fun setConflictsDismissed(dismissed: Boolean)
}

internal class AndroidSyncLocalState(
    private val serviceManager: ServiceManager,
    private val context: Context
) : SyncLocalState {
    override fun getServices(): List<ServiceEntry> = serviceManager.getServices()
    override fun replaceServices(services: List<ServiceEntry>) = serviceManager.replaceAll(services)
    override fun getDeletionReview(): List<DeletionReviewEntry> = serviceManager.getDeletionReview()
    override fun setDeletionReview(review: List<DeletionReviewEntry>) = serviceManager.setDeletionReview(review)
    override fun parseServicesJson(json: String): List<ServiceEntry> = serviceManager.parseJson(json)

    override fun getSshKeys(): List<SshKeyEntry> = SyncStore.getSshKeys(context)
    override fun saveSshKeys(keys: List<SshKeyEntry>) = SyncStore.saveSshKeys(context, keys)

    override fun getWallets(): List<WalletEntry> = SyncStore.getWallets(context)
    override fun saveWallets(wallets: List<WalletEntry>) = SyncStore.saveWallets(context, wallets)

    override fun getTombstones(): List<SyncTombstone> {
        val smTombs = serviceManager.getTombstones()
        val storeTombs = SyncStore.getTombstones(context)
        val map = mutableMapOf<String, Long>()
        for (t in smTombs + storeTombs) {
            val prev = map[t.id]
            if (prev == null || t.deletedAt > prev) map[t.id] = t.deletedAt
        }
        return map.entries.map { SyncTombstone(it.key, it.value) }
    }

    override fun setTombstones(tombstones: List<SyncTombstone>) {
        serviceManager.setTombstones(emptyList())
        SyncStore.setTombstones(context, tombstones)
    }

    override fun getLastSuccessfulSyncAt(): Long = SyncStore.getLastSuccessfulSyncAt(context)
    override fun setLastSuccessfulSyncAt(ts: Long) = SyncStore.setLastSuccessfulSyncAt(context, ts)

    override fun getSyncVersion(): Int = SyncStore.getSyncVersion(context)
    override fun setSyncVersion(version: Int) = SyncStore.setSyncVersion(context, version)

    override fun isAadEnabled(): Boolean = SyncStore.isAadEnabled(context)
    override fun setAadEnabled(enabled: Boolean) = SyncStore.setAadEnabled(context, enabled)

    override fun areConflictsDismissed(): Boolean = SyncStore.areConflictsDismissed(context)
    override fun setConflictsDismissed(dismissed: Boolean) = SyncStore.setConflictsDismissed(context, dismissed)
}

class SyncManager(
    private val baseUrl: String = "https://keygrain.com"
) {
    private var transport: SyncTransportApi = SyncTransport(baseUrl)

    internal constructor(injectedTransport: SyncTransportApi) : this() {
        transport = injectedTransport
    }

    // --- Facade over SyncStore, kept so UI call sites are unchanged --------------------

    fun getSyncEmail(context: Context): String? = SyncStore.getSyncEmail(context)

    fun setSyncEmail(context: Context, email: String) = SyncStore.setSyncEmail(context, email)

    fun clearLocalData(context: Context) = SyncStore.clearLocalData(context)

    fun migrateFromKnownUUIDs(context: Context, serviceManager: ServiceManager) =
        SyncStore.migrateFromKnownUUIDs(context, serviceManager)

    fun getWallets(context: Context): List<WalletEntry> = SyncStore.getWallets(context)

    fun saveWallets(context: Context, wallets: List<WalletEntry>) =
        SyncStore.saveWallets(context, wallets)

    fun putWallet(context: Context, wallet: WalletEntry) =
        SyncStore.putWallet(context, wallet)

    fun removeWallet(context: Context, wallet: WalletEntry) =
        SyncStore.removeWallet(context, wallet)

    fun saveSshKeys(context: Context, keys: List<SshKeyEntry>) =
        SyncStore.saveSshKeys(context, keys)

    fun getSshKeys(context: Context): List<SshKeyEntry> =
        SyncStore.getSshKeys(context)

    fun putSshKey(context: Context, key: SshKeyEntry) =
        SyncStore.putSshKey(context, key)

    fun removeSshKey(context: Context, key: SshKeyEntry) =
        SyncStore.removeSshKey(context, key)

    fun getTombstones(context: Context): List<SyncTombstone> =
        SyncStore.getTombstones(context)

    fun setTombstones(context: Context, tombstones: List<SyncTombstone>) =
        SyncStore.setTombstones(context, tombstones)

    fun deleteService(context: Context, serviceManager: ServiceManager, id: String) {
        serviceManager.deleteService(id)
        SyncStore.appendTombstone(context, id)
    }

    fun getAuditLog(context: Context): List<WalletAuditEntry> = SyncStore.getAuditLog(context)

    fun saveAuditLog(context: Context, log: List<WalletAuditEntry>) =
        SyncStore.saveAuditLog(context, log)


    internal fun conflictBackoffMs(retryCount: Int): Long =
        when (retryCount) {
            0 -> 250L
            1 -> 1000L
            else -> 3000L
        }

    internal fun conflictBackoffWithJitterMs(retryCount: Int): Long {
        val base = conflictBackoffMs(retryCount)
        val jitter = 0.75 + Math.random() * 0.5
        return (base * jitter).toLong()
    }


    /**
     * Remote state as of the GET, after every integrity check has passed.
     */
    private data class RemoteState(
        val services: List<ServiceEntry>,
        val sshKeys: List<SshKeyEntry>,
        val wallets: List<WalletEntry>,
        val auditLog: List<WalletAuditEntry> = emptyList(),
        val conflicts: List<SyncConflict>,
        val version: Int,
        val etag: String?,
        val status: String,
        val exists: Boolean
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
        val sshKeys: List<SshKeyEntry>,
        val wallets: List<WalletEntry>,
        val auditLog: List<WalletAuditEntry> = emptyList(),
        val remainingTombstones: List<SyncTombstone>,
        val allDeletedIds: List<String>,
        val allConflicts: List<SyncConflict>
    )

    suspend fun sync(
        secret: ByteArray,
        email: String,
        serviceManager: ServiceManager,
        context: Context,
        retryCount: Int = 0
    ): SyncResult = syncInternal(secret, email, AndroidSyncLocalState(serviceManager, context), retryCount)

    internal suspend fun sync(
        secret: ByteArray,
        email: String,
        localState: SyncLocalState,
        retryCount: Int = 0
    ): SyncResult = syncInternal(secret, email, localState, retryCount)

    /**
     * Exercises the same fetch/terminal-result path without constructing Android storage.
     * It is intentionally usable only for an incompatible GET: any compatible response
     * reaches requireNotNull below the fetch boundary and fails the test rather than hiding
     * missing local-state setup.
     */
    @androidx.annotation.VisibleForTesting
    internal suspend fun syncWithoutLocalStateForTesting(
        secret: ByteArray,
        email: String
    ): SyncResult = syncInternal(secret, email, null, 0)

    private suspend fun syncInternal(
        secret: ByteArray,
        email: String,
        localState: SyncLocalState?,
        retryCount: Int
    ): SyncResult = withContext(Dispatchers.IO) {
        val lookupId = Keygrain.deriveLookupId(secret, email)
        val authPassword = Keygrain.deriveAuthPassword(secret, email)
        val encryptionKey = Keygrain.deriveEncryptionKey(secret, email)
        val authHeader = "Basic " + Base64.getEncoder().encodeToString(
            "$lookupId:$authPassword".toByteArray(Charsets.UTF_8)
        )

        try {
            // Step 1: GET remote state
            val remote = when (
                val outcome = fetchRemote(lookupId, authHeader, encryptionKey, localState)
            ) {
                is FetchOutcome.Failed -> return@withContext outcome.result
                is FetchOutcome.Fetched -> outcome.remote
            }

            // Compatible GETs require non-null local storage
            val currentLocalState = requireNotNull(localState)

            // Step 2: Reconcile
            val m = reconcile(remote, currentLocalState)

            // Empty-push protection: an empty push is legitimate only when every remote
            // service it drops is explicitly declared as deleted.
            if (m.services.isEmpty() && remote.services.isNotEmpty()) {
                val declared = m.rec.deletedIds.toSet()
                val allDeclared = remote.services.all { it.id != null && declared.contains(it.id) }
                if (!allDeclared) {
                    return@withContext SyncResult.IntegrityError(
                        "empty push blocked: merge produced no services but remote had ${remote.services.size}"
                    )
                }
            }

            // Merge conflicts: remote + new, dedup by key, cap at 50
            val syncConflicts = mergeConflicts(currentLocalState, remote.conflicts, m.allConflicts)

            // Step 3b: Client Dirty-Checking (Zero-Write on No-Op)
            trySkipPush(remote, m, syncConflicts, currentLocalState)
                ?.let { return@withContext it }

            // Step 3: Build push payload
            val nextVersion = if (remote.exists) (remote.version + 1) else 1
            val putBody = encodePushBody(lookupId, encryptionKey, m, syncConflicts, nextVersion)

            // Step 4: PUT
            val putResult = transport.doPut(lookupId, authHeader, putBody, remote.etag)

            when (putResult) {
                is PutResult.Success -> {
                    val confirmedVersion = if (putResult.version > 0) putResult.version else nextVersion
                    val confirmed = persistPushed(confirmedVersion, m, currentLocalState)
                    SyncResult.Success(
                        services = confirmed,
                        sshKeys = m.sshKeys,
                        wallets = m.wallets,
                        walletAuditLog = emptyList(),
                        syncConflicts = syncConflicts,
                        status = if (remote.exists) "synced" else "created",
                        version = confirmedVersion
                    )
                }
                is PutResult.Conflict -> {
                    if (retryCount < 3) {
                        // Bounded jittered backoff: [250, 1000, 3000][retryCount] * (0.75 + Math.random() * 0.5)
                        delay(conflictBackoffWithJitterMs(retryCount))
                        syncInternal(secret, email, currentLocalState, retryCount + 1)
                    } else {
                        SyncResult.Conflict
                    }
                }
                is PutResult.AuthError -> SyncResult.AuthError(putResult.code)
                is PutResult.UpgradeRequired -> SyncResult.UpgradeRequired
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
     * Step 1: GET, verify checksum, decrypt payload.
     */
    private fun fetchRemote(
        lookupId: String,
        authHeader: String,
        encryptionKey: ByteArray,
        localState: SyncLocalState?
    ): FetchOutcome {
        when (val getResult = transport.doGet(lookupId, authHeader)) {
            is GetResult.Success -> {
                val currentLocalState = requireNotNull(localState)
                // Validate checksum
                val blobBytes = Base64.getDecoder().decode(getResult.encryptedBlob.trim())
                val checksum = SyncIntegrity.sha256Hex(blobBytes)
                if (checksum != getResult.checksum) {
                    return FetchOutcome.Failed(SyncResult.IntegrityError("checksum mismatch"))
                }

                // Decrypt with AAD, fallback to no-AAD only for first-time migration
                val aad = lookupId.toByteArray(Charsets.UTF_8)
                val plaintext = try {
                    SyncCrypto.decrypt(encryptionKey, blobBytes, aad).also {
                        currentLocalState.setAadEnabled(true)
                    }
                } catch (e: AEADBadTagException) {
                    if (currentLocalState.isAadEnabled()) throw e
                    SyncCrypto.decrypt(encryptionKey, blobBytes)
                }
                val json = String(plaintext, Charsets.UTF_8)
                val blobContent = SyncBlob.parseBlobContent(json) { currentLocalState.parseServicesJson(it) }

                return FetchOutcome.Fetched(
                    RemoteState(
                        services = blobContent.services,
                        sshKeys = blobContent.sshKeys,
                        wallets = blobContent.wallets,
                        auditLog = emptyList(),
                        conflicts = blobContent.syncConflicts,
                        version = getResult.version,
                        etag = getResult.etag,
                        status = "synced",
                        exists = true
                    )
                )
            }
            is GetResult.NotFound -> {
                return FetchOutcome.Fetched(
                    RemoteState(
                        services = emptyList(),
                        sshKeys = emptyList(),
                        wallets = emptyList(),
                        auditLog = emptyList(),
                        conflicts = emptyList(),
                        version = 0,
                        etag = null,
                        status = "created",
                        exists = false
                    )
                )
            }
            is GetResult.AuthError -> return FetchOutcome.Failed(SyncResult.AuthError(getResult.code))
            is GetResult.UpgradeRequired -> return FetchOutcome.Failed(SyncResult.UpgradeRequired)
            is GetResult.Error ->
                return FetchOutcome.Failed(SyncResult.ServerError(getResult.code, getResult.body))
            is GetResult.NetworkError ->
                return FetchOutcome.Failed(SyncResult.NetworkError(getResult.cause))
        }
    }

    /** Step 2: reconcile services, then merge wallets and ssh keys. */
    private fun reconcile(
        remote: RemoteState,
        localState: SyncLocalState
    ): MergedState {
        val lastSyncAt = localState.getLastSuccessfulSyncAt()
        val localTombstones = localState.getTombstones()
        val recServices = SyncReconciler.reconcileServices(
            local = localState.getServices(),
            localTombstones = localTombstones,
            remote = remote.services,
            remoteMeta = emptyList(),
            lastSyncAt = lastSyncAt,
            remoteExists = remote.exists
        )
        val recSsh = SyncMerge.mergeSshKeys(
            local = localState.getSshKeys(),
            remote = remote.sshKeys,
            tombstones = localTombstones,
            lastSyncAt = lastSyncAt,
            remoteExists = remote.exists
        )
        val recWallets = SyncMerge.mergeWallets(
            local = localState.getWallets(),
            remote = remote.wallets,
            tombstones = localTombstones,
            lastSyncAt = lastSyncAt,
            remoteExists = remote.exists
        )

        val allDeletedIds = (recServices.deletedIds + recSsh.deletedIds + recWallets.deletedIds).distinct()

        val retainedTombstonesMap = mutableMapOf<String, Long>()
        for (t in recServices.tombstones + recSsh.tombstones + recWallets.tombstones) {
            if (t.id.isEmpty()) continue
            val prev = retainedTombstonesMap[t.id]
            if (prev == null || t.deletedAt > prev) {
                retainedTombstonesMap[t.id] = t.deletedAt
            }
        }
        val remainingTombstones = retainedTombstonesMap.entries.map { SyncTombstone(it.key, it.value) }

        return MergedState(
            rec = recServices,
            services = recServices.merged,
            sshKeys = recSsh.merged,
            wallets = recWallets.merged,
            auditLog = emptyList(),
            remainingTombstones = remainingTombstones,
            allDeletedIds = allDeletedIds,
            allConflicts = recServices.syncConflicts + recSsh.syncConflicts + recWallets.syncConflicts
        )
    }

    /** Remote + newly detected conflicts, deduped by key, oldest first, newest 50 kept. */
    private fun mergeConflicts(
        localState: SyncLocalState,
        remoteConflicts: List<SyncConflict>,
        newConflicts: List<SyncConflict>
    ): List<SyncConflict> {
        val effectiveRemoteConflicts =
            if (localState.areConflictsDismissed()) emptyList() else remoteConflicts
        val conflictKeySet = mutableSetOf<String>()
        val mergedConflicts = mutableListOf<SyncConflict>()
        for (c in effectiveRemoteConflicts + newConflicts) {
            if (conflictKeySet.add(c.dedupeKey())) mergedConflicts.add(c)
        }
        mergedConflicts.sortBy { it.detectedAt }
        return mergedConflicts.takeLast(50)
    }

    /**
     * Step 3b: skip the PUT when the canonical local and remote payloads are identical.
     * An idle sync then costs one GET and no PUT, which stops random-IV/new-ETag churn,
     * rate-limit burning, and synthetic 409 collisions.
     */
    private fun trySkipPush(
        remote: RemoteState,
        m: MergedState,
        syncConflicts: List<SyncConflict>,
        localState: SyncLocalState
    ): SyncResult.Success? {
        val hasPendingTombstones = m.remainingTombstones.isNotEmpty() || m.allDeletedIds.isNotEmpty()

        if (!remote.exists || hasPendingTombstones) return null

        val localCanon =
            SyncBlob.canonicalBlobPayload(m.services, m.sshKeys, m.wallets, syncConflicts)
        val remoteCanon = SyncBlob.canonicalBlobPayload(
            remote.services, remote.sshKeys, remote.wallets, remote.conflicts
        )
        if (localCanon != remoteCanon) return null

        localState.replaceServices(m.services)
        if (m.rec.review.isNotEmpty()) {
            localState.setDeletionReview(localState.getDeletionReview() + m.rec.review)
        }
        localState.saveSshKeys(m.sshKeys)
        localState.saveWallets(m.wallets)
        localState.setTombstones(m.remainingTombstones)
        localState.setSyncVersion(remote.version)
        localState.setLastSuccessfulSyncAt(System.currentTimeMillis())
        return SyncResult.Success(
            services = m.services,
            sshKeys = m.sshKeys,
            wallets = m.wallets,
            walletAuditLog = emptyList(),
            syncConflicts = syncConflicts,
            status = "unchanged",
            version = remote.version
        )
    }

    /** Step 3: build the encrypted PUT body strictly conforming to Sync v4 ZK envelope. */
    private fun encodePushBody(
        lookupId: String,
        encryptionKey: ByteArray,
        m: MergedState,
        syncConflicts: List<SyncConflict>,
        version: Int
    ): String {
        val servicesArray = JSONArray()
        for (svc in m.services) {
            val serviceJson = svc.toJsonContent().apply {
                if (svc.id != null) put("id", svc.id)
                put("updated_at", svc.updatedAt)
                remove("ssh")
            }
            servicesArray.put(serviceJson)
        }

        val sshArray = JSONArray().apply { m.sshKeys.forEach { put(it.toJson(includeSynced = false)) } }
        val walletsArray = JSONArray().apply { m.wallets.forEach { put(it.toJson(includeSynced = false)) } }
        val conflictsArray = JSONArray().apply { syncConflicts.forEach { put(it.toJson()) } }

        val blobPayload = JSONObject().apply {
            put("services", servicesArray)
            put("ssh_keys", sshArray)
            put("wallets", walletsArray)
            put("sync_conflicts", conflictsArray)
        }

        val plaintext = blobPayload.toString().toByteArray(Charsets.UTF_8)
        val aadEnc = lookupId.toByteArray(Charsets.UTF_8)
        val encrypted = SyncCrypto.encrypt(encryptionKey, plaintext, aadEnc)
        val encryptedB64 = Base64.getEncoder().encodeToString(encrypted)
        val checksum = SyncIntegrity.sha256Hex(encrypted)

        return JSONObject().apply {
            put("version", version)
            put("encrypted_blob", encryptedB64)
            put("checksum", checksum)
        }.toString()
    }

    /**
     * Confirmed 2xx: mark pushed ids synced, clear tombstones, and advance version and sync barrier.
     */
    private fun persistPushed(
        confirmedVersion: Int,
        m: MergedState,
        localState: SyncLocalState
    ): List<ServiceEntry> {
        val confirmedServices = m.services.map { it.copy(synced = true) }
        val confirmedSshKeys = m.sshKeys.map { it.copy(synced = true) }
        val confirmedWallets = m.wallets.map { it.copy(synced = true) }

        localState.replaceServices(confirmedServices)
        if (m.rec.review.isNotEmpty()) {
            localState.setDeletionReview(localState.getDeletionReview() + m.rec.review)
        }
        localState.saveSshKeys(confirmedSshKeys)
        localState.saveWallets(confirmedWallets)
        localState.setTombstones(emptyList())
        localState.setSyncVersion(confirmedVersion)
        localState.setLastSuccessfulSyncAt(System.currentTimeMillis())
        localState.setConflictsDismissed(false)
        return confirmedServices
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
            val authHeader = "Basic " + Base64.getEncoder().encodeToString(
                "$lookupId:$authPassword".toByteArray(Charsets.UTF_8)
            )
            transport.doDelete(lookupId, authHeader)
        }

}
