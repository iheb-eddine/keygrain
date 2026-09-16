package com.secbytech.keygrain.data

/**
 * Functional descriptor defining merge key extraction and LWW comparison for an entity.
 */
internal interface SyncItemPolicy<T> {
    fun mergeKey(item: T): String
    fun isLocalNewer(local: T, remote: T): Boolean
    fun id(item: T): String
    fun updatedAt(item: T): Long
    fun candidateKeys(item: T): List<String>
}

internal fun parseTimestampMs(ts: String): Long {
    val s = ts.trim()
    if (s.isEmpty()) return 0L
    s.toLongOrNull()?.let { return it }
    return try {
        java.time.Instant.parse(s).toEpochMilli()
    } catch (_: Exception) {
        0L
    }
}

/**
 * Generic Last-Write-Wins reconciliation with tombstone deletion tracking.
 * Pure: no Android dependencies, fully testable on standard JVM.
 */
internal object KnownKeysReconciler {
    fun <T> reconcile(
        local: List<T>,
        remote: List<T>,
        tombstones: List<Tombstone>,
        policy: SyncItemPolicy<T>,
        lastSyncAt: Long = 0L,
        remoteExists: Boolean = true
    ): Pair<List<T>, List<Tombstone>> {
        val tombMap = mutableMapOf<String, Long>()
        for (t in tombstones) {
            val key = t.id.trim().lowercase()
            val prev = tombMap[key]
            if (prev == null || t.deletedAt > prev) {
                tombMap[key] = t.deletedAt
            }
        }

        fun tombstoneDeletedAt(item: T): Long? {
            var maxDeletedAt: Long? = null
            for (k in policy.candidateKeys(item)) {
                val ts = tombMap[k]
                if (ts != null && (maxDeletedAt == null || ts > maxDeletedAt)) {
                    maxDeletedAt = ts
                }
            }
            return maxDeletedAt
        }

        val localById = local.mapNotNull { item ->
            val id = policy.id(item).ifEmpty { null }
            id?.let { it.lowercase().trim() to item }
        }.toMap()
        val localByKey = local.associateBy { policy.mergeKey(it) }

        val handledLocalKeys = mutableSetOf<String>()
        val handledLocalIds = mutableSetOf<String>()
        val merged = mutableListOf<T>()
        val retainedTombstones = mutableListOf<Tombstone>()
        val handledTombKeys = mutableSetOf<String>()

        for (remoteItem in remote) {
            val rKey = policy.mergeKey(remoteItem)
            val rId = policy.id(remoteItem).ifEmpty { null }?.lowercase()?.trim()

            var localItem: T? = null
            if (rId != null && !handledLocalIds.contains(rId) && localById.containsKey(rId)) {
                localItem = localById[rId]
            } else if (!handledLocalKeys.contains(rKey) && localByKey.containsKey(rKey)) {
                val candidate = localByKey[rKey]
                val candId = candidate?.let { policy.id(it).ifEmpty { null }?.lowercase()?.trim() }
                if (candId == null || rId == null || candId == rId) {
                    if (candId == null || !handledLocalIds.contains(candId)) {
                        localItem = candidate
                    }
                }
            }

            if (localItem != null) {
                merged.add(if (policy.isLocalNewer(localItem, remoteItem)) localItem else remoteItem)
                val lId = policy.id(localItem).ifEmpty { null }?.lowercase()?.trim()
                if (lId != null) handledLocalIds.add(lId)
                handledLocalKeys.add(policy.mergeKey(localItem))
                if (rId != null) handledLocalIds.add(rId)
                handledLocalKeys.add(rKey)
            } else {
                val tombDeletedAt = tombstoneDeletedAt(remoteItem)
                val remoteUpdated = policy.updatedAt(remoteItem)
                if (tombDeletedAt != null && tombDeletedAt > remoteUpdated) {
                    val tombId = policy.id(remoteItem).ifEmpty { rKey }
                    retainedTombstones.add(Tombstone(tombId, tombDeletedAt))
                    for (k in policy.candidateKeys(remoteItem)) handledTombKeys.add(k)
                } else {
                    if (tombDeletedAt != null) {
                        for (k in policy.candidateKeys(remoteItem)) handledTombKeys.add(k)
                    }
                    merged.add(remoteItem)
                }
            }
        }

        for (localItem in local) {
            val lKey = policy.mergeKey(localItem)
            val lId = policy.id(localItem).ifEmpty { null }?.lowercase()?.trim()
            if (handledLocalKeys.contains(lKey) || (lId != null && handledLocalIds.contains(lId))) continue

            val localTs = policy.updatedAt(localItem)
            if (remoteExists && lastSyncAt > 0L && localTs <= lastSyncAt) {
                // Was synced before, no newer local edit, absent remotely -> deleted remotely
                continue
            }
            merged.add(localItem)
            if (lId != null) handledLocalIds.add(lId)
            handledLocalKeys.add(lKey)
        }

        // Second-pass LWW deduplication: collapse duplicates by UUID and by mergeKey
        val dedupedById = mutableMapOf<String, T>()
        for (item in merged) {
            val id = policy.id(item).ifEmpty { null }?.lowercase()?.trim() ?: continue
            val prev = dedupedById[id]
            if (prev == null || policy.isLocalNewer(item, prev)) {
                dedupedById[id] = item
            }
        }

        val deduped = mutableListOf<T>()
        val seenKeys = mutableMapOf<String, T>()
        for (item in merged) {
            val id = policy.id(item).ifEmpty { null }?.lowercase()?.trim()
            if (id != null && dedupedById[id] !== item) continue

            val key = policy.mergeKey(item)
            val prev = seenKeys[key]
            if (prev == null) {
                seenKeys[key] = item
                deduped.add(item)
            } else if (policy.isLocalNewer(item, prev)) {
                val idx = deduped.indexOf(prev)
                if (idx >= 0) deduped[idx] = item
                seenKeys[key] = item
            }
        }

        return Pair(deduped, retainedTombstones)
    }
}

