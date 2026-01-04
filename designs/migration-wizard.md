# Migration Wizard Design

## 1. Overview and User Flow

The migration wizard allows users switching from another password manager to import their service list into Keygrain. It does NOT import passwords — Keygrain derives passwords deterministically. The wizard imports service names and usernames, then provides a checklist to track password rotation progress.

### Entry Point

Popup menu → "Migrate from another manager" → opens `migrate.html` in a new tab (same pattern as existing import.html).

### User Flow

```
[Popup Menu] → [migrate.html in new tab]
    ↓
Step 1: File Picker (drag-and-drop or browse)
    ↓
Step 2: Preview (editable table of parsed services)
    ↓
Step 3: Confirm (summary + rotation warning)
    ↓
Step 4: Checklist (track password rotation progress)
```

### Prerequisites

User must be unlocked (secret + email available via background script). If not unlocked, the page shows an error directing user to unlock via the popup first.

---

## 2. CSV Parsing

### 2.1 Supported Formats

| Manager | Header signature | Fields extracted |
|---------|-----------------|-----------------|
| 1Password | `name,url,username,password,notes` | name, url, username |
| Bitwarden | `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp` | name, login_uri, login_username (only type=1/login rows) |
| LastPass | `url,username,password,totp,extra,name,grouping,fav` | name, url, username |
| Chrome | `name,url,username,password` | name, url, username |
| Firefox | `url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged` | url, username |

### 2.2 Format Auto-Detection

Detection is based on the first line (header row):

1. Read first line, split by comma (respecting quoted fields)
2. Match against known header signatures:
   - Contains `login_uri` → Bitwarden
   - Contains `grouping` and `fav` → LastPass
   - Contains `httpRealm` or `formActionOrigin` → Firefox
   - Exactly `name,url,username,password,notes` → 1Password
   - Exactly `name,url,username,password` → Chrome
3. If no match → show error with manual format selector fallback

### 2.3 Parsing Rules

- **UTF-8 BOM**: Strip `\xEF\xBB\xBF` from start of file before parsing. Many Windows-exported CSVs include this.
- **Quoted fields**: Handle RFC 4180 CSV — fields may be enclosed in double quotes, with escaped quotes as `""`.
- **Multiline values**: Notes fields may contain newlines within quotes — parser must handle this.
- **Empty rows**: Skip blank lines.
- **Bitwarden type filter**: Only import rows where `type` column equals `1` (login type). Skip identity, card, secure note entries.
- **Encoding**: Assume UTF-8. If decoding fails, try Windows-1252 fallback.

### 2.4 Field Mapping

For each row, extract:
- **service_name**: Derived from URL domain (preferred) or name field (fallback). See Section 3.
- **email**: The username/email field from the CSV.
- **old_password**: Held in memory only for display. NEVER persisted. See Section 8.

---

## 3. Service Entry Creation

### 3.1 Domain Extraction from URL

Priority order:
1. If URL field is present and valid → parse URL → extract hostname → strip `www.` prefix → use as service name
2. If URL is empty/invalid → use the `name` field as-is (lowercased, trimmed)
3. For Firefox exports (no name field) → domain extraction from URL is the only source

```
"https://www.github.com/login" → "github.com"
"https://accounts.google.com"  → "accounts.google.com"
"http://192.168.1.1"           → "192.168.1.1" (keep as-is)
```

Special case: if hostname has more than 2 dots and starts with a common subdomain prefix (accounts., login., auth., signin., sso., id., my.), strip it — but only if the remaining hostname has exactly one dot (e.g., `accounts.google.com` → `google.com`). For multi-part TLDs, hardcode a small list of common 2-part suffixes (co.uk, com.au, co.jp, com.br, co.nz, org.uk) and preserve the subdomain if stripping would leave only a known suffix. Imperfect extraction is acceptable — the preview table is editable and users can correct names before confirming.

### 3.2 Deduplication

**Dedup key**: `(normalized_name, normalized_email)` where:
- `normalized_name` = lowercase, trimmed, www-stripped
- `normalized_email` = lowercase, trimmed

**Rules**:
- Exact duplicate (same name + same email) → keep first occurrence, mark duplicate in preview
- Same domain, different email → keep BOTH (user has multiple accounts)
- Same email, different domain → keep BOTH (different services)
- Entries with empty email → keep, but flag for user to fill in during preview

### 3.3 Service Entry Format

