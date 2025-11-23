# Error Message Humanization Design

## 1. Overview

Keygrain currently displays a mix of user-friendly and raw technical error messages across its platforms. This design standardizes all user-facing error messages into a consistent format with clear language and actionable guidance.

### Principles

1. **No raw exceptions.** Messages like `"Export failed: ${e.message}"` or `"Fill failed: " + err.message` MUST never reach the user. Every error path maps to a pre-defined human message.
2. **Server stays machine-readable.** The server API returns structured JSON error codes. Clients are responsible for mapping these to human messages.
3. **Display format matches UI context.** Not every surface can show a title + description + action. The format adapts to the display constraint.

---

## 2. Message Format

### Full Format (for dialogs and dedicated error views)

| Field | Purpose | Example |
|-------|---------|---------|
| **Title** | What went wrong (≤ 6 words) | "Backup failed" |
| **Description** | Why it happened (1 sentence) | "The server couldn't verify your identity." |
| **Action** | What to do next (1 sentence, imperative) | "Check your master secret and email, then try again." |

### Compact Format (for snackbars, status lines, toasts)

A single line combining description + action:

> "Couldn't verify your identity. Check your secret and email."

### Structured Format (server API — unchanged)

```json
{"error": "<machine_code>", "retry_after": 5}
```

### Display Context Mapping

| Platform | UI Element | Format |
|----------|-----------|--------|
| Android | Snackbar | Compact |
| Android | AlertDialog (sync errors) | Full (future enhancement) |
| Browser extension | `#status` div | Compact |
| Web generator | `#status` div | Compact |
| Python CLI | stderr | Compact |
| Server API | JSON response | Structured (no change) |

---

## 3. Error Catalog

### 3.1 Android App — Sync Operations

| Current Message | Context | Humanized (Compact) | Title (Full) |
|----------------|---------|---------------------|--------------|
| `"Backup complete"` | SyncResult.Success | "Backup complete — N services saved to server." | — (success) |
| `"Authentication failed. Check your secret and email."` | SyncResult.AuthError | "Couldn't verify your identity. Check your secret and email." | "Authentication failed" |
| `"Network error. Check your connection and try again."` | SyncResult.NetworkError | "Can't reach the server. Check your internet connection and try again." | "Connection failed" |
| `"Server error. Try again later."` | SyncResult.ServerError | "Something went wrong on the server. Try again in a few minutes." | "Server error" |
| `"Restored N services"` | RestoreResult.Success | "Restored N services from backup." | — (success) |
| `"Authentication failed. Check your secret and email."` | RestoreResult.AuthError | "Couldn't verify your identity. Check your secret and email." | "Authentication failed" |
| `"Network error. Check your connection and try again."` | RestoreResult.NetworkError | "Can't reach the server. Check your internet connection and try again." | "Connection failed" |
| `"No backup found for this email."` | RestoreResult.NotFound | "No backup exists for this email. Check the email address or create a backup first." | "No backup found" |
| `"Could not decrypt backup. Wrong secret or email."` | RestoreResult.DecryptionError | "Couldn't decrypt the backup. Make sure you're using the same secret and email you used to create it." | "Decryption failed" |
| `"Server error. Try again later."` | RestoreResult.ServerError | "Something went wrong on the server. Try again in a few minutes." | "Server error" |

### 3.2 Android App — File Export/Import

| Current Message | Context | Humanized (Compact) |
|----------------|---------|---------------------|
| `"Exported N services"` | Export success | "Exported N services to file." |
| `"Export failed: ${e.message}"` | Export exception | "Couldn't export your services. Make sure you have storage access and try again." |
| `"Decryption failed. Wrong secret or email."` | Import AEADBadTagException | "Couldn't decrypt the file. Make sure you're using the same secret and email you used to export it." |
| `"Import failed: ${e.message}"` | Import other exception | "Couldn't read the backup file. Make sure you selected a valid Keygrain backup." |
| `"Imported N services"` | Import success | "Imported N services from file." |

### 3.3 Browser Extension (popup.js + content.js)

| Current Message | Context | Humanized (Compact) |
|----------------|---------|---------------------|
| `"Length must be at least 8."` | Validation | "Password length must be at least 8 characters." |
| `"Symbols must not be empty."` | Validation | "At least one symbol character is required." |
| `"Copied! Clipboard clears in 30s."` | Copy success | "Copied! Clipboard clears in 30 seconds." |
| `"Clipboard cleared."` | Timer fired | "Clipboard cleared." |
| `"Filled!"` | Fill success | "Password filled into the page." |
| `"No password field found."` | content.js response | "No password field found on this page. Click on the password field and try again." |
| `"Fill failed: " + err.message` | Fill exception | "Couldn't fill the password. Try copying it manually instead." |

### 3.4 Web Generator (index.html)

| Current Message | Context | Humanized (Compact) |
|----------------|---------|---------------------|
| `"Length must be at least 8."` | Validation | "Password length must be at least 8 characters." |
| `"Symbols must not be empty."` | Validation | "At least one symbol character is required." |
| `"Copied!"` | Copy success | "Copied! Clipboard clears in 30 seconds." |
| `"Clipboard cleared."` | Timer fired | "Clipboard cleared." |

### 3.5 Server API (backup.go + ratelimit.go)

The server responses remain machine-readable. This table defines the **client-side mapping** each client must implement:

