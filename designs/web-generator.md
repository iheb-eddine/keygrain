# Web Password Generator — Design Document

## 1. Overview

A client-side web password generator for Keygrain, served as a single HTML page at `/generate`. It implements the same deterministic password derivation algorithm as the Python and Kotlin versions using the Web Crypto API. No external dependencies, no build step, no server interaction.

The page is self-contained (HTML + CSS + JS in one file) and produces **identical output** to the other implementations for the same inputs.

## 2. Algorithm Port Details

### Web Crypto API Specifics

The algorithm uses HMAC-SHA256 exclusively. Web Crypto provides this via:

```js
const key = await crypto.subtle.importKey("raw", keyBytes, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
const sig = await crypto.subtle.sign("HMAC", key, messageBytes);
```

Both operations are async (return Promises), so the generation function is `async`.

### Encoding

- **Secret:** UTF-8 encoded via `new TextEncoder().encode(secret)`. Matches Python `.encode()` and Kotlin `.toByteArray()` (both default UTF-8).
- **Message string:** `lowercase(email) + ":" + String(length) + ":" + salt` — also UTF-8 encoded via `TextEncoder`.
- **Extension counter:** Single byte as `Uint8Array([counter])`. Matches Python `counter.to_bytes(1, "big")` and Kotlin `byteArrayOf(counter.toByte())`. This is the most critical cross-platform alignment point.

### Stream Construction

```
key = HMAC-SHA256(secret_bytes, message_bytes)        // 32 bytes
stream = key || HMAC-SHA256(key, [0x01]) || HMAC-SHA256(key, [0x02]) || ...
```

Each extension appends 32 bytes. The stream is pre-allocated in a loop (`while stream.length < length * 2`) before any byte consumption begins, matching the Python and Kotlin implementations.

### Byte Budget

Total bytes consumed per generation:
- 4 bytes for forced characters (one per category: upper, lower, digit, symbol)
- `length - 4` bytes for fill characters
- `length - 1` bytes for Fisher-Yates shuffle

Total: `2 * length - 1` bytes. The stream is pre-allocated in a loop until `stream.length >= length * 2`, matching the reference implementations. This guarantees sufficient bytes are available before character selection begins.

### Charsets (identical to SPEC.md)

```
UPPER:   ABCDEFGHJKLMNPQRSTUVWXYZ   (23 chars, excludes I, O)
LOWER:   abcdefghjkmnpqrstuvwxyz    (23 chars, excludes l, o)
DIGITS:  23456789                    (8 chars, excludes 0, 1)
SYMBOLS: (user-provided, default: !@#$%&*-_=+?)
```

### Character Selection

```
char = charset[stream[byteIndex] % charset.length]
byteIndex++
```

Modulo bias is <1% for all charset sizes under 100 (acceptable per SPEC.md).

### Steps

1. Derive key: `HMAC-SHA256(secret_bytes, message_bytes)`
2. Force one char from each category (upper, lower, digits, symbols) — 4 bytes consumed
3. Fill remaining `length - 4` positions from full charset (upper + lower + digits + symbols)
4. Fisher-Yates shuffle: for `i` from `length - 1` down to `1`, `j = stream[byteIndex++] % (i + 1)`, swap positions `i` and `j`

## 3. UI Layout

### Page Structure

```
┌─────────────────────────────────────┐
│  Keygrain — Generate Password       │
├─────────────────────────────────────┤
│  Secret:    [••••••••••••••]        │
│  Email:     [________________]      │
│  Length:    [20        ]            │
│  Symbols:  [!@#$%&*-_=+?   ]      │
│  Salt:     [________________]      │
│                                     │
│  [ Generate ]                       │
│                                     │
│  ┌─────────────────────────┐ [📋]  │
│  │ jU8D8b@epA_=X$4CN7&4   │       │
│  └─────────────────────────┘       │
│  Copied! (fades after 2s)          │
└─────────────────────────────────────┘
```

### Fields

| Field | Type | Attributes |
|-------|------|-----------|
| Secret | `<input type="password">` | required, no autocomplete |
| Email | `<input type="email">` | required |
| Length | `<input type="number">` | min=8, value=20 |
| Symbols | `<input type="text">` | value=`!@#$%&*-_=+?` |
| Salt | `<input type="text">` | optional, empty default |

### Output

- Readonly `<input type="text">` displaying the generated password
- Copy button using `navigator.clipboard.writeText()`
- Visual feedback ("Copied!") that fades after 2 seconds
- Clipboard auto-cleared after 30 seconds via `setTimeout`

### Style

Matches existing landing page: `system-ui` font, `max-width: 600px`, centered, same color palette (`#333` text, `#555` secondary, `#f4f4f4` code background).

## 4. Test Plan

### Test Page

A separate file at `server/static/generate/test.html` that:

1. Embeds all 8 test vectors from `vectors.json` as a JS constant
2. Runs each vector through the generate function
3. Compares output string to `expected`
4. Displays pass/fail per vector with inputs and actual vs expected on failure

### Vectors Covered

| # | Variation |
|---|-----------|
| 1 | Base case (default params) |
| 2 | Different email |
| 3 | Uppercase email (must match lowercase) |
| 4 | Shorter length (16) |
| 5 | Restricted symbols |
| 6 | With salt |
| 7 | Different secret |
| 8 | Longer password (32) |

### Validation Approach

- The test page imports the same generation function (shared via a `<script>` tag or inline duplication — since no build step, inline is acceptable for the test page)
- Tests run automatically on page load
- All 8 must pass for the implementation to be considered correct

## 5. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Secret exposure to server | All computation is client-side. No network requests. Secret never leaves the browser. |
| Secret in memory | Page reload clears all JS state. No localStorage/sessionStorage/cookies used. |
| Clipboard leakage | Clipboard cleared after 30 seconds via `setTimeout`. User warned visually. |
| XSS | No external scripts, no `eval()`, no dynamic HTML insertion of user input. Output rendered via `.value` on input element (not innerHTML). |
| HTTPS | Already enforced by existing server deployment. |
| Autocomplete | Secret field uses `autocomplete="off"` to prevent browser storage. |
| CSP compatibility | No inline event handlers. All JS in a single `<script>` block. Compatible with strict CSP if added later. |

## 6. Integration with Existing Server

### File Placement

```
server/static/
├── index.html              (existing landing page)
├── qr-download.png         (existing)
└── generate/
    ├── index.html          (password generator page)
    └── test.html           (test vectors validation page)
```

Go's `http.FileServer` serves `static/` at `/`. A request to `/generate/` serves `generate/index.html`. A request to `/generate` redirects to `/generate/` (standard FileServer behavior).

### Landing Page Update

Add a link to the generator on `server/static/index.html`:

```html
<h2>Web Generator</h2>
<p><a href="/generate/">Generate a password in your browser</a> — no download needed.</p>
```

### No Server Code Changes

The existing `mux.Handle("/", http.FileServer(http.Dir("static")))` handles everything. No new routes or middleware needed.
