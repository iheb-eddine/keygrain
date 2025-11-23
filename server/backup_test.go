package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func setupTestServer(t *testing.T) (*backupServer, *httptest.Server) {
	t.Helper()
	s := newBackupServer(t.TempDir())
	mux := http.NewServeMux()
	mux.HandleFunc("/api/backup/", s.backupHandler)
	return s, httptest.NewServer(mux)
}

const validID = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"

func putRequest(url, lookupID, password string, body string) *http.Request {
	req, _ := http.NewRequest(http.MethodPut, url+"/api/backup/"+lookupID, strings.NewReader(body))
	req.SetBasicAuth(lookupID, password)
	return req
}

func getRequest(url, lookupID, password string) *http.Request {
	req, _ := http.NewRequest(http.MethodGet, url+"/api/backup/"+lookupID, nil)
	req.SetBasicAuth(lookupID, password)
	return req
}

func TestPut_NewRecord(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	resp, err := http.DefaultClient.Do(putRequest(ts.URL, validID, "secret123", "encrypted-data"))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	expected := `{"status":"created","etag":"` + expectedETag("encrypted-data") + `"}`
	if string(body) != expected {
		t.Fatalf("unexpected body: %s", body)
	}
}

func TestPut_UpdateRecord(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	http.DefaultClient.Do(putRequest(ts.URL, validID, "secret123", "data1"))

	resp, _ := http.DefaultClient.Do(putRequest(ts.URL, validID, "secret123", "data2"))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	expected := `{"status":"updated","etag":"` + expectedETag("data2") + `"}`
	if string(body) != expected {
		t.Fatalf("unexpected body: %s", body)
	}
}

func TestPut_WrongPassword(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	http.DefaultClient.Do(putRequest(ts.URL, validID, "correct", "data"))

	resp, _ := http.DefaultClient.Do(putRequest(ts.URL, validID, "wrong", "data2"))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestPut_EmptyBody(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	resp, _ := http.DefaultClient.Do(putRequest(ts.URL, validID, "secret", ""))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestPut_OversizedBody(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	bigBody := strings.Repeat("x", 1<<20+1)
	resp, _ := http.DefaultClient.Do(putRequest(ts.URL, validID, "secret", bigBody))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", resp.StatusCode)
	}
}

func TestPut_InvalidLookupID(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	cases := []string{"short", "ZZZZ" + strings.Repeat("0", 60), strings.Repeat("g", 64), ""}
	for _, id := range cases {
		req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/backup/"+id, strings.NewReader("data"))
		req.SetBasicAuth(id, "pass")
		resp, _ := http.DefaultClient.Do(req)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for id %q, got %d", id, resp.StatusCode)
		}
	}
}

func TestPut_UsernameMismatch(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	otherID := strings.Repeat("b", 64)
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/backup/"+validID, strings.NewReader("data"))
	req.SetBasicAuth(otherID, "pass")
	resp, _ := http.DefaultClient.Do(req)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestGet_ExistingRecord(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	http.DefaultClient.Do(putRequest(ts.URL, validID, "secret", "my-encrypted-blob"))

	resp, _ := http.DefaultClient.Do(getRequest(ts.URL, validID, "secret"))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "my-encrypted-blob" {
		t.Fatalf("unexpected body: %s", body)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/octet-stream" {
		t.Fatalf("unexpected content-type: %s", ct)
	}
}

func TestGet_WrongPassword(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	http.DefaultClient.Do(putRequest(ts.URL, validID, "correct", "data"))

	resp, _ := http.DefaultClient.Do(getRequest(ts.URL, validID, "wrong"))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestGet_NotFound(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	resp, _ := http.DefaultClient.Do(getRequest(ts.URL, validID, "secret"))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
}

func TestGet_InvalidLookupID(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/backup/invalid", nil)
	req.SetBasicAuth("invalid", "pass")
	resp, _ := http.DefaultClient.Do(req)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestFullFlow(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	blob := "full-flow-encrypted-data"

	// PUT
	resp, _ := http.DefaultClient.Do(putRequest(ts.URL, validID, "mypass", blob))
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("PUT expected 201, got %d", resp.StatusCode)
	}

	// GET
	resp, _ = http.DefaultClient.Do(getRequest(ts.URL, validID, "mypass"))
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != blob {
		t.Fatalf("GET returned %q, expected %q", body, blob)
	}
}

func TestOverwrite(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", "old-data"))
	http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", "new-data"))

	resp, _ := http.DefaultClient.Do(getRequest(ts.URL, validID, "pass"))
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "new-data" {
		t.Fatalf("expected new-data, got %s", body)
	}
}

func TestConcurrentPuts(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			resp, err := http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", "data"))
			if err != nil {
				t.Errorf("request %d failed: %v", n, err)
				return
			}
			resp.Body.Close()
			if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
				t.Errorf("request %d: unexpected status %d", n, resp.StatusCode)
			}
		}(i)
	}
	wg.Wait()

	// Verify final state is readable
	resp, _ := http.DefaultClient.Do(getRequest(ts.URL, validID, "pass"))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET after concurrent PUTs: expected 200, got %d", resp.StatusCode)
	}
}

