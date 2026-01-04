# Landing Page Redesign — keygrain.secbytech.com

## Overview

**Purpose:** Landing page for keygrain.secbytech.com — convert visitors into users (web generator trial or app download).

**Audience:** Privacy-conscious users, password-fatigued users, technical and non-technical.

**Constraints:**
- Single HTML file with embedded CSS (no build step, no framework)
- No external dependencies (no CDN fonts, no JS frameworks)
- System fonts only
- Must be responsive (mobile + desktop)
- Copy must be clear to non-technical users
- Comparison table must be honest (include trade-offs)

## Goals

1. Communicate value in <5 seconds (hero tagline)
2. Build trust through transparency (honest comparison, privacy-first messaging)
3. Convert via low-friction CTAs (web generator = zero install, APK = one tap)
4. Load fast (<50KB total page weight excluding QR image)

## Visual Style

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| Background | `#fafafa` | Page background |
| Surface | `#ffffff` | Cards, alternating sections |
| Text primary | `#1a1a1a` | Headings, body text |
| Text secondary | `#555555` | Captions, secondary info |
| Accent | `#2563eb` | Buttons, links, highlights |
| Accent hover | `#1d4ed8` | Button/link hover state |
| Hero bg | `#111827` | Dark hero section |
| Hero text | `#f9fafb` | Text on dark hero |
| Win highlight | `#ecfdf5` | Comparison table — Keygrain advantage |
| Loss highlight | `#fef2f2` | Comparison table — Keygrain limitation |

All combinations pass WCAG AA contrast (primary text ~16:1, secondary ~4.5:1, accent on white ~4.6:1, hero ~18:1).

### Typography

- **Font stack:** `system-ui, -apple-system, sans-serif`
- **Base size:** 16px
- **Scale (1.25 ratio):** 16px, 20px, 25px, 31px, 39px
- **Line height:** 1.6 (body), 1.2 (headings)
- **Max content width:** 1080px
- **Paragraph max-width:** 65ch (readability); comparison table gets full container width

### Spacing

- **Base unit:** 8px
- **Section padding:** 80px vertical (desktop), 48px vertical (mobile)
- **Component gap:** 24px
- **Grid gap:** 32px

### Component Patterns

**Buttons:**
- Pill-shaped: `border-radius: 9999px`
- Padding: 16px 32px
- Font-weight: 600
- Primary: accent background, white text
- Secondary: transparent background, accent border, accent text

**Cards:**
- Padding: 24px
- Border-radius: 8px
- Background: surface white
- Shadow: `0 1px 3px rgba(0,0,0,0.08)`

**Section rhythm:** Alternate between `#fafafa` and `#ffffff` backgrounds.

### Responsive Breakpoints

| Breakpoint | Behavior |
|-----------|----------|
| ≥1080px | Full layout, max-width container centered |
| 768–1079px | Reduced grid columns (3→2), smaller section padding |
| <768px | Single column, full-width buttons stacked, font scale drops one step for h1/h2, section padding 48px/32px |

---

## Section 1: Hero

**Layout:** Full-width dark section (`#111827` background), centered content, 120px vertical padding (desktop), 80px (mobile).

**Content:**

**Tagline (h1):**
> Your passwords, derived from memory.

**Subtitle (p):**
> No vault to hack. No database to breach. One secret you remember — unique passwords for every site, every time.

**Value framing:** The subtitle communicates the *consequence* for the user (nothing to hack, nothing to breach) rather than the mechanism (deterministic derivation). Non-technical users understand "nothing to steal" without needing cryptography knowledge.

**CTA Buttons (side by side on desktop, stacked on mobile):**
- Primary: "Try Web Generator" → `/generate/`
- Secondary: "Download App" → `#download` (anchor to download section)

**Mobile (< 768px):** Tagline drops to 25px. Buttons stack full-width with 12px gap between them.

---

## Section 2: How It Works

