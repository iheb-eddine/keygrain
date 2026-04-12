# Design: Kotlin SyncManager — 3 Sync Fixes

**Date:** 2026-05-18  
**Status:** Draft  
**Scope:** `SyncManager.kt` only

---

## 1. Frozen Requirements

### P2 (HIGH): Metadata Tamper Detection

Port `validateMetadataIntegrity()` from JS (`extension/shared/sync.js:82-112`) to Kotlin:

- **Check 1 — Order consistency:** The relative order of UUIDs shared between cached and received metadata must be preserved. If UUID A appeared before UUID B in the cached metadata, and both exist in received metadata, A must still appear before B.
- **Check 2 — Timestamp monotonicity:** For any UUID present in both cached and received metadata, `updated_at` must not decrease.
- **Cache:** Store metadata as JSON in SharedPreferences after each successful PUT (using server response metadata).
- **Validation call site:** After GET 200 + decryption + length check, before merge. Skip if no cache exists.
- **Failure mode:** Return `SyncResult.IntegrityError` with violation details. No retry.

### P1 (Medium): Retry Count Parity

- **Current:** `retryCount < 1` — retries 409 Conflict only 1 time.
- **Required:** `retryCount < 3` — retry up to 3 times, matching JS (`sync.js:394`).

### P3: Remove Empty Push Protection

- **Current:** Lines ~276-281 block sync if merged services are empty but remote had data (same for wallets).
- **Required:** Remove both guards. JS removed this (BUG 12 fix) because it prevents legitimate "delete all" operations.

---

## 2. Invariants

| # | Invariant | Rationale |
|---|-----------|-----------|
| I1 | Metadata cache is written exactly once per sync: after successful PUT, from `PutResult.Success.services` | Ensures cache reflects server-canonical state |
| I2 | Validation is skipped when cache is null (first sync) | Cannot compare without baseline |
| I3 | Validation failure is a hard stop — no retry, no merge, no push | Tampered metadata means server state is untrustworthy |
| I4 | Order check compares only shared UUIDs (present in both cached and received) | New/deleted UUIDs don't violate ordering |
| I5 | Timestamp check: `received.updated_at < cached.updated_at` is a violation | Timestamps must be monotonically non-decreasing |
| I6 | Retry count uses `<` comparison (not `<=`) | `retryCount < 3` means attempts at retryCount 0, 1, 2 → 3 retries total |
| I7 | Empty push removal does not affect the existing checksum or length validations | Those remain as independent integrity checks |

---

## 3. Scope Boundary

### In Scope

- `SyncManager.kt`: add `validateMetadataIntegrity()`, metadata cache read/write, retry fix, empty push removal
- SharedPreferences key `sync_metadata_cache` in existing `keygrain_sync` prefs

### Out of Scope

- Server-side changes
- Merge logic changes (beyond removing empty push guard)
- UI/UX changes (no user-facing error messages designed here)
- Other platforms (JS is the reference, not a target)
- `SyncCrypto`, `Keygrain`, `ServiceManager` — untouched
- Migration of existing cached data (first sync after deploy will have no cache → validation skipped)

---

## 4. Design Details

### 4.1 Metadata Cache

**Storage format** (SharedPreferences string, key `sync_metadata_cache`):

```json
[{"id":"uuid-1","updated_at":1716000000},{"id":"uuid-2","updated_at":1716000100}]
```

**Write timing:** After `PutResult.Success`, serialize `putResult.services` (which is `List<Pair<String?, Long>>`) to JSON and store.

**Read timing:** At the start of GET 200 processing (after decryption, after length check), read cache. If non-null, call validation.

**Helper functions:**

```kotlin
private fun getMetadataCache(context: Context): List<Pair<String?, Long>>?
private fun setMetadataCache(context: Context, metadata: List<Pair<String?, Long>>)
```

### 4.2 Validation Function

```kotlin
private fun validateMetadataIntegrity(
    received: List<Pair<String?, Long>>,
    cached: List<Pair<String?, Long>>
): String?  // returns null if valid, violation description if invalid
```

**Algorithm (mirrors JS exactly):**

