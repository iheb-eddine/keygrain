package com.badrani.keygrain.data

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class KeygrainTest {

    data class Vector(
        val secretHex: String,
        val site: String,
        val email: String,
        val length: Int,
        val symbols: String,
        val counter: Int,
        val expected: String
    )

    private val vectors = listOf(
        Vector("6d792d6d61737465722d736563726574", "github.com", "test@gmail.com", 20, "!@#\$%&*-_=+?", 1, "A=4BXNAHYUU_hmVwv\$h?"),
        Vector("6d792d6d61737465722d736563726574", "google.com", "test@gmail.com", 20, "!@#\$%&*-_=+?", 1, "=78WtX?e!hpp6?TMqddW"),
        Vector("6d792d6d61737465722d736563726574", "GitHub.com", "test@gmail.com", 20, "!@#\$%&*-_=+?", 1, "A=4BXNAHYUU_hmVwv\$h?"),
        Vector("6d792d6d61737465722d736563726574", "github.com", "TEST@Gmail.com", 20, "!@#\$%&*-_=+?", 1, "A=4BXNAHYUU_hmVwv\$h?"),
        Vector("6d792d6d61737465722d736563726574", "github.com", "test@gmail.com", 16, "!@#\$%&*-_=+?", 1, "gp4QHeNzA72YX-_A"),
        Vector("6d792d6d61737465722d736563726574", "github.com", "test@gmail.com", 20, "!@#\$%&", 1, "AR4HdgNVYpUC4tVw9Kw&"),
        Vector("6d792d6d61737465722d736563726574", "github.com", "test@gmail.com", 20, "!@#\$%&*-_=+?", 2, "GnkEz!F9-z_NqkGTy4n2"),
        Vector("646966666572656e742d736563726574", "github.com", "test@gmail.com", 20, "!@#\$%&*-_=+?", 1, "q=xsG_Tm3_MCeJ2GZ4zF"),
        Vector("6d792d6d61737465722d736563726574", "home-wifi", "test@gmail.com", 20, "!@#\$%&*-_=+?", 1, "4\$\$7A-h4U6YqDm@zb?%4"),
    )

    data class StrengthenVector(
        val secretHex: String,
        val email: String,
        val expectedHex: String
    )

    private val strengthenVectors = listOf(
        StrengthenVector("6d792d6d61737465722d736563726574", "test@gmail.com", "d7b935b8298f476c6046cb71501fcb8c9a53327df3cc4e05c696fea7ef3d035a"),
        StrengthenVector("73686f7274", "Alice@Example.COM", "3633552e469c5ea783380f877b271672e7261795298870734940afe4f808b47b"),
        StrengthenVector("73686f7274", "alice@example.com", "3633552e469c5ea783380f877b271672e7261795298870734940afe4f808b47b"),
    )

    private fun hexToBytes(hex: String): ByteArray {
        return hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }

    private fun bytesToHex(bytes: ByteArray): String {
        return bytes.joinToString("") { "%02x".format(it) }
    }

    @Test
    fun testStrengthenVectors() {
        for (v in strengthenVectors) {
            Keygrain.clearStrengthenCache()
            val result = Keygrain.strengthenSecret(hexToBytes(v.secretHex), v.email)
            assertEquals(
                "Failed for email=${v.email}",
                v.expectedHex,
                bytesToHex(result)
            )
        }
    }

    @Test
    fun testAllVectors() {
        for (v in vectors) {
            Keygrain.clearStrengthenCache()
            val result = Keygrain.derivePassword(
                secret = hexToBytes(v.secretHex),
                email = v.email,
                site = v.site,
                length = v.length,
                symbols = v.symbols,
                counter = v.counter
            )
            assertEquals(
                "Failed for site=${v.site} email=${v.email} (len=${v.length}, counter=${v.counter})",
                v.expected,
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
    fun testEmptySymbolsRejected() {
        Keygrain.derivePassword("secret".toByteArray(), "a@b.com", "x.com", symbols = "")
    }

    @Test(expected = IllegalArgumentException::class)
    fun testEmptySiteRejected() {
        Keygrain.derivePassword("secret".toByteArray(), "a@b.com", "")
    }
}
