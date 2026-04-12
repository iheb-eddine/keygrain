# Design: Build Fix + Autofill Prompt

## Issue 1: Build Fix — LocalHapticFeedback Import

### Problem

CI fails with `Unresolved reference: LocalHapticFeedback` at `MainScreen.kt:7`.

The project uses Compose BOM `2024.02.00` (resolves to Compose UI ~1.6.x). In this version, `LocalHapticFeedback` lives in `androidx.compose.ui.platform`, not `androidx.compose.ui.hapticfeedback`.

### Fix

**File:** `kotlin/app/src/main/java/com/badrani/keygrain/ui/screens/MainScreen.kt`

**Line 7 — change:**
```kotlin
// Before:
import androidx.compose.ui.hapticfeedback.LocalHapticFeedback
// After:
import androidx.compose.ui.platform.LocalHapticFeedback
```

**Line 8 — no change needed:**
```kotlin
import androidx.compose.ui.hapticfeedback.HapticFeedbackType  // correct as-is
```

**Usage at line 879** (`val haptic = LocalHapticFeedback.current`) — unchanged.

---

## Issue 2: Autofill Enablement Prompt

### Problem

`KeygrainAutofillService` exists and works, but users are never prompted to enable it. They must manually navigate to Settings → Autofill → select Keygrain.

### Design

#### Location

Inside `ServiceListScreen` composable, add a `LaunchedEffect(Unit)` that runs the check once when the screen first composes (i.e., after unlock). This is where the user lands post-unlock and where existing auto-sync logic lives.

#### Logic

```
1. val autofillManager = context.getSystemService(AutofillManager::class.java)
2. If autofillManager is null → skip silently (some AOSP builds lack autofill framework)
3. If autofillManager.hasEnabledAutofillServices() → skip (already enabled)
4. Read SharedPreferences "keygrain_settings" key "autofill_prompt_dismissed"
5. If true → skip (user already dismissed)
6. Show dialog
```

#### Dialog

- **Title:** "Enable Autofill?"
- **Body:** "Keygrain can automatically fill passwords in other apps. Would you like to enable it?"
- **"Open Settings" button:** Launches intent:
  ```kotlin
  Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
      data = Uri.parse("package:com.badrani.keygrain")
  }
  ```
  Then sets `autofill_prompt_dismissed = true`.
- **"Not now" button:** Sets `autofill_prompt_dismissed = true`, dismisses dialog.

#### SharedPreferences

Uses `"keygrain_settings"` (already used in MainScreen for `onboarding_completed`). Key: `"autofill_prompt_dismissed"` (Boolean, default false).

Does NOT use `"keygrain_autofill"` prefs — those belong to `KeygrainAutofillService` for trusted-browser config.

#### API Level

`AutofillManager` requires API 26. Since `minSdk = 26`, no runtime version check is needed. This is noted explicitly to prevent future unnecessary guards.

#### Null Safety

`getSystemService(AutofillManager::class.java)` can return null on devices without the autofill framework (rare AOSP builds). If null, skip the prompt silently — no crash, no log.

---

## Frozen Requirements

1. **FR-1:** Line 7 of MainScreen.kt MUST use `androidx.compose.ui.platform.LocalHapticFeedback`.
2. **FR-2:** Line 8 of MainScreen.kt MUST remain `androidx.compose.ui.hapticfeedback.HapticFeedbackType`.
3. **FR-3:** After first unlock, if Keygrain is not the active autofill provider, show a dialog prompting the user to enable it.
4. **FR-4:** The prompt MUST only show once per install (persisted via SharedPreferences).
5. **FR-5:** The prompt MUST be dismissible with a "Not now" option.
6. **FR-6:** "Open Settings" MUST launch `ACTION_REQUEST_SET_AUTOFILL_SERVICE` with Keygrain's package URI.

## Invariants

1. **INV-1:** The build compiles without errors after the import fix.
2. **INV-2:** Haptic feedback behavior is unchanged (same API, different package path).
3. **INV-3:** The autofill prompt never shows if Keygrain is already the active provider.
4. **INV-4:** The autofill prompt never shows more than once regardless of outcome.
5. **INV-5:** A null `AutofillManager` never causes a crash.
6. **INV-6:** The `keygrain_autofill` SharedPreferences file is not modified by the prompt feature.

## Scope Boundary

### In Scope
- Import path correction in MainScreen.kt
- One-time autofill prompt dialog in ServiceListScreen
- SharedPreferences flag in `keygrain_settings`

### Out of Scope
- Changing the autofill service implementation itself
- Re-prompting after OS updates or autofill provider changes
- Any UI for managing autofill settings beyond the one-time prompt
- Compose BOM version upgrade
- Any other import fixes

## Test Plan

### Issue 1: Build Fix

| # | Test | Method | Pass Criteria |
|---|------|--------|---------------|
| T1 | CI build passes | `./gradlew assembleDebug` | Zero compilation errors |
| T2 | Haptic feedback works | Manual: long-press a password entry | Device vibrates on copy |

### Issue 2: Autofill Prompt

| # | Test | Method | Pass Criteria |
|---|------|--------|---------------|
| T3 | Prompt shows on first unlock (autofill not enabled) | Fresh install, unlock vault | Dialog appears |
| T4 | Prompt does NOT show if already enabled | Enable Keygrain autofill in settings first, then unlock | No dialog |
| T5 | "Not now" dismisses and never shows again | Tap "Not now", lock/unlock again | No dialog on second unlock |
| T6 | "Open Settings" opens autofill settings | Tap "Open Settings" | System autofill picker opens with Keygrain pre-selected |
| T7 | Prompt does NOT show after "Open Settings" | Complete T6, lock/unlock | No dialog |
| T8 | Null AutofillManager | Emulator without autofill framework (or mock) | No crash, no dialog |
| T9 | SharedPreferences isolation | After prompt dismissed, check `keygrain_autofill` prefs | File unchanged |
