# Keygrain

Deterministic password derivation from a master secret. One secret, all your passwords — no storage needed.

## How It Works

Enter your master secret + email → get a unique, strong password for any site. The same inputs always produce the same output. Change the length, symbols, or salt → entirely different password.

## Features

- **Deterministic** — no password database to lose or sync
- **Cross-platform** — identical output from Python, Kotlin, and future implementations
- **Customizable** — per-site symbol sets, length, and salt
- **Encrypted backup** — sync config (not passwords) across devices
- **Offline** — works without internet (backup/sync is optional)

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

## Quick Start (CLI)

```bash
export KEYGRAIN_SECRET="my-master-secret"
keygrain me@example.com --length 20
```

## Algorithm

See [SPEC.md](SPEC.md) for the full specification.

## Project Structure

```
python/     — Python library + CLI
kotlin/     — Android app (Jetpack Compose)
server/     — Backup server (Phase 2)
vectors.json — Cross-platform test vectors
```

## License

MIT
