package com.badrani.keygrain.data

import android.content.Context
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import javax.crypto.AEADBadTagException

sealed class SyncResult {
    data class Success(val message: String) : SyncResult()
    data class Conflict(val currentEtag: String) : SyncResult()
    data class AuthError(val httpCode: Int) : SyncResult()
    data class NetworkError(val cause: Throwable) : SyncResult()
    data class ServerError(val httpCode: Int, val body: String) : SyncResult()
}

sealed class RestoreResult {
    data class Success(val services: List<ServiceEntry>) : RestoreResult()
    data class AuthError(val httpCode: Int) : RestoreResult()
    data class NetworkError(val cause: Throwable) : RestoreResult()
    data class NotFound(val message: String) : RestoreResult()
    data class DecryptionError(val cause: Throwable) : RestoreResult()
    data class ServerError(val httpCode: Int, val body: String) : RestoreResult()
}

class SyncManager(
    private val baseUrl: String = "https://keygrain.secbytech.com"
) {
    private fun getETagPrefs(context: Context) =
        context.getSharedPreferences("keygrain_etags", Context.MODE_PRIVATE)

    suspend fun backup(
        secret: ByteArray,
        email: String,
        serviceManager: ServiceManager,
        context: Context
    ): SyncResult = withContext(Dispatchers.IO) {
        val lookupId = Keygrain.deriveLookupId(secret, email)
        val authPassword = Keygrain.deriveAuthPassword(secret, email)
        val encryptionKey = Keygrain.deriveEncryptionKey(secret, email)
        var conn: HttpURLConnection? = null
        try {
            val json = serviceManager.exportJson()
            val blob = SyncCrypto.encrypt(encryptionKey, json.toByteArray(Charsets.UTF_8))
            val authHeader = "Basic " + Base64.encodeToString(
                "$lookupId:$authPassword".toByteArray(), Base64.NO_WRAP
            )
            val url = URL("$baseUrl/api/backup/$lookupId")
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "PUT"
                setRequestProperty("Authorization", authHeader)
                setRequestProperty("Content-Type", "application/octet-stream")
                doOutput = true
                connectTimeout = 15000
                readTimeout = 15000
            }
            val storedEtag = getETagPrefs(context).getString(lookupId, null)
            if (storedEtag != null) {
                conn.setRequestProperty("If-Match", "\"$storedEtag\"")
            }
            conn.outputStream.use { it.write(blob) }
            val code = conn.responseCode
            when {
                code in 200..299 -> {
                    val etag = conn.getHeaderField("ETag")?.trim('"')
                    if (etag != null) {
                        getETagPrefs(context).edit().putString(lookupId, etag).apply()
                    }
                    SyncResult.Success("Backup complete")
                }
                code == 412 -> {
                    val body = conn.errorStream?.bufferedReader()?.readText() ?: ""
                    val currentEtag = try {
                        org.json.JSONObject(body).getString("current_etag")
                    } catch (_: Exception) { "" }
                    SyncResult.Conflict(currentEtag)
                }
                code == 401 || code == 403 -> SyncResult.AuthError(code)
                else -> SyncResult.ServerError(code, conn.errorStream?.bufferedReader()?.readText() ?: "")
            }
        } catch (e: IOException) {
            SyncResult.NetworkError(e)
        } finally {
            conn?.disconnect()
            encryptionKey.fill(0)
        }
    }

    suspend fun restore(
        secret: ByteArray,
        email: String,
        serviceManager: ServiceManager,
        context: Context
    ): RestoreResult = withContext(Dispatchers.IO) {
        val lookupId = Keygrain.deriveLookupId(secret, email)
        val authPassword = Keygrain.deriveAuthPassword(secret, email)
        val encryptionKey = Keygrain.deriveEncryptionKey(secret, email)
        var conn: HttpURLConnection? = null
        try {
            val authHeader = "Basic " + Base64.encodeToString(
                "$lookupId:$authPassword".toByteArray(), Base64.NO_WRAP
            )
            val url = URL("$baseUrl/api/backup/$lookupId")
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                setRequestProperty("Authorization", authHeader)
                connectTimeout = 15000
                readTimeout = 15000
            }
            val code = conn.responseCode
            when {
                code == 404 -> RestoreResult.NotFound("No backup found for this email")
                code == 401 || code == 403 -> RestoreResult.AuthError(code)
                code !in 200..299 -> RestoreResult.ServerError(code, conn.errorStream?.bufferedReader()?.readText() ?: "")
                else -> {
                    val etag = conn.getHeaderField("ETag")?.trim('"')
                    val blob = conn.inputStream.use { it.readBytes() }
                    val plaintext = SyncCrypto.decrypt(encryptionKey, blob)
                    val json = String(plaintext, Charsets.UTF_8)
                    val services = serviceManager.parseJson(json)
                    serviceManager.replaceAll(services)
                    if (etag != null) {
                        getETagPrefs(context).edit().putString(lookupId, etag).apply()
                    }
                    RestoreResult.Success(services)
                }
            }
        } catch (e: AEADBadTagException) {
            RestoreResult.DecryptionError(e)
        } catch (e: IllegalArgumentException) {
            RestoreResult.DecryptionError(e)
        } catch (e: org.json.JSONException) {
            RestoreResult.DecryptionError(e)
        } catch (e: IOException) {
            RestoreResult.NetworkError(e)
        } finally {
            conn?.disconnect()
            encryptionKey.fill(0)
        }
    }
}
