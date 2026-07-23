# Keygrain Sync API

API reference for the Keygrain sync server. This document covers the HTTP interface for developers building clients or integrating with the server.

## Base URL

```
http://localhost:9860
```

The server listens on port `9860` by default (configurable via `PORT` environment variable).

## Authentication

All `/api/sync/` endpoints require HTTP Basic authentication.

| Credential | Value |
|-----------|-------|
| Username | `lookup_id` |
| Password | `auth_password` |

Both are derived from the user's `secret` and `email`:

| Value | Derivation |
|-------|-----------|
| `lookup_id` | `hex(HMAC-SHA256(secret, email + ":keygrain-id"))` — 64 hex characters |
| `auth_password` | `derive_password_v1(secret, email, length=32, symbols=default, salt="keygrain-auth")` |

The server stores a bcrypt hash (cost 12) of the auth_password on first PUT. Subsequent requests are verified against this hash.

## Endpoints

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
  "checksum": "<sha256-hex-of-decoded-blob>"
}
```

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
