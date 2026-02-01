# Fingerprint Dot Visibility, ARIA Role, and Rejection Sampling Boundary Test

## Bug 7: Black Fingerprint Dot Invisible on Dark Background

### Problem

The Wong palette index 0 is `#000000`. On the extension's dark mode background (`--bg: #1a1a2e`), the black dot is nearly invisible (contrast ratio ~1.07:1). The extension's `.fp-dot` CSS rule has no border, unlike the web generator which already has `border: 1px solid var(--border)`.

### Fix

Add `border: 1px solid var(--border)` to `.fp-dot` in `extension/shared/popup.css`:

```css
.fp-dot { width: 12px; height: 12px; border-radius: 50%; border: 1px solid var(--border); }
```

The extension already defines `--border` for both themes:
- Light: `--border: #cccccc` — visible boundary against white bg
- Dark: `--border: #3a3a50` — visible boundary against `#1a1a2e` bg

No changes to the web generator — it already has this fix.

### Constraint

The Wong palette colors themselves are NOT changed. They are part of the algorithm's visual identity.

---

## Bug 8: Fingerprint Div Missing `role="img"`

### Problem

The fingerprint div has `aria-label` but no `role="img"`. Without the role, screen readers treat it as a generic div and do not announce the aria-label.

### Fix

**Web generator** (`server/static/generate/index.html`):

```html
<div id="fingerprint" role="img" aria-label="Visual fingerprint" aria-describedby="fingerprint-hint"></div>
```

**Extension** (`extension/shared/popup.html`):

```html
<div id="fingerprint" role="img" aria-label="Secret fingerprint"></div>
```

---

## Bug 9: Rejection Sampling Boundary Test

### Problem

No test verifies that `unbiasedIndex` correctly rejects bytes >= limit. For the full charset (length 67: UPPER=24 + LOWER=23 + DIGITS=8 + symbols=12 = 67), `limit = floor(256/67) * 67 = 201`. Bytes 201–255 should be consumed from the stream but not used for character selection.

### Fix

Add a test in `extension/tests/test.mjs` that exercises `buildPassword` with a crafted byte stream containing a rejected byte.

**Test logic:**

1. Construct a "valid" stream of bytes all < 201 that produces a known password of length 8 (minimum). This requires enough valid bytes for: 4 mandatory chars + 4 fill chars + 7 shuffle operations = ~15+ valid bytes.

2. Construct a "rejected" stream by prepending byte `255` (which is >= 201) to the valid stream.

3. Call `buildPassword(rejectedStream, 8, "!@#$%&*-_=+?")` and `buildPassword(validStream, 8, "!@#$%&*-_=+?")`.

4. Assert both produce the same password — proving byte 255 was consumed and rejected.

**Test code:**

```javascript
await test('buildPassword: rejects bytes >= limit (rejection sampling boundary)', async () => {
  // For charset 67, limit = 201. Byte 255 must be skipped.
  // Build a valid stream: all bytes < 201
  const valid = new Uint8Array([
    10, 5, 3, 7,   // mandatory chars (upper, lower, digit, symbol)
    20, 30, 40, 50, // fill chars
    3, 2, 1, 6, 5, 4, 0  // shuffle indices (for i=7..1, need unbiasedIndex(i+1))
  ]);
  // Prepend a rejected byte
  const rejected = new Uint8Array([255, ...valid]);

  const pw1 = runInContext(`buildPassword(new Uint8Array([${valid.join(',')}]), 8, "!@#$%&*-_=+?")`, ctx);
  const pw2 = runInContext(`buildPassword(new Uint8Array([${rejected.join(',')}]), 8, "!@#$%&*-_=+?")`, ctx);
  assert.equal(pw1, pw2);
});
```

### Python Note

The Python `unbiased_index` is a closure inside `derive_password` and not directly testable without refactoring. A Python boundary test could be added in the future by either extracting the function or by finding a known input whose HMAC stream contains a byte >= limit at a known position. Out of scope for this change.
