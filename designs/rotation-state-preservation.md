# Design: Screen Rotation State Preservation

## Problem

When the user rotates their phone, Android recreates the activity. All `remember {}` state in `MainScreen.kt` is lost:

- `unlocked` resets to `false`
- `masterSecret` resets to `""`
- `isDemoMode` resets to `false`

Result: the user is kicked back to the unlock screen on every rotation.

## Root Cause

`MainScreen` (lines 60–75) holds all navigation-critical state in Compose `remember {}` blocks. These are scoped to the composition — when the activity is recreated, the composition is destroyed and rebuilt from scratch.

## Options Evaluated

### Option A: `android:configChanges` — RECOMMENDED ✅

Add `android:configChanges="orientation|screenSize|screenLayout"` to the activity declaration in `AndroidManifest.xml`.

**How it works:** Tells Android to NOT recreate the activity for the listed configuration changes. The activity receives an `onConfigurationChanged` callback instead. The Compose tree survives intact — all `remember {}` state is preserved.

**Scope of suppression:** Only the explicitly listed configs are suppressed. Other config changes (locale, dark mode/`uiMode`, font scale) still trigger normal activity recreation. This is desirable — rotation is the only config change that commonly occurs during a session.

**Tradeoff:** If orientation-specific resource qualifiers (e.g., separate landscape XML layouts) were needed, they would not auto-apply. This is irrelevant for this app — Compose handles layout adaptation via recomposition and `LocalConfiguration`.

**Industry precedent:** Bitwarden, 1Password, and KeePassDX all use this approach for the same reason — preventing session loss on rotation in security-sensitive apps.

### Option B: ViewModel — REJECTED

Move state to a ViewModel that survives configuration changes.

**Why rejected:**
- Overkill: ~200+ lines of refactoring to solve a problem fixed by one manifest attribute
- Security concern: `masterSecret` in a ViewModel persists across config changes by design, meaning the secret lives in memory longer than strictly necessary even after a lock action (until ViewModel is cleared)
- Introduces architectural complexity with no proportional benefit

### Option C: `rememberSaveable` — REJECTED

Replace `remember` with `rememberSaveable` for key state variables.

**Why rejected:**
- `masterSecret` would be serialized to a `Bundle` → written to disk on process death → **security violation** (secret persisted in plaintext to the filesystem)
- Only safe for non-sensitive state, but the critical state causing the bug IS the sensitive state
- Partial fix at best

## Proposed Change

**File:** `kotlin/app/src/main/AndroidManifest.xml`

**Before:**
```xml
<activity
    android:name=".MainActivity"
    android:exported="true"
    android:windowSoftInputMode="adjustResize">
```

**After:**
```xml
<activity
    android:name=".MainActivity"
    android:exported="true"
    android:configChanges="orientation|screenSize|screenLayout"
    android:windowSoftInputMode="adjustResize">
```

## Testing

1. Open app → unlock → rotate device → verify app remains on service list screen
2. Open app → unlock → change system dark mode → verify activity recreates (expected — `uiMode` not suppressed)
3. Open app → unlock → change system locale → verify activity recreates (expected — `locale` not suppressed)
4. Open app → go through onboarding → rotate mid-flow → verify onboarding state preserved

## Risk Assessment

- **Risk level:** Minimal. This is a declarative manifest attribute with well-understood behavior.
- **Blast radius:** Only affects rotation/resize behavior. All other lifecycle events (process death, back press, finish) are unaffected.
- **Reversibility:** Remove the attribute to revert.
