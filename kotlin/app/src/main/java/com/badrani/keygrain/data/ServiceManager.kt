package com.badrani.keygrain.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

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
    val ssh: JSONObject? = null
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
                    ssh = if (obj.has("ssh") && !obj.isNull("ssh")) obj.getJSONObject("ssh") else null
                )
            } catch (_: Exception) {
                null
            }
        }
    }

    fun addService(entry: ServiceEntry) {
        val services = getServices().toMutableList()
        services.add(entry.copy(site = normalizeSite(entry.site), updatedAt = System.currentTimeMillis()))
        save(services)
    }

    fun deleteService(name: String) {
        val services = getServices().filter { it.name != name }
        save(services)
    }

    fun updateService(oldName: String, newEntry: ServiceEntry) {
        val services = getServices().map {
            if (it.name == oldName) newEntry.copy(site = normalizeSite(newEntry.site), id = it.id, updatedAt = System.currentTimeMillis())
            else it
        }
        save(services)
    }

    fun replaceAll(services: List<ServiceEntry>) {
        save(services.map { it.copy(site = normalizeSite(it.site)) })
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
                    ssh = if (obj.has("ssh") && !obj.isNull("ssh")) obj.getJSONObject("ssh") else null
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
            })
        }
        prefs.edit().putString("services", arr.toString()).apply()
    }
}
