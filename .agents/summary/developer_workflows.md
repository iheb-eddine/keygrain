# Developer Workflows

Step-by-step procedures for common development tasks in keygrain.

---

## 1. Adding a New Derivation Type

Example: adding a hypothetical "API key" derivation alongside existing password, TOTP, SSH, wallet types.

### Step 1: Define the Domain Separation Suffix

Choose a unique suffix that cannot collide with existing message formats (see SPEC.md §14):

```
Existing suffixes: :keygrain-id, :keygrain-auth, :keygrain-encryption,
                   :keygrain-totp, :keygrain-ssh, :keygrain-wallet
```

Your new suffix must be a non-numeric string distinct from all others (e.g., `:keygrain-apikey`).

### Step 2: Update SPEC.md

1. Add a new section (e.g., §15) with:
   - Formula: `message = UTF8_ENCODE(...)` showing the HMAC message construction
   - Parameters table with constraints
   - Test vectors (at least 3: base case, case-normalization pair, different-secret)
2. Update the §14 domain separation table with the new entry
3. Update `.spec-checksum`:
   ```bash
   sha256sum SPEC.md | cut -d' ' -f1 > .spec-checksum
   ```

### Step 3: Create Test Vectors

1. Implement the derivation in the Python reference implementation first (`python/keygrain/`)
2. Generate vectors using the reference implementation
3. Add a new vectors file at root (e.g., `apikey-vectors.json`) following the pattern of `totp-vectors.json`, `ssh-vectors.json`, `wallet-vectors.json`
4. If adding to the main `vectors.json`, update `.vectors-checksum`:
   ```bash
   sha256sum vectors.json | cut -d' ' -f1 > .vectors-checksum
   ```

### Step 4: Implement in Python (Reference)

1. Add derivation function in `python/keygrain/` (e.g., `derive_apikey()`)
2. Add tests in `python/tests/`
3. Run tests: `cd python && pytest -q`
4. Update `.test-baselines` if test count increased:
   ```
   python=<new_count>
   ```

### Step 5: Implement in JavaScript (Extension)

1. Add function in `extension/shared/keygrain.js`
2. Add tests in `extension/tests/`
3. Run tests: `cd extension/tests && node test.mjs`
4. Update `.test-baselines` (`js=<new_count>`) if test count increased

### Step 6: Implement in Kotlin (Android)

1. Add derivation in `kotlin/app/src/main/java/`
2. Add unit tests in `kotlin/app/src/test/`
3. Run tests: `cd kotlin && ./gradlew testReleaseUnitTest`
4. Update `.test-baselines` (`kotlin=<new_count>`) if test count increased

### Step 7: Implement in Go (Server, if needed)

1. Only needed if the server uses the derivation (e.g., auth-related)
2. Add to `server/` with `_test.go` file
3. Run tests: `cd server && go test ./...`
4. Update `.test-baselines` (`go=<new_count>`) if test count increased

### Step 8: Add Cross-Platform Verification (if applicable)

1. Add vector indices to `ci/cross-platform-derive.py` and `ci/cross-platform-derive.mjs`
2. Verify locally: `bash ci/cross-platform-check.sh`

### Step 9: CI Passes

Push and verify all CI stages pass:
- `checksum-gate` (checksums match)
- `test-python`, `test-js`, `test-go`, `test-cross-platform` (no regressions)
- `build-mobile` (Kotlin compiles)

---

## 2. Adding a Test Vector

### Step 1: Generate the Vector

Use the Python reference implementation to produce expected output:

```python
from keygrain.derive import derive_password  # or other derivation function
result = derive_password(b"my-secret", "user@example.com", site="example.com", length=20, symbols="!@#$%&*-_=+?", counter=1)
print(result)
```

### Step 2: Add to the Vectors File

Edit the appropriate JSON file at repo root:
- `vectors.json` — password derivation + strengthen + fingerprint
- `totp-vectors.json` — TOTP seed derivation
- `ssh-vectors.json` — SSH key derivation
- `wallet-vectors.json` — HD wallet derivation

Follow the existing format (include `secret_hex`, `secret_utf8`, `_note`, etc.).

### Step 3: Update Checksums

