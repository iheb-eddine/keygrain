# Website & Project Backlog

All outstanding items that must be completed before public launch.

---

## Priority 1: Blocking (must fix before any user sees the site)

| # | Item | Details |
|---|------|---------|
| 1.1 | **Domain migration: keygrain.com** | Replace all references to keygrain.com with keygrain.com. Affects: server config, nginx, SSL cert, extension host_permissions, manifests, privacy policy, store listings, README, SPEC.md, landing page, CI/CD deploy scripts, sync URL in extension code. |
| 1.2 | **Dead store links (#)** | Chrome Web Store and Firefox Add-ons buttons on landing page link to `#`. Either link to actual stores (after submission) or replace with "Coming soon" + email signup. |
| 1.3 | **Contact email inconsistency** | Privacy policy says `admin@secbytech.com`, footer says `contact@secbytech.com`. Unify to `contact@keygrain.com` after domain migration. |
| 1.4 | **Sync is broken ("sync failed")** | Extension shows "sync failed" when attempting to sync. Investigate and fix — this is a core feature. |
| 1.5 | **Enter key doesn't submit forms in extension** | PIN entry and other inputs require clicking the button — Enter key does nothing. Annoying UX gap. |
| 1.6 | **No way to reset/change secret+email** | Once a secret is set, there's no UI to clear it and enter a different one. User is locked in. Need a "Reset" or "Change secret" option (with confirmation). |
| 1.7 | **Counter rotation is irreversible** | If user clicks "Rotate password" by mistake, they can't go back. If backup is lost, they can't manually set the counter to restore old passwords. Need: undo rotation (or at minimum, manual counter edit). |

## Priority 2: High (needed for a professional, complete website)

| # | Item | Details |
|---|------|---------|
| 2.1 | **Source code link** | Add link to repository in footer and/or download section. Currently claims "open source" but provides no link. |
| 2.2 | **Python CLI in download section** | Landing page shows Chrome/Firefox/Android but not `pip install keygrain`. Add a 4th card. |
| 2.3 | **Stale threat model: modulo bias** | Threat model "Accepted Trade-offs" section still mentions modulo bias. Fixed in spec v4 — update or remove. |
| 2.4 | **Favicon** | No favicon on any page. Add favicon.ico + apple-touch-icon for proper browser tab/bookmark appearance. |
| 2.5 | **Getting started guide** | No web-accessible guide for new users. Extension has in-app help but the website has nothing explaining the workflow beyond "How it works". |
| 2.6 | **Product screenshot/mockup in hero** | No visual showing what the product looks like. Visitors can't picture using it. Need at least one screenshot of the extension popup or mobile app. |
| 2.7 | **SVG icons on security cards** | Security section is 3 plain text cards. Add icons (lock, shield, cloud-lock) for visual weight. |
| 2.8 | **Richer footer** | Current footer is 3 links + copyright. Professional sites have columns: Product, Resources, Legal. |
| 2.9 | **"No cookies · No analytics · No tracking" trust signal** | Visible statement in footer or banner. Turns absence of tracking into a positive trust signal for a security product. |
| 2.10 | **Sticky navigation header on landing page** | No way to navigate sections or return to top after scrolling. |
| 2.11 | **Active user count display** | Show "X users synced this week" or similar social proof. See §Implementation Notes below. |

## Priority 3: Polish (professional completeness)

| # | Item | Details |
|---|------|---------|
| 3.1 | **Comparison page** | "Why Keygrain vs 1Password/Bitwarden/LastPass?" — helps users understand the tradeoff. |
| 3.2 | **Changelog / Release notes** | Public changelog so users can see what's new. |
| 3.3 | **Terms of service** | Not strictly required for a free tool but adds professionalism. |
| 3.4 | **Meta tags (SEO/social)** | og:title, og:description, og:image for social sharing. Twitter card. |
| 3.5 | **404 page** | Custom 404 matching the dark theme instead of nginx default. |
| 3.6 | **"Who built this" / credibility statement** | Brief positioning: "Built by a security engineer" or similar. |
| 3.7 | **Positioning statement** | One visible sentence: "Unlike password vaults, Keygrain stores nothing to breach." |

---

## Implementation Notes

### Domain migration (1.1) — scope of changes:

**Server/infra:**
- DNS: point keygrain.com → server IP
- nginx: update server_name, add redirect from secbytech.com
- SSL: new Let's Encrypt cert for keygrain.com
- CI/CD deploy script: update target domain

**Code (all platforms):**
- `extension/shared/popup.js` — sync URL, rules.json URL, breaches.json URL
- `extension/shared/background.js` — sync URL
- `extension/chrome/manifest.json` — host_permissions
- `extension/firefox/manifest.json` — permissions
- `server/static/index.html` — any absolute URLs
- `server/static/privacy.html` — any references
- `server/static/threat-model/index.html` — any references
- `python/README.md` — homepage URL
- `python/pyproject.toml` — project URLs
- `README.md` — all URLs
- `extension/store/chrome-listing.md` — URLs
- `extension/store/firefox-listing.md` — URLs
- `MANUAL_TASKS.md` — URLs
- `kotlin/` — sync URL in SyncManager.kt

**Test:** grep -r "secbytech" to find all occurrences.

### Active user count (2.11):

**Approach:** Track unique lookup_ids that hit `/api/sync/` (GET or PUT) within time windows.

**Server-side:**
- Add a lightweight counter: on each sync request, record `lookup_id` + `timestamp` in a small table (or Redis set with TTL).
- Expose a public endpoint: `GET /api/stats` returning:
  ```json
  {"active_24h": 12, "active_7d": 45, "active_30d": 89}
  ```
- "Active" = unique lookup_ids that performed at least one sync operation in the window.
- No PII exposed — lookup_ids are derived hashes, and the endpoint only returns counts.

**Display:** Show on landing page (e.g., "89 users synced this month") once numbers are meaningful. Hide or show "New — be an early adopter" if count is low.

**Privacy consideration:** This counts sync users only. Users who never enable sync are invisible — which is fine (undercounting is better than tracking).

**Improvement suggestions:**
- Don't show raw numbers if they're embarrassingly low (<10). Use qualitative labels or hide until threshold.
- Consider showing "X passwords generated" instead (more impressive number, but harder to track without client-side reporting — skip this).
- The stat should update lazily (cache for 1 hour, not real-time).

### Counter rotation (1.7):

**Options:**
- Allow manual counter edit in the options panel (power user feature, hidden behind "Advanced")
- Add "Undo last rotation" (store previous counter value, allow one-step undo)
- Both: manual edit for recovery, undo for mistakes

### Secret reset (1.6):

**Approach:** Add a "Reset Keygrain" or "Switch account" button in extension settings. Must:
- Require confirmation ("This will clear all local data. Are you sure?")
- Clear: secret from memory, PIN, stored services, sync state
- Return to the initial unlock/setup screen

---

## Status

| Item | Status |
|------|--------|
| 1.1 Domain migration | ✅ Code done — DNS/nginx/SSL manual |
| 1.2 Dead store links | ✅ Replaced with 'Coming soon' |
| 1.3 Contact email | ✅ Unified to contact@keygrain.com |
| 1.4 Sync broken | ✅ Fixed (401→throw, server wipe needed) |
| 1.5 Enter key submit | ✅ Fixed (enterToClick on all inputs) |
| 1.6 Secret reset | ✅ Added (type RESET to confirm) |
| 1.7 Counter rotation | ✅ Fixed (editable number input) |
| 2.1 Source code link | ✅ Added to footers |
| 2.2 Python CLI card | ✅ Added to download section |
| 2.3 Threat model update | ✅ Modulo bias removed |
| 2.4 Favicon | ✅ Generated + linked |
| 2.5 Getting started guide | ✅ Created at /guide/ |
| 2.6 Product screenshot | ✅ CSS mockup added (real screenshot pending from user) |
| 2.7 Security card icons | ✅ SVG icons added |
| 2.8 Richer footer | ✅ 3-column + trust signal |
| 2.9 No-tracking trust signal | ✅ CSS pill in footer |
| 2.10 Sticky nav header | ✅ Added |
| 2.11 Active user count | ✅ GET /api/stats endpoint |
| 3.1 Comparison page | ✅ Created at /compare/ |
| 3.2 Changelog page | ✅ Created at /changelog/ |
| 3.3 Terms of service | ✅ Created at /terms/ |
| 3.4 Meta tags | ✅ og:image + social tags on all pages |
| 3.5 404 page | ✅ Created (needs nginx error_page config) |
| 3.6 Credibility statement | ✅ "Built with security-first principles" in footer |
| 3.7 Positioning statement | ✅ "Free and open source · Works offline · All platforms" in hero |

---

## Priority 1: Next Implementation Batch

| # | Item | Details | Status |
|---|------|---------|--------|
| N.1 | **Fingerprint unification (secret-only)** | Make colored dots depend only on secret across all platforms. Remove email dependency. Consistent behavior everywhere. | ✅ Done |
| N.2 | **TOTP Model B bug: uses global email instead of service.email** | `getTOTPCode` in extension passes `currentEmail` to `deriveTOTPSeed` instead of `service.email`. Fix across extension + document for Kotlin. | ✅ Done |
| N.3 | **Field derivation hints** | Add hints on all platforms (extension, web generator, mobile) indicating which fields affect the generated password. Users must know that site, email, length, symbols, counter ALL matter. | ✅ Done |
| N.4 | **Guide: non-website usage note** | Add to /guide/: "For non-website passwords (WiFi, keystores, API keys), use any memorable name in the Site field." | ✅ Done |
