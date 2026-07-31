package com.secbytech.keygrain.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Every read and write of locally cached sync state. Split out of [SyncManager] so the
 * SharedPreferences key names live in exactly one place -- a renamed key here reads as
 * "this user has no data", so they are load-bearing.
 */
internal object SyncStore {
    private val KEY_LAST_SUCCESSFUL_SYNC_AT = "last_successful_sync_at"

    private fun getPrefs(context: Context) =
        context.getSharedPreferences("keygrain_sync", Context.MODE_PRIVATE)


    fun getSyncEmail(context: Context): String? =
        getPrefs(context).getString("sync_email", null)

    fun setSyncEmail(context: Context, email: String) {
        getPrefs(context).edit().putString("sync_email", email).apply()
    }


    /**
     * Wipe all locally cached sync state: sync email, known UUIDs, wallet keys,
     * metadata cache, wallets, audit log, and conflict flags. Used by Switch
     * account and the local-delete path. Does NOT touch the server.
     */
    fun clearLocalData(context: Context) {
        getPrefs(context).edit().clear().apply()
    }


    /**
     * One-time migration from the v1 knownUUIDs model to v2 (synced + tombstones).
     * Design §8. Runs before the first v3 sync so a deletion that had not yet propagated
     * is preserved as a tombstone rather than lost (which would resurrect the service).
     *
     * `synced` is taken ONLY from knownUUIDs; anything unknown defaults to false. Never
     * default to true: a false `false` causes a harmless idempotent re-push under the
     * same UUID, whereas a false `true` risks deletion.
     */
    fun migrateFromKnownUUIDs(context: Context, serviceManager: ServiceManager) {
        val prefs = getPrefs(context)
        if (!prefs.contains("known_uuids")) return
        val known = prefs.getStringSet("known_uuids", emptySet()) ?: emptySet()
        val services = serviceManager.getServices()
        serviceManager.replaceAll(services.map { it.copy(synced = it.id != null && known.contains(it.id)) })
        val liveIds = services.mapNotNull { it.id }.toSet()
        val now = System.currentTimeMillis()
        val synthesized = known.filter { !liveIds.contains(it) }.map { Tombstone(it, now) }
        if (synthesized.isNotEmpty()) {
            serviceManager.setTombstones(serviceManager.getTombstones() + synthesized)
        }
        // Seed the barrier from the legacy last-sync timestamp when available.
        if (!prefs.contains(KEY_LAST_SUCCESSFUL_SYNC_AT)) {
            prefs.edit().putLong(KEY_LAST_SUCCESSFUL_SYNC_AT, prefs.getLong("last_sync_time", 0L)).apply()
        }
        prefs.edit().remove("known_uuids").apply()
    }


    /**
     * The causal barrier used to tell a routine remote deletion (apply silently) from one
     * that would destroy an unsynced local change (retain for review). Advanced ONLY on a
     * fully confirmed sync — Frozen Req 8.
     */
    fun getLastSuccessfulSyncAt(context: Context): Long =
        getPrefs(context).getLong(KEY_LAST_SUCCESSFUL_SYNC_AT, 0L)

    fun setLastSuccessfulSyncAt(context: Context, ts: Long) {
        getPrefs(context).edit().putLong(KEY_LAST_SUCCESSFUL_SYNC_AT, ts).apply()
    }


    fun getMetadataCache(context: Context): List<Pair<String?, Long>>? {
        val json = getPrefs(context).getString("sync_metadata_cache", null) ?: return null
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                val id = if (obj.isNull("id")) null else obj.getString("id")
                Pair(id, obj.getLong("updated_at"))
            }
        } catch (_: Exception) { null }
    }

    fun setMetadataCache(context: Context, metadata: List<Pair<String?, Long>>) {
        val arr = JSONArray()
        for ((id, updatedAt) in metadata) {
            arr.put(JSONObject().apply {
                put("id", id ?: JSONObject.NULL)
                put("updated_at", updatedAt)
            })
        }
        getPrefs(context).edit().putString("sync_metadata_cache", arr.toString()).apply()
    }


    fun getKnownWalletKeys(context: Context): Set<String> =
        getPrefs(context).getStringSet("known_wallet_keys", emptySet()) ?: emptySet()

    fun setKnownWalletKeys(context: Context, keys: Set<String>) {
        getPrefs(context).edit().putStringSet("known_wallet_keys", keys).apply()
    }


    fun getWallets(context: Context): List<WalletEntry> {
        val json = getPrefs(context).getString("wallets", "[]") ?: "[]"
        val arr = JSONArray(json)
        return (0 until arr.length()).mapNotNull { i ->
            try { WalletEntry.fromJson(arr.getJSONObject(i)) } catch (_: Exception) { null }
        }
    }

    fun saveWallets(context: Context, wallets: List<WalletEntry>) {
        val arr = JSONArray().apply { wallets.forEach { put(it.toJson()) } }
        getPrefs(context).edit().putString("wallets", arr.toString()).apply()
    }

    fun getAuditLog(context: Context): List<WalletAuditEntry> {
        val json = getPrefs(context).getString("wallet_audit_log", "[]") ?: "[]"
        val arr = JSONArray(json)
        return (0 until arr.length()).mapNotNull { i ->
            try { WalletAuditEntry.fromJson(arr.getJSONObject(i)) } catch (_: Exception) { null }
        }
    }

    fun saveAuditLog(context: Context, log: List<WalletAuditEntry>) {
        val arr = JSONArray().apply { log.forEach { put(it.toJson()) } }
        getPrefs(context).edit().putString("wallet_audit_log", arr.toString()).apply()
    }


    // Named accessors for the two boolean flags sync() used to poke at through a raw
    // getPrefs() handle. Same preference file, same key strings, same defaults.

    fun isAadEnabled(context: Context): Boolean =
        getPrefs(context).getBoolean("aad_enabled", false)

    fun setAadEnabled(context: Context, enabled: Boolean) {
        getPrefs(context).edit().putBoolean("aad_enabled", enabled).apply()
    }

    fun areConflictsDismissed(context: Context): Boolean =
        getPrefs(context).getBoolean("conflicts_dismissed", false)

    fun setConflictsDismissed(context: Context, dismissed: Boolean) {
        getPrefs(context).edit().putBoolean("conflicts_dismissed", dismissed).apply()
    }
}
