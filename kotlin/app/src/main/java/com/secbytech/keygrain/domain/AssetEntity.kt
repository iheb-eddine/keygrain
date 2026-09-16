package com.secbytech.keygrain.domain

import com.secbytech.keygrain.data.Keygrain
import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.data.SshKeyEntry
import com.secbytech.keygrain.data.WalletEntry
import org.json.JSONObject
import java.util.UUID

/**
 * Discriminated asset classifications.
 * Closed for modification to enable exhaustive classification across UI and sync layers (OCP/LSP).
 */
enum class AssetKind {
    LOGIN,
    SSH,
    WALLET,
    NOTE
}

/**
 * Sovereign derivation and retrieval source classifications.
 */
enum class DerivationSource {
    DETERMINISTIC,
    STORED,
    COMPETITOR,
    COMPANION
}

/**
 * Normalizes host/domain removing protocol, paths, query, trailing slashes, and 'www.'.
 */
fun normalizeSiteDomain(site: String): String {
    if (site.isBlank()) return ""
    return site
        .replace(Regex("^https?://", RegexOption.IGNORE_CASE), "")
        .split("/")[0]
        .split("?")[0]
        .split("#")[0]
        .trimEnd('/')
        .lowercase()
        .removePrefix("www.")
}

/**
 * Cleans an SSH key derivation name.
 */
fun cleanKeyName(keyName: String): String {
    if (keyName.isBlank()) return ""
    return keyName.trim().replace(Regex("\\s+"), "-").lowercase()
}

/**
 * Cleans a wallet slug identifier.
 */
fun cleanWalletId(walletId: String): String {
    val trimmed = walletId.trim().lowercase()
    return if (trimmed.matches(Regex("^[a-z0-9\\-]+$"))) trimmed else "wallet"
}

/**
 * Reversible encrypted vault ciphertext payload (e.g. for legacy manager migration).
 */
data class EncryptedVaultPayload(
    val ciphertext: String,
    val iv: String,
    val tag: String,
    val version: Int = 1,
    val synced: Boolean = false
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("ciphertext", ciphertext)
        put("iv", iv)
        put("tag", tag)
        put("version", version)
        if (synced) put("synced", true)
    }

    companion object {
        fun fromJson(json: JSONObject): EncryptedVaultPayload = EncryptedVaultPayload(
            ciphertext = json.getString("ciphertext"),
            iv = json.getString("iv"),
            tag = json.optString("tag", ""),
            version = json.optInt("version", 1),
            synced = json.optBoolean("synced", false)
        )
    }
}

/**
 * Configuration parameters for TOTP generation.
 */
data class TotpConfig(
    val type: String = "derived",
    val counter: Int = 1,
    val stepSeconds: Int = 30,
    val digits: Int = 6,
    val algorithm: String = "SHA1",
    val seed: String? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("type", type)
        put("counter", counter)
        put("step_seconds", stepSeconds)
        put("digits", digits)
        put("algorithm", algorithm)
        if (seed != null) put("seed", seed)
    }

    companion object {
        fun fromJson(json: JSONObject): TotpConfig = TotpConfig(
            type = json.optString("type", json.optString("mode", "derived")),
            counter = json.optInt("counter", 1),
            stepSeconds = json.optInt("step_seconds", json.optInt("period", 30)),
            digits = json.optInt("digits", 6),
            algorithm = json.optString("algorithm", "SHA1").uppercase(),
            seed = json.optString("seed").takeIf { it.isNotEmpty() }
        )
    }
}

/**
 * Root polymorphic entity interface adhering strictly to SOLID principles (SRP, OCP, LSP).
 * Encapsulates immutable identity, classification, and rotation state.
 */
sealed interface AssetEntity {
    val id: String
    val label: String
    val kind: AssetKind
    val derivationSource: DerivationSource
    val algorithmId: String
    val createdAt: Long
    val updatedAt: Long
    val synced: Boolean
    val tags: List<String>
    val frecency: Double
    val tombstoned: Boolean
}

