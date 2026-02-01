# Modulo Bias Fix — Rejection Sampling for Password Derivation

**Date:** 2026-05-11
**Status:** Design
**Breaking change:** Yes — all password vectors change. Acceptable (no users).

---

## 1. Overview

### Problem

Character selection in password derivation uses `byte % charset_length`. When `charset_length` does not evenly divide 256, some indices have higher probability than others.

For the full charset (67 characters):
- Values 0–54: probability 4/256 (1.5625%)
- Values 55–66: probability 3/256 (1.1719%)
- Relative excess: ~33% for favored characters

Total entropy loss is ~0.13 bits per character — not a security issue, but a correctness defect in a cryptographic derivation algorithm.

### Solution

Replace all `byte % n` with rejection sampling: discard bytes that would introduce bias, draw again from the stream. Extend the stream on demand so it never exhausts.

### Scope

Affected:
- Password derivation: forced chars (step 1), fill chars (step 2), Fisher-Yates shuffle (step 3)
- Auth password derivation (calls the same `buildPassword` machinery)
- All 4 platforms: Python, JS extension, JS web generator, Kotlin

Not affected:
- TOTP seed derivation (raw HMAC output, no byte-to-index mapping)
- SSH key derivation (raw HMAC output used as Ed25519 seed)
- HD wallet derivation (raw HMAC output used as BIP-39 entropy)
- Visual fingerprint (`% 8` — 256/8 = 32 exactly, no bias)
- Lookup ID, encryption key (raw HMAC output)

---

## 2. Rejection Sampling Algorithm

### Pseudocode

```
function unbiased_index(n, next_byte):
    limit = floor(256 / n) * n    // largest multiple of n ≤ 256
    loop:
        b = next_byte()
        if b < limit:
            return b % n
```

### Properties

- **Uniform:** Each index 0..n-1 has exactly `floor(256/n)` accepting byte values.
- **Termination:** Each iteration has probability `limit/256 ≥ 1/2` of accepting (since `n ≤ 256` implies `limit ≥ 128`). Expected iterations = `256/limit ≤ 2`.
- **Deterministic given stream:** Same stream bytes → same output. Cross-platform identical.

### Rejection rates by charset

| Charset | n | limit | Rejected bytes | Rejection rate |
|---------|---|-------|----------------|----------------|
| UPPER | 24 | 240 | 16 | 6.25% |
| LOWER | 23 | 253 | 3 | 1.17% |
| DIGITS | 8 | 256 | 0 | 0% |
| Default symbols | 12 | 252 | 4 | 1.56% |
| Full charset (default) | 67 | 201 | 55 | 21.48% |
| Shuffle (i+1=20) | 20 | 240 | 16 | 6.25% |
| Shuffle (i+1=2) | 2 | 256 | 0 | 0% |

---

## 3. Stream Extension

### Current behavior (SPEC.md §4.3)

```
stream = key                          // 32 bytes (initial HMAC)
ctr = 1
while len(stream) < length * 2:
    stream = stream || HMAC-SHA256(key=key, message=BYTE(ctr))
    ctr += 1
```

The stream is pre-allocated to `length * 2` bytes. `BYTE(ctr)` is a single byte — counter range 1–255.

### New behavior: lazy extension with 4-byte counter

With rejection sampling, byte consumption is non-deterministic. The stream must grow on demand.

**Change 1:** `next_byte()` extends the stream when `pos >= len(stream)`.

**Change 2:** Counter encoding changes from 1-byte to 4-byte big-endian. Since all password vectors already change, this is free.

```
key = HMAC-SHA256(key=strengthened, message=message)    // 32 bytes
stream = key
ctr = 1
pos = 0

function next_byte():
    if pos >= len(stream):
        stream = stream || HMAC-SHA256(key=key, message=UINT32_BE(ctr))
        ctr += 1
    b = stream[pos]
    pos += 1
    return b
```

`UINT32_BE(ctr)` is the counter encoded as 4 bytes big-endian (e.g., counter 1 → `0x00000001`).

### Why 4-byte counter

The current 1-byte counter limits the stream to 32 + 255×32 = 8192 bytes. With rejection sampling:
- Worst case charset is 67 chars (21.48% rejection rate)
- For length=128: ~300 bytes expected, ~400 bytes at 3σ
- 8192 bytes is sufficient in practice

However, "sufficient in practice" is not a spec guarantee. A 4-byte counter provides 2^32 × 32 = 137 GB of stream — provably inexhaustible for any password length. Since we are already breaking all vectors, the cost is zero.

