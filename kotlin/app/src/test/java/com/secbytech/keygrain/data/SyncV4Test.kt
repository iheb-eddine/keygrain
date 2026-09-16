package com.secbytech.keygrain.data

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.util.Base64
import java.util.concurrent.atomic.AtomicReference

/**
 * Unit tests verifying Target Zero-Knowledge (ZK) Sync Protocol (Sync v4) in Keygrain Android:
 * 1. SyncTransport wire contract: pure ZK envelope (no outer services, no deleted_ids).
 * 2. SyncTransport GET/PUT parsing with version, checksum, and ETag.
 * 3. Strict transactional versioning: V -> V + 1 progression.
 * 4. Client dirty-checking (zero-write on no-op): skip PUT when state is identical.
 * 5. HTTP 409 conflict retry loop: jittered backoff, re-fetch, re-reconcile, re-commit.
 */
class SyncV4Test {

    private val testSecret = "test-master-secret-12345".toByteArray(Charsets.UTF_8)
    private val testEmail = "alice@example.com"
    private val lookupId = Keygrain.deriveLookupId(testSecret, testEmail)
    private val encryptionKey = Keygrain.deriveEncryptionKey(testSecret, testEmail)

    private fun makeEncryptedBlob(
        services: List<ServiceEntry> = emptyList(),
        sshKeys: List<SshKeyEntry> = emptyList(),
        wallets: List<WalletEntry> = emptyList(),
        conflicts: List<SyncConflict> = emptyList()
    ): Pair<String, String> {
        val servicesArr = JSONArray()
        for (s in services) {
            val obj = s.toJsonContent().apply {
                if (s.id != null) put("id", s.id)
                put("updated_at", s.updatedAt)
                remove("ssh")
            }
            servicesArr.put(obj)
        }
        val sshArr = JSONArray().apply { sshKeys.forEach { put(it.toJson()) } }
        val walletsArr = JSONArray().apply { wallets.forEach { put(it.toJson()) } }
        val conflictsArr = JSONArray().apply { conflicts.forEach { put(it.toJson()) } }

        val payload = JSONObject().apply {
            put("services", servicesArr)
            put("ssh_keys", sshArr)
            put("wallets", walletsArr)
            put("sync_conflicts", conflictsArr)
        }
        val plaintext = payload.toString().toByteArray(Charsets.UTF_8)
        val aad = lookupId.toByteArray(Charsets.UTF_8)
        val encrypted = SyncCrypto.encrypt(encryptionKey, plaintext, aad)
        val blobB64 = Base64.getEncoder().encodeToString(encrypted)
        val checksum = SyncIntegrity.sha256Hex(encrypted)
        return blobB64 to checksum
    }

