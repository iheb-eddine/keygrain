# Breach News Feed — Design Document

## 1. Overview

The breach news feed is a curated, publicly accessible JSON file listing recent site breaches. Keygrain clients (browser extension, mobile app) fetch this feed and warn users when a site they use has been breached, prompting them to regenerate their password by changing their salt.

**Key properties:**
- Static file at `server/static/breaches.json` — no Go code changes needed
- Ed25519 signed to prevent tampering (same pattern as `rules.json`)
- Manually curated — not automated HIBP checking
- Public endpoint, no authentication required
- Clients cache for 24 hours, check on unlock

**What this is NOT:**
- Not a password leak checker (no credential stuffing detection)
- Not automated — breaches are added manually when publicly reported
- Not a replacement for HIBP — it's a lightweight notification for keygrain users

## 2. JSON Schema

### File: `server/static/breaches.json`

```json
{
  "version": 1,
  "signature": "<Ed25519 signature hex>",
  "breaches": [
    {
      "id": "example-2026-03",
      "domain": "example.com",
      "date": "2026-03-15",
      "severity": "critical",
      "description": "User database with hashed passwords exposed via SQL injection",
      "action": "Regenerate password (change salt)",
      "source": "https://example.com/blog/security-incident-march-2026"
    }
  ]
}
```

### Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | integer | yes | Schema version, currently `1` |
| `signature` | string | yes | Ed25519 signature over canonical `{version, breaches}` |
| `breaches` | array | yes | List of breach entries, newest first |
| `breaches[].id` | string | yes | Unique identifier (`domain-YYYY-MM` format). Used for dismiss tracking. |
| `breaches[].domain` | string | yes | eTLD+1 of the breached site |
| `breaches[].date` | string | yes | ISO 8601 date (YYYY-MM-DD) when breach was disclosed |
| `breaches[].severity` | string | yes | One of: `"critical"`, `"warning"`, `"info"` |
| `breaches[].description` | string | yes | Brief description of what was compromised |
| `breaches[].action` | string | yes | Recommended user action |
| `breaches[].source` | string | yes | URL to public disclosure or news report |

### Severity Levels

| Level | Meaning | Client behavior |
|-------|---------|-----------------|
| `critical` | Passwords or auth tokens compromised | Show warning banner with "change salt" prompt |
| `warning` | Personal data exposed, passwords possibly at risk | Show warning banner with action text |
| `info` | Email addresses or non-sensitive data only | Show informational notice (no action required) |

### Validation Rules

- `id` must be unique across all entries
- `domain` must be a valid eTLD+1 (no subdomains, no paths)
- `date` must be valid ISO 8601 date, not in the future
- `severity` must be one of the three defined values
- `source` must be a valid HTTPS URL
- Array ordered by `date` descending (newest first)
- Entries older than 1 year SHOULD be removed (stale warnings lose value)

### Signature

Signature covers the canonical JSON of `{"breaches":[...],"version":1}` (sorted keys, no whitespace). Same Ed25519 key pair as `rules.json`. Clients MUST verify signature before processing; on failure, silently skip breach checking (fail-open for UX, fail-closed for tampering).

## 3. Server Integration

### Zero Code Changes

The existing server already serves static files:

```go
mux.Handle("/", http.FileServer(http.Dir("static")))
```

Placing `breaches.json` in `server/static/` makes it available at `GET /breaches.json`. This is consistent with the existing `rules.json` pattern.

### File Location

```
server/static/breaches.json
```

### Caching

The Go `http.FileServer` serves files with `Last-Modified` headers based on filesystem mtime. Clients use their own 24h cache (see §4). No server-side cache headers need to be configured — the file changes rarely (manual updates only).

### Deployment

The file is committed to the repository and deployed with the server binary. Updates follow the normal deploy flow: edit file → sign → commit → deploy.

## 4. Client Integration (Extension)

### Fetch Logic

On vault unlock, the extension fetches the breach feed:

```
1. Check local cache (chrome.storage.local key: "breachFeed")
2. If cache exists and fetchedAt < 24 hours ago → use cached data
3. Otherwise → fetch /breaches.json from server
4. Verify Ed25519 signature (reuse existing verification from site-rules)
5. If signature invalid → skip breach checking, log warning
6. Store in cache: {version, breaches, fetchedAt: Date.now()}
```

### Domain Matching

For each breach entry, check if any user service matches the breach domain using eTLD+1 comparison:

```
For each breach in breaches:
  For each service in user's services:
    if eTLD+1(service.name) === breach.domain:
      → match found, check dismissal status
```

eTLD+1 extraction reuses the existing logic from site-rules matching (suffix list or simple heuristic: last two segments, or three for known ccTLDs like `.co.uk`).

**Known limitation:** Breaches are matched at the organizational (eTLD+1) level. A breach specific to one service under a domain (e.g., only `api.example.com` users affected) will warn all users of `example.com`. This is an acceptable false-positive trade-off — it's safer to over-warn than under-warn.

### Dismissal

Users can dismiss breach warnings. Dismissed breach IDs are stored locally:

```
chrome.storage.local key: "dismissedBreaches"
Value: ["example-2026-03", "other-2025-12"]
```

A dismissed breach is never shown again for that browser profile. Dismissal is per-breach-ID, not per-domain — if the same site is breached again (new ID), the warning reappears.

