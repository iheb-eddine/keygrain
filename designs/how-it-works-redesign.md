# How It Works — Section Redesign

## Problem

The current design shows Secret + Site + Email as 3 equal boxes with `+` operators between them. This implies all 3 inputs are needed every time and carry equal weight. A first-time visitor sees "3 things to remember" and leaves.

The reality: you memorize ONE secret, set your email once, and only the site changes per password.

## Design Principle

Single focal point. The layout itself communicates hierarchy — no labels or badges needed. If you have to explain the visual with text, the visual has failed.

## Agreed Layout

```
Section title: "How it works"
Subtitle: "Remember one secret. Get a unique password for every site."

┌─────────────────────────────────────┐
│  [CENTER — The Secret Block]        │
│                                     │
│       🔑  Your secret phrase        │  ← large, prominent, THE focal point
│      anchored to: you@mail.com      │  ← small, gray, subordinate annotation
│                                     │
└─────────────────────────────────────┘

              ↓ + site name

┌─────────────────────────────────────┐
│  [FAN-OUT — 3 rows]                 │
│                                     │
│   github.com    →   kX9#mP2$vL      │
│   gmail.com     →   Ht7&nQ4@wR      │
│   netflix.com   →   Bm3!yK8#pJ      │
│                                     │
└─────────────────────────────────────┘

Footer note: "Same secret + any site = unique password. Computed locally, never stored."
```

## Visual Hierarchy

1. **Secret block** — largest element, centered, uses `var(--surface)` background with `var(--border)`. The secret value (`••••••••` or "Your secret phrase") is bold/large. The email annotation is `var(--text-secondary)`, small font, no box of its own.

2. **Flow indicator** — `↓ + site name` in `var(--text-secondary)`, acts as a visual connector. Not a box, just text.

3. **Fan-out rows** — each row shows `site → password`. Sites in normal text, passwords in monospace with `var(--accent)` color to draw the eye to the OUTPUT (the value proposition). Rows have subtle separators or spacing.

4. **Footer note** — single line, `var(--text-secondary)`, small font. Reinforces the mechanism without being required for comprehension.

## Content Copy

- Section title: "How it works"
- Subtitle: "Remember one secret. Get a unique password for every site."
- Secret block label: "Your secret phrase" (displayed as `••••••••`)
- Email annotation: "anchored to: you@mail.com"
- Flow text: "↓ + site name"
- Fan-out examples:
  - github.com → kX9#mP2$vL
  - gmail.com → Ht7&nQ4@wR
  - netflix.com → Bm3!yK8#pJ
- Footer: "Same secret + any site = unique password. Computed locally, never stored."

## CSS Structure

```
.how                        — section wrapper (unchanged)
.section-title              — "How it works" (unchanged)
.section-sub                — new subtitle text (unchanged class)
.seed-block                 — centered secret container
.seed-block .secret-value   — the •••••••• display
.seed-block .email-anchor   — small gray email annotation
.flow-indicator             — the "↓ + site name" connector
.fan-out                    — container for the 3 rows
.fan-out .row               — single site→password row
.fan-out .row .site         — site name
.fan-out .row .arrow        — → symbol
.fan-out .row .password     — monospace password output
.how-note                   — footer note (reuse existing class)
```

## Responsive Behavior

**Desktop (≥768px):**
- Secret block: centered, max-width ~400px
- Fan-out rows: horizontal layout (site → password), centered
- Comfortable spacing between elements

**Mobile (<768px):**
- Secret block: full width with padding, remains the dominant visual
- Fan-out rows: stack naturally (already vertical), site and password may wrap to two lines per row if needed
- Flow indicator remains centered
- All text sizes scale down proportionally but secret value stays largest

## Removed Elements

- The 3 equal `input-box` elements (Secret, Site, Email)
- The `+` operators between them
- The single `output-box`
- The `derivation` flex container
- The old subtitle ("Deterministic derivation — same inputs always produce the same password.")

## Design Rationale

- **Why single focal point:** People scan, they don't read. One big thing (secret) → many outputs (passwords) is instantly graspable.
- **Why email as annotation:** Email is technically an input but experientially irrelevant to daily use. It's an attribute of your identity, not something you "enter."
- **Why 3 fan-out examples:** 2 could be coincidence. 3 establishes the pattern "any site works."
- **Why passwords in accent color:** The passwords are the VALUE — they're what the user gets. Drawing the eye there reinforces the payoff.
