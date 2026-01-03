# One-Click Fill

## Problem
When a user opens the popup on a site with exactly one matching service, they still have to find and click the fill button on the service row.

## Solution
Show a prominent "Fill [service]" button at the top of the main screen when exactly one service matches the current hostname. Clicking it derives the password, injects the content script, fills the field, and closes the popup.

## Behavior
- **1 match:** Show quick-fill button above service list. Hide on manual search edit.
- **0 or 2+ matches:** Don't show. Existing behavior (suggestion link or filtered list) remains.

## Implementation
- `#quick-fill` div in popup.html above `#service-list`
- Styled as full-width accent button in popup.css
- Logic in `autoDetectSite()` in popup.js; reuses existing `handleFill(svc)`
- Closes popup after successful fill via `window.close()`
