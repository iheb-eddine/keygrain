# Chrome Web Store Listing — Keygrain

## Name

Keygrain

## Short Description (132 chars max)

Derives passwords, TOTP codes, SSH keys & wallet seeds from a master secret. Encrypted sync. Derived passwords aren't stored.

(125 characters)

## Detailed Description

Keygrain is a deterministic password generator. Instead of storing generated passwords in a vault, it derives them on-the-fly from your master secret and the site name. The same inputs always produce the same output, and derived passwords are not stored. The extension may retain local service configuration, account/device state, and encrypted service data.

HOW IT WORKS:
• Enter your master secret and email
• Get a unique password for any site
• Copy to clipboard or autofill directly

FEATURES:
• Deterministic — same inputs = same password, every time
• TOTP — derive authenticator codes from your master secret (no separate app needed)
• SSH keys — generate deterministic Ed25519 SSH keys
• HD wallets — derive BIP-39 mnemonic seeds for cryptocurrency wallets
• Encrypted sync — optionally sync your site list across devices (encrypted service data; the master secret and derived passwords are not sent to the sync server)
• Autofill — fills password fields with one click or Ctrl+Shift+Y
• Per-site customization — adjust length, symbols, and counter
• Visual verification — colored fingerprint confirms your secret is correct
• Auto-lock — master secret cleared from memory after inactivity
• Context menu — right-click any password field to fill
• No derived-password storage — generated passwords are recomputed; local service configuration, account/device state, and encrypted service data may remain on the device
• Optional PIN unlock — may retain an encrypted local copy of the master secret

SECURITY:
• HMAC-SHA256 cryptographic derivation with Argon2id key strengthening
• Master secret never leaves your browser; derived passwords are never sent to the sync server
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
