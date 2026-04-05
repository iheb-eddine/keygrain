package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"
)

func TestAllow_Fresh(t *testing.T) {
	rl := newRateLimiter(10, 2.0/60.0)
	for i := 0; i < 10; i++ {
		allowed, _ := rl.allow("key")
		if !allowed {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
}

func TestAllow_Exhausted(t *testing.T) {
	rl := newRateLimiter(10, 2.0/60.0)
	for i := 0; i < 10; i++ {
		rl.allow("key")
	}
	allowed, retryAfter := rl.allow("key")
	if allowed {
		t.Fatal("should be rejected when exhausted")
	}
	if retryAfter <= 0 {
		t.Fatal("retryAfter should be positive")
	}
	// At 2/min = 0.0333/s, time for 1 token = 30s
	if retryAfter > 31*time.Second {
		t.Fatalf("retryAfter too large: %v", retryAfter)
	}
}

func TestAllow_Refill(t *testing.T) {
	rl := newRateLimiter(10, 2.0/60.0)
	for i := 0; i < 10; i++ {
		rl.allow("key")
	}

	// Simulate time passing by manipulating lastAccess
	rl.mu.Lock()
	rl.buckets["key"].lastAccess = time.Now().Add(-30 * time.Second)
	rl.mu.Unlock()

	allowed, _ := rl.allow("key")
	if !allowed {
		t.Fatal("should be allowed after refill")
	}
}

func TestAllow_NeverExceedsCapacity(t *testing.T) {
	rl := newRateLimiter(10, 2.0/60.0)
	// Use 5 tokens
	for i := 0; i < 5; i++ {
		rl.allow("key")
	}

	// Simulate long idle (tokens should cap at 10)
	rl.mu.Lock()
	rl.buckets["key"].lastAccess = time.Now().Add(-1 * time.Hour)
	rl.mu.Unlock()

	// Should allow exactly 10 (capacity), not more
	for i := 0; i < 10; i++ {
		allowed, _ := rl.allow("key")
		if !allowed {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
	allowed, _ := rl.allow("key")
	if allowed {
		t.Fatal("should be rejected at capacity+1")
	}
}

func TestAllow_ClockJumpBackward(t *testing.T) {
	rl := newRateLimiter(10, 2.0/60.0)
	// Use all tokens
	for i := 0; i < 10; i++ {
		rl.allow("key")
	}

	// Set lastAccess in the future (simulates clock jump backward)
	rl.mu.Lock()
	rl.buckets["key"].lastAccess = time.Now().Add(1 * time.Hour)
	rl.mu.Unlock()

	// Should still be rejected (no negative refill)
	allowed, _ := rl.allow("key")
	if allowed {
		t.Fatal("clock jump backward should not grant tokens")
	}
}

func TestAllow_ConcurrentAccess(t *testing.T) {
	rl := newRateLimiter(100, 100.0/60.0)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				rl.allow("key")
			}
		}()
	}
	wg.Wait()
}

func TestEvictStale(t *testing.T) {
	rl := newRateLimiter(10, 2.0/60.0)
	rl.allow("active")
	rl.allow("stale")

	// Make "stale" old
	rl.mu.Lock()
	rl.buckets["stale"].lastAccess = time.Now().Add(-11 * time.Minute)
	rl.mu.Unlock()

	rl.evictStale(10 * time.Minute)

	rl.mu.Lock()
	defer rl.mu.Unlock()
	if _, ok := rl.buckets["stale"]; ok {
		t.Fatal("stale bucket should be evicted")
	}
	if _, ok := rl.buckets["active"]; !ok {
		t.Fatal("active bucket should be retained")
	}
}

func TestExtractIP_XRealIP(t *testing.T) {
	rl := &rateLimitMiddleware{trustedHeader: "X-Real-IP"}
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("X-Real-IP", "1.2.3.4")
	r.RemoteAddr = "5.6.7.8:1234"

	ip := rl.extractIP(r)
	if ip != "1.2.3.4" {
		t.Fatalf("expected 1.2.3.4, got %s", ip)
	}
}

func TestExtractIP_Fallback(t *testing.T) {
	rl := &rateLimitMiddleware{trustedHeader: "X-Real-IP"}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "5.6.7.8:1234"

	ip := rl.extractIP(r)
	if ip != "5.6.7.8" {
		t.Fatalf("expected 5.6.7.8, got %s", ip)
	}
}

func TestExtractIP_NoTrustedHeader(t *testing.T) {
	rl := &rateLimitMiddleware{trustedHeader: ""}
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("X-Real-IP", "1.2.3.4")
	r.RemoteAddr = "5.6.7.8:1234"

	ip := rl.extractIP(r)
	if ip != "5.6.7.8" {
		t.Fatalf("expected 5.6.7.8, got %s", ip)
	}
}

func TestNormalizeIP_IPv6(t *testing.T) {
	result := normalizeIP("0:0:0:0:0:0:0:1")
	if result != "::1" {
		t.Fatalf("expected ::1, got %s", result)
	}
}

func TestNormalizeIP_IPv4(t *testing.T) {
	result := normalizeIP("192.168.1.1")
	if result != "192.168.1.1" {
		t.Fatalf("expected 192.168.1.1, got %s", result)
	}
}

func TestMiddleware_AllowsUnderLimit(t *testing.T) {
	rl := &rateLimitMiddleware{
		perID:         newRateLimiter(10, 2.0/60.0),
		perIP:         newRateLimiter(100, 100.0/60.0),
		trustedHeader: "X-Real-IP",
	}
	handler := rl.Wrap(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r := httptest.NewRequest("GET", "/api/sync/"+string(make([]byte, 0))+"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
	r.Header.Set("X-Real-IP", "1.2.3.4")
	w := httptest.NewRecorder()
	handler(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestMiddleware_RejectsOverLimit(t *testing.T) {
	rl := &rateLimitMiddleware{
		perID:         newRateLimiter(3, 2.0/60.0),
		perIP:         newRateLimiter(100, 100.0/60.0),
		trustedHeader: "X-Real-IP",
	}
	handler := rl.Wrap(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	lookupID := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	for i := 0; i < 3; i++ {
		r := httptest.NewRequest("GET", "/api/sync/"+lookupID, nil)
		r.Header.Set("X-Real-IP", "1.2.3.4")
		w := httptest.NewRecorder()
		handler(w, r)
	}

	r := httptest.NewRequest("GET", "/api/sync/"+lookupID, nil)
	r.Header.Set("X-Real-IP", "1.2.3.4")
	w := httptest.NewRecorder()
	handler(w, r)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Fatal("missing Retry-After header")
	}
}

func TestMiddleware_IPConsumedOnIDReject(t *testing.T) {
	rl := &rateLimitMiddleware{
		perID:         newRateLimiter(1, 2.0/60.0),
		perIP:         newRateLimiter(5, 100.0/60.0),
		trustedHeader: "X-Real-IP",
	}
	handler := rl.Wrap(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	lookupID := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

	// First request passes both
	r := httptest.NewRequest("GET", "/api/sync/"+lookupID, nil)
	r.Header.Set("X-Real-IP", "1.2.3.4")
	w := httptest.NewRecorder()
	handler(w, r)

	// Next 4 requests: per-ID rejects, but per-IP token still consumed
	for i := 0; i < 4; i++ {
		r := httptest.NewRequest("GET", "/api/sync/"+lookupID, nil)
		r.Header.Set("X-Real-IP", "1.2.3.4")
		w := httptest.NewRecorder()
		handler(w, r)
		if w.Code != http.StatusTooManyRequests {
			t.Fatalf("request %d: expected 429, got %d", i+2, w.Code)
		}
	}

	// 6th request: per-IP should now be exhausted too
	rl.perIP.mu.Lock()
	tokens := rl.perIP.buckets["1.2.3.4"].tokens
	rl.perIP.mu.Unlock()
	if tokens >= 1 {
		t.Fatalf("expected IP tokens exhausted, got %f", tokens)
	}
}

func TestExtractLookupID(t *testing.T) {
	tests := []struct {
		path string
		want string
	}{
		{"/api/sync/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
		{"/api/sync/short", ""},
		{"/api/sync/", ""},
		{"/other/path", ""},
		{"/api/sync/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/extra", ""},
	}
	for _, tt := range tests {
		got := extractLookupID(tt.path)
		if got != tt.want {
			t.Errorf("extractLookupID(%q) = %q, want %q", tt.path, got, tt.want)
		}
	}
}

func TestDefaultConfig_NoHeaderTrust(t *testing.T) {
	// Ensure env var is unset (t.Setenv registers cleanup to restore original)
	t.Setenv("KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER", "")
	os.Unsetenv("KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rl := newRateLimitMiddleware(ctx)
	if rl.trustedHeader != "" {
		t.Fatalf("expected empty trustedHeader, got %q", rl.trustedHeader)
	}
}

func TestDefaultConfig_ExplicitHeaderTrust(t *testing.T) {
	t.Setenv("KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER", "X-Real-IP")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rl := newRateLimitMiddleware(ctx)
	if rl.trustedHeader != "X-Real-IP" {
		t.Fatalf("expected X-Real-IP, got %q", rl.trustedHeader)
	}
}

func TestExtractIP_SpoofAttemptBlocked(t *testing.T) {
	rl := &rateLimitMiddleware{trustedHeader: ""}
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("X-Real-IP", "1.2.3.4")
	r.RemoteAddr = "10.0.0.1:9999"

	ip := rl.extractIP(r)
	if ip != "10.0.0.1" {
		t.Fatalf("spoof not blocked: expected 10.0.0.1, got %s", ip)
	}
}
