package com.secbytech.keygrain.data

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncCapabilityContractTest {
    @Test
    fun absentCapabilityFieldsRemainLegacy() {
        assertEquals(
            CapabilityMetadataClassification.LegacyAbsent,
            CapabilityMetadataClassifier.classify(JSONObject("{\"services\":[]}"))
        )
    }

    @Test
    fun completeStrictEnvelopeIsClassifiedStrict() {
        assertEquals(
            CapabilityMetadataClassification.Strict,
            CapabilityMetadataClassifier.classify(
                JSONObject("""{"payload_version":3,"min_writer_protocol":3,"capabilities":["account_defaults_immutable_v1"]}""")
            )
        )
    }

    @Test
    fun presentSubsetIsPartial() {
        assertEquals(
            CapabilityMetadataClassification.Partial,
            CapabilityMetadataClassifier.classify(JSONObject("{\"payload_version\":3}"))
        )
    }

    @Test
    fun nullFloatingPointAndMixedCapabilityValuesAreMalformed() {
        val cases = listOf(
            "{\"payload_version\":null,\"min_writer_protocol\":3,\"capabilities\":[]}",
            "{\"payload_version\":3.0,\"min_writer_protocol\":3,\"capabilities\":[]}",
            "{\"payload_version\":3,\"min_writer_protocol\":3,\"capabilities\":[\"ok\",4]}"
        )
        cases.forEach { json ->
            assertEquals(
                json,
                CapabilityMetadataClassification.Malformed,
                CapabilityMetadataClassifier.classify(JSONObject(json))
            )
        }
    }

    @Test
    fun minimumWriterThreeWithContradictoryTupleIsContradictory() {
        assertEquals(
            CapabilityMetadataClassification.Contradictory,
            CapabilityMetadataClassifier.classify(
                JSONObject("""{"payload_version":2,"min_writer_protocol":3,"capabilities":[]}""")
            )
        )
    }

    @Test
    fun completeWrongTupleIsUnsupported() {
        assertEquals(
            CapabilityMetadataClassification.Unsupported,
            CapabilityMetadataClassifier.classify(
                JSONObject("""{"payload_version":2,"min_writer_protocol":2,"capabilities":["other"]}""")
            )
        )
    }

    @Test
    fun strictTupleWithExtraCapabilityTokenIsContradictory() {
        assertEquals(
            CapabilityMetadataClassification.Contradictory,
            CapabilityMetadataClassifier.classify(
                JSONObject("""{"payload_version":3,"min_writer_protocol":3,"capabilities":["account_defaults_immutable_v1","unexpected"]}""")
            )
        )
    }

    @Test
    fun get426MapsToTypedUpgradeRequired() {
        SingleResponseServer(426, "Upgrade Required", "server details").use { server ->
            val result = SyncTransport("http://127.0.0.1:${server.port}")
                .doGet("lookup", "Basic auth")
            assertEquals(
                GetResult.UpgradeRequired(UpgradeRequiredReason.Http426),
                result
            )
        }
    }

    @Test
    fun incompatibleMetadataIsRejectedBeforeBlobFieldsAreRead() {
        val body = """{"payload_version":3,"min_writer_protocol":3,"capabilities":["account_defaults_immutable_v1"]}"""
        SingleResponseServer(200, "OK", body).use { server ->
            val result = SyncTransport("http://127.0.0.1:${server.port}")
                .doGet("lookup", "Basic auth")
            assertTrue(result is GetResult.UpgradeRequired)
            assertEquals(
                UpgradeRequiredReason.StrictMetadata,
                (result as GetResult.UpgradeRequired).reason
            )
        }
    }


    @Test
    fun managerStopsAfterIncompatibleGetWithoutCallingPut() {
        val transport = CountingTransport(
            GetResult.UpgradeRequired(UpgradeRequiredReason.StrictMetadata)
        )
        val result = kotlinx.coroutines.runBlocking {
            SyncManager(transport).syncWithoutLocalStateForTesting(
                "secret".toByteArray(), "user@example.com"
            )
        }
        assertEquals(SyncResult.UpgradeRequired, result)
        assertEquals(0, transport.putCalls)
    }

    @Test
    fun put426MapsToTypedUpgradeRequired() {
        SingleResponseServer(426, "Upgrade Required", "server details").use { server ->
            val result = SyncTransport("http://127.0.0.1:${server.port}")
                .doPut("lookup", "Basic auth", "{}", null)
            assertEquals(PutResult.UpgradeRequired(), result)
        }
    }


    private class CountingTransport(private val getResult: GetResult) : SyncTransportApi {
        var putCalls: Int = 0

        override fun doGet(lookupId: String, authHeader: String): GetResult = getResult

        override fun doPut(
            lookupId: String,
            authHeader: String,
            body: String,
            etag: String?
        ): PutResult {
            putCalls++
            throw AssertionError("PUT must not run after an incompatible GET")
        }

        override fun doDelete(lookupId: String, authHeader: String): DeleteResult =
            throw AssertionError("delete is not part of sync")
    }

    private class SingleResponseServer(
        private val status: Int,
        private val reason: String,
        private val body: String
    ) : AutoCloseable {
        private val socket = ServerSocket(0, 0, java.net.InetAddress.getByName("127.0.0.1"))
        val port: Int get() = socket.localPort
        private val thread = Thread {
            try {
                socket.accept().use { client ->
                    val reader = BufferedReader(InputStreamReader(client.getInputStream()))
                    while (reader.readLine()?.isNotEmpty() == true) { }
                    val bytes = body.toByteArray()
                    val response = "HTTP/1.1 $status $reason\r\n" +
                        "Content-Type: application/json\r\n" +
                        "Content-Length: ${bytes.size}\r\n" +
                        "Connection: close\r\n\r\n"
                    client.getOutputStream().use { output ->
                        output.write(response.toByteArray())
                        output.write(bytes)
                        output.flush()
                    }
                }
            } catch (_: Exception) {
                // Closing the server during teardown may interrupt accept/read.
            }
        }.apply { isDaemon = true; start() }

        override fun close() {
            try { socket.close() } catch (_: Exception) { }
            thread.join(2000)
        }
    }
}
