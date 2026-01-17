package main

import (
	"context"
	"fmt"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

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

func newRateLimiter(capacity float64, refillRate float64) *rateLimiter {
	return &rateLimiter{
		buckets:    make(map[string]*bucket),
		capacity:   capacity,
		refillRate: refillRate,
	}
}

func (rl *rateLimiter) allow(key string) (bool, time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, ok := rl.buckets[key]
	if !ok {
		b = &bucket{tokens: rl.capacity, lastAccess: now}
		rl.buckets[key] = b
	}

	elapsed := now.Sub(b.lastAccess).Seconds()
	if elapsed > 0 {
		b.tokens = math.Min(b.tokens+elapsed*rl.refillRate, rl.capacity)
	}
	b.lastAccess = now

	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}

	retryAfter := time.Duration(math.Ceil((1-b.tokens)/rl.refillRate)) * time.Second
	return false, retryAfter
}

func (rl *rateLimiter) evictStale(ttl time.Duration) {
	threshold := time.Now().Add(-ttl)
	rl.mu.Lock()
	defer rl.mu.Unlock()
	for key, b := range rl.buckets {
		if b.lastAccess.Before(threshold) {
			delete(rl.buckets, key)
		}
	}
}

func (rl *rateLimiter) cleanup(ctx context.Context, interval, ttl time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			rl.evictStale(ttl)
		}
	}
}

type rateLimitMiddleware struct {
	perID         *rateLimiter
	perIP         *rateLimiter
	trustedHeader string
}

func newRateLimitMiddleware(ctx context.Context) *rateLimitMiddleware {
	idBurst := envInt("KEYGRAIN_RATE_LIMIT_ID_BURST", 10)
	idRate := envInt("KEYGRAIN_RATE_LIMIT_ID_RATE", 2)
	ipBurst := envInt("KEYGRAIN_RATE_LIMIT_IP_BURST", 100)
	ipRate := envInt("KEYGRAIN_RATE_LIMIT_IP_RATE", 100)
	trustedHeader := envString("KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER", "X-Real-IP")
	cleanupInterval := envInt("KEYGRAIN_RATE_LIMIT_CLEANUP_INTERVAL", 60)
	evictionTTL := envInt("KEYGRAIN_RATE_LIMIT_EVICTION_TTL", 600)

	rl := &rateLimitMiddleware{
		perID:         newRateLimiter(float64(idBurst), float64(idRate)/60.0),
		perIP:         newRateLimiter(float64(ipBurst), float64(ipRate)/60.0),
		trustedHeader: trustedHeader,
	}

	interval := time.Duration(cleanupInterval) * time.Second
	ttl := time.Duration(evictionTTL) * time.Second
	go rl.perID.cleanup(ctx, interval, ttl)
	go rl.perIP.cleanup(ctx, interval, ttl)

	return rl
}

func (rl *rateLimitMiddleware) Wrap(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := rl.extractIP(r)

		if allowed, retryAfter := rl.perIP.allow(ip); !allowed {
			rl.reject(w, retryAfter)
			return
		}

		lookupID := extractLookupID(r.URL.Path)
		if lookupID != "" {
			if allowed, retryAfter := rl.perID.allow(lookupID); !allowed {
				rl.reject(w, retryAfter)
				return
			}
		}

		next(w, r)
	}
}

func (rl *rateLimitMiddleware) reject(w http.ResponseWriter, retryAfter time.Duration) {
	seconds := int(math.Ceil(retryAfter.Seconds()))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	w.WriteHeader(http.StatusTooManyRequests)
	fmt.Fprintf(w, `{"error":"rate limit exceeded","retry_after":%d}`, seconds)
}

func (rl *rateLimitMiddleware) extractIP(r *http.Request) string {
	if rl.trustedHeader != "" {
		if ip := r.Header.Get(rl.trustedHeader); ip != "" {
			return normalizeIP(ip)
		}
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return normalizeIP(host)
}

func extractLookupID(path string) string {
	const prefix = "/api/sync/"
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	id := path[len(prefix):]
	if strings.Contains(id, "/") {
		return ""
	}
	if !lookupIDRegex.MatchString(id) {
		return ""
	}
	return id
}

func normalizeIP(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ip
	}
	return parsed.String()
}

func envInt(key string, defaultVal int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
		log.Printf("WARN: invalid %s, using default %d", key, defaultVal)
	}
	return defaultVal
}

func envString(key string, defaultVal string) string {
	v, ok := os.LookupEnv(key)
	if !ok {
		return defaultVal
	}
	return v
}
