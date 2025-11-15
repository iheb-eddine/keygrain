# Keygrain — Feature Roadmap

## Context

These features close the gap with competitors (LessPass, Spectre) and move Keygrain from a personal tool to a viable daily-driver password manager.

## Recommended Sequence

### 1. Web Generator (client-side)

**Effort:** ~0.5 day
**Impact:** Medium — fallback for any device, no install needed

- Single HTML page with client-side JS
- Port HMAC-SHA256 derivation to Web Crypto API (~80 lines)
- Add to existing `server/static/` or as a separate page
- No server interaction — runs entirely in browser
- No build step needed

**Dependencies:** None

---

### 2. Browser Extension

**Effort:** ~3-5 days
**Impact:** Highest — daily driver UX, biggest adoption lever

- HTML popup with email/length/symbols/salt fields
- Reuse JS algorithm from web generator
- Chrome (Manifest V3) + Firefox (WebExtensions)
- Content script to detect and fill password fields
- Keyboard shortcut (Ctrl+Shift+L)
- Clipboard copy fallback

**Complexity notes:**
- Two separate manifests (Chrome vs Firefox)
- Content script ↔ popup communication
- Autofill edge cases: iframes, shadow DOM, dynamically loaded fields
- Store submission (Chrome Web Store, Firefox Add-ons)

**Dependencies:** JS algorithm port (shared with web generator)

---

### 3. iOS App

**Effort:** ~5-7 days
**Impact:** Medium — covers the other half of mobile users

- Swift/SwiftUI app
- CryptoKit for HMAC-SHA256 (built-in, no deps)
- Keychain for secret storage
- UI matching Android app functionality
- Apple Developer account ($99/year)

**Complexity notes:**
- Requires a Mac for development and submission
- App Store review process (privacy disclosures for password tools)
- Ongoing maintenance for iOS version updates
- Alternative: Kotlin Multiplatform (shares derivation engine but adds build complexity)

**Dependencies:** Mac, Apple Developer Program

---

### 4. Argon2id / Slow KDF Option

**Effort:** ~2-3 days
**Impact:** Low-medium — broadens audience to memorized-passphrase users

- Optional mode: `derived_secret = Argon2id(passphrase, email, params)` before HMAC
- Toggle in UI / CLI flag — existing high-entropy secret users skip it
- SPEC.md update with new mode documentation

**Per-platform implementation:**
- Python: `argon2-cffi` package
- Kotlin/Android: Bouncy Castle or Signal's argon2 (native dep)
- JavaScript: `argon2-browser` (WASM, ~300KB)

**Complexity notes:**
- Cross-platform parameter consistency is critical (memory, iterations, parallelism)
- Needs dedicated test vectors for the slow-KDF mode
- Adds a second derivation path — complicates the algorithm story
- Only worth it if targeting users with memorized passphrases (not high-entropy secrets)

**Dependencies:** Native dependencies on each platform, SPEC change

---

## Competitive Context

| Competitor | Strengths over Keygrain | Keygrain's advantage |
|------------|------------------------|---------------------|
| LessPass | Browser extension, iOS, web generator, 6k stars | Simpler backup model (no accounts), lighter server |
| Spectre | iOS app, scrypt (slow KDF), established brand | Encrypted backup/sync, simpler algorithm |
| SeedPass.me | BIP-85 (crypto-native), Nostr sync | More accessible, not crypto-niche |

## Notes

- Features 1 and 2 share the JS algorithm port — do them together
- The web generator is near-zero effort and immediately useful as a demo/fallback
- Browser extension is the single highest-impact feature for daily usability
- iOS and Argon2id are independent and can be done in either order based on user demand
