# PSL-Aware eTLD+1 Autofill Domain Matching

## Frozen Requirements

1. Autofill matching MUST use eTLD+1 comparison: a stored service matches a visited domain iff `extractRegistrableDomain(service.site) == extractRegistrableDomain(webDomain)`.
2. Password derivation MUST always use the exact stored `service.site` value — unchanged, unmodified.
3. The Public Suffix List MUST be bundled with the app as an asset file (`assets/public_suffix_list.dat`).
4. When multiple services match the same eTLD+1, all MUST appear as autofill dataset options (disambiguation list).
5. The add-service flow MUST default the site field to the eTLD+1 of a clipboard-detected URL.
6. The user MUST be able to override the defaulted site to keep a full subdomain.
7. IP addresses and `localhost` MUST match exactly (no eTLD+1 extraction).
8. Domains MUST be normalized to punycode (ASCII) via `java.net.IDN.toASCII()` before PSL lookup.
9. Ports MUST be stripped before eTLD+1 extraction.

## Invariants

1. **Derivation never changes.** `Keygrain.derivePassword(secret, email, site, length, symbols, counter)` always receives the exact stored `service.site`. The eTLD+1 extraction is used ONLY for candidate matching.
2. **Existing entries are never modified.** This change does not migrate, rename, or alter any stored `service.site` values.
3. **PSL is read-only at runtime.** The bundled file is never written to or modified by the app.
4. **Matching is symmetric.** If domain A matches domain B, then B matches A (both reduce to the same eTLD+1).
5. **Unknown TLDs are safe.** If a domain's TLD is not in the PSL, the last label is treated as the TLD. This prevents over-matching (e.g., `internal.corp` → registrable domain is `internal.corp`, not `corp`).

## Scope Boundary

### In Scope

- New class: `PublicSuffixList` — loads and parses the PSL, exposes `extractRegistrableDomain(domain): String?`
- Modify `KeygrainAutofillService.onFillRequest`: replace exact `normalizeSite` comparison with eTLD+1 comparison
- Modify add-service FAB in `MainScreen.kt`: default site to eTLD+1, show explanatory hint
- Bundle `public_suffix_list.dat` in `assets/`
- Unit tests for PSL parsing and eTLD+1 extraction
- Integration tests for autofill matching with subdomains

### Out of Scope

- PSL auto-update mechanism (updates ship with app releases)
- Changes to the derivation algorithm
- Migration of existing stored service entries
- App-based (non-browser) autofill matching (package name matching)
- Sync protocol changes
- UI for managing per-service subdomain matching preferences

## PSL Handling Approach

### Source

Mozilla's Public Suffix List: https://publicsuffix.org/list/public_suffix_list.dat

Bundled as `assets/public_suffix_list.dat` (~200KB). Updated with each app release.

### Update Strategy

**Update on app release only.** Rationale:
- PSL changes are rarely security-critical for matching purposes
- A stale PSL means some newly-delegated TLDs fall back to the "unknown TLD" heuristic (treat last label as TLD), which is safe — it prevents over-matching, never enables it
- No network dependency, no background fetch, no storage for downloaded updates
- Simplest approach with acceptable trade-offs

### Parsing

The PSL format:
- Lines starting with `//` are comments → skip
- Empty lines → skip
- Lines starting with `*.` are wildcard rules (e.g., `*.ck`)
- Lines starting with `!` are exceptions to wildcards (e.g., `!www.ck`)
- All other lines are exact public suffix entries (e.g., `com`, `co.uk`, `github.io`)

### Data Structure

Reversed-label trie. Each domain is split into labels, reversed, and inserted into the trie.

Example: `co.uk` → labels `["uk", "co"]` → trie path `uk → co`.

Trie node structure:
```
TrieNode {
    children: Map<String, TrieNode>
    isTerminal: Boolean      // this node marks end of a public suffix rule
    isWildcard: Boolean      // this node has a wildcard child (*.X)
    exceptions: Set<String>  // exception labels (!label.X)
}
```

### Extraction Algorithm: `extractRegistrableDomain(domain): String?`

Input: a domain string (e.g., `accounts.google.com`, `foo.bar.co.uk`)

Steps:
1. Strip port if present (split on `:`, take first part)
2. Normalize: `java.net.IDN.toASCII(domain).lowercase()`
3. If input is an IP address (IPv4 regex or bracketed IPv6), return it unchanged
4. Split into labels: `["accounts", "google", "com"]`
5. Walk the trie with reversed labels to find the longest matching public suffix
6. The registrable domain = public suffix + one additional label to the left
7. If the domain IS a public suffix (no label to the left), return `null` (cannot match)

Note: `www.` is NOT stripped here. Stored sites already have `www.` stripped by `ServiceManager.normalizeSite` at storage time. For autofill `webDomain` input, the trie algorithm naturally handles `www` as a regular label (e.g., `www.google.com` → eTLD+1 = `google.com`). Explicit stripping would break PSL exception cases like `!www.ck` where `www.ck` is itself a registrable domain.

