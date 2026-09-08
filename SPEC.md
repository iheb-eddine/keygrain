# Keygrain Algorithm Specification

**Version:** 5 (item-isolated salt, email decoupling for SSH and HD wallets)
**Status:** Authoritative reference

This document fully specifies the Keygrain deterministic password derivation algorithm. An implementor can produce byte-identical output on any platform using only this specification and the test vectors.

---

## 1. Overview

Keygrain derives unique, deterministic passwords from a master secret, an email address, and a site identifier. No password storage is required — the same inputs always produce the same output. A single Argon2id key-strengthening step protects against brute-force attacks on weak secrets.

---

## 2. Parameters

| Parameter | Type | Constraints | Default | Stored |
|-----------|------|-------------|---------|--------|
| `secret` | bytes | Non-empty | — | Never |
| `email` | string | Non-empty; lowercased before use | — | Per-service |
| `site` | string | Non-empty; lowercased before use | — | Per-service |
| `length` | integer | ≥ 8 | 20 | Per-service |
| `symbols` | string | Non-empty; every character U+0021..U+007E | `!@#$%&*-_=+?` | Per-service |
| `counter` | integer | ≥ 1 | 1 | Per-service |

All string parameters are encoded as UTF-8 (no BOM, no null terminator) before any cryptographic operation.

---

## 3. Key Strengthening (Argon2id)

Key strengthening is **mandatory**. Every derivation uses the strengthened key, never the raw secret.

### 3.1 Parameters

| Parameter | Value |
|-----------|-------|
| Algorithm | Argon2id (RFC 9106) |
| Memory | 65536 KiB (64 MiB) |
| Iterations (time cost) | 3 |
| Parallelism | 1 |
| Output length | 32 bytes |
| Password input | `secret` (raw bytes) |
| Salt | `UTF-8("keygrain-strengthen:" + lowercase(email))` |

### 3.2 Pseudocode

```
function strengthen(secret: bytes, email: string) -> bytes[32]:
    salt = UTF8_ENCODE("keygrain-strengthen:" + LOWERCASE(email))
    return Argon2id(
        password = secret,
        salt     = salt,
        m        = 65536,
        t        = 3,
        p        = 1,
        len      = 32
    )
```

### 3.3 Caching

The result SHOULD be cached keyed on `(secret, lowercase(email))` for the duration of a session. The cache MUST be cleared on logout or lock.

---

## 4. Password Derivation

### 4.1 Message Construction

```
message = UTF8_ENCODE(
    LOWERCASE(site) + ":" + LOWERCASE(email) + ":" + DECIMAL(length) + ":" + DECIMAL(counter)
)
```

`DECIMAL(n)` is the base-10 string representation with no leading zeros (e.g., `20`, `1`).

### 4.2 HMAC Key Derivation

```
strengthened = strengthen(secret, email)
key = HMAC-SHA256(key = strengthened, message = message)    // 32 bytes
```

### 4.3 Stream Extension

The stream provides pseudorandom bytes for character selection and shuffling.

```
stream = key
ctr = 1
pos = 0

function next_byte():
    if pos >= LENGTH(stream):
        stream = stream || HMAC-SHA256(key = key, message = UINT32_BE(ctr))
        ctr = ctr + 1
    byte = stream[pos]
    pos = pos + 1
    return byte
```

`UINT32_BE(ctr)` is the counter as a 4-byte big-endian unsigned integer (e.g., counter 1 → `0x00000001`).

Implementations MAY pre-allocate stream bytes for performance (for example, 256 bytes as a conservative initial allocation hint), but MUST extend on demand if `pos` reaches the end. The initial allocation is not an exhaustion limit, and implementations are not required to allocate exactly 256 bytes.

### 4.4 Character Selection

Define `unbiased_index(n)`:
```
function unbiased_index(n):
    limit = FLOOR(256 / n) * n
    loop:
        b = next_byte()
        if b < limit:
            return b % n
```

**Step 1 — Force one character from each category (in order):**

```
chars[0] = UPPER[unbiased_index(24)]
chars[1] = LOWER[unbiased_index(23)]
chars[2] = DIGITS[unbiased_index(8)]
chars[3] = symbols[unbiased_index(LENGTH(symbols))]
```

**Step 2 — Fill remaining positions from full charset:**

