# Design: Extension Store Preparation

## Summary

Prepared all store submission materials for Chrome Web Store and Firefox Add-ons that can be created without developer accounts.

## Deliverables

| File | Purpose |
|------|---------|
| `extension/store/chrome-listing.md` | Chrome Web Store listing text (name, descriptions, category, single purpose) |
| `extension/store/firefox-listing.md` | Firefox Add-ons listing text (name, summary, description, reviewer notes, source disclosure) |
| `extension/store/permissions-justification.md` | Per-permission justification with code references |
| `extension/store/screenshot-guide.md` | What screenshots to capture, setup instructions, dimensions |

## Findings

### Permissions Audit — All Verified

Every declared permission is actively used in the code:

- `activeTab` — content.js injection for autofill
- `alarms` — autoLock timer + syncAlarm (5-min periodic sync)
- `contextMenus` — "Fill with Keygrain" right-click menu
- `scripting` (Chrome only) — `chrome.scripting.executeScript` for content.js
- `storage` — encrypted service list, settings, sync state
- `tabs` — badge updates, active tab queries for shortcut/context menu
- `host_permissions: keygrain.secbytech.com/*` — sync fetch calls

### Privacy Policy Inaccuracy

The privacy policy at `https://keygrain.secbytech.com/privacy.html` describes the `alarms` permission as only for "auto-lock timer." In reality, it is also used for `syncAlarm` (5-minute periodic background sync). This should be corrected before submission.

**Current text:** "alarms — to schedule an auto-lock timer that clears your master secret from memory after inactivity"

**Should be:** "alarms — to schedule an auto-lock timer that clears your master secret from memory after inactivity, and to trigger periodic background sync (every 5 minutes) when sync is enabled"

### Version

Extension version 1.1.0 is independent from the Python CLI package (0.1.0). These are separate products with separate versioning. No issue.

### Bundled Libraries (Firefox Review Concern)

The extension bundles two minified third-party libraries:

| File | Package | Size |
|------|---------|------|
| `lib/tweetnacl.js` | tweetnacl (npm) | 32KB |
| `lib/hash-wasm-argon2.js` | hash-wasm (npm) | 29KB |

Neither file embeds a version number. Exact versions must be verified by comparing file hashes against npm registry tarballs before submission. Firefox Add-ons review requires source code disclosure for minified code. The Firefox listing includes a dedicated "Source Code Disclosure" section with npm package URLs and verification instructions.

### Existing `docs/store-listing.md`

The file `docs/store-listing.md` contains an earlier, less complete version of the store listing. The new `extension/store/` files supersede it. Recommend deleting `docs/store-listing.md` or replacing its content with a pointer to the new files.

## Pre-Submission Checklist

Before uploading to stores:

- [ ] **Rebuild dist zips** — source files were modified after last build (keygrain.js, popup.js, popup.html, popup.css modified after dist built on May 11 06:25)
- [ ] **Fix privacy policy** — add syncAlarm mention to the alarms permission description
- [ ] **Take screenshots** — follow `extension/store/screenshot-guide.md`
- [ ] **Verify library versions** — compare bundled file hashes against npm registry tarballs for tweetnacl and hash-wasm to identify exact versions
- [ ] **Delete or update `docs/store-listing.md`** — avoid maintenance drift with new store files
- [ ] **Create developer accounts** — Chrome Web Store ($5 one-time), Firefox Add-ons (free)

## Decisions

1. **Category:** Chrome = "Productivity" (no "Security" category available; Tools is alternative but Productivity has more visibility for password tools). Firefox = "Security & Privacy" (direct match).
2. **Short description:** Reused from existing `docs/store-listing.md` — it's well-crafted and within limits.
3. **Firefox source disclosure:** Listed tweetnacl and hash-wasm npm packages. Versions not embedded in files — pre-submission checklist includes hash verification step.
