# Keygrain — System Architecture

## 1. System Overview

Keygrain is a deterministic password manager. A master secret + site + email deterministically derives a unique password — no password storage required. An optional encrypted sync layer allows service metadata to be shared across devices.

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT DEVICES                           │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Browser Ext  │  │ Android App  │  │ Web Generator (PWA)  │  │
│  │ (Chrome/FF)  │  │ (Compose UI) │  │ (offline-capable)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────┘  │
│         │                  │                    │                │
│         │    ┌─────────────┴────────────┐      │ (no sync)     │
│         │    │  Core Algorithm Library   │      │                │
│         │    │  (Python / JS / Kotlin)   │◄─────┘                │
│         │    └──────────────────────────┘                       │
│         │                  │                                    │
└─────────┼──────────────────┼────────────────────────────────────┘
          │                  │
          │  HTTPS (TLS 1.2+)  │
          ▼                  ▼
┌─────────────────────────────────────────┐
│            SYNC SERVER (Go)             │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │  Rate Limit │  │  Sync API       │  │
│  │  Middleware │──▶│  (GET/PUT)      │  │
│  └─────────────┘  └────────┬────────┘  │
│                             │           │
│                    ┌────────▼────────┐  │
│                    │  File Storage   │  │
│                    │  (JSON per user)│  │
│                    └─────────────────┘  │
└─────────────────────────────────────────┘
```

**Key invariant:** The server never sees plaintext service data. It stores opaque encrypted blobs and plaintext metadata (UUIDs + timestamps) only.

---

## 2. Components

### 2.1 Core Algorithm Library

Identical implementations in Python, JavaScript, and Kotlin. All produce the same output for the same inputs (validated by 20 cross-platform tests in Python).

**Responsibilities:**
- Argon2id key strengthening
- HMAC-SHA256 stream generation
- Deterministic password construction (charset mapping + Fisher-Yates shuffle)
- Auth credential derivation (lookup_id, auth_password, encryption_key)

### 2.2 Browser Extension (Chrome / Firefox)

| Layer | Role |
|-------|------|
| Popup (`popup.js`) | Service list UI, search, CRUD, settings, sync trigger |
| Content script (`content.js`) | Autofill via native property descriptors |
| Background (`background.js`) | Session management, local encryption, auto-lock timer |

The content script uses `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set` to bypass framework-controlled inputs (React, Angular). This requires `activeTab` + `scripting` permissions.

### 2.3 Android App

Jetpack Compose UI with:
- Biometric authentication (BiometricPrompt)
- Service CRUD with search
- Encrypted local storage (EncryptedSharedPreferences)
- Sync, export/import

### 2.4 Server (Go)

Single-binary Go server behind nginx reverse proxy:
- Sync API (`/api/sync/:lookup_id`) — GET and PUT
- Dual token-bucket rate limiting
- Static file serving (web generator, site rules, breach feed)
- Docker deployment with auto-deploy via CI/CD

### 2.5 Web Generator

Static PWA at `/generate/`. Offline-capable via service worker. Derives passwords locally — no server communication. No sync capability.

---

## 3. Data Flow

### 3.1 Password Derivation (Local Only)

Password derivation never leaves the device. No network calls involved.

```
secret + email
      │
      ▼
┌─────────────────────────────────────────────────────┐
│ Argon2id(secret, salt="keygrain-strengthen:"+email) │
│   m=64MiB, t=3, p=1, output=32 bytes               │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼ strengthened (32 bytes)
                       │
      ┌────────────────┼────────────────┐
      │                │                │
      ▼                ▼                ▼
  lookup_id      auth_password    encryption_key
  (identity)     (server auth)    (blob encrypt)
      │                │                │
      │                │                ▼
      │                │         ┌──────────────┐
      │                │         │ AES-256-GCM  │
      │                │         │ encrypt/     │
      │                │         │ decrypt blob │
      │                │         └──────────────┘
      │                │
      ▼                ▼