/**
 * Login asset entity for passwords and TOTP codes.
 */
data class LoginEntity(
    override val id: String = UUID.randomUUID().toString(),
    override val label: String,
    val site: String,
    val username: String,
    val length: Int = 20,
    val symbols: String = Keygrain.DEFAULT_SYMBOLS,
    val counter: Int = 1,
    val characterPolicy: String? = "ascii-printable-v1",
    val totp: TotpConfig? = null,
    val migrating: Boolean = false,
    val vaultPayload: EncryptedVaultPayload? = null,
    override val kind: AssetKind = AssetKind.LOGIN,
    override val derivationSource: DerivationSource = if (vaultPayload != null || migrating) DerivationSource.STORED else DerivationSource.DETERMINISTIC,
    override val algorithmId: String = if (vaultPayload != null) "aes-256-gcm" else "spec-v5",
    override val createdAt: Long = System.currentTimeMillis(),
    override val updatedAt: Long = System.currentTimeMillis(),
    override val synced: Boolean = false,
    override val tags: List<String> = emptyList(),
    override val frecency: Double = 0.0,
    override val tombstoned: Boolean = false
) : AssetEntity {
    init {
        require(id.isNotBlank() && !id.any { it.isWhitespace() || it.code in 0..31 || it.code == 127 }) {
            "Invalid entity id: must be a non-empty identifier without whitespace or control chars"
        }
        require(label.isNotBlank()) { "Entity label must be a non-empty string" }
        require(createdAt >= 0) { "createdAt must be a non-negative integer" }
        require(updatedAt >= 0) { "updatedAt must be a non-negative integer" }
        require(frecency >= 0.0) { "frecency must be a non-negative number" }
        require(site.isNotBlank()) { "Login entity must specify a non-empty site" }
        require(length in 4..128) { "Login entity length must be an integer between 4 and 128" }
        require(counter >= 1) { "Login entity counter must be an integer >= 1" }
        require(symbols.isNotEmpty()) { "Login entity symbols must be a non-empty string" }
    }
}

/**
 * Ed25519 SSH keypair derivation entity.
 */
data class SshEntity(
    override val id: String = UUID.randomUUID().toString(),
    override val label: String,
    val keyName: String,
    val counter: Int = 1,
    val comment: String = keyName,
    val publicKey: String = "",
    val fingerprint: String = "",
    override val kind: AssetKind = AssetKind.SSH,
    override val derivationSource: DerivationSource = DerivationSource.DETERMINISTIC,
    override val algorithmId: String = "ed25519",
    override val createdAt: Long = System.currentTimeMillis(),
    override val updatedAt: Long = System.currentTimeMillis(),
    override val synced: Boolean = false,
    override val tags: List<String> = emptyList(),
    override val frecency: Double = 0.0,
    override val tombstoned: Boolean = false
) : AssetEntity {
    init {
        require(id.isNotBlank() && !id.any { it.isWhitespace() || it.code in 0..31 || it.code == 127 }) {
            "Invalid entity id: must be a non-empty identifier without whitespace or control chars"
        }
        require(label.isNotBlank()) { "Entity label must be a non-empty string" }
        require(createdAt >= 0) { "createdAt must be a non-negative integer" }
        require(updatedAt >= 0) { "updatedAt must be a non-negative integer" }
        require(frecency >= 0.0) { "frecency must be a non-negative number" }
        require(keyName.isNotBlank()) { "SSH entity must specify a non-empty keyName" }
        require(!keyName.contains(":") && !keyName.any { it.code in 0..31 || it.code == 127 }) {
            "SSH keyName must not contain colons or control characters"
        }
        require(counter >= 1) { "SSH entity counter must be an integer >= 1" }
    }
}

/**
 * BIP-39 HD wallet seed phrase derivation entity.
 * In accordance with Spec v5, derivation depends solely on:
 *   - Cryptographic parameters: walletId, words (12 | 24), counter
 *   - Metadata parameters: label, notes
 *   - Output: 12 or 24-word BIP-39 mnemonic seed phrase
 * Derivation is decoupled from external network identifiers and not part of the derivation spec.
 */
