# Autofill Email/Username + Password Field Detection

## Frozen Requirements

1. The autofill service MUST detect email/username fields in addition to password fields.
2. The autofill popup MUST appear when the user focuses an email/username field, even if no password field is present on the page (Google step 1: email-only).
3. The autofill popup MUST continue to appear when the user focuses a password field, even if no email/username field is present (Google step 2: password-only).
4. When both field types are present, a single dataset MUST fill both: email into username nodes, password into password nodes.
5. The email value filled into username fields MUST come from the stored `ServiceEntry.email`.
6. Detection priority MUST be: autofillHints > inputType > htmlInfo heuristic.
7. A node that matches password heuristics MUST be classified as password only, never as both username and password.
8. The derivation layer MUST remain unchanged — `Keygrain.derivePassword` receives the same arguments as before.

## Invariants

1. **Derivation unchanged.** The password derivation call signature and inputs are not modified.
2. **Email source is ServiceEntry.email.** The value filled into username/email fields is always the stored email from the matching service entry — never derived, never guessed.
3. **User confirmation required.** Android autofill requires the user to tap the popup to trigger fill. False-positive field detection results in a wrong field being filled only after explicit user action.
4. **Existing password-only behavior preserved.** Pages with only password fields continue to work exactly as before.
5. **Single file change.** Only `KeygrainAutofillService.kt` is modified.

## Scope Boundary

### In Scope

- Add `findUsernameNodes` function to detect email/username fields
- Modify `onFillRequest` to collect both username and password nodes
- Modify dataset construction to set email values on username nodes and password values on password nodes
- Handle three scenarios: username-only, password-only, both

### Out of Scope

- Derivation algorithm changes
- New files or classes
- Sync protocol changes
- UI changes to the main app
- Save/update credential prompts
- App-based (non-browser) autofill matching

## Design

### Field Detection

#### Password Nodes (existing logic, unchanged)

A node is a password node if:
- `autofillHints` contains "password" or `AUTOFILL_HINT_PASSWORD` (case-insensitive), OR
- `inputType` includes `TYPE_TEXT_VARIATION_PASSWORD`, OR
- `inputType` is `TYPE_CLASS_NUMBER` with `TYPE_NUMBER_VARIATION_PASSWORD`

#### Username/Email Nodes (new)

A node is a username node if it is NOT already classified as a password node, AND any of the following (in priority order):

