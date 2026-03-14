package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStatsHandler(t *testing.T) {
	dir := t.TempDir()
	syncDir := filepath.Join(dir, "sync")
	os.MkdirAll(syncDir, 0700)

	// Create files with various mtimes
	now := time.Now()
	files := []struct {
		name string
		age  time.Duration
	}{
		{"aaa.json", 1 * time.Hour},   // within 24h
		{"bbb.json", 2 * time.Hour},   // within 24h
		{"ccc.json", 3 * 24 * time.Hour}, // within 7d
		{"ddd.json", 10 * 24 * time.Hour}, // within 30d
		{"eee.json", 40 * 24 * time.Hour}, // outside 30d
	}

	for _, f := range files {
		p := filepath.Join(syncDir, f.name)
		os.WriteFile(p, []byte(`{}`), 0600)
		mt := now.Add(-f.age)
		os.Chtimes(p, mt, mt)
	}

	// Also create a non-json file (should be ignored)
	os.WriteFile(filepath.Join(syncDir, "readme.txt"), []byte("hi"), 0600)

	srv := newStatsServer(dir)
	req := httptest.NewRequest(http.MethodGet, "/api/stats", nil)
	w := httptest.NewRecorder()
	srv.statsHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp statsResponse
	json.NewDecoder(w.Body).Decode(&resp)

	if resp.Active24h != 2 {
		t.Errorf("active_24h: want 2, got %d", resp.Active24h)
	}
	if resp.Active7d != 3 {
		t.Errorf("active_7d: want 3, got %d", resp.Active7d)
	}
	if resp.Active30d != 4 {
		t.Errorf("active_30d: want 4, got %d", resp.Active30d)
	}
}

func TestStatsHandlerEmptyDir(t *testing.T) {
	dir := t.TempDir() // no "sync" subdir exists
	srv := newStatsServer(dir)

	req := httptest.NewRequest(http.MethodGet, "/api/stats", nil)
	w := httptest.NewRecorder()
	srv.statsHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp statsResponse
	json.NewDecoder(w.Body).Decode(&resp)

	if resp.Active24h != 0 || resp.Active7d != 0 || resp.Active30d != 0 {
		t.Errorf("expected all zeros, got %+v", resp)
	}
}

func TestStatsHandlerMethodNotAllowed(t *testing.T) {
	srv := newStatsServer(t.TempDir())
	req := httptest.NewRequest(http.MethodPost, "/api/stats", nil)
	w := httptest.NewRecorder()
	srv.statsHandler(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}
