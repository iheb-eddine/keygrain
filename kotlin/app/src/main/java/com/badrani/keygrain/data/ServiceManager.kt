package com.badrani.keygrain.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

data class ServiceEntry(
    val name: String,
    val email: String,
    val length: Int = 20,
    val symbols: String = Keygrain.DEFAULT_SYMBOLS,
    val salt: String = ""
)

class ServiceManager(context: Context) {
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
        return (0 until arr.length()).map { i ->
            val obj = arr.getJSONObject(i)
            ServiceEntry(
                name = obj.getString("name"),
                email = obj.getString("email"),
                length = obj.optInt("length", 20),
                symbols = obj.optString("symbols", Keygrain.DEFAULT_SYMBOLS),
                salt = obj.optString("salt", "")
            )
        }
    }

    fun addService(entry: ServiceEntry) {
        val services = getServices().toMutableList()
        services.add(entry)
        save(services)
    }

    fun deleteService(name: String) {
        val services = getServices().filter { it.name != name }
        save(services)
    }

    fun replaceAll(services: List<ServiceEntry>) {
        save(services)
    }

    fun exportJson(): String {
        val arr = JSONArray()
        getServices().forEach { s ->
            arr.put(JSONObject().apply {
                put("name", s.name)
                put("email", s.email)
                put("length", s.length)
                put("symbols", s.symbols)
                put("salt", s.salt)
            })
        }
        return JSONObject().apply {
            put("version", 1)
            put("services", arr)
        }.toString()
    }

    fun parseJson(json: String): List<ServiceEntry> {
        val trimmed = json.trim()
        val arr = if (trimmed.startsWith("[")) {
            JSONArray(trimmed)
        } else {
            JSONObject(trimmed).getJSONArray("services")
        }
        return (0 until arr.length()).map { i ->
            val obj = arr.getJSONObject(i)
            ServiceEntry(
                name = obj.getString("name"),
                email = obj.getString("email"),
                length = obj.optInt("length", 20),
                symbols = obj.optString("symbols", Keygrain.DEFAULT_SYMBOLS),
                salt = obj.optString("salt", "")
            )
        }
    }

    private fun save(services: List<ServiceEntry>) {
        val arr = JSONArray()
        services.forEach { s ->
            arr.put(JSONObject().apply {
                put("name", s.name)
                put("email", s.email)
                put("length", s.length)
                put("symbols", s.symbols)
                put("salt", s.salt)
            })
        }
        prefs.edit().putString("services", arr.toString()).apply()
    }
}
