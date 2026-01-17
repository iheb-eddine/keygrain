# Migration Path: /api/backup/ → /api/sync/

## 1. Overview

When a client syncs for the first time after the v2 update, it must migrate existing data from the old `/api/backup/:id` endpoint to the new `/api/sync/:id` endpoint. This migration is client-driven (the server cannot decrypt blobs) and transparent to the user.

**Flow:**
1. Client calls `GET /api/sync/:id`
2. If 200 → normal sync (no migration needed)
3. If 404 AND `backupMigrated` flag is NOT set → call `GET /api/backup/:id`
4. If backup returns 200 → decrypt blob, normalize services, dedup with local, push to `/api/sync/:id`
5. After successful push → set `backupMigrated = true` locally
6. All subsequent syncs use `/api/sync/` exclusively

## 2. Interface Contracts

### 2.1 Extension: `sync.js` — `syncWithServer` function

**Insertion point:** After `GET /api/sync/:id` returns 404, before proceeding with empty remote state.

**New logic:**

```javascript
// Inside syncWithServer, after getResp.status === 404:
if (getResp.status === 404) {
  const migrated = await chrome.storage.local.get("backupMigrated");
  if (!migrated.backupMigrated) {
    try {
      const backupResp = await fetch(syncServer + "/api/backup/" + lookupId, {
        method: "GET",
        headers: {"Authorization": authHeader},
      });
      if (backupResp.status === 200) {
        const backupBlob = new Uint8Array(await backupResp.arrayBuffer());
        const decrypted = await decryptBlob(encKey, backupBlob);
        const parsed = JSON.parse(new TextDecoder().decode(decrypted));
        const backupServices = (parsed.services || parsed).map(s => ({
          ...s,
          site: normalizeSite(s.site || s.name),
          id: null,
          updated_at: Math.floor(Date.now() / 1000),
        }));
        // Dedup: merge backup into local, local wins on key collision
        localServices = dedup(localServices, backupServices);
      }
    } catch (e) {
      // Non-fatal: proceed with local-only push
    }
  }
}
```

**New helper function:**

```javascript
function dedup(localServices, backupServices) {
  const localKeys = new Set(localServices.map(s =>
    normalizeSite(s.site || s.name) + "\0" + (s.email || "").toLowerCase()
  ));
  const unique = backupServices.filter(s => {
    const key = normalizeSite(s.site || s.name) + "\0" + (s.email || "").toLowerCase();
    return !localKeys.has(key);
  });
  return [...localServices, ...unique];
}
```

**Post-push:** After successful PUT (200/201) when migration occurred:

```javascript
await chrome.storage.local.set({backupMigrated: true});
```

### 2.2 Mobile: `SyncManager.kt` — `sync` function

**Insertion point:** Same — after `GetResult.NotFound`, before proceeding with empty remote.

**New logic:**

```kotlin
is GetResult.NotFound -> {
    if (!getPrefs(context).getBoolean("backup_migrated", false)) {
        try {
            val backupResult = doGetBackup(lookupId, authHeader)
            if (backupResult != null) {
                val plaintext = SyncCrypto.decrypt(encryptionKey, backupResult)
                val json = String(plaintext, Charsets.UTF_8)
                val backupServices = serviceManager.parseJson(json).map {
                    it.copy(id = null, updatedAt = System.currentTimeMillis() / 1000)
                }
                localServices = dedup(localServices, backupServices)
            }
        } catch (_: Exception) {
            // Non-fatal
        }
    }
}
```

**New HTTP helper:**

```kotlin
private fun doGetBackup(lookupId: String, authHeader: String): ByteArray? {
    var conn: HttpURLConnection? = null
    return try {
        conn = (URL("$baseUrl/api/backup/$lookupId").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            setRequestProperty("Authorization", authHeader)
            connectTimeout = 15000
            readTimeout = 15000
        }
        if (conn.responseCode == 200) conn.inputStream.readBytes() else null
    } catch (_: IOException) {
        null
    } finally {
        conn?.disconnect()
    }
}
```

**New dedup helper:**

