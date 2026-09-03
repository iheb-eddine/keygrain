# Keygrain Sync API

API reference for the Keygrain sync server. This document covers the HTTP interface for developers building clients or integrating with the server.

## Base URL

```
https://keygrain.com
```

The server listens on port `9860` by default (configurable via `PORT` environment variable).
Use HTTPS for every non-loopback deployment. Plain HTTP is suitable only for an explicitly
local development server.

## Authentication

All `/api/sync/` endpoints require HTTP Basic authentication. The client derives both
credentials from the strengthened secret defined in `SPEC.md` §3 and §6:

| Credential | Derivation |
|-----------|------------|
| `lookup_id` | `hex(HMAC-SHA256(strengthened, UTF8(lowercase(email) + ":keygrain-id")))` — 64 lowercase hex characters |
| `auth_password` | `build_password(build_stream(strengthened, UTF8(lowercase(email) + ":32:keygrain-auth"), 256), 32, DEFAULT_SYMBOLS)` |

The server stores a bcrypt hash (cost 12) of the auth_password on first PUT. Subsequent requests are verified against this hash. The bcrypt hash is never sent over the wire; the client sends the derived `auth_password` in the HTTP Basic password field over HTTPS.

The complete byte-level algorithm and the `DEFAULT_SYMBOLS` value are normative in `SPEC.md` §6. Do not implement this contract as a raw-secret HMAC or as an undefined `derive_password_v1` function.

## KG-29 strict capability envelope (v3 contract; implementation pending)

This section freezes the public HTTP contract for the KG-29 immutable account-defaults
protocol. It documents a future strict capability rollout; it does **not** claim that the
current deployed server or any released client implements v3. The machine-readable contract
fixture is `sync-capability-vectors.json` and is covered by `.fixtures-checksum`.

### Legacy v2 and strict v3 envelopes

Legacy v2 remains the existing transport until a successful v2-to-v3 migration boundary:

| Shape | JSON request/body fields | HTTP response metadata |
|---|---|---|
| Legacy v2 PUT | `services`, `encrypted_blob`, `checksum`, optional `deleted_ids` | `ETag` header; 201/200 body contains `services`, `checksum`, and unquoted `etag` |
| Legacy v2 GET | — | `ETag` header; 200 body contains `version`, `services`, `encrypted_blob`, and `checksum` (no GET-body `etag`) |
| Strict v3 PUT | All v2 fields plus `payload_version`, `writer_protocol`, `capabilities`, `defaults_state`, and `defaults_commitment` | Quoted `ETag` header and a 200/201 body carrying the strict metadata and new `etag` |
| Strict v3 GET | — | Quoted `ETag` header and a 200 body carrying the strict metadata, including `generation` |

The exact strict capability token is **`account_defaults_immutable_v1`**. A strict writer
sends `payload_version: 3`, `writer_protocol: 3`, and the capability token in the
`capabilities` array. `writer_protocol` is an incoming **PUT request** field. In contrast,
`min_writer_protocol` is a **GET/record response** field describing the minimum writer
protocol accepted for that stored record; it is not a request-field alias and must not be
substituted for `writer_protocol`.

Strict response example (illustrative contract, not evidence of current runtime output):

```json
{
  "version": 1,
  "services": [{"id": "550e8400-e29b-41d4-a716-446655440000", "updated_at": 1715000000}],
  "encrypted_blob": "<base64-encoded ciphertext>",
  "checksum": "<sha256-hex-of-decoded-blob>",
  "payload_version": 3,
  "min_writer_protocol": 3,
  "capabilities": ["account_defaults_immutable_v1"],
  "defaults_state": "PRESENT",
  "defaults_commitment": "<lowercase 64-hex opaque commitment>",
  "generation": 1
}
```

`generation` is part of the frozen v3 response and ETag contract. The current server record
format retains generation internally, but its current GET/PUT response structs do not yet
expose the JSON field; that implementation exposure is a separate future unit. This document
must not be read as a deployment or strict-client support claim.

### Strict GET and PUT fields

For strict GET responses:

