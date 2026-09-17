package com.secbytech.keygrain.data

internal fun parseTimestampMs(ts: String): Long {
    val s = ts.trim()
    if (s.isEmpty()) return 0L
    val num = s.toLongOrNull()
    if (num != null) {
        if (num > 100_000_000_000L) return num
        if (num > 1_000_000_000L) return num * 1000L
        return num
    }
    return try {
        java.time.Instant.parse(s).toEpochMilli()
    } catch (_: Exception) {
        0L
    }
}

/**
 * Wallet and SSH key merge using the Unified Entity Reconciliation Identity Principle.
 * Pure: no Android dependencies, fully testable on standard JVM.
 */
internal object SyncMerge {
    val WALLET_POLICY = object : SyncReconciler.EntitySyncPolicy<WalletEntry> {
        override fun id(item: WalletEntry): String = item.id
        override fun updatedAt(item: WalletEntry): Long {
            val s = item.updatedAt.ifEmpty { item.createdAt }
            return parseTimestampMs(s)
        }
        override fun isSynced(item: WalletEntry): Boolean = item.synced
        override fun withSynced(item: WalletEntry, synced: Boolean): WalletEntry = item.copy(synced = synced)
        override fun withId(item: WalletEntry, id: String): WalletEntry = item.copy(id = id)
        override fun semanticKey(item: WalletEntry): String {
            val wid = if (item.walletId.isNotEmpty()) item.walletId else if (item.walletName.isNotEmpty()) item.walletName else item.id
            return wid.trim().lowercase()
        }
        override fun candidateKeys(item: WalletEntry): List<String> = listOfNotNull(
            item.id.ifEmpty { null }?.trim()?.lowercase(),
            item.id.ifEmpty { null },
            item.walletId.ifEmpty { null }?.trim()?.lowercase(),
            item.walletId.ifEmpty { null },
            item.walletName.ifEmpty { null }?.trim()?.lowercase(),
            item.walletName.ifEmpty { null },
            WalletEntry.mergeKey(item).trim().lowercase()
        ).distinct()
    }

    val SSH_POLICY = object : SyncReconciler.EntitySyncPolicy<SshKeyEntry> {
        override fun id(item: SshKeyEntry): String = item.id
        override fun updatedAt(item: SshKeyEntry): Long = item.updatedAt
        override fun isSynced(item: SshKeyEntry): Boolean = item.synced
        override fun withSynced(item: SshKeyEntry, synced: Boolean): SshKeyEntry = item.copy(synced = synced)
        override fun withId(item: SshKeyEntry, id: String): SshKeyEntry = item.copy(id = id)
        override fun semanticKey(item: SshKeyEntry): String {
            val primary = if (item.keyName.isNotEmpty()) item.keyName else item.id
            return primary.trim().lowercase()
        }
        override fun candidateKeys(item: SshKeyEntry): List<String> = listOfNotNull(
            item.id.ifEmpty { null }?.trim()?.lowercase(),
            item.id.ifEmpty { null },
            item.keyName.ifEmpty { null }?.trim()?.lowercase(),
            item.keyName.ifEmpty { null },
            SshKeyEntry.mergeKey(item).trim().lowercase()
        ).distinct()
    }

    fun mergeWallets(
        local: List<WalletEntry>,
        remote: List<WalletEntry>,
        tombstones: List<SyncTombstone> = emptyList(),
        lastSyncAt: Long = 0L,
        remoteExists: Boolean = true
    ): SyncReconciler.ReconcileEntityResult<WalletEntry> =
        SyncReconciler.reconcileCollection(
            localItems = local,
            localTombstones = tombstones,
            remoteItems = remote,
            lastSyncAt = lastSyncAt,
            remoteExists = remoteExists,
            policy = WALLET_POLICY
        )

    fun mergeSshKeys(
        local: List<SshKeyEntry>,
        remote: List<SshKeyEntry>,
        tombstones: List<SyncTombstone> = emptyList(),
        lastSyncAt: Long = 0L,
        remoteExists: Boolean = true
    ): SyncReconciler.ReconcileEntityResult<SshKeyEntry> =
        SyncReconciler.reconcileCollection(
            localItems = local,
            localTombstones = tombstones,
            remoteItems = remote,
            lastSyncAt = lastSyncAt,
            remoteExists = remoteExists,
            policy = SSH_POLICY
        )
}
