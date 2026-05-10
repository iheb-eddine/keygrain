package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var uuidRegex = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
var lookupIDRegex = regexp.MustCompile(`^[0-9a-f]{64}$`)
var etagRegex = regexp.MustCompile(`^[0-9a-f]{32}$`)

const maxBodySize = 1 << 20 // 1 MB

func jsonError(w http.ResponseWriter, body string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	fmt.Fprint(w, body)
}

func computeETag(blob []byte) string {
	h := sha256.Sum256(blob)
	return hex.EncodeToString(h[:16])
}

func parseIfMatch(header string) (value string, present bool, valid bool) {
	if header == "" {
		return "", false, true
	}
	if header == "*" {
		return "", false, true
	}
	v := strings.Trim(header, `"`)
	if !etagRegex.MatchString(v) {
		return "", true, false
	}
	return v, true, true
}

type serviceMetadata struct {
	ID        *string `json:"id"`
	UpdatedAt int64   `json:"updated_at"`
}

type syncRecord struct {
	AuthPasswordHash string            `json:"auth_password_hash"`
	Services         []serviceMetadata `json:"services"`
	EncryptedBlob    string            `json:"encrypted_blob"`
	Checksum         string            `json:"checksum"`
	ETag             string            `json:"etag"`
	Version          int               `json:"version"`
	CreatedAt        string            `json:"created_at"`
	UpdatedAt        string            `json:"updated_at"`
}

type syncPutRequest struct {
	Services      []serviceMetadata `json:"services"`
	EncryptedBlob string            `json:"encrypted_blob"`
	Checksum      string            `json:"checksum"`
}

type syncGetResponse struct {
	Version       int               `json:"version"`
	Services      []serviceMetadata `json:"services"`
	EncryptedBlob string            `json:"encrypted_blob"`
	Checksum      string            `json:"checksum"`
}

type syncPutResponse struct {
	Services []serviceMetadata `json:"services"`
	Checksum string            `json:"checksum"`
	ETag     string            `json:"etag"`
}

// dummyHash is used to equalize timing between 404 and 401 responses.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("timing-pad"), 12)

type lockEntry struct {
	mu         sync.Mutex
	lastAccess time.Time
	refs       int32
}

type syncServer struct {
	dataDir string
	mu      sync.Mutex
	locks   map[string]*lockEntry
}

func newSyncServer(dataDir string, ctx context.Context) *syncServer {
	dir := filepath.Join(dataDir, "sync")
	s := &syncServer{dataDir: dir, locks: make(map[string]*lockEntry)}
	s.cleanupTmpFiles()
	go s.cleanupLocks(ctx, 60*time.Second, 10*time.Minute)
	return s
}

func (s *syncServer) cleanupTmpFiles() {
	entries, err := os.ReadDir(s.dataDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			os.Remove(filepath.Join(s.dataDir, e.Name()))
		}
	}
}

func (s *syncServer) getLock(lookupID string) *lockEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.locks[lookupID]
	if !ok {
		entry = &lockEntry{}
		s.locks[lookupID] = entry
	}
	entry.lastAccess = time.Now()
	entry.refs++
	return entry
}

func (s *syncServer) releaseLock(lookupID string, entry *lockEntry) {
	entry.mu.Unlock()
	s.mu.Lock()
	entry.refs--
	s.mu.Unlock()
}

func (s *syncServer) cleanupLocks(ctx context.Context, interval, ttl time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			threshold := time.Now().Add(-ttl)
			for k, entry := range s.locks {
				if entry.refs == 0 && entry.lastAccess.Before(threshold) {
					delete(s.locks, k)
				}
			}
			s.mu.Unlock()
		}
	}
}

func (s *syncServer) filePath(lookupID string) string {
	return filepath.Join(s.dataDir, lookupID+".json")
}

