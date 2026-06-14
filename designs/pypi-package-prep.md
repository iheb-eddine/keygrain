# PyPI Package Preparation for Keygrain

## Goal

Make `pip install keygrain` work correctly. Package must be publication-ready — user runs `twine upload dist/*` and it's live on PyPI.

## Current State

- `pyproject.toml` has correct metadata, deps, entry point, and build system
- `setup.cfg` duplicates metadata but is **missing** `cryptography>=42.0.0` — dangerous if setuptools reads it for deps
- No README configured for PyPI long_description
- No classifiers, no project URLs
- No LICENSE file anywhere in the repo
- Stale artifacts: `UNKNOWN.egg-info/`, `build/`, `keygrain.egg-info/`

## Changes Required

### 1. Delete

| Path | Reason |
|------|--------|
| `python/setup.cfg` | Duplicate metadata, missing dep, causes confusion |
| `python/UNKNOWN.egg-info/` | Stale artifact from broken build |
| `python/build/` | Stale build output |
| `python/keygrain.egg-info/` | Regenerated on build |

### 2. Complete pyproject.toml

```toml
[project]
name = "keygrain"
version = "0.1.0"
description = "Deterministic password, SSH key, and wallet derivation from a master secret"
requires-python = ">=3.10"
license = "MIT"
license-files = ["LICENSE"]
readme = "README.md"
authors = [
    {name = "SecByTech"},
]
keywords = ["password", "derivation", "deterministic", "argon2", "ssh", "wallet", "bip39"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Intended Audience :: Developers",
    "Intended Audience :: End Users/Desktop",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Programming Language :: Python :: 3.13",
    "Topic :: Security",
    "Topic :: Security :: Cryptography",
]
dependencies = [
    "argon2-cffi>=23.1.0",
    "cryptography>=42.0.0",
]

[project.urls]
Homepage = "https://keygrain.secbytech.com"
Source = "https://dev.secbytech.com/opensource/keygrain"
Issues = "https://dev.secbytech.com/opensource/keygrain/-/issues"

[project.scripts]
keygrain = "keygrain.cli:main"

[build-system]
requires = ["setuptools>=68.0", "wheel"]
build-backend = "setuptools.build_meta"

[tool.setuptools]
packages = ["keygrain"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

### 3. README Strategy

Create `python/README.md` — a Python-specific README focused on the library and CLI. The root README covers the entire monorepo (extension, Android, server) and is not appropriate for PyPI.

**Content outline:**

```markdown
# Keygrain

Deterministic password, SSH key, and wallet derivation from a master secret.

## Install

    pip install keygrain

## CLI Usage

    export KEYGRAIN_SECRET="your-master-secret"
    keygrain me@example.com --site github.com
    keygrain ssh me@example.com --name github
    keygrain wallet me@example.com --name savings --chain bitcoin

## Library Usage

    from keygrain import derive_password, normalize_site

    password = derive_password(
        secret=b"my-secret",
        email="me@example.com",
        site=normalize_site("github.com"),
    )

## Features

- Argon2id key strengthening (64 MiB, 3 iterations)
- HMAC-SHA256 derivation — single password compromise reveals nothing
- SSH Ed25519 key derivation
- BIP-39 wallet mnemonic derivation
- BIP-85 child mnemonic derivation
- Cross-platform compatible (Python, Kotlin, JavaScript)

## Documentation

