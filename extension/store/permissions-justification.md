# Permissions Justification — Keygrain

## Single Purpose Statement

Keygrain generates deterministic passwords from a master secret and fills them into web forms, with optional end-to-end encrypted sync of the user's site list across devices.

## Permission: `activeTab`

**What it does:** Grants temporary access to the active tab when the user interacts with the extension (clicks the icon, uses keyboard shortcut, or right-clicks).

**Why needed:** To read the current tab's URL for site identification (matching which saved service to generate a password for) and to inject the content script that fills username/password fields.

**Code locations:**
- `background.js`: keyboard shortcut handler reads `tab.url` to match services
- `background.js`: context menu handler reads `tab.url` for the same purpose
- `content.js`: injected into the active tab to find and fill form fields

## Permission: `alarms`

**What it does:** Allows scheduling timed events that fire even when the popup is closed.

**Why needed:** Two uses:
1. **Auto-lock timer (`autoLock`):** Clears the master secret from memory after a configurable inactivity period (default 15 minutes). This is a security feature — without it, the secret would persist indefinitely in the service worker.
2. **Sync timer (`syncAlarm`):** When sync is enabled and the user is unlocked, triggers a background sync every 5 minutes to keep the encrypted vault in sync across devices.

**Code locations:**
- `background.js`: `chrome.alarms.create("autoLock", ...)` — security timer
- `background.js`: `chrome.alarms.create("syncAlarm", ...)` — periodic sync
- `background.js`: `chrome.alarms.onAlarm.addListener(...)` — handles both

## Permission: `contextMenus`

**What it does:** Allows adding items to the browser's right-click context menu.

**Why needed:** Adds a "Fill with Keygrain" option when the user right-clicks on an editable field. This provides a quick-access alternative to opening the popup or using the keyboard shortcut.

**Code locations:**
- `background.js`: `chrome.contextMenus.create({id: "keygrain-fill", ...})`
- `background.js`: `chrome.contextMenus.onClicked.addListener(...)` — generates and fills password

## Permission: `scripting` (Chrome only)

**What it does:** Allows programmatic injection of scripts into web pages.

**Why needed:** To inject `content.js` into the active tab when the user triggers autofill (via keyboard shortcut or context menu). The content script finds password/username fields and fills them with the generated credentials.

**Code locations:**
- `background.js`: `chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["content.js"]})`

**Note:** Firefox MV2 uses `browser.tabs.executeScript()` instead, which is covered by the `activeTab` permission and does not require a separate `scripting` permission.

## Permission: `storage`

**What it does:** Allows reading and writing to the extension's local and session storage areas.

**Why needed:** Stores:
- Encrypted site list (AES-256-GCM encrypted blob containing service configurations)
- User settings (auto-lock timeout, sync preferences, server URL)
- Sync state (last sync time, last sync error)
- Session data (master secret and email in session storage — cleared on browser close and auto-lock)

**Code locations:**
- `background.js`: `chrome.storage.local.get("services")`, `chrome.storage.local.get("settings")`
- `background.js`: `chrome.storage.session.get(["secret", "email"])`
- `popup.js`: reads/writes encrypted service list and settings

## Permission: `tabs`

**What it does:** Allows querying and reading tab information (URL, title, status).

**Why needed:** Required for:
1. **Badge updates:** `tabs.onActivated` and `tabs.onUpdated` listeners update the badge count showing how many saved services match the current site
2. **Background operations:** `tabs.query({active: true, currentWindow: true})` to get the active tab during keyboard shortcut and context menu handling (where `activeTab` context may not be available)
3. **Tab URL reading:** `tabs.get(tabId)` to read URLs for badge calculation

**Code locations:**
- `background.js`: `chrome.tabs.onActivated.addListener(...)` — badge updates
- `background.js`: `chrome.tabs.onUpdated.addListener(...)` — badge updates
- `background.js`: `chrome.tabs.query(...)` — keyboard shortcut, context menu, lock handler
- `background.js`: `chrome.tabs.get(tabId)` — badge calculation

## Permission: `host_permissions` — `https://keygrain.secbytech.com/*`

**What it does:** Allows making network requests (fetch) to the specified origin.

**Why needed:** The optional sync feature pushes and pulls the user's encrypted vault to/from the Keygrain sync server. All data is encrypted client-side with AES-256-GCM before transmission — the server stores only opaque ciphertext it cannot decrypt.

**Code locations:**
- `sync.js`: `fetch(syncServer + "/api/sync/" + lookupId, {...})` — GET (pull) and PUT (push)

**Data transmitted:**
- Lookup ID (HMAC-derived hash — not the user's email)
- Encrypted blob (AES-256-GCM ciphertext of the site list)
- Auth token (bcrypt hash of a derived password — not the master secret)

## Summary Table

| Permission | Purpose | User-facing benefit |
|---|---|---|
| `activeTab` | Read URL, inject fill script | Autofill works on the current page |
| `alarms` | Auto-lock + periodic sync | Security timeout, background sync |
| `contextMenus` | Right-click "Fill with Keygrain" | Quick access from any password field |
| `scripting` | Inject content.js (Chrome) | Autofill via shortcut/context menu |
| `storage` | Encrypted data + settings | Persistent site list across sessions |
| `tabs` | Badge count + background tab access | Visual indicator, shortcut/menu fill |
| `host_permissions` | Sync server communication | Cross-device encrypted sync |