Each imported service becomes:
```json
{
  "name": "<extracted domain or name>",
  "email": "<extracted username/email>",
  "length": <from user settings default>,
  "symbols": "<from user settings default>",
  "salt": ""
}
```

Site rules are NOT auto-applied during import. Users can adjust per-service settings later via the popup.

---

## 4. UI: File Picker → Preview → Confirm → Checklist

### 4.1 Step 1: File Picker

- Large drop zone with dashed border
- "Drop CSV file here or click to browse"
- Accepts `.csv` files only
- Below drop zone: brief explanation of supported formats (1Password, Bitwarden, LastPass, Chrome, Firefox)
- On file selection → parse immediately → advance to Step 2
- On parse error → show inline error with details (e.g., "Could not detect format. Is this a CSV export from a supported manager?")

### 4.2 Step 2: Preview

- Header: "Found X services in [detected format] export"
- Editable table with columns:
  - ☑ (checkbox to include/exclude)
  - Service Name (editable text input)
  - Email/Username (editable text input)
  - Old Password (masked by default, eye icon to reveal — held in memory only)
  - Status (duplicate indicator, empty field warning)
- Rows with issues highlighted:
  - Yellow: empty email (user should fill in)
  - Gray + strikethrough: detected duplicate (unchecked by default)
- "Select All" / "Deselect All" controls
- Footer: "X services selected, Y duplicates skipped"
- "Back" button → return to Step 1
- "Continue" button → advance to Step 3

### 4.3 Step 3: Confirm

- **Prominent warning banner** (orange/yellow background, ⚠️ icon):
  > "After import, you must visit each site and change your password to your new Keygrain-generated password. Your old passwords will NOT be imported — Keygrain generates new ones. Until you rotate, your old passwords remain active on those sites."
- Summary: "Import X services into Keygrain?"
- If existing services will be affected: "Y services already exist and will be skipped"
- "Back" button → return to Step 2
- "Import" button → save services → advance to Step 4

### 4.4 Step 4: Checklist

See Section 5 for full checklist UX.

---

## 5. Checklist UX

### 5.1 Purpose

After import, users must visit each site and change their password to the Keygrain-derived one. The checklist tracks this progress.

### 5.2 Layout

- Progress bar at top: "X of Y services rotated"
- Filter buttons: All | Pending | Done
- Service list with:
  - Service name
  - Email/username
  - Status toggle: "Mark as rotated" button → changes to ✓ Done
  - "Copy new password" button (derives and copies the keygrain password; disabled with tooltip "Unlock Keygrain first" if user is locked)
  - "Undo" link on recently-marked items
- When all items are done: success message + "Dismiss checklist" button

### 5.3 Persistence

Stored in `chrome.storage.local` under key `migrationChecklist`:
```json
{
  "version": 1,
  "createdAt": "<ISO timestamp>",
  "items": [
    {"name": "github.com", "email": "user@example.com", "status": "pending"},
    {"name": "google.com", "email": "user@example.com", "status": "done", "doneAt": "<ISO timestamp>"}
  ]
}
```

### 5.4 Access

- After import completes → checklist is shown immediately (Step 4)
- From popup menu → "Migration progress" link (visible only while checklist exists with pending items)
- Opens `migrate.html#checklist` → goes directly to checklist view
- When all items are marked done and user dismisses → remove `migrationChecklist` from storage, hide menu item
- **Locked state**: If user opens the checklist while locked, the progress and status are still visible (read from `migrationChecklist` which is unencrypted), but "Copy new password" buttons are disabled. The "Mark as rotated" button remains functional since it only updates the checklist.

### 5.5 Multiple Imports

If user imports again while a checklist exists:
- New items are appended to existing checklist
- Already-existing items (same name+email) are not duplicated
- Progress bar updates to reflect new total

---

## 6. Integration with Existing Extension Storage

### 6.1 Storage Access

- `migrate.html` loads `keygrain.js` and `sync.js` (same as import.html)
- Gets secret and email from background via `chrome.runtime.sendMessage({action: "getSecret"})` and `{action: "getEmail"}`
- If either is missing → show "Please unlock Keygrain first" error

### 6.2 Reading Existing Services

Before saving, load current services using the same decryption pattern as popup.js:
1. Get `services` from `chrome.storage.local`
2. Decrypt with `deriveStorageKey(secret, email)`
3. Parse JSON → get existing services array

### 6.3 Merging

