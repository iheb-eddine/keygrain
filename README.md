<p align="center">
  <img src="logo/keygrain-128x128.png" alt="Keygrain" width="96" />
</p>

<h1 align="center">Keygrain</h1>

<p align="center">
  <strong>Derive passwords from one secret. No vault. No database. No breach.</strong>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/keygrain/goeemlncopfbcnppjalfmgdalbhlgdha"><img src="https://img.shields.io/chrome-web-store/v/goeemlncopfbcnppjalfmgdalbhlgdha?label=Chrome" alt="Chrome Web Store"></a>
  <a href="https://addons.mozilla.org/addon/keygrain/"><img src="https://img.shields.io/amo/v/keygrain?label=Firefox" alt="Firefox Add-ons"></a>
  <a href="https://keygrain.com"><img src="https://img.shields.io/badge/Android-APK-green" alt="Android APK"></a>
  <a href="https://keygrain.com/generate/"><img src="https://img.shields.io/badge/Web-PWA-blue" alt="Web Generator"></a>
  <a href="#python-cli"><img src="https://img.shields.io/badge/CLI-pip_install-orange" alt="Python CLI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="MIT License"></a>
</p>

<!-- DEMO GIF PLACEHOLDER
┌─────────────────────────────────────────────────────────────────────┐
│  Replace this block with: <img src="demo.gif" alt="Keygrain demo"> │
└─────────────────────────────────────────────────────────────────────┘

GIF PRODUCTION SPEC:
- Resolution: 800×500 (16:10), optimized ≤5 MB
- Duration: ~15 seconds, looping
- Sequence:
  1. Browser showing github.com login page (empty form)
  2. Click Keygrain extension icon → popup opens
  3. Type master secret → visual fingerprint (colored dots) appears
  4. Select "github.com" from services list → password derived instantly
  5. Click "Fill" → username + password autofill into the form
  6. Navigate to a second site (e.g., gitlab.com login)
  7. Press Ctrl+Shift+K → form fills instantly WITHOUT opening popup
  8. Brief pause showing filled form
- Style: Dark browser theme, no real credentials, placeholder email "me@example.com"
- The Ctrl+Shift+K moment is the "wow" beat — emphasize the speed (no popup, instant fill)
-->

<p align="center">
  <em>No password database — passwords are computed from your secret on demand.<br>
  Same inputs, same output, every device. Nothing to breach.</em>
</p>

<h3 align="center">Install</h3>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/keygrain/goeemlncopfbcnppjalfmgdalbhlgdha"><strong>Chrome</strong></a> ·
  <a href="https://addons.mozilla.org/addon/keygrain/"><strong>Firefox</strong></a> ·
  <a href="https://keygrain.com"><strong>Android</strong></a> ·
  <a href="https://keygrain.com/generate/"><strong>Web PWA</strong></a> ·
  <a href="#python-cli"><strong>CLI</strong></a>
</p>

<p align="center">
  📐 <a href="SPEC.md">Fully specified algorithm</a> with test vectors — implement it yourself on any platform.
</p>

---

## What is Keygrain?

Keygrain derives unique, strong passwords from your master secret and site information. The same inputs always produce the same output — across every platform, every time. There is no password database to lose, breach, or sync. Only your per-site settings (length, symbols, counter) are stored, and those are useless without your secret.

## Key Features

**Core**
- Deterministic — no password storage, passwords recomputed on demand
- Cross-platform — identical output from Python, Kotlin, JavaScript, and the browser extension
- Per-site customization — length, symbol set, and counter per service

**Security**
- Argon2id key strengthening (64 MiB, 3 iterations) — mandatory on all platforms
- HMAC-SHA256 derivation — single password compromise cannot reveal the secret
- End-to-end encrypted sync — server sees only opaque ciphertext
- Visual secret fingerprint — colored dot pattern confirms you typed the right secret

**Browser Extension**
- Autofill username + password into login forms
- Zero-click fill via `Ctrl+Shift+K`
- PIN unlock (no need to re-enter master secret every time)
- Fuzzy search with frecency ranking
- Breach warnings for compromised sites
- Site rules (auto-detect length/symbol constraints)
- Migration wizard — import from LastPass, Bitwarden, 1Password, Chrome, Firefox
- Dark mode

