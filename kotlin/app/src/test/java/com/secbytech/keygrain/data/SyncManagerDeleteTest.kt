package com.secbytech.keygrain.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.util.Base64
import java.util.concurrent.atomic.AtomicReference

/**
 * Unit tests for the DELETE HTTP layer of [SyncManager.doDelete].
 *
 * These drive the FULL status-code -> DeleteResult mapping (the Invariant #1
 * critical logic) and the request shape (method + Authorization pass-through)
 * against a tiny embedded HTTP server bound to 127.0.0.1:0.
 *
 * Two implementation notes:
 *  - The embedded server is a hand-rolled java.net.ServerSocket responder rather
 *    than com.sun.net.httpserver.HttpServer, because on this module's Android
 *    unit-test compile classpath (android.jar) com.sun.net.httpserver is not
 *    available. java.net is.
 *  - The tests call the internal [SyncManager.doDelete] directly rather than the
 *    public suspend [SyncManager.deleteServerData]: on the plain-JVM unit test
 *    runtime (no Robolectric / returnDefaultValues) android.util.Base64 — used by
 *    deleteServerData to build the auth header — throws "not mocked". This is the
 *    same pre-existing limitation that stops the existing sync()/doGet/doPut
 *    paths from being unit-tested (see SshEngineTest, which uses java.util.Base64
 *    for the identical reason). doDelete itself is pure JVM (HttpURLConnection),
 *    so the meaningful HTTP behavior is fully covered; the auth header here is
 *    built with java.util.Base64.
 */
class SyncManagerDeleteTest {

    private val lookupId = "ab".repeat(32) // 64-char hex
    private val authHeader = "Basic " + Base64.getEncoder()
        .encodeToString("$lookupId:secret-pass".toByteArray())

    /** A single-request HTTP responder over a raw socket. */
    private class MiniServer(status: Int, reason: String, body: String) : AutoCloseable {
        private val serverSocket = ServerSocket(0, 0, java.net.InetAddress.getByName("127.0.0.1"))
        val port: Int get() = serverSocket.localPort
        val method = AtomicReference<String?>(null)
        val auth = AtomicReference<String?>(null)
        private val thread: Thread

        init {
            serverSocket.soTimeout = 5000
            thread = Thread {
                try {
                    serverSocket.accept().use { socket ->
                        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                        val requestLine = reader.readLine() ?: ""
                        method.set(requestLine.substringBefore(' '))
                        // Read headers until the blank line; capture Authorization.
                        while (true) {
                            val line = reader.readLine() ?: break
                            if (line.isEmpty()) break
                            if (line.startsWith("Authorization:", ignoreCase = true)) {
                                auth.set(line.substringAfter(':').trim())
                            }
                        }
                        val bytes = body.toByteArray()
                        val out = socket.getOutputStream()
                        val header = "HTTP/1.1 $status $reason\r\n" +
                            "Content-Type: application/json\r\n" +
                            "Content-Length: ${bytes.size}\r\n" +
                            "Connection: close\r\n\r\n"
                        out.write(header.toByteArray())
                        out.write(bytes)
                        out.flush()
                    }
                } catch (_: Exception) {
                    // Test teardown or client-side close; ignore.
                }
            }.apply { isDaemon = true; start() }
        }

        override fun close() {
            try { serverSocket.close() } catch (_: Exception) {}
            thread.join(2000)
        }
    }

    private fun managerFor(port: Int) = SyncManager(baseUrl = "http://127.0.0.1:$port")

    @Test
    fun testDeleteReturns200MapsToSuccess() {
        MiniServer(200, "OK", """{"status":"deleted"}""").use { s ->
            assertEquals(DeleteResult.Success, managerFor(s.port).doDelete(lookupId, authHeader))
        }
    }

    @Test
    fun testDeleteReturns404MapsToNotFound() {
        MiniServer(404, "Not Found", """{"error":"not found"}""").use { s ->
            assertEquals(DeleteResult.NotFound, managerFor(s.port).doDelete(lookupId, authHeader))
        }
    }

    @Test
    fun testDeleteReturns401MapsToAuthError() {
        MiniServer(401, "Unauthorized", """{"error":"unauthorized"}""").use { s ->
            val result = managerFor(s.port).doDelete(lookupId, authHeader)
            assertTrue(result is DeleteResult.AuthError)
            assertEquals(401, (result as DeleteResult.AuthError).httpCode)
        }
    }

    @Test
    fun testDeleteReturns403MapsToAuthError() {
        MiniServer(403, "Forbidden", """{"error":"forbidden"}""").use { s ->
            val result = managerFor(s.port).doDelete(lookupId, authHeader)
            assertTrue(result is DeleteResult.AuthError)
            assertEquals(403, (result as DeleteResult.AuthError).httpCode)
        }
    }

    @Test
    fun testDeleteReturns429MapsToRateLimited() {
        MiniServer(429, "Too Many Requests", """{"error":"rate limit exceeded","retry_after":30}""").use { s ->
            assertEquals(DeleteResult.RateLimited, managerFor(s.port).doDelete(lookupId, authHeader))
        }
    }

    @Test
    fun testDeleteReturns500MapsToServerError() {
        MiniServer(500, "Internal Server Error", """{"error":"internal error"}""").use { s ->
            val result = managerFor(s.port).doDelete(lookupId, authHeader)
            assertTrue(result is DeleteResult.ServerError)
            assertEquals(500, (result as DeleteResult.ServerError).httpCode)
        }
    }

    @Test
    fun testDeleteRequestShapeMethodAndAuthHeader() {
        MiniServer(200, "OK", """{"status":"deleted"}""").use { s ->
            managerFor(s.port).doDelete(lookupId, authHeader)
            assertEquals("DELETE", s.method.get())
            assertEquals(authHeader, s.auth.get())
        }
    }

    @Test
    fun testDeleteDoesNotDependOnResponseBody() {
        // A 200 with a non-JSON / unexpected body must still map to Success:
        // doDelete must never parse the body.
        MiniServer(200, "OK", "not json at all <<<").use { s ->
            assertEquals(DeleteResult.Success, managerFor(s.port).doDelete(lookupId, authHeader))
        }
    }

    @Test
    fun testDeleteNetworkErrorOnUnreachable() {
        // Reserve a port then release it so nothing is listening -> connection refused.
        val port = ServerSocket(0).use { it.localPort }
        val result = managerFor(port).doDelete(lookupId, authHeader)
        assertTrue("expected NetworkError, got $result", result is DeleteResult.NetworkError)
    }
}
