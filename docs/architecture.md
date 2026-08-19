# Keygrain — System Architecture

## 1. System Overview

Keygrain is a deterministic password manager. A master secret plus site and account information deterministically derives a unique password locally; generated passwords are not stored or synced. Clients do store service configuration and other local account/device state, and an optional end-to-end encrypted sync layer shares that service data across devices.

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
          │       HTTPS      │
          ▼                  ▼
┌─────────────────────────────────────────┐
│             PUBLIC SYNC SERVICE          │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │ Rate limits │  │ Sync API        │  │
│  │             │──▶│ (GET/PUT/DELETE)│  │
│  └─────────────┘  └─────────────────┘  │
│   opaque encrypted state + limited      │
│   protocol metadata; no plaintext data  │
└─────────────────────────────────────────┘
```

**Key invariant:** Password derivation and encryption happen on the client. The sync service cannot read the master secret, generated passwords, or plaintext service data such as names, sites, account emails, and configuration; it receives only an opaque encrypted blob and limited protocol metadata needed by the public sync API.

---

## 2. Components

### 2.1 Core Algorithm Library

Identical implementations in Python, JavaScript, and Kotlin. All produce the same output for the same inputs, with committed cross-platform vectors and parity checks guarding implementation agreement.

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

The content script uses `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set` to bypass framework-controlled inputs (React, Angular). The extension uses `activeTab` for access to the current tab. Chrome uses the `scripting` permission for script injection; Firefox's MV2 flow uses `tabs.executeScript` and does not require a separate `scripting` permission.

### 2.3 Android App

Jetpack Compose UI with:
- Biometric authentication (BiometricPrompt)
- Service CRUD with search
- Encrypted local storage (EncryptedSharedPreferences)
- Sync, export/import

### 2.4 Sync Service

The hosted sync service exposes the public HTTP API documented in [API.md](../API.md): authenticated GET, PUT, and DELETE operations for an opaque encrypted sync state. It applies rate limits and optimistic locking; clients perform encryption, decryption, validation, merging, and conflict resolution. The service does not receive the master secret, generated passwords, or plaintext service data.

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
  │─── DELETE /api/sync/:lookup_id ────────▶│
  │◀── 200 deleted / 404 already absent ────│
  │                                         │
  │  ┌─────────────────────────┐            │
  │  │ Update local UUIDs      │            │
  │  │ Update known-UUIDs set  │            │
  │  │ Cache metadata          │            │
  │  └─────────────────────────┘            │
```

On 409 Conflict: the client re-fetches the current state, re-merges, and retries with bounded backoff. After the retry budget is exhausted, the client surfaces the conflict rather than retrying indefinitely.

---

## 4. Security Model

### 4.1 Trust Boundaries

```
┌─────────────────────────────────────────────────────────┐
│ TRUSTED ZONE (client device)                            │
│                                                         │
│  • Master secret and strengthened key in memory          │
│    during an unlocked session                           │
│  • Cleared from memory on lock or timeout                │
│  • Optional encrypted local copy for PIN/biometric      │
│    unlock, where the client supports it                 │
│  • Plaintext service/configuration data and local        │
│    account/device state                                  │
│  • All cryptographic operations, merge, and conflict     │
│    resolution                                            │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ UNTRUSTED ZONE (sync service + network)                 │
│                                                         │
│  • Opaque encrypted blob, checksum, and ETag             │
│  • Service metadata: UUIDs and timestamps                │
│  • Pseudonymous lookup_id                                │
│  • Auth password hash (bcrypt, cost 12)                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**What the sync service CAN see:** Limited protocol metadata such as service UUIDs and timestamps, the opaque blob's checksum and size, the ETag, the pseudonymous lookup ID, the auth hash, and request/access patterns.

**What the sync service CANNOT see:** The master secret, generated passwords, plaintext service names, sites, account emails, password parameters, or other plaintext service/configuration data.

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

Dual token-bucket rate limiting protects the sync authentication surface against brute-force attempts:

| Bucket | Burst | Refill Rate | Purpose |
|--------|-------|-------------|---------|
| Per-IP | 100 | 100/min | Limits requests from one network source |
| Per-lookup_id | 10 | 2/min | Limits attempts against one pseudonymous account |

### 4.5 Threat Model Summary

| Threat | Mitigation |
|--------|-----------|
| Server compromise | Blob is AES-256-GCM encrypted; server has no decryption key |
| Brute-force auth | bcrypt(12) + 32-char derived password + rate limiting |
| Brute-force master secret | Argon2id (64MiB) makes offline attacks expensive |
| Network interception | TLS 1.2+ for HTTPS |
| Metadata tampering by server | Client-side metadata caching with integrity checks |
| Replay attack (stale GET) | ETag-based optimistic locking detects stale state on PUT |
| Clock skew → wrong merge winner | Accepted limitation; monotonic timestamp recommendation |
| Accidental mass deletion | Client-side empty-push protection guardrail |

For the public protocol contract, see [API.md](../API.md). Security guidance is in [SECURITY.md](../SECURITY.md).

---

## 5. Data at Rest

### 5.1 Browser Extension

The extension stores service configuration and related local account/device state locally; service data is encrypted with the **local storage key** (AES-256-GCM). Generated passwords are derived when needed and are not stored. The master secret and strengthened key are held in memory during an unlocked session and cleared on lock or timeout. If PIN unlock is enabled, an encrypted local copy of the master secret may be retained for that unlock flow.

### 5.2 Android App

The Android app stores service configuration and sync-related account/device state locally. While unlocked, the master secret and strengthened key are held in memory; locking clears the in-memory copy. When biometric unlock is enabled, an encrypted copy of the master secret may be retained locally using Android Keystore-backed protection. Generated passwords remain derived outputs, not stored vault entries.

### 5.3 Sync Service

The sync service stores the opaque encrypted blob and the limited protocol metadata required by [API.md](../API.md): service UUID/timestamp metadata, checksum, ETag, pseudonymous lookup ID, and the bcrypt hash of the derived authentication password. It does not store plaintext service data, generated passwords, the master secret, or deletion records. The client performs decryption, validation, merge, and deletion review.

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

Deletion review is client-local; the sync service keeps no deletion records or server-side tombstones. Clients track the UUIDs they have seen and use that state to distinguish an intentional local deletion from a service that is newly arriving from another device.

When a client sends `deleted_ids`, the sync service validates the request but never persists those IDs. Every currently stored service ID absent from `services` must be declared in `deleted_ids`, or the request is rejected. An intentionally empty `services` list is accepted when all currently stored IDs are declared. Declaring an ID that is not stored is harmless and supports idempotent retries.

If `deleted_ids` is omitted, the legacy API heuristic applies: an empty push against a non-empty record is rejected, while subset removals may be accepted without declaration. See [API.md](../API.md) for the complete contract. Clients should review deletions locally before pushing and retain only the local known-UUID/deletion-review state needed for that safety check.

### 6.4 Optimistic Locking

- `GET` returns `ETag` header (SHA-256 of blob, truncated to 16 bytes, hex)
- `PUT` requires `If-Match: "<etag>"` for existing records
- Mismatch → 409 Conflict with `current_etag` in response body
- First PUT (new user) does not require `If-Match`
