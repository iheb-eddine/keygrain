# Keygrain

Deterministic password derivation from a master secret. One secret, all your passwords — no storage needed.

## How It Works

Enter your master secret + email → get a unique, strong password for any site. The same inputs always produce the same output. Change the length, symbols, or salt → entirely different password.

## Features

- **Deterministic** — no password database to lose or sync
- **Cross-platform** — identical output from Python, Kotlin, JS, and browser extension
- **Customizable** — per-site symbol sets, length, and salt
- **Encrypted backup** — sync config (not passwords) across devices via server
- **Offline** — works without internet (backup/sync is optional)
- **Biometric unlock** — fingerprint/face on Android
- **Browser extension** — Chrome + Firefox with autofill
- **Web generator** — client-side, no server interaction
- **Argon2id** — optional key strengthening for memorizable passphrases

## Platforms

| Platform | Location | Install |
|----------|----------|---------|
| Python library + CLI | `python/` | `pip install git+ssh://git@dev.secbytech.com/tools/keygrain.git#subdirectory=python` |
| Android app | `kotlin/` | Download APK from [keygrain.secbytech.com](https://keygrain.secbytech.com) |
| Web generator | `server/static/generate/` | [keygrain.secbytech.com/generate](https://keygrain.secbytech.com/generate/) |
| Browser extension | `extension/` | Build with `extension/build.sh` |
| Backup server | `server/` | Self-hosted at keygrain.secbytech.com |

## Quick Start (Python)

```bash
pip install git+ssh://git@dev.secbytech.com/tools/keygrain.git#subdirectory=python
```

```python
from keygrain import derive_password

password = derive_password(
    secret=b"my-master-secret",
    email="me@example.com",
    length=20,
    symbols="!@#$%&*-_=+?",
    salt="",
)
```

## Using as a Library

```python
from keygrain import derive_password

SECRET = b"my-master-secret"

# Generate passwords for multiple email providers
gmail_pw = derive_password(SECRET, "me@gmail.com")
outlook_pw = derive_password(SECRET, "me@outlook.com")
yahoo_pw = derive_password(SECRET, "me@yahoo.com")

# Custom symbols for providers with restrictions
icloud_pw = derive_password(SECRET, "me@icloud.com", symbols="!@#$%&*-_=+")

# Different length
short_pw = derive_password(SECRET, "me@example.com", length=16)

# Salt for password rotation (same email, different password)
rotated_pw = derive_password(SECRET, "me@gmail.com", salt="v2")
```

## Argon2id (Weak Passphrase Protection)

If your master secret is a memorizable passphrase, enable Argon2id to make brute-force expensive:

```python
from keygrain import derive_password

# ~1 second on first call (cached after that)
pw = derive_password(b"my memorable passphrase", "me@gmail.com", strengthen=True)
```

Skip `strengthen=True` if your secret is already high-entropy (random 20+ chars).

## Quick Start (CLI)

```bash
export KEYGRAIN_SECRET="my-master-secret"
keygrain me@example.com --length 20
```

## Browser Extension

Build for Chrome and Firefox:

```bash
cd extension && ./build.sh
```

Produces `dist/chrome.zip` and `dist/firefox.zip` for store submission. Load unpacked from `dist/chrome/` or `dist/firefox/` for development.

Features:
- Generate password in popup
- Autofill password fields (Ctrl+Shift+K)
- Per-domain email memory
- Copy to clipboard with 30s auto-clear

## Algorithm

See [SPEC.md](SPEC.md) for the full specification.

## Project Structure

```
python/          — Python library + CLI
kotlin/          — Android app (Jetpack Compose + Material 3)
extension/       — Browser extension (Chrome MV3 + Firefox)
server/          — Go backup server + web generator + landing page
designs/         — Design documents
vectors.json     — Cross-platform test vectors (8 vectors)
SPEC.md          — Algorithm specification
```

## License

MIT