    private class FakeLocalState(
        var localServices: MutableList<ServiceEntry> = mutableListOf(),
        var localTombstones: MutableList<Tombstone> = mutableListOf(),
        var localSshKeys: MutableList<SshKeyEntry> = mutableListOf(),
        var localSshTombstones: MutableList<Tombstone> = mutableListOf(),
        var localWallets: MutableList<WalletEntry> = mutableListOf(),
        var localWalletTombstones: MutableList<Tombstone> = mutableListOf(),
        var localLastSyncAt: Long = 0L,
        var localSyncVersion: Int = 0,
        var localAadEnabled: Boolean = true,
        var localConflictsDismissed: Boolean = false,
        var localDeletionReview: MutableList<DeletionReviewEntry> = mutableListOf()
    ) : SyncLocalState {
        override fun getServices(): List<ServiceEntry> = localServices
        override fun replaceServices(services: List<ServiceEntry>) {
            this.localServices = services.toMutableList()
        }
        override fun getServiceTombstones(): List<Tombstone> = localTombstones
        override fun setServiceTombstones(tombstones: List<Tombstone>) {
            this.localTombstones = tombstones.toMutableList()
        }
        override fun getDeletionReview(): List<DeletionReviewEntry> = localDeletionReview
        override fun setDeletionReview(review: List<DeletionReviewEntry>) {
            this.localDeletionReview = review.toMutableList()
        }
        override fun parseServicesJson(json: String): List<ServiceEntry> =
            ServiceManager.parseServicesJson(json)

        override fun getSshKeys(): List<SshKeyEntry> = localSshKeys
        override fun saveSshKeys(keys: List<SshKeyEntry>) {
            this.localSshKeys = keys.toMutableList()
        }
        override fun getSshTombstones(): List<Tombstone> = localSshTombstones
        override fun setSshTombstones(tombstones: List<Tombstone>) {
            this.localSshTombstones = tombstones.toMutableList()
        }

        override fun getWallets(): List<WalletEntry> = localWallets
        override fun saveWallets(wallets: List<WalletEntry>) {
            this.localWallets = wallets.toMutableList()
        }
        override fun getWalletTombstones(): List<Tombstone> = localWalletTombstones
        override fun setWalletTombstones(tombstones: List<Tombstone>) {
            this.localWalletTombstones = tombstones.toMutableList()
        }

        override fun getLastSuccessfulSyncAt(): Long = localLastSyncAt
        override fun setLastSuccessfulSyncAt(ts: Long) {
            this.localLastSyncAt = ts
        }

        override fun getSyncVersion(): Int = localSyncVersion
        override fun setSyncVersion(version: Int) {
            this.localSyncVersion = version
        }

        override fun isAadEnabled(): Boolean = localAadEnabled
        override fun setAadEnabled(enabled: Boolean) {
            this.localAadEnabled = enabled
        }

        override fun areConflictsDismissed(): Boolean = localConflictsDismissed
        override fun setConflictsDismissed(dismissed: Boolean) {
            this.localConflictsDismissed = dismissed
        }
    }

    private data class PutCall(
        val lookupId: String,
        val authHeader: String,
        val body: String,
        val etag: String?
    )

    private class MockTransport : SyncTransportApi {
        var getResponses = mutableListOf<GetResult>()
        var putResponses = mutableListOf<PutResult>()
        val putCalls = mutableListOf<PutCall>()
        var getCallCount = 0

        override fun doGet(lookupId: String, authHeader: String): GetResult {
            getCallCount++
            return if (getResponses.isNotEmpty()) getResponses.removeAt(0)
            else GetResult.NotFound("not found")
        }

        override fun doPut(
            lookupId: String,
            authHeader: String,
            body: String,
            etag: String?
        ): PutResult {
            putCalls.add(PutCall(lookupId, authHeader, body, etag))
            return if (putResponses.isNotEmpty()) putResponses.removeAt(0)
            else PutResult.Success(version = 1, etag = "etag-default")
        }

        override fun doDelete(lookupId: String, authHeader: String): DeleteResult =
            DeleteResult.Success
    }

