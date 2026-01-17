# Algorithm v2 Specification: Site-Unique Derivation

**Status:** Approved for implementation  
**Breaking change:** Yes (no users — clean break)  
**Prerequisite reading:** `algorithm-v2-brainstorm.md`, `algorithm-v2-validation.md`

---

## 1. New Algorithm Formula

### HMAC Message (v1 → v2)

```
v1: message = lowercase(email) + ":" + str(length) + ":" + salt
v2: message = lowercase(site) + ":" + lowercase(email) + ":" + str(length) + ":" + salt + ":" + str(counter)
```

### Stream Generation (unchanged)

```
key = HMAC-SHA256(effective_secret, message)
stream = key || HMAC-SHA256(key, 0x01) || HMAC-SHA256(key, 0x02) || ...
```

### Password Construction (unchanged)

1. Force one char from each category (upper, lower, digit, symbol)
2. Fill remaining positions from full charset
3. Fisher-Yates shuffle using stream bytes

### Argon2id Strengthening (unchanged)

`strengthen_secret(secret, email)` is NOT affected by v2. Site does NOT enter the Argon2id salt. The strengthening step remains:

```
salt = "keygrain-strengthen:" + lowercase(email)
strengthened = Argon2id(secret, salt, t=3, m=65536, p=1, len=32)
```

Site enters only at the HMAC message level, after strengthening.

### Backup Protocol (unchanged)

The backup derivations (lookup_id, auth_password, encryption_key) use `(secret, email)` only and are unaffected by v2. No changes to the server API or backup/restore flow.

---

## 2. API Changes Per Platform

### Python (`python/keygrain/derive.py`)

**Before:**
```python
def derive_password(
    secret: bytes,
    email: str,
    *,
    length: int = 20,
    symbols: str = DEFAULT_SYMBOLS,
    salt: str = "",
    strengthen: bool = False,
) -> str:
```

**After:**
```python
def derive_password(
    secret: bytes,
    email: str,
    *,
    site: str,
    length: int = 20,
    symbols: str = DEFAULT_SYMBOLS,
    salt: str = "",
    counter: int = 1,
    strengthen: bool = False,
) -> str:
```

Changes:
- Add `site: str` (required, keyword-only, no default)
- Add `counter: int = 1` (keyword-only)
- Update `_stream()` to accept `site` and `counter`, build new message format

### Python CLI (`python/keygrain/cli.py`)

**Add arguments:**
```
--site (required positional or required flag — TBD during implementation)
```

The CLI becomes: `keygrain <email> --site <site> [--length N] [--symbols S] [--salt S] [--counter N]`

Or positional: `keygrain <site> <email> [options]` — decide during implementation based on ergonomics.

### Kotlin (`kotlin/.../data/Keygrain.kt`)

**Before:**
```kotlin
fun derivePassword(secret: ByteArray, email: String, length: Int, symbols: String, salt: String): String
```

**After:**
```kotlin
fun derivePassword(secret: ByteArray, email: String, site: String, length: Int, symbols: String, salt: String, counter: Int = 1): String
```

Changes:
- Add `site: String` parameter
- Add `counter: Int` parameter (default 1)
- Update message construction

### JavaScript Extension (`extension/shared/keygrain.js`)

**Before:**
```javascript
function derivePassword(secret, email, { length, symbols, salt })
```

**After:**
```javascript
function derivePassword(secret, email, { site, length, symbols, salt, counter })
```

Changes:
- Add `site` (required in options object)
- Add `counter` (default 1 in options object)
- Update message construction

### Web Generator (`server/static/generate/index.html`)

Same JS function signature change. The inline script uses the same algorithm.

---

## 3. Data Model Changes

### ServiceEntry (per-service)

| Field | v1 | v2 | In derivation | Notes |
|-------|----|----|---------------|-------|
| `name` | display + identity | display only | NO | Label in UI |
| `site` | — | **NEW** | YES (lowercased) | User-confirmed identifier, immutable after creation |
| `email` | ✓ | ✓ | YES (lowercased) | Login identity |
| `length` | ✓ | ✓ | YES | Default 20, min 8 |
| `symbols` | ✓ | ✓ | NO (affects charset) | Default `!@#$%&*-_=+?` |
| `salt` | per-service | **REMOVED** | — | Moves to global |
| `counter` | — | **NEW** | YES | Default 1, for rotation |

### Settings (global)

| Field | v1 | v2 | Notes |
|-------|----|----|-------|
| `salt` | — | **NEW** | Global salt, default "", applies to all derivations |

### Constraints

- `site`: required, non-empty string, stored as-is but lowercased for derivation
- `counter`: integer ≥ 1
- `site` is immutable after creation (changing it changes the password — user must delete and recreate)

---

## 4. UI Changes

### Android (Kotlin Compose)

**Add Service dialog:**
- Add "Site" text field (required, above email)
- Add "Counter" field (default 1, shown as advanced/expandable)
- Remove per-service "Salt" field
- `name` field becomes optional display label (defaults to site value if empty)

