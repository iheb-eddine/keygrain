package com.secbytech.keygrain.domain

import com.secbytech.keygrain.data.Keygrain
import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.data.SshKeyEntry
import com.secbytech.keygrain.data.WalletEngine
import com.secbytech.keygrain.data.WalletEntry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.File

class AssetEntityTest {

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    @Before
    fun setUp() {
        Keygrain.clearStrengthenCache()
        val candidateFiles = listOf(
            File("src/main/res/raw/bip39_english.txt"),
            File("app/src/main/res/raw/bip39_english.txt"),
            File("../app/src/main/res/raw/bip39_english.txt")
        )
        for (f in candidateFiles) {
            if (f.isFile) {
                val words = f.readLines().filter { it.isNotEmpty() }
                if (words.size == 2048) {
                    val field = WalletEngine::class.java.getDeclaredField("wordlist")
                    field.isAccessible = true
                    field.set(WalletEngine, words)
                    break
                }
            }
        }
    }

    // =======================================================================
    // 1. Entity Creation, Typing, and Invariant Validations
    // =======================================================================

    @Test
    fun testCreateLoginEntityWithDefaults() {
        val entity = createLoginEntity(
            site = "github.com",
            username = "alice@example.com"
        )

        assertEquals(AssetKind.LOGIN, entity.kind)
        assertEquals("github.com", entity.site)
        assertEquals("alice@example.com", entity.username)
        assertEquals(20, entity.length)
        assertEquals(1, entity.counter)
        assertEquals("!@#$%&*-_=+?", entity.symbols)
        assertEquals("ascii-printable-v1", entity.characterPolicy)
        assertEquals(DerivationSource.DETERMINISTIC, entity.derivationSource)
        assertEquals("spec-v5", entity.algorithmId)
        assertFalse(entity.tombstoned)
        assertFalse(entity.migrating)
        assertNull(entity.vaultPayload)
        assertTrue(entity.id.isNotBlank())
        assertTrue(entity.createdAt > 0)
        assertTrue(entity.updatedAt > 0)
    }

    @Test
    fun testCreateSshEntityWithDefaults() {
        val entity = createSshEntity(
            label = "Production Bastion",
            keyName = "bastion-prod",
            counter = 2,
            comment = "bastion-prod"
        )

        assertEquals(AssetKind.SSH, entity.kind)
        assertEquals("Production Bastion", entity.label)
        assertEquals("bastion-prod", entity.keyName)
        assertEquals(2, entity.counter)
        assertEquals("bastion-prod", entity.comment)
        assertEquals(DerivationSource.DETERMINISTIC, entity.derivationSource)
        assertEquals("ed25519", entity.algorithmId)
        assertFalse(entity.tombstoned)

        assertEquals("prod-bastion", cleanKeyName("prod:bastion"))
        val colonEntity = createSshEntity(keyName = "prod:bastion")
        assertEquals("prod-bastion", colonEntity.keyName)
    }

    @Test
    fun testCreateWalletEntityWithDefaults() {
        val entity = createWalletEntity(
            label = "Cold Vault",
            walletId = "cold-vault-01",
            words = 12,
            counter = 1,
            notes = "Hardware safe backup"
        )

        assertEquals(AssetKind.WALLET, entity.kind)
        assertEquals("Cold Vault", entity.label)
        assertEquals("cold-vault-01", entity.walletId)
        assertEquals(12, entity.words)
        assertEquals("Hardware safe backup", entity.notes)
        assertEquals(DerivationSource.DETERMINISTIC, entity.derivationSource)
        assertEquals("bip39", entity.algorithmId)
        assertFalse(entity.tombstoned)
    }

    @Test
    fun testCreateGenericEntity() {
        val entity = createGenericEntity(
            label = "Recovery Instructions",
            tags = listOf("recovery", "admin"),
            customFields = mapOf("notes" to "Store in safe box B", "level" to 3)
        )

        assertEquals(AssetKind.NOTE, entity.kind)
        assertEquals("Recovery Instructions", entity.label)
        assertEquals(listOf("recovery", "admin"), entity.tags)
        assertEquals("Store in safe box B", entity.customFields["notes"])
        assertEquals(3, entity.customFields["level"])
    }

