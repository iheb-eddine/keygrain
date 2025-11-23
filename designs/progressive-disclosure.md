# Progressive Disclosure for Keygrain UIs

## 1. Overview

The default generation form should present only the essential fields: **Secret**, **Email**, and the **Generate** button. Advanced options (Length, Symbols, Salt) are hidden behind an expandable section, reducing cognitive load for the common case where defaults are acceptable.

This applies to three platforms:
- Android app (AddServiceDialog)
- Browser extension popup
- Web generator

## 2. Current State

| Platform | Progressive Disclosure? | Notes |
|----------|------------------------|-------|
| Android (AddServiceDialog) | ✅ Yes | `TextButton` toggles `showAdvanced` state. Hidden fields: Length, Symbols, Salt. Toggle text: "Show advanced" / "Hide advanced". Context: configuring a *saved* service entry. |
| Browser extension popup | ❌ No | All fields (Secret, Email, Length, Symbols, Salt) visible by default. Context: one-shot password generation for the current site. |
| Web generator | ❌ No | All fields visible by default. Context: standalone one-shot generation. |

## 3. Changes Per Platform

### 3.1 Android (AddServiceDialog)

Minimal change — update toggle text and accessibility:

- **Visual text:** "⚙️ Options" (collapsed) / "⚙️ Hide options" (expanded)
- **`contentDescription`:** "Show options" / "Hide options" (emoji is unreliable for screen readers)
- **Animation:** Wrap advanced fields in `AnimatedVisibility` (idiomatic Compose)
- **No structural change** to which fields are hidden or their order

### 3.2 Browser Extension Popup (`popup.html`)

Replace the flat field list with a `<details>`/`<summary>` element:

```html
<form id="form">
  <label for="secret">Secret</label>
  <input type="password" id="secret" autocomplete="off" required>
  <div id="fingerprint" aria-label="Secret fingerprint"></div>
  <label for="email">Email</label>
  <input type="email" id="email" autocomplete="off" required>

  <details id="options-panel">
    <summary>⚙️ Options</summary>
    <label for="length">Length</label>
    <input type="number" id="length" min="8" value="20">
    <label for="symbols">Symbols</label>
    <input type="text" id="symbols" value="!@#$%&*-_=+?">
    <label for="salt">Salt</label>
    <input type="text" id="salt" autocomplete="off">
  </details>

  <button type="submit" id="generate">Generate</button>
</form>
```

- **Toggle text:** `<summary>` content changes via CSS `details[open] > summary` pseudo-selector or JS
- **Summary text when open:** "⚙️ Hide options"
- **No JS required** for the expand/collapse mechanism itself
- **JS change:** Update `<summary>` text on toggle (listen for `toggle` event on `<details>`)

### 3.3 Web Generator (`server/static/generate/index.html`)

Same pattern as the extension:

```html
<form id="form">
  <label for="secret">Secret</label>
  <input type="password" id="secret" autocomplete="off" required>
  <div id="fingerprint" aria-label="Secret fingerprint"></div>
  <label for="email">Email</label>
  <input type="email" id="email" autocomplete="off" required>

  <details id="options-panel">
    <summary>⚙️ Options</summary>
    <label for="length">Length</label>
    <input type="number" id="length" min="8" value="20">
    <label for="symbols">Symbols</label>
    <input type="text" id="symbols" value="!@#$%&*-_=+?">
    <label for="salt">Salt</label>
    <input type="text" id="salt" autocomplete="off">
  </details>

  <button type="submit" id="generate">Generate</button>
</form>
```

## 4. Default Values When Collapsed

When the options section is collapsed, the form uses these defaults (unchanged from current behavior):

| Field | Default Value |
|-------|--------------|
| Length | 20 |
| Symbols | `!@#$%&*-_=+?` |
| Salt | *(empty string)* |

These defaults are already set as `value` attributes on the inputs. The `<details>` element preserves DOM state when closed — values entered by the user persist across collapse/expand cycles.

