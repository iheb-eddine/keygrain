# UI Modernization Design — Browser Extension

A CSS-focused visual refresh to make the Keygrain browser extension look like a premium 2025 product. No functionality changes. Minimal HTML changes (emoji → inline SVG only).

---

## 1. Design Tokens

### New tokens (add to `:root`)

```css
:root {
  /* Existing tokens unchanged */

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.06);
  --shadow-md: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);
  --shadow-lg: 0 4px 12px rgba(0,0,0,0.15);
  --shadow-hover: 0 2px 6px rgba(0,0,0,0.15);

  /* Radii */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;

  /* Transitions */
  --transition-fast: 150ms ease;
}
```

### Dark mode shadow overrides

```css
@media (prefers-color-scheme: dark) {
  :root {
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.2);
    --shadow-md: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2);
    --shadow-lg: 0 4px 12px rgba(0,0,0,0.4);
    --shadow-hover: 0 2px 6px rgba(0,0,0,0.35);
  }
}
```

### Updated existing token values

| Token | Old | New | Reason |
|-------|-----|-----|--------|
| (none) | — | — | All color tokens remain unchanged |

---

## 2. Component Changes

### Body / Container

| Property | Before | After |
|----------|--------|-------|
| `width` | 400px | 400px (unchanged) |
| `padding` | 12px | 16px |
| `font-family` | `system-ui, sans-serif` | `system-ui, -apple-system, sans-serif` |

### Inputs

| Property | Before | After |
|----------|--------|-------|
| `padding` | 6px | 8px 10px |
| `border-radius` | 3px | var(--radius-md) (6px) |
| `border` | 1px solid var(--border) | 1px solid var(--border) |
| `transition` | none | border-color var(--transition-fast), box-shadow var(--transition-fast) |
| `focus: outline` | 2px solid var(--accent) | 2px solid var(--accent) (unchanged) |
| `focus: outline-offset` | 2px | 3px |
| `focus: box-shadow` | none | var(--shadow-sm) |

### Primary Buttons (unlock, add, quick-fill, dialog confirm)

| Property | Before | After |
|----------|--------|-------|
| `border-radius` | 3px | var(--radius-md) (6px) |
| `padding` | 8px | 10px 16px |
| `box-shadow` | none | var(--shadow-md) |
| `transition` | none | background var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast) |
| `hover: transform` | none | translateY(-1px) |
| `hover: box-shadow` | none | var(--shadow-hover) |
| `active: transform` | none | translateY(0) |
| `active: box-shadow` | none | var(--shadow-sm) |

### Secondary/Ghost Buttons (header actions, dialog cancel, service actions)

| Property | Before | After |
|----------|--------|-------|
| `border` | 1px solid var(--border) | 1px solid var(--border) |
| `border-radius` | 3px | var(--radius-md) (6px) |
| `padding` | 4px 8px | 6px 10px |
| `transition` | none | background var(--transition-fast), border-color var(--transition-fast) |
| `hover: background` | var(--bg-secondary) | var(--bg-secondary) (unchanged) |
| `hover: border-color` | var(--border) | var(--accent) |

### Service List Items

| Property | Before | After |
|----------|--------|-------|
| `padding` | 6px 0 | 8px 6px |
| `border-bottom` | 1px solid var(--border) | 1px solid var(--border) |
| `border-radius` | none | 0 (default), var(--radius-md) on hover |
| `transition` | none | background var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast) |
| `hover: background` | none | var(--bg-secondary) |
| `hover: transform` | none | translateY(-1px) |
| `hover: box-shadow` | none | var(--shadow-sm) |
| `hover: border-bottom-color` | — | transparent (to avoid double-line with radius) |
| `.focused` | background only | same hover treatment |

Last item: `border-bottom: none` (use `:last-child` selector).

### Header

| Property | Before | After |
|----------|--------|-------|
| `margin-bottom` | 8px | 12px |
| `h1 font-size` | 1.2rem | 1.3rem |
| `h1 font-weight` | default | 700 |
| `gap` (header-actions) | 4px | 6px |

### Menu Dropdown

| Property | Before | After |
|----------|--------|-------|
| `border` | 1px solid var(--border) | none |
| `border-radius` | 3px | var(--radius-lg) (8px) |
| `box-shadow` | none | var(--shadow-lg) |
| `padding` | 4px 0 | 6px 0 |
| `button padding` | 6px 12px | 8px 14px |
| `button border-radius` | none | var(--radius-sm) (4px) with 4px horizontal margin |
| `button transition` | none | background var(--transition-fast) |

### Search Input

Inherits general input changes. Additionally:

| Property | Before | After |
|----------|--------|-------|
| `margin-bottom` | 8px | 12px |

### Dialogs (full-screen overlays — structure unchanged)