    @Test
    fun testEntityImmutabilityAndCopy() {
        val original = createLoginEntity(
            site = "gitlab.com",
            username = "dev@corp.internal",
            counter = 1
        )
        val modified = original.copy(counter = 2, frecency = 10.0)

        assertEquals(1, original.counter)
        assertEquals(0.0, original.frecency, 0.0001)
        assertEquals(2, modified.counter)
        assertEquals(10.0, modified.frecency, 0.0001)
        assertEquals(original.id, modified.id)
        assertEquals(original.site, modified.site)
    }

    @Test
    fun testValidationEnforcesInvariants() {
        // Invalid ID with whitespace or control characters
        try {
            LoginEntity(id = "bad id spaces", label = "Test", site = "test.com", username = "u")
            fail("Expected exception for ID with spaces")
        } catch (_: IllegalArgumentException) {}

        try {
            LoginEntity(id = "", label = "Test", site = "test.com", username = "u")
            fail("Expected exception for blank ID")
        } catch (_: IllegalArgumentException) {}

        // Blank label
        try {
            LoginEntity(id = "valid-id", label = "   ", site = "test.com", username = "u")
            fail("Expected exception for blank label")
        } catch (_: IllegalArgumentException) {}

        // Negative timestamps and frecency
        try {
            LoginEntity(label = "Test", site = "test.com", username = "u", createdAt = -1)
            fail("Expected exception for negative createdAt")
        } catch (_: IllegalArgumentException) {}

        try {
            LoginEntity(label = "Test", site = "test.com", username = "u", frecency = -5.0)
            fail("Expected exception for negative frecency")
        } catch (_: IllegalArgumentException) {}

        // Invalid login length and counter
        try {
            LoginEntity(label = "Test", site = "test.com", username = "u", length = 2)
            fail("Expected exception for length < 4")
        } catch (_: IllegalArgumentException) {}

        try {
            LoginEntity(label = "Test", site = "test.com", username = "u", length = 200)
            fail("Expected exception for length > 128")
        } catch (_: IllegalArgumentException) {}

        try {
            LoginEntity(label = "Test", site = "test.com", username = "u", counter = 0)
            fail("Expected exception for counter < 1")
        } catch (_: IllegalArgumentException) {}

        // Invalid SSH keyName (colons or control chars)
        try {
            SshEntity(label = "Test", keyName = "host:port", counter = 1)
            fail("Expected exception for SSH keyName with colon")
        } catch (_: IllegalArgumentException) {}

        // Invalid Wallet words and slug
        try {
            WalletEntity(label = "Test", walletId = "wallet-1", words = 16, counter = 1)
            fail("Expected exception for wallet words != 12 and != 24")
        } catch (_: IllegalArgumentException) {}

        try {
            WalletEntity(label = "Test", walletId = "Invalid_Slug!", words = 24, counter = 1)
            fail("Expected exception for invalid wallet slug")
        } catch (_: IllegalArgumentException) {}
    }

    // =======================================================================
    // 2. Legacy Bidirectional Conversion Fidelity
    // =======================================================================

    @Test
    fun testServiceEntryBidirectionalConversion() {
        val legacyService = ServiceEntry(
            id = "f47ac10b-58cc-4372-a567-0e02b2c3d479",
            name = "GitHub Enterprise",
            site = "github.com",
            email = "dev@corp.internal",
            length = 28,
            symbols = "!@#$%^&*()_+",
            counter = 3,
            frecency = 12.0,
            updatedAt = 1715000000000L,
            synced = true,
            migrating = true,
            totp = JSONObject().apply {
                put("type", "derived")
                put("counter", 1)
                put("step_seconds", 30)
                put("digits", 6)
                put("algorithm", "SHA1")
            }
        )

        val entity = legacyService.toAssetEntity()
        assertEquals(legacyService.id, entity.id)
        assertEquals(legacyService.name, entity.label)
        assertEquals("github.com", entity.site)
        assertEquals(legacyService.email, entity.username)
        assertEquals(28, entity.length)
        assertEquals("!@#$%^&*()_+", entity.symbols)
        assertEquals(3, entity.counter)
        assertEquals(12.0, entity.frecency, 0.0001)
        assertEquals(1715000000000L, entity.updatedAt)
        assertTrue(entity.synced)
        assertTrue(entity.migrating)
        assertEquals(DerivationSource.STORED, entity.derivationSource)
        assertNotNull(entity.totp)
        assertEquals("derived", entity.totp?.type)
        assertEquals(30, entity.totp?.stepSeconds)

        val back = entity.toServiceEntry()
        assertEquals(legacyService.id, back.id)
        assertEquals(legacyService.name, back.name)
        assertEquals(legacyService.site, back.site)
        assertEquals(legacyService.email, back.email)
        assertEquals(legacyService.length, back.length)
        assertEquals(legacyService.symbols, back.symbols)
        assertEquals(legacyService.counter, back.counter)
        assertEquals(legacyService.frecency, back.frecency, 0.0001)
        assertEquals(legacyService.updatedAt, back.updatedAt)
        assertEquals(legacyService.synced, back.synced)
        assertEquals(legacyService.migrating, back.migrating)
        assertEquals(legacyService.totp?.getString("type"), back.totp?.getString("type"))
        assertEquals(legacyService.totp?.getInt("step_seconds"), back.totp?.getInt("step_seconds"))
    }

