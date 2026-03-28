# Mobile: Sync Status Subtitle in TopAppBar

## Summary

Show sync status as a subtitle below "Keygrain" in the ServiceListScreen TopAppBar.

## Current State

- TopAppBar shows `Text("Keygrain")` as title
- `isSyncing: Boolean` and `lastSyncTime: Long` state already exist
- `formatRelativeTime()` helper already exists at line 1375
- "Last synced" text was shown below the search bar — now moved to TopAppBar

## Changes (MainScreen.kt)

### 1. Added `syncFailed` state variable

Tracks whether the last auto-sync attempt failed.

### 2. Updated `performAutoSync`

- On success: `syncFailed = false`
- On failure: `syncFailed = true`

### 3. TopAppBar title → Column with subtitle

Subtitle logic (all in `onSurfaceVariant` color, `bodySmall` typography):
- `isDemoMode || email.isBlank()` → no subtitle (sync disabled)
- `isSyncing` → "Syncing…"
- `lastSyncTime > 0L` → "Synced Xm ago" (even after transient failures)
- `syncFailed && lastSyncTime == 0L` → "Not synced"
- else → no subtitle

### 4. Removed old "Last synced" text below search bar

Avoids duplication now that the info is in the TopAppBar.

## Design Decisions

- No error/red color — subtitle is always muted to avoid alarming users about transient network issues
- After a failure, last successful sync time is still shown (more useful than "Sync failed")
- "Not synced" only appears if sync has never succeeded AND a failure occurred
- Reuses existing `formatRelativeTime()` helper