func (s *syncServer) syncHandler(w http.ResponseWriter, r *http.Request) {
	lookupID := strings.TrimPrefix(r.URL.Path, "/api/sync/")
	if !lookupIDRegex.MatchString(lookupID) {
		jsonError(w, `{"error":"invalid lookup_id"}`, http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.handleGet(w, r, lookupID)
	case http.MethodPut:
		s.handlePut(w, r, lookupID)
	default:
		jsonError(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

func (s *syncServer) handleGet(w http.ResponseWriter, r *http.Request, lookupID string) {
	username, password, ok := r.BasicAuth()
	if !ok || username != lookupID {
		bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
		jsonError(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	path := s.filePath(lookupID)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
		jsonError(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	var record syncRecord
	if err := json.Unmarshal(data, &record); err != nil {
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(record.AuthPasswordHash), []byte(password)); err != nil {
		jsonError(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	resp := syncGetResponse{
		Version:       record.Version,
		Services:      record.Services,
		EncryptedBlob: record.EncryptedBlob,
		Checksum:      record.Checksum,
	}

	w.Header().Set("ETag", `"`+record.ETag+`"`)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *syncServer) handlePut(w http.ResponseWriter, r *http.Request, lookupID string) {
	username, password, ok := r.BasicAuth()
	if !ok || username != lookupID {
		bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
		jsonError(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	ifMatchValue, ifMatchPresent, ifMatchValid := parseIfMatch(r.Header.Get("If-Match"))
	if !ifMatchValid {
		jsonError(w, `{"error":"invalid If-Match header"}`, http.StatusBadRequest)
		return
	}

	// Authenticate early: acquire lock, read file, verify password BEFORE expensive body parsing.
	// This prevents unauthenticated requests from consuming server resources.
	lock := s.getLock(lookupID)
	lock.mu.Lock()
	defer s.releaseLock(lookupID, lock)

	path := s.filePath(lookupID)
	now := time.Now().UTC().Format(time.RFC3339)
	var record syncRecord
	isNew := false

	existing, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		isNew = true
	} else if err != nil {
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	if !isNew {
		if err := json.Unmarshal(existing, &record); err != nil {
			jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
			return
		}
		if err := bcrypt.CompareHashAndPassword([]byte(record.AuthPasswordHash), []byte(password)); err != nil {
			jsonError(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		// ETag check
		if ifMatchPresent && ifMatchValue != record.ETag {
			jsonError(w, fmt.Sprintf(`{"error":"conflict","current_etag":"%s"}`, record.ETag), http.StatusConflict)
			return
		}
		if !ifMatchPresent {
			jsonError(w, fmt.Sprintf(`{"error":"conflict","current_etag":"%s"}`, record.ETag), http.StatusConflict)
			return
		}
	}

	// Body parsing and validation (only reached after authentication succeeds)
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodySize))
	if err != nil {
		jsonError(w, `{"error":"payload too large"}`, http.StatusRequestEntityTooLarge)
		return
	}

	var req syncPutRequest
	if err := json.Unmarshal(body, &req); err != nil {
		jsonError(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	// Validate services count
	if len(req.Services) > 1000 {
		jsonError(w, `{"error":"validation failed","detail":"too many services"}`, http.StatusUnprocessableEntity)
		return
	}

	// Empty-push protection: reject push with 0 services if existing record has services.
	// This prevents catastrophic data loss from client bugs that send empty service lists.
	if !isNew && len(req.Services) == 0 && len(record.Services) > 0 {
		jsonError(w, `{"error":"validation failed","detail":"cannot overwrite non-empty record with empty services"}`, http.StatusUnprocessableEntity)
		return
	}

	// Validate timestamps and IDs
	seenIDs := make(map[string]bool, len(req.Services))
	for _, svc := range req.Services {
		if svc.UpdatedAt <= 0 {
			jsonError(w, `{"error":"validation failed","detail":"invalid timestamp"}`, http.StatusUnprocessableEntity)
			return
		}
		if svc.ID == nil {
			jsonError(w, `{"error":"validation failed","detail":"id required"}`, http.StatusUnprocessableEntity)
			return
		}
		if !uuidRegex.MatchString(*svc.ID) {
			jsonError(w, `{"error":"validation failed","detail":"invalid id format"}`, http.StatusUnprocessableEntity)
			return
		}
		if seenIDs[*svc.ID] {
			jsonError(w, `{"error":"validation failed","detail":"duplicate id"}`, http.StatusUnprocessableEntity)
			return
		}
		seenIDs[*svc.ID] = true
	}

	// Validate checksum
	blobBytes, err := base64.StdEncoding.DecodeString(req.EncryptedBlob)
	if err != nil {
		jsonError(w, `{"error":"validation failed","detail":"invalid blob encoding"}`, http.StatusUnprocessableEntity)
		return
	}
	expectedChecksum := sha256Hex(blobBytes)
	if req.Checksum != expectedChecksum {
		jsonError(w, `{"error":"validation failed","detail":"checksum mismatch"}`, http.StatusUnprocessableEntity)
		return
	}

	if isNew {
		hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
		if err != nil {
			jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
			return
		}
		record.AuthPasswordHash = string(hash)
		record.CreatedAt = now
	}

	newETag := computeETag(blobBytes)
	record.Services = req.Services
	record.EncryptedBlob = req.EncryptedBlob
	record.Checksum = req.Checksum
	record.ETag = newETag
	if isNew {
		record.Version = 1
	} else {
		record.Version++
	}
	record.UpdatedAt = now

	if err := os.MkdirAll(s.dataDir, 0700); err != nil {
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(record)
	if err != nil {
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	tmpPath := path + ".tmp"
	f, err := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmpPath)
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmpPath)
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	if err := f.Close(); err != nil {
		os.Remove(tmpPath)
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	resp := syncPutResponse{
		Services: req.Services,
		Checksum: req.Checksum,
		ETag:     newETag,
	}

	w.Header().Set("ETag", `"`+newETag+`"`)
	w.Header().Set("Content-Type", "application/json")
	if isNew {
		w.WriteHeader(http.StatusCreated)
	}
	json.NewEncoder(w).Encode(resp)
}

func sha256Hex(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}
