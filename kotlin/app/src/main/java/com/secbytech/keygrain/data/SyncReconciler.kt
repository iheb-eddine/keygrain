package com.secbytech.keygrain.data

/**
 * Unified Entity Reconciliation (Identity Principle). Pure: no Context, no android.util.Base64, no network,
 * which is what lets SyncReconcileTest drive it from the same
 * sync-reconcile-vectors.json the JS suite uses.
 */
internal object SyncReconciler {
    internal data class ReconcileResult(
        val merged: List<ServiceEntry>,
        val tombstones: List<SyncTombstone>,
        val deletedIds: List<String>,
        val review: List<DeletionReviewEntry>,
        val resurrected: List<String>,
        val syncConflicts: List<SyncConflict>
    )

    internal data class ReconcileEntityResult<T>(
        val merged: List<T>,
        val tombstones: List<SyncTombstone>,
        val deletedIds: List<String> = emptyList(),
        val review: List<T> = emptyList(),
        val resurrected: List<String> = emptyList(),
        val syncConflicts: List<SyncConflict> = emptyList()
    )

    internal interface EntitySyncPolicy<T> {
        fun id(item: T): String
        fun updatedAt(item: T): Long
        fun isSynced(item: T): Boolean
        fun withSynced(item: T, synced: Boolean): T
        fun withId(item: T, id: String): T
        fun semanticKey(item: T): String
        fun candidateKeys(item: T): List<String>
        fun detectConflict(winner: T, loser: T): SyncConflict? = null
    }

    val SERVICE_POLICY = object : EntitySyncPolicy<ServiceEntry> {
        override fun id(item: ServiceEntry): String = item.id ?: ""
        override fun updatedAt(item: ServiceEntry): Long = item.updatedAt
        override fun isSynced(item: ServiceEntry): Boolean = item.synced
        override fun withSynced(item: ServiceEntry, synced: Boolean): ServiceEntry = item.copy(synced = synced)
        override fun withId(item: ServiceEntry, id: String): ServiceEntry = item.copy(id = id)
        override fun semanticKey(item: ServiceEntry): String {
            val normalized = ServiceManager.normalizeSite(item.site)
            val siteKey = normalized.ifEmpty { item.id ?: item.site }
            return siteKey + "\n" + item.email.lowercase()
        }
        override fun candidateKeys(item: ServiceEntry): List<String> = listOfNotNull(
            item.id?.trim()?.lowercase(),
            item.id
        ).distinct()
        override fun detectConflict(winner: ServiceEntry, loser: ServiceEntry): SyncConflict? {
            if (loser.length != winner.length || loser.symbols != winner.symbols ||
                loser.counter != winner.counter ||
                (loser.totp?.toString() ?: "") != (winner.totp?.toString() ?: "") ||
                (loser.ssh?.toString() ?: "") != (winner.ssh?.toString() ?: "")) {
                val loserJson = loser.toJsonContent().apply {
                    put("id", loser.id ?: "")
                    put("updated_at", loser.updatedAt)
                }
                return SyncConflict(winner.id ?: "", loserJson, java.time.Instant.now().toString())
            }
            return null
        }
    }

