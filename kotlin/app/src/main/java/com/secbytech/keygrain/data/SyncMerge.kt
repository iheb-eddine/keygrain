package com.secbytech.keygrain.data

/**
 * Wallet and audit-log merge. Pure; mirrors the wallet halves of
 * extension/shared/sync.js.
 */
internal object SyncMerge {
    fun mergeWallets(
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
