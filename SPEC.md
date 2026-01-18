# Keygrain Algorithm Specification

**Version:** 3 (Argon2id mandatory)
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
| `symbols` | string | ≥ 1 character | `!@#$%&*-_=+?` | Per-service |
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
while LENGTH(stream) < length * 2:
    stream = stream || HMAC-SHA256(key = key, message = BYTE(ctr))
    ctr = ctr + 1
```

`BYTE(ctr)` is a single byte with value `ctr` (big-endian, 1 byte). The stream must be at least `length * 2` bytes. Bytes are consumed sequentially via a position counter starting at 0.

### 4.4 Character Selection

Define `next_byte()` as: return `stream[pos]`, then `pos = pos + 1`.

**Step 1 — Force one character from each category (in order):**

```
chars[0] = UPPER[next_byte() % 24]
chars[1] = LOWER[next_byte() % 23]
chars[2] = DIGITS[next_byte() % 8]
chars[3] = symbols[next_byte() % LENGTH(symbols)]
```

**Step 2 — Fill remaining positions from full charset:**

```
full_charset = UPPER + LOWER + DIGITS + symbols
for i in 0..(length - 5):
    chars[4 + i] = full_charset[next_byte() % LENGTH(full_charset)]
```

### 4.5 Fisher-Yates Shuffle

```
for i from (length - 1) down to 1:
    j = next_byte() % (i + 1)
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
stream = build_stream(key = strengthened, message = message, needed = 64)
auth_password = build_password(stream, length = 32, symbols = "!@#$%&*-_=+?")
```

This uses the same `build_stream` (§4.3) and `build_password` (§4.4 + §4.5) machinery as regular password derivation, with hardcoded length=32 and default symbols.

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

A 4-color visual indicator derived from the strengthened key, allowing users to verify they entered the correct secret.

### 7.1 Derivation

```
strengthened = strengthen(secret, email)
message = UTF8_ENCODE("keygrain-fingerprint")
hash = HMAC-SHA256(key = strengthened, message = message)
color_indices = [hash[0] % 8, hash[1] % 8, hash[2] % 8, hash[3] % 8]
```

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

All values verified against the reference Python implementation (`argon2-cffi`).

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
| `my-master-secret` | `github.com` | `test@gmail.com` | 20 | `!@#$%&*-_=+?` | 1 | `A=4BXNAHYUU_hmVwv$h?` |
| `my-master-secret` | `google.com` | `test@gmail.com` | 20 | `!@#$%&*-_=+?` | 1 | `=78WtX?e!hpp6?TMqddW` |
| `my-master-secret` | `GitHub.com` | `test@gmail.com` | 20 | `!@#$%&*-_=+?` | 1 | `A=4BXNAHYUU_hmVwv$h?` |
| `my-master-secret` | `github.com` | `TEST@Gmail.com` | 20 | `!@#$%&*-_=+?` | 1 | `A=4BXNAHYUU_hmVwv$h?` |
| `my-master-secret` | `github.com` | `test@gmail.com` | 16 | `!@#$%&*-_=+?` | 1 | `gp4QHeNzA72YX-_A` |
| `my-master-secret` | `github.com` | `test@gmail.com` | 20 | `!@#$%&` | 1 | `AR4HdgNVYpUC4tVw9Kw&` |
| `my-master-secret` | `github.com` | `test@gmail.com` | 20 | `!@#$%&*-_=+?` | 2 | `GnkEz!F9-z_NqkGTy4n2` |
| `different-secret` | `github.com` | `test@gmail.com` | 20 | `!@#$%&*-_=+?` | 1 | `q=xsG_Tm3_MCeJ2GZ4zF` |
| `my-master-secret` | `home-wifi` | `test@gmail.com` | 20 | `!@#$%&*-_=+?` | 1 | `4$$7A-h4U6YqDm@zb?%4` |

Vectors 1, 3, and 4 MUST produce identical output (site and email case normalization).

### 8.3 Visual Fingerprint