```bash
sha256sum vectors.json | cut -d' ' -f1 > .vectors-checksum
```

Only needed if you modified `vectors.json`. Other vector files (`totp-vectors.json`, etc.) are not checksum-gated.

### Step 4: Update Test Baselines

If you added test cases to any platform's test suite, update `.test-baselines`:

```
python=128
js=85
kotlin=42
go=37
```

Increment the count for each platform where you added tests. The CI enforces `actual >= baseline` — regressions fail the pipeline.

### Step 5: Update SPEC.md (if applicable)

If the vector demonstrates a new edge case worth documenting, add it to the relevant §8.x table and update `.spec-checksum`:

```bash
sha256sum SPEC.md | cut -d' ' -f1 > .spec-checksum
```

### Step 6: Verify Cross-Platform

If the vector was added to `vectors.json`, update the index lists in `ci/cross-platform-check.sh` (and the corresponding `.py`/`.mjs` scripts) if needed, then run:

```bash
bash ci/cross-platform-check.sh
```

---

## 3. Modifying the Sync Protocol

### Step 1: Update the Server (Go)

1. Edit `server/sync.go` — the sync handler supports GET, PUT, DELETE on `/api/sync/:lookup_id`
2. Key structures: `syncRecord` (persisted JSON), request/response body format
3. ETag-based optimistic concurrency: `computeETag()`, `parseIfMatch()`
4. Update `server/sync_test.go` with tests for the new behavior
5. Run: `cd server && go test ./...`

### Step 2: Update API.md

Document the changed endpoint behavior, request/response format, and new status codes.

### Step 3: Update the Browser Extension Client

1. Edit `extension/shared/keygrain.js` — sync functions (`syncPull`, `syncPush`, merge logic)
2. The extension uses HTTP Basic auth with `lookup_id:auth_password`
3. Merge strategy: per-service by UUID, latest `updated_at` wins
4. Handle new server responses/errors in the UI layer

### Step 4: Update the Kotlin (Android) Client

1. Edit the sync implementation in `kotlin/app/src/main/java/`
2. Mirror the same merge logic and error handling as the extension
3. Test: `cd kotlin && ./gradlew testReleaseUnitTest`

### Step 5: Backward Compatibility

- If the change breaks existing clients, consider versioning the endpoint (e.g., `/api/sync/v2/`)
- The `version` field in the sync response can signal format changes
- Existing clients that see an unknown version should refuse to merge (fail-safe)

### Step 6: Test End-to-End

1. Run the server locally: `cd server && go run .`
2. Test with the extension (load unpacked in Chrome/Firefox)
3. Verify merge behavior: create services on two clients, sync both, confirm convergence

---

## 4. Adding a New Platform Implementation

### Step 1: Understand the Algorithm

Read SPEC.md completely. Your implementation must produce byte-identical output to the Python reference for all vectors in `vectors.json`.

Critical implementation details:
- Argon2id: memory=65536 KiB, iterations=3, parallelism=1, output=32 bytes
- Salt: `UTF-8("keygrain-strengthen:" + lowercase(email))`
- HMAC-SHA256 for key derivation and stream extension
- 4-byte big-endian counter for stream extension
- Rejection sampling: `limit = floor(256/n) * n`, discard bytes >= limit
- Fisher-Yates shuffle (descending, using `unbiased_index(i+1)`)
- Character sets exclude ambiguous chars: no I, O (upper), no i, l, o (lower), no 0, 1 (digits)

### Step 2: Implement Core Derivation

Implement in order:
1. `strengthen(secret, email)` → 32 bytes (Argon2id)
2. `derive_password(secret, email, site, length, symbols, counter)` → string
3. Test against all 9 vectors in `vectors.json`

### Step 3: Implement Additional Derivations (as needed)

- Fingerprint: `HMAC-SHA256(raw_secret, "keygrain-fingerprint")` — first 4 bytes mod 8
- Auth: lookup_id, auth_password, encryption_key (see SPEC.md §6)
- TOTP: `HMAC-SHA256(strengthened, site:email:keygrain-totp)` (see §11)
- SSH: `HMAC-SHA256(strengthened, email:key_name:counter:keygrain-ssh)` (see §12)
- Wallet: `HMAC-SHA256(strengthened, email:wallet_name:chain:counter:keygrain-wallet)` (see §13)

