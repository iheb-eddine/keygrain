# Design: Unit Tests for Popup Modules

## Overview

Unit tests for the 5 extracted popup modules (`popup-search.js`, `popup-crypto.js`, `popup-dialog.js`, `popup-rules.js`, `popup-breach.js`). These modules expose independently testable globals with zero test coverage today.

**Target file:** `extension/tests/test-popup-modules.mjs`

---

## 1. Frozen Requirements

### 1.1 popup-search.js

#### fuzzyScore(query, text)

| # | Test case | Input | Assertion |
|---|-----------|-------|-----------|
| S1 | Exact match scores > 0 | `fuzzyScore("github", "github")` | `> 0` |
| S2 | No match returns 0 | `fuzzyScore("xyz", "github")` | `=== 0` |
| S3 | Prefix bonus | `fuzzyScore("gi", "github")` vs `fuzzyScore("gi", "agi")` | prefix score > non-prefix score |
| S4 | Consecutive bonus | `fuzzyScore("git", "github")` vs `fuzzyScore("gib", "g-i-b")` | consecutive score > scattered score |
| S5 | Word-boundary bonus | `fuzzyScore("p", "my-pass")` vs `fuzzyScore("p", "aapaaa")` | boundary score > mid-word score |
| S6 | Case insensitive | `fuzzyScore("GIT", "github")` | `> 0` |
| S7 | Partial match (not all chars found) | `fuzzyScore("githubx", "github")` | `=== 0` |

#### getFilteredServices(services, filter)

| # | Test case | Input | Assertion |
|---|-----------|-------|-----------|
| S8 | Empty filter returns all, sorted by frecency desc | services with frecency [5, 10, 1], filter `""` | order: [10, 5, 1] |
| S9 | Filter matches by name | services `[{name:"github",...}]`, filter `"git"` | returns the github service |
| S10 | Filter matches by email | services `[{name:"x", email:"alice@gmail.com",...}]`, filter `"alice"` | returns the service |
| S11 | Filter matches by site | services `[{name:"x", email:"y", site:"github.com"}]`, filter `"github"` | returns the service |
| S12 | No match returns empty | services `[{name:"github",...}]`, filter `"zzz"` | `[]` |
| S13 | Score × frecency ordering | two services matching filter, different frecency | higher frecency×score first |

### 1.2 popup-crypto.js

#### arrayBufferToBase64 / base64ToArrayBuffer (from sync.js, used by popup-crypto)

| # | Test case | Input | Assertion |
|---|-----------|-------|-----------|
| C1 | Round-trip: bytes → base64 → bytes | `new Uint8Array([0,1,127,128,255])` | deep equal after round-trip |
| C2 | Round-trip: empty buffer | `new Uint8Array([])` | deep equal after round-trip |
| C3 | Known vector | `new Uint8Array([72,101,108,108,111])` | base64 = `"SGVsbG8="` |

#### pinEncryptSecret / pinDecryptSecret

| # | Test case | Input | Assertion |
|---|-----------|-------|-----------|
| C4 | Round-trip: encrypt then decrypt recovers plaintext | pin=`"1234"`, secret=`"my-master-secret"` | decrypted === original |
| C5 | Wrong pin fails decryption | encrypt with `"1234"`, decrypt with `"9999"` | throws (AES-GCM auth failure) |
| C6 | Output structure | result of pinEncryptSecret | has keys `encrypted`, `salt`, `iv`; all are non-empty strings |

#### encryptServices / decryptServices

| # | Test case | Input | Assertion |
|---|-----------|-------|-----------|
| C7 | Round-trip: encrypt then decrypt recovers data | storageKey (32 random bytes), email, services array, wallets, auditLog | decrypted matches original |
| C8 | Wrong email (AAD mismatch) fails | encrypt with `"a@b.com"`, decrypt with `"x@y.com"` | throws |
| C9 | Output structure | result of encryptServices | has keys `version` (=2), `iv`, `ciphertext` |
| C10 | Decrypted structure | result of decryptServices | has keys `services`, `wallets`, `walletAuditLog` |

### 1.3 popup-dialog.js

#### esc(s)

| # | Test case | Input | Assertion |
|---|-----------|-------|-----------|
| D1 | Escapes `<` and `>` | `"<script>alert(1)</script>"` | contains `&lt;` and `&gt;`, no raw `<script>` |
| D2 | Escapes `&` | `"a & b"` | contains `&amp;` |
| D3 | Passes safe string unchanged | `"hello world"` | `=== "hello world"` |

#### nextTimestamp(services)

| # | Test case | Input | Assertion |
|---|-----------|-------|-----------|
| D4 | Returns > max updated_at | `[{updated_at: 1000}, {updated_at: 2000}]` | `>= 2001` |
| D5 | Returns >= Date.now() | `[{updated_at: 1}]` | `>= Date.now()` (approximately) |
| D6 | Empty array | `[]` | `>= Date.now()` |

