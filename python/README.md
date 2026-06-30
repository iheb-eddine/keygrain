# Keygrain

Deterministic password, SSH key, and wallet derivation from a master secret.

## Install

```
pip install keygrain
```

## CLI Usage

```bash
export KEYGRAIN_SECRET="your-master-secret"
keygrain me@example.com --site github.com
keygrain ssh me@example.com --name github
keygrain wallet me@example.com --name savings --chain bitcoin
```

## Library Usage

```python
from keygrain import derive_password, normalize_site

password = derive_password(
    secret=b"my-secret",
    email="me@example.com",
    site=normalize_site("github.com"),
)
```

## Features

- Argon2id key strengthening (64 MiB, 3 iterations)
- HMAC-SHA256 derivation — single password compromise reveals nothing
- TOTP seed derivation
- SSH Ed25519 key derivation
- BIP-39 wallet mnemonic derivation
- BIP-85 child mnemonic derivation
- Cross-platform compatible (Python, Kotlin, JavaScript)

## Documentation

- [Algorithm Specification](https://github.com/iheb-eddine/keygrain/blob/main/SPEC.md)
- [API Reference](https://github.com/iheb-eddine/keygrain/blob/main/API.md)

## License

MIT
