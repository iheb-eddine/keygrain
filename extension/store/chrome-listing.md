# Chrome Web Store Listing — Keygrain

## Name

Keygrain

## Short Description (132 chars max)

Derives passwords, TOTP codes, SSH keys & wallet seeds from a master key. Encrypted sync. Nothing stored in plaintext.

(118 characters)

## Detailed Description

Keygrain is a deterministic password generator. Instead of storing passwords in a vault, it derives them on-the-fly from your master password and the site name. The same inputs always produce the same output — no database needed.

HOW IT WORKS:
• Enter your master secret and email
• Get a unique password for any site
• Copy to clipboard or autofill directly

FEATURES:
• Deterministic — same inputs = same password, every time
• TOTP — derive authenticator codes from your master secret (no separate app needed)
• SSH keys — generate deterministic Ed25519 SSH keys
• HD wallets — derive BIP-39 mnemonic seeds for cryptocurrency wallets
• Encrypted sync — optionally sync your site list across devices (end-to-end encrypted, server sees only ciphertext)
• Autofill — fills password fields with one click or Ctrl+Shift+K
• Per-site customization — adjust length, symbols, and counter
• Visual verification — colored fingerprint confirms your secret is correct
• Auto-lock — master secret cleared from memory after inactivity
• Context menu — right-click any password field to fill
• No plaintext storage — your master secret is never saved

SECURITY:
• HMAC-SHA256 cryptographic derivation with Argon2id key strengthening
• Master secret never leaves your browser
• Sync data encrypted locally before transmission — server cannot decrypt
• No analytics, no tracking, no cookies
• Open source: https://github.com/iheb-eddine/keygrain

PRIVACY:
• Zero plaintext data collection
• Sync transmits only encrypted blobs
• Privacy policy: https://keygrain.com/privacy.html

## Category

Productivity

## Language

English

## Privacy Policy URL

https://keygrain.com/privacy.html

## Single Purpose Description

Derive deterministic passwords, TOTP codes, SSH keys, and wallet seeds from a master secret, with optional end-to-end encrypted sync across devices.

## Version

1.1.0
