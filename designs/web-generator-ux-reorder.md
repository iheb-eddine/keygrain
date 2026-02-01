# Web Generator UX Redesign: Field Reorder + Guidance Text

**Status:** Approved design  
**Scope:** `server/static/generate/index.html` — HTML structure only

---

## 1. Overview

Two UX problems with the current generate page:

1. **Field order is confusing.** The fingerprint dots depend on secret + email, but email appears *below* the fingerprint. Users see meaningless dots until they scroll down and fill in email, then must look back up.
2. **No guidance for new users.** A first-time visitor has no idea what this tool does, what "Secret" means, or why there are colored dots.

### Changes

- Reorder form fields to a logical flow: identity → proof → verification → target
- Add brief guidance text (subtitle, field hints, fingerprint explanation)

### Not Changed

- CSS custom properties and dark theme
- JavaScript logic (derivePassword, strengthen, fingerprint, normalization)
- Options panel content or behavior
- Service worker, manifest, external scripts
- Algorithm parameters or derivation logic

---

## 2. New HTML Field Order

```
<h1>Keygrain — Generate Password</h1>
<p class="subtitle">...</p>

<form>
  1. Email input + hint
  2. Secret input + hint
  3. Fingerprint dots + explanation
  4. Site input + hint
  5. Options panel (collapsible, unchanged)
  6. Generate button
</form>

<div class="output-row">
  7. Password output + copy button
</div>
<div id="status">...</div>
```

### Rationale

| Position | Field | Why here |
|----------|-------|----------|
| 1 | Email | Natural first field (like login forms). Identity. |
| 2 | Secret | Proof of identity. Follows email like password follows username. |
| 3 | Fingerprint | Depends on email + secret only. Placed immediately after both inputs so the user sees confirmation before proceeding. |
| 4 | Site | What you're generating for. Only needed after identity is confirmed. |
| 5 | Options | Advanced — collapsed by default, stays near the end. |
| 6 | Generate | Action follows all inputs. |
| 7 | Output | Result appears last. |

---

## 3. Guidance Text

### 3.1 Page Subtitle

**Location:** New `<p>` element immediately after `<h1>`  
**Text:** "Generate unique passwords from your secret — nothing is stored, just re-enter the same inputs to recreate your password anytime."  
**Styling:** Use existing `var(--text-secondary)`, `font-size: 0.95rem`. No new CSS class needed — inline or reuse existing secondary text color.  
**Why:** Explains the core concept (deterministic, no storage) and the practical workflow (re-enter to recreate) in one sentence.

### 3.2 Field Hints

Each hint is a `<small>` element below the `<input>`, using `color: var(--text-secondary)` and `font-size: 0.8rem`.

| Field | Hint text | `id` (for aria-describedby) |
|-------|-----------|----------------------------|
| Email | "Your email — combined with your secret to generate passwords" | `email-hint` |
| Secret | "Your master passphrase — memorize it, never store it" | `secret-hint` |
| Site | "Domain or service name (e.g. github.com)" | `site-hint` |

### 3.3 Fingerprint Explanation

**Location:** New `<small>` element immediately after the `#fingerprint` div  
**Text:** "These dots confirm your secret + email combo. Same colors = same inputs."  
**`id`:** `fingerprint-hint`  
**Why:** Without this, the dots are cryptic. This one-liner tells users what to look for (color consistency) and what it means (correct inputs).

---

## 4. Accessibility Changes

| Change | Reason |
|--------|--------|
| Add `aria-describedby="email-hint"` to email input | Links hint to input for screen readers |
| Add `aria-describedby="secret-hint"` to secret input | Links hint to input for screen readers |
| Add `aria-describedby="site-hint"` to site input | Links hint to input for screen readers |
| Update fingerprint `aria-label` from "Secret fingerprint" to "Visual fingerprint" | More accurate — it depends on secret AND email |
| Add `aria-describedby="fingerprint-hint"` to fingerprint div | Links explanation to the visual element |

Tab order automatically follows DOM order — reordering the HTML fixes keyboard navigation with no extra attributes.

---

## 5. HTML Skeleton (Reference)

```html
<h1>Keygrain — Generate Password</h1>
<p style="color: var(--text-secondary); font-size: 0.95rem;">
  Generate unique passwords from your secret — nothing is stored, just re-enter the same inputs to recreate your password anytime.
</p>

<form id="form">
  <label for="email">Email</label>
  <input type="email" id="email" autocomplete="off" required aria-describedby="email-hint">
  <small id="email-hint" style="color: var(--text-secondary); font-size: 0.8rem;">
    Your email — combined with your secret to generate passwords
  </small>

  <label for="secret">Secret</label>
  <input type="password" id="secret" autocomplete="off" required aria-describedby="secret-hint">
  <small id="secret-hint" style="color: var(--text-secondary); font-size: 0.8rem;">
    Your master passphrase — memorize it, never store it
  </small>

  <div id="fingerprint" aria-label="Visual fingerprint" aria-describedby="fingerprint-hint"></div>
  <small id="fingerprint-hint" style="color: var(--text-secondary); font-size: 0.8rem;">
    These dots confirm your secret + email combo. Same colors = same inputs.
  </small>

  <label for="site">Site</label>
  <input type="text" id="site" autocomplete="off" required aria-describedby="site-hint">
  <small id="site-hint" style="color: var(--text-secondary); font-size: 0.8rem;">
    Domain or service name (e.g. github.com)
  </small>

  <details id="options-panel">
    <!-- unchanged -->
  </details>

  <button type="submit" id="generate">Generate</button>
</form>

<div class="output-row">
  <input type="text" id="output" readonly aria-label="Generated password">
  <button type="button" id="copy" title="Copy to clipboard">&#x1F4CB;</button>
</div>
<div id="status" aria-live="polite"></div>
```

---

## 6. Implementation Notes

- The `<small>` hints use inline styles referencing existing CSS variables — no new classes or stylesheet additions required.
- The subtitle uses inline style for the same reason.
- JS `getElementById` calls remain valid — element IDs are unchanged.
- The `triggerFingerprint()` function already listens to both `#secret` and `#email` input events — no JS changes needed for the reorder.
- Options panel HTML is unchanged; only its position in DOM relative to other fields changes (it was already after site, stays after site).
- `<small>` elements are inline by default — add `display: block` in the inline style to ensure they sit below inputs with consistent spacing.
