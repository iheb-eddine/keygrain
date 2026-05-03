# Credential Manager Provider for Keygrain (Android 14+)

## Motivation

The existing `KeygrainAutofillService` (Android Autofill Framework) does not function on Xiaomi/MIUI devices. The Credential Manager API (`CredentialProviderService`) is the modern replacement that integrates into the system differently and works on devices where the legacy autofill framework is broken or unsupported.

## Frozen Requirements

1. The app MUST implement `CredentialProviderService` to serve password credentials via the Credential Manager API.
2. The provider MUST return matching credentials based on eTLD+1 comparison when a web origin is available.
3. The provider MUST return zero entries when no origin is available and the caller is not a known app with Digital Asset Links.
4. The provider MUST return zero entries when no master secret is stored (fresh install).
5. Password derivation MUST happen in Phase 2 (Activity), never in Phase 1 (service callback).
6. The existing `KeygrainAutofillService` MUST remain as a fallback for browsers that do not pass origin via the privileged caller mechanism.
7. The provider MUST declare only `TYPE_PASSWORD_CREDENTIAL` capability (no passkeys).
8. The provider MUST NOT implement credential saving (get-only).

## Invariants

1. **Derivation unchanged.** `Keygrain.derivePassword(secret, email, site, length, symbols, counter)` receives the exact stored `service.site`. No modification to derivation inputs.
2. **Existing autofill service kept.** Both services coexist. The system routes requests to whichever the user has enabled.
3. **Secret availability = credential availability.** If `SecretManager.getSecret()` returns null, the provider returns zero entries. No `AuthenticationAction` needed — there is no lock state.
4. **No stored credentials.** Keygrain derives passwords on-the-fly. The provider never stores or caches passwords.
5. **eTLD+1 matching logic reused.** The same `PublicSuffixList.extractRegistrableDomain()` used by the autofill service is reused here.

## Scope Boundary

### In Scope

- `KeygrainCredentialProvider.kt` — the `CredentialProviderService` implementation
- `CredentialSelectionActivity.kt` — Phase 2 activity that derives and returns the credential
- `res/xml/provider.xml` — capability declaration
- `AndroidManifest.xml` updates (service + activity declarations)
- `build.gradle.kts` dependency addition
- Design of matching logic for origin-based requests

### Out of Scope

- Credential saving/creation flow (`onBeginCreateCredentialRequest`)
- Passkey support
- Package-to-domain mapping for native apps
- Removal or modification of existing `KeygrainAutofillService`
- Changes to `ServiceManager`, `SecretManager`, or `Keygrain` core
- Digital Asset Links declaration (would require server-side `.well-known/assetlinks.json`)
- Sync protocol changes

## Architecture

### Two-Phase Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: onBeginGetCredentialRequest()                       │
│                                                              │
│  1. Check SecretManager.getSecret() != null                  │
│  2. Extract origin from CallingAppInfo.getOrigin()           │
│  3. If origin null → return empty (no match possible)        │
│  4. Parse origin URL → extract domain → eTLD+1              │
│  5. Match stored services by eTLD+1                          │
│  6. Return PasswordCredentialEntry per match                 │
│     (with PendingIntent → CredentialSelectionActivity)       │
└─────────────────────────────────────────────────────────────┘
                          │
                    User taps entry
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: CredentialSelectionActivity                          │
│                                                              │
│  1. Extract service info from intent extras                   │
│  2. Get secret from SecretManager                            │
│  3. Derive password: Keygrain.derivePassword(...)            │
│  4. Build PasswordCredential(email, password)                │
│  5. Return via PendingIntentHandler.setGetCredentialResponse │
└─────────────────────────────────────────────────────────────┘
```

### Origin Availability

| Caller Type | Origin Available? | Matching Strategy |
|-------------|-------------------|-------------------|
| Chrome | Yes (Google maintains DAL) | eTLD+1 match against origin |
| Firefox, Brave, others | Likely NO (no DAL to our provider) | Return empty; AutofillService handles these |
| Native apps | No (only package name) | Return empty |
| Apps with DAL to our provider | Yes | eTLD+1 match against origin |

**Key insight:** Credential Manager is additive, not a replacement. It provides value for:
- Chrome users (origin available)
- Xiaomi/MIUI devices where AutofillService is broken but Credential Manager works
- Future browsers that adopt the privileged caller mechanism

### Matching Logic (Phase 1)

```
// Filter for password credential options only
passwordOptions = request.beginGetCredentialOptions
    .filterIsInstance<BeginGetPasswordOption>()
