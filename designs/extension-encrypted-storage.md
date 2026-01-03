# Design: Encrypted Local Storage & Email-on-Unlock

## 1. Overview

Two security improvements for the keygrain browser extension:

1. **Email on unlock** — The unlock screen requires both master secret and email. Email serves as identity for backup and as input to the local encryption key. This eliminates the separate email prompt for backup/restore operations.

2. **Encrypted local storage** — The service list in `chrome.storage.local` is encrypted with AES-256-GCM using a key derived from `secret + email`. Without the correct credentials, stored data is unreadable.

### Security rationale

Currently, anyone with access to the browser profile can read the service list (names, emails, derivation parameters). While this doesn't expose passwords (those require the master secret), it leaks metadata about which services the user has accounts with. Encryption eliminates this leak.

### Tradeoff: single-identity lock-in

By tying backup/restore to the unlock email, users can no longer use different emails for different backup identities from the same extension instance. This is an intentional simplification — the common case is one identity per device. Users needing multiple identities can use separate browser profiles.

---

## 2. Unlock Flow Changes

### UI changes (popup.html)

Add an email input field above the secret field on the lock screen:

```
┌─────────────────────────────┐
│       🔑 Keygrain           │
│                             │
│  Email                      │
│  ┌───────────────────────┐  │
│  │ user@example.com      │  │
│  └───────────────────────┘  │
│  Master Secret              │
│  ┌───────────────────────┐  │
│  │ ••••••••••            │  │
│  └───────────────────────┘  │
│  [● ● ● ●] fingerprint     │
│  ┌───────────────────────┐  │
│  │       Unlock          │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

- Email field: `type="email"`, `id="email"`, `autocomplete="email"`, required
- Unlock button enabled only when both email and secret are non-empty
- Email is pre-filled from `chrome.storage.local` key `"lastEmail"` (not secret — just convenience)
- On successful unlock, `lastEmail` is updated in `chrome.storage.local`

### State management

On unlock:
1. Normalize email to lowercase
2. Store secret in session storage (existing mechanism)
3. Store email in session storage (new — same mechanism as secret)
4. Attempt to decrypt local storage (see §3)
5. If decryption succeeds → show main screen
6. If decryption fails → show error "Wrong secret or email", remain on lock screen

### Background.js changes

**Chrome (MV3):**
```
getEmail / setEmail / clearEmail → chrome.storage.session
```

**Firefox (MV2):**
```
let sessionEmail = null;  // alongside sessionSecret
```

On lock: clear both secret and email from session.

---

## 3. Local Encryption Scheme

### Key derivation

```
storageKey = HMAC-SHA256(
  key:     secret (as UTF-8 bytes),
  message: lowercase(email) + ":keygrain-local-storage" (as UTF-8 bytes)
)
```

This produces a 32-byte (256-bit) key suitable for AES-256-GCM.

The domain separator `:keygrain-local-storage` ensures this key is distinct from the backup encryption key (`:keygrain-encryption`) and lookup ID (`:keygrain-id`).

### Encryption

- Algorithm: AES-256-GCM
- IV: 12 bytes, cryptographically random (`crypto.getRandomValues`)
- Plaintext: UTF-8 encoded JSON string of `{version: 1, services: [...]}`
- AAD (Additional Authenticated Data): UTF-8 encoded `lowercase(email)`

Using email as AAD provides defense-in-depth: even if an attacker somehow obtains the storage key, copying the encrypted blob to a different profile (with a different email in AAD) will cause authentication failure.

### Storage format

The encrypted data is stored in `chrome.storage.local` under the key `"services"`:

```json
{
  "version": 2,
  "iv": "<base64-encoded 12-byte IV>",
  "ciphertext": "<base64-encoded ciphertext + GCM tag>"
}
```

- `version: 2` distinguishes encrypted format from the legacy `version: 1` plaintext format
- Base64 encoding is required because `chrome.storage.local` only stores JSON-serializable values

### Encrypt/save flow (on add/delete service)

1. Serialize services array to JSON: `JSON.stringify({version: 1, services})`
2. Derive `storageKey` from current session secret + email
3. Generate random 12-byte IV
4. Encrypt with AES-256-GCM, AAD = `lowercase(email)`
5. Store `{version: 2, iv: base64(iv), ciphertext: base64(ciphertext)}` to `chrome.storage.local`
6. Zero the `storageKey` buffer

### Decrypt/load flow (on unlock)

1. Read `"services"` from `chrome.storage.local`
2. If absent → empty service list (new install)
3. If `version === 1` → migration path (see §4)
4. If `version === 2`:
   a. Derive `storageKey` from entered secret + email
   b. Decode base64 IV and ciphertext
   c. Decrypt with AES-256-GCM, AAD = `lowercase(email)`
   d. If decryption fails (DOMException) → wrong credentials, show error
   e. If success → parse JSON, load services
   f. Zero the `storageKey` buffer

### Key zeroing

The `storageKey` ArrayBuffer is filled with zeros after each encrypt/decrypt operation. It is never stored — only derived on demand from session secret + email.

---

## 4. Migration: Unencrypted → Encrypted

### Scenario

Existing users upgrading the extension have plaintext `{version: 1, services: [...]}` in `chrome.storage.local`. On first unlock after update:

### Flow

1. User enters email + secret on the new unlock screen
2. Extension reads `chrome.storage.local["services"]`
3. Detects `version === 1` (plaintext format)
4. Loads services directly from the plaintext JSON (no decryption needed)
5. Immediately re-encrypts with the derived `storageKey` and saves as `version: 2`
6. Shows main screen with services

### Properties

- **Transparent:** No user prompt or action required beyond the normal unlock
- **One-time:** After migration, data is always version 2
- **Any email works:** Since the plaintext isn't tied to any email, the user can choose any email on first unlock. That email becomes the encryption identity going forward.
- **No rollback:** Once encrypted, downgrading the extension would lose access to services (acceptable — users should backup before downgrading)
- **Version-downgrade protection:** The migration path validates that v1 data parses as valid JSON with a `services` array before accepting it. Ciphertext bytes cannot pass this validation, so an attacker tampering with the version field (changing 2→1) cannot trick the extension into misinterpreting encrypted data as plaintext.

---

## 5. Backup/Restore Simplification

### Current flow

1. User clicks Backup/Restore/Export
2. Email prompt dialog appears
3. User enters email
4. Operation proceeds

### New flow

1. User clicks Backup/Restore/Export
2. Operation proceeds immediately using the email from session state

### Changes

- **Remove the email prompt dialog** (`#email-dialog`) from backup/restore/export flows
- **Import flow:** The import page (`import.html`) can retrieve email from session storage via the background script (same as it currently retrieves `importEmail`, but now using the standard `getEmail` action)
- **`promptEmail()` function:** Removed entirely — no longer needed
- **Backup/restore functions** receive email from `getEmail()` session call instead of user input

