# Chrome Web Store Listing — Keygrain

## Name

Keygrain

## Short Description (132 chars max)

Derives passwords, TOTP codes, SSH keys & BIP-39 wallets from your master secret. In-memory security. Encrypted sync.

(117 characters)

## Detailed Description

Keygrain is a deterministic credential generator. Instead of storing generated passwords in a vault, it derives them on-the-fly from your master secret and the site name. The same inputs always produce the same output, and your master secret and derived credentials never touch persistent disk. The extension retains only local service configuration, account/device state, and encrypted sync data.

HOW IT WORKS:
• Enter your master secret and email
• Get unique passwords, 2FA codes, SSH keys, and BIP-39 recovery phrases
• Copy to clipboard or autofill directly

FEATURES:
• Multi-asset interface — dedicated tabs for Logins, SSH Keys, and HD Wallets
• Deterministic — same inputs = same credentials, every time
• In-memory security — master secret and session credentials live strictly in volatile memory, never on disk
• Two-tier auto-lock — keep service names visible for fast search while the master secret expires on a shorter timeout
• TOTP authenticator — derive 2FA verification codes on demand (no separate app needed)
• SSH key management — generate, view, and export Ed25519 public keys (.pub) and OpenSSH private keys (PEM)
• HD wallets — derive standard 12-word or 24-word BIP-39 disaster recovery phrases directly from your master secret
• Email-decoupled keys & wallets (Spec v5) — SSH keys and crypto wallets derive independently of your account email
• Encrypted sync — optionally sync your service list across devices using client-side AES-256-GCM encryption
• Offline mode — easily decouple from sync networks whenever you want complete isolation
• Autofill — fills login fields with one click or Ctrl+Shift+L (Command+Shift+L on Mac)
• Per-site customization — adjust password length, symbols, and counter rotation
• Visual verification — colored fingerprint confirms your secret is entered correctly
• Context menu — right-click any password field to fill instantly
• Zero vault storage — generated passwords are recomputed on-the-fly; no plaintext passwords exist to be breached

SECURITY:
• HMAC-SHA256 cryptographic derivation with Argon2id key strengthening
• Master secret never leaves your browser; derived passwords are never sent to the sync server
• Sync data encrypted locally before transmission — server stores only opaque ciphertext
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
