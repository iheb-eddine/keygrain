# Site Rules DB — Design Document

## 1. Overview

The Site Rules DB is a signed JSON file mapping common websites to their password generation constraints (max length, min length, allowed symbols). It enables keygrain clients to auto-configure password parameters when a user adds a service, reducing friction and preventing generation of passwords that sites will reject.

**Key properties:**
- Static file at `server/static/rules.json` — no server code changes needed
- Ed25519 signed to prevent weakening attacks via tampering
- Consumed by browser extension and mobile app
- Rules are pre-fill suggestions, never hard constraints — user override always wins
- Rules only accommodate site restrictions (narrowing from defaults), never expand

## 2. Security Model

### Threat Model

The primary threat: an attacker who can modify `rules.json` (MITM, compromised CDN, malicious extension update, supply chain attack) injects rules that weaken generated passwords — e.g., `{"domain":"bank.com","symbols":"a","maxLength":8}` would produce trivially guessable passwords.

### Mitigations

#### Ed25519 Signature Verification

The rules file is signed offline with a project Ed25519 private key. The corresponding public key is bundled in all clients (extension source, APK assets). Clients MUST verify the signature before applying any rules. If verification fails, the client falls back to defaults (no rules applied) and logs a warning.

Signature covers the `rules` array and `version` field (canonical JSON serialization, sorted keys, no whitespace).

#### Restrict-Only Invariant

Rules exist solely to accommodate sites that RESTRICT password requirements below keygrain defaults. The invariant:

- `maxLength` in a rule MUST be ≤ keygrain default length (20) — if a site allows longer, no rule is needed
- `symbols` in a rule MUST be ⊆ `DEFAULT_SYMBOLS` (`!@#$%&*-_=+?`) — rules only restrict the charset
- `minLength` MUST be ≥ 8 (algorithm minimum)

A validation script enforces these constraints before signing.

#### Minimum Entropy Floor

Even legitimate rules reduce entropy. The safety net: reject any rule where the resulting password would have < 40 bits of entropy.

**Formula:** `entropy = length × log2(charset_size)` where `charset_size = 23 + 23 + 8 + len(symbols)` (keygrain excludes ambiguous characters: I, O, l, o, 0, 1).

**Calibration:** The most restrictive real-world sites (e.g., some banks) allow 8 characters with limited symbols. With `maxLength:8` and `symbols:"-_"` → charset = 56 → entropy = 8 × 5.81 ≈ 46.4 bits (passes). Default (length:20, 12 symbols) → charset = 66 → entropy = 120.4 bits. Floor of 40 bits accommodates all legitimate sites while rejecting obviously malicious rules (e.g., `maxLength:4` → charset = 54 + symbols → ~23 bits at best).

#### User Override Always Wins

Rules pre-fill the length and symbols fields in the add-service dialog. The user can always edit these values. If a user sets length=32 for a site where the rule says maxLength=16, the user's choice is stored and used. Rules never constrain — they only suggest.

## 3. JSON Schema

### Envelope

```json
{
  "version": 1,
  "signature": "<base64-encoded Ed25519 signature over canonical payload>",
  "rules": [...]
}
```

- `version` — integer, incremented on every change. Clients compare to cached version.
- `signature` — Ed25519 signature of the canonical JSON: `{"rules":[...],"version":N}` (sorted keys, no whitespace).
- `rules` — array of rule objects.

### Rule Object

```json
{
  "domain": "chase.com",
  "maxLength": 16,
  "minLength": 8,
  "symbols": "!@#$%&*",
  "notes": "Chase limits passwords to 16 chars, restricted symbol set"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | string | yes | eTLD+1 (e.g., `google.com`) or exact subdomain with `exact:true` |
| `maxLength` | integer | no | Maximum password length the site accepts. Must be ≤ 20. |
| `minLength` | integer | no | Minimum password length the site requires. Must be ≥ 8. |
| `symbols` | string | no | Allowed symbol characters (subset of `!@#$%&*-_=+?`). |
| `exact` | boolean | no | If true, match only this exact domain, not all subdomains. Default: false. |
| `notes` | string | no | Human-readable explanation of the constraint. |