### Consistency guarantee

The email used for local encryption is the same email used for backup identity. This means:
- Restoring from backup always uses the correct decryption key
- No mismatch between local encryption identity and backup identity

---

## 6. Cross-Browser Considerations

| Aspect | Chrome (MV3) | Firefox (MV2) |
|--------|-------------|---------------|
| Session storage for email | `chrome.storage.session` | In-memory variable in background page |
| Session lifetime | Until service worker terminates (idle timeout) | Until browser closes |
| Web Crypto API | Available in service worker + popup | Available in background page + popup |
| `chrome.storage.local` | Available | Available (via `browser.storage.local`) |
| Base64 encoding | `btoa`/`atob` on strings; manual for ArrayBuffer | Same |

### Shared code

All encryption/decryption logic lives in `shared/` files (e.g., a new `storage-crypto.js` or inline in `popup.js`). No browser-specific crypto code needed — both platforms support the same Web Crypto API.

### Firefox session persistence

Firefox's in-memory variables persist as long as the background page is alive (until browser close). This is actually more reliable than Chrome's service worker which may terminate on idle. No special handling needed.

### ArrayBuffer ↔ Base64

Both platforms need a utility for converting between ArrayBuffer and base64 strings for storage. A simple implementation using `Uint8Array` + character codes works cross-platform without dependencies.

---

## 7. Edge Cases

### Wrong credentials

- **Detection:** AES-GCM decryption throws `DOMException` (operation error) when the authentication tag doesn't match
- **UX:** Show "Wrong secret or email. Please try again." on the lock screen. Do not reveal which credential is wrong.
- **No data exposure:** Wrong credentials never produce decrypted output — GCM guarantees this

### Empty storage (new install)

- No `"services"` key in `chrome.storage.local`
- Unlock succeeds (no decryption needed)
- Empty service list shown
- First service addition triggers encryption and creates the version 2 blob

### Corrupted data

- Base64 decode fails, or ciphertext is truncated/modified
- Same error path as wrong credentials: catch the exception, show error
- Offer "Reset local data and restore from backup?" as a recovery option
- This is a new UI element (confirmation dialog) shown only on corruption detection

