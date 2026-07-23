package com.secbytech.keygrain.data

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test
import java.io.File

class WalletEngineTest {

    private fun hexToBytes(hex: String): ByteArray =
        hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun loadVectors(): JSONObject {
        val file = File("../../wallet-vectors.json")
        return JSONObject(file.readText())
    }

    @Before
    fun setUp() {
        // Inject BIP-39 wordlist via reflection (avoids Android Context dependency)
        val wordlistFile = File("src/main/res/raw/bip39_english.txt")
        val words = wordlistFile.readLines().filter { it.isNotEmpty() }
        val field = WalletEngine::class.java.getDeclaredField("wordlist")
        field.isAccessible = true
        field.set(WalletEngine, words)
    }

    // --- Entropy Derivation Vectors ---

    @Test
    fun testDerivationVectors() {
        val json = loadVectors()
        val vectors = json.getJSONArray("derivation_vectors")

        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            val secret = v.getString("secret").toByteArray(Charsets.UTF_8)
            val email = v.getString("email")
            val walletName = v.getString("wallet_name")
            val chain = v.getString("chain")
            val counter = v.getInt("counter")
            val expectedEntropy = v.getString("entropy_hex")

            Keygrain.clearStrengthenCache()
            val result = WalletEngine.deriveWalletEntropy(secret, email, walletName, chain, counter)
            assertEquals(
                "Entropy mismatch: vector ${v.getInt("id")}",
                expectedEntropy, bytesToHex(result)
            )
        }
    }

    // --- Case Normalization ---

    @Test
    fun testCaseNormalization() {
        val secret = "my-master-secret".toByteArray()
        Keygrain.clearStrengthenCache()
        val a = WalletEngine.deriveWalletEntropy(secret, "test@gmail.com", "personal", "bitcoin", 1)
        Keygrain.clearStrengthenCache()
        val b = WalletEngine.deriveWalletEntropy(secret, "TEST@Gmail.com", "Personal", "Bitcoin", 1)
        assertArrayEquals("Case normalization must produce identical entropy", a, b)
    }

    @Test
    fun testDifferentChainProducesDifferentEntropy() {
        val secret = "my-master-secret".toByteArray()
        Keygrain.clearStrengthenCache()
        val a = WalletEngine.deriveWalletEntropy(secret, "test@gmail.com", "personal", "bitcoin", 1)
        Keygrain.clearStrengthenCache()
        val b = WalletEngine.deriveWalletEntropy(secret, "test@gmail.com", "personal", "ethereum", 1)
        assertFalse("Different chain must produce different entropy", a.contentEquals(b))
    }

    // --- BIP-39 Mnemonic Vectors ---

    @Test
    fun testEntropyToMnemonic() {
        val json = loadVectors()
        val vectors = json.getJSONArray("bip39_vectors")

        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            val entropy = hexToBytes(v.getString("entropy_hex"))
            val expectedMnemonic = v.getString("mnemonic")

            val result = WalletEngine.entropyToMnemonic(entropy)
            assertEquals(
                "BIP-39 mnemonic mismatch: ${v.getString("description")}",
                expectedMnemonic, result
            )
        }
    }

    @Test
    fun testDerivationMnemonicVectors() {
        val json = loadVectors()
        val vectors = json.getJSONArray("derivation_vectors")

        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            val expectedMnemonic = v.getString("mnemonic")
            val entropy = hexToBytes(v.getString("entropy_hex"))

            val result = WalletEngine.entropyToMnemonic(entropy)
            assertEquals(
                "Mnemonic mismatch: vector ${v.getInt("id")}",
                expectedMnemonic, result
            )
        }
    }

    // --- PBKDF2 Seed Derivation ---

    @Test
    fun testMnemonicToSeed() {
        val json = loadVectors()
        val vectors = json.getJSONArray("pbkdf2_vectors")

        val v = vectors.getJSONObject(0)
        val mnemonic = v.getString("mnemonic")
        val passphrase = v.getString("passphrase")
        val expectedSeed = v.getString("seed_hex")

        val result = WalletEngine.mnemonicToSeed(mnemonic, passphrase)
        assertEquals(
            "PBKDF2 seed mismatch",
            expectedSeed, bytesToHex(result)
        )
    }

    // --- Input Validation ---

    @Test(expected = IllegalArgumentException::class)
    fun testRejectEmptyWalletName() {
        WalletEngine.deriveWalletEntropy("secret".toByteArray(), "a@b.com", "", "bitcoin", 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testRejectInvalidWalletNameChars() {
        WalletEngine.deriveWalletEntropy("secret".toByteArray(), "a@b.com", "my wallet", "bitcoin", 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testRejectUnsupportedChain() {
        WalletEngine.deriveWalletEntropy("secret".toByteArray(), "a@b.com", "personal", "cardano", 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testRejectCounterLessThanOne() {
        WalletEngine.deriveWalletEntropy("secret".toByteArray(), "a@b.com", "personal", "bitcoin", 0)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testRejectEmptySecret() {
        WalletEngine.deriveWalletEntropy(ByteArray(0), "a@b.com", "personal", "bitcoin", 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testRejectEmptyEmail() {
        WalletEngine.deriveWalletEntropy("secret".toByteArray(), "", "personal", "bitcoin", 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testRejectEntropyWrongSize() {
        WalletEngine.entropyToMnemonic(ByteArray(16))
    }
}
