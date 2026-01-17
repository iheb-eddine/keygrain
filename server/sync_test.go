package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func setupSyncServer(t *testing.T) *httptest.Server {
	t.Helper()
	s := newSyncServer(t.TempDir())
	mux := http.NewServeMux()
	mux.HandleFunc("/api/sync/", s.syncHandler)
	return httptest.NewServer(mux)
}

func syncBlob(data string) (encoded string, checksum string) {
	raw := []byte(data)
	encoded = base64.StdEncoding.EncodeToString(raw)
	h := sha256.Sum256(raw)
	checksum = hex.EncodeToString(h[:])
	return
}

func syncPutBody(services string, blobData string) string {
	encoded, checksum := syncBlob(blobData)
	return `{"services":` + services + `,"encrypted_blob":"` + encoded + `","checksum":"` + checksum + `"}`
}

func syncPut(url, lookupID, password, body string) *http.Request {
	req, _ := http.NewRequest(http.MethodPut, url+"/api/sync/"+lookupID, strings.NewReader(body))
	req.SetBasicAuth(lookupID, password)
	req.Header.Set("Content-Type", "application/json")
	return req
}

func syncGet(url, lookupID, password string) *http.Request {
	req, _ := http.NewRequest(http.MethodGet, url+"/api/sync/"+lookupID, nil)
	req.SetBasicAuth(lookupID, password)
	return req
}

func TestSync_PutNewUser(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	body := syncPutBody(`[{"id":null,"updated_at":1000}]`, "encrypted")
	resp, err := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, b)
	}

	var result syncPutResponse
	json.NewDecoder(resp.Body).Decode(&result)

	if len(result.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(result.Services))
	}
	if result.Services[0].ID == nil {
		t.Fatal("expected UUID to be assigned")
	}
	if !uuidRegex.MatchString(*result.Services[0].ID) {
		t.Fatalf("invalid UUID: %s", *result.Services[0].ID)
	}
	if result.ETag == "" {
		t.Fatal("expected etag in response")
	}
}

func TestSync_PutExistingUser(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	// Create
	body := syncPutBody(`[{"id":null,"updated_at":1000}]`, "blob1")
	resp, _ := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	var createResp syncPutResponse
	json.NewDecoder(resp.Body).Decode(&createResp)
	resp.Body.Close()
	etag := strings.Trim(resp.Header.Get("ETag"), `"`)

	// Update with correct If-Match
	existingID := *createResp.Services[0].ID
	body = syncPutBody(`[{"id":"`+existingID+`","updated_at":2000},{"id":null,"updated_at":2000}]`, "blob2")
	req := syncPut(ts.URL, validID, "pass", body)
	req.Header.Set("If-Match", `"`+etag+`"`)
	resp, _ = http.DefaultClient.Do(req)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, b)
	}

	var updateResp syncPutResponse
	json.NewDecoder(resp.Body).Decode(&updateResp)
	if len(updateResp.Services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(updateResp.Services))
	}
	if *updateResp.Services[0].ID != existingID {
		t.Fatal("existing UUID should be preserved")
	}
	if updateResp.Services[1].ID == nil {
		t.Fatal("new service should get UUID")
	}
}

func TestSync_PutWrongIfMatch(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	body := syncPutBody(`[{"id":null,"updated_at":1000}]`, "blob1")
	resp, _ := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	resp.Body.Close()

	// Try with wrong etag
	body = syncPutBody(`[{"id":null,"updated_at":2000}]`, "blob2")
	req := syncPut(ts.URL, validID, "pass", body)
	req.Header.Set("If-Match", `"`+strings.Repeat("a", 32)+`"`)
	resp, _ = http.DefaultClient.Do(req)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409, got %d", resp.StatusCode)
	}
	b, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(b), "current_etag") {
		t.Fatalf("expected current_etag in body: %s", b)
	}
}

func TestSync_PutMissingIfMatch(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	// Create first
	body := syncPutBody(`[{"id":null,"updated_at":1000}]`, "blob1")
	resp, _ := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	resp.Body.Close()

	// Update without If-Match should fail with 409
	body = syncPutBody(`[{"id":null,"updated_at":2000}]`, "blob2")
	resp, _ = http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409, got %d", resp.StatusCode)
	}
}

func TestSync_PutInvalidChecksum(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	encoded := base64.StdEncoding.EncodeToString([]byte("data"))
	body := `{"services":[{"id":null,"updated_at":1000}],"encrypted_blob":"` + encoded + `","checksum":"` + strings.Repeat("a", 64) + `"}`
	resp, _ := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}
}

func TestSync_PutInvalidTimestamp(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	body := syncPutBody(`[{"id":null,"updated_at":0}]`, "data")
	resp, _ := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}
}

func TestSync_PutInvalidUUID(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	body := syncPutBody(`[{"id":"not-a-uuid","updated_at":1000}]`, "data")
	resp, _ := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}
}