**Edit Service dialog:**
- `site` field shown but disabled/read-only (immutable)
- `counter` field editable (for rotation)

**Settings screen:**
- Add "Global Salt" field with warning: "Changing this rotates ALL passwords"

### Browser Extension (`extension/shared/popup.js`)

**Add Service:**
- "Site" field auto-filled with `window.location.hostname` from active tab
- Field is pre-selected (easy to edit/confirm)
- User must explicitly confirm the value
- "Counter" field (default 1, collapsible/advanced)
- Remove per-service "Salt" field

**Edit Service:**
- `site` shown read-only
- `counter` editable

**Password generation (on existing service):**
- When user selects a service, site is used from stored entry (not re-detected)

### Web Generator (`server/static/generate/index.html`)

- Add "Site" input field (required, between secret and email or above email)
- Add "Counter" input field (default 1)
- "Salt" field remains (it's the global salt — user enters it manually here since there's no persistent settings)

---

## 5. Migration Plan

**Clean break.** No users exist (app pending store submission, extension in testing).

### Actions

1. Delete all existing test vectors in `vectors.json`
2. Regenerate vectors with new formula
3. Update all platform implementations simultaneously
4. Wipe any local development data (Android emulator, extension storage)
5. No version negotiation, no fallback to v1

### Fingerprint Vectors

Fingerprint derivation is independent of the password algorithm (uses a fixed HMAC message `"keygrain-fingerprint"`). Fingerprint vectors remain unchanged.

---

## 6. Test Vectors

### Vector Inputs

All vectors use the new formula: `lowercase(site) + ":" + lowercase(email) + ":" + str(length) + ":" + salt + ":" + str(counter)`

| # | Secret (UTF-8) | Site | Email | Length | Symbols | Salt | Counter | Tests |
|---|---------------|------|-------|--------|---------|------|---------|-------|
| 1 | my-master-secret | github.com | test@gmail.com | 20 | !@#$%&*-_=+? | "" | 1 | Base case |
| 2 | my-master-secret | google.com | test@gmail.com | 20 | !@#$%&*-_=+? | "" | 1 | Different site → different password |
| 3 | my-master-secret | GitHub.com | test@gmail.com | 20 | !@#$%&*-_=+? | "" | 1 | Site case insensitive (= vector 1) |
| 4 | my-master-secret | github.com | TEST@Gmail.com | 20 | !@#$%&*-_=+? | "" | 1 | Email case insensitive (= vector 1) |
| 5 | my-master-secret | github.com | test@gmail.com | 16 | !@#$%&*-_=+? | "" | 1 | Different length |
| 6 | my-master-secret | github.com | test@gmail.com | 20 | !@#$%& | "" | 1 | Restricted symbols |
| 7 | my-master-secret | github.com | test@gmail.com | 20 | !@#$%&*-_=+? | "2024" | 1 | With global salt |
| 8 | my-master-secret | github.com | test@gmail.com | 20 | !@#$%&*-_=+? | "" | 2 | Counter rotation |
| 9 | different-secret | github.com | test@gmail.com | 20 | !@#$%&*-_=+? | "" | 1 | Different secret |
| 10 | my-master-secret | home-wifi | test@gmail.com | 20 | !@#$%&*-_=+? | "" | 1 | Non-domain site |

**Expected outputs:** To be computed by running the updated Python implementation. Each platform must produce identical output for all vectors.

### Verification Properties

- Vectors 1 ≠ 2: site uniqueness
- Vectors 1 = 3: site case insensitivity
- Vectors 1 = 4: email case insensitivity
- Vectors 1 ≠ 5: length changes output
- Vectors 1 ≠ 6: symbols changes output
- Vectors 1 ≠ 7: salt changes output
- Vectors 1 ≠ 8: counter changes output
- Vectors 1 ≠ 9: secret changes output

---

## Files to Change (Implementation Checklist)

| # | File | Change |
|---|------|--------|
| 1 | `python/keygrain/derive.py` | Add `site`, `counter` params; update `_stream()` message |
| 2 | `python/keygrain/cli.py` | Add `--site` argument (required) |
| 3 | `python/tests/` | New test vectors matching section 6 |
| 4 | `vectors.json` | Regenerate with new formula |
| 5 | `SPEC.md` | Update algorithm section with v2 formula |
| 6 | `kotlin/.../data/Keygrain.kt` | Add `site`, `counter` to `derivePassword` |
| 7 | `kotlin/.../data/ServiceManager.kt` | Add `site`, `counter` to `ServiceEntry` |
| 8 | `kotlin/.../ui/screens/MainScreen.kt` | Add site field to add/edit dialogs |
| 9 | `extension/shared/keygrain.js` | Add `site`, `counter` to derivation |
| 10 | `extension/shared/popup.js` | Add site field, auto-suggest from hostname |
| 11 | `server/static/generate/index.html` | Add site field to form |

---

## References

- `designs/algorithm-v2-brainstorm.md` — Option analysis and recommendation
- `designs/algorithm-v2-validation.md` — Adversarial validation and edge cases
