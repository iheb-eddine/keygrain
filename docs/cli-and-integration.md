# CLI Reference & Python Integration

## Installation

```bash
# From the Git repository (SSH)
pip install "git+https://github.com/iheb-eddine/keygrain.git#subdirectory=python"

# Local development
pip install -e python/
```

Requires Python ≥ 3.10.

---

## Environment Variable

All commands require your master secret via environment variable:

```bash
export KEYGRAIN_SECRET="your master secret here"
```

> **SECURITY:** Never put your master secret in shell history. Use `read -s KEYGRAIN_SECRET && export KEYGRAIN_SECRET` or a secrets manager.

---

## CLI Quick Start

### Derive a Password

```bash
# Shorthand (default subcommand)
export KEYGRAIN_SECRET="my-master-secret"
keygrain me@example.com --site github.com

# Explicit subcommand
keygrain password me@example.com --site github.com --length 24 --counter 2
```

| Flag | Default | Description |
|------|---------|-------------|
| `--site` | *(required)* | Site identifier (auto-normalized: strips protocol, www, path) |
| `--length` | 20 | Derived password length (min 8) |
| `--symbols` | `!@#$%&*-_=+?` | Symbol charset |
| `--counter` | 1 | Rotation counter (increment to rotate) |
| `--secret-env` | `KEYGRAIN_SECRET` | Env var holding the master secret |

### Derive an SSH Key

```bash
export KEYGRAIN_SECRET="my-master-secret"

# Public key (authorized_keys format)
keygrain ssh me@example.com --name github

# Private key (OpenSSH PEM)
keygrain ssh me@example.com --name github --private

# Add to ssh-agent
keygrain ssh me@example.com --name work-servers --agent
```

| Flag | Default | Description |
|------|---------|-------------|
| `--name` | *(required)* | Key name (e.g. `github`, `work-servers`) |
| `--counter` | 1 | Rotation counter |
| `--private` | false | Output private key in OpenSSH PEM format |
| `--agent` | false | Add key directly to ssh-agent |
| `--secret-env` | `KEYGRAIN_SECRET` | Env var holding the master secret |

### Derive a Wallet Mnemonic

```bash
export KEYGRAIN_SECRET="my-master-secret"

# 24-word mnemonic (interactive confirmation required)
keygrain wallet me@example.com --name personal --chain bitcoin

# Skip confirmation (scripts/CI)
keygrain wallet me@example.com --name personal --chain bitcoin --yes-i-understand-the-risks

# Raw 32-byte entropy (hex)
keygrain wallet me@example.com --name personal --chain ethereum --raw --yes-i-understand-the-risks

# BIP-44 path for a chain (no secret needed)
keygrain wallet me@example.com --name personal --chain solana --path
```

| Flag | Default | Description |
|------|---------|-------------|
| `--name` | *(required)* | Wallet name (lowercase alphanumeric + hyphens) |
| `--chain` | *(required)* | Chain: bitcoin, ethereum, solana, litecoin, dogecoin, bitcoin-testnet, polkadot, cosmos, avalanche |
| `--counter` | 1 | Rotation counter |
| `--raw` | false | Output raw entropy as hex |
| `--seed` | false | Output 64-byte BIP-32 seed as hex |
| `--path` | false | Show BIP-44 derivation path only |
| `--yes-i-understand-the-risks` | false | Skip interactive confirmation |
| `--secret-env` | `KEYGRAIN_SECRET` | Env var holding the master secret |

> **WARNING:** Wallet derivation is for disaster recovery only. If you lose your master secret, derived funds are permanently lost. Do NOT use this as your only wallet backup.

### BIP-85 Child Derivation

```bash
# Derive a 24-word child mnemonic from a parent mnemonic
keygrain wallet-bip85 --mnemonic "abandon abandon ... about" --index 0

# 12-word child
keygrain wallet-bip85 --mnemonic "abandon abandon ... about" --index 1 --words 12
```

| Flag | Default | Description |
|------|---------|-------------|
| `--mnemonic` | *(required)* | Parent BIP-39 mnemonic (12 or 24 words) |
| `--index` | 0 | Child index |
| `--words` | 24 | Output word count (12 or 24) |
| `--passphrase` | *(empty)* | BIP-39 passphrase for master mnemonic |

### Derive a TOTP Code

