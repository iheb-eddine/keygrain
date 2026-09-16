package com.secbytech.keygrain.domain

import com.secbytech.keygrain.data.Keygrain
import com.secbytech.keygrain.data.SshEngine
import com.secbytech.keygrain.data.TotpEngine
import com.secbytech.keygrain.data.WalletEngine
import java.io.File
import java.security.SecureRandom
import java.util.concurrent.CopyOnWriteArrayList
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Execution context carrying secret credentials for derivation or decryption.
 * Includes helper methods for memory hygiene and zeroization.
 */
data class DerivationContext(
    val masterSecret: CharArray,
    val accountEmail: String,
    val customVaultKey: ByteArray? = null
) {
    constructor(secret: String, accountEmail: String) : this(secret.toCharArray(), accountEmail)
    constructor(secretBytes: ByteArray, accountEmail: String) : this(String(secretBytes, Charsets.UTF_8).toCharArray(), accountEmail)

    fun zeroize() {
        masterSecret.fill('\u0000')
        customVaultKey?.fill(0)
    }

    fun clear() = zeroize()

    inline fun <R> useSecretBytes(block: (ByteArray) -> R): R {
        val bytes = String(masterSecret).toByteArray(Charsets.UTF_8)
        try {
            return block(bytes)
        } finally {
            bytes.fill(0)
        }
    }
}

/**
 * Thrown when an operation requires an interface/capability that a generator deliberately
 * does not support, safeguarding Interface Segregation Principle (ISP) contracts.
 */
class UnsupportedCapabilityError(message: String) : RuntimeException(message)

/**
 * Granular derivation results.
 */
data class TotpResult(
    val code: String,
    val remainingSeconds: Long,
    val period: Int,
    val digits: Int = 6
)

data class SshKeypairResult(
    val publicKey: String,
    val privateKey: String,
    val rawPublicKey: ByteArray,
    val seed: ByteArray,
    val comment: String
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is SshKeypairResult) return false
        return publicKey == other.publicKey &&
            privateKey == other.privateKey &&
            rawPublicKey.contentEquals(other.rawPublicKey) &&
            seed.contentEquals(other.seed) &&
            comment == other.comment
    }

    override fun hashCode(): Int {
        var result = publicKey.hashCode()
        result = 31 * result + privateKey.hashCode()
        result = 31 * result + rawPublicKey.contentHashCode()
        result = 31 * result + seed.contentHashCode()
        result = 31 * result + comment.hashCode()
        return result
    }
}

data class WalletMnemonicResult(
    val mnemonic: String,
    val seed: ByteArray? = null,
    val words: Int = 24,
    val walletId: String = ""
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is WalletMnemonicResult) return false
        return mnemonic == other.mnemonic &&
            (seed == null && other.seed == null || seed != null && other.seed != null && seed.contentEquals(other.seed)) &&
            words == other.words &&
            walletId == other.walletId
    }

    override fun hashCode(): Int {
        var result = mnemonic.hashCode()
        result = 31 * result + (seed?.contentHashCode() ?: 0)
        result = 31 * result + words
        result = 31 * result + walletId.hashCode()
        return result
    }
}

data class CompanionRequest(
    val deviceId: String? = null,
    val action: String = "RESOLVE_CREDENTIAL",
    val payload: Map<String, Any?> = emptyMap(),
    val handler: (suspend (AssetEntity, CompanionRequest) -> String)? = null
)

// ---------------------------------------------------------------------------
// Granular Capability Interfaces (ISP / DIP)
// ---------------------------------------------------------------------------

/**
 * Base credential generator abstraction (Open-Closed Principle).
 */
interface ICredentialGenerator {
    val algorithmId: String
    fun supportsKind(kind: AssetKind): Boolean
    fun supportsSource(source: DerivationSource): Boolean
    fun supportsAlgorithm(algoId: String?): Boolean =
        algoId.isNullOrBlank() || algoId.equals(algorithmId, ignoreCase = true)
}