### Step 4: Add to CI

1. Add a test job in `.gitlab-ci.yml` following the pattern of existing jobs
2. Include baseline enforcement:
   ```yaml
   ACTUAL_COUNT=<count tests>
   BASELINE=$(grep '^<platform>=' ../.test-baselines | cut -d= -f2)
   if [ "$ACTUAL_COUNT" -lt "$BASELINE" ]; then exit 1; fi
   ```
3. Add entry to `.test-baselines`: `<platform>=<count>`

### Step 5: Add to Cross-Platform Check (optional but recommended)

1. Write a script `ci/cross-platform-derive.<ext>` that:
   - Accepts vector indices as CLI arguments
   - Derives passwords for those indices
   - Prints one password per line to stdout
2. Update `ci/cross-platform-check.sh` to include your new platform

### Step 6: Verify

```bash
# Run your platform's tests
# Run cross-platform check
bash ci/cross-platform-check.sh
# Push and verify full CI passes
```

---

## 5. Deploying the Server

### Prerequisites

- SSH access to the production server (configured via `SERVER_USER`, `SERVER_IP`)
- SSL certificate auto-managed via Let's Encrypt (certbot)
- Docker installed on server

### Automatic Deployment (CI — push to master)

1. Push to `master` branch
2. CI runs `build-package`: compiles Go binary, packages with Docker files into `keygrain.tar.gz`
3. CI runs `deploy` stage:
   - SCPs tarball + deploy scripts to server
   - Runs `setup-server.sh` (idempotent: installs nginx/certbot/docker, configures SSL)
   - Runs `deploy.sh` (stops container, extracts new files, `docker compose build && up -d`)
   - Copies APK to `static/app/` if build-mobile produced one
   - Verifies container is running: `docker ps | grep keygrain`

### Manual Deployment

```bash
# On development machine:
cd server
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o keygrain-server .
tar -czf keygrain.tar.gz keygrain-server static/ Dockerfile docker-compose.yml deploy/

# Transfer to server:
scp keygrain.tar.gz user@server:/tmp/keygrain.tar.gz
scp server/deploy/setup-server.sh user@server:/tmp/keygrain-setup.sh
scp server/deploy/deploy.sh user@server:/tmp/keygrain-deploy.sh

# On server:
chmod +x /tmp/keygrain-setup.sh /tmp/keygrain-deploy.sh
DOMAIN=keygrain.com /tmp/keygrain-setup.sh  # first time only
/tmp/keygrain-deploy.sh
```

### Server Configuration

Config lives at `/opt/keygrain/.env` on the server:

```env
DOMAIN=keygrain.com
APP_PORT=9860
APP_DIR=/opt/keygrain
CERTBOT_EMAIL=admin@keygrain.com
KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER=X-Real-IP
```

### What `setup-server.sh` Does (idempotent)

1. Installs nginx, certbot, docker (if missing)
2. Creates `/opt/keygrain/data/` and `/opt/keygrain/static/app/`
3. Writes `.env` config
4. Obtains/renews Let's Encrypt certificate via webroot challenge
5. Configures nginx reverse proxy (HTTP→HTTPS, proxy to port 9860)
6. Enables certbot auto-renewal timer

### What `deploy.sh` Does

1. Reads config from `/opt/keygrain/.env`
2. Extracts tarball to temp directory
3. Stops running container (`docker compose down`)
4. Copies new files to `/opt/keygrain/` (preserves `.env` and data volume)
5. Builds and starts container (`docker compose build && up -d`)
6. Removes Go source files (only Docker image needs them at build time)
7. Reloads nginx

### Rollback

The Docker volume `keygrain_data` persists user data. To rollback:
1. Keep a copy of the previous `keygrain.tar.gz`
2. Re-deploy the old tarball: `cp old-keygrain.tar.gz /tmp/keygrain.tar.gz && /tmp/keygrain-deploy.sh`

### Verification

```bash
# On server:
docker ps | grep keygrain           # Container running
curl -s http://localhost:9860/       # Server responds
curl -s https://keygrain.com/       # Public endpoint works
```