### Domain Matching

Matching uses eTLD+1 (effective top-level domain + 1):
- Rule `google.com` matches `accounts.google.com`, `mail.google.com`, `google.com`
- Rule `evil-google.com` does NOT match `google.com`
- Rule with `"exact": true` for `login.microsoftonline.com` matches only that exact host

Extension uses the active tab URL for matching. Mobile app matches against the service name (normalized to domain form).

### Examples

```json
{
  "version": 1,
  "signature": "base64...",
  "rules": [
    {
      "domain": "chase.com",
      "maxLength": 16,
      "minLength": 8,
      "symbols": "!@#$%&*",
      "notes": "Chase: 8-16 chars, limited symbols"
    },
    {
      "domain": "americanexpress.com",
      "maxLength": 20,
      "minLength": 8,
      "symbols": "!@#$%&*",
      "notes": "Amex: no hyphens, underscores, or special chars beyond !@#$%&*"
    },
    {
      "domain": "paypal.com",
      "maxLength": 20,
      "minLength": 8,
      "symbols": "!@#$%&*-_",
      "notes": "PayPal: no =+? in passwords"
    },
    {
      "domain": "wellsfargo.com",
      "maxLength": 14,
      "minLength": 8,
      "symbols": "!@#$%&*",
      "notes": "Wells Fargo: 8-14 chars, restricted symbols"
    }
  ]
}
```

## 4. Server Integration

### File Location

`server/static/rules.json` — served automatically by the existing `http.FileServer(http.Dir("static"))` handler in `main.go`. Accessible at `GET /rules.json`.

### No Code Changes Required

The Go server already serves all files under `static/`. Content-Type is auto-detected as `application/json`. The `http.FileServer` sets `Last-Modified` from the file's mtime, enabling conditional requests.

### CORS

If the extension fetches from the keygrain server (cross-origin from extension context), the server may need a CORS header. However, browser extensions making requests to known hosts typically bypass CORS. Document this as a potential issue to verify during implementation.

## 5. Client Integration — Extension

### Fetch Flow

1. On first unlock (master secret entered), check `chrome.storage.local` for cached rules
2. If no cache or cache expired (TTL exceeded), fetch `/rules.json` from server
3. Verify Ed25519 signature using bundled public key
4. If valid, store in `chrome.storage.local` with timestamp
5. If invalid or fetch fails, use cached rules (if any) or operate without rules

### Cache Storage

```javascript
// Stored in chrome.storage.local
{
  "siteRules": {
    "version": 1,
    "rules": [...],
    "fetchedAt": 1715150000000  // Date.now() at fetch time
  }
}
```

### Add-Service Auto-Fill

When the user opens the add-service dialog:

1. Extract domain from active tab URL (eTLD+1)
2. Look up domain in cached rules
3. If match found:
   - Pre-fill `length` field with rule's `maxLength` (or default 20 if not specified)
   - Pre-fill `symbols` field with rule's `symbols` (or default if not specified)
   - Show indicator: "✓ Optimized for [domain]"
4. User can edit any pre-filled value (override)

### Signature Verification

Use the Web Crypto API (`crypto.subtle.verify` with Ed25519) or a bundled lightweight library (e.g., `@noble/ed25519`). The public key is embedded in the extension source code.

## 6. Client Integration — Mobile App

### Bundled Baseline

`rules.json` is included in APK assets (`app/src/main/assets/rules.json`). This provides offline-first behavior — rules are available immediately without network.

### Update on Sync

When the app performs a backup sync with the server, it also checks for updated rules:

1. Fetch `/rules.json` with `If-Modified-Since` header (last fetch time)
2. If 304 Not Modified, keep current rules
3. If 200, verify signature, compare version, update local copy if newer
4. If verification fails, keep existing bundled/cached rules

### AddServiceDialog Integration

In `MainScreen.kt`'s `AddServiceDialog`:

1. When user types a service name, normalize to domain form
2. Look up in rules (eTLD+1 match)
3. If match found:
   - Set `length` state to rule's `maxLength`
   - Set `symbols` state to rule's `symbols`
   - Show "✓ Optimized for [domain]" text below the service name field
4. User can still edit length/symbols (override)

### Signature Verification

Use Java's `java.security.Signature` with Ed25519 (available in API 33+) or Bouncy Castle for older API levels. Public key bundled in app resources.

## 7. Cache Strategy & Versioning

### Version Field

The `version` integer increments on every rules update. Clients compare their cached version to the fetched version to determine if an update is needed.

### TTL-Based Refresh

| Client | TTL | Trigger |
|--------|-----|---------|
| Extension | 24 hours | On unlock, if `Date.now() - fetchedAt > 86400000` |
| Mobile | On sync | Each backup sync also refreshes rules |

### Conditional Fetch

Clients send `If-Modified-Since` with the last fetch timestamp. Server returns 304 if unchanged, saving bandwidth.

### Fallback Behavior

| Scenario | Behavior |
|----------|----------|
| Fetch fails (network error) | Use cached rules |
| Signature verification fails | Discard fetched rules, use cached/bundled, log warning |
| No cache, no network | Operate without rules (use keygrain defaults) |
| Cached rules, newer version available | Update cache |

### No Rules = No Problem

Rules are purely additive UX. If rules are unavailable, the app works exactly as it does today — user manually configures length and symbols.

## 8. Maintenance & Update Process

### Workflow

1. Edit `server/static/rules.json` — add/modify/remove rules
2. Run validation script: schema check, restrict-only invariant, entropy floor, no duplicate domains
3. Bump `version` field
4. Sign with Ed25519 private key (offline, key stored securely — NOT in repo)
5. Deploy (copy to server, or git push triggers CI deploy)

### Validation Script

A CLI tool (can be a simple Python or shell script) that:
- Validates JSON schema
- Checks all `symbols` values are non-empty subsets of `DEFAULT_SYMBOLS`
- Checks all `maxLength` values are ≤ 20
- Checks all `minLength` values are ≥ 8
- Computes entropy for each rule and rejects if < 40 bits
- Checks no duplicate domains
- Signs the payload and embeds the signature

### Signing Key Management

- Private key: stored offline or in CI secrets (never in repo)
- Public key: bundled in extension source and APK assets
- Key rotation: new public key shipped in client update, old key accepted for grace period

## 9. Test Plan

### Schema Validation Tests

- Valid rules.json passes validation
- Missing required field (`domain`) → rejected
- `maxLength` > 20 → rejected
- `minLength` < 8 → rejected
- `symbols` containing chars not in DEFAULT_SYMBOLS → rejected
- Duplicate domains → rejected
- Entropy below floor → rejected

### Signature Verification Tests

- Valid signature → rules applied
- Tampered rules (modified after signing) → rejected, fallback to defaults
- Missing signature field → rejected
- Wrong public key → rejected

### Domain Matching Tests

- `google.com` rule matches `accounts.google.com` → yes
- `google.com` rule matches `evil-google.com` → no
- `exact:true` rule for `login.microsoft.com` matches `microsoft.com` → no
- Service name "Google" normalized to `google.com` → matches

### Auto-Fill Behavior Tests (Extension)

- Add service on `chase.com` → length pre-filled to 16, symbols to `!@#$%&*`
- Indicator shows "✓ Optimized for chase.com"
- User edits length to 12 → user value stored (override)
- No matching rule → defaults used, no indicator shown

### Auto-Fill Behavior Tests (Mobile)

- Type "Chase" in service name → matches `chase.com` rule
- Length and symbols pre-filled from rule
- Indicator shown
- User override respected

### Cache Tests (Extension)

- First unlock with no cache → fetches from server
- Second unlock within 24h → uses cache, no fetch
- After 24h → re-fetches
- Fetch fails → uses stale cache
- Version unchanged → no update applied

### Integration Tests

- Deploy new rules.json with bumped version → clients pick up on next refresh
- Rollback (lower version) → clients keep higher-version cache
