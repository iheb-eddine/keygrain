# Rate Limiting Design — Keygrain Backup Server

## 1. Overview

This document describes an in-process, two-layer rate limiter for the keygrain backup server's `/api/backup/` routes. The rate limiter uses the token bucket algorithm to protect against:

- **Auth brute-force attacks** — per-lookup_id limiting prevents rapid password guessing
- **Global abuse** — per-IP limiting prevents any single source from overwhelming the server

No external dependencies are introduced. The implementation uses Go stdlib only.

### Layers

| Layer | Key | Burst | Sustained Rate | Purpose |
|-------|-----|-------|----------------|---------|
| Per-lookup_id | URL path segment | 10 | 2 req/min | Brute-force protection |
| Per-IP | Client IP address | 100 | 100 req/min | Global abuse prevention |

A request must pass **both** layers to proceed. If either bucket is exhausted, the request is rejected with 429.

> **Security hardening note:** Burst=10 per lookup_id allows 10 rapid password guesses before throttling. For deployments with high security requirements, consider reducing burst to 5 (1 token refill every 60s). At bcrypt cost=12 (~250ms/hash), 10 guesses complete in ~2.5s before rate limiting engages.

## 2. Token Bucket Algorithm

### How It Works

Each bucket holds tokens up to a maximum (burst capacity). Each request consumes 1 token. Tokens are refilled at a constant rate (sustained rate). If the bucket is empty, the request is rejected.

### Parameters

**Per-lookup_id:**
- Bucket capacity (burst): 10 tokens
- Refill rate: 2 tokens/minute → stored as `0.0333 tokens/second`
- When empty: ~30 seconds until next token

**Per-IP:**
- Bucket capacity (burst): 100 tokens
- Refill rate: 100 tokens/minute → stored as `1.6667 tokens/second`
- When empty: ~600ms until next token

### Token Calculation (Lazy Refill)

Tokens are not refilled by a timer. Instead, on each request, the elapsed time since last access is used to calculate tokens to add:

```
elapsed := now - lastAccess
tokensToAdd := elapsed * refillRate
bucket.tokens = min(bucket.tokens + tokensToAdd, capacity)
bucket.lastAccess = now
```

This avoids per-bucket timers and is O(1) per request.

### Consumption

Tokens are consumed on **every request** to a lookup_id, regardless of whether authentication succeeds or fails. This prevents timing oracles — a rate-limited response is indistinguishable from whether the lookup_id exists or not.

## 3. Data Structures

```go
type bucket struct {
    tokens     float64
    lastAccess time.Time
}

type rateLimiter struct {
    mu         sync.Mutex
    buckets    map[string]*bucket
    capacity   float64
    refillRate float64 // tokens per second
}
```

### Two Instances

```go
type rateLimitMiddleware struct {
    perID *rateLimiter // keyed by lookup_id
    perIP *rateLimiter // keyed by client IP
}
```

### Why `sync.Mutex` + `map`

Every request decrements tokens (a write operation). `sync.Map` is optimized for read-heavy, stable-key workloads per Go documentation. Rate limiting is write-heavy with dynamic keys, making `sync.Mutex` + `map[string]*bucket` the correct choice.

### Thread Safety

The `allow(key string) (bool, time.Duration)` method:
1. Locks the mutex
2. Looks up or creates the bucket
3. Refills tokens based on elapsed time
4. Attempts to consume 1 token
5. Returns (allowed, retryAfter)
6. Unlocks

The critical section is short (map lookup + arithmetic), so contention is minimal.

## 4. HTTP Integration

### Middleware Pattern

```go
func (rl *rateLimitMiddleware) Wrap(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ip := rl.extractIP(r)
        lookupID := extractLookupID(r.URL.Path)

        // Check per-IP first (cheaper, no path parsing needed for invalid requests)
        if allowed, retryAfter := rl.perIP.allow(ip); !allowed {
            rl.reject(w, retryAfter)
            return
        }

        // Check per-lookup_id
        if lookupID != "" {
            if allowed, retryAfter := rl.perID.allow(lookupID); !allowed {
                rl.reject(w, retryAfter)
                return
            }
        }

        next(w, r)
    }
}
```

