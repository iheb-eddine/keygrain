# Bug Bounty Round 2 — Fix Designs

## Bug 1: CRITICAL — AAD Mismatch Android vs Extension

### Root Cause

Extension `sync.js` passes `lookupId` (UTF-8 encoded) as Additional Authenticated Data (AAD) to AES-GCM `encryptBlob`/`decryptBlob`. Android `SyncCrypto.kt` has no AAD parameter — its `encrypt`/`decrypt` never call `cipher.updateAAD()`.

Result: data encrypted by one platform cannot be decrypted by the other (GCM tag verification fails on AAD mismatch).

### Fix

**SyncCrypto.kt:**
- Add optional `aad: ByteArray? = null` parameter to `encrypt()` and `decrypt()`
- When non-null, call `cipher.updateAAD(aad)` before `doFinal()`

**SyncManager.kt:**
- Pass `lookupId.toByteArray(Charsets.UTF_8)` as AAD to both `SyncCrypto.encrypt()` and `SyncCrypto.decrypt()` in the sync flow
- On decrypt failure (`AEADBadTagException`), retry without AAD (migration fallback)

**Extension sync.js (regression fix):**
- Remove the `if (cachedMeta) throw new Error("aad_tamper_detected")` guard
- Always try no-AAD as fallback on decrypt failure
- Tamper detection relies on metadata integrity checks (order/timestamp validation), not AAD failure

AAD provides cryptographic binding (prevents blob relocation between accounts), not tamper detection.

### Files Changed

- `kotlin/app/src/main/java/com/badrani/keygrain/data/SyncCrypto.kt`
- `kotlin/app/src/main/java/com/badrani/keygrain/data/SyncManager.kt`
- `extension/shared/sync.js`

### Edge Cases

- **Migration:** Existing data encrypted without AAD must remain decryptable. The always-fallback-to-no-AAD pattern handles this on both platforms.
- **File export/import** in `MainScreen.kt` uses `SyncCrypto.encrypt`/`decrypt` without AAD — correct, since export is not tied to a lookupId. No change needed.
- **Transition period:** Both AAD and no-AAD data will coexist until all devices upgrade. The fallback ensures interop during this period.

---

## Bug 2: CRITICAL — Autofill Spoofing via WebView

### Root Cause

`KeygrainAutofillService.extractDomain()` trusts `node.webDomain` from `AssistStructure` without verifying the requesting app is a legitimate browser. A malicious app can embed a WebView loading any domain (e.g. `bank.com`), trigger autofill on a password field, and receive the real derived password.

### Fix

1. **Browser whitelist:** Maintain a list of verified browser package names in SharedPreferences with defaults: Chrome (`com.android.chrome`), Firefox (`org.mozilla.firefox`), Samsung Internet (`com.sec.android.app.sbrowser`), Brave (`com.brave.browser`), Edge (`com.microsoft.emmx`).
2. **In `onFillRequest`:** Get requesting app package from `request.fillContexts.last().structure.activityComponent.packageName`.
3. **Decision logic:**
   - If package is in verified browser list → fill normally (browsers enforce same-origin)
   - If package is NOT a verified browser but has a `webDomain` → show confirmation dialog: "App [package] wants to fill password for [domain]. Allow?"
   - If no `webDomain` (native app autofill) → fill normally (app identity verified by Android framework)
4. **User denies confirmation** → return `callback.onSuccess(null)`
5. **Whitelist is updatable** via app settings (SharedPreferences) so users can add trusted browsers without an app update.

### Files Changed

- `kotlin/app/src/main/java/com/badrani/keygrain/data/KeygrainAutofillService.kt`

### Edge Cases

- **Non-whitelisted browser:** User gets a confirmation prompt — safe, slightly less convenient.
- **Malicious app without WebView (native fields):** Android framework verifies package identity — safe.
- **Confirmation dialog UX:** Use `FillResponse.Builder().setAuthentication()` with an `IntentSender` to show the confirmation activity before filling.
- **User installs new browser:** Must add to whitelist in settings, or accept the confirmation prompt.

---

## Bug 3: HIGH — Master Secret Persists After Lock

### Root Cause

In `MainScreen.kt`, the `UnlockScreen` calls `secretManager.saveSecret(secret)` on every manual unlock. The `onLock` callback clears in-memory state (`masterSecret = ""`, `SecretManager.sessionActive = false`) but never calls `secretManager.clearSecret()`.

