# Backup Versioning with ETag Support — Design Document

## 1. Overview

When multiple devices (e.g., Android phone + tablet) share the same keygrain backup, concurrent writes can silently overwrite each other. This design adds optimistic concurrency control via HTTP ETags to detect conflicts and prevent accidental data loss.

The mechanism is simple: the server tags each stored blob with a content-derived ETag. Clients that have previously restored a backup send `If-Match` on subsequent PUTs. If the server's current ETag differs (meaning another device wrote in between), the PUT is rejected with `412 Precondition Failed`.

## 2. ETag Computation

```
ETag = hex(SHA-256(raw_blob_bytes)[0:16])
```

- Input: the raw encrypted blob bytes as received from the client (before base64 encoding for storage)
- Hash: SHA-256 (32 bytes)
- Truncate: first 16 bytes
- Encode: lowercase hex → 32 hex characters
- HTTP format: quoted string per RFC 7232, e.g., `ETag: "a1b2c3d4e5f6..."`

**Why SHA-256 truncated to 16 bytes?**
- 128 bits of collision resistance is more than sufficient for conflict detection (not a security boundary)
- Compact enough for HTTP headers and client storage
- Deterministic: same blob always produces the same ETag (no randomness)

## 3. Server Changes (backup.go)

### 3.1 Record Schema Change

Add `etag` field to `backupRecord`:

```go
type backupRecord struct {
    AuthPasswordHash string `json:"auth_password_hash"`
    EncryptedBlob    string `json:"encrypted_blob"`
    ETag             string `json:"etag"`
    CreatedAt        string `json:"created_at"`
    UpdatedAt        string `json:"updated_at"`
}
```

### 3.2 ETag Computation Function

```go
func computeETag(blob []byte) string {
    h := sha256.Sum256(blob)
    return hex.EncodeToString(h[:16])
}
```

### 3.3 GET Changes

After successful auth and blob decode, add the ETag response header:

```
ETag: "<computed_etag>"
```

For records that predate this feature (no `etag` field stored), compute the ETag on-the-fly from the decoded blob. This ensures backward compatibility without migration.

### 3.4 PUT Changes

**Flow:**

1. Parse `If-Match` header (strip quotes if present)
2. Acquire per-lookup_id lock
3. Read existing record (if any)
4. **If record does not exist (first PUT):** proceed unconditionally — ignore `If-Match` value
5. **If record exists and `If-Match` is absent:** proceed unconditionally (backward-compatible)
6. **If record exists and `If-Match` is present:**
   - Compute or read stored ETag of current blob
   - If `If-Match` value ≠ stored ETag → respond `412 Precondition Failed`
   - If match → proceed with write
7. Compute new ETag from incoming blob bytes
8. Store record with new ETag
9. Return ETag in response header and body

**First PUT rationale:** A client may hold a stale ETag from a previously deleted or recreated record. Rejecting a create based on a stale ETag would be unhelpful — the resource doesn't exist, so there's nothing to conflict with.

### 3.5 Response Changes

**GET 200:**
```
ETag: "a1b2c3d4..."
Content-Type: application/octet-stream

<raw blob bytes>
```

**PUT 201 (created):**
```
ETag: "a1b2c3d4..."
Content-Type: application/json

{"status":"created","etag":"a1b2c3d4..."}
```

**PUT 200 (updated):**
```
ETag: "a1b2c3d4..."
Content-Type: application/json

{"status":"updated","etag":"a1b2c3d4..."}
```

**PUT 412 (conflict):**
```
Content-Type: application/json

{"error":"precondition failed","current_etag":"b5c6d7e8..."}
```

The 412 response includes the current ETag so the client knows what version is on the server without needing a separate GET.

### 3.6 ETag Parsing

The `If-Match` header value may be:
- Quoted: `"a1b2c3d4..."` → strip quotes
- Unquoted: `a1b2c3d4...` → use as-is
- `*` → treat as absent (unconditional write)

Validation: must be exactly 32 lowercase hex characters after stripping quotes. Invalid values → `400 Bad Request` with `{"error":"invalid If-Match header"}`.

## 4. Client Changes

### 4.1 SyncManager.kt (Android)

**Restore flow:**
1. After successful GET, read the `ETag` response header
2. Store the ETag value (e.g., in SharedPreferences keyed by lookup_id)

**Backup flow:**
1. Before PUT, check if a stored ETag exists for this lookup_id
2. If yes: add `If-Match: "<etag>"` header to the PUT request
3. If no (first backup, never restored): omit `If-Match` (unconditional write)
4. On successful PUT (200/201): update stored ETag from response header or body
5. On 412: surface conflict to user

**New result type:**

```kotlin
sealed class SyncResult {
    data class Success(val message: String) : SyncResult()
    data class Conflict(val currentEtag: String) : SyncResult()  // NEW
    data class AuthError(val httpCode: Int) : SyncResult()
    data class NetworkError(val cause: Throwable) : SyncResult()
    data class ServerError(val httpCode: Int, val body: String) : SyncResult()
}
```

### 4.2 popup.js (Browser Extension)