func TestSync_PutTooManyServices(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	// Build 1001 services
	var svcs []string
	for i := 0; i < 1001; i++ {
		svcs = append(svcs, `{"id":null,"updated_at":1000}`)
	}
	body := syncPutBody("["+strings.Join(svcs, ",")+"]", "data")
	resp, _ := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}
}

func TestSync_PutEmptyServices(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	body := syncPutBody(`[]`, "data")
	resp, _ := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, b)
	}
}

func TestSync_GetExisting(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	body := syncPutBody(`[{"id":null,"updated_at":1000}]`, "my-blob")
	resp, _ := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	resp.Body.Close()

	resp, _ = http.DefaultClient.Do(syncGet(ts.URL, validID, "pass"))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var result syncGetResponse
	json.NewDecoder(resp.Body).Decode(&result)
	if result.Version != 1 {
		t.Fatalf("expected version 1, got %d", result.Version)
	}
	if len(result.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(result.Services))
	}
	if result.EncryptedBlob == "" {
		t.Fatal("expected encrypted_blob")
	}
	if result.Checksum == "" {
		t.Fatal("expected checksum")
	}
	if resp.Header.Get("ETag") == "" {
		t.Fatal("expected ETag header")
	}
}

func TestSync_GetNotFound(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	resp, _ := http.DefaultClient.Do(syncGet(ts.URL, validID, "pass"))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
}

func TestSync_GetWrongPassword(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	body := syncPutBody(`[{"id":null,"updated_at":1000}]`, "data")
	resp, _ := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	resp.Body.Close()

	resp, _ = http.DefaultClient.Do(syncGet(ts.URL, validID, "wrong"))
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestSync_PutWrongPassword(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	body := syncPutBody(`[{"id":null,"updated_at":1000}]`, "data")
	resp, _ := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	resp.Body.Close()
	etag := strings.Trim(resp.Header.Get("ETag"), `"`)

	body = syncPutBody(`[{"id":null,"updated_at":2000}]`, "data2")
	req := syncPut(ts.URL, validID, "wrong", body)
	req.Header.Set("If-Match", `"`+etag+`"`)
	resp, _ = http.DefaultClient.Do(req)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestSync_UUIDPreservation(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	body := syncPutBody(`[{"id":null,"updated_at":1000},{"id":null,"updated_at":1000}]`, "blob1")
	resp, _ := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	var r1 syncPutResponse
	json.NewDecoder(resp.Body).Decode(&r1)
	resp.Body.Close()
	etag := strings.Trim(resp.Header.Get("ETag"), `"`)

	id0 := *r1.Services[0].ID
	id1 := *r1.Services[1].ID

	// Push again with existing IDs
	body = syncPutBody(`[{"id":"`+id0+`","updated_at":2000},{"id":"`+id1+`","updated_at":2000}]`, "blob2")
	req := syncPut(ts.URL, validID, "pass", body)
	req.Header.Set("If-Match", `"`+etag+`"`)
	resp, _ = http.DefaultClient.Do(req)
	var r2 syncPutResponse
	json.NewDecoder(resp.Body).Decode(&r2)
	resp.Body.Close()

	if *r2.Services[0].ID != id0 || *r2.Services[1].ID != id1 {
		t.Fatal("existing UUIDs should be preserved")
	}
}

func TestSync_ConcurrentPuts(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	// Create initial
	body := syncPutBody(`[{"id":null,"updated_at":1000}]`, "initial")
	resp, _ := http.DefaultClient.Do(syncPut(ts.URL, validID, "pass", body))
	resp.Body.Close()
	etag := strings.Trim(resp.Header.Get("ETag"), `"`)

	var wg sync.WaitGroup
	results := make([]int, 10)
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			b := syncPutBody(`[{"id":null,"updated_at":2000}]`, "concurrent-"+string(rune('a'+n)))
			req := syncPut(ts.URL, validID, "pass", b)
			req.Header.Set("If-Match", `"`+etag+`"`)
			r, _ := http.DefaultClient.Do(req)
			results[n] = r.StatusCode
			r.Body.Close()
		}(i)
	}
	wg.Wait()

	successes := 0
	conflicts := 0
	for _, code := range results {
		if code == http.StatusOK {
			successes++
		} else if code == http.StatusConflict {
			conflicts++
		}
	}
	if successes != 1 {
		t.Fatalf("expected exactly 1 success, got %d (conflicts: %d)", successes, conflicts)
	}
}

func TestSync_MethodNotAllowed(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/sync/"+validID, nil)
	req.SetBasicAuth(validID, "pass")
	resp, _ := http.DefaultClient.Do(req)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", resp.StatusCode)
	}
}

func TestSync_InvalidLookupID(t *testing.T) {
	ts := setupSyncServer(t)
	defer ts.Close()

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/sync/invalid", nil)
	req.SetBasicAuth("invalid", "pass")
	resp, _ := http.DefaultClient.Do(req)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}
