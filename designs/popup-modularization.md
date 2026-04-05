# Design: Modularization of popup.js

## 1. Overview

Split `extension/shared/popup.js` (1746 lines, 60+ functions) into smaller, focused files that are independently testable. The extension uses no module bundler — all files load via `<script>` tags in `popup.html`.

### Strategy: Utility Libraries Below, Orchestrator Above

Extract pure/near-pure logic into global-scope files loaded before `popup.js`. The IIFE in `popup.js` calls these globals. All mutable state stays in the IIFE closure.

---

## 2. Frozen Requirements

### 2.1 New Files

| File | Purpose | Lines extracted |
|------|---------|----------------|
| `popup-search.js` | Fuzzy matching and service filtering | ~45 |
| `popup-crypto.js` | Base64, PIN crypto, storage encryption | ~100 |
| `popup-dialog.js` | Dialog management, status display, time formatting | ~70 |
| `popup-rules.js` | Site rules fetching, signature verification, lookup | ~80 |
| `popup-breach.js` | Breach feed fetching and service matching | ~40 |

All files go in `extension/shared/`. No build process changes needed.

### 2.2 Script Load Order (popup.html)

```html
<script src="lib/hash-wasm-argon2.js"></script>
<script src="lib/tweetnacl.js"></script>
<script src="keygrain.js"></script>
<script src="totp.js"></script>
<script src="ssh.js"></script>
<script src="sync.js"></script>
<script src="popup-crypto.js"></script>
<script src="popup-dialog.js"></script>
<script src="popup-search.js"></script>
<script src="popup-rules.js"></script>
<script src="popup-breach.js"></script>
<script src="popup.js"></script>
```

Dependencies flow downward only. No circular references.

### 2.3 What Stays in popup.js

- All DOM refs (~100 lines)
- All mutable state variables (~30 variables)
- Screen switching (`showLockScreen`, `showPinScreen`, `showMainScreen`)
- `renderServiceList` + `applyFocus` (DOM rendering, deeply coupled to state)
- `renderBreachWarnings` (DOM construction, coupled to state + callbacks)
- All event handlers and initialization
- `performAutoSync`, `updateSyncIndicator` (state-mutating orchestration)
- `loadServices`, `saveServices` (state-mutating wrappers that call extracted crypto)

---

## 3. Module Specifications

### 3.1 popup-search.js

```js
/**
 * Score a query against text using fuzzy matching.
 * @param {string} query - Search query
 * @param {string} text - Text to match against
 * @returns {number} Score (0 = no match, higher = better match)
 */
function fuzzyScore(query, text) { ... }

/**
 * Filter and sort services by search query.
 * @param {Array<{name:string, email:string, site?:string, frecency?:number}>} services
 * @param {string} filter - Search query (empty string = sort by frecency only)
 * @returns {Array} Filtered and sorted services
 */
function getFilteredServices(services, filter) { ... }
```

**Test case:**
```
fuzzyScore("git", "GitHub") → > 0
fuzzyScore("xyz", "GitHub") → 0
getFilteredServices([{name:"GitHub",email:"a@b.c",frecency:5},{name:"Google",email:"a@b.c",frecency:10}], "")
  → [{name:"Google",...}, {name:"GitHub",...}]  (sorted by frecency desc)
getFilteredServices([{name:"GitHub",email:"a@b.c"},{name:"Google",email:"a@b.c"}], "git")
  → [{name:"GitHub",...}]
```

---

### 3.2 popup-crypto.js

Depends on: `keygrain.js` (for `strengthenSecret`, `hmacSHA256`)

