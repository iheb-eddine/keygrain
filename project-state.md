# Keygrain — Project State

## Current Phase: 1 — Core Algorithm & Mobile App

## Phase Plan

### Phase 1: Core (current)
- [x] Update Python implementation to match revised SPEC
- [x] Regenerate test vectors (8 vectors)
- [x] Kotlin/Android app (derivation engine + single-screen UI)
- [x] Local config storage (EncryptedSharedPreferences)
- [x] Python package installable via pip

### Phase 2: Backup & Sync
- [ ] Server — PUT/GET /api/backup/:id
- [ ] Encrypted backup from mobile app
- [ ] Restore flow on new device
- [ ] Landing page / website

## Completed Units

| Unit | Commit | Description |
|------|--------|-------------|
| Python library | 10c5398 | keygrain package, revised algorithm, CLI, 9 tests |
| Android app | ca2771f | Kotlin derivation engine, Compose UI, encrypted secret storage |

## Open Decisions

- Server language (Go vs Python) — decide at Phase 2 start
- App distribution (APK sideload vs Play Store) — decide after testing

## Architecture

```
keygrain/
├── python/          # Python library + CLI
│   └── keygrain/
├── kotlin/          # Android app (Jetpack Compose)
│   └── app/
├── server/          # Backup server (Phase 2)
├── vectors.json     # Cross-platform test vectors (8 vectors)
├── SPEC.md          # Algorithm specification
└── project-state.md # This file
```

## Tech Stack

| Component | Stack |
|-----------|-------|
| Python lib | Python 3.10+, hmac/hashlib (stdlib only) |
| Android app | Kotlin 1.9.22, Jetpack Compose, Material 3, EncryptedSharedPreferences |
| Server | TBD (Phase 2) |
| Build (Android) | Gradle 8.7, compileSdk 34, minSdk 26 |