/**
 * Wallet and audit-log merge. Pure; mirrors the wallet halves of
 * extension/shared/sync.js.
 */
internal object SyncMerge {
    val WALLET_POLICY = object : SyncItemPolicy<WalletEntry> {
        override fun mergeKey(item: WalletEntry): String = WalletEntry.mergeKey(item)
        override fun isLocalNewer(local: WalletEntry, remote: WalletEntry): Boolean {
            val localTs = parseTimestampMs(local.updatedAt.ifEmpty { local.createdAt })
            val remoteTs = parseTimestampMs(remote.updatedAt.ifEmpty { remote.createdAt })
            return localTs > remoteTs
        }
        override fun id(item: WalletEntry): String = item.id
        override fun updatedAt(item: WalletEntry): Long {
            val s = item.updatedAt.ifEmpty { item.createdAt }
            return parseTimestampMs(s)
        }
        override fun candidateKeys(item: WalletEntry): List<String> = listOfNotNull(
            item.id.ifEmpty { null }?.lowercase()?.trim(),
            WalletEntry.mergeKey(item).lowercase().trim(),
            item.walletId.ifEmpty { null }?.lowercase()?.trim(),
            item.walletName.ifEmpty { null }?.lowercase()?.trim()
        )
    }

    val SSH_POLICY = object : SyncItemPolicy<SshKeyEntry> {
        override fun mergeKey(item: SshKeyEntry): String = SshKeyEntry.mergeKey(item)
        override fun isLocalNewer(local: SshKeyEntry, remote: SshKeyEntry): Boolean =
            local.updatedAt > remote.updatedAt
        override fun id(item: SshKeyEntry): String = item.id
        override fun updatedAt(item: SshKeyEntry): Long = item.updatedAt
        override fun candidateKeys(item: SshKeyEntry): List<String> = listOfNotNull(
            item.id.ifEmpty { null }?.lowercase()?.trim(),
            item.keyName.ifEmpty { null }?.lowercase()?.trim(),
            SshKeyEntry.mergeKey(item).lowercase().trim()
        )
    }

    fun mergeWallets(
        local: List<WalletEntry>,
        remote: List<WalletEntry>,
        tombstones: List<Tombstone> = emptyList(),
        lastSyncAt: Long = 0L,
        remoteExists: Boolean = true
    ): Pair<List<WalletEntry>, List<Tombstone>> =
        KnownKeysReconciler.reconcile(local, remote, tombstones, WALLET_POLICY, lastSyncAt, remoteExists)

    fun mergeSshKeys(
        local: List<SshKeyEntry>,
        remote: List<SshKeyEntry>,
        tombstones: List<Tombstone> = emptyList(),
        lastSyncAt: Long = 0L,
        remoteExists: Boolean = true
    ): Pair<List<SshKeyEntry>, List<Tombstone>> =
        KnownKeysReconciler.reconcile(local, remote, tombstones, SSH_POLICY, lastSyncAt, remoteExists)

    fun mergeAuditLog(
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
}