┌──────────────────────────────┐
│ HTTP Basic Auth to server    │
│ username=lookup_id           │
│ password=auth_password       │
└──────────────────────────────┘
```

**Per-password derivation:**

```
message = site.lower() + ":" + email.lower() + ":" + length + ":" + counter
key     = HMAC-SHA256(strengthened, message)
stream  = key || HMAC-SHA256(key, 0x01) || HMAC-SHA256(key, 0x02) || ...
password = buildPassword(stream, length, symbols)
```

The `symbols` charset affects output mapping but is NOT part of the HMAC input.

### 3.2 Key Derivation Tree

All keys derive from the same Argon2id-strengthened secret, differentiated by purpose suffix:

| Key | Derivation | Purpose |
|-----|-----------|---------|
| Lookup ID | `hex(HMAC-SHA256(strengthened, email + ":keygrain-id"))` | Server identity (64-char hex) |
| Auth Password | `derivePassword(strengthened, email + ":32:keygrain-auth")` | HTTP Basic auth (32-char password) |
| Sync Encryption Key | `HMAC-SHA256(strengthened, email + ":keygrain-encryption")` | AES-256-GCM key for sync blob |
| Local Storage Key | `HMAC-SHA256(strengthened, email + ":keygrain-local-storage")` | AES-256-GCM key for local encrypted storage (extension) |

### 3.3 Sync Flow

```
Client                                    Server
  │                                         │
  │─── GET /api/sync/:lookup_id ───────────▶│
  │◀── 200 {services, encrypted_blob} ─────│
  │                                         │
  │  ┌─────────────────────────┐            │
  │  │ 1. Verify checksum      │            │
  │  │ 2. Decrypt blob         │            │
  │  │ 3. Validate metadata    │            │
  │  │ 4. Merge local+remote   │            │
  │  │ 5. Encrypt merged blob  │            │
  │  │ 6. Compute checksum     │            │
  │  └─────────────────────────┘            │
  │                                         │
  │─── PUT /api/sync/:lookup_id ───────────▶│
  │    If-Match: "<etag>"                   │
  │    {services, encrypted_blob, checksum} │
  │                                         │
  │◀── 200 {services (with UUIDs), etag} ──│
  │                                         │
  │  ┌─────────────────────────┐            │
  │  │ Update local UUIDs      │            │
  │  │ Update known-UUIDs set  │            │
  │  │ Cache metadata          │            │
  │  └─────────────────────────┘            │
```

On 409 Conflict: client re-fetches, re-merges, and retries (max 1 retry).

---

## 4. Security Model

### 4.1 Trust Boundaries

```
┌─────────────────────────────────────────────────────────┐
│ TRUSTED ZONE (client device)                            │
│                                                         │
│  • Master secret:                                       │
│    - Extension: session storage (cleared on close/lock) │
│    - Android: EncryptedSharedPreferences (biometric)    │
│    - Web generator: memory only (never persisted)       │
│  • Strengthened key (cached in memory during session)   │
│  • Plaintext service data                               │
│  • All cryptographic operations                         │
│  • Merge logic and conflict resolution                  │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ UNTRUSTED ZONE (server + network)                       │
│                                                         │
│  • Encrypted blob (opaque — server cannot decrypt)      │
│  • Service metadata: UUIDs + timestamps (plaintext)     │
│  • Auth password hash (bcrypt, cost 12)                 │
│  • Lookup ID (pseudonymous — not linkable to email)     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**What the server CAN see:** Number of services, when each was last modified, blob size, access patterns.

**What the server CANNOT see:** Service names, sites, emails, passwords, password parameters, master secret.

### 4.2 Encryption

| Property | Value |
|----------|-------|
| Algorithm | AES-256-GCM |
| Key size | 256 bits (32 bytes from HMAC-SHA256) |
| Nonce | 12 bytes, cryptographically random |
| Ciphertext format | `nonce (12B) \|\| ciphertext \|\| auth tag (16B)` |
| Encoding | Base64 for transport/storage |

Two distinct encryption keys with separate purposes:
- **Sync encryption key** (`:keygrain-encryption`): encrypts the blob sent to the server. No AAD.
- **Local storage key** (`:keygrain-local-storage`): encrypts service data in `chrome.storage.local`. Uses AAD = `email.lowercase()`, binding ciphertext to the account identity and preventing cross-account blob substitution.

### 4.3 Key Strengthening

| Parameter | Value |
|-----------|-------|
| Algorithm | Argon2id |
| Memory | 64 MiB |
| Iterations | 3 |
| Parallelism | 1 |
| Output | 32 bytes |
| Salt | `"keygrain-strengthen:" + email.lowercase()` |

The strengthened key is the root for all derived keys. Argon2id provides resistance against GPU/ASIC brute-force attacks.

### 4.4 Rate Limiting

Dual token-bucket rate limiting protects against brute-force:

| Bucket | Burst | Refill Rate | Purpose |
|--------|-------|-------------|---------|
| Per-IP | 100 | 100/min | Prevents distributed attacks from single IP |
| Per-lookup_id | 10 | 2/min | Prevents targeted account brute-force |

Configurable via environment variables. Uses `X-Real-IP` header (trusted from nginx).