```js
/**
 * Convert ArrayBuffer to base64 string.
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {string}
 */
function arrayBufferToBase64(buf) { ... }

/**
 * Convert base64 string to Uint8Array.
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ToArrayBuffer(b64) { ... }

/**
 * Derive AES-GCM key from PIN + salt using PBKDF2.
 * @param {string} pin
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
async function pinDeriveKey(pin, salt) { ... }

/**
 * Encrypt a secret string with a PIN.
 * @param {string} pin
 * @param {string} secret
 * @returns {Promise<{encrypted:string, salt:string, iv:string}>}
 */
async function pinEncryptSecret(pin, secret) { ... }

/**
 * Decrypt a secret string with a PIN.
 * @param {string} pin
 * @param {{encrypted:string, salt:string, iv:string}} stored
 * @returns {Promise<string>}
 */
async function pinDecryptSecret(pin, stored) { ... }

/**
 * Derive the local storage encryption key from secret + email.
 * @param {string} secret
 * @param {string} email
 * @returns {Promise<Uint8Array>} 32-byte key
 */
async function deriveStorageKey(secret, email) { ... }

/**
 * Encrypt services + wallets for local storage.
 * @param {Uint8Array} storageKey - 32-byte key from deriveStorageKey
 * @param {string} email
 * @param {Array} services
 * @param {Array} wallets
 * @param {Array} walletAuditLog
 * @returns {Promise<{version:2, iv:string, ciphertext:string}>}
 */
async function encryptServices(storageKey, email, services, wallets, walletAuditLog) { ... }

/**
 * Decrypt services + wallets from local storage.
 * @param {Uint8Array} storageKey
 * @param {string} email
 * @param {{version:2, iv:string, ciphertext:string}} stored
 * @returns {Promise<{services:Array, wallets:Array, walletAuditLog:Array}>}
 */
async function decryptServices(storageKey, email, stored) { ... }
```

**Test case:**
```
arrayBufferToBase64(new Uint8Array([72,101,108,108,111])) → "SGVsbG8="
base64ToArrayBuffer("SGVsbG8=") → Uint8Array([72,101,108,108,111])

// Round-trip:
const enc = await pinEncryptSecret("1234", "my-secret");
const dec = await pinDecryptSecret("1234", enc);
dec === "my-secret" → true

// Wrong PIN throws:
await pinDecryptSecret("9999", enc) → throws DOMException
```

**Note on `decryptServices` change:** Currently returns just the services array and sets `wallets`/`walletAuditLog` via closure. The extracted version returns `{services, wallets, walletAuditLog}` — the caller in popup.js destructures and assigns to state.

---

### 3.3 popup-dialog.js

No external dependencies (pure DOM utilities).

```js
/**
 * Open a dialog with focus trap.
 * @param {HTMLElement} dialog
 * @param {HTMLElement|null} trigger - Element to restore focus to on close
 * @returns {{trapHandler: Function, trigger: HTMLElement|null}} State for closeDialog
 */
function openDialog(dialog, trigger) { ... }

/**
 * Close a dialog and restore focus.
 * @param {HTMLElement} dialog
 * @param {{trapHandler: Function, trigger: HTMLElement|null}} state - From openDialog
 */
function closeDialog(dialog, state) { ... }

/**
 * Show a temporary status message.
 * @param {HTMLElement} statusEl - The status display element
 * @param {string} msg
 * @param {{id: number|null}} timerState - Mutable timer container
 * @param {number} [duration=3000] - Duration in ms
 */
function showStatus(statusEl, msg, timerState, duration) { ... }

/**
 * HTML-escape a string.
 * @param {string} s
 * @returns {string}
 */
function esc(s) { ... }

/**
 * Get next monotonic timestamp for a services array.
 * @param {Array<{updated_at:number}>} services
 * @returns {number}
 */
function nextTimestamp(services) { ... }

/**
 * Format a timestamp as relative time string.
 * @param {number|null} ts - Unix timestamp in ms
 * @returns {string} e.g. "just now", "5m ago", "2h ago"
 */
function formatRelativeTime(ts) { ... }

/**
 * Compute sync indicator display state (pure decision logic).
 * @param {boolean} syncInProgress
 * @param {object|null} lastSyncError - {type:string, message:string}
 * @param {number|null} lastSyncTime
 * @param {object|null} retryState - {attempt:number, nextRetryAt:number}
 * @returns {{visible:boolean, text:string, errorHtml:string|null}}
 */
function computeSyncStatus(syncInProgress, lastSyncError, lastSyncTime, retryState) { ... }
```

