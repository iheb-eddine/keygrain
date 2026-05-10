package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "9860"
	}

	dataDir := os.Getenv("KEYGRAIN_DATA_DIR")
	if dataDir == "" {
		dataDir = "./data"
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	syncSrv := newSyncServer(dataDir, ctx)
	statsSrv := newStatsServer(dataDir)
	rl := newRateLimitMiddleware(ctx)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/api/sync/", loggingMiddleware(rl.Wrap(syncSrv.syncHandler)))
	mux.HandleFunc("/api/stats", statsSrv.statsHandler)
	mux.Handle("/", http.FileServer(http.Dir("static")))

	log.Printf("keygrain server listening on :%s", port)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; worker-src 'self'")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, `{"status":"ok"}`)
}

type logResponseWriter struct {
	http.ResponseWriter
	status int
	size   int
}

func (w *logResponseWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *logResponseWriter) Write(b []byte) (int, error) {
	n, err := w.ResponseWriter.Write(b)
	w.size += n
	return n, err
}

func (w *logResponseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func loggingMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		lw := &logResponseWriter{ResponseWriter: w, status: 200}
		next(lw, r)
		entry := map[string]interface{}{
			"ts":          start.UTC().Format(time.RFC3339),
			"method":      r.Method,
			"path":        r.URL.Path,
			"status":      lw.status,
			"duration_ms": time.Since(start).Milliseconds(),
			"size":        lw.size,
		}
		if strings.HasPrefix(r.URL.Path, "/api/sync/") {
			id := strings.TrimPrefix(r.URL.Path, "/api/sync/")
			if len(id) >= 8 {
				entry["lookup_prefix"] = id[:8]
			}
			if len(r.URL.Path) > len("/api/sync/")+20 {
				entry["path"] = r.URL.Path[:len("/api/sync/")+20] + "..."
			}
		}
		line, _ := json.Marshal(entry)
		fmt.Fprintln(os.Stdout, string(line))
	}
}