interface IPasswordGenerator {
    suspend fun generatePassword(entity: LoginEntity, ctx: DerivationContext): String
}

interface ITotpGenerator {
    suspend fun generateTotp(
        entity: LoginEntity,
        ctx: DerivationContext,
        timestampMs: Long = System.currentTimeMillis()
    ): TotpResult
}

interface ISshGenerator {
    suspend fun generateSshKeypair(entity: SshEntity, ctx: DerivationContext): SshKeypairResult
}

interface IWalletGenerator {
    suspend fun generateWallet(entity: WalletEntity, ctx: DerivationContext): WalletMnemonicResult
}

interface IStoredVaultResolver {
    suspend fun decryptStoredVault(entity: LoginEntity, ctx: DerivationContext): String
}

interface ICompanionDelegator {
    suspend fun requestCompanionDerivation(entity: AssetEntity, req: CompanionRequest): String
}

// ---------------------------------------------------------------------------
// Internal Helper for OpenSSH Key Formatting
// ---------------------------------------------------------------------------

private object SshFormatter {
    fun formatAuthorizedKeys(publicKey: ByteArray, comment: String): String {
        require(!comment.contains(Regex("[\\x00-\\x1f\\x7f]"))) { "comment must not contain control characters" }
        val keyType = "ssh-ed25519".toByteArray(Charsets.UTF_8)
        val blob = ByteArray(4 + keyType.size + 4 + publicKey.size)
        var offset = 0
        putUint32(blob, offset, keyType.size); offset += 4
        keyType.copyInto(blob, offset); offset += keyType.size
        putUint32(blob, offset, publicKey.size); offset += 4
        publicKey.copyInto(blob, offset)

        val b64 = java.util.Base64.getEncoder().encodeToString(blob)
        return "ssh-ed25519 $b64 $comment"
    }

    fun formatOpensshPrivateKey(seed: ByteArray, publicKey: ByteArray, comment: String): String {
        require(!comment.contains(Regex("[\\x00-\\x1f\\x7f]"))) { "comment must not contain control characters" }

        val checkBytes = Keygrain.hmacSha256(seed, "openssh-check".toByteArray(Charsets.UTF_8))
        val checkInt = ((checkBytes[0].toInt() and 0xFF) shl 24) or
                ((checkBytes[1].toInt() and 0xFF) shl 16) or
                ((checkBytes[2].toInt() and 0xFF) shl 8) or
                (checkBytes[3].toInt() and 0xFF)

        val keyType = "ssh-ed25519".toByteArray(Charsets.UTF_8)
        val pubBlob = ByteArray(4 + keyType.size + 4 + publicKey.size)
        var po = 0
        putUint32(pubBlob, po, keyType.size); po += 4
        keyType.copyInto(pubBlob, po); po += keyType.size
        putUint32(pubBlob, po, publicKey.size); po += 4
        publicKey.copyInto(pubBlob, po)

        val commentBytes = comment.toByteArray(Charsets.UTF_8)
        val privLen = 4 + 4 + (4 + keyType.size) + (4 + publicKey.size) + (4 + 64) + (4 + commentBytes.size)
        val padLen = (8 - privLen % 8) % 8
        val privSection = ByteArray(privLen + padLen)
        var ps = 0
        putUint32(privSection, ps, checkInt); ps += 4
        putUint32(privSection, ps, checkInt); ps += 4
        putUint32(privSection, ps, keyType.size); ps += 4
        keyType.copyInto(privSection, ps); ps += keyType.size
        putUint32(privSection, ps, publicKey.size); ps += 4
        publicKey.copyInto(privSection, ps); ps += publicKey.size
        putUint32(privSection, ps, 64); ps += 4
        seed.copyInto(privSection, ps); ps += seed.size
        publicKey.copyInto(privSection, ps); ps += publicKey.size
        putUint32(privSection, ps, commentBytes.size); ps += 4
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
        putUint32(outer, oo, cipherName.size); oo += 4
        cipherName.copyInto(outer, oo); oo += cipherName.size
        putUint32(outer, oo, kdfName.size); oo += 4
        kdfName.copyInto(outer, oo); oo += kdfName.size
        putUint32(outer, oo, 0); oo += 4
        putUint32(outer, oo, 1); oo += 4
        putUint32(outer, oo, pubBlob.size); oo += 4
        pubBlob.copyInto(outer, oo); oo += pubBlob.size
        putUint32(outer, oo, privSection.size); oo += 4
        privSection.copyInto(outer, oo)

        val b64 = java.util.Base64.getEncoder().encodeToString(outer)
        val lines = b64.chunked(70).joinToString("\n")
        return "-----BEGIN OPENSSH PRIVATE KEY-----\n$lines\n-----END OPENSSH PRIVATE KEY-----\n"
    }

