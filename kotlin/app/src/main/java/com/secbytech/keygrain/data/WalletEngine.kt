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
        require(entropy.size == 32) { "entropy must be 32 bytes, got ${entropy.size}" }
        val wl = getWordlist()

        val checksumByte = MessageDigest.getInstance("SHA-256").digest(entropy)[0].toInt() and 0xFF

        // Build 264-bit value: 256 bits entropy + 8 bits checksum
        // Use BigInteger for bit manipulation
        var bits = java.math.BigInteger.ZERO
        for (b in entropy) {
            bits = bits.shiftLeft(8).or(java.math.BigInteger.valueOf((b.toInt() and 0xFF).toLong()))
        }
        bits = bits.shiftLeft(8).or(java.math.BigInteger.valueOf(checksumByte.toLong()))

        val words = mutableListOf<String>()
        for (i in 23 downTo 0) {
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
        email: String,
        walletName: String,
        chain: String,
        counter: Int = 1
    ): String {
        val entropy1 = deriveWalletEntropy(secret, email, walletName, chain, counter)
        val entropy2 = deriveWalletEntropy(secret, email, walletName, chain, counter)
        check(entropy1.contentEquals(entropy2)) {
            "CRITICAL: Double-derivation mismatch. Possible implementation bug or hardware fault."
        }
        return entropyToMnemonic(entropy1)
    }
}
