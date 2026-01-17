# Design: Argon2id Key Strengthening (Mandatory)

**Status:** Approved — breaking change (no users)  
**Goal:** Make brute-forcing the master secret computationally infeasible.

---

## 1. Overview

The master secret is processed through Argon2id before entering any derivation pipeline. This is mandatory — there is no opt-out flag. The strengthened key replaces the raw secret for all HMAC-based derivations (passwords, auth, encryption, lookup ID).

### Flow

```
strengthened = Argon2id(secret, salt, params)   ← runs once per session
key = HMAC-SHA256(strengthened, message)         ← per derivation
stream = key || HMAC-SHA256(key, 0x01) || ...
password = buildPassword(stream, length, symbols)
```

---

## 2. Argon2id Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Memory | 64 MiB (65536 KiB) | OWASP minimum for Argon2id. Safe for 2 GB RAM mobile devices. |
| Iterations (time cost) | 3 | RFC 9106 §4: increase iterations when memory is constrained. |
| Parallelism | 1 | Guarantees identical output across all platforms regardless of threading. |
| Output length | 32 bytes | Matches HMAC-SHA256 key size. |
| Salt | `"keygrain-strengthen:" + lowercase(email)` (UTF-8) | See §2.1. |
| Variant | Argon2id | Hybrid: resists both side-channel and GPU attacks. |

### 2.1 Salt Construction

```
salt_bytes = ("keygrain-strengthen:" + email.lower()).encode("utf-8")
```

**Why email-scoped, not fixed?** A fixed salt enables multi-target attacks: an attacker brute-forcing weak secrets can amortize Argon2id cost across all users simultaneously. Including email forces per-user attack cost with zero storage overhead.

**Why not random?** Derivation must be deterministic. A random salt would require storage, defeating keygrain's stateless property.

### 2.2 Performance Expectations

These parameters produce ~0.5–1.0s on modern mobile hardware. This is the OWASP-recommended minimum configuration. We accept whatever wall-clock time this produces on low-end devices — the cost is paid once per session (cached), not per password generation. If future benchmarks show unacceptable UX on target devices, parameters can be reduced, but this requires a new design revision.

---

## 3. Scope: All Derivations

The strengthened secret replaces the raw secret **everywhere**. Argon2id runs once; the result feeds all derivations:

| Derivation | Message | Uses strengthened secret |
|------------|---------|------------------------|
| Password | `site:email:length:counter` | ✓ |
| Lookup ID | `email + ":keygrain-id"` | ✓ |
| Auth password | `email:32:keygrain-auth` | ✓ |
| Encryption key | `email + ":keygrain-encryption"` | ✓ |
| Fingerprint | `"keygrain-fingerprint"` | ✓ |

### 3.1 Backup Vector Invalidation

**Breaking change:** All backup-related derivations (lookup_id, auth_password, encryption_key) now produce different values than the previous non-strengthened versions. Any data stored on the server under old lookup IDs is unreachable. This is acceptable because there are no users.

The server requires no code changes — it stores whatever auth_password hash and encrypted blob it receives. The change is purely client-side.

---

## 4. API

The `strengthen` parameter is removed. Strengthening is always applied:

```python
def derive_password(
    secret: bytes,
    email: str,
    *,
    site: str,
    length: int = 20,
    symbols: str = DEFAULT_SYMBOLS,
    counter: int = 1,
) -> str:
```

Internally:
```python
effective_secret = strengthen_secret(secret, email)  # always
message = f"{site}:{email}:{length}:{counter}".encode()
key = hmac_sha256(effective_secret, message)
```

### 4.1 `strengthen_secret` (public API)

```python
def strengthen_secret(secret: bytes, email: str) -> bytes:
    """Argon2id(secret, salt="keygrain-strengthen:"+email, t=3, m=64MiB, p=1) → 32 bytes."""
```

Exposed for callers that need the strengthened key directly (e.g., backup derivations).

---

## 5. Caching Strategy

