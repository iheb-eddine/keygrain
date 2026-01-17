# Keygrain — Store Listing

## Short Description (132 chars max for Chrome)

Generates unique passwords from a master key. Optional encrypted sync across devices. Nothing stored in plaintext — ever.

## Detailed Description

Keygrain is a deterministic password generator. Instead of storing passwords in a vault, it derives them on-the-fly from your master password and the site name. The same inputs always produce the same output — no database needed.

HOW IT WORKS:
• Enter your master secret and email
• Get a unique password for any site
• Copy to clipboard or autofill directly

FEATURES:
• Deterministic — same inputs = same password, every time
• Encrypted sync — optionally sync your site list across devices (end-to-end encrypted, server sees only ciphertext)
• Autofill — fills password fields with one click (Ctrl+Shift+K)
• Per-site customization — adjust length, symbols, and salt
• Visual verification — colored fingerprint confirms your secret is correct
• Auto-lock — master secret cleared from memory after inactivity
• No plaintext storage — your master secret is never saved

SECURITY:
• HMAC-SHA256 cryptographic derivation
• Master secret never leaves your browser
• Sync data encrypted locally before transmission — server cannot decrypt
• No analytics, no tracking, no cookies
• Open source: https://dev.secbytech.com/tools/keygrain

PRIVACY:
• Zero plaintext data collection
• Sync transmits only encrypted blobs
• Privacy policy: https://keygrain.secbytech.com/privacy.html

---

## Permissions Justification

| Permission | Justification |
|---|---|
| `activeTab` | Access the current tab's URL to determine which site to generate a password for, and to fill password fields when the user clicks Fill. |
| `alarms` | Schedule auto-lock timer to clear the master secret from memory after a user-configured inactivity period. |
| `contextMenus` | Add "Generate password" to the right-click context menu for quick access. |
| `scripting` | Inject the autofill script into the active tab to fill login form fields. |
| `storage` | Store encrypted site list, sync preferences, and per-domain settings locally. |
| `tabs` | Read tab URL and title for site identification during background operations (e.g., context menu clicks) when activeTab context is unavailable. |
| `host_permissions: https://keygrain.secbytech.com/*` | Communicate with the sync server to push and pull the user's encrypted vault data. |

---

## Privacy Policy

**Keygrain Privacy Policy**

Data collected: None in plaintext. When sync is enabled, an encrypted blob (your site list) is transmitted to keygrain.secbytech.com. The encryption key is derived from your master password, which never leaves your device.

Data stored locally: Encrypted site list, sync preferences, per-domain settings. No passwords are stored.

Data shared with third parties: None. The sync server stores only ciphertext it cannot decrypt.

Analytics/tracking: None. No telemetry, no analytics, no cookies.

Contact: admin@secbytech.com | https://secbytech.com

---

## Chrome Web Store Submission Checklist

1. Upload: dist/keygrain-chrome.zip
2. Icon: logo/keygrain-128x128.png (already in zip)
3. Screenshot: Take one of the popup open in Chrome (1280x800)
4. Promo tile: logo/keygrain-440x280.png
5. Category: Productivity
6. Language: English
7. Privacy policy URL: https://keygrain.secbytech.com/privacy.html
8. Single purpose: "Generate deterministic passwords from a master secret with optional encrypted sync"
9. Permissions justification: See table above

## Firefox Add-ons Submission Checklist

1. Upload: dist/keygrain-firefox.zip
2. Category: Security & Privacy
3. License: MIT
4. Homepage: https://keygrain.secbytech.com
5. Support email: admin@secbytech.com