Example walkthrough:
- `accounts.google.com` → labels `["accounts", "google", "com"]`
- Reversed: `["com", "google", "accounts"]`
- Trie match: `com` is terminal (public suffix length = 1)
- Registrable domain = 1 + 1 = 2 labels from the right = `google.com`

Wildcard example:
- `foo.bar.ck` → reversed: `["ck", "bar", "foo"]`
- Trie: `ck` has `isWildcard = true` → public suffix = `*.ck` → matches `bar.ck` (length = 2)
- Registrable domain = 2 + 1 = 3 labels from the right = `foo.bar.ck`

Exception example:
- `www.ck` → reversed: `["ck", "www"]`
- Trie: `ck` has `isWildcard = true` but `exceptions` contains `www`
- Exception means `www.ck` is NOT a public suffix; fall back to `ck` as the public suffix (length = 1)
- Registrable domain = `www.ck`

### Fallback for Unknown TLDs

If the rightmost label is not in the trie at all (e.g., `foo.internal`), treat it as a single-label TLD. Registrable domain = last two labels (e.g., `foo.internal`). This is the safe default — prevents over-matching on private/internal domains.

## Match Layer Change

### Before (exact)

```kotlin
val normalizedDomain = ServiceManager.normalizeSite(domain)
val matches = serviceManager.getServices().filter {
    ServiceManager.normalizeSite(it.site) == normalizedDomain
}
```

### After (eTLD+1)

```kotlin
val psl = PublicSuffixList.getInstance(applicationContext)
val visitedRegistrable = psl.extractRegistrableDomain(domain)
if (visitedRegistrable == null) {
    callback.onSuccess(null)
    return
}
val matches = serviceManager.getServices().filter {
    psl.extractRegistrableDomain(it.site) == visitedRegistrable
}
```

### Disambiguation

No UI change needed. The existing code already builds one `Dataset` per matching service:
```kotlin
for (service in matches) {
    // ... builds dataset with presentation "Keygrain — ${service.name}"
    responseBuilder.addDataset(datasetBuilder.build())
}
```

When multiple services share the same eTLD+1 (e.g., stored `accounts.google.com` and `google.com`), both appear in the autofill picker. The user selects the correct one.

## Add-Service UX Change

### Current Behavior

FAB click → read clipboard → if URL detected, `prefillSite = ServiceManager.normalizeSite(clipText)`.

Result: `https://accounts.google.com/signin` → `accounts.google.com`

### New Behavior

FAB click → read clipboard → if URL detected:
1. `normalized = ServiceManager.normalizeSite(clipText)` → `accounts.google.com`
2. `registrable = psl.extractRegistrableDomain(normalized)` → `google.com`
3. `prefillSite = registrable ?: normalized` (fallback to full domain if extraction fails)
4. If `registrable != normalized`, show hint text below the site field:
   `"Detected: accounts.google.com → saving as google.com"`

The user can edit the site field to keep the full subdomain if desired.

### UX Text Clarification

The hint should make clear that the site field determines password generation:
- Supporting text on site field: "Used for password generation and autofill matching"
- Hint when eTLD+1 differs from detected: "Detected accounts.google.com — defaulting to google.com (matches all subdomains)"

### Impact on Existing Users

- Existing entries with subdomain sites (e.g., `accounts.google.com`) are NOT modified
- After this change, those entries will match when visiting ANY `google.com` subdomain (improvement)
- If a user creates a new entry as `google.com` for the same email, it produces a DIFFERENT password than the old `accounts.google.com` entry
- Both entries appear in the autofill picker — user selects the correct one
- No migration is needed or performed

## Edge Cases & Security

| Input | Behavior | Rationale |
|-------|----------|-----------|
| `192.168.1.1` | Return unchanged, exact match only | IP addresses have no TLD structure |
| `[::1]` | Return unchanged, exact match only | IPv6 literal |
| `localhost` | Return unchanged, exact match only | Single-label domain |
| `com` (bare TLD) | Return `null`, no match | A public suffix alone is not registrable |
| `foo.github.io` | Registrable = `foo.github.io` | `github.io` is in PSL as a public suffix |
| `evil.com` stored, visiting `google.com` | No match | Different eTLD+1 |
| `accounts.google.com` stored, visiting `mail.google.com` | Match | Same eTLD+1 (`google.com`) |
| `example.co.uk` stored, visiting `mail.example.co.uk` | Match | Same eTLD+1 (`example.co.uk`) |
| `foo.bar.unknown` | Registrable = `bar.unknown` | Unknown TLD fallback (single-label TLD assumption) |
| `example.com:8443` | Strip port → `example.com` | Port is not part of domain identity |
| `münchen.de` (IDN) | Normalize to `xn--mnchen-3ya.de` → lookup | Punycode normalization before PSL lookup |
| Empty string / null | Return `null`, no match | Invalid input |
| `www.ck` | Registrable = `www.ck` | PSL exception rule (`!www.ck`) |

