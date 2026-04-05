# Design: Fix X-Real-IP Rate Limit Bypass (BUG 4)

## Bug Summary

`server/ratelimit.go` trusts the `X-Real-IP` header by default for rate limiting. Without a reverse proxy that strips/overwrites this header, an attacker can spoof different IPs per request to bypass rate limits entirely.

**Root cause:** `envString("KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER", "X-Real-IP")` — the default trusts a client-controlled header.

**Fix:** Change the default to `""` (empty string). The existing `extractIP()` logic already handles this correctly — when `trustedHeader == ""`, it uses `RemoteAddr` only.

## Frozen Requirements

1. **Secure by default:** When `KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER` is unset, rate limiting uses `RemoteAddr` only. No header is trusted.
2. **Explicit opt-in:** A header is trusted for IP extraction ONLY when the operator explicitly sets the env var.
3. **Backward-compatible with documented configuration:** Existing deployments behind nginx continue to work by setting `KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER=X-Real-IP`.

## Invariants

1. If `trustedHeader == ""`, `extractIP()` always returns the normalized `RemoteAddr` regardless of any request headers present.
2. If `trustedHeader != ""`, `extractIP()` returns the named header's value when present, falling back to `RemoteAddr` otherwise.
3. No code path allows an unauthenticated client to choose its own rate-limit key without explicit operator opt-in via environment variable.

## Scope Boundary

### In Scope

- Change default value of `trustedHeader` from `"X-Real-IP"` to `""` in `newRateLimitMiddleware()`
- Update/add tests to validate the new default behavior
- Document the env var requirement in deployment documentation

### Out of Scope

- Trusted proxy IP allowlist (validating that the header was set by a known proxy IP) — future enhancement
- Changes to rate limit algorithm, bucket logic, or capacity defaults
- Multi-header support (e.g., parsing `X-Forwarded-For` chains)
- Any changes to `extractIP()` logic itself (it already handles both cases correctly)

## Code Change

Single line change in `newRateLimitMiddleware()`:

```go
// Before (insecure default):
trustedHeader := envString("KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER", "X-Real-IP")

// After (secure default):
trustedHeader := envString("KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER", "")
```

## Test Plan

### Existing Tests (remain valid)

| Test | Validates |
|------|-----------|
| `TestExtractIP_XRealIP` | Header trusted when `trustedHeader` is set |
| `TestExtractIP_Fallback` | Falls back to RemoteAddr when header absent |
| `TestExtractIP_NoTrustedHeader` | Ignores headers when `trustedHeader == ""` |

### New Tests

| Test | Validates |
|------|-----------|
| `TestDefaultConfig_NoHeaderTrust` | `newRateLimitMiddleware()` with no env var produces `trustedHeader == ""` |
| `TestDefaultConfig_ExplicitHeaderTrust` | Setting `KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER=X-Real-IP` produces `trustedHeader == "X-Real-IP"` |
| `TestExtractIP_SpoofAttemptBlocked` | With default config (no trusted header), a request carrying `X-Real-IP: 1.2.3.4` is still rate-limited by its `RemoteAddr`, proving the spoof is ignored |

### Test #6 Detail (most critical)

```go
func TestExtractIP_SpoofAttemptBlocked(t *testing.T) {
    // Default config: no env var set → trustedHeader == ""
    rl := &rateLimitMiddleware{trustedHeader: ""}
    r := httptest.NewRequest("GET", "/", nil)
    r.Header.Set("X-Real-IP", "1.2.3.4")       // attacker spoofs
    r.RemoteAddr = "10.0.0.1:9999"              // actual source

    ip := rl.extractIP(r)
    if ip != "10.0.0.1" {
        t.Fatalf("spoof not blocked: expected 10.0.0.1, got %s", ip)
    }
}
```

## Deployment Impact

| Deployment | Action Required |
|------------|----------------|
| Behind nginx (sets X-Real-IP) | Set `KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER=X-Real-IP` |
| Direct exposure (no proxy) | None — secure by default |
| Behind other proxies | Set env var to the appropriate header name |

**Breaking change:** Existing deployments behind nginx that rely on the old default will start rate-limiting by proxy IP (treating all clients as one). This is a deliberate security tradeoff — operators must explicitly opt in to header trust.