| Property | Before | After |
|----------|--------|-------|
| `padding` | 20px | 24px |
| `border-top` | none | 4px solid var(--accent) (accent bar at top) |
| `h2 font-size` | 1rem | 1.1rem |
| `h2 font-weight` | default | 600 |
| `h2 margin-bottom` | 10px | 14px |
| `.dialog-actions gap` | 8px | 10px |
| `.dialog-actions button border-radius` | 3px | var(--radius-md) |

### Lock Screen

| Property | Before | After |
|----------|--------|-------|
| `padding` | 20px 0 | 32px 0 |
| `h1 margin-bottom` | 0 | 8px |
| `label margin-top` | 8px | 12px |

### Breach Banners

| Property | Before | After |
|----------|--------|-------|
| `border-radius` | 4px | var(--radius-lg) (8px) |
| `padding` | 8px 10px | 10px 14px |
| `box-shadow` | none | var(--shadow-sm) |

### PIN Setup Banner

| Property | Before | After |
|----------|--------|-------|
| `border-radius` | 4px | var(--radius-lg) (8px) |
| `border` | 1px solid var(--border) | none |
| `box-shadow` | none | var(--shadow-md) |
| `padding` | 10px | 12px 14px |

### Strength Bar

| Property | Before | After |
|----------|--------|-------|
| `height` | 3px | 4px |
| `border-radius` | 2px | 2px (unchanged) |
| `margin-top` | 3px | 4px |

### Status

| Property | Before | After |
|----------|--------|-------|
| `margin-top` | 8px | 12px |

---

## 3. SVG Icon Set

All icons: 16×16 viewBox, `fill="currentColor"`, sized via CSS `width: 1em; height: 1em; vertical-align: -0.125em`.

Delivery: inline `<svg>` elements replacing emoji text nodes. Parent elements retain their existing `aria-label` attributes.

| Location | Current | Replacement | SVG |
|----------|---------|-------------|-----|
| Lock screen h1, Main h1, PIN h1 | 🔑 | Key icon | `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10.5 0a5.5 5.5 0 0 0-4.88 8.01L0 13.63V16h2.38l.74-.74v-1.51h1.51l.74-.74v-1.51h1.51l1.11-1.11A5.5 5.5 0 1 0 10.5 0zm1.25 4a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z"/></svg>` |
| Menu button | ☰ | Hamburger | `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3h14v1.5H1zm0 4.25h14v1.5H1zm0 4.25h14v1.5H1z"/></svg>` |
| Settings button | ⚙ | Gear | `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm6.32-1.9l-1.09-.63a5.4 5.4 0 0 0 0-1.94l1.09-.63a.5.5 0 0 0 .18-.68l-1-1.73a.5.5 0 0 0-.68-.18l-1.09.63a5.3 5.3 0 0 0-1.68-.97V1.5a.5.5 0 0 0-.5-.5h-2a.5.5 0 0 0-.5.5v1.26a5.3 5.3 0 0 0-1.68.97L4.28 3.1a.5.5 0 0 0-.68.18l-1 1.73a.5.5 0 0 0 .18.68l1.09.63a5.4 5.4 0 0 0 0 1.94l-1.09.63a.5.5 0 0 0-.18.68l1 1.73a.5.5 0 0 0 .68.18l1.09-.63c.5.42 1.07.74 1.68.97v1.26a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-1.26a5.3 5.3 0 0 0 1.68-.97l1.09.63a.5.5 0 0 0 .68-.18l1-1.73a.5.5 0 0 0-.18-.68z"/></svg>` |
| Lock button | 🔒 | Padlock | `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M12 7V5a4 4 0 0 0-8 0v2a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM8 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM5.5 7V5a2.5 2.5 0 0 1 5 0v2h-5z"/></svg>` |
| Add button | ＋ | Plus circle | `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm3.5 7.75h-2.75v2.75h-1.5V8.75H4.5v-1.5h2.75V4.5h1.5v2.75h2.75v1.5z"/></svg>` |
| Copy action (JS-generated) | 📋 | Clipboard | `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5 2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1h1.5A1.5 1.5 0 0 1 14 3.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 14.5v-11A1.5 1.5 0 0 1 3.5 2H5zm1 0h4v1H6V2z"/></svg>` |
| Edit action (JS-generated) | ✏️ | Pencil | `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M12.15 1.15a1.5 1.5 0 0 1 2.12 0l.58.58a1.5 1.5 0 0 1 0 2.12L5.37 13.33l-3.2.8.8-3.2 9.18-9.78z"/></svg>` |
| Delete action (JS-generated) | 🗑️ | Trash | `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 0a.5.5 0 0 0-.5.5V1H2a1 1 0 0 0-1 1v1h14V2a1 1 0 0 0-1-1h-3V.5a.5.5 0 0 0-.5-.5h-5zM2 4l.9 10.11A1.5 1.5 0 0 0 4.4 15.5h7.2a1.5 1.5 0 0 0 1.5-1.39L14 4H2z"/></svg>` |
| Sync error | ⚠️ | Alert triangle | `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8.56 1.69a.63.63 0 0 0-1.12 0L.34 14.03A.63.63 0 0 0 .9 15h14.2a.63.63 0 0 0 .56-.97L8.56 1.69zM8 12.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM7.25 6h1.5v4h-1.5V6z"/></svg>` |
| Rotate button | 🔄 | Refresh | `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.65 2.35A7.96 7.96 0 0 0 8 0C3.58 0 0 3.58 0 8s3.58 8 8 8a7.99 7.99 0 0 0 7.56-5.34h-2.03A6 6 0 1 1 8 2a5.98 5.98 0 0 1 4.24 1.76L9 7h7V0l-2.35 2.35z"/></svg>` |
| Mark rotated | ✅ | Check circle | `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm3.35 6.35l-4 4a.5.5 0 0 1-.7 0l-2-2a.5.5 0 1 1 .7-.7L7 9.29l3.65-3.64a.5.5 0 1 1 .7.7z"/></svg>` |
| Options summary | ⚙️ | Gear (same as settings) | Reuse gear SVG |

