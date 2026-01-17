# TOTP Integration Design

**Version:** 1
**Status:** Draft

---

## 1. Overview

Keygrain gains TOTP (Time-based One-Time Password) support, turning it into a combined password manager + authenticator app. Two models serve different use cases:

- **Model A (Stored Seeds):** The primary feature. Sites generate random TOTP seeds that cannot be substituted. Keygrain accepts the seed (via QR scan or manual entry), stores it in the service entry, and generates 6/8-digit codes on demand. Seeds are protected by the existing AES-256-GCM blob encryption.

- **Model B (Derived Seeds):** A power-user option for self-hosted services where the user controls the TOTP seed. The seed is derived deterministically from the master secret — no storage required. The user configures their service to accept the derived seed.

Both models produce RFC 6238-compliant TOTP codes. The feature integrates with the existing sync/backup system with no server-side changes.

### Competitive context

This competes directly with Bitwarden Premium's integrated TOTP. The advantage: Keygrain's TOTP is free, deterministic (Model B), and requires no cloud account for local-only use.

---

## 2. Model A: Stored Seeds

### Flow

1. User scans a QR code or manually enters a base32-encoded seed (or an `otpauth://` URI).
2. The seed is decoded to raw bytes and stored in the service entry's `totp` field.
3. On demand, Keygrain computes the current TOTP code from the stored seed + current time.

### Seed Input Formats

Inputs are parsed in strict priority order. The **first matching** format wins:

| Priority | Format | Detection rule | Parsing |
|----------|--------|----------------|---------|
| 1 | `otpauth://` URI | Starts with `otpauth://` | Parse query params |
| 2 | Raw hex | Valid hex, length ≥ 20 chars, AND contains at least one character NOT in the base32 alphabet (`0`, `1`, `8`, `9`, or lowercase `a`-`f`) | Hex decode |
| 3 | Raw base32 | Valid base32 (case-insensitive, optional padding/separators) | Base32 decode |

**Disambiguation rule:** A string that is valid as both hex and base32 (e.g., `ABCDEF234567ABCDEF23`) is parsed as **base32** unless it contains a character outside the base32 alphabet. The base32 alphabet is `A-Z` and `2-7` (case-insensitive). Characters `0`, `1`, `8`, `9`, and lowercase `a`-`f` are NOT in the base32 alphabet — their presence forces hex interpretation.

Examples:
- `JBSWY3DPEHPK3PXP` → base32 (all chars are in base32 alphabet)
- `48656c6c6f21deadbeef` → hex (contains `0`, `1`, `8`, `9`, lowercase letters)
- `ABCDEF234567ABCDEF23` → base32 (all chars are valid base32: A-F, 2-7)
- `abcdef234567abcdef23` → hex (lowercase `a`-`f` forces hex interpretation)

### `otpauth://` URI Parsing

Per [Google Authenticator Key URI Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format):

```
otpauth://totp/{label}?secret={base32}&issuer={issuer}&algorithm={algo}&digits={digits}&period={period}
```

| Parameter | Required | Default | Valid values |
|-----------|----------|---------|-------------|
| `secret` | Yes | — | Base32-encoded (no padding required) |
| `algorithm` | No | SHA1 | SHA1, SHA256, SHA512 |
| `digits` | No | 6 | 6, 8 (reject all other values) |
| `period` | No | 30 | Positive integer, minimum 1, maximum 300. Typical values: 30, 60. Values outside 10–90 SHOULD trigger a warning. |
| `issuer` | No | — | Informational only |

---

## 3. Model B: Derived Seeds

### Derivation

```
strengthened = strengthen(secret, email)
normalized_site = NORMALIZE_SITE(site)                       // Per SPEC.md §10.2
message = UTF8_ENCODE(LOWERCASE(normalized_site) + ":" + LOWERCASE(email) + ":keygrain-totp")
seed = HMAC-SHA256(key = strengthened, message = message)    // 32 bytes
```