    @Test
    fun testSshKeyEntryBidirectionalConversion() {
        val legacySsh = SshKeyEntry(
            id = "ssh-uuid-1234",
            keyName = "bastion-prod",
            counter = 2,
            comment = "ops-team@bastion",
            createdAt = 1714000000000L,
            updatedAt = 1715000000000L
        )

        val entity = legacySsh.toAssetEntity()
        assertEquals(legacySsh.id, entity.id)
        assertEquals("bastion-prod", entity.keyName)
        assertEquals(2, entity.counter)
        assertEquals("ops-team@bastion", entity.comment)
        assertEquals(1714000000000L, entity.createdAt)
        assertEquals(1715000000000L, entity.updatedAt)

        val back = entity.toSshKeyEntry()
        assertEquals(legacySsh.id, back.id)
        assertEquals(legacySsh.keyName, back.keyName)
        assertEquals(legacySsh.counter, back.counter)
        assertEquals(legacySsh.comment, back.comment)
        assertEquals(legacySsh.createdAt, back.createdAt)
        assertEquals(legacySsh.updatedAt, back.updatedAt)
    }

    @Test
    fun testWalletEntryBidirectionalConversion() {
        val legacyWallet = WalletEntry(
            id = "wallet-uuid-5678",
            walletId = "cold-storage",
            label = "Cold Storage Vault",
            words = 12,
            counter = 2,
            notes = "Stored in physical safe",
            synced = true,
            createdAt = "1714000000000",
            updatedAt = "1715000000000"
        )

        val entity = legacyWallet.toAssetEntity()
        assertEquals(legacyWallet.id, entity.id)
        assertEquals("cold-storage", entity.walletId)
        assertEquals("Cold Storage Vault", entity.label)
        assertEquals(12, entity.words)
        assertEquals(2, entity.counter)
        assertEquals("Stored in physical safe", entity.notes)
        assertTrue(entity.synced)

        val back = entity.toWalletEntry()
        assertEquals(legacyWallet.id, back.id)
        assertEquals(legacyWallet.walletId, back.walletId)
        assertEquals(legacyWallet.label, back.label)
        assertEquals(legacyWallet.words, back.words)
        assertEquals(legacyWallet.counter, back.counter)
        assertEquals(legacyWallet.notes, back.notes)
        assertEquals(legacyWallet.synced, back.synced)
        assertEquals(legacyWallet.createdAt, back.createdAt)
        assertEquals(legacyWallet.updatedAt, back.updatedAt)
    }

    @Test
    fun testPolyglotCollectionRoundTrip() {
        val services = listOf(
            ServiceEntry(name = "GitHub", site = "github.com", email = "alice@example.com")
        )
        val sshKeys = listOf(
            SshKeyEntry(keyName = "dev-key", comment = "dev key")
        )
        val wallets = listOf(
            WalletEntry(walletId = "savings", words = 24)
        )

        val unified = toUnifiedEntities(services, sshKeys, wallets)
        assertEquals(3, unified.size)
        assertTrue(unified[0] is LoginEntity)
        assertTrue(unified[1] is SshEntity)
        assertTrue(unified[2] is WalletEntity)

        val collections = fromUnifiedEntities(unified)
        assertEquals(1, collections.services.size)
        assertEquals(1, collections.sshKeys.size)
        assertEquals(1, collections.wallets.size)
        assertEquals("github.com", collections.services[0].site)
        assertEquals("dev-key", collections.sshKeys[0].keyName)
        assertEquals("savings", collections.wallets[0].walletId)
    }

    // =======================================================================
    // 3. toMetadataDescriptor Zero-Knowledge Security Audit
    // =======================================================================

