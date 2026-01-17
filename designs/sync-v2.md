# Sync Protocol v2 — Per-Service Merge

## 1. Overview

Sync v2 replaces the whole-file-replace backup API (`/api/backup/:id`) with a per-service merge protocol. Key properties:

- **Per-service merge:** Each service has a UUID and timestamp; conflicts resolve per-service by most-recent-wins.
- **Server-assigned UUIDs:** Clients never generate IDs. New services have `id: null`; the server assigns UUIDs on PUT.
- **Single encrypted blob:** All service data is encrypted together (AES-256-GCM). The server cannot read service content.
- **Visible metadata:** Service IDs and `updated_at` timestamps are plaintext, enabling future server-side optimizations.
- **Delete = absence:** A previously-synced service (has UUID) missing from a push is deleted.
- **Integrity:** SHA-256 checksum of the encrypted blob for transport verification; client-side metadata caching for tamper detection.

### Auth (unchanged)

From the user's `secret` + `email`, the app derives:

| Purpose | Derivation |
|---------|-----------|
| Lookup ID | `hex(HMAC-SHA256(secret, email + ":keygrain-id"))` |
| Auth password | `derive_password_v1(secret, email, length=32, symbols=default, salt="keygrain-auth")` |
| Encryption key | `HMAC-SHA256(secret, email + ":keygrain-encryption")` |

Authentication: HTTP Basic with `lookup_id` as username and `auth_password` as password.

---

## 2. API Endpoints

### `GET /api/sync/:lookup_id`

Retrieve the current sync state.

### `PUT /api/sync/:lookup_id`

Push a merged sync state. Server assigns UUIDs to new entries and returns final metadata.

---

## 3. Request/Response Formats

### GET /api/sync/:lookup_id

**Request:**
```
GET /api/sync/abcdef0123456789... HTTP/1.1
Authorization: Basic <base64(lookup_id:auth_password)>
```

**Response (200 OK):**
```json
{
  "version": 1,
  "services": [
    {"id": "550e8400-e29b-41d4-a716-446655440000", "updated_at": 1715000000},
    {"id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8", "updated_at": 1715000100}
  ],
  "encrypted_blob": "<base64-encoded ciphertext>",
  "checksum": "<sha256-hex-of-encrypted-blob>"
}
```

**Response (404 Not Found):** No sync state exists for this user.
```json
{"error": "not found"}
```

**Response (401 Unauthorized):**
```json
{"error": "unauthorized"}
```

### PUT /api/sync/:lookup_id

**Request:**
```
PUT /api/sync/abcdef0123456789... HTTP/1.1
Authorization: Basic <base64(lookup_id:auth_password)>
Content-Type: application/json
If-Match: "<etag>"
```

```json
{
  "services": [
    {"id": "550e8400-e29b-41d4-a716-446655440000", "updated_at": 1715000000},
    {"id": null, "updated_at": 1715000200}
  ],
  "encrypted_blob": "<base64-encoded ciphertext>",
  "checksum": "<sha256-hex-of-encrypted-blob>"
}
```

**Response (200 OK):** Update accepted.
```json
{
  "services": [
    {"id": "550e8400-e29b-41d4-a716-446655440000", "updated_at": 1715000000},
    {"id": "newly-assigned-uuid-here", "updated_at": 1715000200}
  ],
  "checksum": "<sha256-hex-of-stored-blob>",
  "etag": "<new-etag>"
}
```

**Response (201 Created):** First sync for this user (same body format as 200).

**Response (409 Conflict):** ETag mismatch — another device pushed since your last GET.
```json
{"error": "conflict", "current_etag": "<server-etag>"}
```

**Response (422 Unprocessable Entity):** Validation failure.
```json
{"error": "validation failed", "detail": "<reason>"}
```

### ETag Semantics

- GET response includes `ETag` header (SHA-256 truncated to 16 bytes, hex-encoded).
- PUT requires `If-Match` header for existing records (optimistic locking).
- First PUT (no existing record): `If-Match` is not required.

---

## 4. Sync Algorithm (Client-Side Merge)

### Step 1: Fetch Remote State

```
GET /api/sync/:lookup_id
```

If 404: remote is empty. Skip to Step 5 (push all local services with `id: null`).

### Step 2: Validate Remote Integrity

1. Verify `checksum` matches SHA-256 of `encrypted_blob`.
2. Decrypt `encrypted_blob` using encryption key → plaintext JSON (services array).
3. Verify `len(metadata.services) == len(decrypted_services)`. **Mismatch → reject as corrupt.**
4. **Client-side metadata comparison (SHOULD):** Compare received metadata against locally cached metadata from last sync. Check for unexpected UUID drops, reordering, or timestamp rollbacks. Flag anomalies to the user.

