package com.secbytech.keygrain.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DemoDataTest {

    @Test
    fun demoConstantsAreConfigured() {
        assertEquals("demo-secret-keygrain", DemoData.DEMO_SECRET)
        assertEquals("demo@example.com", DemoData.DEMO_EMAIL)
    }

    @Test
    fun demoServicesReturnNonEmptyAndCoverAllCombinations() {
        val services = DemoData.getServices()
        assertEquals(8, services.size)

        // 1. GitHub: standard password, derived TOTP
        val github = services.first { it.name == "GitHub" }
        assertEquals("github.com", github.site)
        assertEquals(DemoData.DEMO_EMAIL, github.email)
        assertEquals(20, github.length)
        assertEquals(Keygrain.DEFAULT_SYMBOLS, github.symbols)
        assertEquals(1, github.counter)
        assertNotNull(github.totp)
        assertEquals("derived", github.totp!!.getString("mode"))
        assertEquals(6, github.totp!!.getInt("digits"))
        assertEquals(30, github.totp!!.getInt("period"))
        assertEquals("SHA1", github.totp!!.getString("algorithm"))

        // 2. Google: standard password, counter rotation (counter = 2)
        val google = services.first { it.name == "Google" }
        assertEquals(2, google.counter)
        assertEquals(20, google.length)
        assertEquals(Keygrain.DEFAULT_SYMBOLS, google.symbols)

        // 3. AWS Console: high-entropy password (length 32, complex symbols)
        val aws = services.first { it.name == "AWS Console" }
        assertEquals(32, aws.length)
        assertEquals("!@#$%^&*()-_=+[]{}|;:,.<>?", aws.symbols)
        assertEquals(1, aws.counter)

        // 4. Mobile Banking: short numeric PIN style (length 8, symbols "0123456789")
        val banking = services.first { it.name == "Mobile Banking" }
        assertEquals(8, banking.length)
        assertEquals("0123456789", banking.symbols)
        assertEquals(1, banking.counter)

        // 5. GitLab: stored Base32 TOTP (6-digit, 30s)
        val gitlab = services.first { it.name == "GitLab" }
        assertNotNull(gitlab.totp)
        assertEquals("stored", gitlab.totp!!.getString("mode"))
        assertEquals("JBSWY3DPEHPK3PXP", gitlab.totp!!.getString("secret"))
        assertEquals(6, gitlab.totp!!.getInt("digits"))
        assertEquals(30, gitlab.totp!!.getInt("period"))
        assertEquals("SHA1", gitlab.totp!!.getString("algorithm"))

        // 6. Corporate VPN: 8-digit, 60s period TOTP
        val vpn = services.first { it.name == "Corporate VPN" }
        assertNotNull(vpn.totp)
        assertEquals("stored", vpn.totp!!.getString("mode"))
        assertEquals("HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ", vpn.totp!!.getString("secret"))
        assertEquals(8, vpn.totp!!.getInt("digits"))
        assertEquals(60, vpn.totp!!.getInt("period"))
        assertEquals("SHA1", vpn.totp!!.getString("algorithm"))

        // 7. Home Router: local network site, username admin, length 16
        val router = services.first { it.name == "Home Router" }
        assertEquals("router.local", router.site)
        assertEquals("admin", router.email)
        assertEquals(16, router.length)

        // 8. Legacy Webmail: rotation checklist pending (migrating = true)
        val webmail = services.first { it.name == "Legacy Webmail" }
        assertTrue(webmail.migrating)
        assertEquals(20, webmail.length)

        // Verify all have IDs and valid updatedAt
        services.forEach { svc ->
            assertNotNull(svc.id)
            assertTrue(svc.id!!.isNotEmpty())
            assertTrue(svc.updatedAt > 0)
        }
    }

    @Test
    fun demoSshKeysReturnNonEmptyAndCoverAllCombinations() {
        val keys = DemoData.getSshKeys()
        assertEquals(4, keys.size)

        // 1. id_ed25519: standard default key, counter 1, comment "id_ed25519"
        val idEd = keys.first { it.keyName == "id_ed25519" }
        assertEquals(1, idEd.counter)
        assertEquals("id_ed25519", idEd.comment)

        // 2. github: personal developer key, counter 1, comment "demo@example.com:github"
        val gh = keys.first { it.keyName == "github" }
        assertEquals(1, gh.counter)
        assertEquals("demo@example.com:github", gh.comment)

        // 3. prod-bastion: rotated ops bastion key, counter 2, comment "ops-bastion-v2"
        val bastion = keys.first { it.keyName == "prod-bastion" }
        assertEquals(2, bastion.counter)
        assertEquals("ops-bastion-v2", bastion.comment)

        // 4. recovery-key: cold storage disaster recovery key, counter 1, comment "cold-storage-backup"
        val recovery = keys.first { it.keyName == "recovery-key" }
        assertEquals(1, recovery.counter)
        assertEquals("cold-storage-backup", recovery.comment)

        // Verify all have IDs and timestamps
        keys.forEach { key ->
            assertTrue(key.id.isNotEmpty())
            assertTrue(key.createdAt > 0)
            assertTrue(key.updatedAt > 0)
        }
    }

    @Test
    fun demoWalletsReturnNonEmptyAndCoverAllCombinations() {
        val wallets = DemoData.getWallets()
        assertEquals(4, wallets.size)

        // 1. primary-vault: 24-word universal master recovery seed, counter 1
        val primary = wallets.first { it.walletId == "primary-vault" }
        assertEquals(24, primary.words)
        assertEquals(1, primary.counter)
        assertEquals("Primary Cold Storage", primary.label)
        assertTrue(primary.notes.contains("Universal 24-word"))

        // 2. daily-hot-wallet: 12-word hot wallet, counter 1
        val daily = wallets.first { it.walletId == "daily-hot-wallet" }
        assertEquals(12, daily.words)
        assertEquals(1, daily.counter)
        assertEquals("Daily Hot Wallet", daily.label)

        // 3. trading-vault: 24-word seed with rotated counter (counter = 2)
        val trading = wallets.first { it.walletId == "trading-vault" }
        assertEquals(24, trading.words)
        assertEquals(2, trading.counter)
        assertEquals("Trading Vault (Rotated)", trading.label)

        // 4. hardware-signer: 12-word hardware signer backup, counter 1
        val hardware = wallets.first { it.walletId == "hardware-signer" }
        assertEquals(12, hardware.words)
        assertEquals(1, hardware.counter)
        assertEquals("Hardware Signer Backup", hardware.label)

        wallets.forEach { w ->
            assertTrue(w.id.isNotEmpty())
            assertTrue(w.walletId.isNotEmpty())
            assertTrue(w.words in listOf(12, 24))
        }
    }

    @Test
    fun demoDataGeneratesValidPasswordsAndKeys() {
        val secretBytes = DemoData.DEMO_SECRET.toByteArray()
        val services = DemoData.getServices()

        services.forEach { svc ->
            val password = Keygrain.derivePassword(
                secretBytes,
                svc.email,
                svc.site,
                svc.length,
                svc.symbols,
                svc.counter
            )
            assertEquals(svc.length, password.length)
            if (svc.symbols == "0123456789") {
                assertTrue("PIN should only have digits or letters", password.all { it.isLetterOrDigit() })
            }
        }

        // Test SSH key generation with demo items
        val sshKeys = DemoData.getSshKeys()
        sshKeys.forEach { key ->
            val kp = SshEngine.deriveSshKeypair(secretBytes, key.keyName, key.counter)
            assertNotNull(kp.publicKey)
            assertEquals(32, kp.publicKey.size)
            assertNotNull(kp.seed)
            assertEquals(32, kp.seed.size)
        }

        // Test Wallet entropy derivation with demo items
        val wallets = DemoData.getWallets()
        wallets.forEach { w ->
            val entropy = WalletEngine.deriveWalletEntropy(secretBytes, w.walletId, w.words, w.counter)
            val expectedBytes = if (w.words == 12) 16 else 32
            assertEquals(expectedBytes, entropy.size)
        }

        // Test TOTP code generation for services with TOTP
        val github = services.first { it.name == "GitHub" }
        val ghSeed = TotpEngine.deriveTotpSeed(secretBytes, github.email, github.site)
        val ghCode = TotpEngine.generateTotp(ghSeed, 1234567890L, 6, 30, "SHA1")
        assertEquals(6, ghCode.length)
        assertTrue(ghCode.all { it.isDigit() })

        val gitlab = services.first { it.name == "GitLab" }
        val gitlabSeed = TotpEngine.parseTotpInput(gitlab.totp!!.getString("secret")).seed
        val gitlabCode = TotpEngine.generateTotp(gitlabSeed, 1234567890L, 6, 30, "SHA1")
        assertEquals(6, gitlabCode.length)
        assertTrue(gitlabCode.all { it.isDigit() })

        val vpn = services.first { it.name == "Corporate VPN" }
        val vpnSeed = TotpEngine.parseTotpInput(vpn.totp!!.getString("secret")).seed
        val vpnCode = TotpEngine.generateTotp(vpnSeed, 1234567890L, 8, 60, "SHA1")
        assertEquals(8, vpnCode.length)
        assertTrue(vpnCode.all { it.isDigit() })
    }
}
