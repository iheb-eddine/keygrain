# Keygrain Browser Extension Rewrite — Design Document

## 1. Overview & Architecture

### Goal

Replace the current single-screen "generate on demand" popup with a full password manager matching the mobile app: unlock/lock, persistent service list, add/delete, search, backup/restore/export/import, and fill.

### File Structure

```
extension/shared/
├── popup.html       # Single HTML file, two-state UI
├── popup.js         # UI logic, state management, event handlers
├── popup.css        # All styles
├── import.html      # Standalone import page (opened in new tab, avoids popup focus-loss)
├── import.js        # Import page logic
├── sync.js          # Backup/restore/export/import (derives keys, AES-GCM, fetch)
├── keygrain.js      # UNCHANGED — password derivation + fingerprint
├── content.js       # UNCHANGED — password field detection + fill
├── background.js    # Secret storage broker (session storage / in-memory)
└── icons/           # UNCHANGED
```

### Module Responsibilities

| File | Responsibility |
|------|---------------|
| `keygrain.js` | `derivePassword`, `secretFingerprint`, `hmacSHA256`, charsets |
| `sync.js` | `deriveLookupId`, `deriveAuthPassword`, `deriveEncryptionKey`, `encryptBlob`, `decryptBlob`, `backupToServer`, `restoreFromServer` |
| `background.js` | Secret storage broker — holds secret in `chrome.storage.session` (Chrome) or module variable (Firefox). Responds to get/set/clear messages. |
| `popup.js` | UI state machine, renders lock/unlock screens, handles all user interactions |
| `content.js` | Injected into active tab, finds password fields, fills them |

### Data Flow

```
[popup.js] ──getSecret──▶ [background.js] ──reads──▶ [chrome.storage.session]
[popup.js] ──setSecret──▶ [background.js] ──writes─▶ [chrome.storage.session]
[popup.js] ──derivePassword──▶ [keygrain.js] (direct call, same context)
[popup.js] ──backup/restore──▶ [sync.js] ──fetch──▶ [server]
[popup.js] ──fill──▶ [content.js] (via chrome.tabs.sendMessage)
```

### Script Load Order (popup.html)

```html
<script src="keygrain.js"></script>
<script src="sync.js"></script>
<script src="popup.js"></script>
```

---

## 2. State Management

### Application States

```
┌──────────┐   unlock    ┌────────────┐
│  LOCKED  │ ──────────▶ │  UNLOCKED  │
│          │ ◀────────── │            │
└──────────┘    lock      └────────────┘
```

### Secret Lifecycle

| Event | Action |
|-------|--------|
| User enters secret + clicks Unlock | Popup sends `{action:"setSecret", secret}` to background; background stores it; popup transitions to UNLOCKED |
| Popup opens | Popup sends `{action:"getSecret"}` to background; if secret exists → UNLOCKED; if null → LOCKED |
| User clicks Lock | Popup sends `{action:"clearSecret"}` to background; background deletes secret; popup transitions to LOCKED |
| Browser closes | `chrome.storage.session` auto-clears (Chrome); background page unloads (Firefox) → secret gone |

### Where the Secret Lives

| Browser | Storage Mechanism | Survives popup close? | Survives browser close? |
|---------|-------------------|----------------------|------------------------|
| Chrome (MV3) | `chrome.storage.session` | Yes (service worker may restart, storage persists) | No |
| Firefox (MV2) | Module-level variable in background.js | Yes (background page stays loaded) | No |

**Security invariant:** The secret is NEVER written to `chrome.storage.local` or any persistent storage. Content scripts cannot access `chrome.storage.session` (we do NOT call `setAccessLevel`).

**Service worker resilience (Chrome MV3):** The service worker may not be running when the popup opens. `chrome.runtime.sendMessage` will wake it. If `sendMessage` throws (no listener registered yet), retry once after 100ms. This handles the race between popup open and service worker initialization.

### Services Storage

Services are stored in `chrome.storage.local` (persistent across browser restarts). They contain only derivation parameters — never passwords or secrets.

---

## 3. UI Layout

### Dimensions

- Max width: 400px (Chrome popup limit)
- Max height: 600px (Chrome popup limit)
- Usable content area: ~380×560px (after padding)

### Lock Screen

```html
<div id="lock-screen">
  <h1>🔑 Keygrain</h1>
  <label for="secret">Master Secret</label>
  <input type="password" id="secret" autocomplete="off" required>
  <div id="fingerprint"></div>
  <button id="unlock-btn">Unlock</button>
</div>
```