### Email change

If a user wants to switch from email A to email B:

1. Lock the extension
2. Unlock with the OLD email (A) + secret → decrypts successfully
3. Export/backup with email A (automatic, since it's the session email)
4. Lock again
5. Unlock with NEW email (B) + secret → decryption fails (encrypted with A's key)
6. User must restore from backup (which re-downloads and re-encrypts with B's key)

**Alternative (simpler UX):** Provide a "Change email" option in the menu that:
1. Decrypts with current credentials
2. Re-encrypts with new email
3. Updates session email

**Design decision:** Implement the "Change email" menu option. The lock/restore path is too cumbersome for a common operation. The menu option keeps data local and doesn't require a server round-trip.

**Note:** After changing email locally, the server backup remains keyed to the old email's lookup ID. The next backup operation will automatically use the new session email, creating a new server-side record under the new lookup ID. The old backup remains on the server (orphaned but harmless — encrypted and inaccessible without the old credentials).

### Concurrent access

- Browser extensions don't have concurrent popup instances
- `chrome.storage.local.set` is atomic per call
- No locking needed

### Service worker termination (Chrome)

- If the service worker terminates, session storage is cleared
- User must re-enter credentials on next popup open
- This is existing behavior for the secret; email follows the same pattern
- The encrypted blob in `chrome.storage.local` persists regardless

### Very large service lists

- AES-GCM has a practical limit of ~64 GB per encryption — not a concern
- JSON serialization of thousands of services is still fast
- No chunking needed

---

## 8. Test Plan

### Unit tests (key derivation)

| Test | Input | Expected |
|------|-------|----------|
| Deterministic key | secret="test", email="User@Example.com" | Same 32-byte key every time (email normalized to lowercase) |
| Different email → different key | Same secret, different emails | Different keys |
| Different secret → different key | Same email, different secrets | Different keys |
| Domain separation | Compare with `:keygrain-encryption` key | Different keys |

### Unit tests (encrypt/decrypt)

| Test | Scenario | Expected |
|------|----------|----------|
| Round-trip | Encrypt then decrypt with same key + AAD | Original plaintext recovered |
| Wrong key | Decrypt with different key | DOMException thrown |
| Wrong AAD | Decrypt with correct key but wrong email as AAD | DOMException thrown |
| Random IV | Two encryptions of same plaintext | Different ciphertexts (different IVs) |
| Empty plaintext | Encrypt empty services array | Valid ciphertext, decrypts to `[]` |

### Integration tests (migration)

| Test | Scenario | Expected |
|------|----------|----------|
| v1 → v2 migration | Store plaintext v1, unlock with any email | Services loaded, storage re-written as v2 |
| Post-migration unlock | After migration, lock and re-unlock with same credentials | Decryption succeeds |
| Post-migration wrong creds | After migration, lock and unlock with different email | Decryption fails |

### Integration tests (unlock flow)

| Test | Scenario | Expected |
|------|----------|----------|
| Both fields required | Empty email or empty secret | Unlock button disabled |
| Email pre-fill | Previous email stored in `lastEmail` | Email field pre-populated |
| Email normalization | Enter "User@EXAMPLE.com" | Stored/used as "user@example.com" |
| Successful unlock | Correct credentials | Main screen shown with services |
| Failed unlock | Wrong credentials | Error message, stays on lock screen |

### Integration tests (backup/restore)

| Test | Scenario | Expected |
|------|----------|----------|
| Backup without prompt | Click backup after unlock | Backup proceeds with session email, no dialog |
| Restore without prompt | Click restore after unlock | Restore proceeds with session email, no dialog |
| Restore re-encrypts | Restore from server | Services decrypted from server, re-encrypted locally with session key |

### Integration tests (email change)

| Test | Scenario | Expected |
|------|----------|----------|
| Change email | Use "Change email" menu option | Services re-encrypted with new key, session updated |
| Unlock after change | Lock and re-unlock with new email | Decryption succeeds |
| Old email after change | Lock and try old email | Decryption fails |

### Manual/exploratory tests

- Extension update from current version (plaintext) → new version (encrypted): verify migration
- Firefox: close and reopen browser → must re-enter credentials (session cleared)
- Chrome: wait for service worker idle termination → must re-enter credentials
- Large service list (100+ entries): verify no performance degradation on encrypt/decrypt
- Corrupted storage: manually edit `chrome.storage.local` → verify error handling
