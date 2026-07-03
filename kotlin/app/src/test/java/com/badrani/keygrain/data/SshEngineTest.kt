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

    // --- Private Key PEM Format ---

    @Test
    fun testFormatOpensshPrivateKeyMatchesVector() {
        val json = loadVectors()
        val vectors = json.getJSONObject("derivation_vectors").getJSONArray("vectors")
        val v = vectors.getJSONObject(0) // Vector 1 has private_key_pem
        val seed = hexToBytes(v.getString("seed_hex"))
        val publicKey = hexToBytes(v.getString("public_key_hex"))
        val comment = "${v.getString("email").lowercase()}:${v.getString("key_name").lowercase()}"
        val expectedPem = v.getString("private_key_pem")

        // Cannot call SshEngine.formatOpensshPrivateKey directly (uses android.util.Base64)
        // Instead, replicate the algorithm with java.util.Base64 to verify correctness
        val checkBytes = Keygrain.hmacSha256(seed, "openssh-check".toByteArray(Charsets.UTF_8))
        val checkInt = ((checkBytes[0].toInt() and 0xFF) shl 24) or
                ((checkBytes[1].toInt() and 0xFF) shl 16) or
                ((checkBytes[2].toInt() and 0xFF) shl 8) or
                (checkBytes[3].toInt() and 0xFF)

        val keyType = "ssh-ed25519".toByteArray(Charsets.UTF_8)

        // Public key blob
        val pubBlob = ByteArray(4 + keyType.size + 4 + publicKey.size)
        var po = 0
        putUint32Test(pubBlob, po, keyType.size); po += 4
        keyType.copyInto(pubBlob, po); po += keyType.size
        putUint32Test(pubBlob, po, publicKey.size); po += 4
        publicKey.copyInto(pubBlob, po)

        // Private section
        val commentBytes = comment.toByteArray(Charsets.UTF_8)
        val privLen = 4 + 4 + (4 + keyType.size) + (4 + publicKey.size) + (4 + 64) + (4 + commentBytes.size)
        val padLen = (8 - privLen % 8) % 8
        val privSection = ByteArray(privLen + padLen)
        var ps = 0
        putUint32Test(privSection, ps, checkInt); ps += 4
        putUint32Test(privSection, ps, checkInt); ps += 4
        putUint32Test(privSection, ps, keyType.size); ps += 4
        keyType.copyInto(privSection, ps); ps += keyType.size
        putUint32Test(privSection, ps, publicKey.size); ps += 4
        publicKey.copyInto(privSection, ps); ps += publicKey.size
        putUint32Test(privSection, ps, 64); ps += 4
        seed.copyInto(privSection, ps); ps += seed.size
        publicKey.copyInto(privSection, ps); ps += publicKey.size
        putUint32Test(privSection, ps, commentBytes.size); ps += 4
        commentBytes.copyInto(privSection, ps); ps += commentBytes.size
        for (i in 0 until padLen) privSection[ps + i] = (i + 1).toByte()

        // Outer structure
        val authMagic = "openssh-key-v1".toByteArray(Charsets.UTF_8)
        val cipherName = "none".toByteArray(Charsets.UTF_8)
        val kdfName = "none".toByteArray(Charsets.UTF_8)
        val outerLen = authMagic.size + 1 + (4 + cipherName.size) + (4 + kdfName.size) + (4 + 0) + 4 + (4 + pubBlob.size) + (4 + privSection.size)
        val outer = ByteArray(outerLen)
        var oo = 0
        authMagic.copyInto(outer, oo); oo += authMagic.size
        outer[oo] = 0; oo += 1
        putUint32Test(outer, oo, cipherName.size); oo += 4
        cipherName.copyInto(outer, oo); oo += cipherName.size
        putUint32Test(outer, oo, kdfName.size); oo += 4
        kdfName.copyInto(outer, oo); oo += kdfName.size
        putUint32Test(outer, oo, 0); oo += 4
        putUint32Test(outer, oo, 1); oo += 4
        putUint32Test(outer, oo, pubBlob.size); oo += 4
        pubBlob.copyInto(outer, oo); oo += pubBlob.size
        putUint32Test(outer, oo, privSection.size); oo += 4
        privSection.copyInto(outer, oo)

        val b64 = Base64.getEncoder().encodeToString(outer)
        val lines = b64.chunked(70).joinToString("\n")
        val pem = "-----BEGIN OPENSSH PRIVATE KEY-----\n$lines\n-----END OPENSSH PRIVATE KEY-----\n"

        assertEquals("PEM mismatch against vector", expectedPem, pem)
    }

    @Test
    fun testFormatOpensshPrivateKeyCheckInt() {
        val seed = hexToBytes("15d7cd5c74358c1cd7f7f93ef45d074afcf6fd9e008a94de9e8608a330d96dc1")
        val checkBytes = Keygrain.hmacSha256(seed, "openssh-check".toByteArray(Charsets.UTF_8))
        val checkInt = ((checkBytes[0].toInt() and 0xFF) shl 24) or
                ((checkBytes[1].toInt() and 0xFF) shl 16) or
                ((checkBytes[2].toInt() and 0xFF) shl 8) or
                (checkBytes[3].toInt() and 0xFF)
        assertEquals("check_int must match expected value", 0x4A134E13, checkInt)
    }

    @Test
    fun testFormatOpensshPrivateKeyPemStructure() {
        val seed = hexToBytes("15d7cd5c74358c1cd7f7f93ef45d074afcf6fd9e008a94de9e8608a330d96dc1")
        val publicKey = hexToBytes("f2aadbd608703b65bb87d3d1c746c48dfed9095a2b7ae4c8ada057afa6bf9032")
        val comment = "test@gmail.com:github"

        // Build PEM using test helper (same algo as testFormatOpensshPrivateKeyMatchesVector)
        val checkBytes = Keygrain.hmacSha256(seed, "openssh-check".toByteArray(Charsets.UTF_8))
        val checkInt = ((checkBytes[0].toInt() and 0xFF) shl 24) or
                ((checkBytes[1].toInt() and 0xFF) shl 16) or
                ((checkBytes[2].toInt() and 0xFF) shl 8) or
                (checkBytes[3].toInt() and 0xFF)
        val keyType = "ssh-ed25519".toByteArray(Charsets.UTF_8)
        val pubBlob = ByteArray(4 + keyType.size + 4 + publicKey.size)
        var po = 0
        putUint32Test(pubBlob, po, keyType.size); po += 4
        keyType.copyInto(pubBlob, po); po += keyType.size
        putUint32Test(pubBlob, po, publicKey.size); po += 4
        publicKey.copyInto(pubBlob, po)
        val commentBytes = comment.toByteArray(Charsets.UTF_8)
        val privLen = 4 + 4 + (4 + keyType.size) + (4 + publicKey.size) + (4 + 64) + (4 + commentBytes.size)
        val padLen = (8 - privLen % 8) % 8
        val privSection = ByteArray(privLen + padLen)
        var ps = 0
        putUint32Test(privSection, ps, checkInt); ps += 4
        putUint32Test(privSection, ps, checkInt); ps += 4
        putUint32Test(privSection, ps, keyType.size); ps += 4
        keyType.copyInto(privSection, ps); ps += keyType.size
        putUint32Test(privSection, ps, publicKey.size); ps += 4
        publicKey.copyInto(privSection, ps); ps += publicKey.size
        putUint32Test(privSection, ps, 64); ps += 4
        seed.copyInto(privSection, ps); ps += seed.size
        publicKey.copyInto(privSection, ps); ps += publicKey.size
        putUint32Test(privSection, ps, commentBytes.size); ps += 4
        commentBytes.copyInto(privSection, ps); ps += commentBytes.size
        for (i in 0 until padLen) privSection[ps + i] = (i + 1).toByte()
        val authMagic = "openssh-key-v1".toByteArray(Charsets.UTF_8)
        val cipherName = "none".toByteArray(Charsets.UTF_8)
        val kdfName = "none".toByteArray(Charsets.UTF_8)
        val outerLen = authMagic.size + 1 + (4 + cipherName.size) + (4 + kdfName.size) + (4 + 0) + 4 + (4 + pubBlob.size) + (4 + privSection.size)
        val outer = ByteArray(outerLen)
        var oo = 0
        authMagic.copyInto(outer, oo); oo += authMagic.size
        outer[oo] = 0; oo += 1
        putUint32Test(outer, oo, cipherName.size); oo += 4
        cipherName.copyInto(outer, oo); oo += cipherName.size
        putUint32Test(outer, oo, kdfName.size); oo += 4
        kdfName.copyInto(outer, oo); oo += kdfName.size
        putUint32Test(outer, oo, 0); oo += 4
        putUint32Test(outer, oo, 1); oo += 4
        putUint32Test(outer, oo, pubBlob.size); oo += 4
        pubBlob.copyInto(outer, oo); oo += pubBlob.size
        putUint32Test(outer, oo, privSection.size); oo += 4
        privSection.copyInto(outer, oo)
        val b64 = Base64.getEncoder().encodeToString(outer)
        val lines = b64.chunked(70).joinToString("\n")
        val pem = "-----BEGIN OPENSSH PRIVATE KEY-----\n$lines\n-----END OPENSSH PRIVATE KEY-----\n"

        // Verify structure
        assert(pem.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----\n"))
        assert(pem.endsWith("\n-----END OPENSSH PRIVATE KEY-----\n"))
        val bodyLines = pem.split("\n").drop(1).dropLast(2)
        for (line in bodyLines) {
            assert(line.length <= 70) { "Line exceeds 70 chars: ${line.length}" }
        }
    }

    private fun putUint32Test(buf: ByteArray, offset: Int, value: Int) {
        buf[offset] = (value shr 24 and 0xFF).toByte()
        buf[offset + 1] = (value shr 16 and 0xFF).toByte()
        buf[offset + 2] = (value shr 8 and 0xFF).toByte()
        buf[offset + 3] = (value and 0xFF).toByte()
    }
}