- `payload_version` is integer `3`, identifying the stored encrypted payload protocol.
- `min_writer_protocol` is integer `3`, identifying the minimum accepted PUT writer for the
  record. It is record metadata, not the request's `writer_protocol`.
- `capabilities` is the server-advertised capability set. The strict contract uses the exact
  singleton `["account_defaults_immutable_v1"]`.
- `defaults_state` is `UNSEALED`, `ABSENT`, or `PRESENT`.
- `defaults_commitment` is `null` for `UNSEALED` and `ABSENT`, or an opaque lowercase
  64-hex string for `PRESENT`.
- `generation` is an unsigned 64-bit generation used by the v3 ETag envelope. A new live
  record starts at 1; each accepted live PUT increments it once. A sealed deletion retains a
  tombstone generation, and recreation uses the next generation.

A strict PUT request must contain:

```json
{
  "services": [],
  "encrypted_blob": "<base64-encoded ciphertext>",
  "checksum": "<sha256-hex-of-decoded-blob>",
  "payload_version": 3,
  "writer_protocol": 3,
  "capabilities": ["account_defaults_immutable_v1"],
  "defaults_state": "UNSEALED",
  "defaults_commitment": null
}
```

For `PRESENT`, `defaults_commitment` is a JSON string matching `^[0-9a-f]{64}$`. It is
opaque server metadata: the server compares its exact bytes and never decrypts, parses, or
semantically validates the account-defaults object. The client computes the commitment from
the canonical four-field defaults value and must recompute and compare it after decryption.
The commitment must not contain the defaults plaintext, master secret, or a reversible encoding
of `length`, `symbols`, or `policy`. The server necessarily exposes only the lock state,
presence/absence, stable equality of the commitment, capability metadata, and generation
transitions.

A strict 201 response creates a new live record or recreates one from a sealed tombstone; a
strict 200 response updates an existing live record. Both return the new checksum, ETag,
strict capability metadata, lock tuple, and generation.
After sealing, every PUT must repeat the exact stored `defaults_state` and
`defaults_commitment`. A missing, changed, or contradictory tuple is rejected before record
replacement; it is not a defaults merge or timestamp conflict.

### Lock states, sealing, and tombstones

The lock state is established by the first accepted authenticated strict PUT whose `services`
metadata array is non-empty:

| State | Commitment | Meaning and allowed transition |
|---|---|---|
| `UNSEALED` | `null` | No non-empty strict service metadata has been accepted. Empty-service PUTs may keep it `UNSEALED` while the ETag advances. The first non-empty PUT changes it atomically to `ABSENT` or `PRESENT`. |
| `ABSENT` | `null` | The first non-empty strict service metadata write carried no defaults object. Absence is immutable; only the same `ABSENT`/`null` tuple is accepted thereafter. |
| `PRESENT` | lowercase 64-hex opaque value | The first non-empty strict service metadata write carried defaults. Only the same `PRESENT` commitment is accepted thereafter. |

The server seals from service metadata, not by inspecting encrypted plaintext. For `PRESENT`,
client-side validation must establish the relationship between the decrypted defaults value
and the commitment; opaque server equality alone cannot prove that relationship against a
malicious authenticated writer.

Deleting an unsealed record may permit a fresh unsealed creation. Deleting a sealed record
removes live ciphertext and service metadata but retains an authenticated opaque tombstone
with the bcrypt verifier, strict capability/minimum-writer metadata, sealed lock tuple, and
generation. The tombstone contains no live payload, plaintext, services, or service metadata.
An authenticated GET of a sealed tombstone remains a compatibility-safe 404.

A sealed tombstone is not an unauthenticated no-record first PUT. Only an authenticated exact
strict v3 PUT matching the retained lock tuple may recreate the live record; it uses no
`If-Match` because no live blob exists and receives a fresh generation and v3 ETag. A legacy,
non-strict, unauthenticated, or lock-mismatched PUT is rejected without creating a record.
Repeated DELETE does not erase or reset the sealed tombstone, commitment, or generation.

### ETags and the one-time v2-to-v3 boundary

Before migration, the v2 ETag remains the existing blob-only value:

```text
v2 ETag = lowercase_hex(SHA-256(B)[0:16])
B = decoded raw encrypted_blob bytes
```