```python
_strengthen_cache: dict[tuple[bytes, str], bytes] = {}
```

| Property | Value |
|----------|-------|
| Key | `(secret, email.lower())` |
| Scope | Process lifetime |
| Eviction | None (typically 1 entry) |
| Clear | `clear_strengthen_cache()` on logout/lock |
| Thread safety | Not required for Phase 1 |

The cache holds the strengthened secret in memory. This adds no attack surface — the raw secret is already in process memory.

---

## 6. Cross-Platform Libraries

| Platform | Library | Notes |
|----------|---------|-------|
| Python | `argon2-cffi` (pinned) | Wraps reference C implementation. PyCA-maintained. |
| JavaScript/Extension | `hash-wasm` | WASM, matches reference impl. No native deps. |
| Kotlin/Android | `org.signal:argon2` or `argon2kt` | Must verify output matches reference. |

### 6.1 Reproducibility Requirements

1. Parameters hardcoded — no configuration.
2. Salt: UTF-8, no BOM, no null terminator.
3. Secret: raw bytes passed as Argon2id "password" input.
4. Output: raw 32 bytes used directly as HMAC key (not hex/base64).
5. Email lowercasing: ASCII only (per RFC 5321).

---

## 7. Test Vectors

Generated with the Python reference implementation (`argon2-cffi`).

### 7.1 `strengthen_secret` Vectors

| secret (hex) | email | expected strengthened key (hex) |
|---|---|---|
| `6d792d6d61737465722d736563726574` | `test@gmail.com` | `d7b935b8298f476c6046cb71501fcb8c9a53327df3cc4e05c696fea7ef3d035a` |
| `73686f7274` | `Alice@Example.COM` | `3633552e469c5ea783380f877b271672e7261795298870734940afe4f808b47b` |
| `73686f7274` | `alice@example.com` | `3633552e469c5ea783380f877b271672e7261795298870734940afe4f808b47b` |

### 7.2 `derive_password` Vectors

| secret (hex) | email | site | length | counter | symbols | expected |
|---|---|---|---|---|---|---|
| `6d792d6d61737465722d736563726574` | `test@gmail.com` | `github.com` | 20 | 1 | `!@#$%&*-_=+?` | `A=4BXNAHYUU_hmVwv$h?` |
| `6d792d6d61737465722d736563726574` | `test@gmail.com` | `google.com` | 16 | 1 | `!@#$%&*-_=+?` | `aNJ4XBD?U6nvTvTA` |
| `6d792d6d61737465722d736563726574` | `TEST@Gmail.COM` | `github.com` | 20 | 1 | `!@#$%&*-_=+?` | `A=4BXNAHYUU_hmVwv$h?` |
| `6d792d6d61737465722d736563726574` | `test@gmail.com` | `github.com` | 20 | 2 | `!@#$%&*-_=+?` | `GnkEz!F9-z_NqkGTy4n2` |

### 7.3 Cross-Platform Validation

A shared `test-vectors.json` file will be committed. All platform implementations must pass these vectors identically.

---

## 8. Security Analysis

### 8.1 Threat Mitigation

| Threat | Mitigation |
|--------|-----------|
| Brute-force weak secret | ~1s + 64 MiB per guess |
| Multi-target attack | Email in salt → per-user cost |
| GPU/ASIC acceleration | Memory-hardness limits parallelism |
| Side-channel | Argon2id variant designed for resistance |

### 8.2 Limitations

- **Compromised device:** If attacker has raw secret from memory, strengthening is irrelevant.
- **Very weak secrets:** A 4-digit PIN is still brute-forceable (~3 hours at 1s/guess).
- **Precomputation:** Attacker who knows target email can build a dictionary for that user, but memory-hardness makes this expensive regardless.

### 8.3 Cache Security

- Strengthened secret lives in memory alongside raw secret — no additional attack surface.
- Mobile apps should call `clear_strengthen_cache()` on lock/background.
- Cache never persists to disk.