data class WalletEntity(
    override val id: String = UUID.randomUUID().toString(),
    override val label: String,
    val walletId: String,
    val words: Int = 24,
    val counter: Int = 1,
    val notes: String = "",
    override val kind: AssetKind = AssetKind.WALLET,
    override val derivationSource: DerivationSource = DerivationSource.DETERMINISTIC,
    override val algorithmId: String = "bip39",
    override val createdAt: Long = System.currentTimeMillis(),
    override val updatedAt: Long = System.currentTimeMillis(),
    override val synced: Boolean = false,
    override val tags: List<String> = emptyList(),
    override val frecency: Double = 0.0,
    override val tombstoned: Boolean = false
) : AssetEntity {
    init {
        require(id.isNotBlank() && !id.any { it.isWhitespace() || it.code in 0..31 || it.code == 127 }) {
            "Invalid entity id: must be a non-empty identifier without whitespace or control chars"
        }
        require(label.isNotBlank()) { "Entity label must be a non-empty string" }
        require(createdAt >= 0) { "createdAt must be a non-negative integer" }
        require(updatedAt >= 0) { "updatedAt must be a non-negative integer" }
        require(frecency >= 0.0) { "frecency must be a non-negative number" }
        require(walletId.matches(Regex("^[a-z0-9\\-]+$"))) {
            "Wallet entity walletId must match /^[a-z0-9\\-]+$/, got '$walletId'"
        }
        require(words == 12 || words == 24) { "Wallet entity words must be 12 or 24, got $words" }
        require(counter >= 1) { "Wallet entity counter must be an integer >= 1" }
    }
}

/**
 * Generic note or custom companion asset entity.
 */
data class GenericEntity(
    override val id: String = UUID.randomUUID().toString(),
    override val label: String,
    override val kind: AssetKind = AssetKind.NOTE,
    override val derivationSource: DerivationSource = DerivationSource.DETERMINISTIC,
    override val algorithmId: String = "generic",
    override val createdAt: Long = System.currentTimeMillis(),
    override val updatedAt: Long = System.currentTimeMillis(),
    override val synced: Boolean = false,
    override val tags: List<String> = emptyList(),
    override val frecency: Double = 0.0,
    override val tombstoned: Boolean = false,
    val customFields: Map<String, Any?> = emptyMap()
) : AssetEntity {
    init {
        require(id.isNotBlank() && !id.any { it.isWhitespace() || it.code in 0..31 || it.code == 127 }) {
            "Invalid entity id: must be a non-empty identifier without whitespace or control chars"
        }
        require(label.isNotBlank()) { "Entity label must be a non-empty string" }
        require(createdAt >= 0) { "createdAt must be a non-negative integer" }
        require(updatedAt >= 0) { "updatedAt must be a non-negative integer" }
        require(frecency >= 0.0) { "frecency must be a non-negative number" }
    }
}

// ---------------------------------------------------------------------------
// Ergonomic Factory Functions (mirroring asset-entity.js)
// ---------------------------------------------------------------------------

