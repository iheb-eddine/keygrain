package com.secbytech.keygrain.data

import android.content.Context
import com.secbytech.keygrain.R
import java.security.MessageDigest
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

object WalletEngine {
    val SUPPORTED_CHAINS: Set<String> = setOf(
        "bitcoin", "ethereum", "solana", "litecoin", "dogecoin",
        "bitcoin-testnet", "polkadot", "cosmos", "avalanche"
    )

    private val WALLET_NAME_RE = Regex("^[a-z0-9\\-]+$")
    private var wordlist: List<String>? = null

    fun loadWordlist(context: Context) {
        if (wordlist != null) return
        val words = context.resources.openRawResource(R.raw.bip39_english)
            .bufferedReader().readLines().filter { it.isNotEmpty() }
        require(words.size == 2048) { "BIP-39 wordlist must have 2048 words, got ${words.size}" }
        // Integrity check
        val raw = words.joinToString("\n") + "\n"
        val hash = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        require(hash == "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda") {
            "BIP-39 wordlist integrity check failed"
        }
        wordlist = words
    }

    private fun getWordlist(): List<String> =
        wordlist ?: throw IllegalStateException("Call loadWordlist(context) first")

    fun deriveWalletEntropy(
        secret: ByteArray,
        walletId: String,
        words: Int = 24,
        counter: Int = 1
    ): ByteArray {
        require(secret.isNotEmpty()) { "secret must not be empty" }
        val wid = walletId.lowercase().trim()
        require(wid.isNotEmpty() && WALLET_NAME_RE.matches(wid)) {
            "walletId must match [a-z0-9\\-]+, got: \"$wid\""
        }
        require(words == 12 || words == 24) { "words must be 12 or 24, got $words" }
        require(counter >= 1) { "counter must be >= 1" }

        val salt = "keygrain-wallet:$wid".toByteArray(Charsets.UTF_8)
        val params = org.bouncycastle.crypto.params.Argon2Parameters.Builder(org.bouncycastle.crypto.params.Argon2Parameters.ARGON2_id)
            .withSalt(salt)
            .withIterations(3)
            .withMemoryAsKB(65536)
            .withParallelism(1)
            .build()
        val generator = org.bouncycastle.crypto.generators.Argon2BytesGenerator()
        generator.init(params)
        val strengthened = ByteArray(32)
        generator.generateBytes(secret, strengthened)

        val message = "$wid:$words:$counter:keygrain-wallet".toByteArray(Charsets.UTF_8)
        val full = Keygrain.hmacSha256(strengthened, message)
        val entropyBytes = if (words == 12) 16 else 32
        return full.copyOfRange(0, entropyBytes)
    }

    fun deriveWalletEntropy(
        secret: ByteArray,
        email: String,
        walletName: String,
        chain: String,
        counter: Int = 1
    ): ByteArray {
        require(secret.isNotEmpty()) { "secret must not be empty" }
        require(email.isNotEmpty()) { "email must not be empty" }
        val wn = walletName.lowercase()
        require(wn.isNotEmpty() && WALLET_NAME_RE.matches(wn)) {
            "walletName must match [a-z0-9\\-]+, got: \"$wn\""
        }
        val ch = chain.lowercase()
        require(ch in SUPPORTED_CHAINS) { "Unsupported chain: $ch" }
        require(counter >= 1) { "counter must be >= 1" }

        val strengthened = Keygrain.strengthenSecret(secret, email)
        val message = "${email.lowercase()}:$wn:$ch:$counter:keygrain-wallet".toByteArray(Charsets.UTF_8)
        return Keygrain.hmacSha256(strengthened, message)
    }

    fun entropyToMnemonic(entropy: ByteArray): String {
        require(entropy.size == 16 || entropy.size == 32) {
            "entropy must be 16 or 32 bytes, got ${entropy.size}"
        }
        val wl = getWordlist()
        val is12 = entropy.size == 16
        val wordCount = if (is12) 12 else 24

        // Checksum bits: 4 bits for 128-bit (16 bytes), 8 bits for 256-bit (32 bytes)
        val hashFirstByte = MessageDigest.getInstance("SHA-256").digest(entropy)[0].toInt() and 0xFF

        var bits = java.math.BigInteger.ZERO
        for (b in entropy) {
            bits = bits.shiftLeft(8).or(java.math.BigInteger.valueOf((b.toInt() and 0xFF).toLong()))
        }

        if (is12) {
            val checksum4Bits = hashFirstByte ushr 4
            bits = bits.shiftLeft(4).or(java.math.BigInteger.valueOf(checksum4Bits.toLong()))
        } else {
            bits = bits.shiftLeft(8).or(java.math.BigInteger.valueOf(hashFirstByte.toLong()))
        }

        val words = mutableListOf<String>()
        for (i in (wordCount - 1) downTo 0) {
            val index = bits.shiftRight(i * 11).and(java.math.BigInteger.valueOf(0x7FF)).toInt()
            words.add(wl[index])
        }
        return words.joinToString(" ")
    }

    fun mnemonicToSeed(mnemonic: String, passphrase: String = ""): ByteArray {
        val spec = PBEKeySpec(
            mnemonic.toCharArray(),
            ("mnemonic$passphrase").toByteArray(Charsets.UTF_8),
            2048,
            512
        )
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA512")
        return factory.generateSecret(spec).encoded
    }

    fun deriveWalletMnemonic(
        secret: ByteArray,
        walletId: String,
        words: Int = 24,
        counter: Int = 1
    ): String {
        val entropy1 = deriveWalletEntropy(secret, walletId, words, counter)
        val entropy2 = deriveWalletEntropy(secret, walletId, words, counter)
        check(entropy1.contentEquals(entropy2)) {
            "CRITICAL: Double-derivation mismatch in the wallet expansion step."
        }
        return entropyToMnemonic(entropy1)
    }

    fun deriveWalletMnemonic(
        secret: ByteArray,
        email: String,
        walletName: String,
        chain: String,
        counter: Int = 1
    ): String {
        val entropy1 = deriveWalletEntropy(secret, email, walletName, chain, counter)
        val entropy2 = deriveWalletEntropy(secret, email, walletName, chain, counter)
        check(entropy1.contentEquals(entropy2)) {
            "CRITICAL: Double-derivation mismatch in the wallet expansion step."
        }
        return entropyToMnemonic(entropy1)
    }
}
