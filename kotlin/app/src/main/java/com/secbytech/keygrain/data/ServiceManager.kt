package com.secbytech.keygrain.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class ServiceManager(context: Context) {
    companion object {
        fun normalizeSite(site: String): String {
            var s = site.replace(Regex("^https?://", RegexOption.IGNORE_CASE), "")
            s = s.split("/")[0].split("?")[0].split("#")[0]
                .trimEnd('/').lowercase()
            return s.removePrefix("www.")
        }

        /**
         * Parses services out of a sync blob (`{"services":[...]}`) or a bare exported array.
         * Pure: no Context, no instance state — see the note on [ServiceManager.parseJson].
         *
         * Every field this drops is a field the next push ERASES for every device, because the
         * merge builds its records from here and [ServiceEntry.toJsonContent] writes them straight
         * back. `migrating` was dropped until this comment existed, which silently marked a
         * half-finished browser migration as complete and took the extension's old-password
         * warnings with it.
         */
        fun parseServicesJson(json: String): List<ServiceEntry> {
            val trimmed = json.trim()
            val arr = if (trimmed.startsWith("[")) {
                JSONArray(trimmed)
            } else {
                val obj = JSONObject(trimmed)
                obj.getJSONArray("services")
            }
            return (0 until arr.length()).mapNotNull { i ->
                try {
                    val obj = arr.getJSONObject(i)
                    val name = obj.optString("name", "").ifEmpty { return@mapNotNull null }
                    val email = obj.optString("email", "").ifEmpty { return@mapNotNull null }
                    val site = normalizeSite(obj.optString("site", name))
                    if (site.isEmpty()) return@mapNotNull null
                    ServiceEntry(
                        name = name,
                        site = site,
                        email = email,
                        length = obj.optInt("length", 20),
                        symbols = obj.optString("symbols", Keygrain.DEFAULT_SYMBOLS),
                        counter = obj.optInt("counter", 1),
                        id = if (obj.has("id") && !obj.isNull("id")) obj.getString("id") else null,
                        updatedAt = obj.optLong("updated_at", System.currentTimeMillis()),
                        totp = if (obj.has("totp") && !obj.isNull("totp")) obj.getJSONObject("totp") else null,
                        ssh = if (obj.has("ssh") && !obj.isNull("ssh")) obj.getJSONObject("ssh") else null,
                        frecency = obj.optDouble("frecency", 0.0),
                        migrating = obj.optBoolean("migrating", false)
                    )
                } catch (_: Exception) {
                    null
                }
            }
        }

        /**
         * Build the stored record for an edit. Pure, so the Frozen Req 1 invariant is
         * unit-testable without a Context.
         *
         * `synced` is taken from [existing], NEVER from [newEntry]: it is a property of
         * IDENTITY, not content. The UI builds newEntry without a synced value (it
         * defaults to false), so copying it through would silently clear the flag. A
         * cleared flag makes a later remote deletion of this id look like an unsynced
         * local create (rule 4), which RESURRECTS a service the user deleted on another
         * device.
         */
        fun applyEdit(
            existing: ServiceEntry,
            newEntry: ServiceEntry,
            normalizedSite: String,
            updatedAt: Long
        ): ServiceEntry = newEntry.copy(
            site = normalizedSite,
            id = existing.id,
            updatedAt = updatedAt,
            synced = existing.synced
        )
    }

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "keygrain_services",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun getServices(): List<ServiceEntry> {
        val json = prefs.getString("services", "[]") ?: "[]"
        val arr = JSONArray(json)
        return (0 until arr.length()).mapNotNull { i ->
            try {
                val obj = arr.getJSONObject(i)
                ServiceEntry(
                    name = obj.getString("name"),
                    site = obj.optString("site", obj.getString("name")),
                    email = obj.getString("email"),
                    length = obj.optInt("length", 20),
                    symbols = obj.optString("symbols", Keygrain.DEFAULT_SYMBOLS),
                    counter = obj.optInt("counter", 1),
                    id = if (obj.has("id") && !obj.isNull("id")) obj.getString("id") else null,
                    updatedAt = obj.optLong("updated_at", System.currentTimeMillis()),
                    totp = if (obj.has("totp") && !obj.isNull("totp")) obj.getJSONObject("totp") else null,
                    ssh = if (obj.has("ssh") && !obj.isNull("ssh")) obj.getJSONObject("ssh") else null,
                    frecency = obj.optDouble("frecency", 0.0),
                    // Absent (v1 store) => false. Defaulting to false is the safe
                    // direction: a false `false` only causes a harmless idempotent
                    // re-push under the same UUID, whereas a false `true` risks deletion.
                    synced = obj.optBoolean("synced", false),
                    migrating = obj.optBoolean("migrating", false)
                )
            } catch (_: Exception) {
                null
            }
        }
    }

    private fun nextTimestamp(services: List<ServiceEntry>): Long {
        val max = services.maxOfOrNull { it.updatedAt } ?: 0L
        return maxOf(System.currentTimeMillis(), max + 1)
    }

    fun addService(entry: ServiceEntry): Boolean {
        val services = getServices().toMutableList()
        val normalizedSite = normalizeSite(entry.site)
        if (normalizedSite.isEmpty()) return false
        val emailLower = entry.email.lowercase()
        val duplicate = services.any { normalizeSite(it.site) == normalizedSite && it.email.lowercase() == emailLower }
        if (duplicate) return false
        services.add(entry.copy(site = normalizedSite, id = UUID.randomUUID().toString(), updatedAt = nextTimestamp(services)))
        save(services)
        return true
    }

    fun deleteService(id: String) {
        val remaining = getServices().filter { it.id != id }
        // Frozen Req 4: the tombstone is written in the SAME commit as the removal, and
        // regardless of `synced`. A single SharedPreferences editor makes the two writes
        // atomic, so the removal and its tombstone can never be observed apart. Writing it
        // unconditionally closes the lost-response window: if a push reached the server
        // but its response was lost, `synced` is still false locally while the server DOES
        // hold the record, and without a tombstone the deletion would be lost and the
        // service would resurrect.
        //
        // deleted_at is nextTimestamp(remaining) — computed over the REMAINING services,
        // NOT including the record being deleted — to stay byte-identical to the extension
        // (popup.js computes it after splicing the record out). Divergence here would make
        // rule 7 resolve differently per platform.
        val deletedAt = nextTimestamp(remaining)
        val tombs = getTombstones().filter { it.id != id } + Tombstone(id, deletedAt)
        prefs.edit()
            .putString("services", servicesJson(remaining))
            .putString("tombstones", tombstonesJson(tombs))
            .apply()
    }

    // === Sync v3 tombstones (local-only, never sent to the server) ===

    fun getTombstones(): List<Tombstone> {
        val json = prefs.getString("tombstones", "[]") ?: "[]"
        val arr = JSONArray(json)
        return (0 until arr.length()).mapNotNull { i ->
            try {
                val obj = arr.getJSONObject(i)
                Tombstone(obj.getString("id"), obj.getLong("deleted_at"))
            } catch (_: Exception) {
                null
            }
        }
    }

    private fun tombstonesJson(tombstones: List<Tombstone>): String {
        val arr = JSONArray()
        tombstones.forEach { t ->
            arr.put(JSONObject().apply {
                put("id", t.id)
                put("deleted_at", t.deletedAt)
            })
        }
        return arr.toString()
    }

    fun setTombstones(tombstones: List<Tombstone>) {
        prefs.edit().putString("tombstones", tombstonesJson(tombstones)).apply()
    }

    // === Sync v3 deletion review (local-only; conflict cases only) ===

    fun getDeletionReview(): List<DeletionReviewEntry> {
        val json = prefs.getString("deletion_review", "[]") ?: "[]"
        val arr = JSONArray(json)
        return (0 until arr.length()).mapNotNull { i ->
            try {
                val obj = arr.getJSONObject(i)
                val svc = parseJson(JSONArray().put(obj.getJSONObject("service")).toString()).firstOrNull()
                    ?: return@mapNotNull null
                DeletionReviewEntry(
                    service = svc,
                    deletedAt = obj.getLong("deleted_at"),
                    seen = obj.optBoolean("seen", false)
                )
            } catch (_: Exception) {
                null
            }
        }
    }

    fun setDeletionReview(entries: List<DeletionReviewEntry>) {
        val arr = JSONArray()
        entries.takeLast(50).forEach { e ->
            arr.put(JSONObject().apply {
                put("service", JSONObject().apply {
                    put("name", e.service.name)
                    put("site", e.service.site)
                    put("email", e.service.email)
                    put("length", e.service.length)
                    put("symbols", e.service.symbols)
                    put("counter", e.service.counter)
                    put("id", e.service.id ?: JSONObject.NULL)
                    put("updated_at", e.service.updatedAt)
                    if (e.service.totp != null) put("totp", e.service.totp)
                    if (e.service.ssh != null) put("ssh", e.service.ssh)
                })
                put("deleted_at", e.deletedAt)
                put("seen", e.seen)
            })
        }
        prefs.edit().putString("deletion_review", arr.toString()).apply()
    }

    /**
     * Restore a service that was deleted on another device while this device held an
     * unsynced change (Frozen Req 10). Re-inserts under the ORIGINAL id with a bumped
     * updatedAt and synced=false, so a failed push re-pushes rather than risking
     * deletion.
     */
    fun restoreFromReview(entry: DeletionReviewEntry) {
        val services = getServices().toMutableList()
        services.add(entry.service.copy(updatedAt = nextTimestamp(services), synced = false))
        save(services)
        setDeletionReview(getDeletionReview().filter { it.service.id != entry.service.id })
    }

    fun updateService(id: String, newEntry: ServiceEntry): Boolean {
        val services = getServices().toMutableList()
        val normalizedSite = normalizeSite(newEntry.site)
        if (normalizedSite.isEmpty()) return false
        val emailLower = newEntry.email.lowercase()
        val duplicate = services.any { it.id != id && normalizeSite(it.site) == normalizedSite && it.email.lowercase() == emailLower }
        if (duplicate) return false
        val updated = services.map {
            if (it.id == id) applyEdit(it, newEntry, normalizedSite, nextTimestamp(services))
            else it
        }
        save(updated)
        return true
    }

    fun replaceAll(services: List<ServiceEntry>) {
        save(services.map { it.copy(site = normalizeSite(it.site)) })
    }

    /** Wipe all locally stored services (used by Switch account / local delete). */
    fun clearAll() {
        prefs.edit().clear().apply()
    }

    fun updateFrecency(name: String) {
        val services = getServices().map {
            if (it.name == name) it.copy(frecency = it.frecency * 0.95 + 1)
            else it
        }
        save(services)
    }

    fun exportJson(): String {
        val arr = JSONArray()
        getServices().forEach { s ->
            arr.put(JSONObject().apply {
                put("name", s.name)
                put("site", s.site)
                put("email", s.email)
                put("length", s.length)
                put("symbols", s.symbols)
                put("counter", s.counter)
                put("id", s.id ?: JSONObject.NULL)
                put("updated_at", s.updatedAt)
                if (s.totp != null) put("totp", s.totp)
                if (s.ssh != null) put("ssh", s.ssh)
                if (s.frecency != 0.0) put("frecency", s.frecency)
                // Content, so it belongs in a backup — unlike `synced` above, which is this
                // device's own sync state. Restoring a backup must not lose the fact that a
                // site still holds its old password.
                if (s.migrating) put("migrating", true)
            })
        }
        return JSONObject().apply {
            put("version", 2)
            put("services", arr)
        }.toString()
    }

    /**
     * Parses services out of a sync blob or an exported file. Delegates to the companion so the
     * parse can be exercised by a plain JVM unit test: this class needs a Context for its
     * EncryptedSharedPreferences, and the field this parse must not drop (`migrating`) is exactly
     * the kind of omission that is invisible without a test.
     */
    fun parseJson(json: String): List<ServiceEntry> = parseServicesJson(json)

    private fun servicesJson(services: List<ServiceEntry>): String {
        val arr = JSONArray()
        services.forEach { s ->
            arr.put(JSONObject().apply {
                put("name", s.name)
                put("site", s.site)
                put("email", s.email)
                put("length", s.length)
                put("symbols", s.symbols)
                put("counter", s.counter)
                put("id", s.id ?: JSONObject.NULL)
                put("updated_at", s.updatedAt)
                // Local-only sync state. Deliberately NOT in exportJson(): an exported
                // file imported on another device must start as unsynced.
                put("synced", s.synced)
                if (s.totp != null) put("totp", s.totp)
                if (s.ssh != null) put("ssh", s.ssh)
                if (s.frecency != 0.0) put("frecency", s.frecency)
                // Content, not sync state: it must survive a local save or the next push
                // erases it for every device just as dropping it from toJsonContent did.
                if (s.migrating) put("migrating", true)
            })
        }
        return arr.toString()
    }

    private fun save(services: List<ServiceEntry>) {
        prefs.edit().putString("services", servicesJson(services)).apply()
    }
}