fun createLoginEntity(
    site: String,
    username: String = "",
    label: String = "",
    id: String = UUID.randomUUID().toString(),
    length: Int = 20,
    symbols: String = Keygrain.DEFAULT_SYMBOLS,
    counter: Int = 1,
    characterPolicy: String? = "ascii-printable-v1",
    totp: TotpConfig? = null,
    migrating: Boolean = false,
    vaultPayload: EncryptedVaultPayload? = null,
    derivationSource: DerivationSource? = null,
    algorithmId: String? = null,
    createdAt: Long = System.currentTimeMillis(),
    updatedAt: Long = System.currentTimeMillis(),
    synced: Boolean = false,
    tags: List<String> = emptyList(),
    frecency: Double = 0.0,
    tombstoned: Boolean = false
): LoginEntity {
    val normSite = normalizeSiteDomain(site)
    val effectiveLabel = label.ifBlank { normSite.ifBlank { "Login" } }
    val effectiveSource = derivationSource ?: if (vaultPayload != null || migrating) DerivationSource.STORED else DerivationSource.DETERMINISTIC
    val effectiveAlgo = algorithmId ?: if (vaultPayload != null) "aes-256-gcm" else "spec-v5"

    return LoginEntity(
        id = id,
        label = effectiveLabel,
        site = normSite,
        username = username,
        length = length,
        symbols = symbols,
        counter = counter,
        characterPolicy = characterPolicy,
        totp = totp,
        migrating = migrating,
        vaultPayload = vaultPayload,
        kind = AssetKind.LOGIN,
        derivationSource = effectiveSource,
        algorithmId = effectiveAlgo,
        createdAt = createdAt,
        updatedAt = updatedAt,
        synced = synced,
        tags = tags,
        frecency = frecency,
        tombstoned = tombstoned
    )
}

fun createSshEntity(
    keyName: String,
    label: String = "",
    id: String = UUID.randomUUID().toString(),
    counter: Int = 1,
    comment: String = "",
    publicKey: String = "",
    fingerprint: String = "",
    derivationSource: DerivationSource = DerivationSource.DETERMINISTIC,
    algorithmId: String = "ed25519",
    createdAt: Long = System.currentTimeMillis(),
    updatedAt: Long = System.currentTimeMillis(),
    synced: Boolean = false,
    tags: List<String> = emptyList(),
    frecency: Double = 0.0,
    tombstoned: Boolean = false
): SshEntity {
    val cleanName = cleanKeyName(keyName)
    val effectiveLabel = label.ifBlank { cleanName.ifBlank { "SSH Key" } }
    val effectiveComment = comment.ifBlank { cleanName }

    return SshEntity(
        id = id,
        label = effectiveLabel,
        keyName = cleanName,
        counter = counter,
        comment = effectiveComment,
        publicKey = publicKey,
        fingerprint = fingerprint,
        kind = AssetKind.SSH,
        derivationSource = derivationSource,
        algorithmId = algorithmId,
        createdAt = createdAt,
        updatedAt = updatedAt,
        synced = synced,
        tags = tags,
        frecency = frecency,
        tombstoned = tombstoned
    )
}

fun createWalletEntity(
    walletId: String,
    label: String = "",
    id: String = UUID.randomUUID().toString(),
    words: Int = 24,
    counter: Int = 1,
    notes: String = "",
    derivationSource: DerivationSource = DerivationSource.DETERMINISTIC,
    algorithmId: String = "bip39",
    createdAt: Long = System.currentTimeMillis(),
    updatedAt: Long = System.currentTimeMillis(),
    synced: Boolean = false,
    tags: List<String> = emptyList(),
    frecency: Double = 0.0,
    tombstoned: Boolean = false
): WalletEntity {
    val cleanId = cleanWalletId(walletId)
    val effectiveLabel = label.ifBlank { cleanId.ifBlank { "Wallet" } }

    return WalletEntity(
        id = id,
        label = effectiveLabel,
        walletId = cleanId,
        words = words,
        counter = counter,
        notes = notes,
        kind = AssetKind.WALLET,
        derivationSource = derivationSource,
        algorithmId = algorithmId,
        createdAt = createdAt,
        updatedAt = updatedAt,
        synced = synced,
        tags = tags,
        frecency = frecency,
        tombstoned = tombstoned
    )
}

