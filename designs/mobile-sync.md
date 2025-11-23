# Mobile Sync Feature — Design Document

## 1. Overview

The keygrain Android app gains the ability to backup and restore its service list to/from the keygrain server (`https://keygrain.secbytech.com`). The sync is manual (user-triggered), uses last-write-wins semantics (per SPEC.md), and relies on three values derived from the user's master secret + email:

- **Lookup ID** — identifies the user's backup slot on the server
- **Auth password** — authenticates the user via HTTP Basic auth
- **Encryption key** — encrypts/decrypts the service list client-side (server never sees plaintext)

No accounts, no email verification. The master secret is the sole proof of identity.

## 2. Interface Contracts

### 2.1 New Derivation Functions on `Keygrain` Object

```kotlin
object Keygrain {
    // ... existing code ...

    /**
     * Derives the lookup ID for the backup API.
     * lookup_id = hex(HMAC-SHA256(secret, lowercase(email) + ":keygrain-id"))
     */
    fun deriveLookupId(secret: ByteArray, email: String): String

    /**
     * Derives the auth password for Basic auth against the backup API.
     * Equivalent to: derivePassword(secret, email, length=32, symbols=DEFAULT_SYMBOLS, salt="keygrain-auth")
     */
    fun deriveAuthPassword(secret: ByteArray, email: String): String

    /**
     * Derives the 256-bit encryption key for AES-256-GCM.
     * encryption_key = HMAC-SHA256(secret, lowercase(email) + ":keygrain-encryption")
     */
    fun deriveEncryptionKey(secret: ByteArray, email: String): ByteArray
}
```

### 2.2 `SyncResult` Sealed Class

```kotlin
sealed class SyncResult {
    data class Success(val message: String) : SyncResult()
    data class AuthError(val httpCode: Int) : SyncResult()      // 401/403
    data class NetworkError(val cause: Throwable) : SyncResult()
    data class NotFound(val message: String) : SyncResult()     // 404 on restore
    data class DecryptionError(val cause: Throwable) : SyncResult()
    data class ServerError(val httpCode: Int, val body: String) : SyncResult()
}
```

### 2.3 `SyncManager` Class

```kotlin
class SyncManager(
    private val baseUrl: String = "https://keygrain.secbytech.com"
) {
    /**
     * Backs up the service list to the server.
     * 1. Derives lookup_id, auth_password, encryption_key
     * 2. Serializes services to JSON
     * 3. Encrypts with AES-256-GCM
     * 4. PUT /api/backup/:lookup_id with Basic auth
     */
    suspend fun backup(
        secret: ByteArray,
        email: String,
        services: List<ServiceEntry>
    ): SyncResult

    /**
     * Restores the service list from the server.
     * 1. Derives lookup_id, auth_password, encryption_key
     * 2. GET /api/backup/:lookup_id with Basic auth
     * 3. Decrypts blob with AES-256-GCM
     * 4. Deserializes JSON to List<ServiceEntry>
     */
    suspend fun restore(
        secret: ByteArray,
        email: String
    ): RestoreResult
}

sealed class RestoreResult {
    data class Success(val services: List<ServiceEntry>) : RestoreResult()
    data class AuthError(val httpCode: Int) : RestoreResult()
    data class NetworkError(val cause: Throwable) : RestoreResult()
    data class NotFound(val message: String) : RestoreResult()
    data class DecryptionError(val cause: Throwable) : RestoreResult()
    data class ServerError(val httpCode: Int, val body: String) : RestoreResult()
}
```

### 2.4 Encryption Helpers (internal to SyncManager)

```kotlin
// Internal to SyncManager — not exposed publicly
internal object SyncCrypto {
    /**
     * Encrypts plaintext with AES-256-GCM.
     * Returns: IV (12 bytes) || ciphertext || GCM tag (16 bytes)
     */
    fun encrypt(key: ByteArray, plaintext: ByteArray): ByteArray

    /**
     * Decrypts blob produced by encrypt().
     * Expects: IV (12 bytes) || ciphertext || GCM tag (16 bytes)
     * Throws: AEADBadTagException on tampered/wrong-key data
     */
    fun decrypt(key: ByteArray, blob: ByteArray): ByteArray
}
```

### 2.5 Changes to `ServiceManager`