```
full_charset = UPPER + LOWER + DIGITS + symbols
for i = 0, 1, ..., length - 5:
    chars[4 + i] = full_charset[unbiased_index(LENGTH(full_charset))]
```

### 4.5 Fisher-Yates Shuffle

```
for i from (length - 1) down to 1:
    j = unbiased_index(i + 1)
    swap(chars[i], chars[j])
```

### 4.6 Output

```
password = CONCATENATE(chars)    // length characters
```

The output is guaranteed to contain at least one uppercase letter, one lowercase letter, one digit, and one symbol.

---

## 5. Character Sets

Ambiguous characters (easily confused in certain fonts) are excluded.

| Category | Characters | Count | Excluded |
|----------|-----------|-------|----------|
| UPPER | `ABCDEFGHJKLMNPQRSTUVWXYZ` | 24 | I, O |
| LOWER | `abcdefghjkmnpqrstuvwxyz` | 23 | i, l, o |
| DIGITS | `23456789` | 8 | 0, 1 |
| SYMBOLS | Configurable per-service | Variable | — |

**Default symbols:** `!@#$%&*-_=+?` (12 characters)


### 5.1 Symbol policy

The current symbol policy is `ascii-printable-v1`. The `symbols` value MUST be a non-empty string containing only graphic printable ASCII characters U+0021 through U+007E inclusive. Space U+0020, C0 controls, DEL U+007F, non-ASCII characters, and JavaScript surrogate/non-BMP values are invalid and MUST be rejected; implementations MUST NOT trim, normalize, substitute, deduplicate, sort, or otherwise alter invalid input.

Implementations use an internal policy selector with `ascii-printable-v1` as the omitted-policy default. Unknown policy identifiers MUST be rejected. The policy identifier selects validation/indexing behavior only and MUST NOT be included in the password HMAC message. The validated symbol sequence is passed to the existing category selection and `full_charset` construction unchanged, preserving order, duplicates, and overlap with the fixed categories. A future policy, if separately approved, MUST use a distinct identifier; no future policy is defined here.
The `full_charset` is the concatenation: UPPER + LOWER + DIGITS + symbols (in that order). With default symbols, this is 67 characters.

---

## 6. Auth Derivation (Sync Identity)

These derivations enable stateless authentication with a sync server. All use the strengthened key.

### 6.1 Lookup ID

A hex-encoded identifier used as the user's primary key on the server.

```
strengthened = strengthen(secret, email)
message = UTF8_ENCODE(LOWERCASE(email) + ":keygrain-id")
lookup_id = HEX_ENCODE(HMAC-SHA256(key = strengthened, message = message))
```

Output: 64-character lowercase hex string.

### 6.2 Auth Password

A derived password used for HTTP Basic authentication with the sync server.

```
strengthened = strengthen(secret, email)
message = UTF8_ENCODE(LOWERCASE(email) + ":32:keygrain-auth")
stream = build_stream(key = strengthened, message = message)
auth_password = build_password(stream, length = 32, symbols = "!@#$%&*-_=+?")
```

This uses the same `build_stream` (§4.3) and `build_password` (§4.4 + §4.5) machinery as regular password derivation, with hardcoded length=32 and default symbols. Stream extension from §4.3 is mandatory. An implementation MAY use an initial allocation of 256 bytes as an optional/conservative performance hint, but 256 bytes is not an exhaustion limit: implementations MUST extend on demand if password generation consumes more bytes and are not required to allocate exactly 256 bytes.

### 6.3 Encryption Key

A 32-byte key used for AES-256-GCM encryption of the config blob.

```
strengthened = strengthen(secret, email)
message = UTF8_ENCODE(LOWERCASE(email) + ":keygrain-encryption")
encryption_key = HMAC-SHA256(key = strengthened, message = message)
```

Output: 32 raw bytes (not hex-encoded).

---

## 7. Visual Fingerprint

A 4-color visual indicator derived from the raw secret, allowing users to verify they entered the correct secret. The fingerprint is independent of email — it uses only the secret bytes.

### 7.1 Derivation

```
message = UTF8_ENCODE("keygrain-fingerprint")
hash = HMAC-SHA256(key = secret_bytes, message = message)
color_indices = [hash[0] % 8, hash[1] % 8, hash[2] % 8, hash[3] % 8]
```

