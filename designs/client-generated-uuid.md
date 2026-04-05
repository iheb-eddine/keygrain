# Client-Generated UUIDs

## Summary

Move service UUID generation from the server to the client. The `id` field is never null — it is assigned at service creation time.

## Current Flow

1. Client creates service with `id: null`
2. On sync PUT, server sees `id: null`, generates UUID, returns it
3. Client stores the server-assigned UUID

## New Flow

1. Client generates UUID at creation time (`crypto.randomUUID()` in JS, `UUID.randomUUID()` in Kotlin)
2. `id` is never null
3. On sync PUT, client sends its pre-assigned id
4. Server accepts client-provided id (rejects null ids with 422)
5. Server still uses id for matching/merge

## Changes Per File

### extension/shared/popup.js

**Change:** When adding a service, set `id: crypto.randomUUID()` instead of `id: null`.

### extension/shared/sync.js

**Remove:**
- Step 6: mapping `putResult.services[i].id` onto merged services (no longer needed — ids are already present)
- `localNew` array and its handling in `mergeServices` (dead code — id is never null)

**Change:**
- Build `finalKnown` from `merged.map(s => s.id).filter(Boolean)` instead of from `putResult.services`
- Return `knownUUIDs` derived from merged set

### server/sync.go

**Remove:**
- UUID generation loop in `handlePut` (`for i := range req.Services { if req.Services[i].ID == nil { ... } }`)
- `generateUUID()` function (dead code)

**Add:**
- Reject null IDs in validation: return 422 if any `svc.ID == nil`

### kotlin/.../data/ServiceManager.kt

**Change:** In `addService`, set `id = UUID.randomUUID().toString()` in the copy call.

### kotlin/.../ui/screens/MainScreen.kt

**Change:** LazyColumn key from `it.id ?: "${it.name}:${it.email}:${it.counter}"` to `it.id`.

### kotlin/.../data/SyncManager.kt

**Remove:**
- Server-assigned UUID update after PUT (`svc.copy(id = putResult.services[i].first, ...)`)
- `localNew` list and its handling in `mergeServices` (dead code)

**Change:**
- Build `newKnown` from `merged.mapNotNull { it.id }.toSet()` instead of from PUT response

## Impact on Sync Protocol

Minimal. The server no longer generates UUIDs — it just stores and returns what the client sends. The merge algorithm is unchanged; it still uses id for matching. The `knownUUIDs` set (used to detect remote deletions) is still maintained but sourced from the local merged set rather than the server response.

## Migration

None needed — no real users exist.