### Registration in main.go

```go
rl := newRateLimitMiddleware(ctx)
mux.HandleFunc("/api/backup/", rl.Wrap(backup.backupHandler))
```

### Order of Checks

1. Per-IP check first — rejects obvious abuse before parsing the path
2. Per-lookup_id check second — only if the path contains a valid lookup_id

**Important:** The per-IP token is consumed even if the per-lookup_id check subsequently fails. This is intentional — an attacker cycling through lookup_ids should still hit the IP limit.

## 5. Response Format

### 429 Too Many Requests

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 30

{"error":"rate limit exceeded","retry_after":30}
```

- `Retry-After` header: integer seconds until the next token is available (ceiling of the calculated duration)
- JSON body matches the server's existing error format (`{"error":"..."}`)
- The response does NOT indicate which layer triggered the limit (prevents information leakage about whether a lookup_id exists)

## 6. Edge Cases

### IP Extraction

**Strategy:** Use a configurable trusted header (default: `X-Real-IP`) with `r.RemoteAddr` fallback.

```go
func (rl *rateLimitMiddleware) extractIP(r *http.Request) string {
    if rl.trustedHeader != "" {
        if ip := r.Header.Get(rl.trustedHeader); ip != "" {
            return normalizeIP(ip)
        }
    }
    host, _, _ := net.SplitHostPort(r.RemoteAddr)
    return normalizeIP(host)
}
```

**Why X-Real-IP, not X-Forwarded-For:**
- X-Forwarded-For is a comma-separated list where all entries except the rightmost (appended by the last trusted proxy) can be spoofed by the client
- X-Real-IP is a single value set by the reverse proxy (nginx: `proxy_set_header X-Real-IP $remote_addr`)
- Simpler, correct for single-proxy deployments

**Direct exposure (no proxy):** Set `KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER=""` to disable header trust and use only `r.RemoteAddr`.

### IPv6 Normalization

```go
func normalizeIP(ip string) string {
    parsed := net.ParseIP(ip)
    if parsed == nil {
        return ip // unparseable, use raw string as key
    }
    return parsed.String() // canonical form: ::1, not 0:0:0:0:0:0:0:1
}
```

- `net.ParseIP().String()` produces canonical form (collapses zeros, lowercases)
- Zone IDs (`%eth0`) are stripped by `net.SplitHostPort` already
- No subnet aggregation (rate limit per exact IP, not /64 block) — simpler, avoids penalizing shared subnets

### Stale Bucket Cleanup

A background goroutine runs every 60 seconds and evicts buckets that have been idle longer than the eviction threshold.

```go
func (rl *rateLimiter) cleanup(ctx context.Context) {
    ticker := time.NewTicker(60 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            rl.evictStale()
        }
    }
}