fun createGenericEntity(
    label: String,
    id: String = UUID.randomUUID().toString(),
    kind: AssetKind = AssetKind.NOTE,
    derivationSource: DerivationSource = DerivationSource.DETERMINISTIC,
    algorithmId: String = "generic",
    createdAt: Long = System.currentTimeMillis(),
    updatedAt: Long = System.currentTimeMillis(),
    synced: Boolean = false,
    tags: List<String> = emptyList(),
    frecency: Double = 0.0,
    tombstoned: Boolean = false,
    customFields: Map<String, Any?> = emptyMap()
): GenericEntity = GenericEntity(
    id = id,
    label = label.trim().ifBlank { "Generic Entity" },
    kind = kind,
    derivationSource = derivationSource,
    algorithmId = algorithmId,
    createdAt = createdAt,
    updatedAt = updatedAt,
    synced = synced,
    tags = tags,
    frecency = frecency,
    tombstoned = tombstoned,
    customFields = customFields
)

// ---------------------------------------------------------------------------
// Zero-Knowledge Safe Metadata Descriptor Projection (METADATA mode)
// ---------------------------------------------------------------------------

/**
 * Public sanitized projection for METADATA mode.
 * GUARANTEE: Contains zero master secrets, zero passwords, zero private keys,
 * zero mnemonic seeds, and zero ciphertext.
 */
data class MetadataDescriptor(
    val id: String,
    val kind: AssetKind,
    val title: String,
    val subtitle: String,
    val badges: List<String>,
    val searchTerms: List<String>,
    val frecency: Double,
    val capabilities: Set<String>
)

/**
 * Converts any AssetEntity into its sanitized, Zero-Knowledge MetadataDescriptor.
 */
fun AssetEntity.toMetadataDescriptor(): MetadataDescriptor {
    val searchTokenSet = mutableSetOf<String>()

    fun addSearchTokens(vararg values: String?) {
        for (value in values) {
            if (value.isNullOrBlank()) continue
            val tokens = value.lowercase().split(Regex("[\\s/:@#._\\-+]+"))
            for (token in tokens) {
                if (token.isNotEmpty()) searchTokenSet.add(token)
            }
        }
    }

    addSearchTokens(label)
    tags.forEach { addSearchTokens(it) }

    val badges = mutableListOf<String>()
    val capabilities = mutableSetOf<String>()
    val title = label
    val subtitle: String

    when (this) {
        is LoginEntity -> {
            subtitle = if (username.isNotEmpty() && site.isNotEmpty()) {
                if (site.equals(username, ignoreCase = true)) site else "$username • $site"
            } else {
                username.ifEmpty { site.ifEmpty { label } }
            }
            addSearchTokens(site, username)

            if (totp != null) badges.add("TOTP")
            if (counter > 1) badges.add("v$counter")
            if (migrating) badges.add("MIGRATE")
            if (derivationSource == DerivationSource.STORED || vaultPayload != null) badges.add("STORED")

            capabilities.add("GENERATE_PASSWORD")
            capabilities.add("AUTOFILL_LOGIN")
            if (totp != null) capabilities.add("GENERATE_TOTP")
            if (derivationSource == DerivationSource.STORED || vaultPayload != null) {
                capabilities.add("RESOLVE_STORED_VAULT")
            }
        }
        is SshEntity -> {
            subtitle = comment.ifEmpty { keyName }
            addSearchTokens(keyName, comment)

            badges.add("ED25519")
            if (counter > 1) badges.add("v$counter")

            capabilities.add("GENERATE_SSH_KEYPAIR")
            capabilities.add("EXPORT_PUBLIC_KEY")
            capabilities.add("EXPORT_PRIVATE_KEY")
        }
        is WalletEntity -> {
            subtitle = if (notes.isNotBlank()) notes else "$words words • counter $counter"
            addSearchTokens(walletId, notes)

            badges.add("BIP-39 ${words}w")
            if (counter > 1) badges.add("v$counter")

            capabilities.add("GENERATE_WALLET_MNEMONIC")
            capabilities.add("DERIVE_WALLET_SEED")
        }
        is GenericEntity -> {
            val notes = customFields["notes"]?.toString()
            subtitle = notes ?: if (tags.isNotEmpty()) tags.joinToString(", ") else label
            addSearchTokens(notes)
            capabilities.add("READ_NOTE")
        }
    }

    if (derivationSource == DerivationSource.COMPANION) {
        badges.add("COMPANION")
        capabilities.add("REQUEST_COMPANION_DERIVATION")
    } else if (derivationSource == DerivationSource.COMPETITOR) {
        badges.add("COMPETITOR")
    }

    return MetadataDescriptor(
        id = id,
        kind = kind,
        title = title,
        subtitle = subtitle,
        badges = badges,
        searchTerms = searchTokenSet.sorted(),
        frecency = frecency,
        capabilities = capabilities
    )
}