func TestMethodNotAllowed(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/backup/"+validID, nil)
	req.SetBasicAuth(validID, "pass")
	resp, _ := http.DefaultClient.Do(req)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", resp.StatusCode)
	}
}

func expectedETag(blob string) string {
	h := sha256.Sum256([]byte(blob))
	return hex.EncodeToString(h[:16])
}

func TestGet_ReturnsETagHeader(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", "blob1"))

	resp, _ := http.DefaultClient.Do(getRequest(ts.URL, validID, "pass"))
	defer resp.Body.Close()

	etag := resp.Header.Get("ETag")
	if etag == "" {
		t.Fatal("expected ETag header, got empty")
	}
	if !strings.HasPrefix(etag, `"`) || !strings.HasSuffix(etag, `"`) {
		t.Fatalf("ETag not quoted: %s", etag)
	}
}

func TestGet_ETagMatchesBlob(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", "test-blob"))

	resp, _ := http.DefaultClient.Do(getRequest(ts.URL, validID, "pass"))
	defer resp.Body.Close()

	etag := strings.Trim(resp.Header.Get("ETag"), `"`)
	expected := expectedETag("test-blob")
	if etag != expected {
		t.Fatalf("ETag %q != expected %q", etag, expected)
	}
}

func TestPut_ReturnsETagInHeaderAndBody(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	// Create
	resp, _ := http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", "data1"))
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	etag := strings.Trim(resp.Header.Get("ETag"), `"`)
	if etag == "" {
		t.Fatal("no ETag header on create")
	}
	if !strings.Contains(string(body), `"etag":"`+etag+`"`) {
		t.Fatalf("body missing etag: %s", body)
	}

	// Update
	resp, _ = http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", "data2"))
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()

	etag = strings.Trim(resp.Header.Get("ETag"), `"`)
	if etag == "" {
		t.Fatal("no ETag header on update")
	}
	if !strings.Contains(string(body), `"etag":"`+etag+`"`) {
		t.Fatalf("body missing etag: %s", body)
	}
}

func TestPut_NoIfMatch_Succeeds(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", "data1"))

	// Update without If-Match should succeed
	resp, _ := http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", "data2"))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestPut_IfMatchCorrect_Succeeds(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	resp, _ := http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", "data1"))
	resp.Body.Close()
	etag := strings.Trim(resp.Header.Get("ETag"), `"`)

	req := putRequest(ts.URL, validID, "pass", "data2")
	req.Header.Set("If-Match", `"`+etag+`"`)
	resp, _ = http.DefaultClient.Do(req)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestPut_IfMatchWrong_Returns412(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	resp, _ := http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", "data1"))
	resp.Body.Close()

	req := putRequest(ts.URL, validID, "pass", "data2")
	req.Header.Set("If-Match", `"`+strings.Repeat("a", 32)+`"`)
	resp, _ = http.DefaultClient.Do(req)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	if resp.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("expected 412, got %d", resp.StatusCode)
	}
	if !strings.Contains(string(body), `"current_etag"`) {
		t.Fatalf("412 body missing current_etag: %s", body)
	}
}