    private class MiniHttpServer(
        private val handler: (method: String, path: String, headers: Map<String, String>, body: String) -> Pair<Int, Pair<Map<String, String>, String>>
    ) : AutoCloseable {
        private val serverSocket = ServerSocket(0, 0, java.net.InetAddress.getByName("127.0.0.1"))
        val port: Int get() = serverSocket.localPort
        private val thread: Thread

        init {
            serverSocket.soTimeout = 5000
            thread = Thread {
                try {
                    while (!Thread.currentThread().isInterrupted) {
                        val client = serverSocket.accept()
                        Thread {
                            try {
                                client.use { sock ->
                                    val reader = BufferedReader(InputStreamReader(sock.getInputStream()))
                                    val reqLine = reader.readLine() ?: return@use
                                    val parts = reqLine.split(" ")
                                    val method = parts[0]
                                    val path = parts.getOrElse(1) { "/" }

                                    val headers = mutableMapOf<String, String>()
                                    var contentLength = 0
                                    while (true) {
                                        val line = reader.readLine() ?: break
                                        if (line.isEmpty()) break
                                        val colon = line.indexOf(':')
                                        if (colon > 0) {
                                            val k = line.substring(0, colon).trim().lowercase()
                                            val v = line.substring(colon + 1).trim()
                                            headers[k] = v
                                            if (k == "content-length") {
                                                contentLength = v.toIntOrNull() ?: 0
                                            }
                                        }
                                    }

                                    val body = if (contentLength > 0) {
                                        val chars = CharArray(contentLength)
                                        var read = 0
                                        while (read < contentLength) {
                                            val r = reader.read(chars, read, contentLength - read)
                                            if (r < 0) break
                                            read += r
                                        }
                                        String(chars, 0, read)
                                    } else ""

                                    val (status, respData) = handler(method, path, headers, body)
                                    val (respHeaders, respBody) = respData
                                    val bodyBytes = respBody.toByteArray(Charsets.UTF_8)

                                    val statusMsg = when (status) {
                                        200 -> "OK"
                                        201 -> "Created"
                                        404 -> "Not Found"
                                        409 -> "Conflict"
                                        else -> "Status $status"
                                    }

                                    val headerLines = StringBuilder("HTTP/1.1 $status $statusMsg\r\n")
                                    headerLines.append("Content-Length: ${bodyBytes.size}\r\n")
                                    respHeaders.forEach { (k, v) ->
                                        headerLines.append("$k: $v\r\n")
                                    }
                                    headerLines.append("Connection: close\r\n\r\n")

                                    val out = sock.getOutputStream()
                                    out.write(headerLines.toString().toByteArray(Charsets.UTF_8))
                                    out.write(bodyBytes)
                                    out.flush()
                                }
                            } catch (_: Exception) {}
                        }.start()
                    }
                } catch (_: Exception) {}
            }.apply { isDaemon = true; start() }
        }

        override fun close() {
            try { serverSocket.close() } catch (_: Exception) {}
            thread.join(2000)
        }
    }

    // --- 1. Transport Layer Sync v4 Wire Contract ---

    @Test
    fun transportDoGetParsesSyncV4Response() {
        val (blobB64, checksum) = makeEncryptedBlob()
        val json = """
            {
              "version": 4,
              "encrypted_blob": "$blobB64",
              "checksum": "$checksum"
            }
        """.trimIndent()

        MiniHttpServer { method, path, _, _ ->
            assertEquals("GET", method)
            assertEquals("/api/sync/$lookupId", path)
            200 to (mapOf("Content-Type" to "application/json", "ETag" to "\"etag-v4\"") to json)
        }.use { server ->
            val transport = SyncTransport("http://127.0.0.1:${server.port}")
            val result = transport.doGet(lookupId, "Basic auth")
            assertTrue(result is GetResult.Success)
            val success = result as GetResult.Success
            assertEquals(4, success.version)
            assertEquals(blobB64, success.encryptedBlob)
            assertEquals(checksum, success.checksum)
            assertEquals("etag-v4", success.etag)
        }
    }

    @Test
    fun transportDoGet404ReturnsNotFound() {
        MiniHttpServer { _, _, _, _ ->
            404 to (mapOf("Content-Type" to "application/json") to """{"error":"not_found"}""")
        }.use { server ->
            val transport = SyncTransport("http://127.0.0.1:${server.port}")
            val result = transport.doGet(lookupId, "Basic auth")
            assertTrue(result is GetResult.NotFound)
        }
    }

    @Test
    fun transportDoPutSendsStrictSyncV4EnvelopeWithoutOuterMetadata() {
        val capturedBody = AtomicReference<String>()
        val capturedIfMatch = AtomicReference<String>()

        MiniHttpServer { method, _, headers, body ->
            assertEquals("PUT", method)
            capturedBody.set(body)
            capturedIfMatch.set(headers["if-match"])
            val respJson = """{"version": 5, "checksum": "sum5", "etag": "etag5"}"""
            200 to (mapOf("Content-Type" to "application/json", "ETag" to "\"etag5\"") to respJson)
        }.use { server ->
            val transport = SyncTransport("http://127.0.0.1:${server.port}")
            val putBody = JSONObject().apply {
                put("version", 5)
                put("encrypted_blob", "some-blob")
                put("checksum", "some-sum")
            }.toString()

            val result = transport.doPut(lookupId, "Basic auth", putBody, "old-etag")
            assertTrue(result is PutResult.Success)
            val success = result as PutResult.Success
            assertEquals(5, success.version)
            assertEquals("etag5", success.etag)

            assertEquals("\"old-etag\"", capturedIfMatch.get())

            // Assert strict wire schema: strictly version, encrypted_blob, checksum
            val reqJson = JSONObject(capturedBody.get())
            assertTrue(reqJson.has("version"))
            assertTrue(reqJson.has("encrypted_blob"))
            assertTrue(reqJson.has("checksum"))
            assertFalse("Outer 'services' array MUST NOT be sent over the wire!", reqJson.has("services"))
            assertFalse("Outer 'deleted_ids' array MUST NOT be sent over the wire!", reqJson.has("deleted_ids"))
            assertEquals(3, reqJson.length())
        }
    }

