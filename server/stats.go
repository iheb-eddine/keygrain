package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type statsResponse struct {
	Active24h int `json:"active_24h"`
	Active7d  int `json:"active_7d"`
	Active30d int `json:"active_30d"`
}

type statsServer struct {
	dataDir string
	mu      sync.Mutex
	cached  statsResponse
	cachedAt time.Time
}

func newStatsServer(dataDir string) *statsServer {
	return &statsServer{dataDir: filepath.Join(dataDir, "sync")}
}

func (s *statsServer) statsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonError(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	if time.Since(s.cachedAt) < time.Hour {
		resp := s.cached
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
		return
	}
	s.mu.Unlock()

	resp := s.computeStats()

	s.mu.Lock()
	s.cached = resp
	s.cachedAt = time.Now()
	s.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *statsServer) computeStats() statsResponse {
	now := time.Now()
	t24h := now.Add(-24 * time.Hour)
	t7d := now.Add(-7 * 24 * time.Hour)
	t30d := now.Add(-30 * 24 * time.Hour)

	entries, err := os.ReadDir(s.dataDir)
	if err != nil {
		return statsResponse{}
	}

	var resp statsResponse
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		mt := info.ModTime()
		if mt.After(t30d) {
			resp.Active30d++
		}
		if mt.After(t7d) {
			resp.Active7d++
		}
		if mt.After(t24h) {
			resp.Active24h++
		}
	}
	return resp
}
