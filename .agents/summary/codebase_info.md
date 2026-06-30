# Keygrain — Codebase Information

## Project Identity

- **Name:** Keygrain
- **Purpose:** Deterministic password, SSH key, TOTP seed, and HD wallet derivation from a master secret
- **Author:** Iheb Eddine Badrani
- **License:** MIT
- **Homepage:** https://keygrain.com
- **Repository:** https://github.com/iheb-eddine/keygrain

## Languages and Platforms

| Platform | Language | Directory | Purpose |
|----------|----------|-----------|---------|
| Core library + CLI | Python 3.10+ | `python/` | Reference implementation, pip-installable |
| Android app | Kotlin 1.9.22 | `kotlin/` | Biometric unlock, Compose UI, sync |
| Browser extension (Chrome) | JavaScript (Vanilla) | `extension/chrome/` + `extension/shared/` | MV3, service worker background |
| Browser extension (Firefox) | JavaScript (Vanilla) | `extension/firefox/` + `extension/shared/` | MV2, background scripts |
| Sync server | Go 1.22 | `server/` | API, rate limiting, static hosting |
| Web generator | JavaScript | `server/static/generate/` | Client-side PWA, offline-capable |

## Algorithm Version

Spec v4 — rejection sampling with 4-byte big-endian counter. Authoritative spec: `SPEC.md`.

## Test Infrastructure

| Platform | Baseline | Runner |
|----------|----------|--------|
| Python | 128 tests | pytest |
| JavaScript | 85 tests | Custom Node.js runner (`test.mjs`) |
| Kotlin | 42 tests | JUnit 4 via Gradle |
| Go | 37 tests | `go test` |

Cross-platform vectors validated by CI: `ci/cross-platform-check.sh` runs both Python and Node.js derivation, comparing outputs.

## CI/CD Pipeline (GitLab CI)

Stages: `test` → `build` → `build-mobile` → `deploy`

Key jobs:
- `checksum-gate`: SHA-256 verify `vectors.json` and `SPEC.md` against `.vectors-checksum` / `.spec-checksum`
- `test-python`, `test-js`, `test-js-slow`, `test-cross-platform`, `test-go`: Baseline enforcement
- `build-extension`: Produces Chrome/Firefox zips
- `build-package`: Go binary + Docker artifacts (master only)
- `build-mobile`: Android APK with unit tests (master or kotlin/** changes)
- `deploy`: SSH to production, Docker restart (master only)

## Hosting

- Domain: keygrain.com
- Server: Go binary behind nginx reverse proxy
- Deployment: Docker container, auto-deployed from master via GitLab CI
- SSL: Let's Encrypt auto-renewal