**Layout:** White (`#ffffff`) background. Centered heading, then 3 cards in a horizontal row (desktop) or vertical stack (mobile). Cards connected by arrow indicators (CSS `::after` with "→" on desktop, "↓" on mobile).

**Heading (h2):**
> How it works

**Subheading (p):**
> Three inputs. One password. Every time.

**Steps:**

| Step | Emoji | Title | Description |
|------|-------|-------|-------------|
| 1 | 🔑 | Enter your secret | A single passphrase you remember. Never stored anywhere. |
| 2 | 🌐 | Pick the site | Select which account — by site name or email. The extension detects it automatically. |
| 3 | ✅ | Get your password | A unique, strong password is generated instantly. Same inputs = same output, always. |

**Card style:** Surface white (`#ffffff`), shadow (`0 1px 3px rgba(0,0,0,0.08)`), 24px padding, centered emoji at 48px font-size, bold title below, description in secondary text color (`#555`).

**Mobile (< 768px):** Cards stack vertically. Arrow connectors rotate to "↓". Card padding reduces to 16px.

---

## Section 3: Features Grid

**Layout:** `#fafafa` background. Heading centered, then 3×2 grid (desktop), 2×3 grid (tablet 768–1079px), single column (mobile < 768px).

**Heading (h2):**
> Why Keygrain

**Features:**

| # | Emoji | Title | Description |
|---|-------|-------|-------------|
| 1 | 🚫 | Nothing to steal | No password database. No vault. Nothing for hackers to target. |
| 2 | 🔄 | Works everywhere | Same secret produces the same password on any device — phone, laptop, or browser. |
| 3 | ⚡ | Instant & offline | Passwords are generated locally in milliseconds. No server needed. |
| 4 | 🎛️ | Fully configurable | Control length, symbols, and versioning. Different rules per site. |
| 5 | 🔒 | Zero-knowledge | Your secret never leaves your device. We cannot see it, even if we wanted to. |
| 6 | 💾 | Optional encrypted backup | Export your site configs (not passwords) with AES encryption. Restore on any device. |

**Card style:** Surface white, shadow, 24px padding. Emoji at 36px font-size, title bold, description in secondary text (`#555`). Cards are equal height within each row (CSS grid `auto-fill`).

**Mobile (< 768px):** Single column stack, full-width cards.

---

## Section 4: Comparison Table

**Layout:** White (`#ffffff`) background. Full container width (not constrained to 65ch). Heading centered above table.

**Heading (h2):**
> How Keygrain compares

**Subheading (p):**
> Honest comparison. Every tool has trade-offs.

**Table:**

| Dimension | Keygrain | LessPass | Spectre | Bitwarden (free) |
|-----------|----------|----------|---------|-------------------|
| Approach | Deterministic derivation | Deterministic derivation | Deterministic derivation | Encrypted vault |
| Password storage | None — recomputed | None — recomputed | None — recomputed | Encrypted cloud vault |
| Breach risk | Nothing to steal | Nothing to steal | Nothing to steal | Encrypted cloud storage |
| Offline use | ✅ Full | ✅ Full | ✅ Full | ⚠️ Partial (cached) |
| Cross-device sync | Automatic (same inputs) | Automatic (same inputs) | Automatic (same inputs) | ✅ Cloud sync |
| Browser extension | ✅ | ✅ | ❌ | ✅ |
| Mobile app | ✅ Android | ✅ Android/iOS | ⚠️ iOS (dormant) | ✅ Android/iOS |
| Open source | ✅ | ✅ | ✅ | ✅ |
| Password sharing | ❌ | ❌ | ❌ | ✅ |
| Breach monitoring | ❌ | ❌ | ❌ | ✅ |
| Autofill | Extension only | Extension only | Manual | ✅ Native |
| **Trade-offs** | Must remember one secret; no sharing; no breach alerts | Unmaintained since 2022; limited config | iOS app (dormant); no extension | Requires trust in cloud infrastructure; account needed |

