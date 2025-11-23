# Design: Argon2id Strengthen Option for Keygrain

## 1. Overview

### Problem

A user with a weak master secret (e.g., short passphrase) is vulnerable to brute-force attacks. The current HMAC-SHA256 derivation is fast — an attacker can try billions of candidate secrets per second.

### Solution

Add an optional `strengthen=True` parameter to `derive_password`. When enabled, the master secret is first processed through Argon2id (a memory-hard key derivation function) before entering the existing HMAC derivation pipeline. This makes brute-force attacks computationally expensive (~1 second per guess on modern hardware).

The existing algorithm is completely untouched when `strengthen=False` (the default). Backward compatibility is preserved.

## 2. API Changes

### `derive_password` Signature

```python
def derive_password(
    secret: bytes,
    email: str,
    *,
    length: int = 20,
    symbols: str = DEFAULT_SYMBOLS,
    salt: str = "",
    strengthen: bool = False,  # NEW
) -> str:
```

When `strengthen=True`, the function calls `strengthen_secret(secret, email)` and uses the result as the HMAC key instead of the raw secret.

### `strengthen_secret` Function

```python
def strengthen_secret(secret: bytes, email: str) -> bytes:
    """Run Argon2id on the secret to produce a strengthened key.

    Args:
        secret: Raw master secret bytes.
        email: Email address (lowercased internally).

    Returns:
        32-byte strengthened secret.
    """
```

This function is public API — callers who need the strengthened secret for other purposes (e.g., backup key derivation) can use it directly.

### Modified `_stream` Call Path

```
strengthen=False:  secret → _stream(secret, email, length, salt)
strengthen=True:   secret → strengthen_secret(secret, email) → _stream(result, email, length, salt)
```

The rest of the algorithm (stream generation, character selection, shuffle) is unchanged.

## 3. Argon2id Parameters

| Parameter | Value | Justification |
|-----------|-------|---------------|
| Memory | 64 MiB (65536 KiB) | OWASP minimum for Argon2id. Constrained by mobile devices (2 GB RAM Android phones). |
| Iterations (time cost) | 3 | RFC 9106 §4: when memory is constrained, increase iterations to compensate. |
| Parallelism | 1 | Ensures identical output across all platforms regardless of threading implementation. |
| Output length | 32 bytes | Matches HMAC-SHA256 key size. No wasted or truncated material. |
| Salt | `"keygrain-strengthen:" + lowercase(email)` (UTF-8 encoded) | See §3.1. |
| Type | Argon2id | Hybrid: resistant to both side-channel and GPU attacks. |

### 3.1 Salt Construction

```
salt_bytes = ("keygrain-strengthen:" + email.lower()).encode("utf-8")
```

**Why not a fixed salt?** A fixed salt enables multi-target attacks: if two users share the same weak secret, an attacker who cracks one gets both for free. Including email makes each user's Argon2id output unique.

**Why not a random salt?** Derivation must be deterministic (same inputs → same password). A random salt would require storage, defeating keygrain's "no storage needed" property.

**Why email?** It's already a required input, always available, unique per user, and doesn't add storage requirements.

### 3.2 Parameter Selection Rationale

The primary constraint is mobile devices. Android Phase 1 targets devices with as little as 2 GB RAM. With OS overhead and other apps, reliably allocating more than 64 MiB for a single derivation is risky.

64 MiB with 3 iterations produces approximately 0.5–1.0 seconds of computation on modern mobile hardware. This is acceptable UX for a password manager (derivation happens once per session due to caching).

If future versions need stronger parameters, a versioning/migration mechanism would be required (out of scope for this design).

## 4. Caching Strategy

### Rationale

Argon2id is intentionally slow (~1 second). A user generating passwords for multiple sites in one session should not pay this cost repeatedly.

### Design

```python
_strengthen_cache: dict[tuple[bytes, str], bytes] = {}

def strengthen_secret(secret: bytes, email: str) -> bytes:
    email = email.lower()
    key = (secret, email)
    if key not in _strengthen_cache:
        _strengthen_cache[key] = _argon2id(secret, email)
    return _strengthen_cache[key]
```

### Cache Properties

| Property | Value |
|----------|-------|
| Key | `(secret, email)` — both inputs that affect Argon2id output |
| Scope | Module-level (process lifetime) |
| Eviction | None — in practice, a user has 1 secret and 1 email |
| Size bound | Effectively 1 entry for typical usage |
| Thread safety | Not required for Phase 1 (single-threaded CLI). Mobile platforms handle this per their concurrency model. |

### Security Note

