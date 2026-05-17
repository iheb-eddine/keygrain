# Advanced Features: SSH, Wallet & TOTP Derivation

## SSH Key Derivation

Keygrain derives deterministic Ed25519 SSH keypairs from your master secret. Same inputs always produce the same key — no key files to manage or back up.

**Algorithm:** See [SPEC.md §12](../SPEC.md#12-ssh-key-derivation).

### Parameters

| Parameter | Constraints | Role in derivation |
|-----------|-------------|-------------------|
| `email` | Non-empty, lowercased | Part of HMAC message |
| `key_name` | Non-empty, no whitespace, lowercased | Scopes keys per service (e.g. `github`, `work-servers`) |
| `counter` | ≥ 1 (default: 1) | Enables key rotation |

Formula: `HMAC-SHA256(strengthened_key, email:key_name:counter:keygrain-ssh)` → 32-byte Ed25519 seed.

### Authorized Keys Format

```
ssh-ed25519 <base64-blob> <email>:<key_name>
```

Example:

```bash
export KEYGRAIN_SECRET="my-master-secret"
keygrain ssh me@example.com --name github
# ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... me@example.com:github
```

Paste the output directly into `~/.ssh/authorized_keys` or your Git hosting provider.

### Counter Rotation

Increment `--counter` to derive a completely uncorrelated new key:

```bash
export KEYGRAIN_SECRET="my-master-secret"
keygrain ssh me@example.com --name github --counter 2
```

Use cases: key compromise response, periodic rotation policy, separate keys per machine.

### Use Cases

- **Git hosting:** Derive a key per provider (`--name github`, `--name gitlab`)
- **Server access:** Derive per-host keys (`--name prod-db`, `--name web-01`)
- **ssh-agent workflow:** `keygrain ssh me@example.com --name github --agent` — no key files on disk

---

## HD Wallet Derivation

> **WARNING:** This feature is for DISASTER RECOVERY ONLY. Keygrain-derived wallets are NOT a substitute for proper wallet backups. If you lose your master secret, derived funds are PERMANENTLY LOST with no recovery path.

Keygrain derives deterministic BIP-39 mnemonics (24 words) from your master secret. The intended use case: recover wallet access if your primary backup (hardware wallet seed, paper backup) is destroyed.

**Algorithm:** See [SPEC.md §13](../SPEC.md#13-hd-wallet-derivation).

### Parameters

| Parameter | Constraints | Role in derivation |
|-----------|-------------|-------------------|
| `email` | Non-empty, lowercased | Part of HMAC message |
| `wallet_name` | Matches `[a-z0-9\-]+` | Scopes wallets (e.g. `personal`, `savings`) |
| `chain` | Must be in supported set | Part of HMAC message |
| `counter` | ≥ 1 (default: 1) | Enables rotation |

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
keygrain wallet me@example.com --name personal --chain bitcoin --path
# m/84'/0'/0'/0/0
```

### Mnemonic Output

```bash
export KEYGRAIN_SECRET="my-master-secret"
keygrain wallet me@example.com --name personal --chain bitcoin --yes-i-understand-the-risks
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

**Algorithm:** See [SPEC.md §11](../SPEC.md#11-totp-seed-derivation-model-b).

### How It Works

Formula: `HMAC-SHA256(strengthened_key, site:email:keygrain-totp)` → 32-byte seed.

The derived seed is a standard TOTP secret. Register it with your service's 2FA setup, then Keygrain can reproduce the same TOTP codes on any device with your master secret.

### Deriving a TOTP Seed

```bash
export KEYGRAIN_SECRET="my-master-secret"
keygrain totp --derive --email me@example.com --site myservice.com
# Outputs: current 6-digit TOTP code
```

To register with a service:
1. Derive the seed in your code: `derive_totp_seed(secret, email, site)` → 32 bytes
2. Encode as base32 for the service's TOTP setup
3. The service stores it; Keygrain re-derives it on demand

```python
import os, base64
from keygrain.totp import derive_totp_seed

secret = os.environ["KEYGRAIN_SECRET"].encode()
seed = derive_totp_seed(secret, "me@example.com", "myservice.com")
base32_seed = base64.b32encode(seed).decode().rstrip("=")
# Register base32_seed with your service's 2FA setup
```

### Using Existing TOTP Seeds

For services where you already have a TOTP secret (not derived), use `parse_totp_input`:

```bash
# Base32 secret
keygrain totp --seed JBSWY3DPEHPK3PXP

# Hex secret
keygrain totp --seed 48656c6c6f21deadbeef

# otpauth:// URI (from QR code)
keygrain totp --seed "otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP&digits=6&period=30"
```

Supported input formats for `--seed`:

| Format | Detection |
|--------|-----------|
| otpauth:// URI | Starts with `otpauth://` |
| Hex | Contains characters from `0189abcdef` that force hex interpretation |
| Base32 | Default fallback |

Parameters from otpauth:// URIs (digits, period, algorithm) are parsed automatically. Override with `--digits` or `--period`.

> **SECURITY:** Model B only works for services where YOU control the TOTP registration. For third-party services (GitHub, Google, etc.), you must use their provided secret — use `--seed` mode instead.

---

## Domain Separation

All derivation types use unique HMAC message formats ([SPEC.md §14](../SPEC.md#14-domain-separation)):

| Derivation | Message format | Unique suffix |
|------------|---------------|---------------|
| Password | `site:email:length:counter` | *(ends with decimal integer)* |
| SSH | `email:key_name:counter:keygrain-ssh` | `:keygrain-ssh` |
| Wallet | `email:wallet_name:chain:counter:keygrain-wallet` | `:keygrain-wallet` |
| TOTP | `site:email:keygrain-totp` | `:keygrain-totp` |

Password messages end with a decimal integer; all others end with a non-numeric suffix. This guarantees no two derivation types can collide, even for identical email/site inputs.
