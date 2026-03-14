# Dark/Light Mode Support — Design

## Approach

**Option 3: Dark default + system-preference light override.**

- Dark remains the default (brand identity, og:image, marketing materials)
- Light mode activates via `@media (prefers-color-scheme: light)`
- No toggle, no JS — pure CSS
- A shared `server/static/theme.css` file contains the light-mode overrides
- Each page adds `<link rel="stylesheet" href="/theme.css">` after its inline `<style>` block

## Light Mode Color Values

| Variable | Dark (current) | Light |
|----------|---------------|-------|
| `--bg` | `#0f1117` | `#ffffff` |
| `--surface` | `#1a1d27` | `#f8f9fa` |
| `--border` | `#2a2d3a` | `#e2e4e8` |
| `--text` | `#e4e4e7` | `#1a1d27` |
| `--text-secondary` | `#9ca3af` | `#6b7280` |
| `--accent` | `#6366f1` | `#4f46e5` |
| `--accent-hover` | `#818cf8` | `#6366f1` |

### Contrast Rationale

- `--accent` (#4f46e5) on `--bg` (#ffffff): ~6.9:1 — passes WCAG AA for all text sizes
- `--text` (#1a1d27) on `--bg` (#ffffff): ~16.5:1 — passes AAA
- `--text-secondary` (#6b7280) on `--bg` (#ffffff): ~5.5:1 — passes AA

The dark-mode accent (#6366f1) is shifted darker in light mode because it only achieves ~4.5:1 on white, which is borderline for normal-sized text.

## CSS Structure (`server/static/theme.css`)

```css
@media (prefers-color-scheme: light) {
  :root {
    --bg: #ffffff;
    --surface: #f8f9fa;
    --border: #e2e4e8;
    --text: #1a1d27;
    --text-secondary: #6b7280;
    --accent: #4f46e5;
    --accent-hover: #6366f1;
    --green: #16a34a;
    --red: #dc2626;
    --yellow: #ca8a04;
  }

  /* Threat-model page: tag backgrounds */
  .tag-protected { background: #dcfce7 !important; }
  .tag-risk { background: #fee2e2 !important; }
  .tag-partial { background: #fef9c3 !important; }
}
```

### Threat-Model Tag Overrides

The threat-model page uses hardcoded dark-tinted backgrounds (`#16291a`, `#2d1515`, `#2d2a10`) for status tags. These must be overridden in light mode. The text color variables (`--green`, `--red`, `--yellow`) are also shifted darker for contrast on the lighter tag backgrounds:

| Variable | Dark | Light | Contrast on tag bg |
|----------|------|-------|--------------------|
| `--green` | `#22c55e` | `#16a34a` | ~3.8:1 on `#dcfce7` |
| `--red` | `#ef4444` | `#dc2626` | ~4.6:1 on `#fee2e2` |
| `--yellow` | `#eab308` | `#ca8a04` | ~3.9:1 on `#fef9c3` |

Note: These are short tag labels (1-2 words, ≥14px bold), so WCAG AA large-text threshold (3:1) applies.

## Per-Page Integration

Add after the closing `</style>` tag in `<head>`:

```html
<link rel="stylesheet" href="/theme.css">
```

### Affected Pages (9 total)

1. `server/static/index.html`
2. `server/static/generate/index.html`
3. `server/static/guide/index.html`
4. `server/static/compare/index.html`
5. `server/static/changelog/index.html`
6. `server/static/terms/index.html`
7. `server/static/threat-model/index.html`
8. `server/static/privacy.html`
9. `server/static/404.html`

`server/static/generate/test.html` is excluded (test file, not user-facing).

## Page-Specific Notes

- **Threat-model tags**: `.tag-protected`, `.tag-risk`, `.tag-partial` use hardcoded dark backgrounds and colored text. Overridden in `theme.css` with light-tinted backgrounds and darker text color variables.
- **`--yellow`** (used in guide and terms): Overridden globally to `#ca8a04`. Used as callout border color in guide — decorative, no WCAG contrast requirement for borders. Darker amber is still clearly visible on light surface.
- **`--max-w`**: Layout variable, not color-related. Unchanged.
- **Box shadows**: No shadow variables used. Inline `rgba(0,0,0,...)` shadows appear slightly heavier on light — acceptable.
- **Hardcoded colors**: `btn-primary` uses `color: #fff` — works on both accent values. Hero mockup dots are decorative.

## Why No Toggle

- This is a marketing/docs site with brief visits, not an app
- Users who prefer light mode have it set at OS level
- No JS = zero runtime cost, no localStorage, no accessibility burden for a toggle button
- Keeps brand coherence: dark og:image → dark page for most visitors