// ---------------------------------------------------------------------------
// Autofill Context & Domain Matching
// ---------------------------------------------------------------------------

data class AutofillContext(
    val isOtp: Boolean = false,
    val type: String = "",
    val pageEmail: String? = null,
    val isWeb3: Boolean = false
)

fun AssetEntity.matchesAutofill(host: String, context: AutofillContext = AutofillContext()): Boolean {
    if (tombstoned) return false
    if (host.isBlank()) return false

    val cleanHost = host.lowercase().trim()
        .replace(Regex("^https?://", RegexOption.IGNORE_CASE), "")
        .split("/")[0]
        .split(":")[0]

    if (cleanHost.isEmpty()) return false

    return when (this) {
        is LoginEntity -> {
            val normSite = site.lowercase().trim()
            if (normSite.isEmpty()) return false
            val hostMatches = cleanHost == normSite || cleanHost.endsWith(".$normSite")
            if (!hostMatches) return false

            if (context.isOtp || context.type.equals("totp", ignoreCase = true)) {
                return totp != null
            }

            if (!context.pageEmail.isNullOrBlank() && username.isNotBlank()) {
                return username.equals(context.pageEmail.trim(), ignoreCase = true)
            }

            true
        }
        is WalletEntity -> {
            val isWeb3Context = context.type.equals("wallet", ignoreCase = true) || context.isWeb3
            if (!isWeb3Context) return false

            if (tags.isNotEmpty()) {
                return tags.any { it.equals(cleanHost, ignoreCase = true) || cleanHost.endsWith(".$it") }
            }
            true
        }
        else -> false
    }
}

// ---------------------------------------------------------------------------
// Bidirectional Converters with Existing Legacy Models
// ---------------------------------------------------------------------------

private fun parseTimestamp(str: String): Long {
    if (str.isBlank()) return System.currentTimeMillis()
    str.toLongOrNull()?.let { return it }
    return try {
        java.time.Instant.parse(str).toEpochMilli()
    } catch (_: Exception) {
        System.currentTimeMillis()
    }
}

fun ServiceEntry.toAssetEntity(): LoginEntity {
    val cleanSite = normalizeSiteDomain(site)
    val cleanLabel = name.ifBlank { cleanSite.ifBlank { "Login" } }
    val totpConfig = totp?.let { TotpConfig.fromJson(it) }
    val source = if (migrating) DerivationSource.STORED else DerivationSource.DETERMINISTIC
    return LoginEntity(
        id = id ?: UUID.randomUUID().toString(),
        label = cleanLabel,
        site = cleanSite,
        username = email,
        length = length,
        symbols = symbols,
        counter = counter,
        characterPolicy = "ascii-printable-v1",
        totp = totpConfig,
        migrating = migrating,
        vaultPayload = null,
        derivationSource = source,
        algorithmId = "spec-v5",
        createdAt = updatedAt,
        updatedAt = updatedAt,
        synced = synced,
        tags = emptyList(),
        frecency = frecency,
        tombstoned = false
    )
}

fun LoginEntity.toServiceEntry(): ServiceEntry {
    return ServiceEntry(
        id = id,
        name = label,
        site = site,
        email = username,
        length = length,
        symbols = symbols,
        counter = counter,
        updatedAt = updatedAt,
        totp = totp?.toJson(),
        ssh = null,
        frecency = frecency,
        synced = synced,
        migrating = migrating
    )
}

