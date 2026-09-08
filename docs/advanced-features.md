# Advanced Features: SSH, Wallet & TOTP Derivation

## SSH Key Derivation

Keygrain derives deterministic Ed25519 SSH keypairs from your master secret without coupling to an account email. Same inputs always produce the same key — no key files to manage or back up.

**Algorithm:** See [SPEC.md §12](../SPEC.md#12-ssh-key-derivation).

### Parameters

| Parameter | Constraints | Role in derivation |
|-----------|-------------|-------------------|
| `key_name` | Non-empty, no whitespace, lowercased | Scopes keys per service (e.g. `github`, `work-servers`) |
| `counter` | ≥ 1 (default: 1) | Enables key rotation |

Formula:
- Salt: `UTF-8("keygrain-ssh:" + lowercase(key_name))`
- Strengthening: `Argon2id(secret, salt, m=65536, t=3, p=1, len=32)`
- Message: `UTF-8(lowercase(key_name) + ":" + counter + ":keygrain-ssh")`
- Seed: `HMAC-SHA256(strengthened, message)` → 32-byte Ed25519 seed.

### Authorized Keys Format

```
ssh-ed25519 <base64-blob> <key_name>
```

Example:

```bash
export KEYGRAIN_SECRET="my-master-secret"
keygrain ssh --name github
# ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... github
```

Paste the output directly into `~/.ssh/authorized_keys` or your Git hosting provider.

### Counter Rotation

Increment `--counter` to derive a completely uncorrelated new key:

```bash
export KEYGRAIN_SECRET="my-master-secret"
keygrain ssh --name github --counter 2
```

Use cases: key compromise response, periodic rotation policy, separate keys per machine.

### Use Cases

- **Git hosting:** Derive a key per provider (`--name github`, `--name gitlab`)
- **Server access:** Derive per-host keys (`--name prod-db`, `--name web-01`)
- **ssh-agent workflow:** `keygrain ssh --name github --agent` — no key files on disk

---

## HD Wallet Derivation

> **WARNING:** This feature is for DISASTER RECOVERY ONLY. Keygrain-derived wallets are NOT a substitute for proper wallet backups. If you lose your master secret, derived funds are PERMANENTLY LOST with no recovery path.

Keygrain derives deterministic BIP-39 mnemonics directly from your master secret without coupling to an account email or specific blockchain. The intended use case: recover wallet access if your primary backup (hardware wallet seed, paper backup) is destroyed.

**Algorithm:** See [SPEC.md §13](../SPEC.md#13-hd-wallet-derivation).

### Parameters

| Parameter | Constraints | Role in derivation |
|-----------|-------------|-------------------|
| `wallet_name` | Matches `[a-z0-9\-]+`, lowercased | Scopes wallets (e.g. `personal`, `savings`) |
| `words` | 12 or 24 (default: 24) | Word count |
| `counter` | ≥ 1 (default: 1) | Enables rotation |

Formula:
- Salt: `UTF-8("keygrain-wallet:" + lowercase(wallet_name))`
- Strengthening: `Argon2id(secret, salt, m=65536, t=3, p=1, len=32)`
- Message: `UTF-8(lowercase(wallet_name) + ":" + words + ":" + counter + ":keygrain-wallet")`
- Raw Entropy: `HMAC-SHA256(strengthened, message)` (first 16 bytes if 12 words, 32 bytes if 24 words).

### Supported Chains & BIP-44 Paths

| Chain | BIP-44 Path |
|-------|-------------|
| bitcoin | `m/84'/0'/0'/0/0` |
| ethereum | `m/44'/60'/0'/0/0` |
| solana | `m/44'/501'/0'/0'` |
| litecoin | `m/84'/2'/0'/0/0` |
| dogecoin | `m/44'/3'/0'/0/0` |
| bitcoin-testnet | `m/84'/1'/0'/0/0` |
| polkadot | *(substrate derivation)* |
| cosmos | `m/44'/118'/0'/0/0` |
| avalanche | `m/44'/60'/0'/0/0` |

> **NOTE:** Polkadot uses Substrate-specific derivation, not standard BIP-44.

Query paths without deriving (no master secret needed):

```bash
keygrain wallet --name personal --chain bitcoin --path
# m/84'/0'/0'/0/0
```

### Mnemonic Output

```bash
export KEYGRAIN_SECRET="my-master-secret"
keygrain wallet --name personal --chain bitcoin --yes-i-understand-the-risks
```

Output: 24-word BIP-39 mnemonic. Import into any compatible wallet software to verify addresses match.

### BIP-85 Child Derivation

Derive child mnemonics from a parent BIP-39 mnemonic using standard BIP-85 (path `m/83696968'/39'/0'/<words>'/<index>'`):

```bash
keygrain wallet-bip85 --mnemonic "your 24 word mnemonic ..." --index 0
keygrain wallet-bip85 --mnemonic "your 24 word mnemonic ..." --index 1 --words 12
```

This is standard BIP-85 — NOT Keygrain-specific derivation. The parent mnemonic can be from any source.

> **SECURITY:** BIP-85 child mnemonics are cryptographically independent — knowing a child does not reveal the parent or siblings. But losing the parent mnemonic means you cannot re-derive children.

---

## TOTP Seed Derivation (Model B)

Model B: Keygrain derives a deterministic TOTP seed from your master secret. Use this for self-hosted services where you control the TOTP setup flow.

### Parameters

| Parameter | Constraints | Role in derivation |
|-----------|-------------|-------------------|
| `email` | Non-empty, lowercased | Part of HMAC message |
| `site` | Normalized domain | Part of HMAC message |

Formula: `HMAC-SHA256(strengthened_key, site:email:keygrain-totp)` → 32-byte seed.

Use with standard RFC 6238 TOTP (SHA1, 30s period, 6 digits).

```bash
export KEYGRAIN_SECRET="my-master-secret"
keygrain totp --derive --email me@example.com --site myservice.com
```

### Model A: Imported Seeds

Model A uses third-party TOTP seeds (from QR codes, manual entry, etc.). Supported formats:

| Format | Detection |
|--------|-----------|
| otpauth:// URI | Starts with `otpauth://` |
| Hex | Contains characters from `0189abcdef` that force hex interpretation |
| Base32 | Default fallback |

Parameters from otpauth:// URIs (digits, period, algorithm) are parsed automatically. Override with `--digits` or `--period`.

> **SECURITY:** Model B only works for services where YOU control the TOTP registration. For third-party services (GitHub, Google, etc.), you must use their provided secret — use `--seed` mode instead.

---

## Domain Separation

All derivation types use unique Argon2id salts and HMAC message formats ([SPEC.md §14](../SPEC.md#14-domain-separation)):

| Derivation | Salt format | Message format | Unique suffix |
|------------|-------------|----------------|---------------|
| Password | `keygrain-strengthen:<email>` | `site:email:length:counter` | *(ends with decimal integer)* |
| SSH | `keygrain-ssh:<key_name>` | `key_name:counter:keygrain-ssh` | `:keygrain-ssh` |
| Wallet | `keygrain-wallet:<wallet_id>` | `wallet_id:words:counter:keygrain-wallet` | `:keygrain-wallet` |
| TOTP | `keygrain-strengthen:<email>` | `site:email:keygrain-totp` | `:keygrain-totp` |

Password messages end with a decimal integer; all others end with a non-numeric suffix. Furthermore, SSH keys and HD wallets use isolated Argon2id salts, ensuring complete cryptographic independence from email-based derivations.