1. **autofillHints** contains (case-insensitive): "username", "emailAddress", `AUTOFILL_HINT_USERNAME`, `AUTOFILL_HINT_EMAIL_ADDRESS`
2. **inputType** includes: `TYPE_TEXT_VARIATION_EMAIL_ADDRESS` or `TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS`
3. **htmlInfo heuristic** (fallback only — used when hints and inputType don't match):
   - `htmlInfo.tag` is "input" AND:
     - attribute `type` equals "email", OR
     - attribute `name` or `id` contains "email", "user", or "login" (case-insensitive substring match)

Priority ordering ensures a node is never double-counted. If autofillHints match, inputType and htmlInfo are not checked. If inputType matches, htmlInfo is not checked.

#### Password-takes-precedence rule

If a node matches BOTH password and username heuristics (unlikely but possible, e.g., `autofillHints=["password"]` with `inputType=TYPE_TEXT_VARIATION_EMAIL_ADDRESS`), it is classified as password only. The password check runs first; username check explicitly skips nodes already in the password list.

### Modified `onFillRequest` Flow

```
1. Extract domain, validate browser, match services (unchanged)
2. Collect passwordNodes (existing findPasswordNodes, renamed or kept)
3. Collect usernameNodes (new findUsernameNodes)
4. If BOTH lists empty → callback.onSuccess(null), return
5. For each matching service:
   a. Derive password (unchanged)
   b. Build presentation (unchanged)
   c. Create Dataset.Builder
   d. For each usernameNode: setValue(node.id, AutofillValue.forText(service.email), presentation)
   e. For each passwordNode: setValue(node.id, AutofillValue.forText(password), presentation)
   f. Add dataset to response
6. callback.onSuccess(response)
```

Key change at step 4: the old code returned null if `passwordNodes.isEmpty()`. The new code returns null only if BOTH lists are empty.

### Dataset Behavior

Android shows the autofill popup when ANY `AutofillId` in the dataset is focused. By including both username and password node IDs in a single dataset:
- Focusing the email field → popup appears → tap fills email AND password (if password field exists)
- Focusing the password field → popup appears → tap fills password AND email (if email field exists)
- On a page with only email (Google step 1) → popup appears on email field → fills email
- On a page with only password (Google step 2) → popup appears on password field → fills password

### Implementation Structure

Rename `findPasswordNodes` to keep it focused on passwords. Add a new `findUsernameNodes` with the same traversal pattern. Both populate separate lists from the same view tree.

```kotlin
private fun findUsernameNodes(node: AssistStructure.ViewNode, results: MutableList<AutofillNodeInfo>, excludeIds: Set<AutofillId>) {
    // Skip nodes already classified as password
    // Check autofillHints → inputType → htmlInfo (priority order)
}
```

The `excludeIds` parameter receives the set of password node IDs to enforce the password-takes-precedence rule.

### Attack Surface

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| False positive: search field matched by htmlInfo "user_query" | Low-medium | Low — user must tap popup to fill | htmlInfo is fallback only; most modern apps set autofillHints correctly |
| Newsletter email field on same page as login | Low | Low — fills stored email into newsletter field after user tap | Acceptable: user sees what will be filled in the popup label |
| Over-broad htmlInfo substring match | Medium | Low — wrong field gets email value | Substring list is conservative: "email", "user", "login" |
| Email leaked to non-login field | Low | Minimal — it's the user's own email, not a secret | No secret data exposed; password only goes to password-typed fields |

## Test Plan

### Manual Test Scenarios

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Google two-step: email page | Navigate to accounts.google.com → email field focused | Popup appears with matching service, fills email |
| 2 | Google two-step: password page | After email submitted → password field focused | Popup appears, fills password |
| 3 | Combined login form (e.g., GitHub) | Page with both email and password fields | Popup appears on either field, fills both on tap |
| 4 | No matching service | Visit a site with no stored service | No popup on any field |
| 5 | No autofillable fields | Page with only search/text fields (no hints, no email inputType) | No popup |
| 6 | Multiple matching services | Site with two stored entries | Both appear in popup picker |
| 7 | Password-only page (existing behavior) | Page with only a password field, no username field | Popup appears on password field (regression check) |
| 8 | htmlInfo fallback | Page where email field has no autofillHints but has `<input type="email">` | Popup appears on email field |

### Unit Test Cases

| Test | Input | Expected |
|------|-------|----------|
| Username hint detection | Node with `autofillHints=["username"]` | Classified as username node |
| Email hint detection | Node with `autofillHints=["emailAddress"]` | Classified as username node |
| Email inputType detection | Node with `inputType=TYPE_TEXT_VARIATION_EMAIL_ADDRESS` | Classified as username node |
| htmlInfo type=email | Node with `htmlInfo` tag "input", attribute type="email" | Classified as username node |
| htmlInfo name contains "user" | Node with `htmlInfo` attribute name="username_field" | Classified as username node |
| htmlInfo name contains "login" | Node with `htmlInfo` attribute name="login_email" | Classified as username node |
| Password takes precedence | Node with `autofillHints=["password"]` and `inputType=TYPE_TEXT_VARIATION_EMAIL_ADDRESS` | Classified as password, NOT username |
| No match | Node with `autofillHints=["search"]`, `inputType=TYPE_CLASS_TEXT` | Not classified as either |
| Priority: hints over inputType | Node with `autofillHints=["username"]` and `inputType=TYPE_CLASS_TEXT` | Classified as username (via hints, inputType not needed) |
| Exclude password IDs | Node already in password list | Skipped by findUsernameNodes |

### Integration Test: Dataset Construction

| Username Nodes | Password Nodes | Expected Dataset |
|----------------|---------------|-----------------|
| [emailField] | [passField] | setValue(emailField, email), setValue(passField, password) |
| [emailField] | [] | setValue(emailField, email) only |
| [] | [passField] | setValue(passField, password) only |
| [] | [] | No dataset built, return null |
| [field1, field2] | [passField] | setValue(field1, email), setValue(field2, email), setValue(passField, password) |
