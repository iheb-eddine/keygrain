# Secret Fingerprint — Visual Verification

## 1. Overview

When the user types their master secret, the UI shows 4 colored circles ("fingerprint") derived deterministically from the secret. This lets the user verify they typed the correct secret before generating passwords — a quick visual check rather than relying on memory alone.

The fingerprint is:
- **Deterministic:** Same secret → same 4 colors, always.
- **Cross-platform identical:** Android, browser extension, and web generator all produce the same colors for the same secret.
- **Domain-separated:** Uses a distinct HMAC message from all other derivations.
- **Independent of email:** Depends only on the secret, so the user can verify before entering any other field.

## 2. Algorithm

### Derivation

```
fingerprint_bytes = HMAC-SHA256(secret_bytes, "keygrain-fingerprint")[0:4]
```

- **Key:** The raw secret encoded as UTF-8 bytes.
- **Message:** The literal ASCII string `"keygrain-fingerprint"` (20 bytes).
- **Output:** Take the first 4 bytes of the 32-byte HMAC result.

### Byte-to-Color Mapping

Each byte maps to one color:

```
color_index[i] = fingerprint_bytes[i] % 8
```

Since 256 % 8 = 0, there is zero modulo bias — perfectly uniform distribution.

### Palette (Wong Colorblind-Safe)

| Index | Hex       | Name           |
|-------|-----------|----------------|
| 0     | `#000000` | Black          |
| 1     | `#E69F00` | Orange         |
| 2     | `#56B4E9` | Sky Blue       |
| 3     | `#009E73` | Bluish Green   |
| 4     | `#F0E442` | Yellow         |
| 5     | `#0072B2` | Blue           |
| 6     | `#D55E00` | Vermillion     |
| 7     | `#CC79A7` | Reddish Purple |

This palette is distinguishable across protanopia, deuteranopia, and tritanopia.

### Collision Probability

8^4 = 4,096 possible fingerprints. For typo detection this is more than sufficient — a single-character typo will produce a completely different HMAC output, yielding a visually distinct fingerprint with >99.97% probability.

### Domain Separation

Existing HMAC messages in keygrain:
- `email:length:salt` (password derivation)
- `email:keygrain-id` (backup lookup)
- `email:keygrain-encryption` (backup encryption key)
- `keygrain-auth` as salt (auth password derivation)
- `keygrain-strengthen:email` (Argon2id salt)

The fingerprint message `"keygrain-fingerprint"` is distinct from all of these.

## 3. Platform Implementations

### JavaScript (Browser Extension + Web Generator)

```javascript
async function secretFingerprint(secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("keygrain-fingerprint"));
  const bytes = new Uint8Array(sig).slice(0, 4);
  return Array.from(bytes, b => b % 8);
}
```

Returns `[colorIndex0, colorIndex1, colorIndex2, colorIndex3]`.

### Kotlin (Android)

```kotlin
fun secretFingerprint(secret: ByteArray): List<Int> {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(secret, "HmacSHA256"))
    val hash = mac.doFinal("keygrain-fingerprint".toByteArray())
    return (0 until 4).map { (hash[it].toInt() and 0xFF) % 8 }
}
```

Returns `[colorIndex0, colorIndex1, colorIndex2, colorIndex3]`.

## 4. UI Placement

### Android (Compose)

- **Location:** Directly below the "Master Secret" `OutlinedTextField` on the `UnlockScreen`.
- **Appearance:** 4 filled circles, 16dp diameter, 8dp horizontal gap between them.
- **Visibility:** Hidden when the secret field is empty. Shown after debounce when non-empty.
- **Animation:** Fade in when fingerprint appears/changes. No animation on hide (instant).

### Browser Extension (popup.html)

- **Location:** Directly below the `<input id="secret">` field.
- **Appearance:** 4 filled circles, 12px diameter, 6px gap. Rendered as `<span>` elements with `border-radius: 50%` and `background-color` set to the palette hex.
- **Container:** A `<div id="fingerprint">` row, hidden by default, shown when fingerprint is computed.

### Web Generator (generate/index.html)

- **Location:** Directly below the secret input field.
- **Appearance:** Same as browser extension — 4 circles, 12px diameter, 6px gap.
- **Implementation:** Inline `<div>` with circle spans, same as extension.

## 5. Debounce Strategy