    @Test
    fun testMetadataDescriptorZeroKnowledgeAudit() {
        val vaultPayload = EncryptedVaultPayload(
            ciphertext = "c2VjcmV0LWNpcGhlcnRleHQ=",
            iv = "MTIzNDU2Nzg5MDEy",
            tag = "YXV0aC10YWctMTIzNA==",
            version = 1
        )
        val login = createLoginEntity(
            site = "bank.com",
            username = "admin@bank.com",
            label = "Bank Portal",
            totp = TotpConfig(type = "stored", seed = "JBSWY3DPEHPK3PXP"),
            vaultPayload = vaultPayload,
            migrating = true,
            counter = 3
        )

        val descriptor = login.toMetadataDescriptor()

        // Verify public descriptor properties
        assertEquals(login.id, descriptor.id)
        assertEquals(AssetKind.LOGIN, descriptor.kind)
        assertEquals("Bank Portal", descriptor.title)
        assertEquals("admin@bank.com • bank.com", descriptor.subtitle)

        // Zero-Knowledge audit: NO secret tokens may appear in metadata descriptor
        val allDescriptorStrings = listOf(
            descriptor.title,
            descriptor.subtitle,
            descriptor.badges.joinToString(" "),
            descriptor.searchTerms.joinToString(" ")
        ).joinToString(" ").lowercase()

        assertFalse(allDescriptorStrings.contains("c2vjcmv0"))
        assertFalse(allDescriptorStrings.contains("jbswy3dpehpk3pxp"))
        assertFalse(allDescriptorStrings.contains("ciphertext"))
        assertFalse(allDescriptorStrings.contains("vaultpayload"))

        // Check badges and capabilities
        assertTrue(descriptor.badges.contains("TOTP"))
        assertTrue(descriptor.badges.contains("v3"))
        assertTrue(descriptor.badges.contains("MIGRATE"))
        assertTrue(descriptor.badges.contains("STORED"))

        assertTrue(descriptor.capabilities.contains("GENERATE_PASSWORD"))
        assertTrue(descriptor.capabilities.contains("AUTOFILL_LOGIN"))
        assertTrue(descriptor.capabilities.contains("GENERATE_TOTP"))
        assertTrue(descriptor.capabilities.contains("RESOLVE_STORED_VAULT"))
    }

    @Test
    fun testSshAndWalletMetadataDescriptorBadgesAndCapabilities() {
        val ssh = createSshEntity(
            keyName = "prod-bastion",
            label = "Production Bastion",
            counter = 2,
            comment = "prod-bastion-key"
        )
        val sshDesc = ssh.toMetadataDescriptor()
        assertEquals("Production Bastion", sshDesc.title)
        assertEquals("prod-bastion-key", sshDesc.subtitle)
        assertTrue(sshDesc.badges.contains("ED25519"))
        assertTrue(sshDesc.badges.contains("v2"))
        assertTrue(sshDesc.capabilities.contains("GENERATE_SSH_KEYPAIR"))
        assertTrue(sshDesc.capabilities.contains("EXPORT_PUBLIC_KEY"))

        val wallet = createWalletEntity(
            walletId = "mainnet-vault",
            label = "Mainnet Vault",
            words = 24,
            counter = 2
        )
        val walletDesc = wallet.toMetadataDescriptor()
        assertEquals("Mainnet Vault", walletDesc.title)
        assertEquals("24 words • counter 2", walletDesc.subtitle)
        assertTrue(walletDesc.badges.contains("BIP-39 24w"))
        assertTrue(walletDesc.badges.contains("v2"))
        assertTrue(walletDesc.capabilities.contains("GENERATE_WALLET_MNEMONIC"))
        assertTrue(walletDesc.capabilities.contains("DERIVE_WALLET_SEED"))
    }

    // =======================================================================
    // 4. Open/Closed Principle (OCP) Dynamic Extension
    // =======================================================================

