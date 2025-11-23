# Browser Extension — Design Document

## 1. Overview & Architecture

A browser extension for Chrome (Manifest V3) and Firefox (WebExtensions) that generates deterministic passwords using the Keygrain algorithm and autofills them into password fields.

### Components

```
┌─────────────────────────────────────────────────────┐
│ Popup (popup.html + popup.js)                       │
│ - Form: secret, email, length, symbols, salt        │
│ - Imports keygrain.js, derives password             │
│ - Sends fill command directly to content script     │
│ - Copy to clipboard fallback                        │
└────────────────────────┬────────────────────────────┘
                         │ chrome.tabs.sendMessage()
                         ▼
┌─────────────────────────────────────────────────────┐
│ Content Script (content.js)                         │
│ - Injected programmatically (activeTab)             │
│ - Detects password fields                           │
│ - Fills password + dispatches input/change events   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Background Service Worker (background.js)           │
│ - Listens for keyboard shortcut command             │
│ - Opens popup via chrome.action.openPopup()         │
│ - Injects content script on demand                  │
└─────────────────────────────────────────────────────┘
```

### Data Flow (Generate + Fill)

1. User clicks extension icon or presses `Ctrl+Shift+K` → popup opens
2. Popup loads last-used email/settings for current domain from `chrome.storage.local`
3. User enters secret, adjusts settings, clicks "Generate"
4. `keygrain.js` derives password in popup context (Web Crypto API)
5. User clicks "Fill" → popup calls `chrome.tabs.sendMessage(tabId, {action: "fill", password})` to content script
6. Content script finds the focused or first visible password field, sets value, dispatches events
7. Popup closes → all JS memory (including password) is garbage collected

### Data Flow (Copy Fallback)

Steps 1–4 same as above. User clicks "Copy" → `navigator.clipboard.writeText(password)`. Clipboard cleared after 30 seconds.

## 2. File Structure

```
extension/
├── shared/                    # All source files (shared between browsers)
│   ├── keygrain.js           # Derivation algorithm (ES module, no deps)
│   ├── popup.html            # Popup UI
│   ├── popup.js              # Popup logic
│   ├── popup.css             # Popup styles
│   ├── content.js            # Content script
│   ├── background.js         # Service worker / event page
│   └── icons/
│       ├── icon-16.png
│       ├── icon-48.png
│       └── icon-128.png
├── chrome/
│   └── manifest.json         # Chrome Manifest V3
├── firefox/
│   └── manifest.json         # Firefox manifest (V2-style with V3 features)
└── build.sh                  # Copies shared/ + correct manifest → dist/
```

Output:
```
dist/
├── chrome/                   # Ready to zip for Chrome Web Store
│   ├── manifest.json
│   ├── keygrain.js
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   ├── content.js
│   ├── background.js
│   └── icons/
└── firefox/                  # Ready to zip for Firefox Add-ons
    ├── manifest.json
    ├── keygrain.js
    ├── popup.html
    ├── popup.js
    ├── popup.css
    ├── content.js
    ├── background.js
    └── icons/
```

### keygrain.js Module

Extracted from `server/static/generate/index.html`. Exports:

```js
// keygrain.js — no imports, no dependencies
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";

async function derivePassword(secret, email, length, symbols, salt) { ... }
```

In Chrome MV3, the popup can import it as a classic script (`<script src="keygrain.js">`). Content scripts cannot use ES modules in all contexts, but `keygrain.js` is only needed in the popup.

## 3. Manifest Files

### Chrome (Manifest V3)

```json
{
  "manifest_version": 3,
  "name": "Keygrain",
  "version": "1.0.0",
  "description": "Deterministic password generator — no storage, no sync, no trust.",
  "permissions": [
    "activeTab",
    "scripting",
    "storage"
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "background": {
    "service_worker": "background.js"
  },
  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Ctrl+Shift+K",
        "mac": "Command+Shift+K"
      },
      "description": "Open Keygrain popup"
    }
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'none'"
  }
}
```

### Firefox

