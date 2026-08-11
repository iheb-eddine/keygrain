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
        val orderedServices = services.sortedBy { it.id ?: "" }
        val orderedWallets = wallets.sortedBy { it.walletName.lowercase() + ":" + it.chain.lowercase() }
        val orderedAudit = auditLog.sortedBy { "${it.timestamp}\u0000${it.walletName}\u0000${it.chain}\u0000${it.action}" }
        val orderedConflicts = syncConflicts.sortedBy { it.dedupeKey() }

        // Top-level and service field order are an existing comparison contract. All nested
        // and variable objects use canonicalJson, which sorts their object keys recursively.
        return buildString {
            append("{\"services\":[")
            orderedServices.forEachIndexed { i, service ->
                if (i > 0) append(",")
                append(canonicalService(service))
            }
            append("],\"wallets\":")
                .append(canonicalJson(orderedWallets.map { it.toJson() }))
            append(",\"wallet_audit_log\":")
                .append(canonicalJson(orderedAudit.map { it.toJson() }))
            append(",\"sync_conflicts\":")
                .append(canonicalJson(orderedConflicts.map { it.toJson() }))
            append("}")
        }
    }

    private fun canonicalService(service: ServiceEntry): String = buildString {
        append("{\"id\":").append(canonicalJson(service.id))
        append(",\"updated_at\":").append(canonicalJson(service.updatedAt))
        append(",\"name\":").append(canonicalJson(service.name))
        append(",\"site\":").append(canonicalJson(service.site))
        append(",\"email\":").append(canonicalJson(service.email))
        append(",\"length\":").append(canonicalJson(service.length))
        append(",\"symbols\":").append(canonicalJson(service.symbols))
        append(",\"counter\":").append(canonicalJson(service.counter))
        append(",\"migrating\":").append(canonicalJson(if (service.migrating) true else null))
        append(",\"totp\":").append(canonicalJson(service.totp))
        append(",\"ssh\":").append(canonicalJson(service.ssh))
        append("}")
    }

    private fun canonicalJson(value: Any?): String = when {
        value == null || value === JSONObject.NULL -> "null"
        value is String -> canonicalString(value)
        value is Boolean -> if (value) "true" else "false"
        value is Number -> canonicalNumber(value)
        value is List<*> -> buildString {
            append("[")
            value.forEachIndexed { i, item ->
                if (i > 0) append(",")
                append(canonicalJson(item))
            }
            append("]")
        }
        value is JSONArray -> buildString {
            append("[")
            for (i in 0 until value.length()) {
                if (i > 0) append(",")
                append(canonicalJson(value.opt(i)))
            }
            append("]")
        }
        value is JSONObject -> {
            val keys = mutableListOf<String>()
            val iterator = value.keys()
            while (iterator.hasNext()) keys += iterator.next()
            keys.sort()
            buildString {
                append("{")
                keys.forEachIndexed { i, key ->
                    if (i > 0) append(",")
                    append(canonicalString(key)).append(":").append(canonicalJson(value.opt(key)))
                }
                append("}")
            }
        }
        else -> throw IllegalArgumentException("unsupported canonical sync JSON value")
    }

    private fun canonicalNumber(number: Number): String {
        val value = when (number) {
            is Byte, is Short, is Int, is Long -> number.toLong()
            is Float -> {
                require(number.isFinite() && number % 1f == 0f) {
                    "canonical sync JSON requires finite integral numbers"
                }
                number.toLong()
            }
            is Double -> {
                require(number.isFinite() && number % 1.0 == 0.0) {
                    "canonical sync JSON requires finite integral numbers"
                }
                number.toLong()
            }
            else -> throw IllegalArgumentException("unsupported canonical sync number")
        }
        require(value in -MAX_SAFE_INTEGER..MAX_SAFE_INTEGER) {
            "canonical sync JSON requires safe integers"
        }
        return value.toString()
    }

    private fun canonicalString(value: String): String = buildString {
        append('"')
        var i = 0
        while (i < value.length) {
            val code = value[i].code
            when (code) {
                0x08 -> append("\\b")
                0x09 -> append("\\t")
                0x0a -> append("\\n")
                0x0c -> append("\\f")
                0x0d -> append("\\r")
                0x22 -> append("\\\"")
                0x5c -> append("\\\\")
                else -> when {
                    code <= 0x1f -> append("\\u00").append(code.toString(16).padStart(2, '0'))
                    code in 0xd800..0xdbff -> {
                        val next = if (i + 1 < value.length) value[i + 1].code else -1
                        if (next in 0xdc00..0xdfff) {
                            append(value[i])
                            append(value[++i])
                        } else {
                            append("\\u").append(code.toString(16).padStart(4, '0'))
                        }
                    }
                    code in 0xdc00..0xdfff ->
                        append("\\u").append(code.toString(16).padStart(4, '0'))
                    else -> append(value[i])
                }
            }
            i++
        }
        append('"')
    }

    private const val MAX_SAFE_INTEGER = 9007199254740991L


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