    private fun putUint32(buf: ByteArray, offset: Int, value: Int) {
        buf[offset] = (value shr 24 and 0xFF).toByte()
        buf[offset + 1] = (value shr 16 and 0xFF).toByte()
        buf[offset + 2] = (value shr 8 and 0xFF).toByte()
        buf[offset + 3] = (value and 0xFF).toByte()
    }
}

// ---------------------------------------------------------------------------
// Concrete Implementations
// ---------------------------------------------------------------------------

/**
 * Keygrain Spec v5 Deterministic Generator.
 * Bridges directly to authoritative algorithms (Argon2id + HMAC-SHA256, Ed25519, BIP-39).
 */
class KeygrainV5DeterministicGenerator :
    ICredentialGenerator,
    IPasswordGenerator,
    ITotpGenerator,
    ISshGenerator,
    IWalletGenerator {

    override val algorithmId: String = "spec-v5"

    override fun supportsKind(kind: AssetKind): Boolean =
        kind in setOf(AssetKind.LOGIN, AssetKind.SSH, AssetKind.WALLET)

    override fun supportsSource(source: DerivationSource): Boolean =
        source == DerivationSource.DETERMINISTIC

    override fun supportsAlgorithm(algoId: String?): Boolean {
        if (algoId.isNullOrBlank()) return true
        val lower = algoId.lowercase()
        return lower in setOf(
            "spec-v5",
            "argon2id-hmac-sha256",
            "bip39",
            "ed25519",
            "ascii-printable-v1"
        )
    }

    override suspend fun generatePassword(entity: LoginEntity, ctx: DerivationContext): String {
        require(ctx.accountEmail.isNotBlank()) { "Missing account email in context" }
        return ctx.useSecretBytes { secretBytes ->
            Keygrain.derivePassword(
                secret = secretBytes,
                email = ctx.accountEmail,
                site = entity.site,
                length = entity.length,
                symbols = entity.symbols,
                counter = entity.counter,
                policy = entity.characterPolicy ?: "ascii-printable-v1"
            )
        }
    }

    override suspend fun generateTotp(
        entity: LoginEntity,
        ctx: DerivationContext,
        timestampMs: Long
    ): TotpResult {
        val totpConfig = entity.totp ?: throw IllegalStateException("Entity has no TOTP configuration")
        val seed: ByteArray = if (totpConfig.type.equals("stored", ignoreCase = true)) {
            val rawSeed = totpConfig.seed ?: throw IllegalStateException("Stored TOTP requires seed parameter")
            TotpEngine.parseTotpInput(rawSeed).seed
        } else {
            require(ctx.accountEmail.isNotBlank()) { "Missing account email for derived TOTP" }
            ctx.useSecretBytes { secretBytes ->
                TotpEngine.deriveTotpSeed(secretBytes, ctx.accountEmail, entity.site)
            }
        }

        val period = totpConfig.stepSeconds
        val digits = totpConfig.digits
        val algorithm = totpConfig.algorithm
        val timeSec = timestampMs / 1000
        val code = TotpEngine.generateTotp(seed, timeSec, digits, period, algorithm)
        val remainingSeconds = period - (timeSec % period)
        return TotpResult(code, remainingSeconds, period, digits)
    }

    override suspend fun generateSshKeypair(
        entity: SshEntity,
        ctx: DerivationContext
    ): SshKeypairResult {
        val comment = entity.comment.ifBlank { entity.keyName }
        val keypair = ctx.useSecretBytes { secretBytes ->
            SshEngine.deriveSshKeypair(secretBytes, entity.keyName, entity.counter)
        }
        val publicKeyFormatted = SshFormatter.formatAuthorizedKeys(keypair.publicKey, comment)
        val privateKeyFormatted = SshFormatter.formatOpensshPrivateKey(keypair.seed, keypair.publicKey, comment)
        return SshKeypairResult(
            publicKey = publicKeyFormatted,
            privateKey = privateKeyFormatted,
            rawPublicKey = keypair.publicKey,
            seed = keypair.seed,
            comment = comment
        )
    }

    override suspend fun generateWallet(
        entity: WalletEntity,
        ctx: DerivationContext
    ): WalletMnemonicResult {
        ensureWordlistLoaded()
        val mnemonic = ctx.useSecretBytes { secretBytes ->
            WalletEngine.deriveWalletMnemonic(
                secret = secretBytes,
                walletId = entity.walletId,
                words = entity.words,
                counter = entity.counter
            )
        }
        val seed = WalletEngine.mnemonicToSeed(mnemonic)
        return WalletMnemonicResult(
            mnemonic = mnemonic,
            seed = seed,
            words = entity.words,
            walletId = entity.walletId
        )
    }

    private fun ensureWordlistLoaded() {
        try {
            val field = WalletEngine::class.java.getDeclaredField("wordlist")
            field.isAccessible = true
            if (field.get(WalletEngine) != null) return

            val candidatePaths = listOf(
                "src/main/res/raw/bip39_english.txt",
                "app/src/main/res/raw/bip39_english.txt",
                "../app/src/main/res/raw/bip39_english.txt",
                "keygrain/kotlin/app/src/main/res/raw/bip39_english.txt"
            )
            for (p in candidatePaths) {
                val f = File(p)
                if (f.isFile) {
                    val words = f.readLines().filter { it.isNotEmpty() }
                    if (words.size == 2048) {
                        field.set(WalletEngine, words)
                        return
                    }
                }
            }
        } catch (_: Throwable) {
            // Ignored; WalletEngine will throw if wordlist is accessed without being initialized
        }
    }
}