**Test case:**
```
esc('<script>alert("xss")</script>') → "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
nextTimestamp([{updated_at: 100}, {updated_at: 200}]) → max(Date.now(), 201)
formatRelativeTime(Date.now() - 30000) → "just now"
formatRelativeTime(Date.now() - 120000) → "2m ago"
computeSyncStatus(true, null, null, null) → {visible:true, text:"Syncing...", errorHtml:null}
computeSyncStatus(false, null, Date.now()-60000, null) → {visible:true, text:"Last synced: 1m ago", errorHtml:null}
```

**Note on `openDialog`/`closeDialog` change:** Currently uses closure variables `lastFocusTrigger` and `trapHandler`. The extracted version returns state from `openDialog` that must be passed to `closeDialog`. The caller in popup.js stores this state (e.g., `let dialogState = null`).

---

### 3.4 popup-rules.js

Depends on: `popup-crypto.js` (for `base64ToArrayBuffer` — actually not needed, uses `atob` directly). No external deps.

```js
/**
 * Produce canonical JSON for signature verification.
 * @param {*} obj
 * @returns {string}
 */
function canonicalJSON(obj) { ... }

/**
 * Verify Ed25519 signature on site rules.
 * @param {{rules:Array, version:number, signature:string}} json
 * @param {string} publicKeyBase64
 * @returns {Promise<boolean>}
 */
async function verifyRulesSignature(json, publicKeyBase64) { ... }

/**
 * Fetch site rules from server, using cache.
 * @param {string} serverUrl
 * @param {{version:number, rules:Array, fetchedAt:number}|null} cached
 * @param {string} publicKeyBase64
 * @returns {Promise<{rules:Array|null, cacheEntry:object|null}>}
 *   Returns new rules and cache entry to store. Caller handles chrome.storage.
 */
async function fetchSiteRules(serverUrl, cached, publicKeyBase64) { ... }

/**
 * Look up a rule for a hostname.
 * @param {string} hostname
 * @param {Array|null} rules
 * @returns {object|null} Matching rule or null
 */
function lookupRule(hostname, rules) { ... }
```

**Test case:**
```
canonicalJSON({b:2, a:1}) → '{"a":1,"b":2}'
canonicalJSON([3,1,2]) → '[3,1,2]'
lookupRule("calendar.google.com", [{domain:"google.com",exact:false,maxLength:16}])
  → {domain:"google.com", exact:false, maxLength:16}
lookupRule("evil.com", [{domain:"google.com",exact:false}]) → null
lookupRule("www.github.com", [{domain:"github.com",exact:true}])
  → {domain:"github.com", exact:true}  // www. stripped by caller or inside function
```

**Note on `fetchSiteRules` change:** Currently writes directly to `chrome.storage.local` and mutates the `siteRules` closure variable. The extracted version returns the result — the caller in popup.js handles storage and state assignment.

---

### 3.5 popup-breach.js

Depends on: nothing (pure data logic).

```js
/**
 * Fetch breach feed from server, using cache.
 * @param {string} serverUrl
 * @param {{version:number, breaches:Array, fetchedAt:number}|null} cached
 * @returns {Promise<{breaches:Array, cacheEntry:object|null}>}
 *   Returns breaches array and cache entry to store. Caller handles chrome.storage.
 */
async function fetchBreachFeed(serverUrl, cached) { ... }

/**
 * Filter breaches that match user's services.
 * @param {Array<{id:string, domain:string, severity:string, date:string, description:string, action?:string}>} breaches
 * @param {Array<{name:string, site?:string}>} services
 * @param {Array<string>} dismissedIds
 * @returns {Array} Matched breaches (not dismissed, matching a service)
 */
function checkBreaches(breaches, services, dismissedIds) { ... }
```

