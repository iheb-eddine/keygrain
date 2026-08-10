package com.secbytech.keygrain.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
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
    fun testAsciiPrintableSymbolBoundariesAccepted() {
        val symbols = "!~"
        val result = Keygrain.derivePassword("secret".toByteArray(), "a@b.com", "x.com", symbols = symbols)
        assertEquals(20, result.length)
        assertEquals(true, result.any { it == '!' || it == '~' })
    }

    @Test
    fun testInvalidSymbolsRejected() {
        val invalid = listOf("", " ", "\u001F", "\u007F", "é", "😀")
        for (symbols in invalid) {
            try {
                Keygrain.derivePassword("secret".toByteArray(), "a@b.com", "x.com", symbols = symbols)
                throw AssertionError("Expected invalid symbols to be rejected: $symbols")
            } catch (_: IllegalArgumentException) {
                // expected
            }
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun testUnknownSymbolPolicyRejected() {
        Keygrain.derivePassword("secret".toByteArray(), "a@b.com", "x.com", policy = "future-unicode")
    }

    @Test
    fun testDuplicateAndOverlappingSymbolsRemainValid() {
        val symbols = "!!A"
        val result = Keygrain.derivePassword("secret".toByteArray(), "a@b.com", "x.com", symbols = symbols)
        assertEquals(20, result.length)
    }
    @Test
    fun testSymbolSequenceSemanticsHaveExactOutputs() {
        val expected = mapOf(
            "!A" to "Whv6dVxdG4wYAUAXF43M",
            "A!" to "Whv6dVxdG4wY!UAXF43M",
            "!!A" to "Ugs4bVwaF2wYAUAUC4yL",
            "!1" to "Whv6dVxdG4wY1UAXF43M"
        )
        val actual = expected.mapValues { (symbols, _) ->
            Keygrain.derivePassword(
                secret = "my-master-secret".toByteArray(),
                email = "test@gmail.com",
                site = "github.com",
                length = 20,
                symbols = symbols,
                counter = 1
            )
        }
        assertEquals(expected, actual)
        assertNotEquals(actual["!A"], actual["A!"])
        assertNotEquals(actual["!!A"], actual["!A"])
        assertNotEquals(actual["!1"], actual["!A"])
    }

    private fun readApprovedSource(relativePath: String): String {
        val candidates = listOf(
            File("src/main/java/$relativePath"),
            File("app/src/main/java/$relativePath"),
            File("../../main/java/$relativePath"),
            File("keygrain/kotlin/app/src/main/java/$relativePath")
        )
        return candidates.firstOrNull { it.isFile }?.readText()
            ?: throw AssertionError("Approved source file not found: $relativePath")
    }

    @Test
    fun testEditorAndOnboardingRejectInvalidSymbolsBeforeSaveOrPreviewWithoutSubstitution() {
        val invalid = listOf("", " ", "\u001F", "\u007F", "é", "😀")
        for (symbols in invalid) {
            try {
                Keygrain.validateSymbols(symbols)
                throw AssertionError("Expected invalid symbols to be rejected: $symbols")
            } catch (_: IllegalArgumentException) {
                // expected
            }
        }

        val editor = readApprovedSource("com/secbytech/keygrain/ui/screens/ServiceEditorScreen.kt")
        val editorValidation = editor.indexOf("Keygrain.validateSymbols(symbols)")
        val editorReturn = editor.indexOf("return@TextButton", editorValidation)
        val editorSave = editor.indexOf("onSave(ServiceEntry(", editorReturn)
        val editorSymbols = editor.indexOf("symbols = symbols", editorReturn)
        assertTrue(editorValidation >= 0 && editorValidation < editorReturn && editorReturn < editorSave)
        assertTrue(editorSymbols > editorSave)
        val editorSaveBlock = editor.substring(editorSave, editorSymbols + "symbols = symbols".length)
        assertFalse(editorSaveBlock.contains("symbols.ifEmpty"))
        assertFalse(editorSaveBlock.contains("symbols ?: Keygrain.DEFAULT_SYMBOLS"))

        val onboarding = readApprovedSource("com/secbytech/keygrain/ui/screens/OnboardingScreen.kt")
        val previewGuard = onboarding.indexOf("!symbolsAreValid(symbols)")
        val previewReturn = onboarding.indexOf("password = null; return@LaunchedEffect", previewGuard)
        val previewDerive = onboarding.indexOf("Keygrain.derivePassword(", previewReturn)
        assertTrue(previewGuard >= 0 && previewGuard < previewReturn && previewReturn < previewDerive)

        val primaryGuard = onboarding.indexOf("if (!symbolsAreValid(symbols)) return@OnboardingPageLayout")
        val primarySave = onboarding.indexOf("serviceManager.addService(", primaryGuard)
        val onboardingSymbols = onboarding.indexOf("symbols = symbols", primaryGuard)
        assertTrue(primaryGuard >= 0 && primaryGuard < primarySave)
        assertTrue(onboardingSymbols > primarySave)
        val onboardingSaveBlock = onboarding.substring(primarySave, onboardingSymbols + "symbols = symbols".length)
        assertFalse(onboardingSaveBlock.contains("symbols.ifEmpty"))
        assertFalse(onboardingSaveBlock.contains("symbols ?: Keygrain.DEFAULT_SYMBOLS"))
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