/**
 * Resolver for decrypting temporary reversible AES-256-GCM vault payloads (migration).
 */
class StoredVaultResolver : ICredentialGenerator, IStoredVaultResolver {
    override val algorithmId: String = "aes-256-gcm"

    override fun supportsKind(kind: AssetKind): Boolean =
        kind in setOf(AssetKind.LOGIN, AssetKind.NOTE, AssetKind.SSH, AssetKind.WALLET)

    override fun supportsSource(source: DerivationSource): Boolean =
        source == DerivationSource.STORED

    override fun supportsAlgorithm(algoId: String?): Boolean {
        if (algoId.isNullOrBlank()) return true
        val lower = algoId.lowercase()
        return lower in setOf("aes-256-gcm", "legacy-vault-v1")
    }

    override suspend fun decryptStoredVault(entity: LoginEntity, ctx: DerivationContext): String {
        val payload = entity.vaultPayload
            ?: throw IllegalStateException("Entity does not contain an encrypted vault payload")

        val key = ctx.customVaultKey ?: run {
            require(ctx.accountEmail.isNotBlank()) { "Missing account email in context for vault key derivation" }
            ctx.useSecretBytes { secretBytes ->
                val strengthened = Keygrain.strengthenSecret(secretBytes, ctx.accountEmail)
                val message = "${ctx.accountEmail.lowercase()}:keygrain-legacy-vault".toByteArray(Charsets.UTF_8)
                Keygrain.hmacSha256(strengthened, message)
            }
        }

        return decryptPayload(payload, key)
    }