- [Algorithm Specification](https://dev.secbytech.com/opensource/keygrain/-/blob/main/SPEC.md)
- [API Reference](https://dev.secbytech.com/opensource/keygrain/-/blob/main/API.md)

## License

MIT
```

**Important:** All links must be absolute URLs. PyPI renders markdown but cannot resolve relative paths to the monorepo.

### 4. LICENSE Strategy

Create `python/LICENSE` containing the MIT license text. Required for:
- PyPI compliance (sdist must include license)
- setuptools auto-includes it when `license = "MIT"` is declared

The license year and copyright holder should match the project (SecByTech).

### 5. Dependency Version Rationale

| Dependency | Floor | Justification |
|-----------|-------|---------------|
| `argon2-cffi>=23.1.0` | API used (`hash_secret_raw` with `Type.ID`) works since 21.1.0, but 23.1.0 is the first release built against argon2 C ≥20190702 and drops Python <3.8. Aligns cleanly with our `>=3.10` requirement. |
| `cryptography>=42.0.0` | `public_bytes_raw()` (used in ssh.py) was added in 40.0.0. 42.0.0 drops OpenSSL 1.x, requires OpenSSL 3.x — conservative floor for security patch coverage. |

**No upper bounds** — this is a library. Upper bounds cause unnecessary resolver conflicts for downstream users and break when new versions release. Security updates should flow through automatically.

### 6. Versioning Strategy

**Single-source version:** `pyproject.toml` is the sole source of truth for the version string.

**No `__version__` attribute in `__init__.py`.** Users who need the version programmatically should use:

```python
from importlib.metadata import version
version("keygrain")  # "0.1.0"
```

This is stdlib since Python 3.8 and avoids duplication.

**Version for first publication:** 0.1.0 — appropriate for initial PyPI release.

### 7. Package Contents

**Included** (via `packages = ["keygrain"]`):
- `keygrain/__init__.py`
- `keygrain/derive.py`
- `keygrain/ssh.py`
- `keygrain/totp.py`
- `keygrain/wallet.py`
- `keygrain/bip85.py`
- `keygrain/cli.py`
- `keygrain/_wordlist.py` (27KB — BIP-39 wordlist, required at runtime by wallet.py)

**Excluded automatically:**
- `tests/` — not in `packages` list
- `__pycache__/` — excluded by setuptools default
- `.pytest_cache/` — excluded by setuptools default
- `build/`, `*.egg-info/` — excluded by setuptools default

**No MANIFEST.in needed** — setuptools auto-includes `README.md` and `LICENSE` when declared in pyproject.toml metadata via `readme` and `license-files` fields. The explicit `license-files = ["LICENSE"]` ensures inclusion regardless of setuptools version.

### 8. Build & Verification Steps

```bash
cd python/

# Clean stale artifacts
rm -rf build/ dist/ *.egg-info UNKNOWN.egg-info

# Build sdist + wheel
python -m build

# Verify package metadata
twine check dist/*

# Test install in fresh venv
python -m venv /tmp/keygrain-test
/tmp/keygrain-test/bin/pip install dist/keygrain-0.1.0-py3-none-any.whl

# Verify CLI works
/tmp/keygrain-test/bin/keygrain --help

# Verify import works
/tmp/keygrain-test/bin/python -c "from keygrain import derive_password; print('OK')"

# Verify version
/tmp/keygrain-test/bin/python -c "from importlib.metadata import version; print(version('keygrain'))"

# Cleanup
rm -rf /tmp/keygrain-test
```

### 9. Upload to PyPI

```bash
# Prerequisites: pip install twine build
# Account: register at pypi.org, create API token

# Upload (user's manual step)
twine upload dist/*

# Or test first on TestPyPI:
twine upload --repository testpypi dist/*
pip install --index-url https://test.pypi.org/simple/ keygrain
```

### 10. Pre-Upload Checklist (Manual)

- [ ] Verify `keygrain` name is available: https://pypi.org/project/keygrain/
- [ ] `twine check dist/*` passes with no warnings
- [ ] CLI entry point works after install (`keygrain --help`)
- [ ] All imports succeed (no missing deps)
- [ ] PyPI API token configured (`~/.pypirc` or `TWINE_PASSWORD` env var)

## Future Considerations

- **py.typed marker:** Add `python/keygrain/py.typed` (empty file) to signal PEP 561 type stub support, and add `"Typing :: Typed"` classifier. The code already uses type annotations (`tuple[bytes, bytes]`, etc.). Not blocking for 0.1.0.
- **GitHub Actions / GitLab CI:** Automate `build → twine check → publish` on tag push.
- **Changelog in package:** Consider including CHANGELOG.md in the sdist.