    internal fun <T> reconcileCollection(
        localItems: List<T>,
        localTombstones: List<SyncTombstone>,
        remoteItems: List<T>,
        remoteMetadata: List<Pair<String?, Long>> = emptyList(),
        lastSyncAt: Long = 0L,
        remoteExists: Boolean = true,
        policy: EntitySyncPolicy<T>
    ): ReconcileEntityResult<T> {
        val remoteByID = mutableMapOf<String, T>()
        val remoteBySemanticKey = mutableMapOf<String, T>()

        if (remoteMetadata.isNotEmpty()) {
            for (i in remoteMetadata.indices) {
                val id = remoteMetadata[i].first ?: continue
                val content = if (i < remoteItems.size) remoteItems[i] else null
                val base = content ?: run {
                    if (policy === SERVICE_POLICY) {
                        @Suppress("UNCHECKED_CAST")
                        ServiceEntry(name = id, site = id, email = "") as T
                    } else null
                }
                if (base != null) {
                    val withId = policy.withId(base, id)
                    val withSynced = policy.withSynced(withId, true)
                    val item = if (withSynced is ServiceEntry) {
                        @Suppress("UNCHECKED_CAST")
                        withSynced.copy(updatedAt = remoteMetadata[i].second) as T
                    } else withSynced
                    remoteByID[id] = item
                    val semKey = policy.semanticKey(item)
                    if (semKey.isNotEmpty()) remoteBySemanticKey[semKey] = item
                }
            }
        } else {
            for (r in remoteItems) {
                val rId = policy.id(r).ifEmpty { policy.semanticKey(r) }
                if (rId.isNotEmpty()) {
                    val item = policy.withSynced(r, true)
                    remoteByID[rId] = item
                    val semKey = policy.semanticKey(item)
                    if (semKey.isNotEmpty()) remoteBySemanticKey[semKey] = item
                }
            }
        }

        val localByID = mutableMapOf<String, T>()
        val localBySemanticKey = mutableMapOf<String, T>()
        val localWithoutId = mutableListOf<T>()
        for (item in localItems) {
            val id = policy.id(item)
            if (id.isNotEmpty()) {
                localByID[id] = item
                val semKey = policy.semanticKey(item)
                if (semKey.isNotEmpty()) localBySemanticKey[semKey] = item
            } else {
                localWithoutId.add(item)
            }
        }

        // Tombstones indexed by id
        val tombByID = mutableMapOf<String, Long>()
        for (t in localTombstones) {
            val key = t.id.trim().lowercase()
            val prev = tombByID[key]
            if (prev == null || t.deletedAt > prev) tombByID[key] = t.deletedAt
            val prevExact = tombByID[t.id]
            if (prevExact == null || t.deletedAt > prevExact) tombByID[t.id] = t.deletedAt
        }

        fun findTombstone(id: String, item: T?): Long? {
            var maxTs: Long? = tombByID[id] ?: tombByID[id.trim().lowercase()]
            if (item != null) {
                for (k in policy.candidateKeys(item)) {
                    val ts = tombByID[k] ?: tombByID[k.trim().lowercase()]
                    if (ts != null && (maxTs == null || ts > maxTs)) {
                        maxTs = ts
                    }
                }
            }
            return maxTs
        }

        val merged = mutableListOf<T>()
        val retainedTombstones = mutableListOf<SyncTombstone>()
        val deletedIds = mutableListOf<String>()
        val review = mutableListOf<T>()
        val resurrected = mutableListOf<String>()

        if (!remoteExists) {
            for (item in localByID.values) {
                merged.add(policy.withSynced(item, false))
            }
        } else {
            val allIds = (localByID.keys + remoteByID.keys + tombByID.keys).toSet()
            val handledIds = mutableSetOf<String>()

            for (id in allIds) {
                if (handledIds.contains(id) || handledIds.contains(id.trim().lowercase())) continue

                val l = localByID[id]
                var r = remoteByID[id]
                if (r == null) {
                    r = remoteBySemanticKey[id] ?: remoteBySemanticKey[id.trim().lowercase()]
                }
                val t = findTombstone(id, r ?: l)

                if (t != null) {
                    val rUpdated = r?.let { policy.updatedAt(it) }
                    if (r != null && rUpdated != null && rUpdated > t) {
                        // Rule 7: newer remote edit supersedes pending deletion
                        merged.add(policy.withSynced(r, true))
                        val resId = policy.id(r).ifEmpty { id }
                        resurrected.add(resId)
                        handledIds.add(id)
                        handledIds.add(resId)
                        val sem = policy.semanticKey(r)
                        if (sem.isNotEmpty()) handledIds.add(sem)
                        for (k in policy.candidateKeys(r)) handledIds.add(k)
                    } else {
                        // Stays deleted. Declare only if server still holds it; otherwise tombstone clears
                        if (r != null) {
                            val delId = policy.id(r).ifEmpty { id }
                            if (!deletedIds.contains(delId)) deletedIds.add(delId)
                            retainedTombstones.add(SyncTombstone(delId, t))
                            handledIds.add(id)
                            handledIds.add(delId)
                            val sem = policy.semanticKey(r)
                            if (sem.isNotEmpty()) handledIds.add(sem)
                            for (k in policy.candidateKeys(r)) handledIds.add(k)
                        }
                    }
                    continue
                }

                if (l != null && r != null) {
                    // Rules 1-3: newer wins, remote wins ties
                    val winner = if (policy.updatedAt(l) > policy.updatedAt(r)) l else r
                    val winnerWithId = policy.withSynced(policy.withId(winner, id), true)
                    merged.add(winnerWithId)
                    handledIds.add(id)
                    val lId = policy.id(l)
                    if (lId.isNotEmpty()) handledIds.add(lId)
                    val rId = policy.id(r)
                    if (rId.isNotEmpty()) handledIds.add(rId)
                    val sem = policy.semanticKey(winner)
                    if (sem.isNotEmpty()) handledIds.add(sem)
                    for (k in policy.candidateKeys(l)) handledIds.add(k)
                    for (k in policy.candidateKeys(r)) handledIds.add(k)
                    continue
                }

                if (l != null) {
                    if (!policy.isSynced(l)) {
                        // Rule 4: never reached server -> push as local create. Never deleted.
                        merged.add(l)
                    } else {
                        // Rule 6: was on server, now gone -> deleted elsewhere.
                        if (policy.updatedAt(l) > lastSyncAt) {
                            review.add(l)
                        }
                    }
                    handledIds.add(id)
                    val lId = policy.id(l)
                    if (lId.isNotEmpty()) handledIds.add(lId)
                    val sem = policy.semanticKey(l)
                    if (sem.isNotEmpty()) handledIds.add(sem)
                    for (k in policy.candidateKeys(l)) handledIds.add(k)
                    continue
                }

                if (r != null) {
                    // Rule 5: remote-only, no tombstone -> create locally.
                    merged.add(policy.withSynced(r, true))
                    handledIds.add(id)
                    val rId = policy.id(r)
                    if (rId.isNotEmpty()) handledIds.add(rId)
                    val sem = policy.semanticKey(r)
                    if (sem.isNotEmpty()) handledIds.add(sem)
                    for (k in policy.candidateKeys(r)) handledIds.add(k)
                }
            }
        }

        // Legacy records with no id yet: assign one and treat as unsynced creates (Rule 4)
        for (item in localWithoutId) {
            val assignedId = java.util.UUID.randomUUID().toString()
            merged.add(policy.withSynced(policy.withId(item, assignedId), false))
        }

        // Second pass: semantic duplicate collapse
        val seen = mutableMapOf<String, T>()
        val syncConflicts = mutableListOf<SyncConflict>()

        for (item in merged) {
            val semKey = policy.semanticKey(item)
            val key = semKey.ifEmpty { policy.id(item) }
            if (key.isEmpty()) {
                seen[policy.id(item)] = item
                continue
            }
            val existing = seen[key]
            if (existing == null) {
                seen[key] = item
                continue
            }

            val itemTs = policy.updatedAt(item)
            val existingTs = policy.updatedAt(existing)
            val itemId = policy.id(item)
            val existingId = policy.id(existing)

            val winner: T
            val loser: T
            if (itemTs > existingTs || (itemTs == existingTs && itemId < existingId)) {
                winner = item
                loser = existing
            } else {
                winner = existing
                loser = item
            }
            seen[key] = winner

            val conflict = policy.detectConflict(winner, loser)
            if (conflict != null) {
                syncConflicts.add(conflict)
            }

            val loserId = policy.id(loser)
            if (policy.isSynced(loser) && loserId.isNotEmpty() &&
                (remoteByID.containsKey(loserId) || remoteBySemanticKey.containsKey(key))
            ) {
                if (!deletedIds.contains(loserId)) deletedIds.add(loserId)
                if (retainedTombstones.none { it.id == loserId }) {
                    retainedTombstones.add(SyncTombstone(loserId, System.currentTimeMillis()))
                }
            }
        }

        return ReconcileEntityResult(
            merged = seen.values.toList(),
            tombstones = retainedTombstones,
            deletedIds = deletedIds,
            review = review,
            resurrected = resurrected,
            syncConflicts = syncConflicts
        )
    }

    /**
     * Sync v3 deletion reconciliation — MUST stay behaviourally identical to
     * reconcileServices() in extension/shared/sync.js. See
     * the sync v3 reconciliation contract §2.
     */
    internal fun reconcileServices(
        local: List<ServiceEntry>,
        localTombstones: List<SyncTombstone>,
        remote: List<ServiceEntry>,
        remoteMeta: List<Pair<String?, Long>> = emptyList(),
        lastSyncAt: Long,
        remoteExists: Boolean
    ): ReconcileResult {
        val result = reconcileCollection(
            localItems = local,
            localTombstones = localTombstones,
            remoteItems = remote,
            remoteMetadata = remoteMeta,
            lastSyncAt = lastSyncAt,
            remoteExists = remoteExists,
            policy = SERVICE_POLICY
        )
        val reviewEntries = result.review.map { DeletionReviewEntry(it, System.currentTimeMillis(), false) }
        return ReconcileResult(
            merged = result.merged,
            tombstones = result.tombstones,
            deletedIds = result.deletedIds,
            review = reviewEntries,
            resurrected = result.resurrected,
            syncConflicts = result.syncConflicts
        )
    }
}