```kotlin
class ServiceManager(context: Context) {
    // ... existing code ...

    /**
     * Replaces the entire service list (used by restore).
     */
    fun replaceAll(services: List<ServiceEntry>)

    /**
     * Exports services as versioned JSON string (used by backup).
     * Format: {"version":1,"services":[{"name":"...","email":"...","length":20,"symbols":"...","salt":"..."}, ...]}
     */
    fun exportJson(): String

    /**
     * Parses versioned JSON string to service list (used by restore).
     * Accepts both versioned object format and bare array (backward-compat).
     * Throws JSONException on malformed input.
     */
    fun parseJson(json: String): List<ServiceEntry>
}
```

## 3. Sync Flows

### 3.1 Backup Flow

```
User taps "Backup" → Confirmation dialog → Execute:

1. Obtain masterSecret (already in memory from unlock) and email (from services or prompt)
2. services = serviceManager.getServices()
3. json = serviceManager.exportJson()  // Versioned JSON object
4. lookupId = Keygrain.deriveLookupId(secret, email)
5. authPassword = Keygrain.deriveAuthPassword(secret, email)
6. encryptionKey = Keygrain.deriveEncryptionKey(secret, email)
7. blob = SyncCrypto.encrypt(encryptionKey, json.toByteArray(UTF-8))
8. PUT https://keygrain.secbytech.com/api/backup/{lookupId}
   - Header: Authorization: Basic base64(lookupId:authPassword)
   - Body: blob (raw bytes, Content-Type: application/octet-stream)
9. Handle response:
   - 200/201 → SyncResult.Success
   - 401/403 → SyncResult.AuthError
   - 5xx → SyncResult.ServerError
   - IOException → SyncResult.NetworkError
10. Zero encryptionKey from memory
```

### 3.2 Restore Flow

```
User taps "Restore" → Confirmation dialog ("This will replace your local services") → Execute:

1. Obtain masterSecret and email
2. lookupId = Keygrain.deriveLookupId(secret, email)
3. authPassword = Keygrain.deriveAuthPassword(secret, email)
4. encryptionKey = Keygrain.deriveEncryptionKey(secret, email)
5. GET https://keygrain.secbytech.com/api/backup/{lookupId}
   - Header: Authorization: Basic base64(lookupId:authPassword)
6. Handle response:
   - 200 → continue with body bytes
   - 401/403 → RestoreResult.AuthError
   - 404 → RestoreResult.NotFound ("No backup found for this secret/email")
   - 5xx → RestoreResult.ServerError
   - IOException → RestoreResult.NetworkError
7. blob = response body bytes
8. plaintext = SyncCrypto.decrypt(encryptionKey, blob)
   - AEADBadTagException → RestoreResult.DecryptionError
9. json = String(plaintext, UTF-8)
10. services = serviceManager.parseJson(json)
    - JSONException → RestoreResult.DecryptionError (GCM passed but JSON broken = bug)
11. serviceManager.replaceAll(services)
12. Zero encryptionKey from memory
13. Return RestoreResult.Success(services)
```

### 3.3 Email Resolution

The backup/restore derivations require an email. Design options:

- **Option chosen:** Prompt the user for their email before backup/restore. The email field is pre-filled with the most common email across their services (mode). This avoids storing a "primary email" separately and works on fresh installs (restore scenario).

### 3.4 Encrypted Blob Wire Format

```
+--------+------------+---------+
| IV     | Ciphertext | GCM Tag |
| 12 B   | variable   | 16 B    |
+--------+------------+---------+
```

