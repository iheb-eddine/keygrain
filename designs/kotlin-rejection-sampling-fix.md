# Kotlin Rejection Sampling Fix — `Keygrain.kt`

**Date:** 2026-05-11
**Scope:** `buildPassword()` function only
**Breaking:** Yes — all password vectors change

---

## 1. What Changes

Only the `buildPassword()` private function in `Keygrain.kt` is modified. Three bugs fixed:

| Bug | Current | Fixed |
|-----|---------|-------|
| Modulo bias | `nextByte() % n` | `unbiasedIndex(n)` with rejection sampling |
| 1-byte counter | `byteArrayOf(ctr.toByte())` | 4-byte big-endian via `ByteBuffer` |
| Fixed pre-allocation | `while (stream.size < length * 2)` | On-demand extension inside `nextByte()` |

## 2. What Does NOT Change

- `strengthenSecret()` — Argon2id derivation
- `clearStrengthenCache()`
- `derivePassword()` — only calls `buildPassword()`
- `deriveAuthPassword()` — only calls `buildPassword()`
- `deriveLookupId()` — raw HMAC, no character selection
- `deriveEncryptionKey()` — raw HMAC
- `secretFingerprint()` — uses `% 8` (256/8=32, no bias)
- `hmacSha256()` — utility function
- `estimateEntropy()` / `entropyLabel()` — UI helpers
- Character set constants (`UPPER`, `LOWER`, `DIGITS`, `DEFAULT_SYMBOLS`)

## 3. New `buildPassword()` — Complete Replacement

```kotlin
private fun buildPassword(secret: ByteArray, message: ByteArray, length: Int, symbols: String): String {
    val key = hmacSha256(secret, message)
    val stream = mutableListOf<Byte>()
    stream.addAll(key.toList())
    var ctr = 1
    var pos = 0

    fun nextByte(): Int {
        if (pos >= stream.size) {
            val ctrBytes = java.nio.ByteBuffer.allocate(4).putInt(ctr).array()
            stream.addAll(hmacSha256(key, ctrBytes).toList())
            ctr++
        }
        val b = stream[pos].toInt() and 0xFF
        pos++
        return b
    }

    fun unbiasedIndex(n: Int): Int {
        val limit = (256 / n) * n
        while (true) {
            val b = nextByte()
            if (b < limit) return b % n
        }
    }

    val fullCharset = UPPER + LOWER + DIGITS + symbols
    val chars = mutableListOf(
        UPPER[unbiasedIndex(UPPER.length)],
        LOWER[unbiasedIndex(LOWER.length)],
        DIGITS[unbiasedIndex(DIGITS.length)],
        symbols[unbiasedIndex(symbols.length)],
    )
    repeat(length - 4) {
        chars.add(fullCharset[unbiasedIndex(fullCharset.length)])
    }
    for (i in (length - 1) downTo 1) {
        val j = unbiasedIndex(i + 1)
        val tmp = chars[i]
        chars[i] = chars[j]
        chars[j] = tmp
    }
    return chars.joinToString("")
}
```

## 4. Key Details

### 4.1 `unbiasedIndex(n)` — Rejection Sampling

```kotlin
fun unbiasedIndex(n: Int): Int {
    val limit = (256 / n) * n   // largest multiple of n ≤ 256
    while (true) {
        val b = nextByte()
        if (b < limit) return b % n
    }
}
```

- Integer division `256 / n` floors automatically in Kotlin
- For n=67 (full charset): limit=201, rejection rate=21.48%
- For n=8 (digits): limit=256, rejection rate=0%
- Worst case n=129: limit=129, rejection rate=49.6%, expected 2 iterations

### 4.2 4-Byte Big-Endian Counter

```kotlin
val ctrBytes = java.nio.ByteBuffer.allocate(4).putInt(ctr).array()
```

- `java.nio.ByteBuffer` is big-endian by default
- Counter 1 → `[0x00, 0x00, 0x00, 0x01]`
- Replaces `byteArrayOf(ctr.toByte())` which encoded counter 1 as `[0x01]`

### 4.3 On-Demand Stream Extension

```kotlin
fun nextByte(): Int {
    if (pos >= stream.size) {
        val ctrBytes = java.nio.ByteBuffer.allocate(4).putInt(ctr).array()
        stream.addAll(hmacSha256(key, ctrBytes).toList())
        ctr++
    }
    val b = stream[pos].toInt() and 0xFF
    pos++
    return b
}
```

- Stream starts as 32 bytes (initial HMAC key)
- Extends by 32 bytes per round, only when needed
- `and 0xFF` ensures unsigned byte (0–255) — preserved from current code
- No pre-allocation loop — the `while (stream.size < length * 2)` loop is deleted entirely

## 5. Diff Summary

Lines removed from current `buildPassword()`:
```kotlin
// DELETE: fixed pre-allocation loop
while (stream.size < length * 2) {
    stream.addAll(hmacSha256(key, byteArrayOf(ctr.toByte())).toList())
    ctr++
}

// DELETE: nextByte without extension logic
fun nextByte(): Int {
    val b = stream[pos].toInt() and 0xFF
    pos++
    return b
}

// DELETE: all modulo-based indexing
UPPER[nextByte() % UPPER.length]
LOWER[nextByte() % LOWER.length]
DIGITS[nextByte() % DIGITS.length]
symbols[nextByte() % symbols.length]
fullCharset[nextByte() % fullCharset.length]
val j = nextByte() % (i + 1)
```

Lines added:
- `nextByte()` with on-demand extension (4-byte BE counter)
- `unbiasedIndex(n)` function
- All indexing calls use `unbiasedIndex(X.length)` instead of `nextByte() % X.length`

## 6. Correctness Argument

1. **Matches Python reference exactly:** Same algorithm structure — `next_byte()` extends on demand, `unbiased_index(n)` rejects biased bytes, same character selection order, same Fisher-Yates direction.

2. **Counter encoding matches:** Python uses `ctr.to_bytes(4, "big")`, Kotlin uses `ByteBuffer.allocate(4).putInt(ctr).array()` — both produce identical 4-byte big-endian output.

3. **Stream never exhausts:** `nextByte()` extends before reading. 4-byte counter supports 2³² rounds × 32 bytes = 137 GB.

4. **Unsigned byte handling preserved:** `stream[pos].toInt() and 0xFF` converts signed Kotlin `Byte` (-128..127) to unsigned `Int` (0..255).

5. **No import changes needed:** `java.nio.ByteBuffer` is in the standard library, used inline with fully qualified name.
