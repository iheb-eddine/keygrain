# Design: Generator Page Navigation & Branding

## Goal

Add minimal navigation and branding to `server/static/generate/index.html` so it feels connected to the Keygrain product, without distracting from the form.

## What to Add

1. **Header brand link** — Make "Keygrain" in the `<h1>` a clickable link home with the logo inline.
2. **Footer** — Privacy, Threat Model links + copyright with contact email.

## Exact HTML Changes

### Header

Replace:
```html
<h1>Keygrain — Generate Password</h1>
```

With:
```html
<h1><a href="/" class="brand-link"><img src="/logo-128.png" alt="" width="28" height="28" class="brand-logo">Keygrain</a> — Generate Password</h1>
```

### Footer

Add before closing `</body>` (after the scripts):
```html
<footer>
    <div class="footer-links">
        <a href="/privacy.html">Privacy</a>
        <a href="/threat-model/">Threat Model</a>
    </div>
    <small>© 2026 SecByTech · contact@secbytech.com</small>
</footer>
```

## CSS Additions

Add inside the existing `<style>` block (after the `::selection` rule):

```css
.brand-link { color: var(--accent); text-decoration: none; display: inline-flex; align-items: center; gap: 8px; }
.brand-link:hover { color: var(--accent-hover); }
.brand-logo { border-radius: 4px; vertical-align: middle; }
footer { margin-top: 4rem; border-top: 1px solid var(--border); padding: 24px 0; text-align: center; color: var(--text-secondary); font-size: 13px; }
footer .footer-links { margin-bottom: 8px; }
footer .footer-links a { color: var(--text-secondary); text-decoration: none; margin: 0 10px; }
footer .footer-links a:hover { color: var(--text); }
```

## What NOT to Change

- The `<form>` structure and all inputs
- Any JavaScript (generation logic, fingerprint, clipboard, service worker)
- Existing CSS rules (body, h1, label, input, button, output-row, details, etc.)
- The `:root` CSS variables block
- The `<meta>` tags and `<link rel="manifest">`

## Rationale

- Logo (28×28) + "Keygrain" as an accent-colored link provides home navigation without a navbar.
- `alt=""` on the logo is correct — the adjacent text "Keygrain" serves as the accessible label.
- Footer mirrors the landing page footer (same links, same copyright format with email).
- All styles use existing CSS variables — no new colors introduced.
- No class name conflicts — the generator page has no existing `a` styles or `.brand-*` classes.
- Total addition: ~10 lines HTML, ~7 lines CSS.