fun SshKeyEntry.toAssetEntity(): SshEntity {
    val cleanKey = cleanKeyName(keyName)
    val cleanLabel = if (comment.isNotBlank()) comment.trim() else if (cleanKey.isNotBlank()) cleanKey else "SSH Key"
    return SshEntity(
        id = id,
        label = cleanLabel,
        keyName = cleanKey,
        counter = counter,
        comment = if (comment.isNotBlank()) comment.trim() else cleanKey,
        publicKey = "",
        fingerprint = "",
        derivationSource = DerivationSource.DETERMINISTIC,
        algorithmId = "ed25519",
        createdAt = createdAt,
        updatedAt = updatedAt,
        synced = false,
        tags = emptyList(),
        frecency = 0.0,
        tombstoned = false
    )
}

fun SshEntity.toSshKeyEntry(): SshKeyEntry {
    return SshKeyEntry(
        id = id,
        keyName = keyName,
        counter = counter,
        email = "",
        comment = comment,
        createdAt = createdAt,
        updatedAt = updatedAt
    )
}

fun WalletEntry.toAssetEntity(): WalletEntity {
    val rawId = if (walletId.isNotBlank()) walletId else if (walletName.isNotBlank()) walletName else id
    val cleanId = cleanWalletId(rawId)
    val cleanLabel = if (label.isNotBlank()) label.trim() else cleanId
    val parsedCreated = parseTimestamp(createdAt)
    val parsedUpdated = parseTimestamp(updatedAt)
    return WalletEntity(
        id = id,
        label = cleanLabel,
        walletId = cleanId,
        words = words,
        counter = counter,
        notes = notes,
        derivationSource = DerivationSource.DETERMINISTIC,
        algorithmId = "bip39",
        createdAt = parsedCreated,
        updatedAt = parsedUpdated,
        synced = synced,
        tags = emptyList(),
        frecency = 0.0,
        tombstoned = false
    )
}

fun WalletEntity.toWalletEntry(): WalletEntry {
    return WalletEntry(
        id = id,
        walletId = walletId,
        label = label,
        words = words,
        counter = counter,
        createdAt = createdAt.toString(),
        updatedAt = updatedAt.toString(),
        notes = notes,
        synced = synced,
        walletName = walletId,
        email = "",
        mode = "keygrain"
    )
}

data class UnifiedCollections(
    val services: List<ServiceEntry> = emptyList(),
    val sshKeys: List<SshKeyEntry> = emptyList(),
    val wallets: List<WalletEntry> = emptyList()
)

fun toUnifiedEntities(
    services: List<ServiceEntry> = emptyList(),
    sshKeys: List<SshKeyEntry> = emptyList(),
    wallets: List<WalletEntry> = emptyList()
): List<AssetEntity> {
    val result = mutableListOf<AssetEntity>()
    services.forEach { result.add(it.toAssetEntity()) }
    sshKeys.forEach { result.add(it.toAssetEntity()) }
    wallets.forEach { result.add(it.toAssetEntity()) }
    return result
}

fun fromUnifiedEntities(entities: List<AssetEntity>): UnifiedCollections {
    val services = mutableListOf<ServiceEntry>()
    val sshKeys = mutableListOf<SshKeyEntry>()
    val wallets = mutableListOf<WalletEntry>()

    for (entity in entities) {
        when (entity) {
            is LoginEntity -> services.add(entity.toServiceEntry())
            is SshEntity -> sshKeys.add(entity.toSshKeyEntry())
            is WalletEntity -> wallets.add(entity.toWalletEntry())
            else -> {}
        }
    }

    return UnifiedCollections(services, sshKeys, wallets)
}

fun UnifiedCollections.toUnifiedEntities(): List<AssetEntity> =
    toUnifiedEntities(services, sshKeys, wallets)

@JvmName("fromEntitiesList")
fun List<AssetEntity>.fromUnifiedEntities(): UnifiedCollections =
    fromUnifiedEntities(this)