Behavior:
- Secret input with debounced fingerprint (4 colored dots, 500ms delay)
- Unlock button enabled only when input is non-empty
- On unlock: store secret via background, transition to service list

### Unlocked Screen

```html
<div id="main-screen">
  <!-- Header -->
  <div class="header">
    <h1>🔑 Keygrain</h1>
    <div class="header-actions">
      <button id="menu-btn" title="Menu">☰</button>
      <button id="lock-btn" title="Lock">🔒</button>
    </div>
  </div>

  <!-- Menu dropdown (hidden by default) -->
  <div id="menu-dropdown" class="hidden">
    <button id="backup-btn">Backup to server</button>
    <button id="restore-btn">Restore from server</button>
    <hr>
    <button id="export-btn">Export to file</button>
    <button id="import-btn">Import from file</button>
  </div>

  <!-- Search -->
  <input type="text" id="search" placeholder="Search services..." autocomplete="off">

  <!-- Service list -->
  <div id="service-list">
    <!-- Rendered dynamically -->
  </div>

  <!-- Add button (fixed bottom) -->
  <button id="add-btn" title="Add service">＋</button>
</div>
```

### Service List Item

Each service renders as a compact row. Search is case-insensitive substring match against both service name and email (matching mobile behavior).

```html
<div class="service-item">
  <div class="service-info">
    <span class="service-name">GitHub</span>
    <span class="service-email">user@example.com</span>
  </div>
  <div class="service-password">
    <span class="password-display">••••••••••••</span>
    <button class="toggle-btn" title="Show/Hide">👁</button>
    <button class="copy-btn" title="Copy">📋</button>
    <button class="fill-btn" title="Fill">▶</button>
    <button class="delete-btn" title="Delete">🗑</button>
  </div>
</div>
```

Behavior:
- Password hidden by default (dots). Click toggle to reveal (derives on demand).
- Copy: copies derived password to clipboard, auto-clears after 30s.
- Fill: injects content script into active tab, sends password.
- Delete: confirmation prompt, then removes from storage.

### Add Service Dialog

Overlays the popup as a modal:

```html
<div id="add-dialog" class="dialog hidden">
  <h2>Add Service</h2>
  <label>Service name</label>
  <input type="text" id="add-name" required>
  <label>Email</label>
  <input type="email" id="add-email" required>
  <details id="add-options">
    <summary>⚙️ Options</summary>
    <label>Length</label>
    <input type="number" id="add-length" min="8" value="20">
    <label>Symbols</label>
    <input type="text" id="add-symbols" value="!@#$%&*-_=+?">
    <label>Salt</label>
    <input type="text" id="add-salt">
  </details>
  <div class="dialog-actions">
    <button id="add-cancel">Cancel</button>
    <button id="add-confirm">Add</button>
  </div>
</div>
```

### Backup/Restore Email Prompt

Reused for backup, restore, export, and import:

```html
<div id="email-dialog" class="dialog hidden">
  <h2 id="email-dialog-title">Backup</h2>
  <label>Email for backup identity</label>
  <input type="email" id="sync-email">
  <div class="dialog-actions">
    <button id="email-cancel">Cancel</button>
    <button id="email-confirm">Continue</button>
  </div>
</div>
```

### Delete Confirmation Dialog

```html
<div id="delete-dialog" class="dialog hidden">
  <h2>Delete <span id="delete-service-name"></span>?</h2>
  <p>This cannot be undone.</p>
  <div class="dialog-actions">
    <button id="delete-cancel">Cancel</button>
    <button id="delete-confirm">Delete</button>
  </div>
</div>
```

### Status Bar

```html
<div id="status" aria-live="polite"></div>
```

Displays transient messages (copied, backup complete, errors). Auto-clears after 3s.

---

## 4. Service Storage Format

### chrome.storage.local Schema

```json
{
  "services": {
    "version": 1,
    "services": [
      {
        "name": "GitHub",
        "email": "user@example.com",
        "length": 20,
        "symbols": "!@#$%&*-_=+?",
        "salt": ""
      }
    ]
  },
  "etags": {
    "<lookup_id>": "<etag_value>"
  }
}
```

**Key:** `"services"` — the full service list object.
**Key:** `"etags"` — ETag cache for conflict detection (keyed by lookup_id).

### Format Compatibility

The `services` object matches the mobile app's `exportJson()` format exactly:
```json
{"version": 1, "services": [...]}
```

