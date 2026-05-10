package com.badrani.keygrain.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class ServiceEntry(
    val name: String,
    val site: String,
    val email: String,
    val length: Int = 20,
    val symbols: String = Keygrain.DEFAULT_SYMBOLS,
    val counter: Int = 1,
    val id: String? = null,
    val updatedAt: Long = System.currentTimeMillis(),
    val totp: JSONObject? = null,
    val ssh: JSONObject? = null,
    val frecency: Double = 0.0
) {
    /** Serialize all content fields (everything except sync metadata id/updated_at). */
    fun toJsonContent(): JSONObject = JSONObject().apply {
        put("name", name)
        put("site", site)
        put("email", email)
        put("length", length)
        put("symbols", symbols)
        put("counter", counter)
        if (totp != null) put("totp", totp)
        if (ssh != null) put("ssh", ssh)
        if (frecency != 0.0) put("frecency", frecency)
    }
}

class ServiceManager(context: Context) {
    companion object {
        fun normalizeSite(site: String): String {
            var s = site.replace(Regex("^https?://", RegexOption.IGNORE_CASE), "")
            s = s.split("/")[0].split("?")[0].split("#")[0]
                .trimEnd('/').lowercase()
            return s.removePrefix("www.")
        }
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
                    frecency = obj.optDouble("frecency", 0.0)
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
        val emailLower = entry.email.lowercase()
        val duplicate = services.any { normalizeSite(it.site) == normalizedSite && it.email.lowercase() == emailLower }
        if (duplicate) return false
        services.add(entry.copy(site = normalizedSite, id = UUID.randomUUID().toString(), updatedAt = nextTimestamp(services)))
        save(services)
        return true
    }

    fun deleteService(id: String) {
        val services = getServices().filter { it.id != id }
        save(services)
    }

    fun updateService(id: String, newEntry: ServiceEntry): Boolean {
        val services = getServices().toMutableList()
        val normalizedSite = normalizeSite(newEntry.site)
        val emailLower = newEntry.email.lowercase()
        val duplicate = services.any { it.id != id && normalizeSite(it.site) == normalizedSite && it.email.lowercase() == emailLower }
        if (duplicate) return false
        val updated = services.map {
            if (it.id == id) newEntry.copy(site = normalizedSite, id = it.id, updatedAt = nextTimestamp(services))
            else it
        }
        save(updated)
        return true
    }

    fun replaceAll(services: List<ServiceEntry>) {
        save(services.map { it.copy(site = normalizeSite(it.site)) })
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
            })
        }
        return JSONObject().apply {
            put("version", 2)
            put("services", arr)
        }.toString()
    }

    fun parseJson(json: String): List<ServiceEntry> {
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
                ServiceEntry(
                    name = name,
                    site = normalizeSite(obj.optString("site", name)),
                    email = email,
                    length = obj.optInt("length", 20),
                    symbols = obj.optString("symbols", Keygrain.DEFAULT_SYMBOLS),
                    counter = obj.optInt("counter", 1),
                    id = if (obj.has("id") && !obj.isNull("id")) obj.getString("id") else null,
                    updatedAt = obj.optLong("updated_at", System.currentTimeMillis()),
                    totp = if (obj.has("totp") && !obj.isNull("totp")) obj.getJSONObject("totp") else null,
                    ssh = if (obj.has("ssh") && !obj.isNull("ssh")) obj.getJSONObject("ssh") else null,
                    frecency = obj.optDouble("frecency", 0.0)
                )
            } catch (_: Exception) {
                null
            }
        }
    }

    private fun save(services: List<ServiceEntry>) {
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
                if (s.totp != null) put("totp", s.totp)
                if (s.ssh != null) put("ssh", s.ssh)
                if (s.frecency != 0.0) put("frecency", s.frecency)
            })
        }
        prefs.edit().putString("services", arr.toString()).apply()
    }
}
