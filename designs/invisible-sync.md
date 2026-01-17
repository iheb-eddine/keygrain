# Design: Invisible Sync

## Overview

Replace the manual "Sync" button in the extension popup with automatic, background sync. Sync fires silently on unlock and after service mutations. The user sees only a subtle "Last synced" indicator; failures surface as a clickable warning icon.

No changes to `syncWithServer()` or the server protocol. The existing merge logic handles conflicts.

## Trigger Points and Debouncing

### Trigger 1: On Unlock

After `loadServices()` succeeds and `showMainScreen()` is called, fire `performAutoSync()` immediately. This ensures the user always sees the freshest merged state.

### Trigger 2: After Service Mutations

Every `saveServices()` call (add, edit, delete) resets a 5-second debounce timer. When the timer fires, `performAutoSync()` runs.

```
saveServices() → clearTimeout(syncDebounceTimer)
             → syncDebounceTimer = setTimeout(performAutoSync, 5000)
```

If another mutation occurs during an in-flight sync, the debounce timer resets. When the in-flight sync completes (and is discarded due to dirty generation — see below), the debounce naturally fires a fresh sync with the latest state.

### Debounce Reset on Lock

`lockBtn` handler clears `syncDebounceTimer` and sets `syncInProgress = false` (any in-flight fetch will complete but its result is discarded since `currentSecret` is nulled).

## Race Condition Handling (Generation Counter)

The dangerous scenario: user mutates services while a sync is in-flight. The sync result is based on a stale snapshot and would overwrite the user's edit.

**Solution:**

```
let syncGeneration = 0;  // increments on every saveServices()

async function performAutoSync() {
  if (syncInProgress || !currentSecret) return;
  syncInProgress = true;
  const gen = syncGeneration;
  try {
    const result = await syncWithServer(currentSecret, currentEmail, services);
    if (syncGeneration !== gen) return; // dirty — discard, debounce will retry
    skipNextDebounce = true;
    services = result.services;
    await saveServices();
    await setKnownUUIDs(result.knownUUIDs);
    renderServiceList();
    lastSyncTime = Date.now();
    lastSyncError = null;
    await chrome.storage.local.set({lastSyncTime, lastSyncError: null});
  } catch (e) {
    lastSyncError = e.message;
    await chrome.storage.local.set({lastSyncError: e.message});
  } finally {
    syncInProgress = false;
    updateSyncIndicator();
  }
}
```

- `saveServices()` increments `syncGeneration` and resets the debounce timer (unless `skipNextDebounce` is set).
- `skipNextDebounce` prevents the apply→save→debounce→sync infinite loop.

## Concurrent Sync Guard

`syncInProgress` flag prevents overlapping syncs. If `performAutoSync()` is called while one is in-flight, it returns immediately. The debounce timer from the triggering mutation will have already been set, so a fresh sync fires after the current one completes.

## UI Changes

### Remove

- `#sync-btn` from `#menu-dropdown`

### Add: Sync Status Indicator

A `#sync-indicator` element in the footer area (below `#service-list`, above `#add-btn`):

```html
<div id="sync-indicator" class="hidden">
  <span id="sync-time"></span>
  <span id="sync-error" class="hidden" title="Click for details">⚠️</span>
</div>
```

**States:**

| State | Display |
|-------|---------|
| Never synced | Hidden |
| Syncing | "Syncing..." (plain text, no spinner) |
| Success | "Last synced: 2m ago" |
| Error | "⚠️ Sync failed" (clickable) |

**Relative time:** Updated every 30s via `setInterval`. Shows "just now", "1m ago", "5m ago", "1h ago", etc.

**Error click:** Calls `showStatus(lastSyncError)` to display the full error in the existing status toast.

### CSS

```css
#sync-indicator {
  font-size: 0.75rem;
  color: var(--muted);
  text-align: center;
  padding: 4px 0;
}
#sync-error {
  cursor: pointer;
  color: var(--warning, #e67e22);
}
```

## Error Handling

| Error | User sees | Recovery |
|-------|-----------|----------|
| Network failure | ⚠️ Sync failed | Next unlock or mutation retries |
| `auth_failed` | ⚠️ Sync auth failed | User checks settings/email |
| `empty_push_blocked` | ⚠️ Sync blocked | User adds services or investigates |
| `server_error` | ⚠️ Sync failed | Next trigger retries |
| `conflict` (after internal retry) | ⚠️ Sync conflict | Next trigger retries |

No automatic retry timer. Natural triggers (unlock, mutations) provide retry cadence. This avoids hammering a down server.

## State Persistence

Stored in `chrome.storage.local`:

| Key | Type | Purpose |
|-----|------|---------|
| `lastSyncTime` | number (epoch ms) | Display relative time |
| `lastSyncError` | string \| null | Show warning + detail on click |

On popup open (while unlocked), these are loaded to render the indicator immediately before the unlock-triggered sync fires.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| First-time user, no services | Sync fires on unlock; creates remote state or no-ops on 404 |
| Popup closes mid-sync | Fire-and-forget; next open re-syncs on unlock |
| Rapid mutations (add 3 services in 10s) | Debounce ensures single sync 5s after last mutation |
| Lock while debounce pending | Timer cleared, in-flight sync result discarded (currentSecret nulled) |
| User edits during in-flight sync | Generation mismatch → result discarded → debounce retries |
| Two syncs attempted simultaneously | `syncInProgress` flag prevents overlap |
| Sync result triggers saveServices | `skipNextDebounce` prevents re-triggering sync |
| No server URL configured | `syncWithServer` uses default server; proceeds normally |

## Integration Points

| File | Change |
|------|--------|
| `popup.html` | Remove `#sync-btn`, add `#sync-indicator` element |
| `popup.css` | Add sync indicator styles |
| `popup.js` | Add `performAutoSync`, generation counter, debounce wiring, indicator update logic; remove sync button handler; add sync call after `showMainScreen()` |
| `sync.js` | No changes |