- **IV:** 12 random bytes generated via `SecureRandom` on each backup
- **Ciphertext:** AES-256-GCM encrypted payload
- **GCM Tag:** 128-bit authentication tag (appended by Android's `Cipher` implementation)
- **Minimum valid blob size:** 28 bytes (12 + 0 + 16)

### 3.5 JSON Payload Format

The plaintext encrypted inside the blob:

```json
{
  "version": 1,
  "services": [
    {
      "name": "GitHub",
      "email": "user@example.com",
      "length": 20,
      "symbols": "!@#$%&*-_=+?",
      "salt": ""
    }
  ]
}
```

**Parsing rules:**
- Top-level: object with `version` (int, ignored for now) and `services` (array)
- Backward-compat: if top-level is a bare JSON array, treat it as version 0 services array
- Per service — required fields: `name` (string, non-empty), `email` (string, non-empty)
- Per service — optional fields with defaults: `length` (int, default 20), `symbols` (string, default `!@#$%&*-_=+?`), `salt` (string, default `""`)
- Unknown fields: silently ignored (forward-compatibility)
- Structural failure (missing required fields, invalid JSON): throws `JSONException`

## 4. Edge Cases

| Scenario | Behavior |
|----------|----------|
| Empty service list backup | Allowed — encrypts `[]`. Valid restore returns empty list. |
| Network timeout | `SyncResult.NetworkError` / `RestoreResult.NetworkError`. User shown retry option. |
| 401 Unauthorized | `AuthError`. Indicates wrong secret/email combination. User shown error message. |
| 404 Not Found (restore) | `NotFound`. No backup exists for this identity. First-time user or wrong email. |
| Server 5xx | `ServerError`. Transient — user shown retry option. |
| Blob < 28 bytes | `DecryptionError`. Blob is truncated/corrupt. |
| Wrong secret used for restore | GCM decryption fails → `DecryptionError`. User told "wrong secret or email". |
| Very large service list (1000+ entries) | JSON + GCM overhead is negligible. OkHttp handles large bodies. No pagination needed. |
| Concurrent backup from two devices | Last-write-wins. No conflict detection. User is warned in UI. |
| App killed during backup | PUT is atomic from server perspective — either succeeds or doesn't. No partial state. |
| App killed during restore | `replaceAll` writes to SharedPreferences atomically (single `apply()`). No partial state. |
| No internet connection | OkHttp throws `IOException` immediately. Mapped to `NetworkError`. |

## 5. Security Considerations

### 5.1 Threat Model

| Threat | Impact | Mitigation |
|--------|--------|------------|
| **Server compromise** | Attacker gets lookup_ids + bcrypt hashes + encrypted blobs | Blobs are AES-256-GCM encrypted. Useless without master secret. Bcrypt hashes resist offline cracking. |
| **MITM attack** | Attacker intercepts traffic | TLS protects transport. Even if TLS is broken, attacker only sees encrypted blob + auth credentials. Auth credentials are derived (not reused elsewhere). Blob is E2E encrypted. |
| **Device compromise** | Attacker accesses local storage | Services stored in EncryptedSharedPreferences (AES-256-GCM via Android Keystore). Master secret protected by biometric. Sync credentials are ephemeral (derived on demand, not stored). |
| **Wrong secret on restore** | Decryption fails | GCM tag verification fails → `DecryptionError`. No partial data leakage. |
| **Replay/rollback attack** | Attacker with old blob PUTs it back | Requires auth_password (derived from master secret). Without the secret, attacker cannot authenticate. If attacker has the secret, they already have everything. |
| **Brute-force lookup_id** | Attacker guesses lookup_ids to download blobs | lookup_id is 256-bit HMAC output (hex-encoded). Infeasible to enumerate. Server should rate-limit auth attempts. |

### 5.2 Key Material Lifecycle

```
User unlocks app → masterSecret held as String (immutable, JVM-managed)
                 ↓
User triggers backup/restore
                 ↓
secretBytes = masterSecret.toByteArray()  ← zeroed after sync
encryptionKey = deriveEncryptionKey(...)   ← zeroed after encrypt/decrypt
authPassword = deriveAuthPassword(...)     ← String, cannot be zeroed (used in HTTP header)
lookupId = deriveLookupId(...)             ← String, used in URL path
                 ↓
Sync operation completes
                 ↓
secretBytes.fill(0)
encryptionKey.fill(0)
// authPassword and lookupId: GC-eligible, cannot be explicitly zeroed
```

### 5.3 Memory Safety Limitations

- **masterSecret as String:** The existing app holds the master secret as a Kotlin `String` (`var masterSecret by remember { mutableStateOf("") }`). Strings are immutable and may be interned on the JVM — they cannot be zeroed. This is a pre-existing limitation, not introduced by sync.
- **ByteArray zeroing:** `encryptionKey` and `secretBytes` are `ByteArray` and CAN be zeroed with `array.fill(0)`. The sync feature ensures these are zeroed after use.
- **JVM copies:** The JVM may create internal copies of byte arrays during crypto operations. This is unavoidable without native code. Accepted as a best-effort limitation.
- **Recommendation:** Document that for maximum security, users should lock the app (clearing `masterSecret` from compose state) when not actively using it.

### 5.4 TLS Configuration

**Decision: No certificate pinning.**

Rationale:
- The server uses Let's Encrypt certificates, which rotate intermediates frequently
- Pinning adds maintenance burden and risk of bricking the app if pins expire
- The blob is E2E encrypted — MITM only sees opaque ciphertext
- Auth credentials are derived and not reused for other services
- Standard Android certificate validation (system trust store) is sufficient

### 5.5 No Credential Storage

Sync credentials (lookup_id, auth_password, encryption_key) are **never persisted**. They are derived on-demand from the master secret + email, used for the single HTTP request, then discarded. This means:
- No credential cache to protect
- No token refresh logic
- No session management
- Each sync operation is stateless and self-contained

## 6. UI Changes

### 6.1 ServiceListScreen Modifications

Add an overflow menu (⋮) to the top app bar, positioned before the lock icon:

```
┌─────────────────────────────────────┐
│ Keygrain                    [⋮] [🔒] │
├─────────────────────────────────────┤
│                                     │
│  [Service cards...]                 │
│                                     │
│                            [+ FAB]  │
└─────────────────────────────────────┘

Overflow menu:
┌──────────────────────┐
│ Backup to server     │
│ Restore from server  │
└──────────────────────┘
```

### 6.2 Email Prompt Dialog

Triggered by both Backup and Restore:

```
┌─────────────────────────────────┐
│ Backup to Server                │
│                                 │
│ Email for backup identity:      │
│ ┌─────────────────────────────┐ │
│ │ user@example.com            │ │
│ └─────────────────────────────┘ │
│                                 │
│           [Cancel] [Continue]   │
└─────────────────────────────────┘
```

- Pre-filled with the most common email across services (mode)
- On fresh install (restore), field is empty — user must type it

### 6.3 Confirmation Dialogs

**Backup:**
> "Back up N services to the server? This will overwrite any existing backup for this email."

**Restore:**
> "Restore from server? This will replace all N local services with the backup."

### 6.4 Loading & Feedback

- Show `CircularProgressIndicator` in a non-dismissable dialog during sync
- On success: `Snackbar` with "Backup complete" / "Restored N services"
- On error: `Snackbar` with user-friendly message:
  - `NetworkError` → "Network error. Check your connection and try again."
  - `AuthError` → "Authentication failed. Check your secret and email."
  - `NotFound` → "No backup found for this email."
  - `DecryptionError` → "Could not decrypt backup. Wrong secret or email."
  - `ServerError` → "Server error. Try again later."

### 6.5 State Management

Sync operations run in a coroutine scope tied to the composable lifecycle. A `SyncViewModel` (or simple state holder) manages:
- `isSyncing: Boolean` — shows/hides loading dialog
- `syncError: String?` — shows error snackbar
- `syncSuccess: String?` — shows success snackbar

## 7. Test Plan

### 7.1 Unit Tests — Derivation Functions

| Test | Input | Expected Output |
|------|-------|-----------------|
| `deriveLookupId` | secret=`"testsecret"`, email=`"user@example.com"` | Canonical hex value (define at implementation time by running Python HMAC) |
| `deriveAuthPassword` | secret=`"testsecret"`, email=`"user@example.com"` | Same as `derivePassword(secret, "user@example.com", 32, DEFAULT_SYMBOLS, "keygrain-auth")` |
| `deriveEncryptionKey` | secret=`"testsecret"`, email=`"user@example.com"` | Canonical 32-byte value |
| Email normalization | email=`"User@Example.COM"` | Same output as `"user@example.com"` |

**Canonical test vectors** (to be computed at implementation time using Python `hmac` library and committed to both Python and Kotlin test suites for cross-platform verification):

```
secret = b"testsecret"
email = "user@example.com"

lookup_id = hex(HMAC-SHA256(b"testsecret", b"user@example.com:keygrain-id"))
encryption_key = HMAC-SHA256(b"testsecret", b"user@example.com:keygrain-encryption")
auth_password = derive_password(b"testsecret", "user@example.com", length=32, symbols="!@#$%&*-_=+?", salt="keygrain-auth")
```

### 7.2 Unit Tests — SyncCrypto

| Test | Scenario | Expected |
|------|----------|----------|
| Round-trip | encrypt then decrypt | Original plaintext recovered |
| Wrong key | decrypt with different key | `AEADBadTagException` |
| Truncated blob | blob < 28 bytes | Exception (IllegalArgumentException or similar) |
| Empty plaintext | encrypt `[]` (2 bytes) | Valid 30-byte blob, decrypts back to `[]` |
| IV uniqueness | Two encryptions of same plaintext | Different blobs (different random IVs) |

### 7.3 Unit Tests — ServiceManager JSON

| Test | Scenario | Expected |
|------|----------|----------|
| Round-trip | exportJson → parseJson | Same list |
| Missing optional fields | JSON without `length`, `symbols`, `salt` | Defaults applied (20, DEFAULT_SYMBOLS, "") |
| Missing required field | JSON without `name` | `JSONException` |
| Unknown extra fields | JSON with `"foo": "bar"` | Ignored, parse succeeds |
| Empty array | `[]` | Empty list |

### 7.4 Integration Tests — SyncManager with MockWebServer

| Test | Server Response | Expected Result |
|------|-----------------|-----------------|
| Backup success | 200 OK | `SyncResult.Success` |
| Backup auth failure | 401 | `SyncResult.AuthError(401)` |
| Backup server error | 500 | `SyncResult.ServerError(500, ...)` |
| Restore success | 200 + valid blob | `RestoreResult.Success(services)` |
| Restore not found | 404 | `RestoreResult.NotFound` |
| Restore corrupted blob | 200 + garbage bytes | `RestoreResult.DecryptionError` |
| Network failure | Connection refused | `NetworkError` |

### 7.5 Manual / E2E Tests

1. Fresh install → Restore → "No backup found"
2. Add services → Backup → Uninstall → Reinstall → Restore → Services recovered
3. Backup from Android → Restore from Python CLI (cross-platform)
4. Backup from Python CLI → Restore on Android (cross-platform)
5. Backup with email A → Attempt restore with email B → 404 or auth error
6. Backup → Change secret → Attempt restore → DecryptionError

### 7.6 Cross-Platform Compatibility

The Python implementation must produce identical derivations. A shared test vector file (`tests/sync-vectors.json`) should be created:

```json
{
  "secret": "testsecret",
  "email": "user@example.com",
  "expected": {
    "lookup_id": "<hex>",
    "auth_password": "<string>",
    "encryption_key": "<hex>"
  }
}
```

Both Python and Kotlin test suites read this file and verify their implementations match.

## 8. Design Decisions

### 8.1 Payload Versioning

The encrypted JSON payload includes a top-level `"version"` field:

```json
{
  "version": 1,
  "services": [
    {"name": "GitHub", "email": "user@example.com", "length": 20, "symbols": "!@#$%&*-_=+?", "salt": ""}
  ]
}
```

- Current parser ignores the version field (treats it as unknown)
- Future versions may use it for migration logic (e.g., schema changes)
- Cost: one extra JSON field. Benefit: forward-compatible schema evolution without guesswork.

**Note:** This changes the payload format from a bare array to a versioned object. The `exportJson()` and `parseJson()` functions in section 2.5 should produce/consume this format.

### 8.2 Multi-Email Limitation

The backup identity is derived from ONE email + the master secret. This is a fundamental constraint of the SPEC design:
- All services (regardless of their individual email fields) are stored in a single backup slot
- The backup email determines which slot is used — it does not need to match any service's email
- If the user forgets which email they used for backup, they cannot restore

**Future enhancement:** Support multiple backup slots by allowing the user to choose or manage backup identities. Out of scope for v1.

## 9. Open Questions

| # | Question | Context | Impact |
|---|----------|---------|--------|
| 1 | Should the app remember the last-used backup email? | Convenience for repeat backups. Could store in SharedPreferences (not sensitive — it's just an email). | Low risk. Improves UX for repeat backups. |
| 2 | Should the UI show a "last backup" timestamp? | Helps user know if their backup is stale. Would require storing the timestamp locally after successful backup. | UX improvement. No security impact. |
| 3 | Should restore show a preview before replacing? | Currently: warning dialog with count. Could show: "Server has N services, you have M locally. Replace?" | UX improvement. Requires decrypting before confirming (extra step). |
| 4 | Client-side rate limiting for sync operations? | Prevent accidental rapid-fire backups. Server may have its own rate limiting. | Low priority. Could add a simple cooldown (e.g., 30s between syncs). |
| 5 | Custom server URL (self-hosted support)? | `SyncManager` already accepts `baseUrl` parameter. Should this be exposed in settings UI? | Architecture supports it. Question is whether to add UI for it in v1. |
| 6 | Should backup be offered automatically after adding/deleting a service? | A non-blocking prompt: "Your services changed. Back up now?" | UX convenience vs. annoyance. Could be a setting. |
