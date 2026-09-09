# Firefox Add-ons Listing — Keygrain

## Name

Keygrain

## Summary (250 chars max)

Deterministic password, TOTP, SSH key & BIP-39 wallet generator. Derives credentials on-the-fly with zero disk secrets. Multi-asset interface & optional encrypted sync.

(168 characters)

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

## Category

Security & Privacy

## License

MIT

## Homepage

https://keygrain.com

## Support Email

contact@keygrain.com

## Privacy Policy URL

https://keygrain.com/privacy.html

## Tags

password-generator, deterministic, encryption, sync, security

## Source Code Disclosure

This extension bundles two third-party libraries in minified form under `lib/`:

| File | Package | npm URL | Purpose |
|------|---------|---------|---------|
| `lib/tweetnacl.js` | tweetnacl | https://www.npmjs.com/package/tweetnacl | Ed25519 key pair generation for SSH key derivation (`nacl.sign.keyPair.fromSeed()` in ssh.js) |
| `lib/hash-wasm-argon2.js` | hash-wasm (Argon2 subset) | https://www.npmjs.com/package/hash-wasm | Argon2id key strengthening of the master secret before derivation (keygrain.js) |

**Version identification:** Neither file embeds a version number. The hash-wasm file header credits "Dani Biro" and links to the npm package. The tweetnacl file has no header. Exact versions can be verified by comparing file hashes against published npm tarballs.

**Verification:** Download the npm packages and compare the minified output against the bundled files. The source repositories are linked from each npm package page.

**All other code** (popup.js, background.js, sync.js, keygrain.js, content.js, etc.) is original, unminified, and readable.

## Notes to Reviewer

### What this extension does

Keygrain is a deterministic cryptographic derivation tool. It derives passwords and TOTP seeds from master secret + email + site, and derives SSH keys and HD wallet mnemonics independently from master secret + identifier (Spec v5). It does NOT store generated passwords — it recomputes them each time. The extension retains only local service configuration, account/device state, and encrypted sync data. Master secrets and session keys live strictly in volatile memory (chrome.storage.session) and are never stored on persistent disk.

### Key behaviors

1. User enters master secret and email in the popup
2. The extension derives passwords for saved sites using HMAC-SHA256
3. Passwords can be copied or autofilled into login forms
4. TOTP: derives authenticator seeds deterministically (or imports existing TOTP secrets)
5. SSH: derives Ed25519 key pairs using tweetnacl (`nacl.sign.keyPair.fromSeed()`)
6. Wallets: derives BIP-39 mnemonic seeds for cryptocurrency wallets
7. Optionally, the encrypted site list syncs to keygrain.com (end-to-end encrypted — server cannot decrypt)
8. Auto-lock clears the master secret from memory after configurable inactivity

### Test instructions

1. Install the extension
2. Click the extension icon to open the popup
3. Enter any master secret (e.g., "test-secret") and any email (e.g., "test@example.com")
4. Click "Add Service", enter a site name (e.g., "github.com")
5. A deterministic password is generated — verify it's the same every time with the same inputs
6. Navigate to github.com, click the extension icon, click "Fill" to autofill
7. To test sync: enable sync in settings. Use the same email and master secret on another installation; no normal Keygrain account is required.

### Network requests

The extension makes network requests to `https://keygrain.com` for:
1. **Sync** (`/api/sync/*`) — when sync is enabled, pushes/pulls the encrypted vault. All transmitted data is encrypted client-side with AES-256-GCM before sending. The server stores only opaque ciphertext.
2. **Site rules** (`/rules.json`) — fetches password rules for known sites (max length, required chars). Simple GET, no user data sent.
3. **Breach feed** (`/breaches.json`) — fetches breach notifications. Simple GET, no user data sent.

### Permissions used

- `activeTab` — read current tab URL for site matching, inject autofill script
- `alarms` — auto-lock timer (clears secret after inactivity) and periodic sync (every 5 minutes when unlocked)
- `contextMenus` — "Fill with Keygrain" right-click menu on editable fields
- `storage` — encrypted site list and settings in local storage
- `tabs` — read tab URL during background operations (badge updates, context menu, keyboard shortcut)
- `https://keygrain.com/*` — sync server communication