**Cell highlighting:**
- Green (`#ecfdf5`) background: cells where Keygrain has a clear advantage
- Red (`#fef2f2`) background: cells where Keygrain has a clear limitation
- No highlight: neutral/equivalent cells

**Highlighted green:** Keygrain column for "Breach risk", "Offline use", "Cross-device sync"
**Highlighted red:** Keygrain column for "Password sharing", "Breach monitoring", "Autofill"

**Mobile (< 768px):** Horizontal scroll container with `-webkit-overflow-scrolling: touch`. First column (dimension names) is sticky-positioned (`position: sticky; left: 0`). Table cell font-size drops to 14px.

---

## Section 5: Download / Install

**Layout:** `#fafafa` background. Heading centered, then 3-column grid (desktop/tablet), single column (mobile < 768px).

**Heading (h2):**
> Get Keygrain

**Subheading (p):**
> Free. No account needed. Start in seconds.

**Columns:**

### Android App
- Emoji: 📱 (36px)
- Title: "Android App"
- QR code: `<img src="/qr-download.png" alt="QR code to download Keygrain APK" width="200" height="200">`
- Link: "Download APK" → `/app/keygrain.apk`
- Note (small, secondary text): "Android 8+ • No Play Store account needed"

### Browser Extension
- Emoji: 🧩 (36px)
- Title: "Browser Extension"
- Links:
  - "Chrome Web Store" → `#` (placeholder)
  - "Firefox Add-ons" → `#` (placeholder)
- Note: "Auto-detects sites • One-click fill"

### Web Generator
- Emoji: 🌐 (36px)
- Title: "Web Generator"
- Link: "Open in Browser" → `/generate/`
- Note: "No install needed • Works on any device"

**Card style:** Same as features cards (surface, shadow, 24px padding, centered content).

**Mobile (< 768px):** Single column, full-width cards stacked.

---

## Section 6: Footer

**Layout:** Dark (`#111827`) background matching hero. Centered content, 48px vertical padding.

**Content:**
> Privacy Policy · GitHub (coming soon) · contact@secbytech.com

- "Privacy Policy" → `/privacy.html`
- "GitHub" → `#` (placeholder, styled as muted/disabled with "coming soon" label)
- Contact: plain text email (not a mailto link — avoids spam scraping)

**Copyright line (small text, muted):**
> © 2026 SecByTech. Keygrain is open-source software.

**Mobile (< 768px):** Links stack vertically with 8px gap instead of inline with dot separators.

---

## Responsive Behavior Summary

| Section | Desktop (≥1080px) | Tablet (768–1079px) | Mobile (<768px) |
|---------|-------------------|---------------------|-----------------|
| Hero | 39px h1, buttons side-by-side, 120px padding | 31px h1, buttons side-by-side, 80px padding | 25px h1, buttons stacked full-width, 80px padding |
| How It Works | 3 cards horizontal with → arrows | 3 cards horizontal with → arrows | Cards stacked with ↓ arrows |
| Features | 3×2 grid | 2×3 grid | Single column |
| Comparison | Full table visible | Full table visible | Horizontal scroll, sticky first column, 14px font |
| Download | 3-column grid | 3-column grid | Single column stacked |
| Footer | Single line centered | Single line centered | Links stacked vertically |

Note: At tablet width, the "How It Works" 3-card layout may be tight (~200px per card). Implementer may adjust to stacked at tablet if needed — the spec states intent, not pixel-perfect constraint.

---

## Performance

- **No external resources:** Zero network requests beyond the HTML file and QR PNG
- **Target page weight:** <50KB (HTML + embedded CSS). QR image is 379 bytes.
- **No JavaScript:** Pure HTML+CSS. No interactivity required.
- **No web fonts:** System font stack (`system-ui`) loads instantly.
- **Single image:** QR code (379B). Use `width`/`height` attributes to prevent layout shift.
- **CSS strategy:** All styles in `<style>` tag in `<head>`. No render-blocking external resources.
- **Caching:** Server should set `Cache-Control: public, max-age=3600` for HTML, longer for static assets.
