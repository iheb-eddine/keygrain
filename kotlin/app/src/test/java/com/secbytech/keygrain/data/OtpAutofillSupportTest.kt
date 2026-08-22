package com.secbytech.keygrain.data

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Base64

class OtpAutofillSupportTest {
    @Test
    fun htmlContractRequiresInputAndExactToken() {
        assertTrueContract("one-time-code")
        assertTrueContract("ONE-TIME-CODE")
        assertTrueContract("username one-time-code")
        assertTrueContract("one-time-code\u2003numeric")
        assertNullContract("one-time-codex")
        assertNullContract("x-one-time-code")
        assertNullContract("numeric")
        assertNullContract("one-time-code", tag = "div")
        assertNullContract("one-time-code", tag = "INPUT", duplicate = true)
        assertNullContract(null)
    }

    @Test
    fun htmlContractRejectsNullOrMissingMetadataAndHeuristics() {
        assertNullContract(null, attributes = null)
        assertNullContract(null, attributes = emptyList())
        assertNullContract("123456", attributes = listOf(OtpHtmlAttribute("name", "otp")))
        assertNullContract("123456", attributes = listOf(OtpHtmlAttribute("inputmode", "numeric")))
        assertNullContract("123456", attributes = listOf(OtpHtmlAttribute("type", "text")))
        assertNullContract("one-time-code", attributes = listOf(OtpHtmlAttribute("autocomplete", null)))
    }

    @Test
    fun defaultsAndUnknownFieldsAreAcceptedWithoutMutatingInput() {
        val json = JSONObject()
            .put("mode", "derived")
            .put("future_field", JSONObject().put("secret", "ignored"))
        val before = json.toString()

        val config = TotpAutofillValidator.validate(json)

        assertNotNull(config)
        assertEquals(Mode.DERIVED, config!!.mode)
        assertEquals(6, config.digits)
        assertEquals(30, config.period)
        assertEquals("SHA1", config.algorithm)
        assertNull(config.seedCopy())
        assertEquals(before, json.toString())
    }

    @Test
    fun storedSeedIsCanonicalAndOwned() {
        val seed = ByteArray(20) { (it + 1).toByte() }
        val encoded = Base64.getEncoder().encodeToString(seed)
        val json = JSONObject().put("mode", "stored").put("seed", encoded)
        val config = TotpAutofillValidator.validate(json)

        assertNotNull(config)
        assertEquals(Mode.STORED, config!!.mode)
        assertArrayEquals(seed, config.seedCopy())
        val first = config.seedCopy()!!
        first[0] = 0
        assertEquals(seed[0], config.seedCopy()!![0])
        config.clear()
        assertArrayEquals(ByteArray(seed.size), config.seedCopy())
        assertEquals(encoded, json.getString("seed"))
    }

    @Test
    fun factoryCopiesSeedBeforeTakingOwnership() {
        val source = byteArrayOf(1, 2, 3)
        val config = ValidatedTotpConfig.create(Mode.STORED, 6, 30, "SHA1", source)
        source[0] = 99
        assertArrayEquals(byteArrayOf(1, 2, 3), config.seedCopy())
    }

    @Test
    fun validOverridesAndAlgorithmAreAccepted() {
        val encoded = Base64.getEncoder().encodeToString(ByteArray(1) { 7 })
        val config = TotpAutofillValidator.validate(
            JSONObject()
                .put("mode", "stored")
                .put("digits", 8)
                .put("period", 300)
                .put("algorithm", "sHa256")
                .put("seed", encoded)
        )
        assertNotNull(config)
        assertEquals(8, config!!.digits)
        assertEquals(300, config.period)
        assertEquals("SHA256", config.algorithm)
    }

    @Test
    fun invalidModesTypesRangesAndSeedPresenceFailClosed() {
        val validSeed = Base64.getEncoder().encodeToString(ByteArray(20) { 1 })
        val invalid = listOf(
            JSONObject().put("mode", "hotp"),
            JSONObject().put("mode", JSONObject.NULL),
            JSONObject().put("mode", 1),
            JSONObject().put("mode", "derived").put("seed", JSONObject.NULL),
            JSONObject().put("mode", "stored"),
            JSONObject().put("mode", "stored").put("seed", JSONObject.NULL),
            JSONObject().put("mode", "stored").put("seed", 7),
            JSONObject().put("mode", "stored").put("seed", validSeed).put("digits", 7),
            JSONObject().put("mode", "stored").put("seed", validSeed).put("digits", "6"),
            JSONObject().put("mode", "stored").put("seed", validSeed).put("digits", true),
            JSONObject().put("mode", "stored").put("seed", validSeed).put("digits", 6.0),
            JSONObject().put("mode", "stored").put("seed", validSeed).put("period", 0),
            JSONObject().put("mode", "stored").put("seed", validSeed).put("period", 301),
            JSONObject().put("mode", "stored").put("seed", validSeed).put("period", "30"),
            JSONObject().put("mode", "stored").put("seed", validSeed).put("algorithm", JSONObject.NULL),
            JSONObject().put("mode", "stored").put("seed", validSeed).put("algorithm", "MD5"),
            JSONObject().put("mode", "stored").put("seed", validSeed).put("algorithm", "\u017Fha1")
        )
        invalid.forEach { assertNull(it.toString(), TotpAutofillValidator.validate(it)) }
    }

    @Test
    fun base64MustBeCanonicalStandardNoWrapAndBounded() {
        val valid = JSONObject().put("mode", "stored")
        val candidates = listOf(
            "!!!!",
            "abcd ",
            "YWJj\n",
            "_w==",
            "-w==",
            "YQ=",
            "YQ===",
            "YWI=extra",
            Base64.getEncoder().withoutPadding().encodeToString(byteArrayOf(1, 2)),
            Base64.getEncoder().encodeToString(ByteArray(129) { 1 }),
            ""
        )
        candidates.forEach { encoded ->
            val json = JSONObject(valid.toString()).put("seed", encoded)
            assertNull(encoded, TotpAutofillValidator.validate(json))
        }
    }

    private fun assertTrueContract(value: String) {
        assertTrueContract(value, "input")
    }

    private fun assertTrueContract(value: String, tag: String) {
        val attributes = listOf(OtpHtmlAttribute("autocomplete", value))
        assertEquals(true, OtpAutofillDetector.hasExactOtpContractForTest(tag, attributes))
    }

    private fun assertNullContract(
        value: String?,
        tag: String = "input",
        duplicate: Boolean = false,
        attributes: List<OtpHtmlAttribute>? = value?.let {
            if (duplicate) listOf(
                OtpHtmlAttribute("autocomplete", it),
                OtpHtmlAttribute("AUTOCOMPLETE", it)
            ) else listOf(OtpHtmlAttribute("autocomplete", it))
        }
    ) {
        assertEquals(false, OtpAutofillDetector.hasExactOtpContractForTest(tag, attributes))
    }
}