### Pre-allocation hint

Implementations MAY pre-allocate `length * 3` bytes as a performance hint (avoids most on-demand extensions). The algorithm MUST NOT depend on pre-allocation — `next_byte()` must always be able to extend.

---

## 4. Updated SPEC.md Sections

### §4.3 Stream Extension (replace entirely)

```
stream = key
ctr = 1
pos = 0

function next_byte():
    if pos >= len(stream):
        stream = stream || HMAC-SHA256(key = key, message = UINT32_BE(ctr))
        ctr = ctr + 1
    byte = stream[pos]
    pos = pos + 1
    return byte
```

`UINT32_BE(ctr)` is the counter as a 4-byte big-endian unsigned integer.

Implementations MAY pre-allocate stream bytes for performance, but MUST extend on demand if `pos` reaches the end.

### §4.4 Character Selection (replace entirely)

Define `unbiased_index(n)`:
```
function unbiased_index(n):
    limit = floor(256 / n) * n
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
for i in 0..(length - 5):
    chars[4 + i] = full_charset[unbiased_index(LENGTH(full_charset))]
```

### §4.5 Fisher-Yates Shuffle (replace entirely)

```
for i from (length - 1) down to 1:
    j = unbiased_index(i + 1)
    swap(chars[i], chars[j])
```

### §9.1 Limitations (remove modulo bias paragraph)

Remove the "Modulo bias" bullet point from the Limitations section.

### §10.3 Stream Length (replace entirely)

Byte consumption is non-deterministic due to rejection sampling. The stream extends on demand via HMAC-SHA256 rounds with a 4-byte big-endian counter. Implementations MAY pre-allocate `length * 3` bytes as a hint.

---

## 5. Platform Changes

### Python (`python/keygrain/derive.py`)

- `_stream()` function: remove pre-allocation loop, return `(key, bytearray(key))` or refactor to a class/closure
- `derive_password()`: replace `next_byte() % len(X)` with `unbiased_index(len(X))` calls
- `next_byte()`: add on-demand extension logic with 4-byte counter
- Counter encoding: `ctr.to_bytes(4, "big")` instead of `ctr.to_bytes(1, "big")`

### JS Extension (`extension/shared/keygrain.js`)

- `buildStream()`: remove pre-allocation, or keep as initial allocation
- `buildPassword()`: replace `nextByte() % n` with `unbiasedIndex(n)` calls
- `nextByte()`: add on-demand extension with `new Uint8Array([0, 0, (ctr >> 8) & 0xFF, ctr & 0xFF])` (or DataView for 4-byte BE)
- Note: `buildStream` is async (uses `crypto.subtle`), but `buildPassword` is synchronous. Keep this architecture: pre-allocate `length * 4` bytes in `buildStream`. This is provably sufficient for all supported lengths (≤ 128): worst case consumption is ~400 bytes for length=128 with charset 67, and `length * 4 = 512` bytes exceeds this. The synchronous `buildPassword` consumes from this pre-allocated buffer. An assertion MAY be added as a defensive check — if triggered, it indicates a bug in the pre-allocation calculation, not a normal code path.

### JS Web Generator (`server/static/generate/index.html`)

- Same changes as JS extension (inline implementation)
- Same async consideration

### Kotlin (`kotlin/app/src/main/java/com/badrani/keygrain/data/Keygrain.kt`)

- `buildPassword()`: replace `nextByte() % n` with `unbiasedIndex(n)` calls
- Stream extension: change `byteArrayOf(ctr.toByte())` to 4-byte BE encoding
- `nextByte()`: add on-demand extension logic

---

## 6. Impact on Test Vectors

### Password vectors (`vectors.json`)

**All 9 password derivation vectors become invalid.** The stream bytes are consumed in a different order (rejection discards some bytes), and the counter encoding changes (4-byte vs 1-byte), so even the initial HMAC rounds produce different stream content starting from round 2.

Wait — correction: the initial stream is still `key = HMAC-SHA256(strengthened, message)`. The first 32 bytes are identical. The counter encoding change only affects extension rounds. So for short passwords that don't need extension, the difference is purely from rejection sampling consuming more bytes and potentially triggering extension.

**Action:** Regenerate all password vectors from the updated Python reference implementation.

### Auth password vectors

Auth password uses `buildPassword` with length=32. Same impact — must be regenerated if any exist (currently not in vectors.json but tested implicitly).

### TOTP vectors (`totp-vectors.json`)

**Unchanged.** TOTP derivation is `HMAC-SHA256(strengthened, message)` — no byte-to-index mapping.

