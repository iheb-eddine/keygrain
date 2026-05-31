# Keygrain — System Architecture

## Core Design Principle

Keygrain is a **stateless derivation engine**: the same inputs (secret + email + site + params) always produce the same outputs. No password storage is required. Only service metadata (site name, length, symbols, counter) is stored, and that metadata is useless without the master secret.

## Architecture Diagram

```mermaid
graph TB
    subgraph Clients["Client Devices"]
        EXT["Browser Extension<br/>(Chrome MV3 / Firefox MV2)"]
        APP["Android App<br/>(Jetpack Compose)"]
        WEB["Web Generator<br/>(PWA, offline)"]
        CLI["Python CLI"]
    end

    subgraph Core["Core Algorithm (identical across platforms)"]
        STR["Argon2id Strengthen"]
        DER["HMAC-SHA256 Derivation"]
        BLD["Password Build + Shuffle"]
    end

    subgraph Server["Sync Server (Go)"]
        RL["Rate Limiter<br/>(token bucket)"]
        SYNC["Sync API<br/>(GET/PUT)"]
        FS["File Storage<br/>(JSON per user)"]
        STATIC["Static Files<br/>(landing, generator, rules)"]
    end

    EXT --> Core
    APP --> Core
    WEB --> Core
    CLI --> Core

    EXT -->|HTTPS| RL
    APP -->|HTTPS| RL
    RL --> SYNC
    SYNC --> FS
```

## Security Boundaries

```mermaid
graph LR
    subgraph ClientSide["Client (trusted)"]
        SECRET["Master Secret"]
        DERIVE["Derivation Engine"]
        ENC["AES-256-GCM Encrypt"]
    end

    subgraph Transport["Network"]
        TLS["TLS 1.2+"]
    end

    subgraph ServerSide["Server (untrusted)"]
        BLOB["Encrypted Blob<br/>(opaque)"]
        HASH["bcrypt(auth_password)"]
    end

    SECRET --> DERIVE
    DERIVE --> ENC
    ENC -->|ciphertext only| TLS
    TLS --> BLOB
    DERIVE -->|auth_password| TLS
    TLS --> HASH
```

**Key invariant:** The server never sees plaintext secrets, encryption keys, or service data. It stores only opaque encrypted blobs and a bcrypt hash of the derived auth_password.

## Local Encryption (Extension)

The extension encrypts service data at rest in `chrome.storage.local`. This is distinct from sync encryption (which protects data on the server).

### Key Derivation Chain

```
secret + email
    → Argon2id(64MiB, t=3, p=1, salt="keygrain-strengthen:<email>")
    → strengthened (32 bytes)
    → HMAC-SHA256(strengthened, "<email>:keygrain-local-storage")
    → storageKey (32 bytes)
```

### Encryption Scheme

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-256-GCM |
| Key | `storageKey` (derived above) |
| IV | 12 random bytes (per write) |
| AAD | `email.toLowerCase()` (UTF-8 encoded) |
| Plaintext | JSON: `{version: 1, services, wallets, wallet_audit_log}` |

### Stored Format (version 2)

```json
{"version": 2, "iv": "<base64>", "ciphertext": "<base64>"}
```

Stored at key `services` in `chrome.storage.local`. The `version: 2` envelope distinguishes encrypted storage from legacy plaintext (`version: 1` was unencrypted).

### PIN-Based Secret Encryption

The master secret itself can be encrypted with a user-chosen PIN for session persistence:

| Parameter | Value |
|-----------|-------|
| KDF | PBKDF2 (SHA-256, 100,000 iterations) |
| Salt | 16 random bytes |
| Derived key | AES-256-GCM (256-bit) |
| IV | 12 random bytes |
| Plaintext | The master secret (UTF-8) |

Functions: `pinEncryptSecret(pin, secret)` → `{encrypted, salt, iv}`, `pinDecryptSecret(pin, stored)`.

### Session Architecture

- Master secret and email are held in `chrome.storage.session` (memory-only, cleared on browser close).
- The `storageKey` is never persisted — re-derived on each popup open or background operation.
- Auto-lock alarm clears session storage after configurable idle (default: 15 min).
- Background sync and badge updates decrypt local storage on-demand using the session secret.

### Threat Model Distinction

| Layer | Protects against | Key source |
|-------|-----------------|------------|
| Sync encryption | Server compromise, network interception | `:keygrain-encryption` HMAC |
| Local encryption | Local disk access, extension storage dumps | `:keygrain-local-storage` HMAC |
| PIN encryption | Session theft (secret in memory) | PBKDF2 from user PIN |

## Derivation Pipeline

```mermaid
flowchart LR
    A["secret + email"] --> B["Argon2id<br/>(64MiB, t=3, p=1)"]
    B --> C["strengthened key<br/>(32 bytes)"]
    C --> D["HMAC-SHA256<br/>(site:email:length:counter)"]
    D --> E["key stream<br/>(extendable)"]
    E --> F["Rejection sampling<br/>+ charset mapping"]
    F --> G["Fisher-Yates shuffle"]
    G --> H["password"]
```

## Domain Separation

All derivations use the same strengthened key but produce independent outputs via unique HMAC messages:

| Derivation | HMAC message | Unique suffix |
|------------|-------------|---------------|
| Password | `site:email:length:counter` | Ends with decimal integer |
| Lookup ID | `email:keygrain-id` | `:keygrain-id` |
| Auth password | `email:32:keygrain-auth` | `:keygrain-auth` (reuses password derivation with length=32) |
| Encryption key | `email:keygrain-encryption` | `:keygrain-encryption` |
| Local storage key | `email:keygrain-local-storage` | `:keygrain-local-storage` |
| TOTP seed | `site:email:keygrain-totp` | `:keygrain-totp` |
| SSH key | `email:key_name:counter:keygrain-ssh` | `:keygrain-ssh` |
| Wallet | `email:wallet_name:chain:counter:keygrain-wallet` | `:keygrain-wallet` |
| Fingerprint | `keygrain-fingerprint` (key=raw secret, no Argon2id) | Standalone, different key material |

## Platform Architecture Patterns

| Pattern | Implementation |
|---------|---------------|
| Background persistence | Chrome: Service Worker; Firefox: Background scripts |
| Local encryption | Extension: Web Crypto API + PIN-derived key; Android: EncryptedSharedPreferences |
| Sync conflict resolution | ETag-based optimistic concurrency + per-service merge by UUID |
| Rate limiting | Dual token bucket: per-IP (100/min) + per-lookup_id (2/min) |
| Autofill | Content script with `Object.getOwnPropertyDescriptor` for React/Vue/Angular bypass |
| Cross-platform correctness | Shared `vectors.json` enforced by CI checksum gate |