    @Test
    fun testOcpDynamicCustomGeneratorRegistration() = runBlocking {
        val orchestrator = CredentialResolverOrchestrator()

        // Create a custom generator for a new source or algorithm without modifying core classes
        val customGenerator = object : ICredentialGenerator, IPasswordGenerator {
            override val algorithmId: String = "custom-passkey-v1"
            override fun supportsKind(kind: AssetKind): Boolean = kind == AssetKind.LOGIN
            override fun supportsSource(source: DerivationSource): Boolean = source == DerivationSource.DETERMINISTIC
            override fun supportsAlgorithm(algoId: String?): Boolean = algoId == "custom-passkey-v1"

            override suspend fun generatePassword(entity: LoginEntity, ctx: DerivationContext): String {
                return "CUSTOM_DERIVED_FOR_${entity.site.uppercase()}"
            }
        }

        orchestrator.registerGenerator(customGenerator)

        val entity = createLoginEntity(
            site = "secure.service.io",
            username = "alice",
            algorithmId = "custom-passkey-v1"
        )
        val ctx = DerivationContext("dummy-secret", "alice@example.com")

        val result = orchestrator.resolvePassword(entity, ctx)
        assertEquals("CUSTOM_DERIVED_FOR_SECURE.SERVICE.IO", result)
    }

    // =======================================================================
    // 5. Interface Segregation Principle (ISP) Enforcement
    // =======================================================================

    @Test
    fun testIspCapabilityEnforcementCleanFailures() = runBlocking {
        // A password-only generator that intentionally omits ISshGenerator, IWalletGenerator, ITotpGenerator
        val passwordOnlyGenerator = object : ICredentialGenerator, IPasswordGenerator {
            override val algorithmId: String = "strict-password-only"
            override fun supportsKind(kind: AssetKind): Boolean = true
            override fun supportsSource(source: DerivationSource): Boolean = true

            override suspend fun generatePassword(entity: LoginEntity, ctx: DerivationContext): String = "secret"
        }

        val registry = GeneratorRegistry()
        registry.register(passwordOnlyGenerator)
        val orchestrator = CredentialResolverOrchestrator(registry)
        val ctx = DerivationContext("secret", "test@example.com")

        // Calling password succeeds
        val login = createLoginEntity(site = "test.com", username = "alice", algorithmId = "strict-password-only")
        assertEquals("secret", orchestrator.resolvePassword(login, ctx))

        // Calling wallet on password-only generator cleanly throws UnsupportedCapabilityError
        val wallet = createWalletEntity(walletId = "my-wallet", algorithmId = "strict-password-only")
        try {
            orchestrator.resolveWallet(wallet, ctx)
            fail("Expected UnsupportedCapabilityError when resolving wallet on password-only generator")
        } catch (e: UnsupportedCapabilityError) {
            assertTrue(e.message?.contains("does not implement IWalletGenerator") == true)
        }

        // Calling SSH on password-only generator cleanly throws UnsupportedCapabilityError
        val ssh = createSshEntity(keyName = "my-ssh", algorithmId = "strict-password-only")
        try {
            orchestrator.resolveSsh(ssh, ctx)
            fail("Expected UnsupportedCapabilityError when resolving SSH on password-only generator")
        } catch (e: UnsupportedCapabilityError) {
            assertTrue(e.message?.contains("does not implement ISshGenerator") == true)
        }
    }

    // =======================================================================
    // 6. Integration with KeygrainV5DeterministicGenerator (Exact Vectors)
    // =======================================================================

    @Test
    fun testKeygrainV5DeterministicPasswordDerivationVector() = runBlocking {
        val orchestrator = CredentialResolverOrchestrator()
        val ctx = DerivationContext("my-master-secret", "test@gmail.com")

        val entity = createLoginEntity(
            site = "github.com",
            username = "test@gmail.com",
            length = 20,
            symbols = "!@#$%&*-_=+?",
            counter = 1
        )

        val password = orchestrator.resolvePassword(entity, ctx)
        assertEquals("?X_BAbv4UHAfw=kYV\$mh", password)
    }

    @Test
    fun testKeygrainV5DeterministicSshDerivationVector() = runBlocking {
        val orchestrator = CredentialResolverOrchestrator()
        val ctx = DerivationContext("my-master-secret", "test@gmail.com")

        val entity = createSshEntity(
            keyName = "github",
            counter = 1
        )

        val result = orchestrator.resolveSsh(entity, ctx)
        assertEquals(
            "54b4a6dc5d9d1147fcd50f7263ffeedb50b05b40de553105d552805a3fd09864",
            bytesToHex(result.seed)
        )
        assertEquals(
            "dd030383ed8e7b36807de678341bdab0606d17336ff64bf66f46c1129649b011",
            bytesToHex(result.rawPublicKey)
        )
        assertEquals(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIN0DA4Ptjns2gH3meDQb2rBgbRczb/ZL9m9GwRKWSbAR github",
            result.publicKey
        )
    }