```kotlin
private fun dedup(local: List<ServiceEntry>, backup: List<ServiceEntry>): List<ServiceEntry> {
    val localKeys = local.map { normalizeSite(it.site) + "\u0000" + it.email.lowercase() }.toSet()
    val unique = backup.filter {
        val key = normalizeSite(it.site) + "\u0000" + it.email.lowercase()
        key !in localKeys
    }
    return local + unique
}
```

**Post-push flag:**

```kotlin
getPrefs(context).edit().putBoolean("backup_migrated", true).apply()
```

### 2.3 Summary of Changes

| File | Change |
|------|--------|
| `extension/shared/sync.js` | Add backup fallback in 404 branch, add `dedup()` function, set `backupMigrated` flag after migration push |
| `kotlin/.../SyncManager.kt` | Add backup fallback in `NotFound` branch, add `doGetBackup()` and `dedup()` helpers, set `backup_migrated` flag |

## 3. Edge Cases

| Case | Behavior |
|------|----------|
| Backup decryption fails (wrong key, corrupt data) | Silently ignored. Proceed with local-only push. |
| Backup returns empty services array | No services to merge. Normal first-sync with local data. |
| Two devices migrate simultaneously | Both push to sync. Second gets 409, re-fetches (sync now has data), normal merge proceeds. |
| User already migrated (sync returns 200) | Backup endpoint never called. |
| Network error on backup GET | Non-fatal. Proceed with local-only push. Next sync will find data in `/api/sync/` if another device migrated. |
| User deletes all services post-migration | `backupMigrated` flag prevents re-fetching old backup. Deleted services stay deleted. |
| Local services overlap with backup services | Dedup by `(normalizeSite(site), email)`. Local wins unconditionally. |
| Old backup has `site` field missing | `normalizeSite(s.site \|\| s.name)` handles this (same pattern as import.js). |
| Old backup uses `{version: 1, services: [...]}` wrapper | Extension: `parsed.services \|\| parsed`. Kotlin: `parseJson` already handles both formats. |

## 4. Test Plan

### Unit Tests

| Test | Input | Expected |
|------|-------|----------|
| `dedup` — no overlap | local: [{site:"a.com", email:"x"}], backup: [{site:"b.com", email:"y"}] | Both included |
| `dedup` — full overlap | local: [{site:"a.com", email:"x"}], backup: [{site:"a.com", email:"x"}] | Only local kept |
| `dedup` — case-insensitive | local: [{site:"A.com", email:"X@Y"}], backup: [{site:"a.com", email:"x@y"}] | Only local kept |
| `dedup` — site normalization | local: [{site:"github.com"}], backup: [{site:"https://www.github.com/"}] | Only local kept (both normalize to "github.com") |
| Backup blob parsing — versioned | `{version:1, services:[...]}` | Extracts services array |
| Backup blob parsing — plain array | `[{name:"x",...}]` | Uses array directly |
| Migration assigns timestamps | Any backup input | All services get `updated_at = now`, `id = null` |

### Integration Tests

| Test | Setup | Expected |
|------|-------|----------|
| Sync 404 + Backup 200 | No sync data, backup has 3 services | Migration triggers, 3 services pushed to sync with `id=null`, `backupMigrated` set |
| Sync 404 + Backup 404 | No data anywhere | Normal first-sync, push local only |
| Sync 404 + Backup decrypt failure | Backup has corrupt blob | Fallback to local-only push, no error shown to user |
| Sync 200 | Sync has data | Backup never called, normal merge |
| Migration + local overlap | Backup has "github/x@y", local has "github/x@y" | Local version kept, backup version discarded |
| Migration + local additions | Backup has "github/x@y", local has "gitlab/x@y" | Both in final push |
| Post-migration flag prevents re-migration | `backupMigrated=true`, sync returns 404 | Backup NOT called, normal empty-remote push |
| Concurrent migration (two devices) | Both get sync 404, both migrate | First push succeeds, second gets 409, retries with merged data |

### Manual Verification

1. Fresh install with existing backup data → first sync migrates transparently
2. Existing user with sync data → no migration attempt
3. After migration, delete all services → they stay deleted (no resurrection from backup)