Note: The fingerprint uses the **raw secret** (not the strengthened key), does **not** require an email address, and is computed outside Argon2id. This enables instant visual feedback on the lock screen before Argon2id completes.

Security qualification: the four indices expose 12 bits of information (four values from a palette of eight). The fingerprint is not a standalone secret verifier. It can provide a conditional 4096x prefilter only when an attacker also has a separate verification oracle; the fingerprint alone does not verify a guessed secret.

### 7.2 Color Palette (Wong)

| Index | Hex Color |
|-------|-----------|
| 0 | `#000000` |
| 1 | `#E69F00` |
| 2 | `#56B4E9` |
| 3 | `#009E73` |
| 4 | `#F0E442` |
| 5 | `#0072B2` |
| 6 | `#D55E00` |
| 7 | `#CC79A7` |

---

## 8. Test Vectors

The §8.1 and §8.2 derivation values are verified against the reference Python implementation (`argon2-cffi`). The §8.3 fingerprint values are reproducible from the documented raw-secret HMAC formula and were independently checked; the reference Python implementation is not a fingerprint oracle. The existing `keygrain/sync-vectors.json` is the JS-oracle-generated cross-platform regression fixture for the sync authentication fields. It is an implementation-agreement fixture, not an independently generated conformance fixture from this prose, and it remains unchanged.

### 8.1 Key Strengthening

| secret (UTF-8) | secret (hex) | email | expected (hex) |
|---|---|---|---|
| `my-master-secret` | `6d792d6d61737465722d736563726574` | `test@gmail.com` | `d7b935b8298f476c6046cb71501fcb8c9a53327df3cc4e05c696fea7ef3d035a` |
| `short` | `73686f7274` | `Alice@Example.COM` | `3633552e469c5ea783380f877b271672e7261795298870734940afe4f808b47b` |
| `short` | `73686f7274` | `alice@example.com` | `3633552e469c5ea783380f877b271672e7261795298870734940afe4f808b47b` |

Vectors 2 and 3 MUST produce identical output (email case normalization).

### 8.2 Password Derivation

| secret (UTF-8) | site | email | length | symbols | counter | expected |
|---|---|---|---|---|---|---|
| `my-master-secret` | `github.com` | `test@gmail.com` | 20 | `!@#$%&*-_=+?` | 1 | `?X_BAbv4UHAfw=kYV$mh` |
| `my-master-secret` | `google.com` | `test@gmail.com` | 20 | `!@#$%&*-_=+?` | 1 | `T=p?759$FdXp8eW!qtdX` |
| `my-master-secret` | `GitHub.com` | `test@gmail.com` | 20 | `!@#$%&*-_=+?` | 1 | `?X_BAbv4UHAfw=kYV$mh` |
| `my-master-secret` | `github.com` | `TEST@Gmail.com` | 20 | `!@#$%&*-_=+?` | 1 | `?X_BAbv4UHAfw=kYV$mh` |
| `my-master-secret` | `github.com` | `test@gmail.com` | 16 | `!@#$%&*-_=+?` | 1 | `-g_7CA9z$e2HQ3pA` |
| `my-master-secret` | `github.com` | `test@gmail.com` | 20 | `!@#$%&` | 1 | `ARHNdV4gYpUC4tVw9Kw&` |
| `my-master-secret` | `github.com` | `test@gmail.com` | 20 | `!@#$%&*-_=+?` | 2 | `!kGNn-dTzFGEyq82_9nz` |
| `different-secret` | `github.com` | `test@gmail.com` | 20 | `!@#$%&*-_=+?` | 1 | `srFmxZuM_2e4TJ_+=C3q` |
| `my-master-secret` | `home-wifi` | `test@gmail.com` | 20 | `!@#$%&*-_=+?` | 1 | `$64@hqN-ADm4U4$%?7Yr` |

Vectors 1, 3, and 4 MUST produce identical output (site and email case normalization).

### 8.3 Visual Fingerprint

| secret (UTF-8) | first 4 bytes (hex) | color indices |
|---|---|---|
| `my-master-secret` | `4482716f` | `[4, 2, 1, 7]` |
| `different-secret` | `d482d679` | `[4, 2, 6, 1]` |
| `a` | `b57cc734` | `[5, 4, 7, 4]` |