This ensures:
- A backup made on mobile can be restored on the extension
- A backup made on the extension can be restored on mobile
- Export files are interchangeable

### Breaking Change

The current extension stores per-domain settings as `domains.{hostname}`. The rewrite drops this entirely. The new service list replaces per-domain memory. Users must re-add their services (or restore from a mobile backup).

---

## 5. Backup/Restore/Export/Import Flow

### New File: sync.js

Exposes the following global functions (all async):

```javascript
// Derivation (uses hmacSHA256 and derivePassword from keygrain.js)
async function deriveLookupId(secret, email)
async function deriveAuthPassword(secret, email)
async function deriveEncryptionKey(secret, email)

// Crypto (AES-256-GCM, format: IV(12) || ciphertext+tag)
async function encryptBlob(keyBytes, plaintext)
async function decryptBlob(keyBytes, blob)

// Server operations
async function backupToServer(secret, email, servicesJson, storedEtag)
async function restoreFromServer(secret, email)

// File operations
function exportToFile(encryptedBlob, filename)
async function importFromFile(file, secret, email)
```

### Derivation Functions

```
deriveLookupId(secret, email):
  message = lowercase(email) + ":keygrain-id"
  return hex(hmacSHA256(encode(secret), encode(message)))

deriveAuthPassword(secret, email):
  return derivePassword(secret, email, 32, "!@#$%&*-_=+?", "keygrain-auth")

deriveEncryptionKey(secret, email):
  message = lowercase(email) + ":keygrain-encryption"
  return hmacSHA256(encode(secret), encode(message))  // raw 32 bytes
```

### AES-256-GCM Encrypt/Decrypt

Format: `IV(12 bytes) || ciphertext+tag` — identical to mobile SyncCrypto.kt.

```
encryptBlob(keyBytes, plaintext):
  iv = crypto.getRandomValues(new Uint8Array(12))
  cryptoKey = crypto.subtle.importKey("raw", keyBytes, {name:"AES-GCM"}, false, ["encrypt"])
  ciphertext = crypto.subtle.encrypt({name:"AES-GCM", iv}, cryptoKey, plaintext)
  return concat(iv, ciphertext)  // ciphertext includes 16-byte tag

decryptBlob(keyBytes, blob):
  iv = blob.slice(0, 12)
  ciphertext = blob.slice(12)
  cryptoKey = crypto.subtle.importKey("raw", keyBytes, {name:"AES-GCM"}, false, ["decrypt"])
  return crypto.subtle.decrypt({name:"AES-GCM", iv}, cryptoKey, ciphertext)
```

### Backup Flow

1. User clicks "Backup to server" → email prompt dialog
2. User enters email → confirmation dialog ("Back up N services?")
3. On confirm:
   - Derive lookup_id, auth_password, encryption_key from (secret, email)
   - Load services from chrome.storage.local
   - Serialize to JSON: `{"version":1,"services":[...]}`
   - Encrypt JSON with encryption_key → blob
   - `PUT /api/backup/{lookup_id}` with Basic auth, body = blob
   - If stored ETag exists, send `If-Match` header
   - On 200/201: store returned ETag, show success
   - On 412 (conflict): show conflict dialog (same as mobile — suggest restore first)
   - On 401: show "Authentication failed" error
   - On network error: show "Network error" message
   - Zero encryption_key bytes after use

### Restore Flow

1. User clicks "Restore from server" → email prompt dialog
2. User enters email → confirmation dialog ("Replace N local services?")
3. On confirm:
   - Derive lookup_id, auth_password, encryption_key
   - `GET /api/backup/{lookup_id}` with Basic auth
   - On 200: decrypt blob → parse JSON → replace local services
   - Store returned ETag
   - On 404: "No backup found"
   - On 401: "Authentication failed"
   - On decryption failure: "Wrong secret or corrupted backup"
   - Zero encryption_key bytes after use

### Export Flow

1. User clicks "Export to file" → email prompt dialog
2. User enters email:
   - Derive encryption_key from (secret, email)
   - Load and serialize services JSON
   - Encrypt → blob
   - Create Blob URL, programmatically click `<a download="keygrain-backup.keygrain">` — this triggers a download without closing the popup (download happens in background)
   - Revoke Blob URL after short delay
   - Zero encryption_key

### Import Flow

**Note:** Clicking `<input type="file">` inside a popup opens the OS file picker, which steals focus and causes Chrome (and Firefox) to close the popup. All JS state is destroyed. Therefore, import uses a dedicated full-page tab.