### Step 3: Build Merge Sets

Inputs:
- **Local services:** Each has an optional `id` (UUID if previously synced, null if new) and `updated_at`.
- **Remote services:** Each has `id` (always UUID) and `updated_at`, plus decrypted content.

Build three sets:

| Set | Condition | Action |
|-----|-----------|--------|
| **Remote-only** | UUID exists in remote but not in local known-UUIDs | See Step 4 (deletion detection) |
| **Local-only** | Service has no UUID (never synced) | Include in push with `id: null` |
| **Both** | UUID exists in both local and remote | Merge by timestamp |

### Step 4: Resolve Each Set

**Remote-only (UUID in remote, not in local):**
- If the UUID is in the client's "known UUIDs" set (previously synced to this device): **it was deleted locally** → do NOT include in merged result (absence = deletion).
- If the UUID is NOT in the client's known set (new from another device): **add to local** → include in merged result.

**Local-only (no UUID):**
- Include in merged result with `id: null`. Server will assign UUID.

**Both (same UUID in local and remote):**
- Compare `updated_at`. **Higher timestamp wins.** Take that version's content.
- If timestamps are equal: **remote wins** (deterministic tie-breaking rule).

### Step 5: Build Push Payload

1. Construct merged services list (content array + metadata array, same order).
2. Build plaintext: JSON array of service objects `[{name, site, email, length, symbols, counter}, ...]`.
3. Encrypt plaintext with encryption key (AES-256-GCM) → `encrypted_blob`.
4. Compute SHA-256 of `encrypted_blob` → `checksum`.
5. Build PUT payload with `services` metadata array, `encrypted_blob`, `checksum`.

### Step 6: Push

```
PUT /api/sync/:lookup_id
If-Match: "<etag-from-GET>"
```

- **200/201:** Success. Update local state: store returned UUIDs for new services, update known-UUIDs set.
- **409 Conflict:** Another device pushed. Go to Step 1 (re-fetch and re-merge).

### Step 7: Update Local State

After successful push:
- Assign server-returned UUIDs to previously-null-ID services.
- Update the "known UUIDs" set to match the pushed set exactly.

---

## 5. Server Logic

### Storage Format

One JSON file per user at `<data_dir>/<lookup_id>.json`:

```json
{
  "auth_password_hash": "<bcrypt>",
  "services": [
    {"id": "uuid-1", "updated_at": 1715000000},
    {"id": "uuid-2", "updated_at": 1715000100}
  ],
  "encrypted_blob": "<base64>",
  "checksum": "<sha256-hex>",
  "etag": "<hex>",
  "version": 1,
  "created_at": "2025-05-01T00:00:00Z",
  "updated_at": "2025-05-09T00:00:00Z"
}
```

### UUID Assignment (PUT handler)

1. Parse request body.
2. Validate: `checksum` matches SHA-256 of decoded `encrypted_blob`.
3. For each entry in `services` where `id` is null: assign a new UUIDv4.
4. Store the record with all UUIDs assigned.
5. Return the final `services` array (with all UUIDs) and new ETag.

### ETag Computation

`ETag = hex(SHA-256(encrypted_blob)[:16])` — first 16 bytes of SHA-256 of the raw (decoded) blob.

### Concurrency Control

Per-lookup_id mutex (in-memory). Prevents concurrent writes to the same user file. The `If-Match` check happens inside the lock.

### Validation Rules (PUT)

| Check | Error |
|-------|-------|
| `checksum` matches blob | 422: checksum mismatch |
| All `id` values are valid UUIDv4 or null | 422: invalid id format |
| All `updated_at` are positive integers | 422: invalid timestamp |
| `services` array length ≤ 1000 | 422: too many services |
| Body size ≤ 1 MB | 413: payload too large |

---

## 6. Delete Handling

### Deletion Model

There are no tombstones. Deletion is expressed by **absence**: if a UUID that previously existed in the sync state is not present in a PUT, it is deleted.

### Client-Side "Known UUIDs" Set

Each client maintains a persistent set of UUIDs it has seen from the server. This set is updated:
- **After successful GET:** Add all UUIDs from the response.
- **After successful PUT:** Set = exactly the UUIDs in the server's response.

### Deletion Scenarios

**Local deletion (user deletes a service on Device A):**
1. Device A removes the service from its local list.
2. On next sync, Device A pushes without that UUID.
3. Server stores the new state (UUID absent = deleted).
4. Device B syncs: sees UUID in its known set but absent from server → deletes locally.

**Remote deletion detected (Device B syncs after Device A deleted):**
1. Device B fetches remote state.
2. UUID is in Device B's known set but NOT in remote metadata.
3. Device B removes the service locally and removes UUID from known set.

### Safety Guardrails (Client-Side)