func TestPut_IfMatchStar_Unconditional(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", "data1"))

	req := putRequest(ts.URL, validID, "pass", "data2")
	req.Header.Set("If-Match", "*")
	resp, _ := http.DefaultClient.Do(req)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestPut_FirstPut_IgnoresIfMatch(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	req := putRequest(ts.URL, validID, "pass", "data1")
	req.Header.Set("If-Match", `"`+strings.Repeat("b", 32)+`"`)
	resp, _ := http.DefaultClient.Do(req)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
}

func TestPut_InvalidIfMatch_Returns400(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	cases := []string{`"short"`, `"` + strings.Repeat("g", 32) + `"`, `"` + strings.Repeat("a", 31) + `"`}
	for _, im := range cases {
		req := putRequest(ts.URL, validID, "pass", "data")
		req.Header.Set("If-Match", im)
		resp, _ := http.DefaultClient.Do(req)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for If-Match %q, got %d", im, resp.StatusCode)
		}
	}
}

func TestConflictFlow(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()

	// Device A creates
	resp, _ := http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", "deviceA-v1"))
	resp.Body.Close()
	etagA := strings.Trim(resp.Header.Get("ETag"), `"`)

	// Device A updates
	req := putRequest(ts.URL, validID, "pass", "deviceA-v2")
	req.Header.Set("If-Match", `"`+etagA+`"`)
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()
	etagA2 := strings.Trim(resp.Header.Get("ETag"), `"`)

	// Device B tries with stale ETag → 412
	req = putRequest(ts.URL, validID, "pass", "deviceB-v1")
	req.Header.Set("If-Match", `"`+etagA+`"`)
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("expected 412, got %d", resp.StatusCode)
	}

	// Device B restores (GET)
	resp, _ = http.DefaultClient.Do(getRequest(ts.URL, validID, "pass"))
	resp.Body.Close()
	freshETag := strings.Trim(resp.Header.Get("ETag"), `"`)
	if freshETag != etagA2 {
		t.Fatalf("GET ETag %q != PUT ETag %q", freshETag, etagA2)
	}

	// Device B writes with fresh ETag → success
	req = putRequest(ts.URL, validID, "pass", "deviceB-v1")
	req.Header.Set("If-Match", `"`+freshETag+`"`)
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestGet_LegacyRecord_ComputesETag(t *testing.T) {
	s, ts := setupTestServer(t)
	defer ts.Close()

	// Write a legacy record directly (no etag field)
	blob := "legacy-blob-data"
	record := struct {
		AuthPasswordHash string `json:"auth_password_hash"`
		EncryptedBlob    string `json:"encrypted_blob"`
		CreatedAt        string `json:"created_at"`
		UpdatedAt        string `json:"updated_at"`
	}{}

	// Create via API first to get a valid bcrypt hash, then strip the etag
	resp, _ := http.DefaultClient.Do(putRequest(ts.URL, validID, "pass", blob))
	resp.Body.Close()

	path := filepath.Join(s.dataDir, validID+".json")
	data, _ := os.ReadFile(path)
	json.Unmarshal(data, &record)

	// Rewrite without etag field
	legacyData, _ := json.Marshal(record)
	os.WriteFile(path, legacyData, 0600)

	// GET should still return correct ETag
	resp, _ = http.DefaultClient.Do(getRequest(ts.URL, validID, "pass"))
	defer resp.Body.Close()

	etag := strings.Trim(resp.Header.Get("ETag"), `"`)
	expected := expectedETag(blob)
	if etag != expected {
		t.Fatalf("legacy ETag %q != expected %q", etag, expected)
	}
}
