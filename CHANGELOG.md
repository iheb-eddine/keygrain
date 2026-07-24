# Changelog

All notable changes to Keygrain are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-07-24

First stable public release — Keygrain arrives on Google Play and PyPI. No
algorithm changes: derivation is unchanged (SPEC v4), so every password, code,
key, and seed is byte-identical to previous versions.

### Added

- **Android on Google Play**, targeting Android 16 (API 36) with 16 KB page-size support
- Android: offline mode, account switching, and in-app deletion of synced server data
- **Python CLI/library on PyPI** (`pip install keygrain`) via Trusted Publishing, with reproducible wheels and PEP 740 provenance attestations
- CLI: read-only sync download + local encrypted cache (retrieve passwords, TOTP, and SSH material)
- Extension: opt-in in-field autofill (inline icon + account dropdown on saved sites)
- Extension: TOTP one-time-code autofill across the inline dropdown, popup, keyboard shortcut, and context menu
- Server: auth-gated `DELETE /api/sync/:lookup_id` to erase your encrypted sync blob

### Changed

- Android application id renamed to `com.secbytech.keygrain`
- Extension: keyboard-shortcut discoverability tip and robust multi-account / subdomain matching

### Fixed

- Android: resolved an ANR (app-not-responding) case
- Extension: popup password fill now loads its autofill dependency correctly

> **Versioning note:** Public releases shipped on a 0.x line through v0.11.0 before
> this 1.0 launch. The 1.0.0–1.2.0 entries below are from the project's earlier
> internal development scheme and are retained as historical record.

## [1.2.0] - 2026-05-10

### Added

- TOTP support (RFC 6238): Model A (stored seeds) + Model B (deterministic derivation), all platforms
- SSH key derivation (Ed25519, CLI `--agent` flag), all platforms
- HD wallet derivation (BIP-39 mnemonics, BIP-85 child seeds, 9 chains), all platforms
- QR code scanning for TOTP setup (Android, ML Kit barcode scanning)
- Secret strength meter (extension)
- Extension onboarding (3-step overlay for first-time users)
- Wallet saved list + audit log UI
- In-app help (extension: 10 FAQ sections; Android: 9 FAQ sections)
- Modern UI redesign (extension: design tokens, SVG icons, card layout, gradient buttons)
- CI pipeline (Python tests, JS tests, extension build, mobile build)
- JS test suite (83 tests)
- Kotlin test suite (42 tests)
- SPEC.md §11–14 (TOTP Seed Derivation, SSH Key Derivation, HD Wallet Derivation, Domain Separation)

### Fixed

- Web generator: added Argon2id key strengthening, removed salt field
- Legacy storage key fallback for pre-Argon2id encrypted local data

### Security

- Argon2id rate limiting (2s client-side throttle on strengthen calls)

## [1.1.0] - 2026-05-09

### Added

- Sync v2 with per-service merge, server-assigned UUIDs, and E2E encryption
- Argon2id key strengthening (mandatory, 64 MiB / 3 iterations / parallelism 1)
- PIN unlock for browser extension
- Fuzzy search with frecency ranking
- Zero-click fill via global shortcut (Ctrl+Shift+K)
- Autofill username + password into page fields
- Background auto-sync
- Invisible sync (auto-triggers on unlock and service changes)
- Shadow migration mode (import from other password managers)
- Site Rules DB with Ed25519 signature verification
- Demo mode
- Bulk password rotation for breach response
- Auto-lock warning (60s before timeout)
- Secret confirmation on first setup
- Landing page with public threat model
- Breach warnings
- Dark mode
- Context menu fill
- Migration wizard

### Changed

- Counter hidden behind "Rotate password" flow

### Removed

- Global salt parameter from derivation
- Old /api/backup/ endpoint (replaced by /api/sync/)
- Migration code and fallback paths

### Fixed

- Site normalization stripping + mobile bugs
- CORS — missing host_permissions for backup server
- Crash on restore/backup
- Firefox manifest data_collection_permissions
- Extension zip structure

### Security

- Argon2id makes brute-force of master secret infeasible
- Ed25519 signed site rules prevent rule injection
- Metadata tamper detection in sync protocol

## [1.0.0] - 2026-05-07

### Added

- Deterministic password derivation (Python, JavaScript, Kotlin)
- Browser extension for Chrome and Firefox
- Android app with biometric unlock
- Backup/restore API
- Web generator PWA (offline-capable)
- Rate limiting on server endpoints
- Keyboard navigation
- Clipboard auto-clear (30s)
- ARIA labels and focus management for accessibility
