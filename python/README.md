# Keygrain

Deterministic password, SSH key, and wallet derivation from a master secret.

## Install

```
pip install keygrain
```

## CLI Usage

```bash
export KEYGRAIN_SECRET="your-master-secret"
keygrain me@example.com --site github.com
keygrain ssh me@example.com --name github
keygrain wallet me@example.com --name savings --chain bitcoin
```

## Sync + Local Cache (read-only)

The CLI can download your synced services from the Keygrain server and store them
in a local **encrypted** cache, then retrieve passwords / TOTP codes / SSH keys
offline. The CLI is **read-only**: it never writes to the server. Add or change
services with the browser extension or the Android app.

```bash
# Download and cache your account's services (the only networked command):
keygrain sync --email me@example.com

# List cached services (offline; no network):
keygrain list
keygrain list --type totp
keygrain list --site github.com

# Retrieve one credential (offline; no network):
keygrain get --site github.com               # password (default)
keygrain get --site github.com --totp         # current TOTP code
keygrain get --site github.com --ssh          # authorized_keys line
keygrain get --site github.com --ssh --private   # OpenSSH private key
keygrain get --id 550e8400-e29b-41d4-a716-446655440000   # select by exact id

# Seal a machine into offline-only mode (and lift it):
keygrain sync --lock
keygrain sync --unlock

# Self-hosted server:
keygrain sync --server https://sync.example.com
```

Site matching is a **whole-label suffix** match (`github.com` matches
`accounts.github.com` but `bank` does not match `fakebank.com`). Any ambiguous
match is a hard error listing the candidates — the CLI never guesses. The
resolved `(site, service-email)` is always echoed to stderr before a secret is
printed to stdout.

The cache lives at `~/.keygrain/accounts/<slug>.kg` (AES-256-GCM, `0600`). The
master secret is never written to disk.

### What a compromised sync server can (and cannot) do

The sync server only ever stores an encrypted blob plus a small **unauthenticated**
metadata array (`id` + `updated_at` per service); it never sees your master secret
or any derived credential. A hostile or compromised server therefore **cannot**
exfiltrate secrets, decrypt your services, or leak data across accounts — the blob
is AES-256-GCM encrypted under a key derived from your secret, and the CLI verifies
its checksum and GCM tag before use.

The one thing a hostile server *can* influence is that unauthenticated metadata: by
tampering with the `id` values it could, at most, cause `get --id <uuid>` to resolve
to a **different service that is still your own** — it cannot inject a foreign or
attacker-controlled entry. The mandatory stderr echo of the resolved
`(site, service-email)` before any secret is printed is the guard: always read that
line to confirm you got the credential you intended. (The CLI also drops any
metadata `id` that is not UUID-shaped and strips control characters, so tampered
ids cannot inject terminal escape sequences.)

### Providing the master secret

`sync`, `list`, and `get` accept the master secret from exactly one of:

```bash
# Interactive hidden prompt (default when run in a terminal):
keygrain get --site github.com

# Environment variable — for CI/CD with injected secrets:
keygrain get --site github.com --secret-env KEYGRAIN_SECRET

# File — for Docker/Kubernetes secrets mounted as files:
keygrain get --site github.com --secret-file /run/secrets/keygrain_secret
```

A raw `--secret VALUE` argument is intentionally **not** provided (it would leak
via `ps` / shell history). The CLI does not auto-load `.env` files.

## Library Usage

```python
from keygrain import derive_password, normalize_site

password = derive_password(
    secret=b"my-secret",
    email="me@example.com",
    site=normalize_site("github.com"),
)
```

## Features

- Argon2id key strengthening (64 MiB, 3 iterations)
- HMAC-SHA256 derivation — single password compromise reveals nothing
- TOTP seed derivation
- SSH Ed25519 key derivation
- BIP-39 wallet mnemonic derivation
- BIP-85 child mnemonic derivation
- Cross-platform compatible (Python, Kotlin, JavaScript)

## Documentation

- [Algorithm Specification](https://github.com/iheb-eddine/keygrain/blob/main/SPEC.md)
- [API Reference](https://github.com/iheb-eddine/keygrain/blob/main/API.md)

## License

MIT
