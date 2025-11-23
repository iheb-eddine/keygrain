# Keygrain Backup API — Design Document

## 1. Overview

The backup API provides two HTTP endpoints that allow keygrain clients to store and retrieve encrypted configuration blobs. This enables cross-device sync and backup/restore without accounts or email verification — the master secret is the sole proof of identity.

The server never sees plaintext config data. It stores an opaque encrypted blob keyed by a deterministic lookup ID derived from the user's secret + email.

## 2. Interface Contracts

### Endpoints

#### `PUT /api/backup/:lookup_id`

Stores (or overwrites) an encrypted config blob.

**Request:**
- Path parameter: `lookup_id` — must match `^[0-9a-f]{64}$` (HMAC-SHA256 hex output). Reject with 400 otherwise.
- Auth: HTTP Basic — username = `lookup_id`, password = `auth_password`
- Content-Type: `application/octet-stream`
- Body: raw encrypted blob bytes (AES-256-GCM ciphertext)
- Max body size: 1 MB

**Response:**
- First write (no existing record): `201 Created` with body `{"status":"created"}`
- Subsequent write (record exists, auth passes): `200 OK` with body `{"status":"updated"}`
- Content-Type: `application/json`

**Errors:**
| Status | Condition |
|--------|-----------|
| 400 | Invalid lookup_id format |
| 400 | Empty body |
| 401 | Auth password does not match stored hash |
| 413 | Body exceeds 1 MB |
| 405 | Method not PUT or GET |
| 500 | Disk write failure |

#### `GET /api/backup/:lookup_id`

Retrieves the stored encrypted blob.

**Request:**
- Path parameter: `lookup_id` — must match `^[0-9a-f]{64}$`
- Auth: HTTP Basic — username = `lookup_id`, password = `auth_password`

**Response:**
- `200 OK` with Content-Type `application/octet-stream`
- Body: raw encrypted blob bytes

**Errors:**
| Status | Condition |
|--------|-----------|
| 400 | Invalid lookup_id format |
| 401 | Auth password does not match stored hash |
| 404 | No record for this lookup_id |
| 405 | Method not PUT or GET |

### Handler Signatures

```go
// backupHandler routes PUT/GET to the appropriate sub-handler.
// Registered as: mux.HandleFunc("/api/backup/", backupHandler)
func backupHandler(w http.ResponseWriter, r *http.Request)

// handlePut stores or updates the encrypted blob.
func handlePut(w http.ResponseWriter, r *http.Request, lookupID string)

// handleGet retrieves the encrypted blob.
func handleGet(w http.ResponseWriter, r *http.Request, lookupID string)
```

### Auth Flow

1. Extract Basic auth credentials from request
2. Validate that username == lookup_id from path (reject with 401 if mismatch)
3. **PUT (first time):** No existing record → bcrypt-hash the auth_password, store record
4. **PUT (subsequent) / GET:** Load record → `bcrypt.CompareHashAndPassword(stored_hash, auth_password)` → reject with 401 on mismatch

## 3. Storage Format

### Directory Layout

```
data/
  <lookup_id>.json
  <lookup_id>.json
  ...
```

The `data/` directory is relative to the server working directory. Created on first write if it doesn't exist.

### Record Schema

```json
{
  "auth_password_hash": "$2a$12$...",
  "encrypted_blob": "<base64-encoded AES-256-GCM ciphertext>",
  "created_at": "2026-05-07T01:00:00Z",
  "updated_at": "2026-05-07T01:30:00Z"
}
```

- `auth_password_hash`: bcrypt hash (cost=12) of the auth_password
- `encrypted_blob`: base64 (standard encoding) of the raw ciphertext bytes received from the client
- `created_at`: RFC 3339 timestamp of first PUT
- `updated_at`: RFC 3339 timestamp of most recent PUT

### Encoding

- Client sends/receives raw bytes over HTTP
- Server base64-encodes for JSON storage, base64-decodes for GET responses

## 4. Edge Cases

| Scenario | Handling |
|----------|----------|
| Concurrent PUTs for same lookup_id | In-memory `sync.Mutex` per lookup_id prevents corrupt writes. Second request blocks until first completes. |
| PUT with empty body | 400 Bad Request — blob must be non-empty |
| PUT body exceeds 1 MB | 413 Payload Too Large — enforced via `http.MaxBytesReader` |
| GET for non-existent lookup_id | 404 Not Found |
| Malformed lookup_id (not 64 hex chars) | 400 Bad Request before any file I/O |
| Basic auth missing | 401 Unauthorized |
| Basic auth username ≠ path lookup_id | 401 Unauthorized (prevents using one user's auth to write another's record) |
| Disk full on PUT | 500 Internal Server Error — write to temp file + rename for atomicity; if rename fails, temp file is cleaned up |
| Data directory missing | Created automatically on first PUT (`os.MkdirAll`) |
| Corrupted JSON file on disk | 500 Internal Server Error — log the error, return generic failure |