### Security Considerations

- **Over-matching risk:** The PSL prevents treating `github.io` as a registrable domain (which would match ALL GitHub Pages sites). This is the primary security value of using the full PSL rather than a hardcoded list.
- **Under-matching on stale PSL:** If a new public suffix is added (e.g., a new gTLD delegates subdomains), a stale PSL may under-match (treat `foo.newservice.com` and `bar.newservice.com` as the same registrable domain when they shouldn't be). This is acceptable — it's the same behavior as before this feature (exact match would also not distinguish them). Updates ship with app releases.
- **Malicious domain stored:** If a user somehow stores `evil.com` as a service site, it will only match when visiting `evil.com` subdomains. eTLD+1 matching cannot cause cross-domain password leakage.

## Performance

### PSL Parsing

- File size: ~200KB, ~9,500 rules
- Parse time: <50ms on modern Android devices (simple line-by-line, string splits)
- Memory: Trie with ~9,500 terminal nodes. Estimated ~500KB in memory (labels are short strings, shared prefixes compress well in a trie)

### Loading Strategy

**Lazy singleton, initialized on first access:**

```kotlin
object PublicSuffixList {
    private var trie: TrieNode? = null

    fun getInstance(context: Context): PublicSuffixList {
        if (trie == null) {
            synchronized(this) {
                if (trie == null) {
                    trie = parseFromAssets(context.applicationContext)
                }
            }
        }
        return this
    }
}
```

- First autofill request triggers parsing (if not already loaded)
- Subsequent requests use cached trie (process-lifetime singleton)
- Autofill framework timeout is ~5s; parsing at <50ms is well within budget
- Alternative considered: parse on app startup in background thread. Rejected as unnecessary complexity — lazy loading is sufficient given the parse time.

### Per-Request Cost

- `extractRegistrableDomain`: O(k) where k = number of labels in the domain (typically 2-4)
- Matching loop: O(n) where n = number of stored services (typically <100)
- Total per-request overhead: negligible (<1ms)

## Test Plan

### Unit Tests: PSL Parsing

| Test | Input | Expected |
|------|-------|----------|
| Comment lines skipped | File with `// comment` lines | No trie entries for comments |
| Exact rule | `com` in PSL | `com` is terminal in trie |
| Wildcard rule | `*.ck` in PSL | `ck` node has `isWildcard = true` |
| Exception rule | `!www.ck` in PSL | `ck` node has `www` in exceptions |
| Empty lines skipped | File with blank lines | No crash, correct parse |

### Unit Tests: eTLD+1 Extraction

| Test | Input | Expected Output |
|------|-------|-----------------|
| Simple .com | `accounts.google.com` | `google.com` |
| Multi-part TLD | `foo.example.co.uk` | `example.co.uk` |
| Wildcard TLD | `foo.bar.ck` | `foo.bar.ck` |
| Wildcard exception | `www.ck` | `www.ck` |
| Bare TLD | `com` | `null` |
| Public suffix only | `co.uk` | `null` |
| IP address | `192.168.1.1` | `192.168.1.1` |
| IPv6 | `[::1]` | `[::1]` |
| Localhost | `localhost` | `localhost` |
| With port | `example.com:8443` | `example.com` |
| IDN (unicode) | `münchen.de` | `xn--mnchen-3ya.de` (after punycode) → registrable = `xn--mnchen-3ya.de` |
| Unknown TLD | `foo.bar.internal` | `bar.internal` |
| github.io subdomain | `mysite.github.io` | `mysite.github.io` |
| `www.example.com` | `example.com` | Via trie walk (www is a regular label, not stripped) |
| Empty string | `` | `null` |
| Single label | `intranet` | `intranet` (returned unchanged) |

### Integration Tests: Autofill Matching

| Stored Site | Visited Domain | Should Match? |
|-------------|---------------|---------------|
| `google.com` | `accounts.google.com` | Yes |
| `accounts.google.com` | `mail.google.com` | Yes |
| `accounts.google.com` | `google.com` | Yes |
| `example.co.uk` | `mail.example.co.uk` | Yes |
| `foo.github.io` | `foo.github.io` | Yes |
| `foo.github.io` | `bar.github.io` | No |
| `google.com` | `evil.com` | No |
| `192.168.1.1` | `192.168.1.1` | Yes |
| `192.168.1.1` | `192.168.1.2` | No |

### Integration Tests: Add-Service Default

| Clipboard Content | Prefilled Site | Hint Shown? |
|-------------------|---------------|-------------|
| `https://accounts.google.com/signin` | `google.com` | Yes: "Detected accounts.google.com — defaulting to google.com" |
| `https://google.com/` | `google.com` | No (no subdomain difference) |
| `https://mysite.github.io/page` | `mysite.github.io` | No (eTLD+1 = full normalized domain) |
| `not a url` | `` (empty) | No |
| `https://192.168.1.1:8080/admin` | `192.168.1.1` | No |