#### formatRelativeTime(ts)

| # | Test case | Input | Assertion |
|---|-----------|-------|-----------|
| D7 | Null/0 returns empty | `0` | `=== ""` |
| D8 | Recent (< 60s ago) | `Date.now() - 30000` | `=== "just now"` |
| D9 | Minutes ago | `Date.now() - 300000` (5 min) | `=== "5m ago"` |
| D10 | Hours ago | `Date.now() - 7200000` (2 hr) | `=== "2h ago"` |

#### computeSyncStatus(syncInProgress, lastSyncError, lastSyncTime, retryState)

| # | Test case | Input | Assertion |
|---|-----------|-------|-----------|
| D11 | Syncing in progress | `(true, null, null, null)` | `{visible:true, text:"Syncing...", errorHtml:null}` |
| D12 | Network error with retry countdown | `(false, {type:"network",message:"..."}, null, {nextRetryAt: Date.now()+5000})` | visible, errorHtml contains "Connection error", contains "Retrying in" |
| D13 | Network error, retries exhausted | `(false, {type:"network",message:"fail"}, null, {attempt:3})` | errorHtml contains "Sync unavailable" |
| D14 | Auth error | `(false, {type:"auth"}, null, null)` | errorHtml contains "Authentication failed" |
| D15 | Generic error | `(false, {type:"other",message:"boom"}, null, null)` | errorHtml contains "boom" |
| D16 | String error (legacy) | `(false, "something broke", null, null)` | errorHtml contains "something broke" |
| D17 | Last sync time shown | `(false, null, Date.now()-60000, null)` | `{visible:true, text: contains "1m ago", errorHtml:null}` |
| D18 | No state | `(false, null, null, null)` | `{visible:false, text:"", errorHtml:null}` |

### 1.4 popup-rules.js

#### canonicalJSON(obj)

| # | Test case | Input | Assertion |
|---|-----------|-------|-----------|
| R1 | Sorts keys | `{b:1, a:2}` | `=== '{"a":2,"b":1}'` |
| R2 | Nested objects sorted | `{z:{b:1,a:2}, a:3}` | `=== '{"a":3,"z":{"a":2,"b":1}}'` |
| R3 | Arrays preserve order | `[3,1,2]` | `=== '[3,1,2]'` |
| R4 | Null | `null` | `=== 'null'` |
| R5 | Primitives | `"hello"`, `42`, `true` | standard JSON.stringify output |

#### lookupRule(hostname, rules)

| # | Test case | Input | Assertion |
|---|-----------|-------|-----------|
| R6 | Exact domain match | hostname=`"example.com"`, rules with `{domain:"example.com", exact:true}` | returns that rule |
| R7 | Subdomain match (non-exact) | hostname=`"sub.example.com"`, rules with `{domain:"example.com"}` | returns that rule |
| R8 | Subdomain rejected for exact rule | hostname=`"sub.example.com"`, rules with `{domain:"example.com", exact:true}` | `null` |
| R9 | www prefix stripped | hostname=`"www.example.com"`, rules with `{domain:"example.com", exact:true}` | returns that rule |
| R10 | No match | hostname=`"other.com"`, rules with `{domain:"example.com"}` | `null` |
| R11 | Null rules | hostname=`"x.com"`, rules=`null` | `null` |
| R12 | Null hostname | hostname=`null`, rules=`[...]` | `null` |

#### verifyRulesSignature(json, publicKeyBase64)

| # | Test case | Input | Assertion |
|---|-----------|-------|-----------|
| R13 | Valid signature verifies | Generate Ed25519 keypair, sign canonical payload, call verify | `=== true` |
| R14 | Tampered payload fails | Same as R13 but modify `json.rules` after signing | `=== false` |
| R15 | Wrong key fails | Sign with key A, verify with key B | `=== false` |

### 1.5 popup-breach.js

#### checkBreaches(breaches, services, dismissedIds)

| # | Test case | Input | Assertion |
|---|-----------|-------|-----------|
| B1 | Matching breach returned | breaches `[{id:"b1",domain:"github.com"}]`, services `[{site:"github.com"}]`, dismissed `[]` | returns `[{id:"b1",...}]` |
| B2 | Dismissed breach excluded | same as B1 but dismissed `["b1"]` | `[]` |
| B3 | Subdomain match | breaches `[{id:"b2",domain:"github.com"}]`, services `[{site:"sub.github.com"}]` | returns breach |
| B4 | www stripped from service | services `[{site:"www.github.com"}]`, breaches `[{id:"b3",domain:"github.com"}]` | returns breach |
| B5 | No matching service | breaches `[{id:"b4",domain:"other.com"}]`, services `[{site:"github.com"}]` | `[]` |
| B6 | Uses name as fallback when site is empty | services `[{name:"github.com", site:""}]`, breaches `[{id:"b5",domain:"github.com"}]` | returns breach |
| B7 | Multiple breaches, partial match | 3 breaches, only 1 matches | returns only the matching one |

