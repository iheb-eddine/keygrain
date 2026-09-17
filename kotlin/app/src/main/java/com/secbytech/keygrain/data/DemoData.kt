package com.secbytech.keygrain.data

import org.json.JSONObject

object DemoData {
    const val DEMO_SECRET = "demo-secret-keygrain"
    const val DEMO_EMAIL = "demo@example.com"

    fun getServices(): List<ServiceEntry> = listOf(
        // 1. GitHub: standard password (length 20, default symbols !-+?_., counter 1), TOTP derived (mode: "derived", digits: 6, period: 30, algo: "SHA1").
        ServiceEntry(
            id = "demo-svc-github",
            name = "GitHub",
            site = "github.com",
            email = DEMO_EMAIL,
            length = 20,
            symbols = Keygrain.DEFAULT_SYMBOLS,
            counter = 1,
            totp = JSONObject().apply {
                put("mode", "derived")
                put("digits", 6)
                put("period", 30)
                put("algo", "SHA1")
                put("algorithm", "SHA1")
            },
            updatedAt = 1000L
        ),
        // 2. Google: standard password, counter rotation (counter = 2, length 20).
        ServiceEntry(
            id = "demo-svc-google",
            name = "Google",
            site = "google.com",
            email = DEMO_EMAIL,
            length = 20,
            symbols = Keygrain.DEFAULT_SYMBOLS,
            counter = 2,
            updatedAt = 2000L
        ),
        // 3. AWS Console: high-entropy password (length 32, complex symbols !@#$%^&*()-_=+[]{}|;:,.<>?, counter 1).
        ServiceEntry(
            id = "demo-svc-aws",
            name = "AWS Console",
            site = "aws.amazon.com",
            email = DEMO_EMAIL,
            length = 32,
            symbols = "!@#$%^&*()-_=+[]{}|;:,.<>?",
            counter = 1,
            updatedAt = 3000L
        ),
        // 4. Mobile Banking: short numeric PIN style (length 8, symbols "0123456789", counter 1).
        ServiceEntry(
            id = "demo-svc-banking",
            name = "Mobile Banking",
            site = "bank.example.com",
            email = DEMO_EMAIL,
            length = 8,
            symbols = "0123456789",
            counter = 1,
            updatedAt = 4000L
        ),
        // 5. GitLab: stored Base32 TOTP (mode: "stored", secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 30, algo: "SHA1").
        ServiceEntry(
            id = "demo-svc-gitlab",
            name = "GitLab",
            site = "gitlab.com",
            email = DEMO_EMAIL,
            length = 20,
            symbols = Keygrain.DEFAULT_SYMBOLS,
            counter = 1,
            totp = JSONObject().apply {
                put("mode", "stored")
                put("secret", "JBSWY3DPEHPK3PXP")
                put("seed", "SGVsbG8h3q2+7w==")
                put("digits", 6)
                put("period", 30)
                put("algo", "SHA1")
                put("algorithm", "SHA1")
            },
            updatedAt = 5000L
        ),
        // 6. Corporate VPN: 8-digit, 60s period TOTP (mode: "stored", secret: "HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ", digits: 8, period: 60, algo: "SHA1").
        ServiceEntry(
            id = "demo-svc-vpn",
            name = "Corporate VPN",
            site = "vpn.corp.example.com",
            email = DEMO_EMAIL,
            length = 20,
            symbols = Keygrain.DEFAULT_SYMBOLS,
            counter = 1,
            totp = JSONObject().apply {
                put("mode", "stored")
                put("secret", "HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ")
                put("seed", "PcbKpIJKbSiHZ7IzHiC0MWbLhdk=")
                put("digits", 8)
                put("period", 60)
                put("algo", "SHA1")
                put("algorithm", "SHA1")
            },
            updatedAt = 6000L
        ),
        // 7. Home Router: local network site (router.local), username "admin", length 16.
        ServiceEntry(
            id = "demo-svc-router",
            name = "Home Router",
            site = "router.local",
            email = "admin",
            length = 16,
            symbols = Keygrain.DEFAULT_SYMBOLS,
            counter = 1,
            updatedAt = 7000L
        ),
        // 8. Legacy Webmail: rotation checklist pending (migrating = true, length 20).
        ServiceEntry(
            id = "demo-svc-webmail",
            name = "Legacy Webmail",
            site = "mail.legacy-webmail.com",
            email = DEMO_EMAIL,
            length = 20,
            symbols = Keygrain.DEFAULT_SYMBOLS,
            counter = 1,
            migrating = true,
            updatedAt = 8000L
        )
    )