### 4.5 Threat Model Summary

| Threat | Mitigation |
|--------|-----------|
| Server compromise | Blob is AES-256-GCM encrypted; server has no decryption key |
| Brute-force auth | bcrypt(12) + 32-char derived password + rate limiting |
| Brute-force master secret | Argon2id (64MiB) makes offline attacks expensive |
| Network interception | TLS 1.2+ (nginx + Let's Encrypt) |
| Metadata tampering by server | Client-side metadata caching with integrity checks |
| Replay attack (stale GET) | ETag-based optimistic locking detects stale state on PUT |
| Clock skew → wrong merge winner | Accepted limitation; monotonic timestamp recommendation |
| Accidental mass deletion | Client-side empty-push protection guardrail |

For the full threat model, see `designs/sync-v2.md` §9.

---

## 5. Data at Rest

### 5.1 Browser Extension

Services are encrypted with the **local storage key** (AES-256-GCM) and stored in `chrome.storage.local`. The master secret is held in memory only and cleared on lock/timeout (configurable auto-lock via `chrome.alarms`).

### 5.2 Android App

| Data | Storage | Encryption |
|------|---------|-----------|
| Services | `EncryptedSharedPreferences` | AES256_SIV (keys) + AES256_GCM (values) |
| Master secret | `EncryptedSharedPreferences` | Same scheme, protected by biometric |
| Sync state | `SharedPreferences` (non-sensitive metadata only) | None (contains only sync timestamps) |

`EncryptedSharedPreferences` uses Android Keystore-backed keys — hardware-protected on supported devices.

### 5.3 Server

One JSON file per user at `data/sync/<lookup_id>.json`:

```json
{
  "auth_password_hash": "<bcrypt cost-12>",
  "services": [{"id": "uuid", "updated_at": 1715000000}],
  "encrypted_blob": "<base64 AES-256-GCM ciphertext>",
  "checksum": "<sha256-hex of encrypted blob>",
  "etag": "<sha256-truncated-16-bytes-hex>",
  "version": 1,
  "created_at": "2025-05-01T00:00:00Z",
  "updated_at": "2025-05-09T00:00:00Z"
}
```

Writes are atomic (write to `.tmp` file, then `os.Rename`). Per-lookup_id mutex prevents concurrent writes to the same file.

---

## 6. Sync Protocol

### 6.1 Per-Service Merge Algorithm

Each service has a UUID (server-assigned) and `updated_at` timestamp. Merge operates on three sets:

| Set | Condition | Action |
|-----|-----------|--------|
| Both (same UUID) | UUID in local AND remote | Higher `updated_at` wins; remote wins ties |
| Remote-only | UUID in remote, not in local known set | New from another device → add |
| Remote-only | UUID in remote, in local known set but absent locally | Deleted locally → exclude |
| Local-only (no UUID) | Service has no UUID | New locally → push with `id: null` |
| Local-only (has UUID) | UUID in local, absent from remote | Deleted remotely → exclude |

### 6.2 Conflict Resolution

- **Timestamp-based:** Higher `updated_at` wins per-service
- **Tie-breaking:** Remote wins when timestamps are equal (deterministic)
- **Concurrent pushes:** ETag mismatch → 409 → re-fetch, re-merge, retry

### 6.3 Deletion Model

No tombstones. Deletion = absence of a previously-known UUID.

- Client maintains a **known-UUIDs set** (all UUIDs seen from server)
- A UUID in the known set but absent from remote → deleted on another device → remove locally
- A UUID in the known set but absent locally → deleted on this device → exclude from push

**Safety:** Clients refuse to push an empty service list when remote was non-empty (prevents accidental total deletion).

### 6.4 Optimistic Locking

- `GET` returns `ETag` header (SHA-256 of blob, truncated to 16 bytes, hex)
- `PUT` requires `If-Match: "<etag>"` for existing records
- Mismatch → 409 Conflict with `current_etag` in response body
- First PUT (new user) does not require `If-Match`

---

## 7. Deployment Architecture

```
Internet ──▶ nginx (TLS termination, Let's Encrypt)
                │
                ▼
         Go binary (port 9860)
                │
                ▼
         /opt/keygrain/data/ (Docker volume)
```

- **Build:** Docker multi-stage (Go alpine builder → alpine runtime)
- **Deploy:** GitLab CI → SSH → `docker compose build && up -d`
- **TLS:** nginx handles certificate renewal and HTTPS termination
- **IP forwarding:** `X-Real-IP` header from nginx to Go for rate limiting
