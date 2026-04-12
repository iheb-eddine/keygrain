# Autofill Service Session Fix

## Root Cause

`SecretManager.sessionActive` is a `companion object` boolean (JVM static) set to `true` when the user unlocks in `MainScreen.kt`. The autofill service runs in the **same process** (no `android:process` in manifest), but `sessionActive` is tied to Activity lifecycle:

1. **Activity death:** User unlocks → `sessionActive = true` → user switches apps → Activity destroyed → `DisposableEffect.onDispose` fires → `sessionActive = false` → autofill triggers → returns null.
2. **Process cold-start:** System kills app process → restarts it for autofill → `sessionActive` initializes to `false` → returns null.

Both scenarios cause autofill to never work unless the Activity is alive and unlocked.

## Frozen Requirements

1. Autofill MUST work whenever the master secret exists in EncryptedSharedPreferences, regardless of Activity lifecycle state.
2. Autofill MUST NOT crash if EncryptedSharedPreferences or Android Keystore is unavailable (direct boot, corrupted keystore).
3. Autofill MUST return null (no-op) if no master secret is stored.
4. Dead code (`sessionActive` field and all assignments) MUST be removed.

## Invariants

1. **Secret availability = autofill availability.** The gate for autofill is `secretManager.hasSecret()`, not any in-memory flag.
2. **No unhandled exceptions in onFillRequest.** Any failure in SecretManager instantiation or secret retrieval results in `callback.onSuccess(null)`, never a crash.
3. **EncryptedSharedPreferences is the single source of truth** for whether the app is "set up." It is file-backed, accessible from any context in the same process, and survives Activity/process restarts.
4. **Security posture unchanged.** The secret is AES-256-GCM encrypted by Android Keystore. Having autofill work whenever the secret exists is acceptable — the secret is already hardware-protected.

## Scope Boundary

### In Scope

- Replace `sessionActive` check in `KeygrainAutofillService.onFillRequest` with `hasSecret()`
- Add try-catch around `SecretManager` instantiation and `getSecret()` in the autofill service
- Remove `sessionActive` companion object field from `SecretManager.kt`
- Remove all `sessionActive` assignments in `MainScreen.kt` (lines 91, 103, 121, 384)

### Out of Scope

- Subdomain matching (e.g., `accounts.google.com` vs `google.com`) — separate feature
- Numeric PIN field detection (`TYPE_NUMBER_VARIATION_PASSWORD`) — minor gap, separate fix
- Persisted lock state for autofill gating — not needed given Keystore protection
- Changes to the lock/unlock flow logic

## Implementation Units

### Unit 1: Fix autofill gate + add exception handling

**File:** `KeygrainAutofillService.kt`

Changes:
- Remove `if (!SecretManager.sessionActive)` check (line 29-32)
- Wrap `SecretManager(applicationContext)` and `secretManager.getSecret()` in try-catch
- On exception: `callback.onSuccess(null); return`

### Unit 2: Remove dead `sessionActive` code

**Files:** `SecretManager.kt`, `MainScreen.kt`

Changes:
- Remove `companion object { @Volatile var sessionActive: Boolean = false }` from `SecretManager.kt`
- Remove `SecretManager.sessionActive = true` (MainScreen.kt lines 91, 103)
- Remove `SecretManager.sessionActive = false` (MainScreen.kt lines 121, 384)

## Test Plan

### Manual Tests

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Autofill after Activity death | Unlock app → switch to browser → force-stop Activity via dev options → trigger autofill on a saved site | Password fills correctly |
| 2 | Autofill on cold start | Kill app process → open browser → navigate to saved site → trigger autofill | Password fills correctly |
| 3 | Autofill with no secret | Fresh install (no secret stored) → open browser → trigger autofill | No autofill suggestions shown |
| 4 | Autofill after lock (biometric device) | Unlock → lock → switch to browser → trigger autofill | Password fills (secret persists) |
| 5 | Autofill after lock (non-biometric device) | Unlock → lock → switch to browser → trigger autofill | No autofill (secret cleared on lock) |
| 6 | Keystore unavailable | Simulate direct boot / locked keystore → trigger autofill | No crash, no suggestions |
| 7 | Domain matching | Save service as `example.com` → visit `example.com` in Chrome → trigger autofill | Password fills |
| 8 | Untrusted browser | Trigger autofill from non-whitelisted app with webDomain set | No autofill suggestions |

### Automated Tests (if test infra exists)

- Unit test: `SecretManager.hasSecret()` returns `true` after `saveSecret()`, `false` after `clearSecret()`
- Unit test: Verify `normalizeSite` produces matching results for autofill domain vs stored service site

## Related Bugs Found

### Bug A (CRITICAL): No exception handling in autofill service

**File:** `KeygrainAutofillService.kt` — entire `onFillRequest` method

**Evidence:** Zero try-catch blocks. `SecretManager(applicationContext)` calls `MasterKey.Builder(...).build()` and `EncryptedSharedPreferences.create(...)`, both of which throw `GeneralSecurityException` if the Android Keystore is unavailable (direct boot mode, corrupted keystore, device just booted before user unlocks device-level lock).

**Impact:** Unhandled exception in `onFillRequest` crashes the autofill service. Android may disable the autofill provider after repeated crashes.

**Fix:** Wrap in try-catch, return `callback.onSuccess(null)` on failure.

### Bug B (MINOR): Numeric PIN password fields not detected

**File:** `KeygrainAutofillService.kt:141`

**Evidence:** The `findPasswordNodes` check uses `TYPE_TEXT_VARIATION_PASSWORD` (0x80) in a bitwise AND. This catches text password variations (PASSWORD, VISIBLE_PASSWORD, WEB_PASSWORD — all have bit 7 set) but misses `TYPE_NUMBER_VARIATION_PASSWORD` (0x10, bit 4 only). Numeric PIN fields without autofill hints won't be detected.

**Impact:** Low — PIN fields on modern apps/sites typically set autofill hints, which are checked first.

### Bug C (USABILITY, OUT OF SCOPE): Subdomain matching fails

**File:** `KeygrainAutofillService.kt:65-68`, `ServiceManager.kt:39-45`

**Evidence:** `normalizeSite("accounts.google.com")` → `accounts.google.com`, `normalizeSite("google.com")` → `google.com`. These don't match. User saves service as `google.com` but visits `accounts.google.com` — no autofill.

**Impact:** Common sites like Google, Microsoft, Apple use subdomains for login. Autofill won't trigger unless user saves the exact subdomain.

### Bug D (DEAD CODE): `sessionActive` becomes unused

**File:** `SecretManager.kt:9-11`, `MainScreen.kt:91,103,121,384`

**Evidence:** After replacing the autofill check, `sessionActive` has zero consumers. Five assignment sites and the field declaration are dead code.

**Impact:** Code hygiene. No runtime impact but confusing for future readers.
