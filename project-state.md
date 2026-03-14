# Keygrain — Project State

## Current Status: Feature-Complete (v1.0)

All planned features are implemented. Remaining work: store submissions (Chrome/Firefox), iOS app (requires Mac).

## Completed Features

### Core
- [x] Python library (pip-installable, stdlib + argon2-cffi)
- [x] Kotlin/Android app (Jetpack Compose, Material 3, biometric)
- [x] Cross-platform test vectors (8 vectors)
- [x] Argon2id key strengthening (optional, cached)

### Mobile App
- [x] Biometric unlock (fingerprint/face)
- [x] Service list with add/delete
- [x] Search/filter by name or email
- [x] Backup to server (AES-256-GCM encrypted)
- [x] Restore from server
- [x] Export/import as encrypted .keygrain file

### Web & Server
- [x] Backup API (PUT/GET /api/backup/:id, bcrypt auth)
- [x] Web generator (client-side JS, Web Crypto API)
- [x] Landing page with QR code download
- [x] Auto-deploy CI/CD (GitLab → Docker → nginx)
- [x] SSL (Let's Encrypt, auto-renewal)

### Browser Extension
- [x] Chrome Manifest V3
- [x] Firefox WebExtensions MV2
- [x] Popup UI (generate, fill, copy)
- [x] Content script autofill (React/Vue/Angular compat)
- [x] Keyboard shortcut (Ctrl+Shift+K)
- [x] Per-domain email memory
- [x] Build script for store submission

## Commit History

| Commit | Description |
|--------|-------------|
| 10c5398 | Python library (initial) |
| ca2771f | Android app (initial) |
| 1661694 | Server + deploy |
| 40dbb25 | Biometric + service list |
| 6630a50 | Backup API |
| d504689 | Mobile sync |
| 82e53f5 | Web generator |
| 1ac52f7 | Search/filter |
| 2e25adf | Export/import |
| a48a5ed | Argon2id strengthen |
| 724947c | Browser extension |

## Architecture

```
keygrain/
├── python/              # Python library + CLI
│   └── keygrain/        #   derive.py, cli.py, __init__.py
├── kotlin/              # Android app
│   └── app/src/main/java/com/badrani/keygrain/
│       ├── data/        #   Keygrain, ServiceManager, SyncManager, SyncCrypto, SecretManager
│       └── ui/          #   MainScreen (unlock → service list)
├── extension/           # Browser extension
│   ├── shared/          #   keygrain.js, popup.*, content.js, background.js
│   ├── chrome/          #   manifest.json (MV3)
│   └── firefox/         #   manifest.json (MV2)
├── server/              # Go backup server
│   ├── main.go, backup.go
│   ├── static/          #   Landing page, web generator, QR code
│   └── deploy/          #   setup-server.sh, deploy.sh, .env.template
├── designs/             # Design documents (5 docs)
├── vectors.json         # Cross-platform test vectors
├── SPEC.md              # Algorithm specification
├── ROADMAP.md           # Feature roadmap
└── .gitlab-ci.yml       # CI/CD pipeline
```

## Tech Stack

| Component | Stack |
|-----------|-------|
| Python lib | Python 3.10+, hmac/hashlib, argon2-cffi |
| Android app | Kotlin 1.9.22, Jetpack Compose, Material 3, Biometric, EncryptedSharedPreferences |
| Browser ext | Vanilla JS, Web Crypto API, Chrome MV3 / Firefox MV2 |
| Server | Go 1.22, stdlib + golang.org/x/crypto/bcrypt |
| Web generator | Vanilla JS, Web Crypto API |
| CI/CD | GitLab CI, Docker, auto-deploy on push |
| Hosting | keygrain.com, Let's Encrypt SSL |

## Pending (Not Blocked on Code)

- Chrome Web Store submission (needs $5 developer account)
- Firefox Add-ons submission (needs free account)
- iOS app (needs Mac + Apple Developer Program $99/year)

## Recently Completed (P0)

| Feature | Commit | Description |
|---------|--------|-------------|
| Web generator UX reorder | 91786c1 | Field order: email→secret→fingerprint→site, guidance text for new users |
| Web generator dark theme | 120e6c3 | CSS restyle to match landing page (dark bg, accent colors, 8px radii) |
| Modulo bias fix | 92a983a | Rejection sampling (spec v4), 4-byte counter, all platforms |
| Kotlin spec v4 parity | dd279cb | Rejection sampling + 4-byte counter in Kotlin |
| Doc fixes (spec/limitations) | da2cc26 | SPEC loop notation, ACCEPTED_LIMITATIONS §3/§6 resolved |
| Fingerprint + aria + test | ee5f7d3 | Dot border visibility, role=img, rejection boundary test |
| PyPI package prep | b1997fb | PEP 621 pyproject.toml, README, LICENSE, __main__.py |
| Extension store prep | 23de745 | Chrome/Firefox listings, permissions justification, privacy update |
| Bug hunt round 2 fixes | d3e2630 | Keystore removed, .gitignore fixed, PWA colors, README MV2 |
| Rate limiting | 16d3ace | Token bucket per lookup_id + per IP, 16 tests |
| Secret fingerprint | 57078de | 4 colored circles, Wong palette, all platforms |
| Progressive disclosure | e0a548c | details/summary for web, AnimatedVisibility for Android |

## Resolved (Not Bugs)

| Report | Resolution |
|--------|-----------|
| Web generator site field not affecting password | Not a bug. Site IS in derivation. User was observing fingerprint (which is intentionally site-independent). |

## Recently Completed (P1)

| Feature | Commit | Description |
|---------|--------|-------------|
| Error humanization | 6e3beba | UserMessages.kt, all platforms, no raw exceptions |
| Backup versioning/ETag | 43b3ae5 | SHA-256 ETag, If-Match, 412 conflict, 11 tests |
| Onboarding wizard | 557ec7b | 5-step wizard, skippable, crash-resilient |
