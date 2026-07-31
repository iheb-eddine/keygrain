package com.secbytech.keygrain.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * Sync blob serialisation. [canonicalBlobPayload] MUST stay byte-identical to
 * canonicalBlobPayload() in extension/shared/sync.js -- it is the cross-platform
 * comparison that decides whether a PUT can be skipped, so ordering and key order are
 * fixed, and local-only fields (synced, frecency) are excluded.
 */
internal object SyncBlob {
    /**
     * Canonical serialization of a sync blob payload, used ONLY to decide whether a PUT
     * can be skipped (Frozen Req 9). MUST stay byte-identical to canonicalBlobPayload()
     * in extension/shared/sync.js, so ordering and key order are fixed here. Local-only
     * fields (synced, frecency) are excluded because they never affect remote state.
     */
    internal fun canonicalBlobPayload(
        services: List<ServiceEntry>,
        wallets: List<WalletEntry>,
        auditLog: List<WalletAuditEntry>,
        syncConflicts: List<SyncConflict>
    ): String {
        val sb = StringBuilder()
        sb.append("{\"services\":[")
        services.sortedBy { it.id ?: "" }.forEachIndexed { i, s ->
            if (i > 0) sb.append(",")
            sb.append("{\"id\":").append(jsonStr(s.id))
                .append(",\"updated_at\":").append(s.updatedAt)
                .append(",\"name\":").append(jsonStr(s.name))
                .append(",\"site\":").append(jsonStr(s.site))
                .append(",\"email\":").append(jsonStr(s.email))
                .append(",\"length\":").append(s.length)
                .append(",\"symbols\":").append(jsonStr(s.symbols))
                .append(",\"counter\":").append(s.counter)
                .append(",\"totp\":").append(s.totp?.toString() ?: "null")
                .append(",\"ssh\":").append(s.ssh?.toString() ?: "null")
                .append("}")
        }
        sb.append("],\"wallets\":[")
        wallets.sortedBy { it.walletName.lowercase() + ":" + it.chain.lowercase() }
            .forEachIndexed { i, w ->
                if (i > 0) sb.append(",")
                sb.append(w.toJson().toString())
            }
        sb.append("],\"wallet_audit_log\":[")
        auditLog.sortedBy { "${it.timestamp}\u0000${it.walletName}\u0000${it.chain}\u0000${it.action}" }
            .forEachIndexed { i, e ->
                if (i > 0) sb.append(",")
                sb.append(e.toJson().toString())
            }
        sb.append("],\"sync_conflicts\":[")
        syncConflicts.sortedBy { it.dedupeKey() }.forEachIndexed { i, c ->
            if (i > 0) sb.append(",")
            sb.append(c.toJson().toString())
        }
        sb.append("]}")
        return sb.toString()
    }

    private fun jsonStr(s: String?): String =
        if (s == null) "null" else JSONObject.quote(s)


    data class BlobContent(
        val services: List<ServiceEntry>,
        val wallets: List<WalletEntry>,
        val auditLog: List<WalletAuditEntry>,
        val syncConflicts: List<SyncConflict>
    )

    fun parseBlobContent(json: String, serviceManager: ServiceManager): BlobContent {
        val trimmed = json.trim()
        if (trimmed.startsWith("[")) {
            return BlobContent(serviceManager.parseJson(trimmed), emptyList(), emptyList(), emptyList())
        }
        val obj = JSONObject(trimmed)
        val servicesArr = obj.optJSONArray("services") ?: JSONArray()
        val services = serviceManager.parseJson(servicesArr.toString())
        val walletsArr = obj.optJSONArray("wallets") ?: JSONArray()
        val auditArr = obj.optJSONArray("wallet_audit_log") ?: JSONArray()
        val conflictsArr = obj.optJSONArray("sync_conflicts") ?: JSONArray()
        val wallets = (0 until walletsArr.length()).mapNotNull { i ->
            try { WalletEntry.fromJson(walletsArr.getJSONObject(i)) } catch (_: Exception) { null }
        }
        val auditLog = (0 until auditArr.length()).mapNotNull { i ->
            try { WalletAuditEntry.fromJson(auditArr.getJSONObject(i)) } catch (_: Exception) { null }
        }
        val conflicts = (0 until conflictsArr.length()).mapNotNull { i ->
            try { SyncConflict.fromJson(conflictsArr.getJSONObject(i)) } catch (_: Exception) { null }
        }
        return BlobContent(services, wallets, auditLog, conflicts)
    }

}