**Site normalization** follows SPEC.md §10.2 (strip protocol, www, path/query/fragment, lowercase). Since normalization is applied at service creation time, the `site` field in the service entry is already in canonical form — the derivation uses it directly.

The full 32 bytes are used as the TOTP seed. This works with SHA1 (32-byte key is zero-padded to the 64-byte block size per RFC 2104), SHA256 (uses all 32 bytes as-is since block size is 64), and SHA512 (key is zero-padded to 128-byte block size).

### Properties

- Deterministic: same inputs always produce the same seed.
- Independent: changing site/email produces an uncorrelated seed.
- No storage: the seed is recomputed on demand.
- The user must configure their self-hosted service to accept this specific seed (exported as base32).
- The `site` value used in derivation is the normalized form stored in the service entry (per SPEC.md §10.2). Since normalization happens at service creation time, the derivation always uses the canonical form.
- Password counter rotation does NOT affect TOTP derivation. The formula intentionally excludes `counter` — incrementing the counter changes the password but the TOTP seed remains stable. This is by design: TOTP re-enrollment is a separate action from password rotation.

**⚠️ Normalization stability requirement:** If site normalization rules change in a future version (e.g., adding IDN/punycode handling), existing Model B TOTP seeds would silently change — breaking authentication. Any normalization change MUST include a migration path or version the normalization algorithm. This is the same constraint that applies to password derivation.

### Workflow

1. User marks a service as "Model B" (derived TOTP).
2. Keygrain derives the seed and displays it as base32 for the user to configure on their server.
3. From then on, Keygrain generates codes from the derived seed without storing anything.

---

## 4. Storage Format

### Service Entry Extension

The existing service entry JSON gains an optional `totp` field:

```json
{
  "name": "GitHub",
  "site": "github.com",
  "email": "user@example.com",
  "length": 20,
  "symbols": "!@#$%&*-_=+?",
  "counter": 1,
  "totp": {
    "mode": "stored",
    "seed": "SGVsbG8hZGVhZGJlZWY=",
    "digits": 6,
    "period": 30,
    "algorithm": "SHA1"
  }
}
```

### Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | string | Yes | `"stored"` (Model A) or `"derived"` (Model B) |
| `seed` | string | Model A only | Base64-encoded raw seed bytes |
| `digits` | integer | Yes | Number of output digits: 6 or 8 |
| `period` | integer | Yes | Time step in seconds (typically 30) |
| `algorithm` | string | Yes | Hash algorithm: `"SHA1"`, `"SHA256"`, or `"SHA512"` |

### Model B Entry

```json
{
  "name": "My NAS",
  "site": "nas.local",
  "email": "admin@example.com",
  "length": 20,
  "symbols": "!@#$%&*-_=+?",
  "counter": 1,
  "totp": {
    "mode": "derived",
    "digits": 6,
    "period": 30,
    "algorithm": "SHA1"
  }
}
```

No `seed` field — it is derived at runtime.

### Schema Validation Rules

- If `mode` is `"stored"`, the `seed` field MUST be present and non-empty.
- If `mode` is `"derived"`, the `seed` field MUST be absent. If present, implementations MUST ignore it (not use it for code generation) and SHOULD strip it on next save.
- If `mode` is any other value, reject the entry with an error.

### Absent TOTP

Services without TOTP have no `totp` field (or `"totp": null`). Both representations are equivalent.

---

## 5. TOTP Code Generation (RFC 6238)

### Algorithm

```
function generateTOTP(seed: bytes, time: int, digits: int, period: int, algorithm: string) -> string:
    T = floor(time / period)
    T_bytes = INT64_TO_BYTES_BIG_ENDIAN(T)    // 8 bytes
    
    hmac_result = HMAC(algorithm, key=seed, message=T_bytes)
    
    offset = hmac_result[len(hmac_result) - 1] & 0x0F
    code = (
        (hmac_result[offset]     & 0x7F) << 24 |
        (hmac_result[offset + 1] & 0xFF) << 16 |
        (hmac_result[offset + 2] & 0xFF) <<  8 |
        (hmac_result[offset + 3] & 0xFF)
    )
    
    otp = code % (10 ** digits)
    return ZERO_PAD_LEFT(otp, digits)
```