For a live v2 record, the first authenticated strict v3 migration PUT may use the current v2
ETag exactly once. It must decrypt and validate the v2 payload, preserve its defaults value or
absence, atomically seed the strict lock, and return the v3 ETag. This is the only boundary
where a current v2 ETag is accepted for a strict write. After it succeeds, all PUTs require the
current v3 ETag and exact strict lock tuple. A v2 writer never writes a sealed v3 record.

The v3 ETag is the first 16 bytes of SHA-256 over this exact byte sequence, rendered as
lowercase 32-hex characters:

```text
E = UTF8("keygrain-sync-v3-etag\0")
    || U32BE(3)
    || U64BE(G)
    || U8(S)                         // UNSEALED=0, ABSENT=1, PRESENT=2
    || U32BE(len(C)) || C            // C is empty for UNSEALED/ABSENT
    || U64BE(len(B)) || B            // B is decoded raw encrypted_blob bytes
v3 ETag = lowercase_hex(SHA-256(E)[0:16])
```

There is no JSON serialization, implicit delimiter, platform string encoding, host-endian
integer, or blob-only variant in this calculation. For example, with `G=1`, state `PRESENT`,
commitment `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`, and UTF-8 blob
`opaque-encrypted-blob`, the v3 ETag is
`caec38fc7b2b7ff005a0f1be4bc3f36c`. The corresponding `UNSEALED` example is
`696c517f48aa4910e986cdf33fc3797f`. Both examples are in
`sync-capability-vectors.json`.

### Old-server transition and HTTP errors

During the old-server phase, absence of `payload_version`, `min_writer_protocol`, or
`capabilities` is positive legacy classification. It is not evidence of strict support and
must not be inferred from HTTP 200/201, a successful checksum, an ETag, or opaque storage.

- An ordinary authenticated no-default v2 account may continue the existing v2
  GET/merge/PUT/ETag/409 flow.
- A defaults-bearing account read from the old server is remote-sync read-only until strict
  support: no defaults PUT, service-only PUT, deletion PUT, attachment PUT, or retry PUT.
- `LEGACY_LOCAL_DEFAULTS_PENDING`—local defaults exist but the old server returns 404 or an
  authenticated empty/unsealed record before the first non-empty service sync—is likewise
  read-only for remote sync, including attachment and service-only writes. Defaults remain
  locally editable while pre-sync; attachment waits for strict capability.
- A new client never strips defaults to make an old-server PUT succeed, silently downgrades a
  sealed payload, or treats a successful old-server response as strict migration.
- On a strict server, any old writer missing the complete protocol-3 envelope is rejected with
  **HTTP 426 Upgrade Required before record replacement**. The client must not retry the same
  v2 shape. GET of a legacy v2 record remains available for the authenticated migration path.

The exact public error shapes are intentionally safe and contain no credentials, plaintext,
server internals, or defaults values:

**426 Upgrade Required — old writer against strict server**

```http
HTTP/1.1 426 Upgrade Required
Content-Type: application/json
```

```json
{"error":"upgrade required"}
```

**409 Conflict — stale or missing ETag on an existing live record**

```http
HTTP/1.1 409 Conflict
Content-Type: application/json
```

```json
{"error":"conflict","current_etag":"0123456789abcdef0123456789abcdef"}
```

Re-fetch and reconcile; do not overwrite using the stale ETag. The current ETag is a bounded
opaque token, not a secret or a substitute for lock validation.

