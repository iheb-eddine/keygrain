package com.secbytech.keygrain.data

/**
 * Functional descriptor defining merge key extraction and LWW comparison for an entity.
 */
internal interface SyncItemPolicy<T> {
    fun mergeKey(item: T): String
    fun isLocalNewer(local: T, remote: T): Boolean
}

/**
 * Generic Last-Write-Wins reconciliation with known-keys set deletion tracking.
 * Pure: no Android dependencies, fully testable on standard JVM.
 */
internal object KnownKeysReconciler {
    fun <T> reconcile(
        local: List<T>,
        remote: List<T>,
        knownKeys: Set<String>,
        policy: SyncItemPolicy<T>
    ): Pair<List<T>, Set<String>> {
        val remoteByKey = remote.associateBy { policy.mergeKey(it) }
        val localByKey = local.associateBy { policy.mergeKey(it) }.toMutableMap()
        val merged = mutableListOf<T>()

        for ((key, remoteItem) in remoteByKey) {
            val localItem = localByKey.remove(key)
            if (localItem != null) {
                merged.add(if (policy.isLocalNewer(localItem, remoteItem)) localItem else remoteItem)
            } else {
                if (knownKeys.contains(key)) {
                    // Deleted locally
                } else {
                    merged.add(remoteItem)
                }
            }
        }

        for ((key, localItem) in localByKey) {
            if (knownKeys.contains(key)) {
                // Deleted remotely
            } else {
                merged.add(localItem)
            }
        }

        val newKeys = merged.map { policy.mergeKey(it) }.toSet()
        return Pair(merged, newKeys)
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
            val localTs = local.updatedAt.ifEmpty { local.createdAt }
            val remoteTs = remote.updatedAt.ifEmpty { remote.createdAt }
            return localTs > remoteTs
        }
    }

    val SSH_POLICY = object : SyncItemPolicy<SshKeyEntry> {
        override fun mergeKey(item: SshKeyEntry): String = SshKeyEntry.mergeKey(item)
        override fun isLocalNewer(local: SshKeyEntry, remote: SshKeyEntry): Boolean =
            local.updatedAt > remote.updatedAt
    }

    fun mergeWallets(
        local: List<WalletEntry>,
        remote: List<WalletEntry>,
        knownWalletKeys: Set<String>
    ): Pair<List<WalletEntry>, Set<String>> =
        KnownKeysReconciler.reconcile(local, remote, knownWalletKeys, WALLET_POLICY)

    fun mergeSshKeys(
        local: List<SshKeyEntry>,
        remote: List<SshKeyEntry>,
        knownSshKeys: Set<String>
    ): Pair<List<SshKeyEntry>, Set<String>> =
        KnownKeysReconciler.reconcile(local, remote, knownSshKeys, SSH_POLICY)

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