The cache holds the strengthened secret in memory for the process lifetime. This is acceptable because:
- The raw secret is already in memory (passed by the caller)
- Process memory is already the trust boundary
- Clearing on exit is best-effort (Python doesn't guarantee `__del__` or `atexit`)

### `clear_cache` Function

```python
def clear_strengthen_cache() -> None:
    """Clear the internal Argon2id cache. Call when secret changes or on logout."""
    _strengthen_cache.clear()
```

Exposed as public API for mobile apps that want explicit cache control (e.g., on app background/lock).

## 5. Cross-Platform Considerations

All platforms MUST produce identical output for the same inputs. This requires:

### 5.1 Library Choices

| Platform | Library | Notes |
|----------|---------|-------|
| Python | `argon2-cffi` | Well-maintained, wraps reference C implementation |
| Kotlin/Android | `org.signal:argon2` or `com.lambdapioneer.argon2kt` | Must verify output matches reference |
| JavaScript | `hash-wasm` or `argon2-browser` | WASM-based, matches reference implementation |

### 5.2 Reproducibility Requirements

1. **Parameters must be hardcoded** — no configuration. All platforms use the exact same memory, iterations, parallelism, output length.
2. **Salt encoding** — UTF-8, no BOM, no null terminator. `"keygrain-strengthen:" + email.lower()` where `lower()` is ASCII lowercasing only (email local parts are ASCII per RFC 5321).
3. **Secret encoding** — raw bytes, passed directly as the Argon2id "password" input.
4. **Output** — raw 32 bytes (not hex/base64 encoded) used directly as HMAC key.

### 5.3 Cross-Platform Test Vectors

A shared test vector file (JSON) will be generated and committed. All platform implementations must pass these vectors. See §6.

## 6. Test Plan

### 6.1 Backward Compatibility

- All existing test vectors MUST pass unchanged with `strengthen=False` (default).
- Verify that omitting the `strengthen` parameter produces identical output to pre-change behavior.

### 6.2 New Test Vectors (strengthen=True)

Generate vectors using the Python reference implementation:

```json
{
  "vectors": [
    {
      "secret_hex": "7365637265743132330a",
      "email": "user@example.com",
      "length": 20,
      "symbols": "!@#$%&*-_=+?",
      "salt": "",
      "strengthen": true,
      "expected_password": "<generated>"
    },
    {
      "secret_hex": "6d79207365637265742070617373776f7264",
      "email": "Alice@Example.COM",
      "length": 12,
      "symbols": "!@#$",
      "salt": "v2",
      "strengthen": true,
      "expected_password": "<generated>"
    }
  ]
}
```

### 6.3 Test Cases

| Test | Validates |
|------|-----------|
| strengthen=False produces same output as before | Backward compatibility |
| strengthen=True produces different output than strengthen=False | Strengthen actually changes derivation |
| strengthen=True is deterministic (same inputs → same output) | Reproducibility |
| strengthen=True with different emails produces different output | Salt includes email |
| strengthen=True with same secret+email but different site salt produces different output | Site-level salt still works |
| Cache hit returns same result | Caching correctness |
| `clear_strengthen_cache()` forces recomputation | Cache control works |
| Cross-platform vectors match | Interoperability |

### 6.4 Performance Test

- Verify strengthen=True takes >100ms (confirms Argon2id is actually running)
- Verify second call with same inputs takes <10ms (confirms cache hit)

## 7. Security Considerations

### 7.1 Threat Model

| Threat | Mitigation |
|--------|-----------|
| Brute-force weak secret | Argon2id makes each guess cost ~1 second and 64 MiB |
| Multi-target attack (shared weak secrets) | Email in salt makes outputs unique per user |
| GPU/ASIC acceleration | Argon2id's memory-hardness limits parallel attacks |
| Side-channel attacks | Argon2id (the "id" variant) is designed to resist side-channels |

### 7.2 What This Does NOT Protect Against

- **Compromised device** — if the attacker has the raw secret from memory, strengthen is irrelevant
- **Very weak secrets** — a 4-digit PIN is still brute-forceable even with 1s/guess (10,000 guesses = ~3 hours)
- **Quantum attacks** — Argon2id is not quantum-resistant (but neither is HMAC-SHA256)

### 7.3 Fixed Salt Tradeoff

Using a deterministic salt (email-based) means:
- ✅ No storage required
- ✅ Deterministic derivation preserved
- ✅ Unique per user (email differs)
- ⚠️ An attacker who knows the target email can precompute a dictionary for that specific user. However, Argon2id's memory-hardness makes precomputation expensive regardless.

### 7.4 Cache Security

- The strengthened secret lives in process memory alongside the raw secret
- No additional attack surface beyond what already exists
- Mobile platforms should call `clear_strengthen_cache()` on app lock/background
- The cache does NOT persist to disk

### 7.5 Dependency Security

`argon2-cffi` wraps the reference Argon2 C implementation. It is:
- Maintained by the Python Cryptographic Authority (same org as `cryptography`)
- Widely used (>50M downloads/month)
- Pinned to a specific version in requirements

## 8. SPEC.md Changes Needed

### New Section: "Key Strengthening (Optional)"

Add after the current "Algorithm" section:

```markdown
## Key Strengthening (Optional)

When `strengthen=True`, the secret is pre-processed through Argon2id before
entering the derivation algorithm:

### Argon2id Parameters

| Parameter | Value |
|-----------|-------|
| Memory | 64 MiB (65536 KiB) |
| Iterations | 3 |
| Parallelism | 1 |
| Output length | 32 bytes |
| Salt | UTF-8 bytes of `"keygrain-strengthen:" + lowercase(email)` |
| Variant | Argon2id |

### Modified Derivation

When strengthen=True:
```
strengthened_secret = argon2id(secret, salt, params)
```

Then `strengthened_secret` replaces `secret` in Step 1 of the main algorithm.
When strengthen=False (default), the algorithm is unchanged.
```

### Updated Input Table

Add `strengthen` to the input parameter table:

| Parameter | Description | Stored per-site |
|-----------|-------------|-----------------|
| `strengthen` | Enable Argon2id key strengthening (default: false) | yes |

### Updated Security Properties

Add:
- **Weak secret + strengthen** → brute-force cost increased to ~1 second × 64 MiB per guess
