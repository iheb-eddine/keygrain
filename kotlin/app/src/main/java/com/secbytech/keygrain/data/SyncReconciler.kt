package com.secbytech.keygrain.data

/**
 * Sync v3 deletion reconciliation. Pure: no Context, no android.util.Base64, no network,
 * which is what lets SyncReconcileTest drive it from the same
 * sync-reconcile-vectors.json the JS suite uses.
 */
internal object SyncReconciler {
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
     * the sync v3 reconciliation contract §2.
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

}
