# Firefox Add-ons Listing — Keygrain

## Name

Keygrain

## Summary (250 chars max)

Deterministic password, TOTP, SSH key & wallet seed generator — derives secrets from your master key. Optional end-to-end encrypted sync. Your master secret never leaves your device. No vault, no plaintext storage.

(214 characters)

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
• Open source: https://dev.secbytech.com/tools/keygrain

## Category

Security & Privacy

## License

MIT

## Homepage

https://keygrain.secbytech.com

## Support Email

admin@secbytech.com

## Privacy Policy URL

https://keygrain.secbytech.com/privacy.html

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

Keygrain is a deterministic cryptographic derivation tool. It derives passwords, TOTP seeds, SSH keys, and HD wallet mnemonics using HMAC-SHA256 from a master secret + email + identifier. It does NOT store secrets — it recomputes them each time.

### Key behaviors

1. User enters master secret and email in the popup
2. The extension derives passwords for saved sites using HMAC-SHA256
3. Passwords can be copied or autofilled into login forms
4. TOTP: derives authenticator seeds deterministically (or imports existing TOTP secrets)
5. SSH: derives Ed25519 key pairs using tweetnacl (`nacl.sign.keyPair.fromSeed()`)
6. Wallets: derives BIP-39 mnemonic seeds for cryptocurrency wallets
7. Optionally, the encrypted site list syncs to keygrain.secbytech.com (end-to-end encrypted — server cannot decrypt)
8. Auto-lock clears the master secret from memory after configurable inactivity

### Test instructions

1. Install the extension
2. Click the extension icon to open the popup
3. Enter any master secret (e.g., "test-secret") and any email (e.g., "test@example.com")
4. Click "Add Service", enter a site name (e.g., "github.com")
5. A deterministic password is generated — verify it's the same every time with the same inputs
6. Navigate to github.com, click the extension icon, click "Fill" to autofill
7. To test sync: enable sync in settings (requires creating an account on keygrain.secbytech.com)

### Network requests

The extension makes network requests to `https://keygrain.secbytech.com` for:
1. **Sync** (`/api/sync/*`) — when sync is enabled, pushes/pulls the encrypted vault. All transmitted data is encrypted client-side with AES-256-GCM before sending. The server stores only opaque ciphertext.
2. **Site rules** (`/rules.json`) — fetches password rules for known sites (max length, required chars). Simple GET, no user data sent.
3. **Breach feed** (`/breaches.json`) — fetches breach notifications. Simple GET, no user data sent.

### Permissions used

- `activeTab` — read current tab URL for site matching, inject autofill script
- `alarms` — auto-lock timer (clears secret after inactivity) and periodic sync (every 5 minutes when unlocked)
- `contextMenus` — "Fill with Keygrain" right-click menu on editable fields
- `storage` — encrypted site list and settings in local storage
- `tabs` — read tab URL during background operations (badge updates, context menu, keyboard shortcut)
- `https://keygrain.secbytech.com/*` — sync server communication

## Version

1.1.0
