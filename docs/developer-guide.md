# Keygrain Developer Guide

How to build, test, deploy, and contribute to Keygrain.

## Prerequisites

| Tool | Version | Used for |
|------|---------|----------|
| Go | 1.22+ | Server |
| Python | 3.10+ | Core library, CLI, tests |
| JDK | 17 | Android app |
| Android SDK | Platform 34, Build-tools 34.0.0 | Android app |
| zip | any | Extension packaging |

## Repository Structure

```
python/          Python library + CLI + tests (reference implementation)
server/          Go sync server (sync API, rate limiting, static hosting)
kotlin/          Android app (Jetpack Compose, biometric, sync)
extension/       Browser extension (Chrome + Firefox, vanilla JS)
  shared/        Common extension code
  chrome/        Chrome-specific manifest + background
  firefox/       Firefox-specific manifest + background
  dist/          Build output (zips)
vectors.json     Cross-platform test vectors (all implementations must match)
docs/            User guides and design docs
designs/         Feature design documents
```

## Building Each Platform

### Python Library

```bash
cd python
pip install -e .        # installs keygrain + argon2-cffi dependency
pip install pytest      # test runner (not declared as a runtime dep)
```

### Browser Extension

```bash
cd extension
./build.sh
# Output: dist/keygrain-chrome.zip, dist/keygrain-firefox.zip
```

For development, load unpacked:
- **Chrome:** `chrome://extensions` → Enable Developer Mode → Load unpacked → select `extension/dist/chrome/`
- **Firefox:** `about:debugging` → This Firefox → Load Temporary Add-on → select `extension/dist/firefox/manifest.json`

### Server

```bash
cd server
go build -o keygrain-server .
```

Run locally:

```bash
./keygrain-server
# Serves on :9860, static files from ./static/, data in ./data/
```

### Android

```bash
cd kotlin
./gradlew assembleRelease
# Output: app/build/outputs/apk/release/app-release.apk
```

Requires Android SDK with `platforms;android-34` and `build-tools;34.0.0` installed. The release keystore is at `kotlin/release.keystore` (password: `keygrain`).

## Running Tests

### Python (20 tests — derivation + strengthening)

```bash
cd python
pytest tests/
```

This is the reference test suite. It validates against `vectors.json`.

### Server (sync + rate limiting)

```bash
cd server
go test ./...
```

### Android / Extension

No automated tests currently. Manual testing only.

## Server Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `9860` | HTTP listen port |
| `KEYGRAIN_DATA_DIR` | `./data` | Directory for sync data storage |
| `KEYGRAIN_RATE_LIMIT_ID_BURST` | `10` | Per-lookup-ID token bucket capacity |
| `KEYGRAIN_RATE_LIMIT_ID_RATE` | `2` | Per-lookup-ID refill rate (tokens/min) |
| `KEYGRAIN_RATE_LIMIT_IP_BURST` | `100` | Per-IP token bucket capacity |
| `KEYGRAIN_RATE_LIMIT_IP_RATE` | `100` | Per-IP refill rate (tokens/min) |
| `KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER` | `X-Real-IP` | Header for real client IP (behind proxy) |

## Development Workflow

1. Branch from `master`
2. Implement your change
3. Run tests for affected platforms
4. Push and open a merge request

For larger features, the project uses a 3-session pair workflow:
1. **Design session** — produce a design document in `designs/`
2. **Implementation session** — implement the design, unit by unit
3. **Code review session** — adversarial review, fix bugs, then merge

## Deployment

### CI/CD (automatic)

Push to `master` triggers the GitLab CI pipeline:

1. **build-package** — compiles Go binary (linux/amd64), packages with static files
2. **build-mobile** — builds Android APK (runs on master or kotlin/ changes)
3. **deploy** — SSHs to production, extracts tarball, runs `docker compose build && up -d`

CI variables required:
- `SSH_PRIVATE_KEY` — private key for SSH access to the server
- `SERVER_USER` — deploy user (default: `root`)
- `SERVER_IP` — production server IP

### Manual deployment

```bash
ssh root@keygrain.secbytech.com
cd /opt/keygrain
docker compose down
docker compose build
docker compose up -d
```

### Docker setup

The server uses a multi-stage Docker build (Go 1.22-alpine → alpine:3.21). Port 9860 is exposed to localhost only; nginx handles TLS termination and reverse proxying.

Data is persisted via a Docker volume (`keygrain_data` → `/app/data`).

## Adding a New Platform

To implement Keygrain on a new platform:

1. **Implement the algorithm:**
   - Argon2id strengthen: `Argon2id(secret, salt="keygrain-strengthen:" + lowercase(email), m=64MiB, t=3, p=1, len=32)`
   - HMAC-SHA256 derivation: `message = lowercase(site) + ":" + lowercase(email) + ":" + str(length) + ":" + str(counter)`
   - Key expansion: `key || HMAC-SHA256(key, 0x01) || HMAC-SHA256(key, 0x02) || ...`
   - Character selection: force one per category, fill remaining, Fisher-Yates shuffle

2. **Validate against `vectors.json`** at the repo root. Every test vector must produce identical output. This file contains both strengthen vectors and full derivation vectors.

3. **Match the Python reference implementation** in `python/keygrain/derive.py` for any edge cases not covered by vectors.

## Security Considerations for Contributors

- **Never log secrets.** Master secrets, strengthened keys, and derived passwords must never appear in logs, error messages, or debug output.
- **Constant-time comparison** for authentication values (auth_password in sync).
- **Argon2id parameters are fixed:** m=64MiB, t=3, p=1, len=32. Do not weaken these.
- **No plaintext secret storage.** Use platform-appropriate encrypted storage (EncryptedSharedPreferences on Android, browser extension encrypted storage, etc.).
- **Input normalization:** email is always lowercased, site is always lowercased in derivation. The `name` field is display-only and never enters derivation.
- Follow existing code style in each directory.