    @Test
    fun transportDoPut409ReturnsConflictWithDetails() {
        val errJson = """
            {
              "error": "conflict",
              "code": "VERSION_CONFLICT",
              "details": {
                "current_version": 7,
                "current_etag": "etag-7"
              }
            }
        """.trimIndent()

        MiniHttpServer { _, _, _, _ ->
            409 to (mapOf("Content-Type" to "application/json") to errJson)
        }.use { server ->
            val transport = SyncTransport("http://127.0.0.1:${server.port}")
            val result = transport.doPut(lookupId, "Basic auth", "{}", "etag-old")
            assertTrue(result is PutResult.Conflict)
            val conflict = result as PutResult.Conflict
            assertEquals("etag-7", conflict.currentEtag)
            assertEquals(7, conflict.currentVersion)
        }
    }

    // --- 2. Version Progression & Envelope Verification in SyncManager ---

    @Test
    fun initialSyncProvisionsVersionOneWithStrictEnvelope() = runBlocking {
        val transport = MockTransport()
        transport.getResponses.add(GetResult.NotFound("not found"))
        transport.putResponses.add(PutResult.Success(version = 1, etag = "etag-1"))

        val local = FakeLocalState()
        local.localServices.add(ServiceEntry(name = "GitHub", site = "github.com", email = testEmail, id = "id-1", updatedAt = 1000L, synced = false))

        val manager = SyncManager(transport)
        val result = manager.sync(testSecret, testEmail, local)

        assertTrue(result is SyncResult.Success)
        val success = result as SyncResult.Success
        assertEquals("created", success.status)
        assertEquals(1, success.version)
        assertEquals(1, local.getSyncVersion())
        assertTrue(local.getLastSuccessfulSyncAt() > 0L)

        // Verify PUT envelope
        assertEquals(1, transport.putCalls.size)
        val putCall = transport.putCalls[0]
        val reqJson = JSONObject(putCall.body)
        assertEquals(1, reqJson.getInt("version"))
        assertTrue(reqJson.has("encrypted_blob"))
        assertTrue(reqJson.has("checksum"))
        assertFalse(reqJson.has("services"))
        assertFalse(reqJson.has("deleted_ids"))
        assertEquals(3, reqJson.length())
    }

    @Test
    fun existingSyncIncrementsVersionMonotonically() = runBlocking {
        val remoteSvc = ServiceEntry(name = "GitLab", site = "gitlab.com", email = testEmail, id = "id-remote", updatedAt = 2000L, synced = true)
        val (blobB64, checksum) = makeEncryptedBlob(services = listOf(remoteSvc))

        val transport = MockTransport()
        // Remote is currently at version 4
        transport.getResponses.add(GetResult.Success(version = 4, encryptedBlob = blobB64, checksum = checksum, etag = "etag-4"))
        transport.putResponses.add(PutResult.Success(version = 5, etag = "etag-5"))

        val local = FakeLocalState()
        // Local has a newer service
        local.localServices.add(ServiceEntry(name = "GitLab", site = "gitlab.com", email = testEmail, id = "id-remote", updatedAt = 3000L, synced = true))

        val manager = SyncManager(transport)
        val result = manager.sync(testSecret, testEmail, local)

        assertTrue(result is SyncResult.Success)
        val success = result as SyncResult.Success
        assertEquals("synced", success.status)
        assertEquals(5, success.version)
        assertEquals(5, local.getSyncVersion())

        // Verify PUT envelope has V_stored + 1 = 5
        assertEquals(1, transport.putCalls.size)
        val reqJson = JSONObject(transport.putCalls[0].body)
        assertEquals(5, reqJson.getInt("version"))
        assertEquals("etag-4", transport.putCalls[0].etag)
    }