### Parameters

| Parameter | Source (Model A) | Source (Model B) |
|-----------|-----------------|-----------------|
| `seed` | Stored in service entry (base64-decoded) | Derived via HMAC-SHA256 |
| `time` | Current Unix timestamp (seconds) | Current Unix timestamp (seconds) |
| `digits` | From `totp.digits` | From `totp.digits` |
| `period` | From `totp.period` | From `totp.period` |
| `algorithm` | From `totp.algorithm` | From `totp.algorithm` |

### Time Source

Use the system clock (`Date.now() / 1000` in JS, `System.currentTimeMillis() / 1000` in Kotlin, `time.time()` in Python). No NTP correction — clock accuracy is the user's responsibility.

### Code Validity Window

Each code is valid for `period` seconds. Implementations SHOULD display:
- The current code
- A countdown indicator showing seconds remaining until the next code

Implementations SHOULD NOT pre-compute or display the next code.

### Code Display Format

TOTP codes SHOULD be displayed with a space separator for readability:
- 6-digit codes: `123 456`
- 8-digit codes: `1234 5678`

When copied to clipboard, the code MUST be copied WITHOUT spaces (digits only).

---

## 6. Interface Contracts

**Note on `secret` parameter type:** Python and Kotlin accept `secret` as `bytes`/`ByteArray` (the caller is responsible for encoding). JavaScript accepts `secret` as a `string` (UTF-8 encoding is applied internally by `strengthenSecret`). This mirrors the existing pattern in password derivation across all platforms.

### JavaScript (Browser Extension)

```javascript
/**
 * Parse a TOTP seed from various input formats.
 * @param {string} input - otpauth:// URI, base32 string, or hex string
 * @returns {{seed: Uint8Array, digits: number, period: number, algorithm: string, issuer: string|null, label: string|null}}
 * @throws {Error} if input cannot be parsed
 */
function parseTOTPInput(input) { }

/**
 * Generate a TOTP code from a raw seed and current time.
 * @param {Uint8Array} seed - Raw seed bytes
 * @param {number} time - Unix timestamp in seconds
 * @param {{digits?: number, period?: number, algorithm?: string}} options
 * @returns {Promise<string>} Zero-padded TOTP code
 */
async function generateTOTP(seed, time, options = {}) { }

/**
 * Derive a TOTP seed deterministically (Model B).
 * @param {string} secret - Master secret
 * @param {string} email - User email
 * @param {string} site - Site identifier
 * @returns {Promise<Uint8Array>} 32-byte derived seed
 */
async function deriveTOTPSeed(secret, email, site) { }

/**
 * Get the current TOTP code for a service entry.
 * @param {{totp: object}} service - Service entry with totp field
 * @param {string} secret - Master secret (needed for Model B)
 * @param {string} email - User email (needed for Model B)
 * @returns {Promise<{code: string, remaining: number}>} Current code and seconds remaining
 */
async function getTOTPCode(service, secret, email) { }

/**
 * Encode seed bytes as base32 (for Model B export).
 * @param {Uint8Array} seed - Raw seed bytes
 * @returns {string} Base32-encoded string (no padding)
 */
function seedToBase32(seed) { }
```

### Kotlin (Android)

