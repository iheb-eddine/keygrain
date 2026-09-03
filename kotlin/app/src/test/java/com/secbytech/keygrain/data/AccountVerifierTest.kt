package com.secbytech.keygrain.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicReference

class AccountVerifierTest {

    private class MiniServer(
        val status: Int,
        val reason: String,
        val body: String,
        val etag: String = "test-etag"
    ) : AutoCloseable {
        private val serverSocket = ServerSocket(0, 0, java.net.InetAddress.getByName("127.0.0.1"))
        val port: Int get() = serverSocket.localPort
        val method = AtomicReference<String?>(null)
        val auth = AtomicReference<String?>(null)
        val path = AtomicReference<String?>(null)
        private val thread: Thread

        init {
            serverSocket.soTimeout = 5000
            thread = Thread {
                try {
                    serverSocket.accept().use { socket ->
                        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                        val requestLine = reader.readLine() ?: ""
                        val parts = requestLine.split(" ")
                        if (parts.size >= 2) {
                            method.set(parts[0])
                            path.set(parts[1])
                        }
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
                            "ETag: \"$etag\"\r\n" +
                            "Content-Length: ${bytes.size}\r\n" +
                            "Connection: close\r\n\r\n"
                        out.write(header.toByteArray())
                        out.write(bytes)
                        out.flush()
                    }
                } catch (_: Exception) {}
            }.apply { isDaemon = true; start() }
        }

        override fun close() {
            try { serverSocket.close() } catch (_: Exception) {}
            thread.join(2000)
        }
    }

    private fun verifierFor(port: Int): AccountVerifier {
        val url = "http://127.0.0.1:$port"
        return AccountVerifier(baseUrl = url, transport = SyncTransport(baseUrl = url))
    }

    private val testSecret = "correct-horse-battery-staple".toByteArray()
    private val testEmail = "test@example.com"

    @Test
    fun testEmailValidation() {
        assertTrue(AccountVerifier.isValidEmail("user@example.com"))
        assertTrue(AccountVerifier.isValidEmail("user.name+tag@sub.domain.org"))
        assertFalse(AccountVerifier.isValidEmail(""))
        assertFalse(AccountVerifier.isValidEmail("invalid"))
        assertFalse(AccountVerifier.isValidEmail("@domain.com"))
        assertFalse(AccountVerifier.isValidEmail("user@"))
        assertFalse(AccountVerifier.isValidEmail("user@domain"))
        assertFalse(AccountVerifier.isValidEmail("user@.com"))
    }

    @Test
    fun testVerifyAccount200MapsToExistsValid() = runBlocking {
        val json = """{"services":[],"encrypted_blob":"c29tZWJsb2I=","checksum":"abc"}"""
        MiniServer(200, "OK", json, etag = "etag-123").use { s ->
            val verifier = verifierFor(s.port)
            val result = verifier.verifyAccount(testSecret, testEmail)
            assertTrue(result is AccountVerificationResult.ExistsValid)
            val valid = result as AccountVerificationResult.ExistsValid
            assertEquals("etag-123", valid.etag)
            assertEquals("c29tZWJsb2I=", valid.encryptedBlob)
            assertEquals("abc", valid.checksum)
            assertEquals("GET", s.method.get())
            assertTrue(s.auth.get()?.startsWith("Basic ") == true)
        }
    }

    @Test
    fun testVerifyAccount404MapsToNotFound() = runBlocking {
        MiniServer(404, "Not Found", """{"error":"not found"}""").use { s ->
            val verifier = verifierFor(s.port)
            val result = verifier.verifyAccount(testSecret, testEmail)
            assertTrue(result is AccountVerificationResult.NotFound)
        }
    }

    @Test
    fun testVerifyAccount401MapsToWrongSecret() = runBlocking {
        MiniServer(401, "Unauthorized", """{"error":"unauthorized"}""").use { s ->
            val verifier = verifierFor(s.port)
            val result = verifier.verifyAccount(testSecret, testEmail)
            assertTrue(result is AccountVerificationResult.WrongSecret)
            assertEquals(401, (result as AccountVerificationResult.WrongSecret).code)
        }
    }

    @Test
    fun testVerifyAccount429MapsToRateLimited() = runBlocking {
        MiniServer(429, "Too Many Requests", """{"error":"rate limit exceeded"}""").use { s ->
            val verifier = verifierFor(s.port)
            val result = verifier.verifyAccount(testSecret, testEmail)
            assertTrue(result is AccountVerificationResult.RateLimited)
        }
    }

    @Test
    fun testVerifyAccount500MapsToServerError() = runBlocking {
        MiniServer(500, "Internal Server Error", """{"error":"internal error"}""").use { s ->
            val verifier = verifierFor(s.port)
            val result = verifier.verifyAccount(testSecret, testEmail)
            assertTrue(result is AccountVerificationResult.ServerError)
            assertEquals(500, (result as AccountVerificationResult.ServerError).code)
        }
    }

    @Test
    fun testVerifyAccountNetworkUnavailable() = runBlocking {
        // Connect to a closed port
        val verifier = AccountVerifier(baseUrl = "http://127.0.0.1:1")
        val result = verifier.verifyAccount(testSecret, testEmail)
        assertTrue(result is AccountVerificationResult.NetworkUnavailable)
        assertFalse((result as AccountVerificationResult.NetworkUnavailable).localMatches)
    }

    @Test
    fun testCheckCanCreateAccount200MapsToAlreadyExistsRemote() = runBlocking {
        val json = """{"services":[],"encrypted_blob":"blob","checksum":"abc"}"""
        MiniServer(200, "OK", json).use { s ->
            val verifier = verifierFor(s.port)
            val result = verifier.checkCanCreateAccount(testSecret, testEmail)
            assertTrue(result is AccountCreationCheckResult.AlreadyExistsRemote)
        }
    }

    @Test
    fun testCheckCanCreateAccount404MapsToCanCreate() = runBlocking {
        MiniServer(404, "Not Found", """{"error":"not found"}""").use { s ->
            val verifier = verifierFor(s.port)
            val result = verifier.checkCanCreateAccount(testSecret, testEmail)
            assertTrue(result is AccountCreationCheckResult.CanCreate)
        }
    }

    @Test
    fun testCheckCanCreateAccount429MapsToRateLimited() = runBlocking {
        MiniServer(429, "Too Many Requests", """{"error":"rate limit exceeded"}""").use { s ->
            val verifier = verifierFor(s.port)
            val result = verifier.checkCanCreateAccount(testSecret, testEmail)
            assertTrue(result is AccountCreationCheckResult.RateLimited)
        }
    }
}