if (passwordOptions.isEmpty()) → return empty response

origin = callingAppInfo.getOrigin()  // e.g., "https://accounts.google.com"
if (origin == null) → return empty response

domain = URL(origin).host            // e.g., "accounts.google.com"
normalized = ServiceManager.normalizeSite(domain)
visitedRegistrable = psl.extractRegistrableDomain(normalized)
if (visitedRegistrable == null) → return empty response

matches = serviceManager.getServices().filter {
    psl.extractRegistrableDomain(ServiceManager.normalizeSite(it.site)) == visitedRegistrable
}
```

This is identical to the existing autofill matching logic, just with origin URL instead of `webDomain`.

## File-by-File Design

### 1. `KeygrainCredentialProvider.kt`

**Location:** `kotlin/app/src/main/java/com/badrani/keygrain/data/KeygrainCredentialProvider.kt`

```kotlin
class KeygrainCredentialProvider : CredentialProviderService() {

    override fun onBeginGetCredentialRequest(
        request: BeginGetCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>
    ) {
        // 1. Check secret exists
        // 2. Extract origin from request.callingAppInfo?.getOrigin()
        // 3. If null → callback.onResult(empty response)
        // 4. Parse origin, extract eTLD+1, match services
        // 5. Build PasswordCredentialEntry per match
        //    - Each entry has a PendingIntent to CredentialSelectionActivity
        //    - Intent extras: service name, email, site, length, symbols, counter
        // 6. callback.onResult(response)
    }

    override fun onBeginCreateCredentialRequest(
        request: BeginCreateCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>
    ) {
        // Not supported — return empty response (no create entries)
        callback.onResult(BeginCreateCredentialResponse())
    }

    override fun onGetCredentialRequest(
        request: GetCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<GetCredentialResponse, GetCredentialException>
    ) {
        // Phase 2 is handled by CredentialSelectionActivity, not here.
        // This callback exists for the "single-entry" optimization path.
        // For simplicity, we always use the PendingIntent path (Activity).
        callback.onError(GetCredentialException(GetCredentialException.TYPE_NO_CREDENTIAL))
    }