    // --- 3. Client Dirty-Checking (Zero-Write on No-Op) ---

    @Test
    fun identicalStateSkipsPutEntirelyAndReturnsUnchanged() = runBlocking {
        val svc = ServiceEntry(name = "Google", site = "google.com", email = testEmail, id = "id-google", updatedAt = 1500L, synced = true)
        val (blobB64, checksum) = makeEncryptedBlob(services = listOf(svc))

        val transport = MockTransport()
        transport.getResponses.add(GetResult.Success(version = 8, encryptedBlob = blobB64, checksum = checksum, etag = "etag-8"))

        val local = FakeLocalState()
        local.localServices.add(svc.copy())
        local.setSyncVersion(7)

        val manager = SyncManager(transport)
        val result = manager.sync(testSecret, testEmail, local)

        assertTrue(result is SyncResult.Success)
        val success = result as SyncResult.Success
        assertEquals("unchanged", success.status)
        assertEquals(8, success.version)
        assertEquals(8, local.getSyncVersion())
        assertTrue(local.getLastSuccessfulSyncAt() > 0L)

        // ZERO PUT requests sent!
        assertEquals(0, transport.putCalls.size)
    }

    @Test
    fun pendingTombstoneForcesPutEvenIfEntitiesMatch() = runBlocking {
        val svc = ServiceEntry(name = "Google", site = "google.com", email = testEmail, id = "id-google", updatedAt = 1500L, synced = true)
        val deletedSvc = ServiceEntry(name = "Old", site = "old.com", email = testEmail, id = "id-deleted", updatedAt = 1000L, synced = true)
        // Remote currently still holds the deleted service
        val (blobB64, checksum) = makeEncryptedBlob(services = listOf(svc, deletedSvc))

        val transport = MockTransport()
        transport.getResponses.add(GetResult.Success(version = 8, encryptedBlob = blobB64, checksum = checksum, etag = "etag-8"))
        transport.putResponses.add(PutResult.Success(version = 9, etag = "etag-9"))

        val local = FakeLocalState()
        local.localServices.add(svc.copy())
        // Local has a pending tombstone for an entity that remote still holds
        local.localTombstones.add(Tombstone("id-deleted", 1600L))

        val manager = SyncManager(transport)
        val result = manager.sync(testSecret, testEmail, local)

        assertTrue(result is SyncResult.Success)
        val success = result as SyncResult.Success
        assertEquals("synced", success.status)
        // Tombstone was cleared on confirmed sync
        assertTrue(local.localTombstones.isEmpty())
        assertEquals(9, local.getSyncVersion())
        assertEquals(1, transport.putCalls.size)
    }

    // --- 4. HTTP 409 Conflict Retry Loop ---