| Server Response | HTTP Status | Client Humanized Message |
|----------------|-------------|--------------------------|
| `{"error":"invalid lookup_id"}` | 400 | "Something went wrong. Please try again." |
| `{"error":"unauthorized"}` | 401 | "Couldn't verify your identity. Check your secret and email." |
| `{"error":"payload too large"}` | 413 | "Your backup is too large. Remove some services and try again." |
| `{"error":"empty body"}` | 400 | "Something went wrong. Please try again." |
| `{"error":"internal error"}` | 500 | "Something went wrong on the server. Try again in a few minutes." |
| `{"error":"not found"}` | 404 | "No backup exists for this email. Check the email address or create a backup first." |
| `{"error":"method not allowed"}` | 405 | "Something went wrong. Please try again." |
| `{"error":"rate limit exceeded","retry_after":N}` | 429 | "Too many requests. Please wait N seconds and try again." |

### 3.6 Python CLI (cli.py + derive.py)

| Current Message | Context | Humanized (Compact) |
|----------------|---------|---------------------|
| `"Error: {secret_env} environment variable not set"` | Missing env var | "Error: Master secret not found. Set the {secret_env} environment variable." |
| `ValueError("length must be >= 8")` | Validation | "Error: Password length must be at least 8." |
| `ValueError("symbols must not be empty")` | Validation | "Error: At least one symbol character is required." |

---

## 4. Platform-Specific Implementation

### 4.1 Android App

**Where messages live:** A `UserMessages` object (or string resources) mapping each sealed class variant to its human message.

**Pattern:**
```
// In the when() block that handles SyncResult/RestoreResult:
is SyncResult.NetworkError -> UserMessages.NETWORK_ERROR
```

**Display:** Snackbar (compact format). For critical errors (decryption failure, auth failure), consider a longer-duration snackbar with an action button.

**Raw exception rule:** Replace all `"...failed: ${e.message}"` patterns with a catch-all mapped message. Log the actual exception via `Log.e()` for debugging.

### 4.2 Browser Extension

**Where messages live:** A `MESSAGES` constant object in popup.js (or a shared messages.js file).

**Pattern:**
```javascript
status.textContent = MESSAGES.FILL_NO_FIELD;
```

**Display:** `#status` div (compact format, single line).

**Raw exception rule:** Replace `"Fill failed: " + err.message` with the mapped message. Log `err` to console for debugging.

### 4.3 Web Generator

**Where messages live:** Inline constants or a `MESSAGES` object at the top of the `<script>` block.

**Display:** `#status` div (compact format).

### 4.4 Python CLI

**Where messages live:** Constants in cli.py. The derive.py `ValueError` messages can be updated in place since they're already human-readable (just slightly terse).

**Display:** stderr via `print(..., file=sys.stderr)`.

### 4.5 Server API

**No changes.** The server continues to return machine-readable JSON. Clients map HTTP status + error code to human messages.

---

## 5. Internationalization Considerations

### Current State

All messages are English-only, hardcoded in source.

### Future-Proofing Strategy

1. **Message keys, not inline strings.** Each platform should reference messages by a constant/key rather than inline strings. This makes extraction trivial later.

2. **Android:** Already has `strings.xml` infrastructure. When i18n is needed, move messages from the `UserMessages` object to `res/values/strings.xml` and add locale variants.

3. **Browser extension:** Chrome extensions support `_locales/` with `messages.json`. The `MESSAGES` object can be replaced with `chrome.i18n.getMessage()` calls.

4. **Web generator:** Use a `MESSAGES` object that can be swapped for a locale-loaded variant. No framework needed for a single-page tool.

5. **Python CLI:** Use `gettext` or keep a simple dict-based approach.

6. **Parameterization:** Messages with dynamic values (N services, N seconds) use positional placeholders: `"Restored {0} services from backup."` — compatible with Android string resources, Chrome i18n `$1` syntax, and Python `.format()`.

### What NOT to Do Now

- Don't add an i18n framework. The overhead isn't justified until there's demand for a second language.
- Don't extract to separate files yet. Just use named constants so extraction is mechanical when needed.

---

## 6. Test Plan

### 6.1 Unit Tests

| Platform | What to Test | How |
|----------|-------------|-----|
| Android | Each `SyncResult`/`RestoreResult` variant maps to the correct message | Unit test the mapping function |
| Android | No message contains `${` or raw class names | Regex scan of all message constants |
| Extension | Each error path in popup.js uses a `MESSAGES.*` constant | Code review / lint rule |
| Python | `derive_password` raises `ValueError` with the exact expected text | Existing test suite covers this |

### 6.2 Integration Tests

| Scenario | Verification |
|----------|-------------|
| Android backup with wrong credentials | Snackbar shows "Couldn't verify your identity..." (not HTTP code) |
| Android restore with no backup | Snackbar shows "No backup exists..." |
| Android import with wrong key | Snackbar shows "Couldn't decrypt the file..." |
| Extension fill on page with no password field | Status shows "No password field found on this page..." |
| Extension fill on restricted page (chrome://) | Status shows "Couldn't fill the password..." (not raw Chrome error) |
| Server returns 429 | Client shows "Too many requests. Please wait N seconds..." |

### 6.3 Negative Tests (No Raw Exceptions)

For each platform, trigger every `catch` block and verify:
- The displayed message is from the predefined catalog
- No Java/Kotlin class names appear (e.g., `java.net.UnknownHostException`)
- No JavaScript error objects appear (e.g., `TypeError: ...`)
- No Python tracebacks appear

### 6.4 Manual QA Checklist

- [ ] Airplane mode → backup/restore → correct network error message
- [ ] Wrong email → restore → correct "no backup" or "auth failed" message
- [ ] Corrupt file → import → correct "couldn't read" message
- [ ] Extension on page without password fields → fill → correct message
- [ ] Server rate limited (simulate) → correct "too many requests" message
- [ ] All success messages display correctly and include counts where applicable