1. Build `receivedById: Map<String, Long>` from received (skip null IDs)
2. Extract `cachedOrder = cached.mapNotNull { it.first }` and `receivedOrder = received.mapNotNull { it.first }`
3. Compute `sharedIds = cachedOrder.filter { it in receivedById }.toSet()`
4. Filter both orders to shared IDs only: `sharedInCachedOrder`, `sharedInReceivedOrder`
5. Compare element-by-element. First mismatch → return `"order: relative order of UUIDs changed"`
6. Build `cachedById: Map<String, Long>` from cached
7. For each received entry with non-null ID: if `cachedById[id]` exists and `received.updated_at < cached.updated_at` → return `"timestamp: UUID $id went from $cached to $received"`
8. Return null (valid)

**Call site** (in `GetResult.Success` branch, after length check):

```kotlin
val cachedMeta = getMetadataCache(context)
if (cachedMeta != null) {
    val violation = validateMetadataIntegrity(remoteMetadata, cachedMeta)
    if (violation != null) {
        return@withContext SyncResult.IntegrityError("metadata tamper: $violation")
    }
}
```

### 4.3 Retry Count Fix

**Change:** Line ~308 in `sync()`:

```kotlin
// Before:
if (retryCount < 1) {
// After:
if (retryCount < 3) {
```

### 4.4 Empty Push Protection Removal

**Delete** the following block (lines ~276-281):

```kotlin
// Remove:
if (merged.isEmpty() && remoteMetadata.isNotEmpty()) {
    return@withContext SyncResult.IntegrityError("empty push blocked")
}
if (mergedWallets.isEmpty() && remoteWallets.isNotEmpty()) {
    return@withContext SyncResult.IntegrityError("empty wallet push blocked")
}
```

### 4.5 Cache Write After PUT Success

In the `PutResult.Success` branch, after `serviceManager.replaceAll(merged)`:

```kotlin
setMetadataCache(context, putResult.services)
```

---

## 5. Test Plan

### 5.1 P2 — Metadata Tamper Detection

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| T1 | Order preserved — valid | cached: [A,B,C], received: [A,B,C,D] | No violation |
| T2 | Order violated | cached: [A,B,C], received: [B,A,C] | IntegrityError("metadata tamper: order...") |
| T3 | Timestamp monotonic — valid | cached: A@100, received: A@200 | No violation |
| T4 | Timestamp decreased | cached: A@200, received: A@100 | IntegrityError("metadata tamper: timestamp...") |
| T5 | No cache (first sync) | cache=null | Validation skipped, sync proceeds |
| T6 | New UUIDs in received (not in cached) | cached: [A], received: [A,B] | No violation (B is new) |
| T7 | Deleted UUIDs (in cached, not in received) | cached: [A,B], received: [A] | No violation (B was deleted) |
| T8 | Both violations present | order changed AND timestamp decreased | First violation detected is reported |
| T9 | Null IDs in metadata | cached: [null,A], received: [A] | Null IDs skipped, no violation |
| T10 | Cache written after PUT | Successful sync | SharedPreferences contains server response metadata |

### 5.2 P1 — Retry Count

| # | Test Case | Expected |
|---|-----------|----------|
| T11 | 409 at retryCount=0 | Retries (retryCount=1) |
| T12 | 409 at retryCount=1 | Retries (retryCount=2) |
| T13 | 409 at retryCount=2 | Retries (retryCount=3) |
| T14 | 409 at retryCount=3 | Returns `SyncResult.ConflictError` |

### 5.3 P3 — Empty Push Removal

| # | Test Case | Expected |
|---|-----------|----------|
| T15 | All services deleted locally, remote had 3 | Sync succeeds, pushes empty services list |
| T16 | All wallets deleted locally, remote had 2 | Sync succeeds, pushes empty wallets list |
| T17 | Normal merge (non-empty result) | Sync succeeds (regression check) |

---

## 6. Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Cache corruption (invalid JSON in SharedPreferences) | `getMetadataCache` returns null on parse failure → validation skipped (safe fallback) |
| Large metadata list performance | Linear scan — O(n) for both checks. Metadata is service count, typically <1000. No concern. |
| Race condition on cache write | Single-threaded coroutine on `Dispatchers.IO` + SharedPreferences `apply()` is atomic per Android docs |
| Empty push removal enables accidental data loss | Mitigated by: (1) merge logic preserves remote-only entries unless in knownUUIDs, (2) tamper detection catches server-side manipulation, (3) user must explicitly delete each service locally |