    @Test
    fun testKeygrainV5DeterministicWalletDerivationVector() = runBlocking {
        val orchestrator = CredentialResolverOrchestrator()
        val ctx = DerivationContext("my-master-secret", "test@gmail.com")

        val entity = createWalletEntity(
            walletId = "personal",
            words = 24,
            counter = 1
        )

        val result = orchestrator.resolveWallet(entity, ctx)
        assertEquals(
            "issue genuine cute milk orphan network shove urban hungry lucky catalog boss laundry people stuff during little cousin april remind legal wash memory announce",
            result.mnemonic
        )
        assertNotNull(result.seed)
    }

    @Test
    fun testStoredVaultResolverAes256GcmRoundTrip() = runBlocking {
        val orchestrator = CredentialResolverOrchestrator()
        val secret = "my-master-secret"
        val email = "test@gmail.com"
        val ctx = DerivationContext(secret, email)

        // Derive vault key
        val secretBytes = secret.toByteArray(Charsets.UTF_8)
        val strengthened = Keygrain.strengthenSecret(secretBytes, email)
        val message = "$email:keygrain-legacy-vault".toByteArray(Charsets.UTF_8)
        val vaultKey = Keygrain.hmacSha256(strengthened, message)

        val plaintextPassword = "P@ssw0rd-Unmigrated-12345!"
        val encryptedPayload = StoredVaultResolver.encrypt(plaintextPassword, vaultKey)

        val entity = createLoginEntity(
            site = "legacy-service.com",
            username = "user@test.com",
            vaultPayload = encryptedPayload,
            migrating = true
        )

        val decrypted = orchestrator.resolveStoredVault(entity, ctx)
        assertEquals(plaintextPassword, decrypted)
    }

    @Test
    fun testCompanionDelegatorExecution() = runBlocking {
        val orchestrator = CredentialResolverOrchestrator()
        val entity = createGenericEntity(
            label = "Companion Item",
            derivationSource = DerivationSource.COMPANION,
            algorithmId = "companion-rpc"
        )
        val req = CompanionRequest(
            deviceId = "phone-pixel-8",
            action = "AUTHORIZE_PAYMENT",
            handler = { ent, r -> "COMPANION_ACK:${r.deviceId}:${ent.id}" }
        )

        val response = orchestrator.resolveCompanion(entity, req)
        assertEquals("COMPANION_ACK:phone-pixel-8:${entity.id}", response)
    }

    // =======================================================================
    // 7. Autofill Domain Matching
    // =======================================================================

    @Test
    fun testAutofillMatchingRules() {
        val login = createLoginEntity(
            site = "github.com",
            username = "alice@example.com",
            totp = TotpConfig(counter = 1)
        )

        // Exact match
        assertTrue(login.matchesAutofill("github.com"))
        assertTrue(login.matchesAutofill("https://github.com/login"))
        assertTrue(login.matchesAutofill("https://www.github.com"))

        // Subdomain match
        assertTrue(login.matchesAutofill("gist.github.com"))
        assertTrue(login.matchesAutofill("api.github.com:8080"))

        // Mismatched domain
        assertFalse(login.matchesAutofill("gitlab.com"))
        assertFalse(login.matchesAutofill("notgithub.com"))

        // Context checks: OTP requires TOTP
        assertTrue(login.matchesAutofill("github.com", AutofillContext(isOtp = true)))
        val noTotpLogin = createLoginEntity(site = "github.com", username = "bob")
        assertFalse(noTotpLogin.matchesAutofill("github.com", AutofillContext(isOtp = true)))

        // Page email corroboration
        assertTrue(login.matchesAutofill("github.com", AutofillContext(pageEmail = "alice@example.com")))
        assertFalse(login.matchesAutofill("github.com", AutofillContext(pageEmail = "wrong@example.com")))

        // Tombstoned entities never match
        val tombstoned = login.copy(tombstoned = true)
        assertFalse(tombstoned.matchesAutofill("github.com"))

        // Web3 wallet matching
        val web3Wallet = createWalletEntity(
            walletId = "web3-main",
            tags = listOf("uniswap.org")
        )
        assertTrue(web3Wallet.matchesAutofill("uniswap.org", AutofillContext(isWeb3 = true)))
        assertFalse(web3Wallet.matchesAutofill("google.com", AutofillContext(isWeb3 = true)))
        assertFalse(web3Wallet.matchesAutofill("uniswap.org", AutofillContext(isWeb3 = false)))
    }
}
