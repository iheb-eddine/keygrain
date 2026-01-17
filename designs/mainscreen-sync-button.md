# Design: Replace Backup/Restore with Single Sync Button

## Overview

Replace the two-step backup/restore menu items in `MainScreen.kt` with a single "Sync" menu item. The new `SyncManager.sync()` method handles the full merge flow (GET→merge→PUT) and retries 409 conflicts internally, making confirmation and conflict dialogs unnecessary.

### What changes
- Two menu items ("Backup to server", "Restore from server") → one ("Sync")
- Confirmation dialog removed (sync merges, doesn't overwrite)
- Conflict dialog removed (SyncManager handles 409 retry internally)
- Email prompt dialog kept (needed for auth key derivation)
- Loading indicator kept
- Snackbar result kept

## Interface Contracts

### Removed from MainScreen.kt
| Item | Reason |
|------|--------|
| `import com.badrani.keygrain.data.RestoreResult` | Dead code — class no longer exists |
| `syncAction: String?` state ("backup" / "restore") | Replaced by `showSyncEmailDialog: Boolean` |
| `showConfirmDialog: String?` state + its AlertDialog | No confirmation needed for merge-based sync |
| `showConflictDialog: Boolean` state + its AlertDialog | 409 handled internally by SyncManager |
| References to `syncManager.backup()` / `syncManager.restore()` | Methods no longer exist |
| `SyncResult.Conflict` handling | Variant no longer exists in sealed class |

### Added/Modified in MainScreen.kt
| Item | Detail |
|------|--------|
| `showSyncEmailDialog: Boolean` state | Replaces `syncAction` |
| "Sync" `DropdownMenuItem` | Single item above the divider |
| Email prompt dialog | Title: "Sync to Server", text: "Email for sync identity:" |
| On confirm | Directly launch coroutine calling `syncManager.sync()` |
| Result `when` branch | `Success` → snackbar, `AuthError` → snackbar, `NetworkError` → snackbar, `ServerError` → snackbar, `IntegrityError` → snackbar |
| After `Success` | `services = serviceManager.getServices()` (sync may merge in remote entries) |

### Added to UserMessages.kt
```kotlin
fun syncSuccess(count: Int) = "Synced — $count services."
const val INTEGRITY_ERROR = "Sync failed due to a data integrity issue. Try again or export your data as a backup."
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Empty email field | Continue button disabled |
| Network timeout | `NetworkError` returned → snackbar, no local data lost |
| Auth failure (wrong secret/email) | `AuthError` → snackbar |
| Integrity error (checksum mismatch, decryption failure) | `IntegrityError` → snackbar with integrity message |
| User dismisses email dialog | No action, state reset |
| Merge yields empty but remote had data | SyncManager returns `IntegrityError("empty push blocked")` → snackbar |
| Multiple rapid taps | `isSyncing` flag + loading dialog blocks re-entry |
| Secret zeroing | `masterSecret.toByteArray()` zeroed in `finally` block |

## Test Plan (Manual)

1. **Happy path:** Add services → Sync → verify snackbar "Synced — N services."
2. **First sync (no remote):** Fresh account → Sync → verify success snackbar
3. **Merge:** Add service on device A, different on device B → Sync both → both have all services
4. **Auth error:** Wrong email → verify AUTH_ERROR snackbar
5. **Network error:** Airplane mode → verify NETWORK_ERROR snackbar
6. **Dialog dismiss:** Open Sync → Cancel → no network call
7. **Loading state:** Slow network → loading indicator visible, blocks interaction
8. **Menu structure:** "Backup to server" and "Restore from server" gone; "Sync" present above divider
9. **File export/import:** Still works unchanged

## Integration

| Component | Impact |
|-----------|--------|
| `SyncManager.kt` | No changes — `sync()` consumed as-is |
| `UserMessages.kt` | Add `syncSuccess(count)` + `INTEGRITY_ERROR` |
| `MainScreen.kt` | Remove dead imports/state/dialogs, add simplified sync flow |
| `RestoreResult` class | Can be deleted from codebase (only referenced in MainScreen.kt) |
| File export/import | Untouched |
