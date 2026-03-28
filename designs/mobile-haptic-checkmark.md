# Haptic Feedback + Checkmark Icon Swap on Copy

## Problem

The current copy feedback uses `Toast.makeText(...)` which is slow (appears after a delay), visually disconnected from the button, and provides no tactile confirmation. Users have no immediate certainty that the copy succeeded.

## New Behavior

On copy tap: haptic vibration + swap copy icon → checkmark for 1.5s. No Toast.

## Compose APIs

### Haptic Feedback

```kotlin
val haptic = LocalHapticFeedback.current
// In onClick:
haptic.performHapticFeedback(HapticFeedbackType.LongPress)
```

`HapticFeedbackType.LongPress` is the standard "confirm" haptic on Android. No `VIBRATE` permission needed — it uses the view's haptic feedback mechanism.

**Import:** `androidx.compose.ui.hapticfeedback.LocalHapticFeedback` and `HapticFeedbackType` (from same package).

### Icon Swap

```kotlin
var passwordCopied by remember { mutableStateOf(false) }

LaunchedEffect(passwordCopied) {
    if (passwordCopied) {
        delay(1500)
        passwordCopied = false
    }
}
```

Icon expression:

```kotlin
Icon(
    if (passwordCopied) Icons.Default.Check else Icons.Default.ContentCopy,
    contentDescription = if (passwordCopied) "Copied" else "Copy"
)
```

## State Placement

Inside `ServiceCard`, alongside the existing `visible` state (after line 834):

```kotlin
var visible by remember { mutableStateOf(false) }
var passwordCopied by remember { mutableStateOf(false) }
var totpCopied by remember { mutableStateOf(false) }
var sshCopied by remember { mutableStateOf(false) }
```

Each gets its own `LaunchedEffect`:

```kotlin
LaunchedEffect(passwordCopied) {
    if (passwordCopied) { delay(1500); passwordCopied = false }
}
LaunchedEffect(totpCopied) {
    if (totpCopied) { delay(1500); totpCopied = false }
}
LaunchedEffect(sshCopied) {
    if (sshCopied) { delay(1500); sshCopied = false }
}
```

## Rapid-Tap Guard

When `showCopied` is already `true`, the IconButton onClick is a no-op (early return before `copyAndClear`):

```kotlin
IconButton(onClick = {
    if (passwordCopied) return@IconButton
    copyAndClear("password", password)
    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
    passwordCopied = true
    onCopy()
}) {
    Icon(
        if (passwordCopied) Icons.Default.Check else Icons.Default.ContentCopy,
        contentDescription = if (passwordCopied) "Copied" else "Copy"
    )
}
```

Rationale: the content is already on the clipboard from the first tap. Re-triggering within 1.5s adds no value and would cause the `LaunchedEffect` key to not re-fire (boolean already `true`).

## Icon Choice

`Icons.Default.Check` — the standard single checkmark (✓). Semantically clear in code and visually distinct from the copy icon.

## Toast Removal

Remove all three `Toast.makeText(...)` calls:
- Line ~912: `Toast.makeText(context, "Copied", Toast.LENGTH_SHORT).show()`
- Line ~939: `Toast.makeText(context, "TOTP copied", Toast.LENGTH_SHORT).show()`
- SSH copy: similar Toast

The haptic + visual icon swap provides immediate, co-located feedback that is superior to Toast in every dimension (speed, locality, tactile).

## Accessibility

- `contentDescription` changes dynamically with icon state:
  - Password: `"Copied"` / `"Copy"`
  - TOTP: `"Copied"` / `"Copy TOTP"`
  - SSH: `"Copied"` / `"Copy SSH public key"`
- TalkBack will announce the content description change when the icon swaps, providing auditory confirmation for screen reader users.
- Haptic feedback works independently of TalkBack.

## Affected Lines (MainScreen.kt)

| Location | Change |
|----------|--------|
| After line 834 | Add `passwordCopied`, `totpCopied`, `sshCopied` state + LaunchedEffects |
| Line ~821 | Add `val haptic = LocalHapticFeedback.current` |
| Lines 909-915 | Password copy button: guard + haptic + state set + remove Toast |
| Lines 936-942 | TOTP copy button: same pattern |
| Lines 980-986 | SSH copy button: same pattern |

## New Imports

```kotlin
import androidx.compose.ui.hapticfeedback.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
```
