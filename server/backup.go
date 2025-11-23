package main

import (
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

var lookupIDRegex = regexp.MustCompile(`^[0-9a-f]{64}$`)

func jsonError(w http.ResponseWriter, body string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	fmt.Fprint(w, body)
}

const maxBodySize = 1 << 20 // 1 MB

// backupRecord is the JSON schema stored on disk for each backup.
type backupRecord struct {
	AuthPasswordHash string `json:"auth_password_hash"`
	EncryptedBlob    string `json:"encrypted_blob"`
	ETag             string `json:"etag,omitempty"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

var etagRegex = regexp.MustCompile(`^[0-9a-f]{32}$`)

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

// backupServer holds shared state for the backup handler.
type backupServer struct {
	dataDir string
	mu      sync.Mutex
	locks   map[string]*sync.Mutex
}

// newBackupServer creates a backupServer with the given data directory.
func newBackupServer(dataDir string) *backupServer {
	return &backupServer{
		dataDir: dataDir,
		locks:   make(map[string]*sync.Mutex),
	}
}

func (s *backupServer) getLock(lookupID string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.locks[lookupID]; !ok {
		s.locks[lookupID] = &sync.Mutex{}
	}
	return s.locks[lookupID]
}

func (s *backupServer) filePath(lookupID string) string {
	return filepath.Join(s.dataDir, lookupID+".json")
}

// backupHandler routes PUT/GET requests to the appropriate sub-handler.
func (s *backupServer) backupHandler(w http.ResponseWriter, r *http.Request) {
	lookupID := r.URL.Path[len("/api/backup/"):]
	if !lookupIDRegex.MatchString(lookupID) {
		jsonError(w, `{"error":"invalid lookup_id"}`, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodPut:
		s.handlePut(w, r, lookupID)
	case http.MethodGet:
		s.handleGet(w, r, lookupID)
	default:
		jsonError(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// handlePut stores or updates the encrypted blob for the given lookup_id.
func (s *backupServer) handlePut(w http.ResponseWriter, r *http.Request, lookupID string) {
	username, password, ok := r.BasicAuth()
	if !ok || username != lookupID {
		jsonError(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	// Parse If-Match early (format validation only, no existence leak)
	ifMatchValue, ifMatchPresent, ifMatchValid := parseIfMatch(r.Header.Get("If-Match"))
	if !ifMatchValid {
		jsonError(w, `{"error":"invalid If-Match header"}`, http.StatusBadRequest)
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodySize))
	if err != nil {
		jsonError(w, `{"error":"payload too large"}`, http.StatusRequestEntityTooLarge)
		return
	}
	if len(body) == 0 {
		jsonError(w, `{"error":"empty body"}`, http.StatusBadRequest)
		return
	}

	lock := s.getLock(lookupID)
	lock.Lock()
	defer lock.Unlock()

	path := s.filePath(lookupID)
	now := time.Now().UTC().Format(time.RFC3339)
	var record backupRecord

	existing, err := os.ReadFile(path)
	isNew := os.IsNotExist(err)

	if err != nil && !isNew {
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

		// If-Match check (after auth, only for existing records)
		if ifMatchPresent {
			currentETag := record.ETag
			if currentETag == "" {
				// Legacy record: compute on-the-fly
				blob, err := base64.StdEncoding.DecodeString(record.EncryptedBlob)
				if err != nil {
					jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
					return
				}
				currentETag = computeETag(blob)
			}
			if ifMatchValue != currentETag {
				jsonError(w, fmt.Sprintf(`{"error":"precondition failed","current_etag":"%s"}`, currentETag), http.StatusPreconditionFailed)
				return
			}
		}

		record.EncryptedBlob = base64.StdEncoding.EncodeToString(body)
		record.ETag = computeETag(body)
		record.UpdatedAt = now
	} else {
		hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
		if err != nil {
			jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
			return
		}
		record = backupRecord{
			AuthPasswordHash: string(hash),
			EncryptedBlob:    base64.StdEncoding.EncodeToString(body),
			ETag:             computeETag(body),
			CreatedAt:        now,
			UpdatedAt:        now,
		}
	}

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
	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	newETag := record.ETag
	w.Header().Set("ETag", `"`+newETag+`"`)
	w.Header().Set("Content-Type", "application/json")
	if isNew {
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintf(w, `{"status":"created","etag":"%s"}`, newETag)
	} else {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"updated","etag":"%s"}`, newETag)
	}
}

// handleGet retrieves the stored encrypted blob for the given lookup_id.
func (s *backupServer) handleGet(w http.ResponseWriter, r *http.Request, lookupID string) {
	username, password, ok := r.BasicAuth()
	if !ok || username != lookupID {
		jsonError(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	path := s.filePath(lookupID)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		jsonError(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	var record backupRecord
	if err := json.Unmarshal(data, &record); err != nil {
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(record.AuthPasswordHash), []byte(password)); err != nil {
		jsonError(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	blob, err := base64.StdEncoding.DecodeString(record.EncryptedBlob)
	if err != nil {
		jsonError(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	etag := record.ETag
	if etag == "" {
		etag = computeETag(blob)
	}

	w.Header().Set("ETag", `"`+etag+`"`)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Write(blob)
}