---

## 2. Invariants

1. **Determinism:** All tests produce the same result on every run (no time-dependent flakiness). Tests that use `Date.now()` assert with tolerance (±2s) or mock time.
2. **Isolation:** Each test is independent — no shared mutable state between tests. The VM context is built once but tests do not mutate globals.
3. **Round-trip integrity:** For every encrypt/decrypt pair, `decrypt(encrypt(x)) === x` for all valid inputs.
4. **Crypto failure on wrong key/pin:** AES-GCM and Ed25519 operations MUST reject invalid credentials — never silently return garbage.
5. **XSS safety:** `esc()` must neutralize all HTML-significant characters in text content context (`<`, `>`, `&`).
6. **Score monotonicity:** Better fuzzy matches (prefix, consecutive, boundary) always score higher than worse matches.

---

## 3. Scope Boundary

### In Scope

| Module | Functions tested |
|--------|-----------------|
| popup-search.js | `fuzzyScore`, `getFilteredServices` |
| popup-crypto.js | `pinEncryptSecret`, `pinDecryptSecret`, `encryptServices`, `decryptServices`, `deriveStorageKey` (implicitly via encryptServices round-trip) |
| popup-dialog.js | `esc`, `nextTimestamp`, `formatRelativeTime`, `computeSyncStatus` |
| popup-rules.js | `canonicalJSON`, `lookupRule`, `verifyRulesSignature` |
| popup-breach.js | `checkBreaches` |

### Out of Scope

| Excluded | Reason |
|----------|--------|
| `fetchSiteRules` | Requires fetch mock for low-value network plumbing; signature verification (the critical part) is tested separately |
| `fetchBreachFeed` | Same — trivial fetch wrapper |
| `openDialog`, `closeDialog`, `showStatus` | DOM-heavy, require full DOM mock (focus management, classList, event listeners). Low logic density. |
| `pinDeriveKey` | Internal helper; tested implicitly via pinEncrypt/pinDecrypt round-trip |
| `deriveStorageKey` | Tested implicitly via encryptServices/decryptServices round-trip (needs strengthenSecret mock from existing test infra) |

### Dependencies / Mocks Required

| Dependency | Strategy |
|------------|----------|
| `crypto.subtle` (Web Crypto) | Node 20 `webcrypto` — already in test.mjs context |
| `arrayBufferToBase64` / `base64ToArrayBuffer` | Loaded from sync.js in VM context (existing pattern) |
| `strengthenSecret` / `hmacSHA256` | Loaded from keygrain.js in VM context (existing pattern with hashwasm mock) |
| `document.createElement` (for `esc`) | Minimal mock: object with `textContent` setter and `innerHTML` getter that HTML-encodes |
| `atob` / `btoa` | Already in test.mjs context |

---

## 4. Test Plan (Meta-Verification)

### How to verify the tests themselves are correct:

1. **Mutation testing (manual):** For each function, introduce a deliberate bug (e.g., remove the `consecutive` bonus in fuzzyScore, swap encrypt/decrypt, remove www-stripping in lookupRule). Verify the relevant test fails.

2. **Boundary coverage check:** Each test case targets a specific code path. The mapping is:
   - S3/S4/S5 → the three bonus branches in fuzzyScore
   - C5/C8 → AES-GCM authentication tag validation
   - R8 vs R7 → the `exact` flag branch in lookupRule
   - R14/R15 → Ed25519 rejection paths
   - B4/B6 → the `www.` strip and `svc.site || svc.name` fallback

3. **Run in CI:** The test file should be added to the same CI step that runs `test.mjs`. Exit code 1 on any failure.

4. **No false greens:** Every assertion must be specific enough that a no-op implementation would fail. E.g., don't just assert `result !== null` — assert the exact expected value or structural property.

5. **Crypto tests are non-trivial:** The round-trip tests use random IVs/salts, so they verify real crypto operations — not just serialization. The wrong-key tests verify that AES-GCM's authentication tag actually rejects.

---

## 5. Implementation Notes (for future implementer)

- Load popup modules into the VM context after the existing shared modules (they depend on sync.js globals).
- For `esc()`, inject a minimal `document` mock into the VM context before loading popup-dialog.js.
- For `verifyRulesSignature`, generate a fresh Ed25519 keypair in the test setup using `crypto.subtle.generateKey("Ed25519", true, ["sign","verify"])`.
- The test file structure mirrors test.mjs: imports, buildContext, load modules, test cases grouped by module.
- Total: ~40 test cases across 5 modules.