```kotlin
/**
 * TOTP functions live in a separate TotpEngine object (not in the core Keygrain object).
 * Convention: core password/auth derivation → Keygrain object.
 * Feature-specific derivation → separate objects (TotpEngine, WalletEngine).
 * This keeps the core object focused and allows feature-gated compilation.
 */
object TotpEngine {
    /**
     * Parse TOTP input (otpauth:// URI, base32, or hex).
     * @throws IllegalArgumentException on invalid input
     */
    fun parseTotpInput(input: String): TotpParams

    /**
     * Generate a TOTP code.
     */
    fun generateTotp(
        seed: ByteArray,
        time: Long,          // Unix seconds
        digits: Int = 6,
        period: Int = 30,
        algorithm: String = "SHA1"
    ): String

    /**
     * Derive a TOTP seed deterministically (Model B).
     * Internally strengthens the secret (uses cache).
     */
    fun deriveTotpSeed(secret: ByteArray, email: String, site: String): ByteArray
}

data class TotpParams(
    val seed: ByteArray,
    val digits: Int,
    val period: Int,
    val algorithm: String,
    val issuer: String?,
    val label: String?
)
```

### Python (Reference Implementation)

```python
def parse_totp_input(input_str: str) -> dict:
    """Parse otpauth:// URI, base32, or hex into TOTP parameters.
    
    Returns: {"seed": bytes, "digits": int, "period": int, "algorithm": str,
              "issuer": str|None, "label": str|None}
    Raises: ValueError on invalid input.
    """

def generate_totp(
    seed: bytes,
    time: int,
    *,
    digits: int = 6,
    period: int = 30,
    algorithm: str = "SHA1",
) -> str:
    """Generate an RFC 6238 TOTP code. Returns zero-padded string."""

def derive_totp_seed(secret: bytes, email: str, site: str) -> bytes:
    """Derive a 32-byte TOTP seed deterministically (Model B)."""
```

---

## 7. Sync Integration

### No Server Changes

The `totp` field is part of the service content JSON inside the encrypted blob. The server never sees it. The sync protocol is unchanged:

```
Encrypted blob content (before): [{name, site, email, length, symbols, counter}, ...]
Encrypted blob content (after):  [{name, site, email, length, symbols, counter, totp?}, ...]
```

### Merge Behavior

TOTP data merges with the service entry as a unit. There is no per-field merge — the entire service entry (including `totp`) is replaced by the winning version (most recent `updated_at`).

Editing TOTP parameters (adding/removing/changing a seed) updates the service's `updated_at` timestamp, triggering sync.

### Blob Size Impact

A typical TOTP entry adds ~80-120 bytes to the JSON before encryption:
- `"totp":{"mode":"stored","seed":"<~28 chars base64>","digits":6,"period":30,"algorithm":"SHA1"}`

For 100 services with TOTP, this adds ~10 KB to the blob. Well within the 1 MB server limit.

---

## 8. Edge Cases

### Clock Drift

| Scenario | Impact | Mitigation |
|----------|--------|-----------|
| Device clock 30s+ off | Codes rejected by server | Display warning if system clock appears wrong (compare to TLS certificate timestamps or server response headers) |
| Device clock slightly off (< 30s) | Codes may be in adjacent window | Most services accept ±1 window. No action needed. |

### Invalid Seeds

| Input | Behavior |
|-------|----------|
| Empty string | Reject with error |
| Base32 with invalid characters | Strip whitespace/hyphens, reject if still invalid |
| Seed too short (< 16 bytes decoded) | Accept with warning (RFC 4226 §4 recommends ≥ 16 bytes; some services use shorter seeds) |
| Seed too long (> 64 bytes decoded) | Accept (HMAC handles arbitrary key lengths) |

### Counter Overflow

The time counter `T = floor(time / period)` is a 64-bit integer. At period=30, this overflows in ~8.7 × 10¹² years. Not a concern.

### Service Without Email (Model B)

Model B requires `email` for derivation. If a service entry has no email, Model B cannot be used. The UI must enforce this.

### Duplicate TOTP for Same Service

A service can have only one TOTP configuration. Adding a new one replaces the old one. The UI should confirm before overwriting.

### Seed Rotation (Model A)

To re-enroll TOTP (e.g., after a forced reset by the site), the user replaces the existing `totp` field with the new seed. The old seed is overwritten; no history is kept.

