package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestVersionEmbed(t *testing.T) {
	v := strings.TrimSpace(version)
	if v == "" {
		t.Fatal("embedded version is empty")
	}
	expected, err := os.ReadFile("VERSION")
	if err != nil {
		t.Fatalf("reading VERSION file: %v", err)
	}
	if v != strings.TrimSpace(string(expected)) {
		t.Fatalf("embedded version %q != VERSION file %q", v, strings.TrimSpace(string(expected)))
	}
}

func TestHealthHandler(t *testing.T) {
	rec := httptest.NewRecorder()
	healthHandler(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if resp["status"] != "ok" {
		t.Fatalf("status = %q, want \"ok\"", resp["status"])
	}
	if resp["version"] != strings.TrimSpace(version) {
		t.Fatalf("version = %q, want %q", resp["version"], strings.TrimSpace(version))
	}
}