Note: The fingerprint uses the raw secret outside Argon2id and does not use email. Same secret always produces the same colors regardless of email. The existing sync authentication fixture is maintained separately in `keygrain/sync-vectors.json` as a JS-oracle/cross-platform regression fixture.

---

## 9. Security Properties

| Property | Guarantee |
|----------|-----------|
| Determinism | Same inputs always produce same output |
| Independence | Changing any input (site, email, length, symbols, counter) produces an uncorrelated output |
| Brute-force resistance | ~1s + 64 MiB per guess (Argon2id) |
| Per-user attack cost | Email in Argon2id salt prevents multi-target amortization |
| Single-password compromise | HMAC prevents deriving the strengthened key or other passwords from one output |
| No storage required | Passwords are recomputed on demand |

### 9.1 Limitations

- **Compromised device:** If an attacker extracts the raw secret from memory, strengthening provides no protection.
- **Very weak secrets:** A 4-digit PIN is brute-forceable. An empirical single-core measurement processed approximately 9.7 candidates per second, or approximately 17 minutes for 10,000 candidates. This is an empirical estimate, not a universal timing guarantee; actual rates vary with hardware, implementation, and runtime conditions.

---

## 10. Implementation Notes

### 10.1 Encoding

- All strings are UTF-8 encoded, no BOM, no null terminator.
- Email lowercasing is ASCII-only (per RFC 5321 local-part rules).
- The Argon2id "password" input is the raw `secret` bytes, not a hex or base64 encoding.
- The Argon2id output is raw bytes, used directly as the HMAC key (not hex-encoded).

### 10.2 Site Normalization

Before entering the derivation pipeline, site identifiers are normalized:

```
1. Strip leading "http://" or "https://" (case-insensitive)
2. Remove everything after the first "/", "?", or "#"
3. Strip trailing "/"
4. Lowercase
5. Strip leading "www."
```

This normalization is applied before the site enters the message string.

### 10.3 Stream Length

Byte consumption is non-deterministic due to rejection sampling. Implementations MUST extend the stream on demand via HMAC-SHA256 rounds with a 4-byte big-endian counter when consumption reaches the current stream. Implementations MAY pre-allocate `length * 3` bytes only as a performance hint; that allocation is not an exhaustion limit.

### 10.4 Minimum Password Length

Implementations MUST reject `length < 8`. The algorithm requires at least 4 characters for the forced categories plus room for meaningful shuffling.

### 10.5 Counter Semantics

The counter enables password rotation without changing any other parameter. Incrementing the counter produces an entirely new, uncorrelated password for the same site.

### 10.6 Cross-Platform Validation

All implementations MUST pass the test vectors in §8 identically. The reference implementation is `python/keygrain/derive.py`. A machine-readable `vectors.json` is provided at the repository root.

---

## 11. TOTP Seed Derivation (Model B)

Keygrain derives deterministic TOTP seeds for self-hosted services where the user controls the TOTP configuration. The derived seed is used with standard RFC 6238 TOTP code generation.

### 11.1 Formula

```
strengthened = strengthen(secret, email)                    // Per §3
message = UTF8_ENCODE(LOWERCASE(site) + ":" + LOWERCASE(email) + ":keygrain-totp")
seed = HMAC-SHA256(key = strengthened, message = message)  // 32 bytes
```

Site normalization follows §10.2. The full 32-byte output is the TOTP seed.

### 11.2 TOTP Code Generation (RFC 6238)

```
function generateTOTP(seed: bytes, time: int, digits: int, period: int, algorithm: string) -> string:
    T = floor(time / period)
    T_bytes = INT64_TO_BYTES_BIG_ENDIAN(T)    // 8 bytes
    hmac_result = HMAC(algorithm, key=seed, message=T_bytes)
    offset = hmac_result[len(hmac_result) - 1] & 0x0F
    code = ((hmac_result[offset] & 0x7F) << 24 |
            (hmac_result[offset+1] & 0xFF) << 16 |
            (hmac_result[offset+2] & 0xFF) << 8 |
            (hmac_result[offset+3] & 0xFF))
    otp = code % (10 ** digits)
    return ZERO_PAD_LEFT(otp, digits)
```

Supported algorithms: SHA1, SHA256, SHA512. Supported digits: 6, 8.

### 11.3 Test Vectors

Machine-readable vectors: `totp-vectors.json` at repository root.

