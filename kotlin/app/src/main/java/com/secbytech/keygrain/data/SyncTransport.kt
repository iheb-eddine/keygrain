package com.secbytech.keygrain.data

import android.util.Base64
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * HTTP layer for the sync API. Split out of [SyncManager] so the orchestration in
 * [SyncManager.sync] is readable and so the status-code -> result mapping can be driven
 * against an embedded HttpServer without a Context.
 *
 * Every call: HttpURLConnection, 15s connect/read timeouts, disconnect in `finally`.
 */
internal class SyncTransport(private val baseUrl: String) {
    fun doGet(lookupId: String, authHeader: String): GetResult {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("$baseUrl/api/sync/$lookupId").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                setRequestProperty("Authorization", authHeader)
                connectTimeout = 15000
                readTimeout = 15000
            }
            when (val code = conn.responseCode) {
                200 -> {
                    val body = conn.inputStream.bufferedReader().readText()
                    val json = JSONObject(body)
                    val svcs = json.getJSONArray("services")
                    val services = (0 until svcs.length()).map { i ->
                        val obj = svcs.getJSONObject(i)
                        val id = if (obj.isNull("id")) null else obj.getString("id")
                        Pair(id, obj.getLong("updated_at"))
                    }
                    val etag = conn.getHeaderField("ETag")?.trim('"') ?: ""
                    GetResult.Success(services, json.getString("encrypted_blob"), json.getString("checksum"), etag)
                }
                404 -> GetResult.NotFound("not found")
                401, 403 -> GetResult.AuthError(code)
                else -> GetResult.Error(code, conn.errorStream?.bufferedReader()?.readText() ?: "")
            }
        } catch (e: IOException) {
            GetResult.NetworkError(e)
        } finally {
            conn?.disconnect()
        }
    }


    fun doPut(lookupId: String, authHeader: String, body: String, etag: String?): PutResult {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("$baseUrl/api/sync/$lookupId").openConnection() as HttpURLConnection).apply {
                requestMethod = "PUT"
                setRequestProperty("Authorization", authHeader)
                setRequestProperty("Content-Type", "application/json")
                if (etag != null) setRequestProperty("If-Match", "\"$etag\"")
                doOutput = true
                connectTimeout = 15000
                readTimeout = 15000
            }
            conn.outputStream.use { it.write(body.toByteArray()) }
            when (val code = conn.responseCode) {
                200, 201 -> {
                    val respBody = conn.inputStream.bufferedReader().readText()
                    val json = JSONObject(respBody)
                    val svcs = json.getJSONArray("services")
                    val services = (0 until svcs.length()).map { i ->
                        val obj = svcs.getJSONObject(i)
                        val id = if (obj.isNull("id")) null else obj.getString("id")
                        Pair(id, obj.getLong("updated_at"))
                    }
                    PutResult.Success(services, json.getString("etag"))
                }
                409 -> {
                    val errBody = conn.errorStream?.bufferedReader()?.readText() ?: ""
                    val currentEtag = try { JSONObject(errBody).getString("current_etag") } catch (_: Exception) { "" }
                    PutResult.Conflict(currentEtag)
                }
                401, 403 -> PutResult.AuthError(code)
                else -> PutResult.Error(code, conn.errorStream?.bufferedReader()?.readText() ?: "")
            }
        } catch (e: IOException) {
            PutResult.NetworkError(e)
        } finally {
            conn?.disconnect()
        }
    }


    /**
     * HTTP layer for [deleteServerData]. Mirrors [doGet]/[doPut]
     * (HttpURLConnection, 15s timeouts, disconnect in finally). Internal rather
     * than private so the plain-JVM unit test can drive the full
     * status-code -> DeleteResult mapping against an embedded HttpServer without
     * touching android.util.Base64 (which is not available in unit tests).
     */
    @androidx.annotation.VisibleForTesting
    internal fun doDelete(lookupId: String, authHeader: String): DeleteResult {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("$baseUrl/api/sync/$lookupId").openConnection() as HttpURLConnection).apply {
                requestMethod = "DELETE"
                setRequestProperty("Authorization", authHeader)
                connectTimeout = 15000
                readTimeout = 15000
            }
            when (val code = conn.responseCode) {
                200 -> DeleteResult.Success
                404 -> DeleteResult.NotFound
                401, 403 -> DeleteResult.AuthError(code)
                429 -> DeleteResult.RateLimited
                else -> DeleteResult.ServerError(code, conn.errorStream?.bufferedReader()?.readText() ?: "")
            }
        } catch (e: IOException) {
            DeleteResult.NetworkError(e)
        } finally {
            conn?.disconnect()
        }
    }
}

internal sealed class GetResult {
    data class Success(
        val services: List<Pair<String?, Long>>,
        val encryptedBlob: String,
        val checksum: String,
        val etag: String
    ) : GetResult()
    data class NotFound(val msg: String) : GetResult()
    data class AuthError(val code: Int) : GetResult()
    data class Error(val code: Int, val body: String) : GetResult()
    data class NetworkError(val cause: Throwable) : GetResult()
}


internal sealed class PutResult {
    data class Success(val services: List<Pair<String?, Long>>, val etag: String) : PutResult()
    data class Conflict(val currentEtag: String) : PutResult()
    data class AuthError(val code: Int) : PutResult()
    data class Error(val code: Int, val body: String) : PutResult()
    data class NetworkError(val cause: Throwable) : PutResult()
}

