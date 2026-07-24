# Changelog

All notable changes to Keygrain, documented per component. **This file is generated from the per-component release notes — do not edit it by hand.**

Format based on [Keep a Changelog](https://keepachangelog.com/). Components are versioned independently. No algorithm change ever alters derivation output (SPEC v4 is checksum-gated).

## Chrome extension

### [1.1.0] - 2026-07-24

The biggest Keygrain update yet: autofill, one-time codes, and full control over your
account and synced data.

#### Autofill & 2FA
- **In-field autofill** — an opt-in inline icon and account dropdown on your saved
  sites, so you can fill credentials in place.
- **TOTP one-time codes** — fill 2FA codes from the inline dropdown, the popup, the
  keyboard shortcut, or the right-click menu. No separate authenticator app.
- Smarter matching across multiple accounts and subdomains, plus a discoverability tip
  for the fill shortcut.

#### Account & data control
- **Switch account** — use a different master secret / email without a full reset,
  from the menu or the lock screen.
- **Offline mode** — use Keygrain without syncing; turn sync back on anytime.
- **Delete synced data** — remove your encrypted blob from the sync server, with an
  option to keep a local copy on this device.

#### Fixed
- Popup password fill now loads its autofill dependency reliably.
- Clearer lock-screen message when the entered secret/email doesn't match this
  device's account.
- Removed the misleading "clears in 30 seconds" clipboard message.

No algorithm changes — every password, code, key, and seed is byte-identical to before
(SPEC v4).

## Firefox extension

### [1.1.0] - 2026-07-24

The biggest Keygrain update yet: autofill, one-time codes, and full control over your
account and synced data.

#### Autofill & 2FA
- **In-field autofill** — an opt-in inline icon and account dropdown on your saved
  sites, so you can fill credentials in place.
- **TOTP one-time codes** — fill 2FA codes from the inline dropdown, the popup, the
  keyboard shortcut, or the right-click menu. No separate authenticator app.
- Smarter matching across multiple accounts and subdomains, plus a discoverability tip
  for the fill shortcut.

#### Account & data control
- **Switch account** — use a different master secret / email without a full reset,
  from the menu or the lock screen.
- **Offline mode** — use Keygrain without syncing; turn sync back on anytime.
- **Delete synced data** — remove your encrypted blob from the sync server, with an
  option to keep a local copy on this device.

#### Fixed
- Popup password fill now loads its autofill dependency reliably.
- Clearer lock-screen message when the entered secret/email doesn't match this
  device's account.
- Removed the misleading "clears in 30 seconds" clipboard message.

No algorithm changes — every password, code, key, and seed is byte-identical to before
(SPEC v4).

## Android app

### [1.0.0] - 2026-07-24

Keygrain arrives on Google Play. One master secret derives every password, TOTP code,
SSH key, and wallet seed — no vault, nothing stored.

#### New
- **On Google Play** — targeting Android 16 (API 36), with 16 KB page-size support.
- **Offline mode** — derive without a network connection.
- **Switch account** — move between identities in the app.
- **Delete server data** — remove your synced blob from within the app.

#### Fixed
- Resolved an ANR (app-not-responding) case.

#### Note
The app's package id is `com.secbytech.keygrain`. If you previously sideloaded an older
build (`com.badrani.keygrain`), uninstall it — the Play build installs as a separate
app. Your data is safe: sync is keyed by your derived identifier, so re-entering your
master secret restores everything; only device-local settings reset.

No algorithm changes — every password, code, key, and seed is byte-identical to before
(SPEC v4).

## Python CLI

### [1.0.0] - 2026-07-24

Keygrain is now on PyPI: `pip install keygrain`.

#### New
- **Published to PyPI** via Trusted Publishing (OIDC — no long-lived tokens), with
  reproducible wheels and PEP 740 provenance attestations.
- **Read-only sync download + local encrypted cache** — retrieve your passwords, TOTP
  seeds, and SSH material from your synced configuration.
- Derive passwords, TOTP codes, SSH keys, and HD-wallet seeds from your master secret,
  as a CLI and an importable library.

No algorithm changes — output is byte-identical across all Keygrain platforms (SPEC v4).

## Sync server

### [1.0.0] - 2026-07-24

#### New
- **Data deletion** — an auth-gated `DELETE /api/sync/:lookup_id` endpoint lets a user
  erase their encrypted sync blob from the server. This backs the apps' "delete server
  data" feature.

#### Unchanged
- The server still only ever stores opaque ciphertext — it cannot read your passwords,
  service names, or email address.

## History (pre-decoupling)

Before per-component versioning, Keygrain used a single aggregate product version.
Public releases shipped on a 0.x line through v0.11.0; the 1.0–1.2 entries below are
from the project's earlier internal development scheme and are retained verbatim as a
historical record. They are **not** per-component versions.

### [1.2.0] - 2026-05-10

#### Added

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

#### Fixed

- Web generator: added Argon2id key strengthening, removed salt field
- Legacy storage key fallback for pre-Argon2id encrypted local data

#### Security

- Argon2id rate limiting (2s client-side throttle on strengthen calls)

### [1.1.0] - 2026-05-09

#### Added

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

#### Changed

- Counter hidden behind "Rotate password" flow

#### Removed

- Global salt parameter from derivation
- Old /api/backup/ endpoint (replaced by /api/sync/)
- Migration code and fallback paths

#### Fixed

- Site normalization stripping + mobile bugs
- CORS — missing host_permissions for backup server
- Crash on restore/backup
- Firefox manifest data_collection_permissions
- Extension zip structure

#### Security

- Argon2id makes brute-force of master secret infeasible
- Ed25519 signed site rules prevent rule injection
- Metadata tamper detection in sync protocol

### [1.0.0] - 2026-05-07

#### Added

- Deterministic password derivation (Python, JavaScript, Kotlin)
- Browser extension for Chrome and Firefox
- Android app with biometric unlock
- Backup/restore API
- Web generator PWA (offline-capable)
- Rate limiting on server endpoints
- Keyboard navigation
- Clipboard auto-clear (30s)
- ARIA labels and focus management for accessibility