    override fun onClearCredentialStateRequest(
        request: ProviderClearCredentialStateRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<Void?, ClearCredentialException>
    ) {
        // Nothing to clear — Keygrain has no cached credential state
        callback.onResult(null)
    }
}
```

**Key decisions:**
- `getOrigin()` may throw `SecurityException` if the caller is not privileged — catch and return empty.
- Each `PasswordCredentialEntry` displays: `"Keygrain — {service.name}"` with `username = service.email`.
- PendingIntent uses `FLAG_MUTABLE` (required for credential manager) with unique request codes per entry.

### 2. `CredentialSelectionActivity.kt`

**Location:** `kotlin/app/src/main/java/com/badrani/keygrain/data/CredentialSelectionActivity.kt`

```kotlin
class CredentialSelectionActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 1. Extract service params from intent extras
        val serviceName = intent.getStringExtra("service_name") ?: return fail()
        val email = intent.getStringExtra("email") ?: return fail()
        val site = intent.getStringExtra("site") ?: return fail()
        val length = intent.getIntExtra("length", 20)
        val symbols = intent.getStringExtra("symbols") ?: Keygrain.DEFAULT_SYMBOLS
        val counter = intent.getIntExtra("counter", 1)

        // 2. Get secret
        val secret = SecretManager(applicationContext).getSecret() ?: return fail()

        // 3. Derive password
        val password = Keygrain.derivePassword(
            secret = secret.toByteArray(),
            email = email,
            site = site,
            length = length,
            symbols = symbols,
            counter = counter
        )

        // 4. Return credential
        val credential = PasswordCredential(email, password)
        val response = GetCredentialResponse(credential)
        PendingIntentHandler.setGetCredentialResponse(this, response)
        setResult(RESULT_OK)
        finish()
    }

    private fun fail() {
        PendingIntentHandler.setGetCredentialException(
            this,
            GetCredentialException(GetCredentialException.TYPE_NO_CREDENTIAL)
        )
        setResult(RESULT_CANCELED)
        finish()
    }
}
```

**Key decisions:**
- No UI — the Activity derives and returns immediately. The user already selected the entry in the system credential picker.
- Argon2id derivation (~1s on modern devices, up to 3-5s on low-end) happens here. The Credential Manager framework has a timeout (typically 10-20s). Derivation is within budget on all reasonable devices, but this is a known constraint — if a device cannot complete Argon2id(64MiB, 3 iterations) within the framework timeout, the request will be cancelled.
- If secret becomes unavailable between Phase 1 and Phase 2 (edge case: user clears app data), return an error gracefully.

### 3. `res/xml/provider.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<credential-provider xmlns:android="http://schemas.android.com/apk/res/android">
    <capabilities>
        <capability name="android.credentials.TYPE_PASSWORD_CREDENTIAL" />
    </capabilities>
</credential-provider>
```

### 4. `AndroidManifest.xml` Changes

Add inside `<application>`:

```xml
<service
    android:name=".data.KeygrainCredentialProvider"
    android:exported="true"
    android:permission="android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE">
    <intent-filter>
        <action android:name="android.service.credentials.CredentialProviderService" />
    </intent-filter>
    <meta-data
        android:name="android.credentials.provider"
        android:resource="@xml/provider" />
</service>

<activity
    android:name=".data.CredentialSelectionActivity"
    android:exported="false"
    android:theme="@android:style/Theme.Translucent.NoTitleBar" />
