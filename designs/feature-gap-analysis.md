# Feature Gap Analysis

Verified 2026-05-12 against actual codebase. Each item checked by reading source files directly.

## EXISTS (2)

### 1. Export/Import Backup from Extension ✅

The extension has working export AND import of encrypted backups.

- **Export:** `popup.js:1605` — encrypts `{services, wallets, wallet_audit_log}` as JSON via `encryptBlob()`, saves as `.keygrain` file via `exportToFile()`
- **Import:** `import.html` + `import.js` — accepts `.keygrain` files, decrypts with user's key, replaces local storage
- Both directions functional and tested

### 7. Extension dist is stale ✅ (confirmed)

- `shared/popup.js` modified: May 12 00:36 (timestamp 1778546180)
- `dist/chrome/popup.js` built: May 11 17:49 (timestamp 1778521748)
- Source is ~7 hours newer than dist. Rebuild required via `extension/build.sh`.

## MISSING (8)

### 2. Import from Other Password Managers ❌

`import.html` only accepts `.keygrain` encrypted backup files. No CSV/JSON parsing for 1Password, Bitwarden, or LastPass exports.

- File input: `accept=".keygrain,application/octet-stream"`
- `import.js` only calls `decryptBlob()` — no format detection or CSV parsing

### 3. TOTP CLI Subcommand ❌

`cli.py` defines: `password`, `ssh`, `wallet`, `wallet-bip85`. No `totp` subcommand.

- `totp.py` module exists with full implementation (`generate_totp`, `parse_totp_input`, `derive_totp_seed`)
- Exported in `__init__.py`, tested in `test_totp.py`
- Library works; CLI integration is the gap

### 4. Password Strength Indicator on Web Generator ❌

The web generator (`server/static/generate/index.html`) shows NO strength information for generated passwords.

- Has visual fingerprint (colored dots) for secret verification only
- Extension has TWO strength indicators: secret entropy meter (`popup.js:968`) and per-service strength bar (`popup.js:718` — strong/good/fair based on length)
- Neither is present in the web generator

### 5. Dark/Light Mode on Website ❌ (dark-only)

The website uses hardcoded dark theme with no system preference detection.

- `index.html`, `generate/index.html`, `guide/index.html`: all use `--bg: #0f1117` with no `@media (prefers-color-scheme)` query
- Extension popup.css, import.html, help.css, wallet-page.css, migrate.css all have `@media (prefers-color-scheme: dark)` supporting both modes
- Website is dark-only; no toggle exists

### 6. Keyboard Shortcut Documentation on Website ❌

The public website guide page (`server/static/guide/index.html`) does not mention keyboard shortcuts.

- `docs/user-guide-extension.md` (internal, not served) documents shortcuts at lines 109, 143, 267
- `extension/shared/help.html` (extension-only page) documents Ctrl+Shift+K, arrow keys, Enter, Escape
- `CHANGELOG.md` mentions them
- The public-facing guide page has zero keyboard shortcut content

### 8. Kotlin Tests in CI ❌

CI only builds; never runs tests.

- `.gitlab-ci.yml` `build-mobile` job: `./gradlew assembleRelease` — no test task
- Test files exist: `KeygrainTest.kt`, `WalletEngineTest.kt`, `SshEngineTest.kt`, `TotpEngineTest.kt`
- JUnit dependency in `build.gradle.kts` (line 82)
- Fix: add `./gradlew test` before `assembleRelease` in CI

### 9. End-to-End Tests ❌

No browser automation tests exist.

- No Puppeteer/Playwright/Selenium/Cypress configuration or test files
- Only mentioned as future work in `designs/browser-extension.md`
- `extension/tests/test.mjs` is a Node.js unit test, not browser automation

### 10. Site Name Variant Recovery ❌

No feature to suggest alternative site names (e.g., google.com vs gmail.com).

- `rules.json` only contains per-domain password constraints (maxLength, symbols) — no alias mappings
- Extension shows "Add [hostname]?" for unregistered sites but has no variant/alias suggestion
- No alias table or domain-relationship mapping anywhere in codebase