## 5. Animation/Transition

### Extension & Web

Optional CSS animation using the grid technique:

```css
details .details-content {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 200ms ease;
  overflow: hidden;
}

details[open] .details-content {
  grid-template-rows: 1fr;
}

details .details-content > div {
  overflow: hidden;
}

@media (prefers-reduced-motion: reduce) {
  details .details-content {
    transition: none;
  }
}
```

This requires wrapping the `<details>` content (excluding `<summary>`) in a `.details-content > div` structure. If this adds unwanted complexity, animation can be omitted entirely — the `<details>` element works without it.

### Android

Use `AnimatedVisibility` with `expandVertically`/`shrinkVertically`:

```kotlin
AnimatedVisibility(visible = showAdvanced) {
    Column { /* Length, Symbols, Salt fields */ }
}
```

Compose respects the system "Remove animations" accessibility setting automatically.

## 6. Accessibility

### 6.1 Keyboard Interaction

- **`<details>`/`<summary>` (extension/web):** Natively keyboard-accessible. `<summary>` is focusable and activates on Enter/Space.
- **Android:** `TextButton` is natively keyboard/TalkBack accessible.

### 6.2 Screen Reader Support

- **Extension/Web:** `<details>` natively exposes expanded/collapsed state to assistive technology. No additional ARIA attributes needed.
- **Android:** Set `contentDescription` on the toggle button:
  - Collapsed: "Show options"
  - Expanded: "Hide options"

### 6.3 Tab Order

- **`<details>` (closed):** Content is not rendered in the accessibility tree and is not focusable. No tab-order issues.
- **`<details>` (open):** Content is in normal tab order after the `<summary>`.
- This is a key advantage over `max-height: 0` + `overflow: hidden` approaches, which leave hidden fields focusable.

### 6.4 Focus Management

- **Expand:** Focus remains on the `<summary>` element. User tabs forward into the revealed fields.
- **Collapse:** If focus was inside the collapsed region, the browser moves focus to the `<summary>`. This is native `<details>` behavior.
- **Android:** Focus remains on the toggle button after state change (default Compose behavior).

### 6.5 Reduced Motion

- **Extension/Web:** `@media (prefers-reduced-motion: reduce)` disables the CSS transition (instant open/close).
- **Android:** Compose `AnimatedVisibility` respects the system accessibility setting "Remove animations."

## 7. Test Plan

### Manual Verification (all platforms)

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Load form fresh | Only Secret, Email, Generate visible. Options collapsed. |
| 2 | Click "⚙️ Options" | Length, Symbols, Salt fields appear. Toggle text changes to "⚙️ Hide options". |
| 3 | Click "⚙️ Hide options" | Advanced fields hidden. Toggle text reverts. |
| 4 | Generate with options collapsed | Password generated using defaults (length=20, symbols=`!@#$%&*-_=+?`, salt=""). |
| 5 | Expand, change length to 30, collapse, re-expand | Length field still shows 30 (state persists). |
| 6 | Expand, change length to 30, generate | Password generated with length=30. |
| 7 | Keyboard: Tab to toggle, press Enter | Options expand/collapse. |
| 8 | Screen reader: navigate to toggle | Announces "Options, collapsed" or equivalent. |
| 9 | Screen reader: activate toggle | Announces state change to "expanded". |
| 10 | `prefers-reduced-motion: reduce` | No animation on expand/collapse (instant). |
| 11 | Focus inside options, collapse | Focus moves to toggle (not lost). |

### Platform-Specific

| Platform | Additional Check |
|----------|-----------------|
| Android | TalkBack reads "Show options" / "Hide options" (not the emoji). |
| Extension | Saved per-domain settings (length/symbols/salt) load correctly into collapsed fields. Expanding reveals the saved values. |
| Web | Form submission works identically whether options were ever expanded or not. |