| Event | Action |
|-------|--------|
| Secret field becomes empty | Hide fingerprint **immediately** (no debounce) |
| Keystroke while field non-empty | Reset 500ms timer |
| 500ms timer fires | Compute fingerprint, display circles |
| Secret field gains focus (non-empty, no fingerprint shown) | Compute immediately |

### Rationale

- **500ms debounce:** Avoids computing HMAC on every keystroke. HMAC-SHA256 is fast (~microseconds) but the debounce prevents visual flicker as colors change rapidly during typing.
- **Immediate hide on empty:** Prevents stale fingerprint lingering after the user clears the field.
- **No loading indicator:** HMAC-SHA256 computation is sub-millisecond; no perceptible delay.

## 6. Test Plan

### Cross-Platform Test Vectors

Add to `vectors.json` (or a new `fingerprint-vectors.json`):

```json
{
  "fingerprint_vectors": [
    {
      "secret_utf8": "my-master-secret",
      "secret_hex": "6d792d6d61737465722d736563726574",
      "hmac_message": "keygrain-fingerprint",
      "expected_first_4_bytes_hex": "4482716f",
      "expected_color_indices": [4, 2, 1, 7],
      "_note": "Primary test vector — Yellow, Sky Blue, Orange, Reddish Purple"
    },
    {
      "secret_utf8": "different-secret",
      "secret_hex": "646966666572656e742d736563726574",
      "hmac_message": "keygrain-fingerprint",
      "expected_first_4_bytes_hex": "d482d679",
      "expected_color_indices": [4, 2, 6, 1],
      "_note": "Different secret — Yellow, Sky Blue, Vermillion, Orange"
    },
    {
      "secret_utf8": "a",
      "secret_hex": "61",
      "hmac_message": "keygrain-fingerprint",
      "expected_first_4_bytes_hex": "b57cc734",
      "expected_color_indices": [5, 4, 7, 4],
      "_note": "Single character — Blue, Yellow, Reddish Purple, Yellow"
    },
    {
      "secret_utf8": "contraseña-maëstro",
      "secret_hex": "636f6e7472617365c3b1612d6d61c3ab7374726f",
      "hmac_message": "keygrain-fingerprint",
      "expected_first_4_bytes_hex": "d2c122a0",
      "expected_color_indices": [2, 1, 2, 0],
      "_note": "Unicode secret (UTF-8) — Sky Blue, Orange, Sky Blue, Black"
    }
  ]
}
```

### Test Cases

1. **Determinism:** Same secret → same 4 color indices on every call.
2. **Cross-platform:** Python, Kotlin, and JS all produce identical indices for each test vector.
3. **Sensitivity:** Changing one character of the secret produces a different fingerprint.
4. **Empty input:** No computation triggered, no circles shown.
5. **Unicode:** Secrets with non-ASCII characters produce consistent results (UTF-8 encoding).

## 7. Security Considerations

### Does the fingerprint leak information about the secret?

**Minimal, acceptable leakage.** The fingerprint reveals 4 bytes of `HMAC-SHA256(secret, "keygrain-fingerprint")`. This is equivalent to revealing a 4-byte hash of the secret:

- It does NOT help recover the secret (HMAC is a one-way function).
- It DOES allow an attacker to verify a guessed secret (compute HMAC, check if colors match).
- However, this is no worse than any other "check your password" mechanism. The attacker would need physical/visual access to the user's screen AND a candidate secret to verify.

### Timing side-channels

HMAC-SHA256 is constant-time in all standard implementations (Web Crypto API, `javax.crypto.Mac`, Python `hmac` module). No timing leakage.

### Shoulder surfing

An observer who memorizes the 4 colors can later verify secret guesses offline. Mitigations:
- The circles are small and transient (only visible while the secret field is focused and non-empty).
- 4,096 possible fingerprints means an attacker still needs to guess the secret — the fingerprint only confirms/denies a guess.
- This is an acceptable usability/security tradeoff. The feature's purpose is typo detection, not security.

### Brute-force amplification

The fingerprint does NOT reduce the search space for brute-forcing the secret. An attacker who knows the 4 colors can eliminate 4095/4096 of candidates per guess, but each guess still requires computing HMAC-SHA256. For high-entropy secrets, this is negligible. For low-entropy secrets (passphrases), the Argon2id strengthening layer is the primary defense — the fingerprint does not bypass it since it operates on the raw secret, not the strengthened one.

### Recommendation

No additional mitigations needed. The fingerprint is a local-only, transient UI element with negligible security impact.