### Atomic Writes

To prevent partial writes on crash:
1. Write to `data/<lookup_id>.json.tmp`
2. `os.Rename` to `data/<lookup_id>.json`

This ensures the file is either fully old or fully new.

## 5. Test Plan

### Unit Tests

| Test | What it verifies |
|------|-----------------|
| `TestPut_NewRecord` | First PUT returns 201, creates file with correct schema |
| `TestPut_UpdateRecord` | Second PUT returns 200, updates blob and updated_at |
| `TestPut_WrongPassword` | PUT with wrong auth returns 401, does not modify file |
| `TestPut_EmptyBody` | Returns 400 |
| `TestPut_OversizedBody` | Returns 413 |
| `TestPut_InvalidLookupID` | Non-hex, wrong length → 400 |
| `TestPut_UsernameMismatch` | Basic auth username ≠ path ID → 401 |
| `TestGet_ExistingRecord` | Returns 200 with correct raw bytes |
| `TestGet_WrongPassword` | Returns 401 |
| `TestGet_NotFound` | Returns 404 |
| `TestGet_InvalidLookupID` | Returns 400 |
| `TestConcurrentPuts` | Two goroutines PUT simultaneously — no corruption |

### Integration Tests

| Test | What it verifies |
|------|-----------------|
| `TestFullFlow` | PUT → GET → verify blob matches |
| `TestImplicitRegistration` | First PUT creates record, subsequent GETs work |
| `TestOverwrite` | PUT new blob → GET returns new blob, not old |

### Test Approach

- Use `httptest.NewServer` for handler tests
- Use `t.TempDir()` for isolated file storage per test
- Inject the data directory path via a config struct or function parameter (not hardcoded)

## 6. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| **Path traversal** | Strict `^[0-9a-f]{64}$` validation on lookup_id before any file operation. No user input in file paths beyond this validated hex string. |
| **Timing attacks on auth** | `bcrypt.CompareHashAndPassword` is constant-time. For non-existent records on GET, return 404 (no auth comparison needed). |
| **Bcrypt cost** | Cost=12 (~250ms). Provides brute-force resistance while keeping latency acceptable. |
| **Blob size DoS** | `http.MaxBytesReader` enforces 1 MB limit before reading body into memory. |
| **No plaintext secrets on server** | Server stores only: lookup_id (derived), bcrypt hash (one-way), encrypted blob (opaque). Master secret and encryption key never leave the client. |
| **Credential stuffing** | Out of scope for this design. Future consideration: rate limiting per IP. |
| **TLS** | Required in production. Assumed to be handled by reverse proxy (nginx/caddy). Server itself listens on plain HTTP. |
| **File permissions** | Data directory should be created with 0700. JSON files with 0600. |

## 7. Integration

### Registration in main.go

```go
mux.HandleFunc("/api/backup/", backupHandler)
```

The handler extracts the lookup_id from the URL path suffix after `/api/backup/`.

### Dependencies

- `golang.org/x/crypto/bcrypt` — for password hashing (only external dependency)
- Standard library: `net/http`, `encoding/json`, `encoding/base64`, `os`, `sync`, `path/filepath`, `regexp`, `time`, `io`

### Configuration

The data directory path should be configurable via environment variable:

```
KEYGRAIN_DATA_DIR=./data  (default)
```

### Server Startup

On startup, the server should:
1. Resolve `KEYGRAIN_DATA_DIR` (default `./data`)
2. Create the directory if it doesn't exist
3. Initialize the mutex map
4. Register the handler

## 8. Open Questions

1. **DELETE endpoint** — Should users be able to delete their backup? The spec doesn't mention it, but it's a natural extension. If added: `DELETE /api/backup/:lookup_id` with same auth, returns 204 No Content.

2. **Last-Modified / ETag** — Should GET return a Last-Modified header so clients can skip re-downloading unchanged blobs? Low priority but cheap to implement (use `updated_at`).

3. **Blob versioning** — Should the server keep previous versions of the blob, or is overwrite-only sufficient? Current design: overwrite-only (simplest, matches spec).

4. **Rate limiting** — Not in scope, but at what point should it be added? Likely when the server is exposed to the internet without IP-based restrictions.

5. **Mutex map growth** — The in-memory mutex map grows unbounded (one entry per unique lookup_id that has been accessed). For a personal-use server this is fine. For larger scale, consider an LRU eviction or sharded lock approach.