**Test case:**
```
checkBreaches(
  [{id:"b1", domain:"github.com", severity:"high", date:"2024-01-01", description:"leak"}],
  [{name:"GitHub", site:"github.com"}],
  []
) → [{id:"b1", domain:"github.com", ...}]

checkBreaches(
  [{id:"b1", domain:"github.com", severity:"high", date:"2024-01-01", description:"leak"}],
  [{name:"GitHub", site:"github.com"}],
  ["b1"]
) → []  // dismissed

checkBreaches(
  [{id:"b1", domain:"github.com", severity:"high", date:"2024-01-01", description:"leak"}],
  [{name:"Netflix", site:"netflix.com"}],
  []
) → []  // no matching service
```

---

## 4. Invariants

1. **Behavioral equivalence:** The popup must behave identically before and after modularization. No user-visible change.
2. **All existing tests pass.** No test modifications except import path changes if tests reference popup.js directly.
3. **No new global state.** Extracted functions must not introduce module-level mutable variables. (Exception: `openDialog`/`closeDialog` may use a module-level variable for the current trap handler if the returned-state pattern proves too invasive — but the design prefers returned state.)
4. **Load order is a DAG.** Each file depends only on files loaded before it. No forward references.
5. **popup.js remains the single entry point.** It is the only file wrapped in an IIFE. All other files define globals.

---

## 5. Scope Boundary

### In scope
- Extracting the 5 files specified above
- Updating `popup.html` script tags
- Updating `popup.js` to call globals instead of closure functions
- Adjusting function signatures (adding parameters that were previously closure-captured)

### Out of scope
- Extracting `renderServiceList` or `renderBreachWarnings` (too coupled to DOM + state)
- Extracting event handlers (inherently coupled to DOM)
- Introducing a module bundler, ES modules, or import maps
- Changing the build process
- Refactoring the internal logic of any function (only moving + adjusting signatures)
- Splitting popup.js further (this is a first pass; future work can split event handlers if needed)

---

## 6. Migration Strategy

### Step-by-step per file:

1. **Create the new file** with the functions copied verbatim (adjusted signatures).
2. **Add the `<script>` tag** to `popup.html` before `popup.js`.
3. **Remove the functions from popup.js** and replace with calls to the new globals.
4. **Adjust call sites** in popup.js to pass previously-closure-captured values as arguments.
5. **Run tests.** If any fail, the function signature or call site is wrong.
6. **Manual smoke test** the popup in browser.

### Handling the closure → global transition:

**Before (closure):**
```js
(async function() {
  let statusTimer = null;
  function showStatus(msg) {
    statusEl.textContent = msg;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ""; }, 3000);
  }
  // ...
  showStatus("Copied!");
})();
```

**After (global + state container):**
```js
// popup-dialog.js (global)
function showStatus(statusEl, msg, timerState, duration = 3000) {
  statusEl.textContent = msg;
  if (timerState.id) clearTimeout(timerState.id);
  timerState.id = setTimeout(() => { statusEl.textContent = ""; }, duration);
}
```
```js
// popup.js (IIFE)
(async function() {
  const statusTimerState = {id: null};
  // ...
  showStatus(statusEl, "Copied!", statusTimerState);
})();
```

### Handling `decryptServices` return value change:

**Before:**
```js
async function decryptServices(storageKey, email, stored) {
  // ... decrypt ...
  wallets = data.wallets || [];          // closure write
  walletAuditLog = data.wallet_audit_log || [];  // closure write
  return data.services || data;
}
```

**After:**
```js
// popup-crypto.js (global)
async function decryptServices(storageKey, email, stored) {
  // ... decrypt ...
  return {
    services: data.services || data,
    wallets: data.wallets || [],
    walletAuditLog: data.wallet_audit_log || []
  };
}
```
```js
// popup.js (IIFE) — in loadServices:
const result = await decryptServices(key, currentEmail, stored);
services = result.services;
wallets = result.wallets;
walletAuditLog = result.walletAuditLog;
```

### Handling `openDialog`/`closeDialog` state:

**Before:**
```js
let lastFocusTrigger = null;
let trapHandler = null;

function openDialog(dialog, trigger) {
  lastFocusTrigger = trigger || document.activeElement;
  // ... set up trap ...
  trapHandler = (e) => { ... };
}

function closeDialog(dialog) {
  // ... uses lastFocusTrigger, trapHandler ...
}
```