```json
{
  "manifest_version": 2,
  "name": "Keygrain",
  "version": "1.0.0",
  "description": "Deterministic password generator — no storage, no sync, no trust.",
  "permissions": [
    "activeTab",
    "storage"
  ],
  "browser_action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "background": {
    "scripts": ["background.js"]
  },
  "commands": {
    "_execute_browser_action": {
      "suggested_key": {
        "default": "Ctrl+Shift+K",
        "mac": "Command+Shift+K"
      },
      "description": "Open Keygrain popup"
    }
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "content_security_policy": "script-src 'self'; object-src 'none'",
  "browser_specific_settings": {
    "gecko": {
      "id": "keygrain@seedpass",
      "strict_min_version": "109.0"
    }
  }
}
```

**Key differences:**
- Chrome: `manifest_version: 3`, `action`, `service_worker`, `_execute_action`
- Firefox: `manifest_version: 2`, `browser_action`, `scripts: [...]`, `_execute_browser_action`, `gecko` settings
- Firefox doesn't need `scripting` permission — `browser.tabs.executeScript()` works with `activeTab`

## 4. Popup UI Design

### Layout

```
┌──────────────────────────────────┐
│ 🔑 Keygrain                      │
├──────────────────────────────────┤
│ Secret:  [••••••••••••••]        │
│ Email:   [user@example.com]      │
│ Length:  [20        ]            │
│ Symbols: [!@#$%&*-_=+?]         │
│ Salt:    [           ]           │
├──────────────────────────────────┤
│ [Generate]                       │
├──────────────────────────────────┤
│ ┌────────────────────┐ [📋] [▶] │
│ │ aX7#mKp...         │ Copy Fill│
│ └────────────────────┘           │
│ Status: Copied! / Filled!        │
└──────────────────────────────────┘
```

### Dimensions

Popup width: 320px. Height: auto (approximately 380px with all fields visible).

### UX Flow

1. On open: load last-used email + settings for current domain from storage. Secret field is always empty.
2. User types secret, clicks "Generate" (or presses Enter).
3. Password appears in readonly output field. "Fill" and "Copy" buttons become active.
4. "Fill" injects content script (if not already injected) and sends password to active tab.
5. "Copy" writes to clipboard, shows "Copied!" status, schedules 30s clipboard clear.
6. On close: all state is lost. Secret and password exist only in popup JS memory.

### Accessibility

- All inputs have associated `<label>` elements
- Focus order follows visual order
- Status messages use `aria-live="polite"`
- Buttons have descriptive `aria-label` attributes
- High contrast colors, minimum 4.5:1 ratio

## 5. Content Script: Password Field Detection & Fill

### Injection

Content script is injected programmatically when the user clicks "Fill":

```js
// popup.js
async function injectAndFill(password) {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  await chrome.scripting.executeScript({
    target: {tabId: tab.id},
    files: ["content.js"]
  });
  await chrome.tabs.sendMessage(tab.id, {action: "fill", password});
}
```

Firefox equivalent uses `browser.tabs.executeScript(tabId, {file: "content.js"})`.

### Password Field Detection

Priority order:

1. **Currently focused element** — if it's `input[type=password]`, use it
2. **Visible password fields** — `document.querySelectorAll('input[type=password]')`, filtered to visible (non-hidden, non-zero dimensions)
3. **Heuristic fallback** — inputs with `autocomplete="new-password"` or `autocomplete="current-password"`, or `name`/`id` containing "pass"

```js
function findPasswordField() {
  const focused = document.activeElement;
  if (focused?.type === "password") return focused;

  const fields = document.querySelectorAll('input[type="password"]');
  for (const f of fields) {
    if (f.offsetParent !== null && f.offsetWidth > 0) return f;
  }

  // Heuristic: hidden type but password-like attributes
  const candidates = document.querySelectorAll(
    'input[autocomplete*="password"], input[name*="pass" i], input[id*="pass" i]'
  );
  for (const c of candidates) {
    if (c.offsetParent !== null) return c;
  }
  return null;
}
```

### Fill Mechanism

Setting `.value` alone doesn't trigger React/Vue/Angular change detection. The content script must dispatch synthetic events:

```js
function fillField(field, password) {
  // Set native value via setter to bypass framework wrappers
  const nativeSet = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, 'value'
  ).set;
  nativeSet.call(field, password);

  field.dispatchEvent(new Event('input', {bubbles: true}));
  field.dispatchEvent(new Event('change', {bubbles: true}));
}
```

### Iframe Handling

`activeTab` permission grants access to the top frame only. For iframes (common in banking sites):
- If same-origin: the content script can access iframe content via `contentDocument`
- If cross-origin: not accessible without `<all_urls>`. **Design decision:** document this limitation. Users must use "Copy" for cross-origin iframe login forms.

This is an acceptable tradeoff — cross-origin iframes are rare for login forms, and requesting `<all_urls>` would harm store approval.

## 6. Communication: Popup ↔ Content Script ↔ Background

### Message Protocol

All messages are plain objects with an `action` field:

| From | To | Message | Purpose |
|------|----|---------|---------|
| Popup | Content Script | `{action: "fill", password: "..."}` | Fill password field |
| Content Script | Popup | `{action: "fill_result", success: true/false, error?: "..."}` | Report fill outcome |
| Background | — | (listens for `chrome.commands.onCommand`) | Shortcut handling |

### Popup → Content Script (Direct)

```js
// popup.js
const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
const response = await chrome.tabs.sendMessage(tab.id, {action: "fill", password});
```

### Content Script Listener

```js
// content.js — idempotency guard (script may be injected multiple times)
if (!window.__keygrain_injected) {
  window.__keygrain_injected = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "fill") {
      const field = findPasswordField();
      if (field) {
        fillField(field, msg.password);
        sendResponse({action: "fill_result", success: true});
      } else {
        sendResponse({action: "fill_result", success: false, error: "No password field found"});
      }
    }
    return true; // async response
  });
}
```

### Background (Minimal)

```js
// background.js — Chrome
chrome.commands.onCommand.addListener((command) => {
  if (command === "_execute_action") {
    // Chrome automatically opens popup for _execute_action
    // No additional handling needed
  }
});
```

For Chrome, `_execute_action` automatically opens the popup — no background logic needed for the shortcut. The background.js is effectively a no-op but must exist for the manifest.

Firefox uses `_execute_browser_action` which also auto-opens the popup.

## 7. Storage Design

### What Is Persisted

| Key | Value | Purpose |
|-----|-------|---------|
| `domains.{hostname}` | `{email, length, symbols, salt}` | Last-used settings per domain |

### What Is NEVER Persisted

- Master secret
- Generated passwords
- Any derived key material

### Storage API

```js
// Save settings for current domain
async function saveSettings(hostname, settings) {
  const key = `domains.${hostname}`;
  await chrome.storage.local.set({[key]: settings});
}

// Load settings for current domain
async function loadSettings(hostname) {
  const key = `domains.${hostname}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || {email: "", length: 20, symbols: "!@#$%&*-_=+?", salt: ""};
}
```

### Storage Size

Each domain entry is ~100 bytes. At 1000 domains, total storage is ~100KB — well within `chrome.storage.local` limits (5MB default).

### When Settings Are Saved

Settings are saved when the user clicks "Generate" — this captures the email and parameters they actually used for that domain.

## 8. Security Considerations

### Secret Handling

- Secret is typed into popup input field, exists only in popup JS memory
- Popup memory is destroyed when popup closes (browser guarantees this)
- Secret is never written to storage, never sent to background, never logged
- The `<input type="password">` prevents shoulder-surfing

### Password in Transit

- Generated password travels: popup memory → `chrome.tabs.sendMessage()` → content script memory → DOM field value
- The message passes through Chrome's internal IPC (not network, not disk)
- Content script clears its reference after filling

### Clipboard Security

- Clipboard is cleared 30 seconds after copy
- Uses `navigator.clipboard.writeText("")` to clear
- Status message warns user: "Clipboard will clear in 30s"

### Content Security Policy

- `script-src 'self'` — no inline scripts, no eval, no remote scripts
- `object-src 'none'` — no plugins

### Permission Minimization

- `activeTab` — only access current tab when user explicitly triggers
- `scripting` — programmatic injection (Chrome only)
- `storage` — local settings only
- No `<all_urls>`, no `tabs` (full tab list), no `webRequest`

### Attack Surface

| Threat | Mitigation |
|--------|-----------|
| Malicious page reads extension messages | Content scripts have isolated worlds; page JS cannot intercept `chrome.runtime.onMessage` |
| Extension compromise leaks secrets | Secret only exists in popup memory; no persistence anywhere |
| Clipboard sniffing | 30s auto-clear; user warned |
| Shoulder surfing | Password input masked; output field can be toggled |
| Supply chain | Zero external dependencies; all code is first-party |

## 9. Build & Packaging

### Build Script (`extension/build.sh`)

```bash
#!/bin/bash
set -euo pipefail