**422 Unprocessable Entity — malformed or invalid payload**

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json
```

```json
{"error":"validation failed","detail":"checksum mismatch"}
```

The server must preserve the prior accepted record on validation failure. Other existing 422
details remain those listed in the PUT section below.

The strict contract is staged and independently testable; this documentation and fixture do
not claim strict v3 client support, deployment, release publication, or server enforcement.

## Endpoints

> Unless explicitly marked as strict v3 above, the endpoint examples and legacy ETag/first-PUT
> wording in the following sections describe the legacy v2 contract. In particular, the v2
> blob-only ETag and ordinary no-record creation rules do not override strict v3 lock,
> tombstone, generation, or 426 behavior.

### GET /api/sync/:lookup_id

Retrieve the current sync state for a user.

**Request:**

```http
GET /api/sync/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789 HTTP/1.1
Authorization: Basic <base64(lookup_id:auth_password)>
```

**Responses:**

#### 200 OK

```http
ETag: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
Content-Type: application/json
```

```json
{
  "version": 1,
  "services": [
    {"id": "550e8400-e29b-41d4-a716-446655440000", "updated_at": 1715000000},
    {"id": "6ba7b810-9dad-41d1-a0b4-00c04fd430c8", "updated_at": 1715000100}
  ],
  "encrypted_blob": "<base64-encoded ciphertext>",
  "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

Note: The response body includes a trailing newline after the JSON.

#### 404 Not Found

No sync state exists for this lookup_id.

```json
{"error":"not found"}
```

#### 401 Unauthorized

Missing, malformed, or incorrect credentials. Also returned if the username does not match the `:lookup_id` in the URL.

```json
{"error":"unauthorized"}
```

---

### PUT /api/sync/:lookup_id

Push a new sync state. The server assigns UUIDs to new services and returns the final metadata.

**Request:**

```http
PUT /api/sync/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789 HTTP/1.1
Authorization: Basic <base64(lookup_id:auth_password)>
Content-Type: application/json
If-Match: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
```

```json
{
  "services": [
    {"id": "550e8400-e29b-41d4-a716-446655440000", "updated_at": 1715000000},
    {"id": null, "updated_at": 1715000200}
  ],
  "encrypted_blob": "<base64-encoded ciphertext>",
  "checksum": "<sha256-hex-of-decoded-blob>",
  "deleted_ids": ["6ba7b810-9dad-41d1-a0b4-00c04fd430c8"]
}
```

**deleted_ids (optional):**

Declares which previously-stored service ids this push intends to remove. It is
validated but **never persisted** — the server stores no deletion records.

- **When present:** every currently-stored id absent from `services` MUST appear in
  `deleted_ids`, otherwise the push is rejected with 422 `undeclared service removal`.
  This makes an intentional deletion explicit and catches a client bug that silently
  drops a subset of services. A push with an empty `services` array is accepted when all
  stored ids are declared, so deleting your last service is legitimate.
- **When absent (legacy clients):** the older heuristic applies instead — a push with 0
  services against a non-empty record is rejected, and subset removals are accepted
  without declaration.
- Maximum 1000 entries; each must be a valid UUIDv4. Declaring an id the record does not
  hold is harmless (idempotent retry).

**If-Match header:**

- Required when updating an existing record. Omitting it returns 409.
- Not required for the first PUT (record does not exist yet).
- Value must be the ETag from the previous GET response (32 hex characters, double-quoted).
- `If-Match: *` is treated as absent — it does NOT bypass the ETag check. Sending `*` against an existing record returns 409.

**Responses:**

#### 201 Created

First sync for this user. The server creates the record and hashes the auth_password.

```http
ETag: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5"
Content-Type: application/json
```

```json
{
  "services": [
    {"id": "550e8400-e29b-41d4-a716-446655440000", "updated_at": 1715000000},
    {"id": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "updated_at": 1715000200}
  ],
  "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "etag": "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5"
}
```

#### 200 OK

Update accepted. Same body format as 201.

#### 409 Conflict

ETag mismatch — another client pushed since your last GET, or If-Match was omitted for an existing record.

```json
{"error":"conflict","current_etag":"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"}
```

The `current_etag` value is the server's current ETag. Re-fetch with GET to get the latest state.

#### 413 Payload Too Large

Request body exceeds 1 MB.

```json
{"error":"payload too large"}
```

#### 422 Unprocessable Entity

Validation failure. The `detail` field describes the specific issue.

```json
{"error":"validation failed","detail":"checksum mismatch"}
```

Possible `detail` values:

| Detail | Cause |
|--------|-------|
| `checksum mismatch` | SHA-256 of decoded `encrypted_blob` does not match `checksum` field |
| `invalid id format` | A service `id` is not null and not a valid UUIDv4 |
| `invalid timestamp` | A service `updated_at` is not a positive integer |
| `too many services` | `services` array exceeds 1000 entries |
| `invalid blob encoding` | `encrypted_blob` is not valid base64 |
| `undeclared service removal` | `deleted_ids` was sent, but a currently-stored id is absent from both `services` and `deleted_ids` |
| `too many deleted_ids` | `deleted_ids` array exceeds 1000 entries |
| `invalid deleted_ids format` | A `deleted_ids` entry is not a valid UUIDv4 |
| `cannot overwrite non-empty record with empty services` | Legacy path only (`deleted_ids` absent): 0-service push against a non-empty record |

#### 401 Unauthorized

Same as GET.

#### 400 Bad Request

```json
{"error":"invalid lookup_id"}
```
```json
{"error":"invalid json"}
```
```json
{"error":"invalid If-Match header"}
```

#### 405 Method Not Allowed

```json
{"error":"method not allowed"}
```

#### 500 Internal Server Error

Server-side failure (disk I/O, etc.). Clients should retry with backoff.

```json
{"error":"internal error"}
```

---

### DELETE /api/sync/:lookup_id

Permanently delete the stored sync state for a user. This erases **all** synced
configuration — services, wallets, TOTP seeds, and SSH keys — by removing the
single stored record. The operation is irreversible server-side.

**Request:**

```http
DELETE /api/sync/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789 HTTP/1.1
Authorization: Basic <base64(lookup_id:auth_password)>
```

No request body. Authentication is identical to GET/PUT: HTTP Basic where the
username MUST equal the `:lookup_id`, verified against the stored bcrypt hash.

**Responses:**

#### 200 OK

The record was removed.

```http
Content-Type: application/json
```

```json
{"status":"deleted"}
```

#### 404 Not Found

No record exists for this lookup_id. Also returned on a repeated delete of an
already-removed record. Clients SHOULD treat 404 as success ("already absent") —
deletion is idempotent in effect.

```json
{"error":"not found"}
```

#### 401 Unauthorized

Missing, malformed, or incorrect credentials, or the username does not match the
`:lookup_id`. The record (if any) is left unchanged.

```json
{"error":"unauthorized"}
```

#### 400 Bad Request

Malformed `:lookup_id` (not 64 hex characters).

```json
{"error":"invalid lookup_id"}
```

#### 429 Too Many Requests

Subject to the same dual token-bucket limits as GET/PUT (see [Rate Limiting](#rate-limiting)). Includes a `Retry-After` header.

```json
{"error":"rate limit exceeded","retry_after":30}
```

#### 500 Internal Server Error

Server-side failure (disk I/O, etc.). The record is left unchanged; clients should retry with backoff.

```json
{"error":"internal error"}
```

---

### GET /health

Simple health check. No authentication required.

**Request:**

```http
GET /health HTTP/1.1
```

**Response (200 OK):**

```json
{"status":"ok"}
```

## Data Formats

### Services Metadata

An array of objects with service identity and timestamp:

```json
[
  {"id": "550e8400-e29b-41d4-a716-446655440000", "updated_at": 1715000000},
  {"id": null, "updated_at": 1715000200}
]
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string \| null | UUIDv4 (server-assigned) or null for new services |
| `updated_at` | integer | Unix timestamp (seconds) of last modification. Must be > 0. |

### Encrypted Blob

Base64-encoded ciphertext containing the full service data. The server cannot read this — it stores and returns it opaquely.

Format: `base64(nonce [12 bytes] || ciphertext || GCM tag [16 bytes])`

Encryption: AES-256-GCM with key derived as `HMAC-SHA256(secret, email + ":keygrain-encryption")`.

### Checksum

SHA-256 hash of the **decoded** (raw bytes) encrypted blob, hex-encoded (64 characters).

```
checksum = hex(SHA-256(base64_decode(encrypted_blob)))
```

The server validates this on PUT to detect transport corruption.

## ETag Semantics

The ETag is derived from the stored blob:

```
ETag = hex(SHA-256(decoded_blob)[:16])
```

That is: the first 16 bytes of the SHA-256 hash of the raw blob, hex-encoded to 32 characters.

- The `ETag` response header is always double-quoted per HTTP spec: `ETag: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"`
- The `If-Match` request header must also be double-quoted: `If-Match: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"`
- The `etag` field in the PUT response body is the raw 32-character hex string (no quotes).

## UUID Assignment

When a PUT request includes services with `"id": null`, the server assigns a random UUIDv4 to each. Existing UUIDs are preserved unchanged.

The PUT response always returns the complete services array with all UUIDs assigned. Clients must store these UUIDs to track services across syncs.

## Rate Limiting

Two token-bucket rate limiters are applied to `/api/sync/` endpoints:

| Scope | Default Burst | Default Refill | Key |
|-------|--------------|----------------|-----|
| Per IP | 100 requests | 100/minute | Client IP (from `X-Real-IP` header or remote address) |
| Per lookup_id | 10 requests | 2/minute | The `:lookup_id` path parameter |

Both limits must pass. If either is exceeded:

**Response (429 Too Many Requests):**

```http
Retry-After: 30
Content-Type: application/json
```

```json
{"error":"rate limit exceeded","retry_after":30}
```

The `Retry-After` header and `retry_after` field indicate seconds to wait before retrying.

Rate limit defaults are configurable via environment variables:

| Variable | Default |
|----------|---------|
| `KEYGRAIN_RATE_LIMIT_ID_BURST` | 10 |
| `KEYGRAIN_RATE_LIMIT_ID_RATE` | 2 (per minute) |
| `KEYGRAIN_RATE_LIMIT_IP_BURST` | 100 |
| `KEYGRAIN_RATE_LIMIT_IP_RATE` | 100 (per minute) |

## Error Responses

All errors are JSON with `Content-Type: application/json`. Three shapes exist:

**Standard error:**
```json
{"error":"<message>"}
```

**Validation error (422):**
```json
{"error":"validation failed","detail":"<reason>"}
```

**Conflict error (409):**
```json
{"error":"conflict","current_etag":"<32-hex-chars>"}
```

**Rate limit error (429):**
```json
{"error":"rate limit exceeded","retry_after":<seconds>}
```

## Example Flows

### First Sync (new user)

```
1. GET /api/sync/:lookup_id
   → 404 Not Found (no existing data)

2. PUT /api/sync/:lookup_id
   (no If-Match header needed)
   Body: {services: [{id: null, updated_at: 1715000000}, ...], encrypted_blob: "...", checksum: "..."}
   → 201 Created
   Response: {services: [{id: "assigned-uuid", updated_at: 1715000000}, ...], checksum: "...", etag: "..."}

3. Client stores the assigned UUIDs and etag for future syncs.
```

### Subsequent Sync

```
1. GET /api/sync/:lookup_id
   → 200 OK (ETag: "abc123...")
   Response: {version: 1, services: [...], encrypted_blob: "...", checksum: "..."}

2. Client decrypts blob, merges with local state.

3. PUT /api/sync/:lookup_id
   If-Match: "abc123..."
   Body: {services: [...], encrypted_blob: "...", checksum: "..."}
   → 200 OK
   Response: {services: [...], checksum: "...", etag: "new-etag..."}
```

### Conflict Resolution

```
1. GET /api/sync/:lookup_id → 200 (ETag: "aaa...")
2. Another device pushes while you're merging.
3. PUT /api/sync/:lookup_id
   If-Match: "aaa..."
   → 409 Conflict {error: "conflict", current_etag: "bbb..."}

4. Re-fetch: GET /api/sync/:lookup_id → 200 (ETag: "bbb...")
5. Re-merge with the new remote state.
6. PUT /api/sync/:lookup_id
   If-Match: "bbb..."
   → 200 OK
```

### Delete Server Data

```
1. DELETE /api/sync/:lookup_id
   Authorization: Basic <base64(lookup_id:auth_password)>
   → 200 OK {status: "deleted"}

2. A repeated delete of the now-absent record:
   DELETE /api/sync/:lookup_id
   → 404 Not Found {error: "not found"}
   (Clients treat 404 as success — the record is already gone.)

3. Re-creating after a delete is a normal first sync:
   GET /api/sync/:lookup_id → 404
   PUT /api/sync/:lookup_id (no If-Match) → 201 Created
```
