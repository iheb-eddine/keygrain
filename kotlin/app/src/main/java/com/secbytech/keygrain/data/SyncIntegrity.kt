package com.secbytech.keygrain.data

import java.security.MessageDigest

/**
 * Tamper and corruption checks on remote sync state. Both are pure.
 */
internal object SyncIntegrity {
    fun sha256Hex(data: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(data)
        return digest.joinToString("") { "%02x".format(it) }
    }

    // --- HTTP helpers ---


    fun validateMetadataIntegrity(
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

}