```bash
export KEYGRAIN_SECRET="my-master-secret"

# Derive seed from master secret (Model B — for self-hosted services)
keygrain totp --derive --email me@example.com --site myservice.com

# From an existing seed (base32, hex, or otpauth:// URI)
keygrain totp --seed JBSWY3DPEHPK3PXP
keygrain totp --seed "otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP&digits=6&period=30"
```

| Flag | Default | Description |
|------|---------|-------------|
| `--seed` | — | TOTP seed (base32, hex, or otpauth:// URI) |
| `--derive` | false | Derive seed from master secret + email + site |
| `--email` | — | Email (required with `--derive`) |
| `--site` | — | Site (required with `--derive`) |
| `--digits` | 6 | TOTP digits (6 or 8) |
| `--period` | 30 | TOTP period in seconds |
| `--secret-env` | `KEYGRAIN_SECRET` | Env var holding the master secret |

---

## Python Library Usage

Both import styles work:

```python
# Submodule imports
from keygrain.derive import derive_password, normalize_site
from keygrain.ssh import derive_ssh_keypair, format_authorized_keys
from keygrain.wallet import derive_wallet_mnemonic, SUPPORTED_CHAINS, BIP44_PATHS
from keygrain.totp import derive_totp_seed, generate_totp, parse_totp_input
from keygrain.bip85 import bip85_derive_mnemonic

# Or top-level (all re-exported via __init__.py)
from keygrain import derive_password, derive_ssh_keypair, derive_wallet_mnemonic
```

### Derive a Password

```python
import os
from keygrain import derive_password, normalize_site

secret = os.environ["KEYGRAIN_SECRET"].encode()
password = derive_password(
    secret, "me@example.com",
    site=normalize_site("github.com"),
    length=20,
    counter=1,
)
```

### Derive an SSH Keypair

```python
import os
from keygrain.ssh import derive_ssh_keypair, format_authorized_keys

secret = os.environ["KEYGRAIN_SECRET"].encode()
seed, pubkey = derive_ssh_keypair(secret, "me@example.com", key_name="github", counter=1)
print(format_authorized_keys(pubkey, "me@example.com:github"))
```

### Derive a Wallet Mnemonic

```python
import os
from keygrain.wallet import derive_wallet_mnemonic

secret = os.environ["KEYGRAIN_SECRET"].encode()
mnemonic = derive_wallet_mnemonic(
    secret, "me@example.com",
    wallet_name="personal", chain="bitcoin", counter=1,
)
```

### Derive a TOTP Code

```python
import os, time
from keygrain.totp import derive_totp_seed, generate_totp

secret = os.environ["KEYGRAIN_SECRET"].encode()
seed = derive_totp_seed(secret, "me@example.com", "myservice.com")
code = generate_totp(seed, int(time.time()), digits=6, period=30)
```

---

## Automation Recipes

### Batch Password Derivation

```bash
export KEYGRAIN_SECRET="my-master-secret"
for site in github.com gitlab.com aws.amazon.com; do
  echo "$site: $(keygrain me@example.com --site "$site")"
done
```

### CI/CD Secret Derivation

```python
import os
from keygrain import derive_password, normalize_site

secret = os.environ["KEYGRAIN_SECRET"].encode()
email = "ci@mycompany.com"

secrets = {
    name: derive_password(secret, email, site=normalize_site(name))
    for name in ["db-prod", "redis-prod", "api-key-stripe"]
}
```

### SSH Fleet Provisioning

```bash
export KEYGRAIN_SECRET="my-master-secret"
EMAIL="ops@mycompany.com"

for server in web-01 web-02 db-01; do
  keygrain ssh "$EMAIL" --name "$server" >> ~/.ssh/authorized_keys_fleet
done
```

---

## Verify It Yourself

```bash
cd python/
pip install -e .
pip install pytest
pytest
```

Test vectors for all derivation types are at the repository root: `vectors.json`, `ssh-vectors.json`, `wallet-vectors.json`, `totp-vectors.json`.

---

## Algorithm Details

See [SPEC.md](../SPEC.md) for the full algorithm specification:
- §3: Key strengthening (Argon2id)
- §4: Password derivation
- §11: TOTP seed derivation
- §12: SSH key derivation
- §13: HD wallet derivation
- §14: Domain separation
