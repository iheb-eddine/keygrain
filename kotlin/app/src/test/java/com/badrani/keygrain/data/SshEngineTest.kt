package com.badrani.keygrain.data

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File
import java.util.Base64

class SshEngineTest {

    private fun hexToBytes(hex: String): ByteArray =
        hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun loadVectors(): JSONObject {
        val file = File("../../ssh-vectors.json")
        return JSONObject(file.readText())
    }

    // --- Derivation Vectors ---

    @Test
    fun testDerivationVectors() {
        val json = loadVectors()
        val vectors = json.getJSONObject("derivation_vectors").getJSONArray("vectors")

        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            val secret = hexToBytes(v.getString("secret_hex"))
            val email = v.getString("email")
            val keyName = v.getString("key_name")
            val counter = v.getInt("counter")
            val expectedSeed = v.getString("seed_hex")
            val expectedPubKey = v.getString("public_key_hex")

            Keygrain.clearStrengthenCache()
            val result = SshEngine.deriveSshKeypair(secret, email, keyName, counter)

            assertEquals(
                "Seed mismatch: keyName=$keyName counter=$counter",
                expectedSeed, bytesToHex(result.seed)
            )
            assertEquals(
                "Public key mismatch: keyName=$keyName counter=$counter",
                expectedPubKey, bytesToHex(result.publicKey)
            )
        }
    }

    // --- Case Normalization ---

    @Test
    fun testCaseNormalization() {
        val secret = hexToBytes("6d792d6d61737465722d736563726574")
        Keygrain.clearStrengthenCache()
        val a = SshEngine.deriveSshKeypair(secret, "test@gmail.com", "github", 1)
        Keygrain.clearStrengthenCache()
        val b = SshEngine.deriveSshKeypair(secret, "TEST@Gmail.com", "GitHub", 1)
        assertArrayEquals("Seed case normalization", a.seed, b.seed)
        assertArrayEquals("Public key case normalization", a.publicKey, b.publicKey)
    }

    @Test
    fun testDifferentKeyNameProducesDifferentKey() {
        val secret = hexToBytes("6d792d6d61737465722d736563726574")
        Keygrain.clearStrengthenCache()
        val a = SshEngine.deriveSshKeypair(secret, "test@gmail.com", "github", 1)
        Keygrain.clearStrengthenCache()
        val b = SshEngine.deriveSshKeypair(secret, "test@gmail.com", "work-servers", 1)
        assertFalse("Different key_name must produce different seed", a.seed.contentEquals(b.seed))
    }

    @Test
    fun testCounterRotationProducesDifferentKey() {
        val secret = hexToBytes("6d792d6d61737465722d736563726574")
        Keygrain.clearStrengthenCache()
        val a = SshEngine.deriveSshKeypair(secret, "test@gmail.com", "github", 1)
        Keygrain.clearStrengthenCache()
        val b = SshEngine.deriveSshKeypair(secret, "test@gmail.com", "github", 2)
        assertFalse("Counter rotation must produce different seed", a.seed.contentEquals(b.seed))
    }

    // --- Authorized Keys Format Verification ---

    @Test
    fun testAuthorizedKeysFormat() {
        val json = loadVectors()
        val vectors = json.getJSONObject("derivation_vectors").getJSONArray("vectors")

        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            val expectedAuthKeys = v.getString("authorized_keys")
            val publicKey = hexToBytes(v.getString("public_key_hex"))

            // Manually construct authorized_keys (since formatAuthorizedKeys uses android.util.Base64)
            val keyType = "ssh-ed25519".toByteArray(Charsets.UTF_8)
            val blob = ByteArray(4 + keyType.size + 4 + publicKey.size)
            var offset = 0
            blob[offset] = (keyType.size shr 24 and 0xFF).toByte()
            blob[offset + 1] = (keyType.size shr 16 and 0xFF).toByte()
            blob[offset + 2] = (keyType.size shr 8 and 0xFF).toByte()
            blob[offset + 3] = (keyType.size and 0xFF).toByte()
            offset += 4
            keyType.copyInto(blob, offset); offset += keyType.size
            blob[offset] = (publicKey.size shr 24 and 0xFF).toByte()
            blob[offset + 1] = (publicKey.size shr 16 and 0xFF).toByte()
            blob[offset + 2] = (publicKey.size shr 8 and 0xFF).toByte()
            blob[offset + 3] = (publicKey.size and 0xFF).toByte()
            offset += 4
            publicKey.copyInto(blob, offset)

            val b64 = Base64.getEncoder().encodeToString(blob)
            val comment = "${v.getString("email").lowercase()}:${v.getString("key_name").lowercase()}"
            val actual = "ssh-ed25519 $b64 $comment"

            assertEquals(
                "Authorized keys mismatch for vector ${i + 1}",
                expectedAuthKeys, actual
            )
        }
    }

    // --- Input Validation ---

    @Test(expected = IllegalArgumentException::class)
    fun testRejectEmptyKeyName() {
        SshEngine.deriveSshKeypair("secret".toByteArray(), "a@b.com", "", 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testRejectWhitespaceInKeyName() {
        SshEngine.deriveSshKeypair("secret".toByteArray(), "a@b.com", "my key", 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testRejectCounterLessThanOne() {
        SshEngine.deriveSshKeypair("secret".toByteArray(), "a@b.com", "github", 0)
    }
}