### Show-All Model

Since services have no `modifiedAt` timestamp, the extension shows warnings for ALL matching breaches that haven't been dismissed. The warning copy includes the breach date so the user can judge whether they've already addressed it. This avoids requiring a service model change.

## 5. Warning UX

### Banner Design

When matching breaches are found, a warning banner appears at the top of the popup, above the service list:

```
┌─────────────────────────────────────────────┐
│ ⚠️  example.com was breached (Mar 15, 2026) │
│  User database with hashed passwords        │
│  exposed via SQL injection.                 │
│                                             │
│  → Regenerate password (change salt)        │
│                                     [Dismiss]│
└─────────────────────────────────────────────┘
```

### Behavior

- **Critical/Warning:** Yellow/orange banner with action prompt
- **Info:** Subtle gray banner, informational only, no action prompt
- **Multiple breaches:** Stack banners, max 3 visible, "+N more" link
- **Dismiss button:** Removes banner permanently for that breach ID
- **Action link ("Regenerate password"):** Scrolls to / highlights the matching service in the list. User then edits the salt to regenerate.

### Accessibility

- Banner has `role="alert"` and `aria-live="assertive"` for screen readers
- Dismiss button has `aria-label="Dismiss breach warning for [domain]"`
- Color is not the only indicator — icon (⚠️) and text convey severity
- Focus management: banner is focusable, dismiss returns focus to service list

### Copy Templates

| Severity | Headline | Body |
|----------|----------|------|
| critical | "⚠️ [domain] was breached ([date])" | "[description]. **[action]**" |
| warning | "⚠️ [domain] was breached ([date])" | "[description]. [action]" |
| info | "ℹ️ [domain] data exposure ([date])" | "[description]" |

## 6. Maintenance

### Adding a New Breach

1. Edit `server/static/breaches.json`
2. Add entry to the beginning of the `breaches` array:
   ```json
   {
     "id": "domain-YYYY-MM",
     "domain": "affected-site.com",
     "date": "YYYY-MM-DD",
     "severity": "critical|warning|info",
     "description": "Brief description of what happened",
     "action": "What the user should do",
     "source": "https://link-to-disclosure"
   }
   ```
3. Run validation script: `./scripts/validate-breaches.sh`
4. Sign the file: `./scripts/sign-json.sh server/static/breaches.json`
5. Commit and deploy

### Validation Script

The validation script (shared with `rules.json` signing toolchain) checks:
- JSON is valid
- All required fields present and correctly typed
- `id` is unique
- `domain` is valid eTLD+1
- `date` is valid and not in the future
- `severity` is one of the allowed values
- `source` is a valid HTTPS URL
- Array is sorted by date descending
- No entries older than 1 year (warning, not error)

### Removal Policy

- Remove entries older than 1 year (users have had ample time to act)
- Keep the file small — target < 50 entries at any time
- Removal does not require re-notification (dismissed state is local)

### Sources for Breach Information

- HaveIBeenPwned breach notifications
- Security news (Krebs on Security, BleepingComputer)
- Official company disclosures
- Only add breaches where passwords or auth tokens were compromised (for critical/warning) or personal data exposed (for info)

## 7. Test Plan

### Server Tests

| Test | Method | Expected |
|------|--------|----------|
| `GET /breaches.json` returns 200 | curl | Valid JSON response with correct Content-Type |
| File is valid JSON | `jq . < breaches.json` | Parses without error |
| Signature is valid | `verify-json.sh breaches.json` | Exit 0 |
| Schema validation passes | `validate-breaches.sh` | Exit 0, no errors |

### Client Tests (Extension)

| Test | Method | Expected |
|------|--------|----------|
| Fetch and cache on unlock | Manual / unit test | Cache populated with `fetchedAt` |
| Cache hit within 24h | Unit test (mock Date.now) | No network request |
| Cache miss after 24h | Unit test (mock Date.now) | Fresh fetch |
| Signature verification failure | Mock invalid signature | Breach checking skipped, no crash |
| Domain matching: exact | Service "example.com" + breach "example.com" | Match |
| Domain matching: subdomain | Service "mail.example.com" + breach "example.com" | Match |
| Domain matching: no match | Service "other.com" + breach "example.com" | No match |
| Dismiss persists | Dismiss → reload extension | Warning does not reappear |
| New breach after dismiss | Same domain, new ID | Warning appears |
| Multiple banners | 3+ matching breaches | Max 3 shown + "+N more" |
| Info severity | Breach with severity "info" | No action prompt shown |
| Network failure | Server unreachable | Graceful fallback, no crash |

### Integration Tests

| Test | Method | Expected |
|------|--------|----------|
| End-to-end: add breach → extension shows warning | Manual | Banner appears on next unlock |
| Dismiss flow | Manual | Banner disappears, stays dismissed |
| Action link | Manual | Scrolls to matching service |

### Validation Script Tests

| Test | Expected |
|------|----------|
| Valid file | Pass |
| Duplicate ID | Fail with error message |
| Invalid date (future) | Fail |
| Missing required field | Fail |
| Invalid severity value | Fail |
| Unsorted array | Fail |
| Invalid source URL (HTTP not HTTPS) | Fail |
