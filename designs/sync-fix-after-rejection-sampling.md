# Fix: Sync Failure After Rejection Sampling Change

## Problem

The extension reports "sync failed" after the modulo bias fix (rejection sampling) was applied to `buildPassword`.

**Symptom:** Server returns 401 on both GET and PUT to `/api/sync/:lookup_id`.

## Root Cause

`deriveAuthPassword` calls `buildPassword`, which now uses rejection sampling (`unbiasedIndex`) instead of raw modulo. This produces a different password for the same inputs.

- `deriveLookupId` — uses raw HMAC-SHA256, **unchanged**. The server finds the record.
- `deriveAuthPassword` — uses `buildPassword` with rejection sampling, **changed**. The bcrypt hash stored on the server no longer matches.

Result: same lookup_id, different auth password → server finds record but bcrypt compare fails → 401.

## Immediate Fix: Wipe Server Test Data

There are no real users. All server data is test data.

**Action:** Delete the contents of the server's sync data directory (the `sync/` folder under the configured data path).

After the wipe:
1. GET `/api/sync/:lookup_id` → 404 (no file)
2. Client proceeds to PUT without `If-Match`
3. Server sees no existing file → creates new record with bcrypt hash of the new auth password
4. Sync succeeds

No code changes required for the immediate fix.

## Client-Side Improvement: Treat GET 401 as 404

Modify `syncWithServer` in `extension/shared/sync.js`: when GET returns 401, treat it as equivalent to 404 (no remote state) rather than throwing `auth_failed`.

This improves the migration UX:
- Without this change: user sees cryptic "auth_failed" error, must understand they need a server wipe.
- With this change: client silently proceeds to push fresh data. Combined with the server wipe, sync recovers automatically.

**Important limitation:** This client-side change does NOT future-proof against algorithm changes when real users exist. If the server file still exists (not wiped), PUT will also fail with 401 because the server validates auth on existing records before accepting writes. The client-side change only helps when the server data has been wiped.

## Rejected Alternative: Server-Side Re-Registration on Auth Failure

**Approach:** Modify `handlePut` to overwrite the record when auth fails and no `If-Match` header is present.

**Why rejected:** The lookup_id appears in the URL path of every request. If a lookup_id were ever leaked (logs, network inspection, etc.), an attacker could destroy a user's vault by sending a PUT without `If-Match`. "Remove this later" comments are not security controls — the risk exists from the moment the code is deployed.

## Future: Real Users and Algorithm Changes

Once real users exist, an auth password algorithm change requires a proper migration strategy. Options (out of scope for this fix):

- Versioned auth: store algorithm version alongside the hash, support both during transition
- Re-auth endpoint: authenticated endpoint that accepts old + new password, updates the hash
- Client-side dual-attempt: try new password first, fall back to old

These require design work and are not needed while there are no users.