rm -rf dist/
mkdir -p dist/chrome dist/firefox

# Copy shared files to both targets
for target in chrome firefox; do
  cp -r shared/* "dist/$target/"
  cp "$target/manifest.json" "dist/$target/"
done

# Package as zip
cd dist
zip -r keygrain-chrome.zip chrome/
zip -r keygrain-firefox.zip firefox/
echo "Built: dist/keygrain-chrome.zip, dist/keygrain-firefox.zip"
```

### Store Submission

- **Chrome Web Store:** Upload `keygrain-chrome.zip` via developer dashboard. Requires $5 one-time fee.
- **Firefox Add-ons:** Upload `keygrain-firefox.zip` via addons.mozilla.org. Free. Source code may be requested for review (provide git repo link).

### Development Loading

- **Chrome:** `chrome://extensions` → Enable Developer Mode → "Load unpacked" → select `dist/chrome/`
- **Firefox:** `about:debugging` → "This Firefox" → "Load Temporary Add-on" → select `dist/firefox/manifest.json`

## 10. Test Plan

### Unit Tests (keygrain.js)

Run against the existing `vectors.json` test vectors to verify cross-platform consistency:

```js
// test-keygrain.js (Node.js, using webcrypto)
import {webcrypto} from 'crypto';
globalThis.crypto = webcrypto;

// Load vectors.json, run derivePassword for each, assert match
```

Validates that the extracted `keygrain.js` produces identical output to Python/Kotlin implementations.

### Manual Test Matrix

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Basic generation | Open popup, enter secret+email, click Generate | Password appears in output |
| 2 | Fill password field | Navigate to login page, generate, click Fill | Password filled in field |
| 3 | Copy to clipboard | Generate, click Copy | Password in clipboard, cleared after 30s |
| 4 | Per-domain memory | Generate on site A, close, reopen on site A | Email/settings pre-filled |
| 5 | Different domain | Open on site B | Settings are empty or site B's saved settings |
| 6 | Keyboard shortcut | Press Ctrl+Shift+K on any page | Popup opens |
| 7 | No password field | Click Fill on page with no password input | Error status shown |
| 8 | React/SPA site | Fill on React login form | Form accepts the value (events dispatched) |
| 9 | Cross-origin iframe | Login form in cross-origin iframe | Fill fails gracefully, user uses Copy |
| 10 | Firefox compat | Repeat tests 1-8 in Firefox | Same behavior |

### Automated Integration Tests

Use Puppeteer/Playwright with extension loading:

```bash
# Chrome
npx playwright test --project=chromium --headed \
  --use='{"args":["--load-extension=dist/chrome"]}'
```

Test cases:
- Extension loads without errors
- Popup opens and form is interactive
- Generate produces consistent output (compare with vectors.json)
- Fill injects into a test page's password field
- Storage persists across popup open/close cycles

### Cross-Platform Consistency

The critical test: given the same inputs, `keygrain.js` (extension) must produce the same output as:
- `server/static/generate/index.html` (web generator)
- `python/keygrain/derive.py` (Python CLI)
- `kotlin/app/src/.../Keygrain.kt` (Android)

This is verified by running all implementations against `vectors.json`.