- For each imported service, check if `(name, email)` already exists in current services
- If exists → skip (do not overwrite — user's existing settings like length/symbols are preserved)
- If new → append to services array
- Save using same `encryptServices` → `chrome.storage.local.set({services: ...})` pattern

### 6.4 File Placement

Add `migrate.html` and `migrate.js` to the `extension/shared/` directory alongside existing `import.html` and `import.js`. Extension pages have inherent access to `chrome.runtime` and `chrome.storage` — no `web_accessible_resources` entry is needed. The build script will copy them to dist automatically.

### 6.5 Popup Menu Addition

Add "Migrate from another manager" item to the menu dropdown in popup.html/popup.js. When checklist has pending items, show "Migration progress (X remaining)" instead.

---

## 7. Test Plan

### 7.1 CSV Parsing Tests

| Test case | Input | Expected |
|-----------|-------|----------|
| 1Password basic | Valid 5-column CSV | Correct name/email extraction |
| Bitwarden with types | Mix of login/card/note rows | Only login rows imported |
| LastPass standard | Standard LastPass export | Correct field mapping |
| Chrome export | 4-column CSV | Correct extraction |
| Firefox export | 9-column CSV, no name field | Domain extracted from URL |
| UTF-8 BOM | File starting with `\xEF\xBB\xBF` | BOM stripped, first header parsed correctly |
| Quoted fields | Fields with commas inside quotes | Correctly split |
| Multiline notes | Bitwarden notes with newlines | Row not split prematurely |
| Empty file | 0 bytes | Error: "File is empty" |
| Header only | Header row, no data | Error: "No services found" |
| Malformed CSV | Inconsistent column count | Error with row number |
| Unicode names | Service names with non-ASCII | Preserved correctly |
| Duplicate entries | Same name+email repeated | Marked as duplicate, only first kept |

### 7.2 Domain Extraction Tests

| Input URL | Expected name |
|-----------|--------------|
| `https://www.github.com/login` | `github.com` |
| `https://accounts.google.com` | `google.com` |
| `https://login.microsoftonline.com` | `microsoftonline.com` |
| `https://my.bank.co.uk/auth` | `bank.co.uk` |
| `http://192.168.1.1/admin` | `192.168.1.1` |
| (empty) with name="My Bank" | `my bank` |
| `chrome://settings` | Skipped (invalid) |

### 7.3 Deduplication Tests

| Scenario | Expected |
|----------|----------|
| Same name + same email × 2 | Keep first, mark second as duplicate |
| Same name + different email | Keep both |
| Different name + same email | Keep both |
| `github.com` + `www.github.com` (same email) | Detected as duplicate after normalization |

### 7.4 Integration Tests

| Test case | Steps | Expected |
|-----------|-------|----------|
| Full import flow | Upload valid CSV → preview → confirm | Services appear in popup |
| Merge with existing | Import when services already exist | New services added, existing preserved |
| Checklist persistence | Import → close tab → reopen | Checklist state preserved |
| Checklist completion | Mark all as done → dismiss | `migrationChecklist` removed from storage |
| Unlock required | Open migrate.html without unlocking | Error message shown |
| Multiple imports | Import twice with overlapping services | No duplicates in final list |

### 7.5 Security Tests

| Test case | Expected |
|-----------|----------|
| Old passwords not in storage | After import, `chrome.storage.local` contains no plaintext passwords |
| Old passwords cleared on close | Navigate away → memory inspection shows no password strings |
| CSV file not retained | After parsing, no reference to file blob persists |

---

## 8. Security: Old Password Handling

### 8.1 Principle

Old passwords from the CSV are **transient display data only**. They exist to help users identify which credential is which during preview, and to facilitate manual rotation. They are NEVER written to any persistent storage.

### 8.2 Lifecycle

1. **Parse**: Old passwords are extracted into a JS array in memory
2. **Display**: Shown masked in preview table, revealable on click
3. **Discard**: On confirm (Step 3 → Step 4 transition), the passwords array is explicitly nulled and the parsed CSV data is dereferenced
4. **Never persisted**: Not written to `chrome.storage.local`, not included in service entries, not sent to any server

### 8.3 Implementation Constraints

- The `parsedData` variable holding old passwords must be set to `null` after the confirm step
- The file input's value must be cleared after parsing
- No `console.log` of password values (even in dev)
- The checklist (Step 4) has NO access to old passwords — they are gone by that point
