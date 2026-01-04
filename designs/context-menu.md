# Context Menu: "Fill with Keygrain"

## Behavior

Right-click anywhere on a page → "Fill with Keygrain" menu item.

- **Unlocked:** Derives password for the first matching service (hostname match), injects content script, fills the last right-clicked password field.
- **Locked:** Opens the popup so the user can unlock and fill manually.
- **No match:** Content script reports "No password field found" (existing behavior).

## Implementation

1. `contextMenus` permission in both manifests
2. Background creates menu item on `runtime.onInstalled`
3. On menu click: check session secret → if missing, open popup; otherwise decrypt services, match hostname, derive password, inject content.js, send `{action: "fillContextMenu", password}`
4. Content script stores last right-clicked element via `contextmenu` event listener, fills it on `fillContextMenu` message

## Why store the element?

After the context menu closes, `document.activeElement` resets to `<body>` in Chrome. The `contextmenu` event fires before the menu opens, so we capture the target reliably.
