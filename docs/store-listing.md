# Keygrain — Store Listing

## Short Description (132 chars max for Chrome)

Derive unique passwords from one master secret. No storage, no sync, no accounts. Works offline.

## Detailed Description

Keygrain generates unique, strong passwords from a single master secret + your email. Same inputs always produce the same password — no database to lose, no cloud to trust.

HOW IT WORKS:
• Enter your master secret and email
• Get a unique password for any site
• Copy to clipboard or autofill directly

FEATURES:
• Deterministic — same inputs = same password, every time
• Offline — no network requests, works without internet
• Autofill — fills password fields with one click (Ctrl+Shift+K)
• Per-site customization — adjust length, symbols, and salt
• Visual verification — colored fingerprint confirms your secret is correct
• No storage — your master secret is never saved by the extension

SECURITY:
• HMAC-SHA256 cryptographic derivation
• Master secret never leaves your browser
• No analytics, no tracking, no accounts
• Open source: https://dev.secbytech.com/tools/keygrain

PRIVACY:
• Zero data collection
• No network requests
• Privacy policy: https://keygrain.secbytech.com/privacy.html

---

## Chrome Web Store Submission Checklist

1. Upload: dist/keygrain-chrome.zip
2. Icon: logo/keygrain-128x128.png (already in zip)
3. Screenshot: Take one of the popup open in Chrome (1280x800)
4. Promo tile: logo/keygrain-440x280.png
5. Category: Productivity
6. Language: English
7. Privacy policy URL: https://keygrain.secbytech.com/privacy.html
8. Single purpose: "Generate deterministic passwords from a master secret"
9. Permissions justification:
   - activeTab: "To fill password fields on the current page when user clicks Fill"
   - scripting: "To inject the password fill script into the active tab"
   - storage: "To remember the user's last-used email per domain"

## Firefox Add-ons Submission Checklist

1. Upload: dist/keygrain-firefox.zip
2. Category: Security & Privacy
3. License: MIT
4. Homepage: https://keygrain.secbytech.com
5. Support email: admin@secbytech.com