| secret (UTF-8) | email | first 4 bytes (hex) | color indices |
|---|---|---|---|
| `my-master-secret` | `test@gmail.com` | `ee276b25` | `[6, 7, 3, 5]` |
| `different-secret` | `test@gmail.com` | `1b7e0c53` | `[3, 6, 4, 3]` |
| `a` | `test@gmail.com` | `a2ff4deb` | `[2, 7, 5, 3]` |

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
- **Very weak secrets:** A 4-digit PIN is brute-forceable (~3 hours at 1s/guess for 10⁴ candidates).
- **Modulo bias:** Character selection uses `byte % charset_length`. For the full charset (67 characters), some characters have selection probability 4/256 vs 3/256 — a relative excess of ~5%. This reduces total password entropy by less than 1 bit for all supported lengths. Acceptable for password generation.

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

The stream must be at least `length * 2` bytes. The exact consumption is:
- 4 bytes for forced characters
- `length - 4` bytes for fill
- `length - 1` bytes for shuffle
- Total: `2 * length - 1` bytes

Using `length * 2` provides a 1-byte margin and simplifies the calculation.

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

Keygrain derives deterministic Ed25519 SSH key pairs. The 32-byte HMAC output serves directly as the Ed25519 seed.

### 12.1 Formula

```
strengthened = strengthen(secret, email)                    // Per §3
message = UTF8_ENCODE(LOWERCASE(email) + ":" + LOWERCASE(key_name) + ":" + DECIMAL(counter) + ":keygrain-ssh")
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
ssh-ed25519 <base64(key_type_blob || public_key_blob)> <lowercase(email)>:<lowercase(key_name)>
```

Where the binary blob is: `uint32(11) || "ssh-ed25519" || uint32(32) || public_key_bytes`.

### 12.4 Test Vectors

Machine-readable vectors: `ssh-vectors.json` at repository root.

| # | secret (UTF-8) | email | key_name | counter | seed (hex) | public_key (hex) |
|---|---|---|---|---|---|---|
| 1 | `my-master-secret` | `test@gmail.com` | `github` | 1 | `15d7cd5c74358c1cd7f7f93ef45d074afcf6fd9e008a94de9e8608a330d96dc1` | `f2aadbd608703b65bb87d3d1c746c48dfed9095a2b7ae4c8ada057afa6bf9032` |
| 2 | `my-master-secret` | `test@gmail.com` | `work-servers` | 1 | `d415ea7afd4b8e113bee60f42ae84b387b564f38e8b95a0c3326b3720d5fb9f0` | `5050a666581b46ebd076f5f902eaaa14a2dc7b14bdeada5fae5c861e049530e0` |
| 3 | `my-master-secret` | `test@gmail.com` | `github` | 2 | `657c26252e9b425f83f5fd763177b75ea7046b4f9167a2116f248c19455ab9e2` | `1d921af7c1c68c75100e741008e903a28b14fc42fce5c0e33803f1cb3bbed16a` |
| 4 | `my-master-secret` | `TEST@Gmail.com` | `GitHub` | 1 | `15d7cd5c74358c1cd7f7f93ef45d074afcf6fd9e008a94de9e8608a330d96dc1` | `f2aadbd608703b65bb87d3d1c746c48dfed9095a2b7ae4c8ada057afa6bf9032` |
| 5 | `different-secret` | `test@gmail.com` | `github` | 1 | `247c4840e93dd75558b52c3979ed67420de5093f22fb1cdd74e86202d1f17e99` | `60efc824475a7a03dfba1bfc6abc49c4d4156bd705872fcf5615b00d210999ba` |

Vectors 1 and 4 MUST produce identical output (case normalization).