**Android**
- Biometric unlock (fingerprint / face)
- Services CRUD with search
- Encrypted sync across devices
- Export / import (JSON)

**Web Generator**
- Progressive Web App — works offline
- Client-side only, no server interaction

## Quick Start

### Browser Extension

1. Download from the [Chrome Web Store](https://chromewebstore.google.com/detail/keygrain/goeemlncopfbcnppjalfmgdalbhlgdha) or [Firefox Add-ons](https://addons.mozilla.org/addon/keygrain/), or load unpacked from `extension/dist/chrome/`
2. Click the Keygrain icon → enter your master secret and email
3. Add a site → your password is derived instantly
4. Click **Fill** or press `Ctrl+Shift+K` to autofill the active page

### Python CLI

```bash
pip install git+https://github.com/iheb-eddine/keygrain.git#subdirectory=python

keygrain me@example.com --site github.com
```

### Switching from another password manager?

The extension includes a migration wizard. Open Settings → Import → select your source (LastPass, Bitwarden, 1Password, Chrome, Firefox) and follow the steps.

## How It Works

```
secret + email
       │
       ▼
Argon2id(secret, "keygrain-strengthen:" + email)  →  strengthened key
       │
       ▼
HMAC-SHA256(strengthened, "site:email:length:counter")  →  key stream
       │
       ▼
Character mapping + Fisher-Yates shuffle  →  password
```

Every password contains at least one uppercase, one lowercase, one digit, and one symbol. Ambiguous characters (`I`, `l`, `O`, `0`, `1`) are excluded by default.

**Counter:** Increment the counter to rotate a password without changing your secret or any other parameter. Useful when a site forces periodic password changes or after a breach.

Full specification: [SPEC.md](SPEC.md)

## Platforms

| Platform | Description | Access |
|----------|-------------|--------|
| Browser extension | Chrome (MV3) + Firefox (MV2) | [Chrome Web Store](https://chromewebstore.google.com/detail/keygrain/goeemlncopfbcnppjalfmgdalbhlgdha) / [Firefox Add-ons](https://addons.mozilla.org/addon/keygrain/) or build from `extension/` |
| Android app | Kotlin + Jetpack Compose | [APK download](https://keygrain.com) |
| Web generator | Client-side PWA | [keygrain.com/generate](https://keygrain.com/generate/) |
| Python library + CLI | Library and command-line tool | `pip install` from repo |
| Sync service | End-to-end encrypted sync API | Hosted at keygrain.com |

## Security

| Property | Detail |
|----------|--------|
| Key strengthening | Argon2id — 64 MiB memory, 3 iterations, parallelism 1 |
| Derivation | HMAC-SHA256 — compromising one password reveals nothing about others |
| Sync encryption | AES-256-GCM — encrypted locally before transmission |
| Server knowledge | Opaque encrypted blob + bcrypt(auth_password). Server never sees: master secret, encryption key, or plaintext config |
| Secret verification | Visual fingerprint (4-color dot pattern) confirms correct secret entry |

Your master secret never leaves your device in plaintext. If the server is compromised, attackers get only encrypted blobs — useless without individual master secrets.

## Building from Source

```bash
# Python (library + tests)
cd python && pip install -e . && pytest tests/

# Browser extension
cd extension && ./build.sh
# Produces dist/keygrain-chrome.zip and dist/keygrain-firefox.zip

# Android (requires Android SDK)
cd kotlin && ./gradlew assembleRelease
```

## Documentation

- [Algorithm Specification](SPEC.md) — complete, implementation-ready spec with test vectors
- [Verifying Keygrain](VERIFY.md) — check the installed extension/APK against this source
- [Security Design](https://keygrain.com/security/) — how Keygrain protects your data
- [CLI & Integration Guide](docs/cli-and-integration.md) — command reference and Python library usage
- [Advanced Features](docs/advanced-features.md) — SSH keys, HD wallets, TOTP seeds
- [Architecture](docs/architecture.md) — system design and security model
- [Terminology & Style](docs/GLOSSARY.md) — canonical terms and documentation governance
- [User Guide: Extension](docs/user-guide-extension.md)
- [User Guide: Android](docs/user-guide-mobile.md)
- [Design Documents](designs/) — 80+ design docs covering every feature

## License

MIT