    companion object {
        fun encrypt(
            plaintext: String,
            key: ByteArray,
            version: Int = 1,
            synced: Boolean = false
        ): EncryptedVaultPayload {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val iv = ByteArray(12)
            SecureRandom().nextBytes(iv)
            val keySpec = SecretKeySpec(key, "AES")
            val gcmSpec = GCMParameterSpec(128, iv)
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec)
            val encryptedWithTag = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
            val tagLength = 16
            val ciphertextLength = encryptedWithTag.size - tagLength
            val ciphertext = encryptedWithTag.copyOfRange(0, ciphertextLength)
            val tag = encryptedWithTag.copyOfRange(ciphertextLength, encryptedWithTag.size)

            val b64Encoder = java.util.Base64.getEncoder()
            return EncryptedVaultPayload(
                ciphertext = b64Encoder.encodeToString(ciphertext),
                iv = b64Encoder.encodeToString(iv),
                tag = b64Encoder.encodeToString(tag),
                version = version,
                synced = synced
            )
        }

        fun decryptPayload(payload: EncryptedVaultPayload, key: ByteArray): String {
            val b64Decoder = java.util.Base64.getDecoder()
            val iv = b64Decoder.decode(payload.iv)
            val ciphertext = b64Decoder.decode(payload.ciphertext)
            val tag = if (payload.tag.isNotEmpty()) b64Decoder.decode(payload.tag) else ByteArray(0)

            val combined = ByteArray(ciphertext.size + tag.size)
            System.arraycopy(ciphertext, 0, combined, 0, ciphertext.size)
            System.arraycopy(tag, 0, combined, ciphertext.size, tag.size)

            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val keySpec = SecretKeySpec(key, "AES")
            val gcmSpec = GCMParameterSpec(128, iv)
            cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec)
            val decrypted = cipher.doFinal(combined)
            return String(decrypted, Charsets.UTF_8)
        }
    }
}

/**
 * Delegator for dispatching derivation or secret access to paired companion clients.
 */
class PhoneCompanionDelegator : ICredentialGenerator, ICompanionDelegator {
    override val algorithmId: String = "companion-rpc"

    override fun supportsKind(kind: AssetKind): Boolean = true

    override fun supportsSource(source: DerivationSource): Boolean =
        source == DerivationSource.COMPANION

    override fun supportsAlgorithm(algoId: String?): Boolean = true

    override suspend fun requestCompanionDerivation(entity: AssetEntity, req: CompanionRequest): String {
        req.handler?.let { return it.invoke(entity, req) }

        val deviceId = req.deviceId ?: "default-companion-device"
        val action = req.action
        return """{"status":"approved","deviceId":"$deviceId","action":"$action","entityId":"${entity.id}"}"""
    }
}

// ---------------------------------------------------------------------------
// Generator Registry & Orchestrator (OCP / DIP)
// ---------------------------------------------------------------------------

/**
 * Thread-safe LIFO registry allowing dynamic discovery and registration of generators.
 */
class GeneratorRegistry {
    private val generators = CopyOnWriteArrayList<ICredentialGenerator>()

    fun register(generator: ICredentialGenerator): GeneratorRegistry {
        generators.add(generator)
        return this
    }

    fun unregister(algorithmId: String) {
        generators.removeIf { it.algorithmId.equals(algorithmId, ignoreCase = true) }
    }

    fun unregister(generator: ICredentialGenerator) {
        generators.remove(generator)
    }

