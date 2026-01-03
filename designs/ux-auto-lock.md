# Auto-Lock Timeout

## Behavior

- Extension locks automatically after 15 minutes of inactivity (configurable later via settings).
- Timer runs in background script using `chrome.alarms`/`browser.alarms` API.
- On alarm fire: clear secret + email from session storage → popup shows lock screen.
- Timer resets on: unlock, and any user interaction (click/keydown) in the popup.

## Implementation

- **Background:** `autoLock` alarm created on `setSecret`, reset on `heartbeat` message, cleared on `clearSecret`. On alarm fire, remove secret and email.
- **Popup:** Generic `click`/`keydown` listeners send `{action:"heartbeat"}` to background.
- **Manifest:** `"alarms"` permission added (both Chrome and Firefox).

## Known Limitations

- If Firefox popup is open when alarm fires, user sees stale state until next action triggers a `getSecret` check. Acceptable for v1; a background→popup broadcast can be added later.
