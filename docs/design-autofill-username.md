# Design: Autofill Username + Password

## 1. Overview

Extend the browser extension's fill flow to autofill both the username/email field and the password field. Currently, the extension only fills the password. Each service already stores an `email` field — this is the username value to fill.

The content script will detect the username field on the page, fill it with the service's email, then fill the password field. If no username field is found, it degrades to password-only fill (current behavior).

## 2. Username Field Detection Strategy

Add `findUsernameField(scopeElement)` in `content.js`. It searches for visible input fields using a priority-ordered selector list:

1. `input[autocomplete="username"]`
2. `input[autocomplete="email"]`
3. `input[type="email"]`
4. `input[type="text"][name*="user" i]`
5. `input[type="text"][name*="email" i]`
6. `input[type="text"][name*="login" i]`
7. `input[type="text"][id*="user" i]`
8. `input[type="text"][id*="email" i]`
9. `input[type="text"][id*="login" i]`

**Visibility check:** Each candidate must have `offsetParent !== null`, `offsetWidth > 0`, and not be `disabled`.

**Scoping strategy:**

1. If a password field is found, get its closest `<form>` ancestor.
2. Search within that form first.
3. If no username field found within the form (or no form exists), fall back to document-wide search.

This handles sites that place the username input outside the `<form>` tag.

### Shadow DOM (Known Limitation)

`querySelectorAll` cannot pierce shadow DOM boundaries. Login fields inside shadow roots (some banking sites, Salesforce) will not be detected. Users should fall back to Copy for these sites. Open shadow root traversal may be added in a future version. Closed shadow roots are inaccessible regardless.

## 3. Fill Sequence

1. Find password field (existing `findPasswordField()` logic).
2. Determine scope element (password field's form ancestor, or `document`).
3. Find username field within scope, with document-wide fallback.
4. If username field found: fill it with `email` using existing `fillField()`.
5. If password field found: fill it with derived password using existing `fillField()`.
6. Username is filled first because some sites enable the password field only after username input.

The content script always attempts to find both fields independently. It fills whatever it finds and reports what was filled.

## 4. Edge Cases

| Case | Behavior |
|------|----------|
| No username field found | Fill password only (no error) |
| No password field found, username found | Fill username only, return `filled: "username_only"` |
| Neither field found | Return error: "No fillable fields found." |
| Multiple forms on page | Scope to the form containing the password field |
| Username outside form tag | Form-scoped search fails, document-wide fallback finds it |
| 2-step login (username page 1, password page 2) | Each invocation fills whatever fields are present on the current page. No new action type needed — the popup always sends both email and password, content script fills what it can find. |
| Hidden/disabled fields | Skipped by visibility check |

## 5. Message Passing (popup → content script)

### Fill action

**Current message:** `{action: "fill", password: pw}`

**New message:** `{action: "fill", password: pw, email: svc.email}`

**Response (new):**
- `{success: true, filled: "both"}` — both fields filled
- `{success: true, filled: "password_only"}` — only password filled (no username field found)
- `{success: true, filled: "username_only"}` — only username filled (2-step login page)
- `{success: false, error: "No fillable fields found."}` — neither field found

### Context menu fill

**New message:** `{action: "fillContextMenu", password: pw, email: svc.email}`

**Behavior:**
- If user right-clicked a `type="password"` input: fill it with password (existing behavior).
- If user right-clicked any other input: fill it with email (treat as username field).
- If user right-clicked a non-input element: fall back to `findPasswordField()` and fill password only. No username fallback — filling a username from a random right-click would be confusing.

### popup.js change

In `handleFill(svc)`, change the message from:
```js
{action: "fill", password: pw}
```
to:
```js
{action: "fill", password: pw, email: svc.email}
```

Status message can reflect the `filled` value:
- `"both"` → "Credentials filled."
- `"password_only"` → "Password filled."
- `"username_only"` → "Username filled."
