package com.secbytech.keygrain.data

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Base64

class SyncDefaultsTest {
    private fun hexToBytes(hex: String): ByteArray {
        require(hex.length % 2 == 0)
        return ByteArray(hex.length / 2) { i ->
            hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
    }

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun validDefaults() = AccountDefaults(
        schema = 1,
        length = 20,
        symbols = "!@#\$%&*-_=+?",
        policy = "ascii-printable-v1"
    )

    @Test
    fun canonicalJsonIsSortedCompactAndEscaped() {
        val escaped = AccountDefaults(
            schema = 1,
            length = 32,
            symbols = "\"\\!",
            policy = "ascii-printable-v1"
        )
        assertEquals(
            "{\"length\":32,\"policy\":\"ascii-printable-v1\",\"schema\":1,\"symbols\":\"\\\"\\\\!\"}",
            escaped.canonicalJson()
        )
    }

    @Test
    fun defaultsRejectInvalidValuesWithoutCoercion() {
        assertThrows(IllegalArgumentException::class.java) {
            AccountDefaults(2, 20, "!", "ascii-printable-v1")
        }
        assertThrows(IllegalArgumentException::class.java) {
            AccountDefaults(1, 7, "!", "ascii-printable-v1")
        }
        assertThrows(IllegalArgumentException::class.java) {
            AccountDefaults(1, 129, "!", "ascii-printable-v1")
        }
        assertThrows(IllegalArgumentException::class.java) {
            AccountDefaults(1, 20, "!", "ascii-printable-v2")
        }
        assertThrows(IllegalArgumentException::class.java) {
            AccountDefaults(1, 20, "", "ascii-printable-v1")
        }
        assertThrows(IllegalArgumentException::class.java) {
            AccountDefaults(1, 20, "bad space", "ascii-printable-v1")
        }
        assertThrows(IllegalArgumentException::class.java) {
            AccountDefaults(1, 20, "\u007f", "ascii-printable-v1")
        }
        assertThrows(IllegalArgumentException::class.java) {
            AccountDefaults(1, 20, "!".repeat(203), "ascii-printable-v1")
        }
    }

    @Test
    fun commitmentMatchesExtensionVectorAndDoesNotMutateCallerKey() {
        val key = hexToBytes(
            "d7b935b8298f476c6046cb71501fcb8c9a53327df3cc4e05c696fea7ef3d035a"
        )
        val original = key.copyOf()
        val expected = "44d37dd56a969d6e4f88886827063e9cbcf44576e8b606e24e588e94e809296f"

        assertEquals(expected, SyncDefaults.deriveDefaultsCommitment(key, "test@gmail.com", validDefaults()))
        assertArrayEquals(original, key)
        assertNotEquals(expected, SyncDefaults.deriveDefaultsCommitment(key, "other@gmail.com", validDefaults()))
        assertNotEquals(
            expected,
            SyncDefaults.deriveDefaultsCommitment(
                key,
                "test@gmail.com",
                validDefaults().copy(length = 21)
            )
        )
    }

    @Test
    fun commitmentRejectsWrongKeyLengthAndNonNormalizedEmails() {
        val key = hexToBytes(
            "d7b935b8298f476c6046cb71501fcb8c9a53327df3cc4e05c696fea7ef3d035a"
        )
        for (badKey in listOf(ByteArray(31), ByteArray(33))) {
            assertThrows(IllegalArgumentException::class.java) {
                SyncDefaults.deriveDefaultsCommitment(badKey, "test@gmail.com", validDefaults())
            }
        }
        for (badEmail in listOf(
            "Test@gmail.com",
            " test@gmail.com",
            "test@gmail.com ",
            "test@例子.com",
            "test@x.com\u0000",
            "test@x.com\uD800",
            "a".repeat(249) + "@x.com"
        )) {
            assertThrows(IllegalArgumentException::class.java) {
                SyncDefaults.deriveDefaultsCommitment(key, badEmail, validDefaults())
            }
        }
    }

    @Test
    fun v3AadMatchesExactLiteralUtf8BytesForEveryState() {
        val lookupId = "0123456789abcdef".repeat(4)
        val commitment = "ab".repeat(32)
        val expected = mapOf(
            DefaultsState.UNSEALED to "6b6579677261696e2d73796e632d7633003031323334353637383961626364656630313233343536373839616263646566303132333435363738396162636465663031323334353637383961626364656600554e5345414c454400",
            DefaultsState.ABSENT to "6b6579677261696e2d73796e632d7633003031323334353637383961626364656630313233343536373839616263646566303132333435363738396162636465663031323334353637383961626364656600414253454e5400",
            DefaultsState.PRESENT to "6b6579677261696e2d73796e632d763300303132333435363738396162636465663031323334353637383961626364656630313233343536373839616263646566303132333435363738396162636465660050524553454e540061626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162"
        )
        for ((stateAndCommitment, expectedHex) in listOf(
            (DefaultsState.UNSEALED to null) to expected.getValue(DefaultsState.UNSEALED),
            (DefaultsState.ABSENT to null) to expected.getValue(DefaultsState.ABSENT),
            (DefaultsState.PRESENT to commitment) to expected.getValue(DefaultsState.PRESENT)
        )) {
            val (state, commitmentArg) = stateAndCommitment
            val aad = SyncDefaults.buildV3SyncAAD(lookupId, state, commitmentArg)
            assertEquals(expectedHex, bytesToHex(aad))
            aad[0] = (aad[0].toInt() xor 0xff).toByte()
            assertEquals(expectedHex, bytesToHex(SyncDefaults.buildV3SyncAAD(lookupId, state, commitmentArg)))
        }
    }

    @Test
    fun v3AadRejectsMalformedLookupAndStateCommitmentTuples() {
        val lookupId = "0123456789abcdef".repeat(4)
        val commitment = "ab".repeat(32)
        for (badLookup in listOf(
            "", lookupId.uppercase(), lookupId.drop(1), lookupId + "0",
            lookupId.dropLast(1) + "!", lookupId.substring(0, 32) + "\u0000" + lookupId.substring(33)
        )) {
            assertThrows(IllegalArgumentException::class.java) {
                SyncDefaults.buildV3SyncAAD(badLookup, DefaultsState.ABSENT, null)
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            SyncDefaults.buildV3SyncAAD(lookupId, DefaultsState.PRESENT, null)
        }
        assertThrows(IllegalArgumentException::class.java) {
            SyncDefaults.buildV3SyncAAD(lookupId, DefaultsState.PRESENT, commitment.uppercase())
        }
        assertThrows(IllegalArgumentException::class.java) {
            SyncDefaults.buildV3SyncAAD(lookupId, DefaultsState.PRESENT, commitment.drop(1))
        }
        assertThrows(IllegalArgumentException::class.java) {
            SyncDefaults.buildV3SyncAAD(lookupId, DefaultsState.PRESENT, commitment + "0")
        }
        assertThrows(IllegalArgumentException::class.java) {
            SyncDefaults.buildV3SyncAAD(lookupId, DefaultsState.UNSEALED, "")
        }
        assertThrows(IllegalArgumentException::class.java) {
            SyncDefaults.buildV3SyncAAD(lookupId, DefaultsState.ABSENT, commitment)
        }
    }

    @Test
    fun v2DerivationsAndLookupIdOnlyAadRemainAnchored() {
        val fixture = fixture()
        val secret = fixture.getString("secret").toByteArray(Charsets.UTF_8)
        val email = fixture.getString("email")
        Keygrain.clearStrengthenCache()

        assertEquals(fixture.getString("lookup_id"), Keygrain.deriveLookupId(secret, email))
        assertEquals(fixture.getString("auth_password"), Keygrain.deriveAuthPassword(secret, email))
        assertEquals(
            fixture.getString("encryption_key_hex"),
            bytesToHex(Keygrain.deriveEncryptionKey(secret, email))
        )

        val lookupId = Keygrain.deriveLookupId(secret, email)
        val blob = Base64.getDecoder().decode(
            fixture.getJSONObject("server_response").getString("encrypted_blob")
        )
        val plaintext = SyncCrypto.decrypt(
            Keygrain.deriveEncryptionKey(secret, email),
            blob,
            lookupId.toByteArray(Charsets.UTF_8)
        )
        assertEquals(
            fixture.getJSONArray("services").length(),
            JSONObject(String(plaintext, Charsets.UTF_8)).getJSONArray("services").length()
        )
    }

    private fun fixtureFile(): File {
        val primary = File("../../sync-vectors.json")
        if (primary.exists()) return primary
        var directory: File? = File(".").absoluteFile
        while (directory != null) {
            val candidate = File(directory, "sync-vectors.json")
            if (candidate.exists() && File(directory, "vectors.json").exists()) return candidate
            directory = directory.parentFile
        }
        throw IllegalStateException("sync-vectors.json not found")
    }

    private fun fixture(): JSONObject = JSONObject(fixtureFile().readText())
}
