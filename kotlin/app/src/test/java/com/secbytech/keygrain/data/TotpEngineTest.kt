package com.secbytech.keygrain.data

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class TotpEngineTest {

    private fun hexToBytes(hex: String): ByteArray =
        hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun loadVectors(): JSONObject {
        val file = File("../../totp-vectors.json")
        return JSONObject(file.readText())
    }

    // --- RFC 6238 Test Vectors ---

    @Test
    fun testRfc6238Vectors() {
        val json = loadVectors()
        val rfc = json.getJSONObject("rfc6238_vectors")
        val seeds = rfc.getJSONObject("seeds")
        val vectors = rfc.getJSONArray("vectors")

        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            val time = v.getLong("time")
            val algo = v.getString("algorithm")
            val expected = v.getString("expected")
            val seed = hexToBytes(seeds.getString(algo))

            val result = TotpEngine.generateTotp(seed, time, digits = 8, period = 30, algorithm = algo)
            assertEquals(
                "RFC 6238 failed: time=$time algo=$algo",
                expected, result
            )
        }
    }

    // --- Model B Derivation Vectors ---

    @Test
    fun testDerivationVectors() {
        val json = loadVectors()
        val vectors = json.getJSONObject("derivation_vectors").getJSONArray("vectors")

        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            val secret = hexToBytes(v.getString("secret_hex"))
            val email = v.getString("email")
            val site = v.getString("site")
            val expectedHex = v.getString("expected_seed_hex")

            Keygrain.clearStrengthenCache()
            val result = TotpEngine.deriveTotpSeed(secret, email, site)
            assertEquals(
                "Derivation failed: site=$site email=$email",
                expectedHex, bytesToHex(result)
            )
        }
    }

    @Test
    fun testDerivationCaseNormalization() {
        val secret = hexToBytes("6d792d6d61737465722d736563726574")
        Keygrain.clearStrengthenCache()
        val a = TotpEngine.deriveTotpSeed(secret, "test@gmail.com", "github.com")
        Keygrain.clearStrengthenCache()
        val b = TotpEngine.deriveTotpSeed(secret, "test@gmail.com", "GitHub.com")
        Keygrain.clearStrengthenCache()
        val c = TotpEngine.deriveTotpSeed(secret, "TEST@Gmail.com", "github.com")
        assertArrayEquals("Site case normalization", a, b)
        assertArrayEquals("Email case normalization", a, c)
    }

    // --- Input Parsing Vectors ---

    @Test
    fun testParseOtpauthUri() {
        val json = loadVectors()
        val vectors = json.getJSONObject("parse_vectors").getJSONArray("vectors")

        val v = vectors.getJSONObject(0) // otpauth URI
        val result = TotpEngine.parseTotpInput(v.getString("input"))
        assertEquals(v.getString("expected_seed_hex"), bytesToHex(result.seed))
        assertEquals(v.getInt("expected_digits"), result.digits)
        assertEquals(v.getInt("expected_period"), result.period)
        assertEquals(v.getString("expected_algorithm"), result.algorithm)
    }

    @Test
    fun testParseBase32() {
        val json = loadVectors()
        val vectors = json.getJSONObject("parse_vectors").getJSONArray("vectors")

        val v = vectors.getJSONObject(1) // raw base32
        val result = TotpEngine.parseTotpInput(v.getString("input"))
        assertEquals(v.getString("expected_seed_hex"), bytesToHex(result.seed))
        assertEquals(6, result.digits)
        assertEquals(30, result.period)
        assertEquals("SHA1", result.algorithm)
    }

    @Test
    fun testParseHex() {
        val json = loadVectors()
        val vectors = json.getJSONObject("parse_vectors").getJSONArray("vectors")

        val v = vectors.getJSONObject(2) // hex
        val result = TotpEngine.parseTotpInput(v.getString("input"))
        assertEquals(v.getString("expected_seed_hex"), bytesToHex(result.seed))
    }

    // --- Input Validation ---

    @Test(expected = IllegalArgumentException::class)
    fun testRejectInvalidDigits() {
        TotpEngine.generateTotp(ByteArray(20), 0L, digits = 7)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testRejectUnsupportedAlgorithm() {
        TotpEngine.generateTotp(ByteArray(20), 0L, algorithm = "MD5")
    }

    @Test(expected = IllegalArgumentException::class)
    fun testRejectEmptyInput() {
        TotpEngine.parseTotpInput("")
    }

    @Test(expected = IllegalArgumentException::class)
    fun testRejectHotpUri() {
        TotpEngine.parseTotpInput("otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP&counter=0")
    }

    @Test(expected = IllegalArgumentException::class)
    fun testRejectInvalidBase32InUri() {
        TotpEngine.parseTotpInput("otpauth://totp/Test?secret=!!!INVALID!!!")
    }

    @Test(expected = IllegalArgumentException::class)
    fun testRejectInvalidDigitsInUri() {
        TotpEngine.parseTotpInput("otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&digits=7")
    }

    @Test
    fun testParseOtpauthSpaceInLabel() {
        // Real-world QR codes often have unencoded chars that break java.net.URI
        val result = TotpEngine.parseTotpInput("otpauth://totp/My Service:user@email.com?secret=JBSWY3DPEHPK3PXP&digits=6")
        assertEquals(6, result.digits)
        assertEquals(30, result.period)
    }

    @Test
    fun testParseOtpauthWithFragment() {
        // Fragment must not corrupt the last query parameter
        val result = TotpEngine.parseTotpInput("otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&period=60#fragment")
        assertEquals(60, result.period)
    }

    @Test
    fun testParseOtpauthNoSlash() {
        // No slash between type and query (uncommon but valid)
        val result = TotpEngine.parseTotpInput("otpauth://totp?secret=JBSWY3DPEHPK3PXP")
        assertEquals(6, result.digits)
        assertEquals(30, result.period)
    }
}