    fun findGenerator(
        kind: AssetKind,
        source: DerivationSource,
        algorithmId: String? = null
    ): ICredentialGenerator? {
        // Search in LIFO order (latest registered generator takes precedence)
        for (i in generators.size - 1 downTo 0) {
            val g = generators[i]
            if (g.supportsKind(kind) && g.supportsSource(source) && g.supportsAlgorithm(algorithmId)) {
                return g
            }
        }
        return null
    }

    fun getAllGenerators(): List<ICredentialGenerator> = generators.toList()

    companion object {
        fun createDefault(): GeneratorRegistry = GeneratorRegistry().apply {
            register(KeygrainV5DeterministicGenerator())
            register(StoredVaultResolver())
            register(PhoneCompanionDelegator())
        }
    }
}

/**
 * High-level polymorphic credential resolver orchestrator.
 */
class CredentialResolverOrchestrator(
    private val registry: GeneratorRegistry = GeneratorRegistry.createDefault()
) {
    fun getRegistry(): GeneratorRegistry = registry

    fun registerGenerator(generator: ICredentialGenerator): CredentialResolverOrchestrator {
        registry.register(generator)
        return this
    }

    suspend fun resolvePassword(entity: LoginEntity, ctx: DerivationContext): String {
        val generator = registry.findGenerator(entity.kind, entity.derivationSource, entity.algorithmId)
            ?: throw IllegalStateException("No registered generator found for kind='${entity.kind}', source='${entity.derivationSource}', algorithm='${entity.algorithmId}'")
        if (generator !is IPasswordGenerator) {
            throw UnsupportedCapabilityError("Generator '${generator.algorithmId}' does not implement IPasswordGenerator")
        }
        return generator.generatePassword(entity, ctx)
    }

    suspend fun resolveTotp(
        entity: LoginEntity,
        ctx: DerivationContext,
        timestampMs: Long = System.currentTimeMillis()
    ): TotpResult {
        val generator = registry.findGenerator(entity.kind, entity.derivationSource, entity.algorithmId)
            ?: throw IllegalStateException("No registered generator found for kind='${entity.kind}', source='${entity.derivationSource}', algorithm='${entity.algorithmId}'")
        if (generator !is ITotpGenerator) {
            throw UnsupportedCapabilityError("Generator '${generator.algorithmId}' does not implement ITotpGenerator")
        }
        return generator.generateTotp(entity, ctx, timestampMs)
    }

    suspend fun resolveSsh(entity: SshEntity, ctx: DerivationContext): SshKeypairResult {
        val generator = registry.findGenerator(entity.kind, entity.derivationSource, entity.algorithmId)
            ?: throw IllegalStateException("No registered generator found for kind='${entity.kind}', source='${entity.derivationSource}', algorithm='${entity.algorithmId}'")
        if (generator !is ISshGenerator) {
            throw UnsupportedCapabilityError("Generator '${generator.algorithmId}' does not implement ISshGenerator")
        }
        return generator.generateSshKeypair(entity, ctx)
    }

    suspend fun resolveWallet(entity: WalletEntity, ctx: DerivationContext): WalletMnemonicResult {
        val generator = registry.findGenerator(entity.kind, entity.derivationSource, entity.algorithmId)
            ?: throw IllegalStateException("No registered generator found for kind='${entity.kind}', source='${entity.derivationSource}', algorithm='${entity.algorithmId}'")
        if (generator !is IWalletGenerator) {
            throw UnsupportedCapabilityError("Generator '${generator.algorithmId}' does not implement IWalletGenerator")
        }
        return generator.generateWallet(entity, ctx)
    }

    suspend fun resolveStoredVault(entity: LoginEntity, ctx: DerivationContext): String {
        val generator = registry.findGenerator(entity.kind, entity.derivationSource, entity.algorithmId)
            ?: throw IllegalStateException("No registered generator found for kind='${entity.kind}', source='${entity.derivationSource}', algorithm='${entity.algorithmId}'")
        if (generator !is IStoredVaultResolver) {
            throw UnsupportedCapabilityError("Generator '${generator.algorithmId}' does not implement IStoredVaultResolver")
        }
        return generator.decryptStoredVault(entity, ctx)
    }

    suspend fun resolveCompanion(entity: AssetEntity, req: CompanionRequest): String {
        val generator = registry.findGenerator(entity.kind, entity.derivationSource, entity.algorithmId)
            ?: throw IllegalStateException("No registered generator found for kind='${entity.kind}', source='${entity.derivationSource}', algorithm='${entity.algorithmId}'")
        if (generator !is ICompanionDelegator) {
            throw UnsupportedCapabilityError("Generator '${generator.algorithmId}' does not implement ICompanionDelegator")
        }
        return generator.requestCompanionDerivation(entity, req)
    }

    suspend fun resolve(
        entity: AssetEntity,
        action: String,
        ctx: DerivationContext,
        options: Map<String, Any?> = emptyMap()
    ): Any {
        val normalizedAction = action.lowercase().trim()
        val algoId = options["algorithmId"] as? String ?: entity.algorithmId
        val generator = registry.findGenerator(entity.kind, entity.derivationSource, algoId)
            ?: throw IllegalStateException("No registered generator found for kind='${entity.kind}', source='${entity.derivationSource}', algorithm='$algoId'")

        return when (normalizedAction) {
            "password", "generate_password", "generatepassword" -> {
                if (entity !is LoginEntity) throw IllegalArgumentException("Action '$action' requires LoginEntity")
                if (generator !is IPasswordGenerator) {
                    throw UnsupportedCapabilityError("Generator '${generator.algorithmId}' does not implement IPasswordGenerator")
                }
                generator.generatePassword(entity, ctx)
            }
            "totp", "generate_totp", "generatetotp" -> {
                if (entity !is LoginEntity) throw IllegalArgumentException("Action '$action' requires LoginEntity")
                if (generator !is ITotpGenerator) {
                    throw UnsupportedCapabilityError("Generator '${generator.algorithmId}' does not implement ITotpGenerator")
                }
                val ts = options["timestampMs"] as? Long ?: System.currentTimeMillis()
                generator.generateTotp(entity, ctx, ts)
            }
            "ssh", "generate_ssh_keypair", "ssh_keypair", "generatesshkeypair" -> {
                if (entity !is SshEntity) throw IllegalArgumentException("Action '$action' requires SshEntity")
                if (generator !is ISshGenerator) {
                    throw UnsupportedCapabilityError("Generator '${generator.algorithmId}' does not implement ISshGenerator")
                }
                generator.generateSshKeypair(entity, ctx)
            }
            "wallet", "generate_wallet", "generate_wallet_mnemonic", "generatewalletmnemonic" -> {
                if (entity !is WalletEntity) throw IllegalArgumentException("Action '$action' requires WalletEntity")
                if (generator !is IWalletGenerator) {
                    throw UnsupportedCapabilityError("Generator '${generator.algorithmId}' does not implement IWalletGenerator")
                }
                generator.generateWallet(entity, ctx)
            }
            "stored_vault", "resolve_stored_vault", "resolvestoredvault", "decrypt_stored_vault" -> {
                if (entity !is LoginEntity) throw IllegalArgumentException("Action '$action' requires LoginEntity")
                if (generator !is IStoredVaultResolver) {
                    throw UnsupportedCapabilityError("Generator '${generator.algorithmId}' does not implement IStoredVaultResolver")
                }
                generator.decryptStoredVault(entity, ctx)
            }
            "companion", "request_companion_derivation", "requestcompanionderivation" -> {
                if (generator !is ICompanionDelegator) {
                    throw UnsupportedCapabilityError("Generator '${generator.algorithmId}' does not implement ICompanionDelegator")
                }
                val req = options["req"] as? CompanionRequest ?: CompanionRequest()
                generator.requestCompanionDerivation(entity, req)
            }
            else -> throw IllegalArgumentException("Unknown credential derivation action: '$action'")
        }
    }
}