    fun getSshKeys(): List<SshKeyEntry> = listOf(
        // 1. id_ed25519: standard default key, counter 1, comment "id_ed25519".
        SshKeyEntry(
            id = "demo-ssh-1",
            keyName = "id_ed25519",
            counter = 1,
            comment = "id_ed25519",
            createdAt = 1000L,
            updatedAt = 1000L
        ),
        // 2. github: personal developer key, counter 1, comment "demo@example.com:github".
        SshKeyEntry(
            id = "demo-ssh-2",
            keyName = "github",
            counter = 1,
            comment = "demo@example.com:github",
            createdAt = 2000L,
            updatedAt = 2000L
        ),
        // 3. prod-bastion: rotated ops bastion key, counter 2, comment "ops-bastion-v2".
        SshKeyEntry(
            id = "demo-ssh-3",
            keyName = "prod-bastion",
            counter = 2,
            comment = "ops-bastion-v2",
            createdAt = 3000L,
            updatedAt = 3000L
        ),
        // 4. recovery-key: cold storage disaster recovery key, counter 1, comment "cold-storage-backup".
        SshKeyEntry(
            id = "demo-ssh-4",
            keyName = "recovery-key",
            counter = 1,
            comment = "cold-storage-backup",
            createdAt = 4000L,
            updatedAt = 4000L
        )
    )

    fun getWallets(): List<WalletEntry> = listOf(
        // 1. primary-vault: 24-word universal master recovery seed, counter 1, label "Primary Cold Storage", notes "Universal 24-word BIP-39 recovery seed for cold storage".
        WalletEntry(
            id = "demo-wallet-1",
            walletId = "primary-vault",
            label = "Primary Cold Storage",
            words = 24,
            counter = 1,
            notes = "Universal 24-word BIP-39 recovery seed for cold storage",
            createdAt = "2024-01-01T00:00:00Z",
            updatedAt = "2024-01-01T00:00:00Z"
        ),
        // 2. daily-hot-wallet: 12-word hot wallet, counter 1, label "Daily Hot Wallet", notes "12-word fast recovery seed for daily mobile transactions".
        WalletEntry(
            id = "demo-wallet-2",
            walletId = "daily-hot-wallet",
            label = "Daily Hot Wallet",
            words = 12,
            counter = 1,
            notes = "12-word fast recovery seed for daily mobile transactions",
            createdAt = "2024-01-02T00:00:00Z",
            updatedAt = "2024-01-02T00:00:00Z"
        ),
        // 3. trading-vault: 24-word seed with rotated counter (counter = 2), label "Trading Vault (Rotated)", notes "Rotated master seed (counter 2) after quarterly security rotation".
        WalletEntry(
            id = "demo-wallet-3",
            walletId = "trading-vault",
            label = "Trading Vault (Rotated)",
            words = 24,
            counter = 2,
            notes = "Rotated master seed (counter 2) after quarterly security rotation",
            createdAt = "2024-01-03T00:00:00Z",
            updatedAt = "2024-01-03T00:00:00Z"
        ),
        // 4. hardware-signer: 12-word hardware signer backup, counter 1, label "Hardware Signer Backup", notes "12-word air-gapped hardware signer backup".
        WalletEntry(
            id = "demo-wallet-4",
            walletId = "hardware-signer",
            label = "Hardware Signer Backup",
            words = 12,
            counter = 1,
            notes = "12-word air-gapped hardware signer backup",
            createdAt = "2024-01-04T00:00:00Z",
            updatedAt = "2024-01-04T00:00:00Z"
        )
    )
}