**Derivation vectors** (all use Argon2id strengthening from §3):

| secret (UTF-8) | email | site | expected seed (hex) |
|---|---|---|---|
| `my-master-secret` | `test@gmail.com` | `github.com` | `70e3c85d59c28c927b1a356731c793f780289a486078f902b5861dc7e39b6b1c` |
| `my-master-secret` | `test@gmail.com` | `GitHub.com` | `70e3c85d59c28c927b1a356731c793f780289a486078f902b5861dc7e39b6b1c` |
| `my-master-secret` | `TEST@Gmail.com` | `github.com` | `70e3c85d59c28c927b1a356731c793f780289a486078f902b5861dc7e39b6b1c` |
| `different-secret` | `test@gmail.com` | `github.com` | `b6159a6a5111621662886bed56b5bec9d7394692e673c2d2263c9044ca8cfd88` |

Vectors 1–3 MUST produce identical output (site and email case normalization).

**RFC 6238 vectors** (Appendix B, digits=8, period=30):

Seeds: SHA1=`3132333435363738393031323334353637383930` (20 bytes), SHA256=`3132333435363738393031323334353637383930313233343536373839303132` (32 bytes), SHA512=`31323334353637383930313233343536373839303132333435363738393031323334353637383930313233343536373839303132333435363738393031323334` (64 bytes).

| Time | SHA1 | SHA256 | SHA512 |
|------|------|--------|--------|
| 59 | 94287082 | 46119246 | 90693936 |
| 1111111109 | 07081804 | 68084774 | 25091201 |
| 1111111111 | 14050471 | 67062674 | 99943326 |
| 1234567890 | 89005924 | 91819424 | 93441116 |
| 2000000000 | 69279037 | 90698825 | 38618901 |
| 20000000000 | 65353130 | 77737706 | 47863826 |

---

## 12. SSH Key Derivation

Keygrain derives deterministic Ed25519 SSH key pairs from the master secret without coupling to an account email. The 32-byte HMAC output serves directly as the Ed25519 seed.

### 12.1 Formula

```
strengthened = Argon2id(
    password = secret,
    salt     = UTF8_ENCODE("keygrain-ssh:" + LOWERCASE(key_name)),
    m        = 65536,
    t        = 3,
    p        = 1,
    len      = 32
)
message = UTF8_ENCODE(LOWERCASE(key_name) + ":" + DECIMAL(counter) + ":keygrain-ssh")
seed = HMAC-SHA256(key = strengthened, message = message)  // 32 bytes = Ed25519 seed
public_key = Ed25519_PublicKey_From_Seed(seed)             // 32 bytes
```

### 12.2 Parameters

| Parameter | Constraints |
|-----------|-------------|
| `key_name` | Non-empty, no whitespace, lowercased before use |
| `counter` | ≥ 1, decimal string with no leading zeros |

### 12.3 Authorized Keys Format

```
ssh-ed25519 <base64(key_type_blob || public_key_blob)> <lowercase(key_name)>
```

Where the binary blob is: `uint32(11) || "ssh-ed25519" || uint32(32) || public_key_bytes`. The comment is the lowercase `key_name`.

### 12.4 Test Vectors

Machine-readable vectors: `ssh-vectors.json` at repository root.

| # | secret (UTF-8) | key_name | counter | seed (hex) | public_key (hex) |
|---|---|---|---|---|---|
| 1 | `my-master-secret` | `github` | 1 | `54b4a6dc5d9d1147fcd50f7263ffeedb50b05b40de553105d552805a3fd09864` | `dd030383ed8e7b36807de678341bdab0606d17336ff64bf66f46c1129649b011` |
| 2 | `my-master-secret` | `work-servers` | 1 | `a77682dd0cadb362f5a44386852ac656b393084b329c3bdfde26add8fc9f5bec` | `54013af1906b69aae548396f7fbb800192ed2a95004b18c4df633f534fae4e9b` |
| 3 | `my-master-secret` | `github` | 2 | `ee2e85f222e76d15199135343db824f9dbe125c8c7fde1fda3cdaaf2a678397d` | `11fd80f28700727f93747de4e155cbff49da466787b3ac88c1efd17f39f7ad99` |
| 4 | `my-master-secret` | `GitHub` | 1 | `54b4a6dc5d9d1147fcd50f7263ffeedb50b05b40de553105d552805a3fd09864` | `dd030383ed8e7b36807de678341bdab0606d17336ff64bf66f46c1129649b011` |
| 5 | `different-secret` | `github` | 1 | `cb771f4b0f6cd599b29425e10ee41c43256b88d507d98a7d98242b4f6e4b5bca` | `f619687a9a572525ceb162d2d21f44609cc07eff4198b23edbe727eaac025c14` |

