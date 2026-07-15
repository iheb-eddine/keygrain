# Keygrain Developer Guide

How to build, test, and contribute to the Keygrain clients.

> The hosted sync service is a separate, closed-source component. Its HTTP
> interface is fully documented in [API.md](../API.md) so any client can
> integrate with it. This guide covers the open-source clients only.

## Prerequisites

| Tool | Version | Used for |
|------|---------|----------|
| Python | 3.10+ | Core library, CLI, tests |
| JDK | 17 | Android app |
| Android SDK | Platform 34, Build-tools 34.0.0 | Android app |
| zip | any | Extension packaging |

## Repository Structure

```
python/          Python library + CLI + tests (reference implementation)
kotlin/          Android app (Jetpack Compose, biometric, sync)
extension/       Browser extension (Chrome + Firefox, vanilla JS)
  shared/        Common extension code
  chrome/        Chrome-specific manifest + background
  firefox/       Firefox-specific manifest + background
  dist/          Build output (zips)
web/             Web generator PWA (client-side, served at keygrain.com/generate)
vectors.json     Cross-platform test vectors (all implementations must match)
docs/            User guides and design docs
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

### Android

```bash
cd kotlin
./gradlew assembleRelease
# Output: app/build/outputs/apk/release/app-release.apk
```

Requires Android SDK with `platforms;android-34` and `build-tools;34.0.0` installed.
Release signing uses a keystore supplied at build time (a CI secret in the
release pipeline); local builds without it produce an unsigned APK.

## Running Tests

### Python (derivation + strengthening)

```bash
cd python
pytest tests/
```

This is the reference test suite. It validates against `vectors.json`.

### JavaScript (extension)

```bash
cd extension/tests
node test.mjs
node test-popup-modules.mjs
```

### Android / Kotlin

```bash
cd kotlin
./gradlew testReleaseUnitTest
```

## Development Workflow

1. Branch from `main`
2. Implement your change
3. Run tests for affected platforms
4. Push and open a merge/pull request

For larger features, the project uses a 3-session pair workflow:
1. **Design session** — produce a design document
2. **Implementation session** — implement the design, unit by unit
3. **Code review session** — adversarial review, fix bugs, then merge

## Adding a New Platform

To implement Keygrain on a new platform:

1. **Implement the algorithm:**
   - Argon2id strengthen: `Argon2id(secret, salt="keygrain-strengthen:" + lowercase(email), m=64MiB, t=3, p=1, len=32)`
   - HMAC-SHA256 derivation: `message = lowercase(site) + ":" + lowercase(email) + ":" + str(length) + ":" + str(counter)`
   - Key expansion: `key || HMAC-SHA256(key, 0x01) || HMAC-SHA256(key, 0x02) || ...`
   - Character selection: force one per category, fill remaining, Fisher-Yates shuffle

2. **Validate against `vectors.json`** at the repo root. Every test vector must produce identical output. This file contains both strengthen vectors and full derivation vectors.

3. **Match the Python reference implementation** in `python/keygrain/derive.py` for any edge cases not covered by vectors.

4. **To add sync**, implement the HTTP interface documented in [API.md](../API.md).

## Security Considerations for Contributors

- **Never log secrets.** Master secrets, strengthened keys, and derived passwords must never appear in logs, error messages, or debug output.
- **Constant-time comparison** for authentication values (auth_password in sync).
- **Argon2id parameters are fixed:** m=64MiB, t=3, p=1, len=32. Do not weaken these.
- **No plaintext secret storage.** Use platform-appropriate encrypted storage (EncryptedSharedPreferences on Android, browser extension encrypted storage, etc.).
- **Input normalization:** email is always lowercased, site is always lowercased in derivation. The `name` field is display-only and never enters derivation.
- Follow existing code style in each directory.
