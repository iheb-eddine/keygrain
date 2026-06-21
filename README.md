<p align="center">
  <img src="logo/keygrain-128x128.png" alt="Keygrain" width="96" />
</p>

<h1 align="center">Keygrain</h1>

<p align="center">
  Deterministic password derivation. One secret, all your passwords — no vault needed.
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
pip install git+ssh://git@dev.secbytech.com/opensource/keygrain.git#subdirectory=python

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
| Sync server | Go, sync API only | Self-hosted at keygrain.com |

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

# Server (requires Go 1.22+)
cd server && go build && go test ./...
```

## Documentation

- [Algorithm Specification](SPEC.md) — complete, implementation-ready spec with test vectors
- [Security Design](https://keygrain.com/security/) — how Keygrain protects your data
- [CLI & Integration Guide](docs/cli-and-integration.md) — command reference and Python library usage
- [Self-Hosting Guide](docs/self-hosting.md) — deploy your own sync server
- [Advanced Features](docs/advanced-features.md) — SSH keys, HD wallets, TOTP seeds
- [Architecture](docs/architecture.md) — system design and security model
- [Terminology & Style](docs/GLOSSARY.md) — canonical terms and documentation governance
- [User Guide: Extension](docs/user-guide-extension.md)
- [User Guide: Android](docs/user-guide-mobile.md)
- [Design Documents](designs/) — 80+ design docs covering every feature

## License

MIT