### QR Code Scanning Failures

| Failure | Handling |
|---------|----------|
| Camera permission denied | Show manual entry fallback |
| QR contains non-otpauth URI | Reject with "Not a valid TOTP QR code" |
| QR contains HOTP (counter-based) | Reject with "HOTP not supported, only TOTP" |

---

## 9. Security Considerations

### Threat Model

| Threat | Protection |
|--------|-----------|
| Server reads TOTP seeds | AES-256-GCM blob encryption (server cannot decrypt) |
| Local storage theft (browser profile) | Local encrypted storage (AES-256-GCM with storage key) |
| Memory extraction on unlocked device | Same risk as master secret — accepted limitation |
| Compromised master secret | All TOTP seeds (Model A) and derived seeds (Model B) are compromised. Same as passwords. |

### Key Separation

| Purpose | Derivation |
|---------|-----------|
| Password derivation | `HMAC-SHA256(strengthened, site:email:length:counter)` |
| TOTP seed derivation (Model B) | `HMAC-SHA256(strengthened, site:email:keygrain-totp)` |
| Sync encryption | `HMAC-SHA256(strengthened, email:keygrain-encryption)` |
| Auth password | `HMAC-SHA256(strengthened, email:32:keygrain-auth)` |

The `:keygrain-totp` suffix ensures TOTP derivation is domain-separated from all other derivations. No collision is possible.

### Model A: Seed Confidentiality

TOTP seeds in Model A are random secrets equivalent to passwords. They are protected by the same encryption that protects all service data. If blob encryption is compromised, TOTP seeds are exposed — but so is all other service metadata. The security boundary is the master secret + email.

### Model B: Determinism Trade-off

Model B seeds are deterministic. If the master secret is compromised, all Model B TOTP seeds are immediately derivable without needing the encrypted blob. This is the same trade-off as Keygrain passwords — it's the core design philosophy.

### TOTP as Second Factor

Storing TOTP seeds alongside passwords in the same app reduces the independence of the two factors. If Keygrain is compromised, both password and TOTP are exposed. This is an accepted trade-off (same as Bitwarden, 1Password, etc.) — the convenience of integrated TOTP outweighs the theoretical reduction in factor independence for most users.

### Clipboard Security

When a TOTP code is copied to clipboard:
- Clear on next code rotation (i.e., when the period expires), or after 30 seconds — whichever comes first
- On Android: use the clipboard manager's sensitive flag

---

## 10. Test Plan

### RFC 6238 Test Vectors (Appendix B)

Using the test seed from RFC 6238: `12345678901234567890` (ASCII, 20 bytes) for SHA1, `12345678901234567890123456789012` (32 bytes) for SHA256, `1234567890123456789012345678901234567890123456789012345678901234` (64 bytes) for SHA512.

**All vectors use `digits=8` and `period=30`.**

| Time (Unix) | T (hex) | Algorithm | Digits | Expected |
|-------------|---------|-----------|--------|----------|
| 59 | 0000000000000001 | SHA1 | 8 | 94287082 |
| 59 | 0000000000000001 | SHA256 | 8 | 46119246 |
| 59 | 0000000000000001 | SHA512 | 8 | 90693936 |
| 1111111109 | 00000000023523EC | SHA1 | 8 | 07081804 |
| 1111111109 | 00000000023523EC | SHA256 | 8 | 68084774 |
| 1111111109 | 00000000023523EC | SHA512 | 8 | 25091201 |
| 1111111111 | 00000000023523ED | SHA1 | 8 | 14050471 |
| 1111111111 | 00000000023523ED | SHA256 | 8 | 67062674 |
| 1111111111 | 00000000023523ED | SHA512 | 8 | 99943326 |
| 1234567890 | 000000000273EF07 | SHA1 | 8 | 89005924 |
| 1234567890 | 000000000273EF07 | SHA256 | 8 | 91819424 |
| 1234567890 | 000000000273EF07 | SHA512 | 8 | 93441116 |
| 2000000000 | 0000000003F940AA | SHA1 | 8 | 69279037 |
| 2000000000 | 0000000003F940AA | SHA256 | 8 | 90698825 |
| 2000000000 | 0000000003F940AA | SHA512 | 8 | 38618901 |
| 20000000000 | 0000000027BC86AA | SHA1 | 8 | 65353130 |
| 20000000000 | 0000000027BC86AA | SHA256 | 8 | 77737706 |
| 20000000000 | 0000000027BC86AA | SHA512 | 8 | 47863826 |