    @Test
    fun conflictRetriesAndSucceedsWithIncrementedVersion() = runBlocking {
        val (initialBlob, initialChecksum) = makeEncryptedBlob(
            services = listOf(ServiceEntry(name = "Site", site = "site.com", email = testEmail, id = "s1", updatedAt = 100L, synced = true))
        )
        val (updatedBlob, updatedChecksum) = makeEncryptedBlob(
            services = listOf(
                ServiceEntry(name = "Site", site = "site.com", email = testEmail, id = "s1", updatedAt = 100L, synced = true),
                ServiceEntry(name = "RemotePeer", site = "peer.com", email = testEmail, id = "s2", updatedAt = 500L, synced = true)
            )
        )

        val transport = MockTransport()
        // 1st GET: remote version 3
        transport.getResponses.add(GetResult.Success(version = 3, encryptedBlob = initialBlob, checksum = initialChecksum, etag = "etag-3"))
        // 1st PUT: 409 Conflict!
        transport.putResponses.add(PutResult.Conflict(currentEtag = "etag-4", currentVersion = 4))
        // 2nd GET (on retry): remote updated to version 4 by another client
        transport.getResponses.add(GetResult.Success(version = 4, encryptedBlob = updatedBlob, checksum = updatedChecksum, etag = "etag-4"))
        // 2nd PUT: succeeds with version 5
        transport.putResponses.add(PutResult.Success(version = 5, etag = "etag-5"))

        val local = FakeLocalState()
        // Local has an edit on s1
        local.localServices.add(ServiceEntry(name = "Site", site = "site.com", email = testEmail, id = "s1", updatedAt = 600L, synced = true))

        val manager = SyncManager(transport)
        val result = manager.sync(testSecret, testEmail, local)

        assertTrue(result is SyncResult.Success)
        val success = result as SyncResult.Success
        assertEquals("synced", success.status)
        assertEquals(5, success.version)
        assertEquals(5, local.getSyncVersion())

        // 2 GET calls, 2 PUT calls
        assertEquals(2, transport.getCallCount)
        assertEquals(2, transport.putCalls.size)
        // 1st PUT attempted version 4
        assertEquals(4, JSONObject(transport.putCalls[0].body).getInt("version"))
        // 2nd PUT attempted version 5
        assertEquals(5, JSONObject(transport.putCalls[1].body).getInt("version"))
        // Both s1 and s2 exist in reconciled state
        assertEquals(2, success.services.size)
    }

    @Test
    fun conflictRetriesExhaustedReturnsConflict() = runBlocking {
        val (blobB64, checksum) = makeEncryptedBlob()

        val transport = MockTransport()
        for (i in 0 until 4) {
            transport.getResponses.add(GetResult.Success(version = 1 + i, encryptedBlob = blobB64, checksum = checksum, etag = "etag-$i"))
            transport.putResponses.add(PutResult.Conflict(currentEtag = "etag-conflict"))
        }

        val local = FakeLocalState()
        local.localServices.add(ServiceEntry(name = "S", site = "s.com", email = testEmail, id = "s1", updatedAt = 100L, synced = false))

        val manager = SyncManager(transport)
        val result = manager.sync(testSecret, testEmail, local)

        // Retries exhausted after 3 attempts -> returns SyncResult.Conflict
        assertEquals(SyncResult.Conflict, result)
        // 1 initial attempt + 3 retries = 4 PUT attempts
        assertEquals(4, transport.putCalls.size)
    }

    @Test
    fun conflictRetryConvergesToNoOpWhenRemoteAlreadyHoldsChanges() = runBlocking {
        val myService = ServiceEntry(name = "Same", site = "same.com", email = testEmail, id = "same-1", updatedAt = 500L, synced = false)
        val (staleBlob, staleChecksum) = makeEncryptedBlob()
        val (freshBlob, freshChecksum) = makeEncryptedBlob(services = listOf(myService.copy(synced = true)))

        val transport = MockTransport()
        // 1st GET: remote version 2 (stale, empty)
        transport.getResponses.add(GetResult.Success(version = 2, encryptedBlob = staleBlob, checksum = staleChecksum, etag = "etag-2"))
        // 1st PUT: 409 Conflict
        transport.putResponses.add(PutResult.Conflict(currentEtag = "etag-3", currentVersion = 3))
        // 2nd GET: remote version 3 already has myService (another client of mine pushed it)
        transport.getResponses.add(GetResult.Success(version = 3, encryptedBlob = freshBlob, checksum = freshChecksum, etag = "etag-3"))

        val local = FakeLocalState()
        local.localServices.add(myService.copy())

        val manager = SyncManager(transport)
        val result = manager.sync(testSecret, testEmail, local)

        assertTrue(result is SyncResult.Success)
        val success = result as SyncResult.Success
        // Reconciles and dirty check detects clean -> no second PUT!
        assertEquals("unchanged", success.status)
        assertEquals(3, success.version)
        assertEquals(1, transport.putCalls.size)
        assertEquals(2, transport.getCallCount)
        assertEquals(3, local.getSyncVersion())
    }
}