Authorized keys for vector 1: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPKq29YIcDtlu4fT0cdGxI3+2QlaK3rkyK2gV6+mv5Ay test@gmail.com:github`

---

## 13. HD Wallet Derivation

Keygrain derives deterministic BIP-39 mnemonics from the master secret. This is positioned as disaster recovery — not primary wallet management.

### 13.1 Formula

```
strengthened = strengthen(secret, email)                    // Per §3
message = UTF8_ENCODE(
    LOWERCASE(email) + ":" + LOWERCASE(wallet_name) + ":" + LOWERCASE(chain) + ":" + DECIMAL(counter) + ":keygrain-wallet"
)
entropy = HMAC-SHA256(key = strengthened, message = message)  // 32 bytes = 256-bit BIP-39 entropy
mnemonic = BIP39_ENTROPY_TO_MNEMONIC(entropy)                // 24 words
```

### 13.2 Parameters

| Parameter | Constraints |
|-----------|-------------|
| `wallet_name` | Non-empty, matches `[a-z0-9\-]+`, lowercased before use |
| `chain` | Must be in SUPPORTED_CHAINS enum, lowercased before use |
| `counter` | ≥ 1, decimal string with no leading zeros |

**Supported chains:** `bitcoin`, `ethereum`, `solana`, `litecoin`, `dogecoin`, `bitcoin-testnet`, `polkadot`, `cosmos`, `avalanche`.

### 13.3 BIP-39 Mnemonic Generation

```
1. checksum = SHA-256(entropy)[0]                    // first byte = 8 bits for 256-bit entropy
2. combined = entropy || checksum                    // 264 bits
3. Split into 24 groups of 11 bits → index into BIP-39 English wordlist (2048 words)
4. mnemonic = 24 words separated by spaces
```

### 13.4 BIP-39 Seed Derivation

```
seed = PBKDF2-SHA512(password=mnemonic, salt="mnemonic"+passphrase, iterations=2048, length=64)
```

Keygrain uses empty passphrase by default.

### 13.5 Test Vectors

Machine-readable vectors: `wallet-vectors.json` at repository root.

| # | secret (UTF-8) | email | wallet_name | chain | counter | entropy (hex) | mnemonic (first 4 words) |
|---|---|---|---|---|---|---|---|
| 1 | `my-master-secret` | `test@gmail.com` | `personal` | `bitcoin` | 1 | `855df06ee1e2aeafe35a532abc2dad8843338335a04fec06ded23214cc4a4c5d` | `luxury usage brick sense ...` |
| 2 | `my-master-secret` | `test@gmail.com` | `personal` | `ethereum` | 1 | `81af061b01988ff5c671cb710daaa7362fc41179ae5b623ee7ad162c530d8d5b` | `like join man add ...` |
| 3 | `my-master-secret` | `test@gmail.com` | `personal` | `bitcoin` | 2 | `600ba4cdd3389276ebebe31a4c5c9f3958a98649a56872767a1ec8970193fd85` | `gas frog cricket please ...` |
| 4 | `my-master-secret` | `test@gmail.com` | `savings` | `bitcoin` | 1 | `c099d1be9c505c3e35e520054317e3e881dd9f5e611f0b61eada5ae6dc0ecb2a` | `scene soldier hurry december ...` |
| 5 | `my-master-secret` | `TEST@Gmail.com` | `Personal` | `Bitcoin` | 1 | `855df06ee1e2aeafe35a532abc2dad8843338335a04fec06ded23214cc4a4c5d` | `luxury usage brick sense ...` |
| 6 | `different-secret` | `test@gmail.com` | `personal` | `bitcoin` | 1 | `793b9c75b251dd669e5022250485188015944885c33794b4406a5c426c6cf966` | `junior table buddy gorilla ...` |

Vectors 1 and 5 MUST produce identical output (case normalization).

### 13.6 Relationship to BIP-85

Keygrain wallet derivation is NOT BIP-85. BIP-85 derives child mnemonics from a parent BIP-39 mnemonic via BIP-32 hardened derivation. Keygrain derives entropy directly from the master secret via Argon2id + HMAC-SHA256 — no parent mnemonic required. BIP-85 compatibility is available as a separate feature in the Python CLI (see `designs/hd-wallet-derivation.md` §11).

---

## 14. Domain Separation

All derivations use the same strengthened key but produce independent outputs via distinct HMAC messages. No two derivation types can produce the same message for any input values.

| Derivation | Message format | Unique suffix |
|------------|---------------|---------------|
| Password | `site:email:length:counter` | (ends with integer) |
| Auth ID | `email:keygrain-id` | `:keygrain-id` |
| Auth password | `email:32:keygrain-auth` | `:keygrain-auth` |
| Encryption key | `email:keygrain-encryption` | `:keygrain-encryption` |
| Fingerprint | `keygrain-fingerprint` | (standalone) |
| TOTP seed | `site:email:keygrain-totp` | `:keygrain-totp` |
| SSH key | `email:key_name:counter:keygrain-ssh` | `:keygrain-ssh` |
| Wallet | `email:wallet_name:chain:counter:keygrain-wallet` | `:keygrain-wallet` |

**Collision-free guarantee:** Each derivation ends with a unique literal suffix that is not a valid value for any other derivation's terminal field. Password messages end with a decimal integer; all other messages end with a non-numeric string. The named suffixes are all distinct.