### Model B Derivation Vectors

| secret (UTF-8) | email | site | expected seed (hex, first 32 bytes) |
|---|---|---|---|
| `my-master-secret` | `test@gmail.com` | `github.com` | *(to be computed from reference implementation)* |
| `my-master-secret` | `test@gmail.com` | `GitHub.com` | *(must equal above — site normalization)* |
| `my-master-secret` | `TEST@Gmail.com` | `github.com` | *(must equal above — email normalization)* |
| `different-secret` | `test@gmail.com` | `github.com` | *(must differ from above)* |

**TODO (pre-finalization):** Concrete hex values MUST be computed from the reference Python implementation and filled in before this design moves from Draft to Accepted. Without concrete values, cross-platform divergence is undetectable. A `totp-vectors.json` file will be committed to the repository root alongside the existing `vectors.json`.

Cross-platform requirement: all implementations must produce identical seeds for the same inputs.

### Model B HMAC Message Strings

For implementor debugging — the exact message bytes fed to HMAC-SHA256:

| # | site (input) | email (input) | Message (UTF-8, after normalization) |
|---|---|---|---|
| 1 | `github.com` | `test@gmail.com` | `github.com:test@gmail.com:keygrain-totp` |
| 2 | `GitHub.com` | `test@gmail.com` | `github.com:test@gmail.com:keygrain-totp` |
| 3 | `github.com` | `TEST@Gmail.com` | `github.com:test@gmail.com:keygrain-totp` |
| 4 | `github.com` | `test@gmail.com` | `github.com:test@gmail.com:keygrain-totp` |

Vectors 1, 2, and 3 produce the same message (and therefore the same seed) due to normalization. Vector 4 also produces the same message but uses a different secret — the different strengthened key produces a different seed despite the identical HMAC message.

### otpauth:// URI Parsing Tests

| Input | Expected |
|-------|----------|
| `otpauth://totp/GitHub:user@ex.com?secret=JBSWY3DPEHPK3PXP&digits=6&period=30` | seed=`48656c6c6f21deadbeef` (hex), digits=6, period=30, algo=SHA1 |
| `otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP` | defaults: digits=6, period=30, algo=SHA1 |
| `otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60` | digits=8, period=60, algo=SHA256 |
| `otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&digits=7` | REJECT (digits must be 6 or 8) |
| `otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP&counter=0` | REJECT (HOTP not supported) |
| `otpauth://totp/Test?secret=!!!INVALID!!!` | REJECT (invalid base32) |
| `JBSWY3DPEHPK3PXP` | Parsed as raw base32, defaults applied |

### Integration Tests

| Test | Assertion |
|------|-----------|
| Add TOTP to service → sync → other device sees it | `totp` field present in decrypted blob on second device |
| Remove TOTP from service → sync | `totp` field absent after sync |
| Model B produces same code on all platforms | Given same secret/email/site/time, all platforms output identical code |
| Service without `totp` field | No TOTP UI shown, no errors |
| Upgrade from pre-TOTP version | Existing services load without error, `totp` is undefined/null |

---

## 11. Migration

### Backward Compatibility

The `totp` field is optional. Existing service entries without it continue to work unchanged. No migration step is required.

### Version Handling