```

**Notes:**
- `CredentialSelectionActivity` is NOT exported — only reachable via PendingIntent created by our own service.
- Translucent theme since the activity has no UI (derives and returns immediately).

### 5. `build.gradle.kts` Changes

Add to dependencies:

```kotlin
implementation("androidx.credentials:credentials:1.5.0")
```

**Version note:** The user referenced `1.7.0-alpha02`. The design targets the latest stable release at implementation time. As of this design, `1.5.0` is the reference version. The implementation should use whatever stable version is current. Key APIs used:
- `CredentialProviderService` (stable since 1.2.0)
- `PasswordCredentialEntry` (stable since 1.2.0)
- `PendingIntentHandler` (stable since 1.2.0)
- `PasswordCredential` (stable since 1.0.0)

If only alpha versions support required APIs, the design accepts alpha with the understanding that API surface may change.

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Malicious app requesting credentials | Origin is cryptographically verified by the system via Digital Asset Links. Only privileged callers (verified browsers) can pass origin. |
| PendingIntent tampering | PendingIntent uses `FLAG_MUTABLE` as required by the framework (system attaches `EXTRA_GET_CREDENTIAL_REQUEST`). Activity is not exported, limiting the attack surface. |
| Secret exposure in intent extras | Intent extras contain service metadata (name, site, email, length, symbols, counter) — NOT the secret. The secret is read from EncryptedSharedPreferences inside the Activity. |
| Derived password in memory | Password exists in memory only during the `GetCredentialResponse` construction. Same exposure as existing autofill service. |
| Race condition: secret cleared between Phase 1 and Phase 2 | Activity checks `getSecret()` and returns error if null. |

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Fresh install (no secret) | Phase 1 returns empty response (zero entries) |
| No matching services for origin | Phase 1 returns empty response |
| Origin is null (non-privileged caller) | Phase 1 returns empty response |
| `getOrigin()` throws SecurityException | Catch, return empty response |
| Multiple services match same eTLD+1 | One `PasswordCredentialEntry` per service; user picks in system UI |
| Origin is an IP address | Exact match only (same as autofill service) |
| Origin has port | Strip port before eTLD+1 extraction |
| User has both AutofillService and CredentialManager enabled | Both may fire; system deduplicates or shows both. No conflict. |

## Relationship to Existing AutofillService

```
┌─────────────────────────────────────────────────────────────┐
│ Browser with DAL (Chrome)                                    │
│   → Credential Manager (origin available) ✓                  │
│   → AutofillService (webDomain available) ✓                  │
│   Both work. System may prefer Credential Manager on 14+.    │
├─────────────────────────────────────────────────────────────┤
│ Browser without DAL (Firefox, Brave)                         │
│   → Credential Manager (origin NULL) ✗ returns empty         │
│   → AutofillService (webDomain available) ✓                  │
│   AutofillService is the only working path.                  │
├─────────────────────────────────────────────────────────────┤
│ Xiaomi/MIUI (AutofillService broken)                         │
│   → Credential Manager ✓ (if browser passes origin)          │
│   → AutofillService ✗ (MIUI blocks it)                       │
│   Credential Manager is the only working path.               │
├─────────────────────────────────────────────────────────────┤
│ Native apps (no origin, no webDomain)                        │
│   → Credential Manager ✗ (no origin)                         │
│   → AutofillService ✗ (no webDomain)                         │
│   Neither works. Out of scope.                               │
└─────────────────────────────────────────────────────────────┘
```

## Test Plan

### Unit Tests

| Test | Input | Expected |
|------|-------|----------|
| No secret stored | `getSecret()` returns null | `onBeginGetCredentialRequest` returns empty response |
| Origin is null | `callingAppInfo.getOrigin()` returns null | Returns empty response |
| `getOrigin()` throws SecurityException | Non-privileged caller | Caught, returns empty response |
| Origin matches one service | Origin `https://accounts.google.com`, stored service `google.com` | One `PasswordCredentialEntry` returned |
| Origin matches multiple services | Origin `https://google.com`, two services with eTLD+1 `google.com` | Two entries returned |
| Origin matches no services | Origin `https://unknown.com`, no stored services match | Empty response |
| IP address origin | Origin `https://192.168.1.1` | Exact match only |
| Origin with port | Origin `https://example.com:8443` | Port stripped, matches `example.com` services |

### Integration Tests (CredentialSelectionActivity)

| Test | Setup | Expected |
|------|-------|----------|
| Valid service extras | Intent with name/email/site/length/symbols/counter | Returns `PasswordCredential` with correct derived password |
| Missing extras | Intent missing required fields | Returns error via `PendingIntentHandler.setGetCredentialException` |
| Secret unavailable at Phase 2 | Secret cleared between Phase 1 and Phase 2 | Returns error gracefully |
| Derivation produces correct password | Known test vector | Password matches expected output |

### Manual Tests

| Test | Steps | Expected |
|------|-------|----------|
| Chrome fill on Pixel | Enable provider in Settings → visit stored site in Chrome → tap credential | Password filled correctly |
| Chrome fill on Xiaomi | Same as above on MIUI device | Password filled (validates the MIUI fix) |
| Firefox fallback | Visit stored site in Firefox | Credential Manager returns empty; AutofillService fills |
| Fresh install | No secret stored → visit any site | No credential entries shown |
| Multiple matches | Visit site with 2+ stored services sharing eTLD+1 | Both entries shown in picker |

### Regression Tests

| Test | Validates |
|------|-----------|
| Existing autofill service still works | AutofillService not broken by new code |
| Password derivation unchanged | Same inputs produce same outputs (test vectors) |
| Service matching unchanged | eTLD+1 logic produces same results as autofill service |