Vectors 1 and 4 MUST produce identical output (case normalization).

Authorized keys for vector 1: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIN0DA4Ptjns2gH3meDQb2rBgbRczb/ZL9m9GwRKWSbAR github`

---

## 13. HD Wallet Derivation

Keygrain derives deterministic BIP-39 mnemonics directly from the master secret without coupling to an account email or specific blockchain chain identifier. This is positioned as disaster recovery — not primary wallet management.

### 13.1 Formula

```
strengthened = Argon2id(
    password = secret,
    salt     = UTF8_ENCODE("keygrain-wallet:" + LOWERCASE(wallet_id)),
    m        = 65536,
    t        = 3,
    p        = 1,
    len      = 32
)
message = UTF8_ENCODE(
    LOWERCASE(wallet_id) + ":" + DECIMAL(words) + ":" + DECIMAL(counter) + ":keygrain-wallet"
)
raw_entropy = HMAC-SHA256(key = strengthened, message = message)  // 32 bytes

if words == 12:
    entropy = raw_entropy[0..15]     // 16 bytes = 128-bit BIP-39 entropy
else if words == 24:
    entropy = raw_entropy            // 32 bytes = 256-bit BIP-39 entropy

mnemonic = BIP39_ENTROPY_TO_MNEMONIC(entropy)  // 12 or 24 words
```

### 13.2 Parameters

| Parameter | Constraints |
|-----------|-------------|
| `wallet_id` | Non-empty, matches `[a-z0-9\-]+`, lowercased before use |
| `words` | Must be 12 or 24 (default: 24) |
| `counter` | ≥ 1, decimal string with no leading zeros |

### 13.3 BIP-39 Mnemonic Generation

```
1. checksum_bits = entropy_bits / 32                 // 4 bits for 128-bit entropy (12 words), 8 bits for 256-bit entropy (24 words)
2. checksum = SHA-256(entropy)[0] >> (8 - checksum_bits)
3. combined = entropy || checksum
4. Split into groups of 11 bits → index into BIP-39 English wordlist (2048 words)
5. mnemonic = words separated by spaces
```

### 13.4 BIP-39 Seed Derivation

```
seed = PBKDF2-SHA512(password=mnemonic, salt="mnemonic"+passphrase, iterations=2048, length=64)
```

Keygrain uses empty passphrase by default.

### 13.5 Test Vectors

Machine-readable vectors: `wallet-vectors.json` at repository root.

| # | secret (UTF-8) | wallet_id | words | counter | entropy (hex) | mnemonic (first 4 words) |
|---|---|---|---|---|---|---|
| 1 | `my-master-secret` | `personal` | 24 | 1 | `76ac28dac649cd29b1c77a6f50948f8d17db45b5e22182862c2bdae7f7eee2b8` | `issue genuine cute milk ...` |
| 2 | `my-master-secret` | `personal` | 12 | 1 | `cf91c3be4c216f6f3005c6906d6124a5` | `sort mix usage obscure ...` |
| 3 | `my-master-secret` | `personal` | 24 | 2 | `be489c6feb23dc22f841c12988069d967da16eca3c78e8c3f17965ce4fbd541a` | `salad eager brief stone ...` |
| 4 | `my-master-secret` | `savings` | 24 | 1 | `3f587f4e4aeb6db9dba7de5d1b2d043c64d7cae85ce520f9d707684419bf8506` | `dismiss sentence squeeze noise ...` |
| 5 | `my-master-secret` | `Personal` | 24 | 1 | `76ac28dac649cd29b1c77a6f50948f8d17db45b5e22182862c2bdae7f7eee2b8` | `issue genuine cute milk ...` |
| 6 | `different-secret` | `personal` | 24 | 1 | `3054f00fd8ce8ad9742f1a4267bc5bda56601a36ade3fc3ca5d53732d311c563` | `core pole advance ranch ...` |

Vectors 1 and 5 MUST produce identical output (case normalization).

### 13.6 Relationship to BIP-85

Keygrain wallet derivation is NOT BIP-85. BIP-85 derives child mnemonics from a parent BIP-39 mnemonic via BIP-32 hardened derivation. Keygrain derives entropy directly from the master secret via Argon2id + HMAC-SHA256 — no parent mnemonic required. BIP-85 compatibility is available as a separate feature in the Python CLI (see `designs/hd-wallet-derivation.md` §11).

---

## 14. Domain Separation

Derivations use isolated Argon2id salts and distinct HMAC messages. No two derivation types can produce the same message or share strengthened keys across domains.

| Derivation | Salt format | Message format | Unique suffix |
|------------|-------------|----------------|---------------|
| Password | `keygrain-strengthen:<email>` | `site:email:length:counter` | (ends with integer) |
| Auth ID | `keygrain-strengthen:<email>` | `email:keygrain-id` | `:keygrain-id` |
| Auth password | `keygrain-strengthen:<email>` | `email:32:keygrain-auth` | `:keygrain-auth` |
| Encryption key | `keygrain-strengthen:<email>` | `email:keygrain-encryption` | `:keygrain-encryption` |
| Fingerprint | (N/A) | `keygrain-fingerprint` | (standalone, key=raw secret) |
| TOTP seed | `keygrain-strengthen:<email>` | `site:email:keygrain-totp` | `:keygrain-totp` |
| SSH key | `keygrain-ssh:<key_name>` | `key_name:counter:keygrain-ssh` | `:keygrain-ssh` |
| Wallet | `keygrain-wallet:<wallet_id>` | `wallet_id:words:counter:keygrain-wallet` | `:keygrain-wallet` |
| CLI local cache | `keygrain-strengthen:<email>` | `email:keygrain-cli-cache` | `:keygrain-cli-cache` |

The `:keygrain-cli-cache` label keys the Python CLI's **local** encrypted cache (`~/.keygrain/accounts/<slug>.kg`). It produces no cross-platform output — it never leaves the machine and is not part of any client's synced data — so it has no test vector. It is registered here for collision-prevention and documentation completeness.

**Collision-free guarantee:** Each derivation ends with a unique literal suffix that is not a valid value for any other derivation's terminal field. Password messages end with a decimal integer; all other messages end with a non-numeric string. The named suffixes are all distinct. Furthermore, SSH and HD wallet derivations use domain-separated Argon2id salts (`keygrain-ssh:<name>` and `keygrain-wallet:<id>`), ensuring independent strengthened keys.

### 14.1 Cryptographic Independence & Non-Coupling Invariants

All implementations across all platforms MUST adhere to these strict invariants:

1. **Email-Coupled Derivations:**
   Only Passwords, Sync Auth credentials, Sync Encryption, Local Storage, and TOTP seeds are bound to the account email. Their Argon2id salt is strictly `UTF-8("keygrain-strengthen:" + lowercase(email))`.
2. **SSH Keypair Independence:**
   SSH key derivation is strictly decoupled from the account email.
   - Salt: `UTF-8("keygrain-ssh:" + lowercase(key_name))`
   - Message: `UTF-8(lowercase(key_name) + ":" + decimal(counter) + ":keygrain-ssh")`
   - Comment: Defaults to `lowercase(key_name)`
   - Implementations MUST NOT include email in the salt, HMAC message, or cryptographic derivation.
3. **HD Wallet Seed Independence:**
   HD wallet derivation is strictly decoupled from both the account email and blockchain ecosystem.
   - Salt: `UTF-8("keygrain-wallet:" + lowercase(wallet_id))`
   - Message: `UTF-8(lowercase(wallet_id) + ":" + decimal(words) + ":" + decimal(counter) + ":keygrain-wallet")`
   - Derivation produces a standard 12 or 24-word BIP-39 mnemonic seed phrase for disaster recovery. It does NOT generate BIP-32/BIP-44 multi-account wallet hierarchies, key trees, or addresses.
   - Implementations MUST NOT include email or chain in the salt, HMAC message, or cryptographic derivation.
4. **Independent Argon2id Strengthening:**
   Implementations MUST NOT reuse an email-strengthened key for SSH or Wallet derivations. Each domain uses independent Argon2id strengthening with its own domain-isolated salt.