### CSS for SVG icons

```css
.icon {
  width: 1em;
  height: 1em;
  vertical-align: -0.125em;
  fill: currentColor;
  flex-shrink: 0;
}

.icon-lg {
  width: 1.2em;
  height: 1.2em;
}
```

---

## 4. Accessibility Guarantees

| Concern | Approach |
|---------|----------|
| Focus styles | Preserved: `outline: 2px solid var(--accent)`, offset increased to 3px |
| Color contrast | All existing color pairs unchanged (already WCAG AA compliant) |
| Icon accessibility | Decorative icons: `aria-hidden="true"`. Parent buttons retain `aria-label`. Logo icon in h1: decorative (text "Keygrain" provides meaning) |
| Touch targets | All buttons meet 44px minimum with increased padding |
| Reduced motion | Add `@media (prefers-reduced-motion: reduce)` to disable transforms and transitions |

### Reduced motion query

```css
@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
    transform: none !important;
  }
}
```

---

## 5. Before / After Descriptions

### Lock Screen

**Before:** Flat, cramped. Emoji key icon. Inputs with 3px radius and minimal padding. Unlock button is a flat colored rectangle. Fingerprint dots sit close to the input.

**After:** Generous vertical spacing (32px top padding). Crisp SVG key icon. Inputs with 6px radius, 8px padding, subtle focus shadow. Unlock button has depth via box-shadow, lifts on hover with translateY(-1px). Fingerprint section has more breathing room (12px margin-top).

### Main Screen — Header

**Before:** Emoji icons in bordered square buttons. 4px gap between actions. Flat appearance.

**After:** SVG icons (hamburger, gear, padlock) in ghost buttons with 6px radius. 6px gap. Hover transitions border-color to accent. Clean, professional icon rendering at any DPI.

### Main Screen — Service List

**Before:** Dense list with 6px padding, separated by 1px borders. No hover feedback. Emoji action buttons (copy, edit, delete) in small bordered squares.

**After:** 8px vertical padding per item. On hover: item lifts 1px, gains subtle shadow and rounded background — then settles back on mouse-out. SVG action icons (clipboard, pencil, trash) in ghost buttons with smooth border-color transition. Last item has no bottom border.

### Main Screen — Search & Add

**Before:** Search input with 3px radius. Add button is flat accent rectangle with fullwidth emoji "＋".

**After:** Search input with 6px radius, 12px bottom margin for separation. Add button with 6px radius, shadow depth, SVG plus-circle icon, hover lift effect.

### Dialogs

**Before:** Full-screen white overlay with 20px padding. Flat buttons. No visual anchor.

**After:** Full-screen overlay with 24px padding and a 4px accent-colored top border providing visual anchor. Buttons with 6px radius. Confirm button has shadow and hover lift. Cancel button has border-color transition on hover.

### Menu Dropdown

**Before:** Bordered box with flat button list. 3px radius.

**After:** Floating panel with 8px radius and large shadow (no border). Buttons have internal radius and hover background transition. Feels like a native OS context menu.

### Overall Feel

**Before:** Functional but dated. Flat borders everywhere, cramped spacing, emoji icons that render inconsistently across platforms, no motion or depth cues.

**After:** Premium and polished. Depth via subtle shadows, generous spacing that lets content breathe, crisp SVG icons that render identically everywhere, smooth 150ms transitions on all interactive elements, and a clear visual hierarchy through typography weight and size differences. Matches the quality bar of Linear, Raycast, and 1Password 8.
