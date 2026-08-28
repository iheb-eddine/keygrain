import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Validates the declarative v3 contract only. It deliberately does not call
 * SyncBlob, SyncManager, or any production parser/serializer: current Android runtime
 * support is not claimed by this fixture.
 */
private val UNORDERED_PAYLOAD_ARRAYS = setOf("services", "wallets", "wallet_audit_log", "sync_conflicts")

class SyncV3PreservationContractTest {
    private fun fixture(): JSONObject = JSONObject(fixtureFile().readText(Charsets.UTF_8))

    private fun fixtureFile(): File {
        var directory: File? = File(".").absoluteFile
        while (directory != null) {
            val candidate = File(directory, "sync-v3-preservation-vectors.json")
            if (candidate.isFile) return candidate
            directory = directory.parentFile
        }
        throw IllegalStateException("sync-v3-preservation-vectors.json not found")
    }

    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
    private fun bytes(value: String): ByteArray = ByteArray(value.length / 2) { i ->
        value.substring(i * 2, i * 2 + 2).toInt(16).toByte()
    }
    private fun sha256(bytes: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))

    private fun aad(envelope: JSONObject): String {
        val commitment = if (envelope.isNull("defaults_commitment")) "" else envelope.getString("defaults_commitment")
        return ("keygrain-sync-v3\u0000${envelope.getString("lookup_id")}\u0000" +
            "${envelope.getString("defaults_state")}\u0000$commitment")
            .toByteArray(Charsets.UTF_8).let(::hex)
    }

    private fun etag(envelope: JSONObject): String {
        val state = mapOf("UNSEALED" to 0, "ABSENT" to 1, "PRESENT" to 2).getValue(envelope.getString("defaults_state"))
        val commitment = if (envelope.isNull("defaults_commitment")) "" else envelope.getString("defaults_commitment")
        val blob = bytes(envelope.getString("blob_hex"))
        val out = ByteArrayOutputStream()
        DataOutputStream(out).use { data ->
            data.write("keygrain-sync-v3-etag\u0000".toByteArray(Charsets.UTF_8))
            data.writeInt(3)
            data.writeLong(envelope.getLong("generation"))
            data.writeByte(state)
            data.writeInt(commitment.length)
            data.write(commitment.toByteArray(Charsets.US_ASCII))
            data.writeLong(blob.size.toLong())
            data.write(blob)
        }
        return sha256(out.toByteArray()).take(32)
    }

    @Test
    fun fixtureIsFutureContractAndPartitionsAreDisjoint() {
        val fixture = fixture()
        assertEquals("keygrain-sync-v3-preservation-contract", fixture.getString("fixture"))
        assertEquals(1, fixture.getInt("fixture_version"))
        assertEquals("frozen_public_contract_not_runtime_support_claim", fixture.getString("status"))
        assertFalse(fixture.getBoolean("runtime_support"))
        val partitions = fixture.getJSONObject("partitions")
        val all = mutableSetOf<String>()
        for (category in listOf("encrypted_plaintext", "envelope_only", "local_only")) {
            val fields = partitions.getJSONArray(category)
            for (i in 0 until fields.length()) assertTrue(all.add(fields.getString(i)))
        }
    }

    @Test
    fun payloadShapeVersionAndDefaultsNullAreExplicit() {
        val cases = fixture().getJSONArray("cases")
        val expectedKeys = setOf("version", "services", "wallets", "wallet_audit_log", "account_defaults", "sync_conflicts")
        assertEquals(2, cases.length())
        for (i in 0 until cases.length()) {
            val payload = cases.getJSONObject(i).getJSONObject("encrypted_plaintext_source")
            val keys = mutableSetOf<String>()
            val iterator = payload.keys()
            while (iterator.hasNext()) keys += iterator.next()
            assertEquals(expectedKeys, keys)
            assertEquals(3, payload.getInt("version"))
            assertTrue(payload.has("account_defaults"))
            val services = payload.getJSONArray("services")
            for (j in 0 until services.length()) {
                val service = services.getJSONObject(j)
                assertTrue(service.getString("defaults_mode") in setOf("explicit", "snapshot"))
                if (!service.isNull("defaults_revision")) {
                    val revision = service.get("defaults_revision")
                    assertTrue(revision is Int || revision is Long)
                    assertTrue((revision as Number).toLong() in -9007199254740991L..9007199254740991L)
                }
            }
        }
        assertTrue(cases.getJSONObject(1).getJSONObject("encrypted_plaintext_source").isNull("account_defaults"))
        val conflict = cases.getJSONObject(0).getJSONObject("encrypted_plaintext_source")
            .getJSONArray("sync_conflicts").getJSONObject(0)
        val semanticKeys = setOf("schema", "length", "symbols", "policy")
        for (side in listOf("base", "local", "remote")) {
            val keys = mutableSetOf<String>()
            val iterator = conflict.getJSONObject(side).keys()
            while (iterator.hasNext()) keys += iterator.next()
            assertEquals(semanticKeys, keys)
        }
    }

    private fun jsonEquivalent(
        expected: Any?,
        actual: Any?,
        unorderedArray: Boolean = false,
        rootObject: Boolean = false
    ): Boolean {
        if (expected === JSONObject.NULL || actual === JSONObject.NULL) {
            return expected === JSONObject.NULL && actual === JSONObject.NULL
        }
        if (expected == null || actual == null) return expected == null && actual == null
        if (expected is JSONObject || actual is JSONObject) {
            if (expected !is JSONObject || actual !is JSONObject) return false
            val expectedKeys = mutableSetOf<String>()
            val expectedIterator = expected.keys()
            while (expectedIterator.hasNext()) expectedKeys += expectedIterator.next()
            val actualKeys = mutableSetOf<String>()
            val actualIterator = actual.keys()
            while (actualIterator.hasNext()) actualKeys += actualIterator.next()
            if (expectedKeys != actualKeys) return false
            for (key in expectedKeys) {
                val childUnordered = rootObject && key in UNORDERED_PAYLOAD_ARRAYS
                if (!jsonEquivalent(expected.get(key), actual.get(key), childUnordered)) return false
            }
            return true
        }
        if (expected is JSONArray || actual is JSONArray) {
            if (expected !is JSONArray || actual !is JSONArray || expected.length() != actual.length()) return false
            if (!unorderedArray) {
                for (i in 0 until expected.length()) {
                    if (!jsonEquivalent(expected.opt(i), actual.opt(i))) return false
                }
                return true
            }
            val matched = BooleanArray(actual.length())
            for (i in 0 until expected.length()) {
                var found = false
                for (j in 0 until actual.length()) {
                    if (!matched[j] && jsonEquivalent(expected.opt(i), actual.opt(j))) {
                        matched[j] = true
                        found = true
                        break
                    }
                }
                if (!found) return false
            }
            return true
        }
        if (expected is Number && actual is Number) return expected.toString() == actual.toString()
        return expected == actual
    }

    @Test
    fun literalCanonicalUtf8AndHexAreExact() {
        val cases = fixture().getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val canonical = case.getString("expected_canonical_utf8")
            assertTrue(
                "canonical literal does not represent encrypted_plaintext_source",
                jsonEquivalent(JSONObject(canonical), case.getJSONObject("encrypted_plaintext_source"), rootObject = true)
            )
            assertEquals(case.getString("expected_canonical_hex"), hex(canonical.toByteArray(Charsets.UTF_8)))
            assertFalse(canonical.any { it.code < 0x20 })
            assertTrue(canonical.startsWith("{\"account_defaults\":"))
            assertTrue(canonical.contains("\"version\":3"))
        }
    }

    @Test
    fun envelopeAadChecksumAndEtagAreIndependentContractValues() {
        val cases = fixture().getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val envelope = cases.getJSONObject(i).getJSONObject("server_envelope")
            assertEquals(3, envelope.getInt("payload_version"))
            assertEquals(3, envelope.getInt("writer_protocol"))
            assertEquals(3, envelope.getInt("min_writer_protocol"))
            assertEquals("account_defaults_immutable_v1", envelope.getJSONArray("capabilities").getString(0))
            assertEquals(envelope.getString("aad_hex"), aad(envelope))
            assertEquals(envelope.getString("checksum"), sha256(bytes(envelope.getString("blob_hex"))))
            assertEquals(envelope.getString("etag"), etag(envelope))
        }
    }

    @Test
    fun localOnlyFieldsDoNotAppearInCanonicalPayloadBytes() {
        val cases = fixture().getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val canonical = cases.getJSONObject(i).getString("expected_canonical_utf8")
            for (field in listOf("payload_version", "defaults_state", "defaults_commitment", "generation", "tombstones", "deletion_review", "security_settings")) {
                assertFalse(canonical.contains("\"$field\""))
            }
        }
    }

    @Test
    fun escapingContractIncludesAllRequiredEdgeValues() {
        val expected = fixture().getJSONArray("cases").getJSONObject(0).getString("expected_canonical_utf8")
        for (token in listOf("\\b", "\\t", "\\n", "\\f", "\\r", "\u2028", "\u2029", "😀", "\\ud800")) {
            assertNotNull(token)
            assertTrue("missing $token", expected.contains(token))
        }
    }
}
