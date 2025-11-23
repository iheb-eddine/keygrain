# Keygrain — Deterministic Password Derivation

## What This Is

A cross-platform library and mobile app that derives unique passwords from a master secret + email address. One secret generates all passwords deterministically — no password storage needed. Site-specific parameters (symbols, length, salt) are stored locally and backed up encrypted.

## Algorithm

### Input

| Parameter | Description | Stored per-site |
|-----------|-------------|-----------------|
| `secret` | Master secret (bytes) | NO — user's memory only |
| `email` | Email / login identity (lowercased before use) | yes |
| `length` | Password length (minimum: 8, default: 20) | yes |
| `symbols` | Symbol charset string (default: `!@#$%&*-_=+?`) | yes |
| `salt` | Optional personal salt (default: `""`) | yes |

### Steps

1. **Derive key material**
   ```
   message = lowercase(email) + ":" + str(length) + ":" + salt
   key = HMAC-SHA256(secret, message)
   stream = key || HMAC-SHA256(key, 0x01) || HMAC-SHA256(key, 0x02) || ...
   ```
   Extend as needed. Each extension adds 32 bytes.

2. **Force one character from each required category**
   Consume bytes sequentially from stream. For each category (upper, lower, digits, symbols):
   ```
   char = charset[category][next_byte % len(charset[category])]
   ```

3. **Fill remaining positions**
   ```
   full_charset = upper + lower + digits + symbols
   char = full_charset[next_byte % len(full_charset)]
   ```

4. **Deterministic shuffle (Fisher-Yates)**
   ```
   for i from (length - 1) down to 1:
       j = next_byte % (i + 1)
       swap(password[i], password[j])
   ```

### Output

A `length`-character string with at least one uppercase, one lowercase, one digit, and one symbol.

## Charsets

Ambiguous characters excluded: I, l, O, 0, 1

- **Uppercase:** `ABCDEFGHJKLMNPQRSTUVWXYZ` (23 chars)
- **Lowercase:** `abcdefghjkmnpqrstuvwxyz` (23 chars)
- **Digits:** `23456789` (8 chars)
- **Symbols (default):** `!@#$%&*-_=+?` (13 chars)

The user may add or remove symbols from the default set per site. The final symbol string is what feeds into the algorithm.

## Backup & Sync Protocol

### Overview

The keygrain server stores an encrypted config blob per user. No accounts, no email verification. The master secret is the sole proof of identity.

### Derivations

From the user's `secret` + `email`, the app derives three values for backup:

| Purpose | Derivation |
|---------|-----------|
| Lookup ID | `hex(HMAC-SHA256(secret, email + ":keygrain-id"))` |
| Auth password | `derive_password(secret, email, length=32, symbols=default, salt="keygrain-auth")` |
| Encryption key | `HMAC-SHA256(secret, email + ":keygrain-encryption")` |

### Server Storage

Per user record:
- `lookup_id` (hex string — primary key)
- `auth_password_hash` (bcrypt)
- `encrypted_blob` (AES-256-GCM ciphertext)

### Flows

**First backup (implicit registration):**
1. App derives lookup_id + auth_password + encryption_key
2. App encrypts config JSON with encryption_key (AES-256-GCM)
3. `PUT /api/backup/:lookup_id` with auth header → server stores hash + blob

**Restore (new device):**
1. User enters email + master_secret
2. App derives lookup_id + auth_password + encryption_key
3. `GET /api/backup/:lookup_id` with auth header → server returns blob
4. App decrypts blob → imports config

**Sync (existing device):**
- Same as backup — overwrite the blob on server

### Server API

| Endpoint | Method | Auth | Body |
|----------|--------|------|------|
| `/api/backup/:id` | PUT | Basic (lookup_id:auth_password) | encrypted blob |
| `/api/backup/:id` | GET | Basic (lookup_id:auth_password) | — |

### Security Properties

- Server never sees: master secret, encryption key, plaintext config
- Server stores: lookup_id, bcrypt(auth_password), opaque blob
- If master secret is lost: backup is unrecoverable (by design)
- If server is compromised: attacker gets encrypted blobs (useless without master secrets)

## Optional: Argon2id Key Strengthening

For users with memorizable passphrases (lower entropy), an optional Argon2id step strengthens the secret before derivation.

### When to Use

- **Skip** if your master secret is high-entropy (random 20+ characters)
- **Use** if your master secret is a memorizable passphrase (e.g., "correct horse battery staple")

### Parameters (Fixed)

| Parameter | Value |
|-----------|-------|
| Memory | 64 MiB (65536 KiB) |
| Iterations | 3 |
| Parallelism | 1 |
| Output length | 32 bytes |
| Salt | `"keygrain-strengthen:" + lowercase(email)` (UTF-8) |
| Type | Argon2id |

### Flow

```
strengthened_secret = Argon2id(secret, salt, params)
# Then use strengthened_secret in place of secret for all derivations
key = HMAC-SHA256(strengthened_secret, message)
```

### Caching

The Argon2id computation takes ~1 second. Implementations SHOULD cache the result keyed on `(secret, email)` so the cost is paid only once per session.

### Cross-Platform Consistency

All implementations MUST produce identical 32-byte output for the same inputs. The salt is deterministic (not random). Test vectors for the strengthened path are provided separately.

## Security Properties (General)

- **Master secret compromise** → all passwords exposed. Protect the secret.
- **Single password compromise** → HMAC prevents deriving secret or other passwords.
- **Modulo bias** → <1% for charset sizes under 100. Acceptable for password generation.
- **Length change** → produces entirely different password (length is in HMAC input).
- **Salt change** → produces entirely different password (salt is in HMAC input).
- **No password storage** — passwords recomputed on demand.
- **Config storage** — only derivation parameters stored (email, length, symbols, salt per site). Useless without master secret.
- **Argon2id** — makes brute-force of weak passphrases expensive (~1 sec per guess).

## Platforms

| Platform | Location | Status |
|----------|----------|--------|
| Python (library + CLI) | `python/` | ✅ Complete |
| Android (Kotlin + Compose) | `kotlin/` | ✅ Complete |
| Web generator (client-side) | `server/static/generate/` | ✅ Complete |
| Backup server (Go) | `server/` | ✅ Complete |
| Browser extension (Chrome + Firefox) | `extension/` | ✅ Complete |