- **Empty push protection:** Clients SHOULD warn the user (or refuse to push) if the merged services list is empty AND the remote was non-empty. This prevents accidental total deletion from bugs or corruption. The server does NOT enforce this — a legitimate "delete all" push is allowed.
- **Full load requirement:** Clients MUST fully load their local service list before initiating sync. Partial loads would cause unintended deletions.

---

## 7. Conflict Scenarios and Resolution

### Scenario 1: Same service edited on two devices

- Device A edits "GitHub" at t=100, Device B edits "GitHub" at t=200.
- Device B syncs first → server has t=200.
- Device A syncs: fetches remote (t=200), compares with local (t=100). Remote wins. Device A takes remote version.

### Scenario 2: Same service edited simultaneously (same timestamp)

- Both devices edit at t=100 (unlikely but possible with clock skew).
- First device to push wins (stored on server).
- Second device fetches, sees t=100 == t=100. **Remote wins** (deterministic tie-breaking). Second device takes remote version.
- **Mitigation:** Clients SHOULD use `max(now(), last_known_timestamp + 1)` to ensure monotonically increasing timestamps.

### Scenario 3: Concurrent pushes (ETag conflict)

- Device A and B both GET (same ETag), both merge locally, both PUT.
- First PUT succeeds. Second PUT gets 409 Conflict.
- Second device re-fetches (gets first device's changes), re-merges, re-pushes.

### Scenario 4: New service added on two devices simultaneously

- Device A adds "GitHub" (id: null), Device B adds "Twitter" (id: null).
- Device A pushes first → server assigns UUID-1 to "GitHub".
- Device B pushes → 409 (ETag mismatch).
- Device B re-fetches: sees "GitHub" with UUID-1 (new, not in known set → add it). Device B's "Twitter" remains id: null.
- Device B re-pushes with both services → server assigns UUID-2 to "Twitter".

### Scenario 5: One device deletes, another edits the same service

- Device A deletes "GitHub" (UUID-1). Device B edits "GitHub" (UUID-1, t=300).
- If Device A pushes first: UUID-1 absent from server.
  - Device B syncs: UUID-1 in known set, absent from remote → deleted. Device B's edit is lost.
- If Device B pushes first: UUID-1 present with t=300.
  - Device A syncs: UUID-1 in remote (t=300), not in local (deleted locally, UUID in known set). Local deletion wins (absence = deletion). Device A pushes without UUID-1.

**Resolution:** Delete always wins over edit when the deleting device pushes. This is the "absence = deletion" semantic. The last device to push determines the outcome.

**Known limitation:** This is order-dependent, not timestamp-based. A deletion at t=100 can override an edit at t=300 if the deleting device pushes last. This is inherent to the "absence = deletion" model (deletions have no timestamp). Clients SHOULD warn users when a sync would discard remote edits due to local deletion.

### Scenario 6: Clock skew causes wrong winner

- Device A's clock is 5 minutes ahead. Device A edits at t=300 (real time: t=100). Device B edits at t=200 (real time: t=200).
- Device A's version wins despite being older in real time.
- **Accepted limitation.** Documented in security considerations.

---

## 8. Migration from Old Backup API

### Data Migration (server-side)

For each existing `<lookup_id>.json` file:

1. Read the old record: `{auth_password_hash, encrypted_blob, etag, created_at, updated_at}`.
2. The encrypted blob contains the full service list but with NO metadata (no UUIDs, no timestamps).
3. Create new record:
   - `services`: One entry per service, all with server-assigned UUIDs and `updated_at` = file's `updated_at` timestamp (unix seconds).
   - `encrypted_blob`: Re-encrypt? **No.** The server cannot decrypt. Migration requires client participation.

### Client-Driven Migration

Since the server cannot decrypt blobs, migration is client-initiated:

1. Client detects old format (GET `/api/sync/:id` returns 404, but GET `/api/backup/:id` returns data).
2. Client fetches old blob from `/api/backup/:id`, decrypts it.
3. Client assigns `updated_at = now()` to each service, sets all `id: null`.
4. Client pushes to `/api/sync/:id` (new endpoint). Server assigns UUIDs.
5. Old `/api/backup/:id` data can be deleted (or left to expire).

### Endpoint Transition

- Deploy new `/api/sync/` endpoint alongside old `/api/backup/`.
- Clients updated to use `/api/sync/` first, fall back to `/api/backup/` for migration.
- After all clients are updated: remove `/api/backup/` endpoint.

---

## 9. Security Considerations

### Trust Model

| Entity | Trusted for | NOT trusted for |
|--------|-------------|-----------------|
| Server | Storage, UUID assignment | Content confidentiality, timestamp integrity |
| Client | Encryption, timestamps, merge logic | — |

### Threats and Mitigations

| Threat | Impact | Mitigation |
|--------|--------|-----------|
| Server reads service data | Confidentiality breach | AES-256-GCM encryption; server only sees metadata |
| Server tampers with metadata (reorder/drop) | Wrong UUIDs associated with services | Length check (detects drops/insertions); client-side metadata caching between syncs (detects reordering/rollback). Reordering by a malicious server is an accepted risk at the same trust level as data deletion. |
| Server forges timestamps | Wrong merge winner | Accepted risk; server is trusted for storage. Client could detect if it remembers its own timestamps. |
| Replay attack (server serves old state) | Data loss | ETag changes on every write; client detects stale ETag on push (409). However, a malicious server could serve old GET responses. Accepted risk (same as current design). |
| Clock skew between devices | Wrong merge winner | Monotonic timestamp recommendation. Accepted limitation. |
| Accidental mass deletion (client bug) | Data loss | Empty-push protection guardrail. |
| Brute-force auth | Account takeover | bcrypt (cost 12) + 32-char derived password. Rate limiting recommended. |
| Blob size analysis | Metadata leakage (number of services) | Metadata array length is already visible. Blob size adds no new information. |

### Encryption Specification

- Algorithm: AES-256-GCM
- Key: `HMAC-SHA256(secret, email + ":keygrain-encryption")`
- Nonce: Random 12 bytes, prepended to ciphertext
- Plaintext: JSON array of service objects `[{name, site, email, length, symbols, counter}, ...]`
- Ciphertext format: `nonce (12 bytes) || ciphertext || tag (16 bytes)`
- Base64-encoded for transport

### Client-Side Integrity Checks (SHOULD)

Clients SHOULD cache the metadata array locally after each successful sync and perform these checks on the next GET:

1. **UUID presence:** All UUIDs from the cached metadata should still be present (unless the client itself deleted them). Missing UUIDs that the client did not delete indicate server-side tampering or data loss.
2. **Order consistency:** The relative order of UUIDs should match the last-known order. Reordering indicates metadata tampering.
3. **Timestamp monotonicity:** For each UUID, `updated_at` should be ≥ the cached value. A decrease indicates rollback/replay.

If any check fails, the client SHOULD warn the user and allow them to decide whether to proceed with the sync.

---

## 10. Test Plan

### Unit Tests (Server)

| Test | Assertion |
|------|-----------|
| PUT new user (no If-Match) | 201, UUIDs assigned to all null IDs |
| PUT existing user (valid If-Match) | 200, UUIDs assigned only to null IDs |
| PUT with wrong If-Match | 409 with current_etag |
| PUT with invalid checksum | 422 |
| PUT with empty services array | 200/201 (legitimate delete-all) |
| PUT exceeding size limit | 413 |
| GET existing user | 200 with correct payload |
| GET non-existent user | 404 |
| GET/PUT with wrong auth | 401 |
| UUID assignment preserves existing IDs | Existing UUIDs unchanged in response |
| Concurrent PUTs (same user) | One succeeds, other gets 409 |

### Integration Tests (Client Sync Algorithm)

| Test | Setup | Expected |
|------|-------|----------|
| First sync (no remote) | Local has 3 services, remote 404 | Push all with id:null, get UUIDs back |
| Pull new services | Remote has services not in known set | Added to local |
| Local edit wins | Local t=200, remote t=100 | Local version in push |
| Remote edit wins | Local t=100, remote t=200 | Remote version kept |
| Local deletion | UUID in known set, removed locally | Absent from push |
| Remote deletion detected | UUID in known set, absent from remote | Removed from local |
| New service from other device | UUID NOT in known set, in remote | Added to local |
| ETag conflict retry | Simulate concurrent push | Re-fetch, re-merge, re-push succeeds |
| Metadata tampering detected (length) | Drop entry from metadata array | Client rejects with length mismatch error |
| Metadata cache detects reordering | Swap metadata entries between syncs | Client flags anomaly to user |
| Empty push blocked | Merged result empty, remote was non-empty | Client refuses to push |
| Clock skew monotonic fix | Timestamp would go backward | Client uses max(now, last+1) |

### Migration Tests

| Test | Assertion |
|------|-----------|
| Client detects old format | Sync 404 + backup 200 → triggers migration |
| Migration assigns timestamps | All services get current timestamp |
| Migration pushes to new endpoint | All services get UUIDs |
| Post-migration old endpoint unused | Client uses /api/sync/ exclusively |

### Security Tests

| Test | Assertion |
|------|-----------|
| Blob is opaque to server | Server cannot extract service names/content |
| Length check validation | Mismatched metadata/blob lengths rejected by client |
| Auth required for all endpoints | 401 without valid credentials |
| bcrypt timing | No timing difference between valid/invalid lookup_id |
