# AGENTS.md — Keygrain Client Repository

Deterministic password, SSH key, TOTP seed, and HD wallet derivation from a master secret. No vault of generated passwords — same inputs always produce same outputs across all platforms.

## ⚠️ Authoritative Cryptographic Architecture (Spec v5)

`SPEC.md` at the repository root is the **SINGLE, GLOBAL, AUTHORITATIVE SOURCE OF TRUTH** for all cryptographic logic. All platforms (Python, Extension, Android, Web Generator, CLI) MUST produce byte-identical derivations.

There are **three completely independent cryptographic domains**:

| Domain | Argon2id Salt | HMAC Message Format | Unique Suffix / Target | Email Coupling |
|---|---|---|---|---|
| **Passwords & Sync** | `keygrain-strengthen:<email>` | `site:email:length:counter` | (ends with integer) | **YES** — bound to account email |
| **Sync Auth ID** | `keygrain-strengthen:<email>` | `email:keygrain-id` | `:keygrain-id` | **YES** |
| **Sync Auth Password** | `keygrain-strengthen:<email>` | `email:32:keygrain-auth` | `:keygrain-auth` | **YES** |
| **Sync Encryption Key** | `keygrain-strengthen:<email>` | `email:keygrain-encryption` | `:keygrain-encryption` | **YES** (AES-256-GCM) |
| **Local Storage Key** | `keygrain-strengthen:<email>` | `email:keygrain-local-storage` | `:keygrain-local-storage` | **YES** (extension local storage) |
| **TOTP Seed** | `keygrain-strengthen:<email>` | `site:email:keygrain-totp` | `:keygrain-totp` | **YES** |
| **SSH Keypair** | `keygrain-ssh:<key_name>` | `key_name:counter:keygrain-ssh` | `:keygrain-ssh` | **NO** — completely decoupled from email |
| **HD Wallet Seed** | `keygrain-wallet:<wallet_id>` | `wallet_id:words:counter:keygrain-wallet` | `:keygrain-wallet` | **NO** — decoupled from email and chain |

### Critical Invariants for Developers and AI Agents:
1. **Never Couple SSH or Wallets to Email**:
   - `keygrain-ssh:<name>` and `keygrain-wallet:<id>` use domain-separated Argon2id salts.
   - NEVER use the account email in SSH or HD wallet salts, HMAC messages, or derivations.
   - NEVER use email as a default comment in SSH derivations (comment defaults to lowercase `key_name` per `SPEC.md` §12.3).
2. **HD Wallets Are BIP-39 Seed Generation Only**:
   - Derivation produces a standard 12 or 24-word BIP-39 mnemonic phrase for disaster recovery.
   - It does NOT implement BIP-32/BIP-44 multi-account wallet hierarchies, key derivation trees, or address generation.
   - Blockchain ecosystem/chain identifiers MUST NOT be included in the cryptographic derivation.
3. **No Cross-Domain Key Re-use**:
   - Never use `strengthen(secret, email)` for SSH or HD wallet derivations. Each domain MUST invoke Argon2id with its own isolated salt.
4. **CI Checksum Gate**:
   - `SPEC.md` and `vectors.json` are checksummed. Any modification requires updating `.spec-checksum` (`sha256sum SPEC.md`) and `.vectors-checksum` (`sha256sum vectors.json`).

## Directory Map

```
keygrain/
├── python/keygrain/       # Reference implementation (Python 3.10+, pip-installable)
│   ├── derive.py          #   Core: strengthen, derive_password, normalize_site
│   ├── totp.py            #   TOTP seed derivation + RFC 6238
│   ├── ssh.py             #   Ed25519 SSH keypair derivation
│   ├── wallet.py          #   BIP-39 mnemonic derivation
│   ├── bip85.py           #   BIP-85 child mnemonic from parent
│   └── cli.py             #   CLI entry point (subcommands: password, totp, ssh, wallet)
├── extension/             # Browser extension
│   ├── shared/            #   All JS logic (popup, sync, crypto, autofill, migrate)
│   ├── chrome/            #   MV3 manifest + service worker background.js
│   └── firefox/           #   MV3 manifest + event page background scripts
├── kotlin/app/            # Android app (Jetpack Compose, Material 3)
│   └── src/main/java/com/secbytech/keygrain/
│       ├── data/          #   Engines: Keygrain, TotpEngine, SshEngine, WalletEngine,
│       │                  #   SyncManager, ServiceManager, PublicSuffixList, Autofill
│       └── ui/screens/    #   MainScreen, OnboardingScreen, WalletScreen, HelpScreen
├── web/                   # Web generator PWA (offline-capable)
├── ci/                    # Cross-platform test scripts
├── SPEC.md                # ⚠️ AUTHORITATIVE algorithm specification (v5)
├── API.md                 # Sync API reference
├── vectors.json           # Cross-platform test vectors (CI-checksummed)
├── ssh-vectors.json       # SSH keypair test vectors
└── wallet-vectors.json    # HD wallet mnemonic test vectors
```
