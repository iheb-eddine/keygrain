# Diagnosis: Autofill Not Triggering on accounts.google.com in Chrome

## Symptoms
- Keygrain selected as autofill provider in Android settings
- Two Google services saved (google.com and accounts.google.com)
- App is unlocked
- Testing in Chrome incognito on accounts.google.com
- No Keygrain popup appears

## Root Cause

**The service only fills password fields, and Google's login is a two-step SPA.**

### Step 1 (Email page): Expected failure
- `onFillRequest` fires → service traverses AssistStructure → finds no password-type nodes → `passwordNodes.isEmpty()` → returns null → no popup
- This is correct behavior given the current implementation — there is no password field on this page

### Step 2 (Password page): Chrome may not re-trigger onFillRequest
- Google's login is a Single Page Application — the URL stays `accounts.google.com` and the DOM mutates via JavaScript
- Chrome's behavior on SPA DOM mutations is inconsistent: it may or may not call `notifyViewsAppeared` to trigger a new `onFillRequest`
- Chrome has special native handling for Google's own login flow (same company) — third-party autofill services may not receive the same re-trigger treatment
- **If** `onFillRequest` does fire on the password step, the service SHOULD work (password field detected, domain matches, services match)

### Contributing Factors

1. **No logging**: The service has zero diagnostic logging. Combined with `catch (_: Exception) { callback.onSuccess(null) }`, all failures are invisible.
2. **No username autofill**: The service only fills password fields. Even if it triggered on the email step, it would have nothing to fill.
3. **Minimal autofill service config**: `autofill_service_config.xml` only declares a settings activity. No additional configuration to improve Chrome integration.

## Failure Points Ruled Out

| # | Failure Point | Ruled Out Because |
|---|---|---|
| 1 | `getSecret()` null | App is unlocked; EncryptedSharedPreferences works from Service context via applicationContext |
| 2 | `extractDomain()` null | Chrome exposes webDomain to autofill framework regardless of incognito mode (OS-level) |
| 3 | Trusted browser check | "com.android.chrome" is in DEFAULT_BROWSER_PACKAGES |
| 4 | domain empty | Follows from #2 |
| 5 | PSL returns null | "accounts.google.com" → registrable domain "google.com" — standard case |
| 6 | No matches | User has google.com and accounts.google.com saved; both yield registrable domain "google.com" |

## Recommendations

### Immediate (diagnostic)
1. Add `Log.d("KeygrainAutofill", ...)` at each early-return point
2. Log the exception in the catch block: `Log.e("KeygrainAutofill", "onFillRequest failed", e)`
3. Test with `adb shell settings put global autofill_logging_level verbose` to see framework-level logs

### Short-term (fix)
1. **Verify**: Does `onFillRequest` fire on Google's password step? Add logging and test manually.
2. **If it fires**: The password step should already work. The issue is only the email step (no username support).
3. **If it does NOT fire**: This is a Chrome/framework limitation. The framework sets `FLAG_COMPATIBILITY_MODE_REQUEST` on its own for apps that don't use autofill APIs natively — the service cannot request it. Workaround: use an AccessibilityService to detect password fields appearing via DOM mutation and trigger autofill manually via `AutofillManager.requestAutofill()`.

### Medium-term (feature)
1. Add username/email field detection and filling (the service currently ignores non-password fields entirely)
2. This would allow the popup to appear on the email step of two-step logins