Result: the master secret remains in `EncryptedSharedPreferences` after lock. If the device is compromised while locked, the secret is extractable from the encrypted storage.

### Fix

The secret is persisted solely to enable biometric unlock. Tie persistence to biometric availability:

1. **On manual unlock (typing secret):** Only call `secretManager.saveSecret(secret)` if biometric hardware is available (`canUseBiometric(context)` returns true).
2. **On lock** (both manual and auto-lock timer): Call `secretManager.clearSecret()` unless biometric is available. If biometric is available, keep the stored secret (user implicitly consented to persistence by having biometric enabled).
3. **If biometric becomes unavailable** (hardware disabled, enrolled fingerprints removed): Secret is cleared on next lock.

### Files Changed

- `kotlin/app/src/main/java/com/badrani/keygrain/ui/screens/MainScreen.kt` (unlock button handler + `onLock` callback)

### Edge Cases

- **Biometric disabled after secret stored:** Next lock clears it. User must re-enter secret on next unlock.
- **App killed by OS while unlocked:** Secret remains in EncryptedSharedPreferences if biometric is enabled — acceptable since user opted in via biometric enrollment.
- **Auto-lock timer fires:** Same behavior as manual lock.
- **No migration needed:** Existing behavior was a bug. Users with biometric enabled keep current behavior. Users without biometric get the fix immediately.

---

## Bug 4: HIGH — First-PUT Race on Account Creation

### Analysis

**NOT A BUG.** The server correctly handles this scenario:

1. Per-lookupId mutex (`getLock(lookupID)` → `lock.Lock()`) serializes concurrent PUTs.
2. First PUT: acquires mutex, sees `isNew=true`, creates file, releases mutex.
3. Second PUT: acquires mutex, sees `isNew=false` (file exists), has no `If-Match` header → returns 409 conflict.
4. Client retries: GET current state → merge → PUT with `If-Match`.

Both the extension (`syncWithServer` retries on 409 with `retryCount < 1`) and Android (`SyncManager` retries on `ConflictError`) handle the 409 correctly.

### Verdict

Working as designed. The mutex + 409 pattern is the intended conflict resolution mechanism.

### Note

The in-memory mutex map (`locks map[string]*sync.Mutex`) is unbounded — a DoS could create unlimited entries. This is a separate concern (not the reported bug) and should be tracked independently.

---

## Bug 5: HIGH — SSH authorized_keys Injection via Email

### Root Cause

`format_authorized_keys()` (Python, Kotlin, JS) constructs output as:
```
ssh-ed25519 <base64> <comment>
```
where `comment = f"{email.lower()}:{key_name.lower()}"`. If the email contains newlines (`\n`, `\r`), the output contains extra lines interpretable as additional authorized_keys entries.

`key_name` is validated (no whitespace), but `email` is not validated for control characters.

Same issue exists in `format_openssh_private_key()` — a newline in the comment could corrupt the PEM structure.

### Fix

1. **In `derive_ssh_keypair` (all 3 implementations):** Validate email contains no ASCII control characters. Reject with error if `email` matches `[\x00-\x1f\x7f]`.
2. **In `format_authorized_keys` (all 3 implementations):** Validate `comment` contains no control characters. Raise/throw error if invalid.
3. **In `format_openssh_private_key` (Python):** Same validation on `comment` parameter.

Validation: reject (throw error), do NOT silently strip — silent stripping could cause key derivation to produce different results than expected.

### Files Changed

- `python/keygrain/ssh.py` — `derive_ssh_keypair()`, `format_authorized_keys()`, `format_openssh_private_key()`
- `kotlin/app/src/main/java/com/badrani/keygrain/data/SshEngine.kt` — `deriveSshKeypair()`, `formatAuthorizedKeys()`
- `extension/shared/ssh.js` — `deriveSshKeypair()`, `formatAuthorizedKeys()`

### Edge Cases

- **Legitimate emails:** ASCII control chars are never valid in email addresses (RFC 5321). No legitimate user is affected.
- **Null bytes:** Could cause truncation in C-based SSH implementations — covered by the control char check.
- **Spaces in email:** Valid in quoted local-parts but extremely rare. The `email:keyname` format won't have unquoted spaces since keyname is already validated. Email spaces within the comment field are harmless in authorized_keys (comment extends to end of line).
- **Unicode:** Non-ASCII characters (UTF-8) are fine — only ASCII control chars (0x00-0x1F, 0x7F) are dangerous.
