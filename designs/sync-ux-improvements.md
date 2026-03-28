# Sync Error Handling UX Improvements

## Overview

Improve sync error handling to distinguish error types, auto-retry network failures, make conflict resolution transparent, and add server-side request logging for debugging.

## 1. Error Classification

Errors from `syncWithServer` are classified into categories with distinct user-facing messages:

| Error type | Detection | User-facing message | Retry? |
|---|---|---|---|
| Network | `Failed to fetch`, `TypeError`, `NetworkError` | "Connection error. Retrying in Xs..." | Yes (auto) |
| Server (5xx) | `server_error` thrown by syncWithServer | "Server error. Retrying in Xs..." | Yes (auto) |
| Auth | `auth_failed` | "Authentication failed. Check your credentials." | No |
| Conflict (exhausted) | `conflict` after 3 internal retries | "Sync conflict. Please try again." | No (waits for next trigger) |
| Integrity | `checksum_mismatch`, `metadata_length_mismatch`, `MetadataTamperError` | "Data integrity error. Please contact support." | No |

## 2. Network/Server Error Auto-Retry

### Architecture

Retry logic lives in **background.js** using `chrome.alarms`. The popup is ephemeral and cannot maintain retry loops.

### Retry schedule

| Attempt | Delay |
|---|---|
| 1st retry | 30 seconds |
| 2nd retry | 60 seconds |
| 3rd retry (and beyond) | Back to normal 5-minute sync interval |

After 2 failed retries, the error state persists but normal sync scheduling resumes (next save or popup open triggers sync as before).

### State storage

```
chrome.storage.local:
  syncRetryState: {
    attempt: number,       // current retry attempt (0 = no retry pending)
    nextRetryAt: number,   // timestamp (ms) of next scheduled retry
    errorType: string      // "network" | "server"
  }
```

### Flow

1. `syncWithServer` throws a network or server error
2. Background script catches it, increments `syncRetryState.attempt`, computes `nextRetryAt`, stores state, creates a `chrome.alarm`
3. When alarm fires, background calls `syncWithServer` again
4. On success: clear `syncRetryState`, update `lastSyncTime`
5. On failure: repeat from step 2 (up to 2 retries, then stop scheduling alarms)

### Popup display

The popup reads `syncRetryState` from storage. If `nextRetryAt` is in the future:
- Shows: "Connection error. Retrying in Xs..." with a live countdown (1-second `setInterval` computing `Math.ceil((nextRetryAt - Date.now()) / 1000)`)
- After retries exhausted (attempt >= 3): "Sync unavailable. Will retry on next change."

## 3. Conflict (409) Resolution — Transparent

### Current behavior

`syncWithServer` retries once on 409 (re-calls itself with `retryCount + 1`). If the second attempt also gets 409, throws `"conflict"`.

### New behavior

- Increase max conflict retries from 1 to 3 (`retryCount < 3`)
- During conflict retries, the sync is still "in progress" — popup shows "Syncing..." (no change needed)
- Only if all 3 conflict retries fail does it throw `"conflict"` and show the error
- No countdown or special UI during conflict resolution — it's fast (immediate re-fetch + merge + push)

### Rationale

409 is normal concurrent-edit behavior (two devices syncing simultaneously). The user should never see it unless something is genuinely stuck.

## 4. Server-Side Request Logging

### Output

Structured JSON to **stdout**. Docker captures stdout automatically; no file rotation needed.

### Log format

One JSON object per line:

```json
{"ts":"2026-05-13T12:43:51Z","method":"PUT","path":"/api/sync/abcdef12...","lookup_prefix":"abcdef12","status":200,"duration_ms":45,"size":1234}
```

### Fields

| Field | Description |
|---|---|
| `ts` | ISO 8601 UTC timestamp |
| `method` | HTTP method (GET, PUT) |
| `path` | Request path (truncated after first 20 chars of lookup_id) |
| `lookup_prefix` | First 8 hex chars of lookup_id (for debugging without exposing full ID) |
| `status` | HTTP response status code |
| `duration_ms` | Request processing time in milliseconds |
| `size` | Response body size in bytes |

### Explicit exclusions (privacy/security)

- No auth passwords or headers
- No encrypted blob content
- No full lookup_id (only 8-char prefix)
- No request body content

### Implementation

A logging middleware wrapping the sync handler in `main.go`:

```go
func loggingMiddleware(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        rw := &responseWriter{ResponseWriter: w}
        next(rw, r)
        // extract lookup_prefix from path
        // log JSON line to stdout
    }
}
```

The middleware uses a `responseWriter` wrapper to capture status code and response size.

## 5. Summary of Changes by File

| File | Change |
|---|---|
| `extension/shared/sync.js` | Increase 409 retry from 1 to 3 |
| `extension/shared/popup.js` | Read `syncRetryState`, show countdown for network errors, differentiate error messages |
| `extension/background.js` | Add retry scheduling via `chrome.alarms`, store `syncRetryState` |
| `server/main.go` | Add logging middleware wrapping sync handler |

## 6. Non-Goals

- Offline queue (sync is already triggered on reconnect via popup open / next save)
- Push notifications for sync status
- Retry for auth or integrity errors (these require user action)
