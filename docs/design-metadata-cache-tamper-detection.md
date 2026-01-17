# Design: Metadata Cache Tamper Detection

## 1. Overview

After each successful sync (PUT returns 200/201), the client caches the metadata array (as returned by the server in the PUT response). On the next GET (before merge), the client compares the received metadata against the cache. Two checks detect potential server-side tampering:

1. **Order consistency** — the relative order of UUIDs that appear in both cached and received metadata must be preserved.
2. **Timestamp monotonicity** — for each UUID present in both, `updated_at` in the new metadata must be >= the cached value.

If any check fails, throw a `MetadataTamperError` with details. The caller (popup.js) catches it and can prompt the user.

**Assumption:** Clients do not reorder entries. The `mergeServices` function preserves remote order and appends new entries. If a reorder UI is added in the future, the order check must be revisited.

**Removed check (UUID presence):** An earlier version checked that every cached UUID appeared in received metadata (unless the local client deleted it). This was removed because it produces false positives in multi-device scenarios: Device B can legitimately delete a service, causing it to disappear from the server while Device A still has it locally. Without a server-side deletion log or vector clocks, this condition is indistinguishable from tampering.

## 2. Interface

### Storage Key

`syncMetadataCache`

Value shape: `[{id: string, updated_at: number}, ...]` — mirrors the server metadata array.

### Functions

```js
// Cache the metadata after successful sync
async function setMetadataCache(metadata) {
  await chrome.storage.local.set({ syncMetadataCache: metadata });
}

// Retrieve cached metadata (returns null if no cache)
async function getMetadataCache() {
  const data = await chrome.storage.local.get("syncMetadataCache");
  return data.syncMetadataCache || null;
}

// Validate received metadata against cache. Throws MetadataTamperError on failure.
// receivedMetadata: [{id, updated_at}, ...] from GET response
// cachedMetadata: [{id, updated_at}, ...] from previous sync
function validateMetadataIntegrity(receivedMetadata, cachedMetadata) {
  const violations = [];
  const receivedById = new Map(receivedMetadata.map(m => [m.id, m]));

  // Check 1: Order consistency (relative order of shared UUIDs)
  const cachedOrder = cachedMetadata.map(m => m.id);
  const receivedOrder = receivedMetadata.map(m => m.id);
  const sharedIds = new Set(cachedOrder.filter(id => receivedById.has(id)));
  const sharedInCachedOrder = cachedOrder.filter(id => sharedIds.has(id));
  const sharedInReceivedOrder = receivedOrder.filter(id => sharedIds.has(id));
  for (let i = 0; i < sharedInCachedOrder.length; i++) {
    if (sharedInCachedOrder[i] !== sharedInReceivedOrder[i]) {
      violations.push({ check: "order", details: "Relative order of UUIDs changed" });
      break;
    }
  }

  // Check 2: Timestamp monotonicity
  const cachedById = new Map(cachedMetadata.map(m => [m.id, m]));
  for (const received of receivedMetadata) {
    const cached = cachedById.get(received.id);
    if (cached && received.updated_at < cached.updated_at) {
      violations.push({ check: "timestamp", details: `UUID ${received.id}: updated_at went from ${cached.updated_at} to ${received.updated_at}` });
    }
  }

  if (violations.length > 0) {
    throw new MetadataTamperError(violations);
  }
}
```

### Error Type

```js
class MetadataTamperError extends Error {
  constructor(violations) {
    super("Metadata integrity check failed");
    this.name = "MetadataTamperError";
    this.violations = violations; // [{check: "order"|"timestamp", details: string}]
  }
}
```

### Integration Point in syncWithServer

After GET returns 200 and metadata is parsed, before merge:
```js
const cached = await getMetadataCache();
if (cached) {
  validateMetadataIntegrity(remoteMetadata, cached);
}
```

After successful PUT:
```js
await setMetadataCache(putResult.services);
```

## 3. Edge Cases

| Case | Behavior |
|------|----------|
| First sync (no cache) | Skip validation — nothing to compare against |
| New service added from another device | UUID in received but not in cache → fine (only check cache→received direction for order) |
| Server reorders entries | Relative order of shared UUIDs differs → violation |
| Server replays old timestamp | updated_at < cached → violation |
| Cache cleared (extension reinstall) | No cache → skip validation (same as first sync) |
| Multiple violations in one response | All violations collected and reported together |
| Another device deletes a service | UUID disappears from received — no violation (UUID presence check removed) |

## 4. Test Plan

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | No cache — skip | cachedMetadata=null | No error thrown |
| 2 | All UUIDs present, same order, same timestamps | Identical arrays | No error |
| 3 | UUID removed (another device deleted) | UUID in cache, not in received | No error |
| 4 | Order changed | Two UUIDs swap positions | Throws with order violation |
| 5 | Timestamp regression | Same UUID, updated_at decreased | Throws with timestamp violation |
| 6 | New UUID in received (not in cache) | Extra entry in received | No error |
| 7 | Multiple violations | Order change + timestamp regression | Throws with both violations listed |
| 8 | Subset order preserved with new entries interspersed | A,B,C cached; received A,X,B,Y,C | No error (relative order A<B<C preserved) |
| 9 | All cached UUIDs removed | Empty received array | No error (no shared UUIDs to compare) |