**After:**
```js
// popup-dialog.js (global)
function openDialog(dialog, trigger) {
  const focusTrigger = trigger || document.activeElement;
  const handler = (e) => { ... };
  dialog.classList.remove("hidden");
  dialog.addEventListener("keydown", handler);
  return {trapHandler: handler, trigger: focusTrigger};
}

function closeDialog(dialog, state) {
  dialog.classList.add("hidden");
  if (state.trapHandler) dialog.removeEventListener("keydown", state.trapHandler);
  if (state.trigger) state.trigger.focus();
}
```
```js
// popup.js (IIFE)
let dialogState = null;
// ...
dialogState = openDialog(addDialog, addBtn);
// ...
closeDialog(addDialog, dialogState);
```

---

## 7. Test Plan

### Unit tests (new, per extracted file):

| File | Test approach | Framework |
|------|--------------|-----------|
| `popup-search.js` | Pure function tests, no DOM needed | Any (Jest, Vitest, or plain Node assert) |
| `popup-crypto.js` | Crypto round-trip tests, needs Web Crypto API | Node 20+ (has Web Crypto) or browser test runner |
| `popup-dialog.js` | `esc`, `nextTimestamp`, `formatRelativeTime`, `computeSyncStatus` — pure, no DOM. `openDialog`/`closeDialog` — need minimal DOM (jsdom or browser) | Split: pure tests in Node, DOM tests in browser |
| `popup-rules.js` | `canonicalJSON`, `lookupRule` — pure. `verifyRulesSignature` — needs Web Crypto. `fetchSiteRules` — needs fetch mock | Node 20+ with fetch mock |
| `popup-breach.js` | `checkBreaches` — pure. `fetchBreachFeed` — needs fetch mock | Node 20+ with fetch mock |

### Integration test:
- Load all scripts in order in a browser environment (or jsdom)
- Verify that `popup.js` IIFE executes without errors
- Verify that extracted globals are callable

### Regression test:
- Existing test suite must pass unchanged
- Manual smoke test: unlock → add service → copy → fill → edit → delete → lock

### Test file naming:
```
tests/popup-search.test.js
tests/popup-crypto.test.js
tests/popup-dialog.test.js
tests/popup-rules.test.js
tests/popup-breach.test.js
```

---

## 8. Implementation Order (by risk, lowest first)

1. **popup-search.js** — Trivial. 2 pure functions, zero dependencies.
2. **popup-crypto.js** — Pure crypto, depends only on keygrain.js globals. Signature change for `decryptServices` is the only risk.
3. **popup-dialog.js** — Generic DOM utils. State container pattern for `showStatus` and returned-state for dialogs are the main changes.
4. **popup-rules.js** — Near-pure with param injection. `fetchSiteRules` return value change requires caller adjustment.
5. **popup-breach.js** — Pure filter logic. Smallest extraction, lowest risk, but depends on understanding the breach data format.

Each unit should be implemented, tested, and merged independently. A broken extraction can be reverted by moving the function back into popup.js and removing the script tag.

---

## 9. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Global name collision | Low | All new globals use `popup*` prefix or are unique names (`fuzzyScore`, `esc`) |
| Load order bug | Low | DAG is simple; test by loading in browser |
| `this` binding issues | None | No functions use `this` |
| Performance regression | None | No new allocations or async overhead |
| Closure variable missed | Medium | Careful audit of each function's free variables before extraction |
| Dialog state management | Medium | Reset dialog opens atop settings panel (nested). A single `dialogState` variable replicates existing behavior (settings trap lost while reset is open). This is a pre-existing bug, not introduced by modularization. Future work could use a dialog stack. |

---

## 10. Future Work (out of scope)

- Split event handlers into `popup-events.js` (would require careful state passing)
- Extract `renderServiceList` if a clean interface emerges
- Consider ES modules when browser extension support matures and bundler-free `<script type="module">` becomes viable
- Extract `performAutoSync` orchestration if sync logic grows further
