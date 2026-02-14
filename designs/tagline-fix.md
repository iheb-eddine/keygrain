# Tagline Fix: "Nothing stored" → "Nothing to breach"

## Problem

The tagline "Nothing stored" is inaccurate. The extension stores site configs, counters, PIN, and sync data. The accurate claim is that **no passwords** are stored — there is nothing to breach even if the server is compromised.

## Replacements

### 1. Hero tagline — `server/static/index.html`

**Title (line 6):**
```html
<!-- Before -->
<title>Keygrain — One secret. Every password. Nothing stored.</title>

<!-- After -->
<title>Keygrain — One secret. Every password. Nothing to breach.</title>
```

**H1 (line 93):**
```html
<!-- Before -->
<h1>One secret. Every password. Nothing stored.</h1>

<!-- After -->
<h1>One secret. Every password. Nothing to breach.</h1>
```

### 2. Security card heading — `server/static/index.html`

**Line 132:**
```html
<!-- Before -->
<h3>Nothing Stored</h3>

<!-- After -->
<h3>No Password Database</h3>
```

Body text unchanged — "No password database exists. Passwords are recomputed on demand. There is nothing to breach." is accurate.

### 3. How-it-works note — `server/static/index.html`

**Line 117:** NO CHANGE. "Computed locally, never stored." refers to passwords in context and is accurate.

### 4. Generate page — `server/static/generate/index.html`

**Line 55:**
```html
<!-- Before -->
Generate unique passwords from your secret — nothing is stored, just re-enter the same inputs to recreate your password anytime.

<!-- After -->
Generate unique passwords from your secret — no passwords are stored, just re-enter the same inputs to recreate your password anytime.
```

### 5. Chrome listing — `extension/store/chrome-listing.md`

**Line 9:** NO CHANGE. "Nothing stored in plaintext." is accurate — sync data is AES-GCM encrypted.

### 6. Internal doc — `docs/next-improvements.md`

**Line 48:**
```markdown
<!-- Before -->
- **TOTP** deferred to preserve "nothing stored" brand identity

<!-- After -->
- **TOTP** deferred to preserve "nothing to breach" brand identity
```

## Not changed

- `og_images/og-image.png` — already uses "Nothing to breach"
- `generate_og_images.py` — already uses "Nothing to breach"
- `WEBSITE_BACKLOG.md` — already uses "nothing to breach"
- `designs/landing-page.md` — uses "nothing to breach" in design rationale