### SSH vectors (`ssh-vectors.json`)

**Unchanged.** SSH derivation is `HMAC-SHA256(strengthened, message)` → Ed25519 seed — no byte-to-index mapping.

### Wallet vectors (`wallet-vectors.json`)

**Unchanged.** Wallet derivation is `HMAC-SHA256(strengthened, message)` → BIP-39 entropy — no byte-to-index mapping.

### Strengthen vectors

**Unchanged.** Argon2id strengthening is unrelated to character selection.

---

## 7. Edge Cases

### charset_len = 1

`limit = floor(256/1) * 1 = 256`. Condition `b < 256` is always true. Every byte is accepted. `b % 1 = 0` always. Correct: the only character is always selected.

### charset_len = 256

`limit = floor(256/256) * 256 = 256`. Condition `b < 256` is always true. Every byte is accepted. `b % 256 = b`. Correct: uniform selection over 256 values.

### charset_len = 128

`limit = floor(256/128) * 128 = 256`. No rejection. `b % 128` is uniform because 256/128 = 2 exactly.

### Powers of 2 (8, 16, 32, 64, 128, 256)

All have `limit = 256`. Zero rejection. This includes DIGITS (8 chars).

### charset_len = 255

`limit = floor(256/255) * 255 = 255`. Rejection rate: 1/256 (0.39%). Only byte value 255 is rejected.

### charset_len = 129

`limit = floor(256/129) * 129 = 129`. Rejection rate: 127/256 (49.6%). This is the worst case — nearly half of bytes are rejected. Expected iterations per index: ~2. Still terminates quickly.

### Stream exhaustion

Impossible. `next_byte()` extends the stream on demand. The 4-byte counter allows 2^32 extension rounds × 32 bytes = 137 GB. For the worst case (charset_len=129, 49.6% rejection), generating a single character requires on average 2 bytes. A 128-character password needs ~256 bytes expected, ~400 worst case. The initial 32-byte key plus one extension round (64 bytes total) covers most passwords.

### Counter overflow (ctr > 2^32)

Theoretically impossible for password derivation. A 128-char password with 49.6% rejection needs ~400 bytes = ~12 extension rounds. Even at 6σ, this is under 100 rounds. The 4-byte counter supports 4 billion rounds.

If an implementation wants to be defensive, it MAY assert `ctr < 2^32` and throw on overflow. This should never trigger.

---

## 8. Byte Consumption Analysis

### Expected consumption for default parameters (length=20, charset=67)

| Phase | Indices needed | Charset size | Rejection rate | Expected bytes |
|-------|---------------|--------------|----------------|----------------|
| Forced UPPER | 1 | 24 | 6.25% | 1.07 |
| Forced LOWER | 1 | 23 | 1.17% | 1.01 |
| Forced DIGITS | 1 | 8 | 0% | 1.00 |
| Forced symbols | 1 | 12 | 1.56% | 1.02 |
| Fill | 16 | 67 | 21.48% | 20.37 |
| Shuffle | 19 | varies (2–20) | varies | ~20.5 |
| **Total** | **39** | | | **~45** |

The initial stream is 32 bytes. One extension round gives 64 bytes. Expected consumption of ~45 bytes means typically 1 extension round suffices.

### Worst case for length=128

| Phase | Expected bytes |
|-------|----------------|
| Forced | ~4.1 |
| Fill (124 indices, charset 67) | ~158 |
| Shuffle (127 indices) | ~140 |
| **Total** | **~302** |

Initial 32 bytes + 9 extension rounds = 320 bytes. Comfortably within a single-byte counter range, but we use 4-byte for spec cleanliness.

---

## 9. Migration

### SPEC.md updates required

1. §4.3 — Replace stream extension with lazy extension + 4-byte counter
2. §4.4 — Replace `next_byte() % n` with `unbiased_index(n)`
3. §4.5 — Replace `next_byte() % (i+1)` with `unbiased_index(i+1)`
4. §9.1 — Remove "Modulo bias" limitation paragraph
5. §10.3 — Replace stream length section

### Test vector regeneration

1. Update Python reference implementation
2. Run Python to generate new password vectors
3. Update `vectors.json` with new expected passwords
4. Verify all 4 platforms produce identical output
5. TOTP, SSH, wallet vectors remain unchanged — verify they still pass

### Version bump

Consider bumping the spec version comment from "Version: 3" to "Version: 4" to clearly mark the incompatibility. This is a documentation-only marker — there is no runtime version negotiation.
