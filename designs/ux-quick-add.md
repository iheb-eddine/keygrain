# UX Quick-Add from Current Site

## Summary

When the popup detects no matching service for the current tab's hostname, it shows an "Add [hostname]?" suggestion. Clicking it opens the add-service dialog pre-filled with:

- **Service name**: current hostname (e.g. `github.com`)
- **Email**: session email (`currentEmail`)
- **Length**: 20 (default)
- **Symbols**: `!@#$%&*-_=+?` (default)

The user just clicks "Add" to confirm.

## Implementation

Single change in `extension/shared/popup.js`, function `autoDetectSite()`:

```diff
- addEmail.value = "";
+ addEmail.value = currentEmail || "";
```

## Invariants

- `currentEmail` is always set when `autoDetectSite()` runs (called only after successful unlock or session restore).
- The `|| ""` fallback is defensive; in practice `currentEmail` is never null at this point.