**No changes required.** The browser extension is a password generator — it does not perform backup/sync operations.

## 5. Conflict Resolution UX

### 5.1 When 412 Occurs

The user sees a dialog:

> **Backup conflict detected**
>
> Another device updated your backup since you last synced. To avoid losing that device's changes:
>
> 1. **Restore** to get the latest backup
> 2. Review and re-add any local changes
> 3. **Backup** again
>
> [Restore Now] [Cancel]

### 5.2 Design Rationale

- No automatic merge: the encrypted blob is opaque to the server, and even decrypted it's a full JSON config. Merging service entries would require conflict resolution logic that's out of scope.
- Last-writer-wins is still available: if the user is confident their local state is correct, they can backup without `If-Match` (but the app should not expose this easily — it's a power-user escape hatch, not the default flow).
- The UX guides users toward restore-then-backup, which is the safe path.

### 5.3 Typical Multi-Device Flow

1. Device A restores → gets ETag "aaa..."
2. Device A adds a service, backs up with `If-Match: "aaa..."` → succeeds, gets ETag "bbb..."
3. Device B (still holding ETag "aaa...") tries to backup with `If-Match: "aaa..."` → 412
4. Device B restores → gets ETag "bbb..." and Device A's changes
5. Device B re-adds its local changes, backs up with `If-Match: "bbb..."` → succeeds

## 6. Test Plan

### 6.1 Server Unit Tests

| Test | Verifies |
|------|----------|
| `TestGet_ReturnsETagHeader` | GET response includes correctly formatted ETag header |
| `TestGet_ETagMatchesBlob` | ETag = hex(SHA-256(blob)[0:16]) |
| `TestPut_ReturnsETagInHeaderAndBody` | PUT 200/201 responses include ETag |
| `TestPut_NoIfMatch_Succeeds` | PUT without If-Match overwrites unconditionally |
| `TestPut_IfMatchCorrect_Succeeds` | PUT with matching If-Match succeeds |
| `TestPut_IfMatchWrong_Returns412` | PUT with non-matching If-Match returns 412 with current_etag |
| `TestPut_IfMatchStar_Unconditional` | `If-Match: *` treated as unconditional |
| `TestPut_FirstPut_IgnoresIfMatch` | First PUT (no existing record) succeeds even with If-Match |
| `TestPut_InvalidIfMatch_Returns400` | Non-hex or wrong-length If-Match → 400 |
| `TestPut_ETagUpdatesAfterWrite` | After PUT, stored ETag reflects new blob |
| `TestGet_LegacyRecord_ComputesETag` | Record without etag field → ETag computed on-the-fly |

### 6.2 Integration Tests

| Test | Verifies |
|------|----------|
| `TestConflictFlow` | PUT A → PUT B with stale ETag → 412 → GET → PUT B with fresh ETag → success |
| `TestBackwardCompat_NoIfMatch` | Old client (no If-Match) can still PUT successfully |
| `TestETagConsistency` | GET ETag matches what PUT returned |

### 6.3 Client Tests (SyncManager.kt)

| Test | Verifies |
|------|----------|
| `testBackup_sendsIfMatch_whenEtagStored` | If-Match header sent when ETag is in preferences |
| `testBackup_omitsIfMatch_whenNoEtag` | No If-Match on first backup |
| `testBackup_storesEtag_onSuccess` | ETag from response stored in preferences |
| `testRestore_storesEtag` | ETag from GET response header stored |
| `testBackup_returns412_asConflict` | 412 response mapped to SyncResult.Conflict |

## 7. Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| Old client (no If-Match) → new server | Unconditional write, same as before. No breakage. |
| New client → old server (no ETag support) | Client sends If-Match, server ignores unknown header. Write succeeds. Client won't get ETag in response → won't send If-Match next time. Graceful degradation. |
| Existing records on disk (no etag field) | GET computes ETag on-the-fly from stored blob. First PUT after upgrade stores the etag field. No migration needed. |
| Mixed fleet (some devices updated, some not) | Updated devices get conflict protection. Non-updated devices still do unconditional writes. This is acceptable — protection is best-effort until all devices update. |

## 8. Limitations

- **Single-instance only:** The per-lookup_id in-memory mutex provides atomicity within one server process. Multi-instance deployments would require external locking (e.g., file locks, database backend). This is acceptable for the current single-instance deployment model.
- **No merge:** Conflict resolution is manual (restore + re-apply). Automatic merging of encrypted blobs is not feasible without decryption on the server.
- **No version history:** Only the latest blob is stored. A future enhancement could keep N previous versions for rollback.

## 9. Future Considerations

- **`If-None-Match: *` (create-only):** If a DELETE endpoint is added, `If-None-Match: *` could prevent re-create races (ensure PUT only succeeds if no record exists). Not needed for v1 since the implicit registration model means first PUT always creates.
- **`If-Modified-Since` / `304 Not Modified`:** Could save bandwidth on GET when the client already has the latest blob. Low priority.
- **Conflict-free merge:** Would require the server to understand the blob structure (decrypt, merge service lists, re-encrypt). Architecturally incompatible with the current zero-knowledge design.
