package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
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

	syncSrv := newSyncServer(dataDir)
	rl := newRateLimitMiddleware(ctx)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/api/sync/", rl.Wrap(syncSrv.syncHandler))
	mux.Handle("/", http.FileServer(http.Dir("static")))

	log.Printf("keygrain server listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, `{"status":"ok"}`)
}