func (rl *rateLimiter) evictStale() {
    threshold := time.Now().Add(-10 * time.Minute)
    rl.mu.Lock()
    defer rl.mu.Unlock()
    for key, b := range rl.buckets {
        if b.lastAccess.Before(threshold) {
            delete(rl.buckets, key)
        }
    }
}
```

**Eviction threshold: 10 minutes.** Rationale:
- Per-lookup_id at 2 tok/min refill: a fully drained bucket refills to capacity (10 tokens) in 5 minutes. 10-minute idle means the bucket is full anyway — evicting and recreating is equivalent.
- Per-IP at 100 tok/min: full refill in 1 minute. 10-minute idle is very conservative.

**Graceful shutdown:** The cleanup goroutine accepts a `context.Context`. Canceling the context stops the goroutine. The server's `main()` should create a context canceled on SIGTERM/SIGINT.

### Concurrent Map Iteration

Go's `range` over a map during `evictStale()` is safe under the held mutex. No concurrent reads/writes can occur while the lock is held.

### Clock Monotonicity

Use `time.Now()` (wall clock). If the system clock jumps backward, `elapsed` could be negative, producing negative `tokensToAdd`. The refill calculation should clamp: `tokensToAdd = max(0, elapsed * refillRate)`.

## 7. Test Plan

### Unit Tests

| Test | Validates |
|------|-----------|
| `TestBucketAllow_Fresh` | New bucket allows up to burst capacity |
| `TestBucketAllow_Exhausted` | Returns false and correct retryAfter when empty |
| `TestBucketAllow_Refill` | After waiting, tokens refill correctly |
| `TestBucketAllow_NeverExceedsCapacity` | Long idle doesn't exceed burst |
| `TestBucketAllow_ClockJumpBackward` | Negative elapsed clamped to 0 |
| `TestRateLimiter_ConcurrentAccess` | No races under parallel goroutines (run with `-race`) |
| `TestEvictStale` | Stale buckets removed, active buckets retained |
| `TestExtractIP_XRealIP` | Header present → uses header value |
| `TestExtractIP_Fallback` | Header absent → uses RemoteAddr |
| `TestExtractIP_NoTrustedHeader` | Config disables header → always RemoteAddr |
| `TestNormalizeIP_IPv6` | Canonical form produced |
| `TestNormalizeIP_IPv4` | Pass-through |

### Integration Tests (HTTP)

| Test | Validates |
|------|-----------|
| `TestMiddleware_AllowsUnderLimit` | Requests within burst succeed |
| `TestMiddleware_RejectsOverLimit` | Burst+1 request gets 429 |
| `TestMiddleware_RetryAfterHeader` | 429 response includes correct Retry-After |
| `TestMiddleware_JSONBody` | 429 body is `{"error":"rate limit exceeded","retry_after":N}` |
| `TestMiddleware_BothLayersIndependent` | IP limit hit doesn't affect other IPs; lookup_id limit doesn't affect other IDs |
| `TestMiddleware_IPConsumedEvenOnIDReject` | Per-IP token spent even when per-lookup_id rejects |

### Load/Stress Tests (manual)

- Verify sustained throughput matches 2 req/min per lookup_id over 5-minute window
- Verify 100 req/min per IP over 5-minute window
- Verify memory usage stabilizes (cleanup evicts stale buckets)

## 8. Configuration

All configuration via environment variables with sensible defaults:

| Env Var | Default | Description |
|---------|---------|-------------|
| `KEYGRAIN_RATE_LIMIT_ID_BURST` | `10` | Per-lookup_id burst capacity |
| `KEYGRAIN_RATE_LIMIT_ID_RATE` | `2` | Per-lookup_id sustained rate (requests/minute) |
| `KEYGRAIN_RATE_LIMIT_IP_BURST` | `100` | Per-IP burst capacity |
| `KEYGRAIN_RATE_LIMIT_IP_RATE` | `100` | Per-IP sustained rate (requests/minute) |
| `KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER` | `X-Real-IP` | Header for client IP (empty = use RemoteAddr only) |
| `KEYGRAIN_RATE_LIMIT_CLEANUP_INTERVAL` | `60` | Cleanup goroutine interval (seconds) |
| `KEYGRAIN_RATE_LIMIT_EVICTION_TTL` | `600` | Bucket eviction threshold (seconds of inactivity) |

### Parsing

```go
func envInt(key string, defaultVal int) int {
    if v := os.Getenv(key); v != "" {
        if n, err := strconv.Atoi(v); err == nil && n > 0 {
            return n
        }
        log.Printf("WARN: invalid %s, using default %d", key, defaultVal)
    }
    return defaultVal
}
```

Invalid values log a warning and fall back to defaults. The server does NOT fail to start on bad rate limit config — it degrades to defaults.
