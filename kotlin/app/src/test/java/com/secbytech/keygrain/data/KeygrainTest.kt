package com.secbytech.keygrain.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import java.io.File

class KeygrainTest {

    private fun hexToBytes(hex: String): ByteArray =
        hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun loadVectors(): JSONObject {
        val file = File("../../vectors.json")
        return JSONObject(file.readText())
    }

    @Test
    fun testStrengthenVectors() {
        val vectors = loadVectors().getJSONArray("strengthen_vectors")
        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            Keygrain.clearStrengthenCache()
            val result = Keygrain.strengthenSecret(hexToBytes(v.getString("secret_hex")), v.getString("email"))
            assertEquals(
                "Failed for email=${v.getString("email")}",
                v.getString("expected_hex"),
                bytesToHex(result)
            )
        }
    }

    @Test
    fun testAllVectors() {
        val vectors = loadVectors().getJSONArray("vectors")
        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            Keygrain.clearStrengthenCache()
            val result = Keygrain.derivePassword(
                secret = hexToBytes(v.getString("secret_hex")),
                email = v.getString("email"),
                site = v.getString("site"),
                length = v.getInt("length"),
                symbols = v.getString("symbols"),
                counter = v.getInt("counter")
            )
            assertEquals(
                "Failed for site=${v.getString("site")} email=${v.getString("email")} (len=${v.getInt("length")}, counter=${v.getInt("counter")})",
                v.getString("expected"),
                result
            )
        }
    }

    @Test
    fun testDeterministic() {
        val a = Keygrain.derivePassword("secret".toByteArray(), "x@y.com", "y.com")
        val b = Keygrain.derivePassword("secret".toByteArray(), "x@y.com", "y.com")
        assertEquals(a, b)
    }

    @Test
    fun testCaseInsensitiveEmail() {
        val a = Keygrain.derivePassword("secret".toByteArray(), "User@Example.COM", "example.com")
        val b = Keygrain.derivePassword("secret".toByteArray(), "user@example.com", "example.com")
        assertEquals(a, b)
    }

    @Test
    fun testCaseInsensitiveSite() {
        val a = Keygrain.derivePassword("secret".toByteArray(), "x@y.com", "GitHub.com")
        val b = Keygrain.derivePassword("secret".toByteArray(), "x@y.com", "github.com")
        assertEquals(a, b)
    }

    @Test
    fun testDifferentSiteDifferentOutput() {
        val a = Keygrain.derivePassword("secret".toByteArray(), "x@y.com", "github.com")
        val b = Keygrain.derivePassword("secret".toByteArray(), "x@y.com", "google.com")
        assertNotEquals(a, b)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testMinLengthRejected() {
        Keygrain.derivePassword("secret".toByteArray(), "a@b.com", "x.com", length = 7)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testMaxLengthRejected() {
        Keygrain.derivePassword("secret".toByteArray(), "a@b.com", "x.com", length = 129)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testEmptySymbolsRejected() {
        Keygrain.derivePassword("secret".toByteArray(), "a@b.com", "x.com", symbols = "")
    }

    @Test(expected = IllegalArgumentException::class)
    fun testEmptySiteRejected() {
        Keygrain.derivePassword("secret".toByteArray(), "a@b.com", "")
    }

    @Test
    fun testStrengthenCacheSameEmailDifferentSecret() {
        // Cache keys on email but must validate the secret — a different secret
        // under the same email must NOT return the previously cached result.
        Keygrain.clearStrengthenCache()
        val a = Keygrain.strengthenSecret("secretA".toByteArray(), "user@example.com")
        val b = Keygrain.strengthenSecret("secretB".toByteArray(), "user@example.com")
        assertNotEquals(bytesToHex(a), bytesToHex(b))
        val a2 = Keygrain.strengthenSecret("secretA".toByteArray(), "user@example.com")
        assertEquals(bytesToHex(a), bytesToHex(a2))
    }

    @Test
    fun testStrengthenCacheMultiEmailStable() {
        // More distinct emails than cache capacity forces LRU eviction; results
        // must stay correct and distinct regardless of eviction order.
        Keygrain.clearStrengthenCache()
        val emails = (1..12).map { "user$it@example.com" }
        val secret = "master-secret".toByteArray()
        val first = emails.associateWith { bytesToHex(Keygrain.strengthenSecret(secret, it)) }
        assertEquals(emails.size, first.values.toSet().size)
        for (e in emails.reversed()) {
            assertEquals(first[e], bytesToHex(Keygrain.strengthenSecret(secret, e)))
        }
    }
}
