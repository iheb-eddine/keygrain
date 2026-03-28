# Mobile: Clipboard URL Pre-fill

## Summary

When the user taps the FAB to add a new service, read the clipboard. If it contains a URL or domain, normalize it and pre-fill the "site" field in AddServiceDialog.

## Behavior

1. User taps FAB → app reads `ClipboardManager.primaryClip` text
2. Text is matched against: `^(https?://\S+|[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}(/\S*)?)$`
   - Matches URLs with protocol (`https://github.com/settings`)
   - Matches bare domains (`github.com`, `amazon.co.uk`)
   - Rejects version strings (`v1.2.3`), filenames (`file.txt` with numeric TLD), passwords
3. If match: normalize via `ServiceManager.normalizeSite()` (strips protocol, www, path, query, hash, lowercases)
4. Pass normalized domain as initial `site` value to AddServiceDialog
5. If no match or clipboard empty: pass empty string (normal behavior)

## Privacy

- Android 13+ shows a system toast when apps read clipboard — acceptable since user just initiated the action
- No clipboard data is stored or transmitted beyond pre-filling the field
- User can clear/edit the pre-filled value

## Regex Rationale

The domain pattern requires the TLD segment to be alpha-only and ≥2 chars. This eliminates:
- `v1.2.3` (numeric segments)
- `file.123` (numeric TLD)
- Passwords with dots (TLD would need to be pure alpha, unlikely in random passwords)

Edge case: `foo.ab` matches (2-char alpha TLD). Consequence is only a pre-filled field the user can clear — acceptable.

## Implementation

- `MainScreen.kt`: FAB onClick reads clipboard, computes prefill, passes to dialog
- `AddServiceDialog`: accepts `initialSite: String = ""` parameter
- State change: `showAddDialog: Boolean` → `prefillSite: String?` (null = hidden)