| Client version | Behavior with `totp` field |
|----------------|---------------------------|
| Pre-TOTP client | Ignores unknown `totp` field in JSON (standard JSON parsing). Field is preserved through sync round-trips if the client does not strip unknown fields. |
| TOTP-aware client | Reads and displays TOTP codes |

### Critical Requirement: Field Preservation

Pre-TOTP clients that sync MUST preserve unknown fields in service entries. If a pre-TOTP client strips the `totp` field during sync, TOTP data is lost.

**Current behavior check (JavaScript — `extension/shared/sync.js`):** The sync code builds the push payload as:
```javascript
const contentArray = merged.map(s => ({
  name: s.name, site: s.site, email: s.email,
  length: s.length, symbols: s.symbols, counter: s.counter
}));
```

**Current behavior check (Kotlin — `SyncManager.kt`):** The same explicit enumeration:
```kotlin
contentArray.put(JSONObject().apply {
    put("name", svc.name)
    put("site", svc.site)
    put("email", svc.email)
    put("length", svc.length)
    put("symbols", svc.symbols)
    put("counter", svc.counter)
})
```

**Both platforms explicitly enumerate fields** and would strip `totp`. Both must be fixed before TOTP ships.

**JavaScript fix** — use a spread-and-exclude pattern to preserve all fields except sync metadata:

```javascript
const contentArray = merged.map(({id, updated_at, ...content}) => content);
```

**Kotlin fix** — serialize the full JSONObject and remove only sync metadata:

```kotlin
// Option A: Spread equivalent — copy all fields, remove metadata
val entryJson = JSONObject(svc.toJson()) // assuming toJson() serializes all fields
entryJson.remove("id")
entryJson.remove("updated_at")
contentArray.put(entryJson)

// Option B: Explicit addition of totp (less future-proof)
contentArray.put(JSONObject().apply {
    put("name", svc.name)
    put("site", svc.site)
    put("email", svc.email)
    put("length", svc.length)
    put("symbols", svc.symbols)
    put("counter", svc.counter)
    if (svc.totp != null) put("totp", svc.totp)
})
```

The spread/copy-all approach is more future-proof (automatically preserves any new fields added later).

### Rollback Safety

If a user downgrades to a pre-TOTP client version:
- If the sync code uses explicit field enumeration (current): TOTP data is stripped on next sync. **Data loss.**
- If the sync code uses spread (recommended fix): TOTP data is preserved even by old clients.

**Recommendation:** Ship the spread-based sync fix as a prerequisite before TOTP, so that even old clients preserve unknown fields.

---

## 12. Implementation Sequence

Recommended implementation order:

1. **Sync field preservation fix** — Change sync payload construction to preserve unknown fields. Ship independently.
2. **TOTP core library** — `generateTOTP()`, `parseTOTPInput()`, `deriveTOTPSeed()` with test vectors. Pure functions, no UI.
3. **Storage integration** — Add `totp` field to service entries, wire up save/load.
4. **UI: Display TOTP codes** — Show current code + countdown for services with TOTP configured.
5. **UI: Add TOTP to service** — QR scan (mobile), manual entry (all platforms), Model B toggle.
6. **UI: Export derived seed** — Model B: display base32 seed for user to configure on their server.

---

## Appendix A: Base32 Encoding/Decoding

TOTP seeds are commonly exchanged as base32 (RFC 4648). Implementations must handle:
- Uppercase and lowercase input (case-insensitive decode)
- With or without `=` padding
- Spaces and hyphens as separators (strip before decode)

The alphabet: `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`

---

## Appendix B: Model B Seed Export Format

When a user wants to configure a self-hosted service with a Model B derived seed, Keygrain displays:

1. The base32-encoded seed (for manual entry into the service's TOTP configuration)
2. A QR code containing: `otpauth://totp/Keygrain:{site}?secret={base32_seed}&issuer=Keygrain`

This allows the user to scan the QR code with their service's TOTP setup page (if supported).
