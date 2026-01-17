# Monotonic Timestamps

## Overview

Replace bare `Date.now()` calls in `extension/shared/popup.js` (add/edit service) with a helper `nextTimestamp()` that returns `Math.max(Date.now(), maxExistingTimestamp + 1)`. This guarantees monotonically increasing timestamps even if the system clock goes backward, per sync-v2 design (section 7, Scenario 2).

## Interface

**Function:** `nextTimestamp(services)` — defined inline in popup.js (Helpers section).

```js
function nextTimestamp(services) {
  let max = 0;
  for (const s of services) if (s.updated_at > max) max = s.updated_at;
  return Math.max(Date.now(), max + 1);
}
```

**Call sites (2):**
- Edit path (line ~672): `updated_at: nextTimestamp(services)`
- Add path (line ~674): `updated_at: nextTimestamp(services)`

## Timestamp Unit Convention

The canonical unit is **milliseconds** (as produced by `Date.now()`). All popup.js timestamps use milliseconds.

The backup migration path in `sync.js:218` produces second-precision timestamps (`Math.floor(Date.now() / 1000)`). These will always lose to any subsequent ms-precision edit numerically. This is acceptable because migration is a one-time event and any subsequent edit supersedes it. Future changes must not "fix" popup.js to use seconds — that would break monotonicity guarantees.

## Edge Cases

1. **Empty services array** — `max` stays 0, returns `Date.now()`.
2. **Services with no `updated_at`** — `undefined > 0` is false, skipped (treated as 0).
3. **Rapid successive edits** — each call increments by at least 1ms from the previous max.
4. **Clock jumps forward then back** — the high-water mark persists in stored timestamps; subsequent calls use `max + 1` until real time catches up.
5. **Integer overflow** — `Number.MAX_SAFE_INTEGER` is ~285,000 years from epoch. Not a concern.

## Test Plan

1. **Normal case:** services have timestamps in the past → returns `Date.now()`.
2. **Clock skew:** mock `Date.now()` to return a value less than max existing timestamp → returns `max + 1`.
3. **Empty array:** returns `Date.now()`.
4. **Rapid calls:** call twice in sequence → second result > first result.