1. User clicks "Import from file" → email prompt dialog (still in popup)
2. User enters email → popup stores email temporarily in `chrome.storage.session` (Chrome) or sends to background (Firefox), then opens `import.html` in a new tab via `chrome.tabs.create({url: "import.html"})`
3. `import.html` is a standalone extension page (not a popup — won't close on focus loss):
   - Retrieves secret from background (same `getSecret` message)
   - Retrieves import email from session storage / background
   - Shows file picker (`<input type="file">`)
   - On file selected: read as ArrayBuffer
   - Derive encryption_key from (secret, email)
   - Decrypt blob → parse JSON
   - Show confirmation: "Replace N local services with M from file?"
   - On confirm: replace services in chrome.storage.local
   - On decryption failure: "Wrong email or corrupted file"
   - Zero encryption_key
   - Show success message, auto-close tab after 2s (or user closes manually)

**File structure addition:**
```
extension/shared/
├── import.html      # Standalone import page (opened in new tab)
├── import.js        # Import page logic
```

`import.html` loads: keygrain.js → sync.js → import.js

### Server URL

Hardcoded: `https://keygrain.secbytech.com`

---

## 6. Fill Flow

### Sequence

1. User clicks Fill button (▶) on a service row
2. popup.js derives the password: `derivePassword(secret, service.email, service.length, service.symbols, service.salt)`
3. popup.js injects content.js into the active tab (if not already injected)
4. popup.js sends message: `{action: "fill", password: "..."}`
5. content.js finds the password field (focused → visible `type=password` → name/id heuristic)
6. content.js fills the field using native setter + input/change events
7. content.js responds `{success: true/false}`
8. popup.js shows status message

### Content Script Injection (cross-browser)

```javascript
async function injectContentScript(tabId) {
  if (typeof browser !== "undefined" && browser.tabs?.executeScript) {
    // Firefox MV2
    await browser.tabs.executeScript(tabId, {file: "content.js"});
  } else {
    // Chrome MV3
    await chrome.scripting.executeScript({target: {tabId}, files: ["content.js"]});
  }
}
```

This is the existing pattern from the current popup.js — reused unchanged.

### Password Derivation Timing

Passwords are derived on demand (when user clicks show, copy, or fill). They are NOT pre-computed or cached. This keeps the secret usage minimal and avoids holding derived passwords in memory longer than necessary.

---

## 7. Cross-Browser Compatibility

### Manifest Differences

| Feature | Chrome (MV3) | Firefox (MV2) |
|---------|-------------|---------------|
| Manifest version | 3 | 2 |
| Action key | `"action"` | `"browser_action"` |
| Background | `"service_worker": "background.js"` | `"scripts": ["background.js"]` |
| Scripting API | `chrome.scripting.executeScript` | `browser.tabs.executeScript` |
| Session storage | `chrome.storage.session` | Not available |
| Permissions | `activeTab`, `scripting`, `storage` | `activeTab`, `storage` |

### Secret Storage Abstraction (background.js)

background.js exposes a unified message API regardless of browser:

```
Messages:
  {action: "getSecret"}  → responds with {secret: "..." | null}
  {action: "setSecret", secret: "..."}  → responds with {ok: true}
  {action: "clearSecret"}  → responds with {ok: true}
```

**Chrome implementation:**
```javascript
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "getSecret") {
    chrome.storage.session.get("secret", (data) => {
      sendResponse({secret: data.secret || null});
    });
    return true; // async
  }
  if (msg.action === "setSecret") {
    chrome.storage.session.set({secret: msg.secret}, () => {
      sendResponse({ok: true});
    });
    return true;
  }
  if (msg.action === "clearSecret") {
    chrome.storage.session.remove("secret", () => {
      sendResponse({ok: true});
    });
    return true;
  }
});
```

**Firefox implementation:**
```javascript
let sessionSecret = null;

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === "getSecret") {
    return Promise.resolve({secret: sessionSecret});
  }
  if (msg.action === "setSecret") {
    sessionSecret = msg.secret;
    return Promise.resolve({ok: true});
  }
  if (msg.action === "clearSecret") {
    sessionSecret = null;
    return Promise.resolve({ok: true});
  }
});
```

### Build Script

The existing `build.sh` copies shared files + browser-specific manifest into `dist/chrome/` and `dist/firefox/`. It must be updated to also copy `sync.js` and the browser-specific `background.js`.

New structure:
```
extension/
├── shared/          # popup.html, popup.js, popup.css, keygrain.js, content.js, sync.js
├── chrome/          # manifest.json, background.js (chrome-specific)
├── firefox/         # manifest.json, background.js (firefox-specific)
```

### Permissions Update

**Chrome manifest.json** — add `"storage"` (already present) — no new permissions needed. `chrome.storage.session` is available with the `"storage"` permission.

**Firefox manifest.json** — no changes needed. `storage` permission already present.

### API Compatibility Notes

| API | Chrome | Firefox | Resolution |
|-----|--------|---------|-----------|
| `chrome.storage.session` | ✓ (MV3) | ✗ | Firefox uses in-memory variable in background.js |
| `chrome.scripting.executeScript` | ✓ (MV3) | ✗ | Firefox uses `browser.tabs.executeScript` |
| `chrome.tabs.sendMessage` | ✓ | ✓ | Same API |
| `chrome.storage.local` | ✓ | ✓ | Same API |
| `chrome.tabs.query` | ✓ | ✓ | Same API |
| `navigator.clipboard.writeText` | ✓ | ✓ | Same API |
| `crypto.subtle` | ✓ | ✓ | Same API |
| `fetch` | ✓ | ✓ | Same API |

---

## 8. Test Plan

### Unit Tests (keygrain.js — already tested, unchanged)

No new tests needed for keygrain.js.

### Unit Tests (sync.js)

| Test | Input | Expected |
|------|-------|----------|
| `deriveLookupId` produces 64-char hex | known secret + email | matches mobile output |
| `deriveAuthPassword` produces 32-char password | known secret + email | matches mobile output |
| `deriveEncryptionKey` produces 32 bytes | known secret + email | matches mobile output |
| `encryptBlob` output format | any key + plaintext | result starts with 12-byte IV, length = 12 + plaintext.length + 16 |
| `decryptBlob` round-trip | encrypt then decrypt | plaintext matches |
| `decryptBlob` with mobile-encrypted blob | blob from mobile app | decrypts correctly (cross-platform interop) |
| `decryptBlob` with wrong key | tampered key | throws DOMException (AES-GCM auth failure) |

### Integration Tests (storage)

| Test | Steps | Expected |
|------|-------|----------|
| Save and load services | Add 3 services, close/reopen popup | Services persist |
| Delete service | Delete middle service | List updates, storage reflects |
| Search filter | Type partial name | Only matching services shown |
| Empty state | No services | "No services" message shown |

### Integration Tests (backup/restore)

| Test | Steps | Expected |
|------|-------|----------|
| Backup round-trip | Backup → clear local → restore | Same services restored |
| Cross-platform restore | Backup from mobile → restore on extension | Services match |
| Wrong secret on restore | Use different secret | Decryption error shown |
| No backup exists | Restore with unused email | "No backup found" shown |
| Conflict detection | Backup from two devices without restore | 412 → conflict dialog |

### Integration Tests (fill)

| Test | Steps | Expected |
|------|-------|----------|
| Fill visible password field | Open login page, click fill | Password filled |
| Fill focused field | Focus a password input, click fill | That field filled |
| No password field | Open page without password input | "No password field" message |

### Manual Test Matrix

| Browser | Version | Test |
|---------|---------|------|
| Chrome | Latest stable | Full flow: unlock → add → backup → restore → fill → lock |
| Firefox | Latest stable | Same full flow |
| Chrome | Previous stable | Smoke test |
| Firefox | ESR | Smoke test |

### Security Tests

| Test | Expected |
|------|----------|
| Inspect chrome.storage.local after unlock | Secret NOT present |
| Inspect chrome.storage.session after lock | Secret removed |
| Close browser, reopen, inspect storage.session | Secret gone |
| Content script access to session storage | Blocked (no setAccessLevel) |
| Network tab during backup | Auth header present, body is opaque blob |

---

## Appendix: popup.js Internal Structure

```javascript
(async function() {
  // === Constants & DOM refs ===

  // === State ===
  // let currentSecret = null (local ref after fetching from background)
  // let services = []

  // === Background communication ===
  // getSecret(), setSecret(s), clearSecret()

  // === Rendering ===
  // renderLockScreen(), renderMainScreen(), renderServiceList()

  // === Event handlers ===
  // Unlock, Lock, Add, Delete, Search, Copy, Fill, Toggle

  // === Menu actions ===
  // Backup, Restore, Export, Import

  // === Init ===
  // Check background for secret → render appropriate screen
})();
```
