# Badge Count

## Behavior

The extension icon shows a badge with the number of saved services matching the current tab's hostname. Badge is only visible when the vault is unlocked (secret in session).

- **Locked:** No badge (cleared).
- **Unlocked, no matches:** No badge.
- **Unlocked, N matches:** Badge shows "N".

## Matching Logic

Same as popup auto-detect: `serviceName.includes(hostname) || hostname.includes(serviceName)` (case-insensitive, www-stripped).

## Triggers

- `tabs.onActivated` — user switches tabs
- `tabs.onUpdated` (status: complete) — page navigation
- `refreshBadge` message — popup notifies after service add/delete
- Auto-lock alarm / manual lock — clears badge

## Permissions

Requires `tabs` permission for URL access in background listeners.

## Security

Badge only works when unlocked. Services are decrypted per-call using the session secret; no plaintext service list is cached or stored separately.
