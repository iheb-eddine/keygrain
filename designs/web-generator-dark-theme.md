# Design: Web Generator Dark Theme Restyle

## Overview

Restyle `server/static/generate/index.html` CSS to match the landing page (`server/static/index.html`) dark theme. Both pages should look like the same product — same color palette, same border radii, same interaction patterns.

This is a CSS-only change. No JavaScript logic, HTML structure, or algorithm changes.

## CSS Variable Definitions

Add to the generator's `<style>` block:

```css
:root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --border: #2a2d3a;
    --text: #e4e4e7;
    --text-secondary: #9ca3af;
    --accent: #6366f1;
    --accent-hover: #818cf8;
    --font: system-ui, -apple-system, sans-serif;
}
```

These are identical to the landing page variables.

## Style Mapping

### Body

| Property | Current | Dark Theme |
|----------|---------|------------|
| background | white (default) | `var(--bg)` |
| color | `#333` | `var(--text)` |
| font-family | `system-ui, sans-serif` | `var(--font)` |

### Heading (h1)

| Property | Current | Dark Theme |
|----------|---------|------------|
| color | inherited (#333) | `var(--text)` (inherited from body) |

### Labels

| Property | Current | Dark Theme |
|----------|---------|------------|
| color | `#555` | `var(--text-secondary)` |

### Inputs

| Property | Current | Dark Theme |
|----------|---------|------------|
| background | white (default) | `var(--surface)` |
| color | inherited (#333) | `var(--text)` |
| border | `1px solid #ccc` | `1px solid var(--border)` |
| border-radius | `3px` | `8px` |
| focus border-color | `#666` | `var(--accent)` |
| focus outline | none | `none` (keep) |
| focus box-shadow | none | `0 0 0 2px rgba(99, 102, 241, 0.2)` |

### Generate Button (`#generate`)

| Property | Current | Dark Theme |
|----------|---------|------------|
| background | `#333` | `var(--accent)` |
| color | `#fff` | `#fff` |
| border-radius | `3px` | `8px` |
| transition | none | `background 0.2s` |
| hover background | `#555` | `var(--accent-hover)` |
| disabled background | `#999` | `var(--border)` |
| disabled color | `#fff` | `var(--text-secondary)` |
| disabled cursor | `wait` | `not-allowed` |

### Output Row Input (`.output-row input`)

| Property | Current | Dark Theme |
|----------|---------|------------|
| background | `#f4f4f4` | `var(--surface)` |
| color | inherited | `var(--text)` |
| border | `1px solid #ccc` (inherited) | `1px solid var(--border)` |
| border-radius | `3px` (inherited) | `8px` |

### Copy Button (`#copy`)

| Property | Current | Dark Theme |
|----------|---------|------------|
| background | `#f4f4f4` | `var(--surface)` |
| border | `1px solid #ccc` | `1px solid var(--border)` |
| border-radius | `3px` (default) | `8px` |
| color | inherited | `var(--text)` |
| hover background | `#e0e0e0` | `var(--border)` |
| transition | none | `background 0.2s` |

### Status Text (`#status`)

| Property | Current | Dark Theme |
|----------|---------|------------|
| color | `#555` | `var(--text-secondary)` |

### Details/Summary (Options Panel)

| Property | Current | Dark Theme |
|----------|---------|------------|
| summary color | `#555` | `var(--text-secondary)` |
| summary hover color | (none) | `var(--text)` |
| details content area bg | transparent | `var(--surface)` |
| details content border | none | `1px solid var(--border)` |
| details content border-radius | none | `8px` |
| details content padding | none | `16px` |
| details content margin-top | none | `8px` |

### Fingerprint Dots (`.fp-dot`)

| Property | Current | Dark Theme |
|----------|---------|------------|
| border | none | `1px solid var(--border)` |

The border ensures the black dot (`#000000` from the Wong palette) remains visible against the dark background (`--bg: #0f1117`). The palette itself is NOT changed — only a border is added for visibility.

## New Styles

### Focus Ring (all interactive elements)

```css
input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
    outline: none;
}
```

### Button Transitions

```css
button {
    transition: background 0.2s;
}
```

### Selection Color (optional polish)

```css
::selection {
    background: var(--accent);
    color: #fff;
}
```

## Accessibility Considerations

### Contrast Ratios (WCAG AA requires 4.5:1 for text, 3:1 for UI components)

| Combination | Ratio | Pass? |
|-------------|-------|-------|
| `--text` (#e4e4e7) on `--bg` (#0f1117) | ~15.4:1 | ✓ AA/AAA |
| `--text-secondary` (#9ca3af) on `--bg` (#0f1117) | ~7.5:1 | ✓ AA/AAA |
| `--text-secondary` (#9ca3af) on `--surface` (#1a1d27) | ~6.3:1 | ✓ AA |
| White (#fff) on `--accent` (#6366f1) | ~4.6:1 | ✓ AA |
| `--text` (#e4e4e7) on `--surface` (#1a1d27) | ~13.0:1 | ✓ AA/AAA |
| `--text-secondary` on disabled button (`--border` #2a2d3a) | ~4.7:1 | ✓ AA |

### Focus Visibility

The accent-colored focus ring (`box-shadow`) provides clear focus indication against the dark surface, meeting WCAG 2.4.7 (Focus Visible).

### Color Independence

Fingerprint dots use the Wong colorblind-safe palette. Adding a border does not change their color semantics — it only ensures visibility on dark backgrounds.

## What NOT to Change

- **Layout:** `max-width: 600px`, `margin: 80px auto`, `padding: 0 20px` — keep as-is
- **Font sizes:** All `rem`-based sizes stay the same
- **Spacing:** All margins and padding values stay the same
- **HTML structure:** No elements added or removed
- **JavaScript:** No logic changes whatsoever
- **Form behavior:** Submit, validation, clipboard, fingerprint — all unchanged
- **Service worker registration:** Unchanged
- **Manifest link:** Unchanged
- **Responsive behavior:** `prefers-reduced-motion` media query stays as-is
- **Wong palette colors:** The 8 fingerprint colors are NOT modified (only border added)
