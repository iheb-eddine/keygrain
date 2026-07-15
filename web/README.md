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

- `index.html` — the generator UI + logic
- `hash-wasm-argon2.js` — vendored Argon2id (WASM loader), same as the extension uses
- `manifest.json`, `sw.js` — PWA manifest + service worker (offline caching only)
- `icon-128.png` — app icon
- `test.html` — in-browser test harness

## How it's served

The production server (private) assembles this directory verbatim into its static
files at build time (`server/assemble-web.sh` copies `keygrain/web/` →
`server/static/generate/`). Nothing is transformed — what's served at
`keygrain.com/generate/` is exactly these files.

## Verifying it

Because it's served as plain, unminified files, you can compare what your browser loads
against this directory (view-source, or save the page assets and diff). See
[`../VERIFY.md`](../VERIFY.md).
