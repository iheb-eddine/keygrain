# Keygrain Web Generator (PWA)

The offline, client-side password generator served at
**[keygrain.com/generate](https://keygrain.com/generate/)**.

This is a **client** — like the browser extension, the Python CLI, and the Android app,
it derives passwords entirely in your browser using the algorithm in
[`../SPEC.md`](../SPEC.md). It performs **no server communication and has no sync**
(open the page, then go offline — it still works). Its source lives here, in the public
repository, so it is auditable and verifiable even though the hosting server is
closed source.

## Contents

- `index.html` — the generator UI + logic (Passwords, SSH Keys, HD Wallets)
- `hash-wasm-argon2.js` — vendored Argon2id (WASM loader), same as the extension uses
- `tweetnacl.js` — vendored Ed25519 signing library (for SSH key derivation)
- `bip39-wordlist.js` — vendored BIP-39 English wordlist (for HD wallet derivation)
- `manifest.json`, `sw.js` — PWA manifest + service worker (offline caching only)
- `icon-128.png` — app icon

## How it's served

The hosting deployment copies this directory verbatim into the public generator
path. Nothing is transformed — what's served at `keygrain.com/generate/` is
exactly these files.

## Verifying it

Because it's served as plain, unminified files, you can compare what your browser loads
against this directory (view-source, or save the page assets and diff). See
[`../VERIFY.md`](../VERIFY.md).

### Zero Network Requests
Once loaded, the generator makes **no network calls** (no telemetry, no analytics, no external APIs). Derivations occur entirely inside your browser's local memory. You can disconnect your network connection or save the page locally (`file:///.../index.html`) to run completely airgapped.

### Third-Party Vendored Cryptographic Libraries

All third-party files in this directory are unmodified upstream releases with zero npm build dependencies. You can verify their integrity against official public registries:

| File | Upstream Package & Release | SHA-256 Checksum | Verification Command |
|------|---------------------------|-------------------|----------------------|
| `hash-wasm-argon2.js` | [`hash-wasm@4.12.0`](https://www.npmjs.com/package/hash-wasm/v/4.12.0) | `dcec617a2e1b700fa132d1583a186cb70611113395e869f2dd6cc82b415d3094` | `curl -sL https://cdn.jsdelivr.net/npm/hash-wasm@4.12.0/dist/argon2.umd.min.js \| sha256sum` |
| `tweetnacl.js` | [`tweetnacl@1.0.3`](https://www.npmjs.com/package/tweetnacl/v/1.0.3) | `3ec535c004aeeb225785d8e93fb33bf99f52e399bd7dfc01969b5629baea5131` | `curl -sL https://cdn.jsdelivr.net/npm/tweetnacl@1.0.3/nacl-fast.min.js \| sha256sum` |
| `bip39-wordlist.js` | [BIP-39 English Wordlist](https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt) | `2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda` (wordlist text) | Self-checked via embedded SHA-256 integrity check function on load |

All other code (`index.html`, `sw.js`) is unminified vanilla JavaScript.
