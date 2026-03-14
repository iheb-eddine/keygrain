# Reset Keygrain (Secret + Email Reset)

## Motivation

Once a user unlocks with a secret+email, there is no UI to clear them and start fresh. The user is locked into that identity. This feature adds a destructive reset that wipes all local data and returns to the initial setup screen.

## UX Flow

1. User opens Settings dialog (gear icon on main screen)
2. At the bottom of settings, below a `<hr>` separator: a red "Reset Keygrain" button
3. Clicking it opens a confirmation dialog:
   - Red warning text: "This will permanently delete all local data including your services, PIN, and sync state. This cannot be undone."
   - Text input with placeholder "Type RESET to confirm"
   - "Cancel" button and red "Confirm Reset" button (disabled until input === "RESET")
4. On confirm: full local wipe, return to lock screen

## What Gets Cleared

`chrome.storage.local.clear()` — wipes everything in one call:
- `services` (encrypted service list)
- `pinData`, `pinFailCount`
- `lastEmail`
- `settings`
- `siteRules`, `breachFeed`, `dismissedBreaches`
- `lastSyncTime`, `lastSyncError`
- `migrationChecklist`
- `onboardingDone`, `v2_migrated`

Plus in-memory state:
- `clearSecret()` + `clearEmail()` (background script memory)
- `currentSecret = null`, `currentEmail = null`
- `services = []`, `wallets = []`, `walletAuditLog = []`

After reset, `onboardingDone` is cleared so the onboarding overlay will show again on next open — this is correct behavior for a fresh start.

## Visual Design

- **Reset button:** Red background (`#dc3545`), white text, full-width, placed after `<hr>` at bottom of settings panel
- **Confirmation dialog:** Standard dialog with red-tinted warning, type-to-confirm input, disabled confirm button until "RESET" is typed exactly

## Implementation Notes

Two units when implementing:

**1. HTML + CSS:**
- Add `<hr>` and reset button to `#settings-panel` in `popup.html`
- Add reset confirmation dialog markup (similar to delete-dialog pattern)
- Add `.btn-danger` style in `popup.css`

**2. JS:**
- DOM refs for reset button, confirmation dialog, confirm input, confirm button
- Reset button click → open confirmation dialog
- Input listener: enable confirm button only when value === "RESET"
- Confirm click handler:
  - Stop timers: `stopAutolockWarning()`, `stopTOTPInterval()`, clear `syncDebounceTimer`, `syncIndicatorInterval`
  - `await clearSecret()`, `await clearEmail()`
  - `await chrome.storage.local.clear()`
  - `clearStrengthenCache()` (keygrain.js Argon2 cache)
  - Zero in-memory state: `currentSecret`, `currentEmail`, `services`, `wallets`, `walletAuditLog`
  - Close dialogs, call `showLockScreen()`

## Scope Exclusions

- No server-side data clearing (that's a separate concern)
- No data export before reset (just warn — the export button is already available in the menu)
- No selective reset (e.g., keep settings but clear services) — full wipe is simpler and safer
