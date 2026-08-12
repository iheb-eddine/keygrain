// sync.js — Sync v2: per-service merge (depends on keygrain.js)
const DEFAULT_SYNC_SERVER = "https://keygrain.com";

async function getSyncServer() {
  const data = await chrome.storage.local.get("settings");
  return (data.settings && data.settings.serverUrl) || DEFAULT_SYNC_SERVER;
}

async function deriveLookupId(secret, email) {
  const enc = new TextEncoder();
  const strengthenGeneration = getStrengthenGeneration();
  const strengthened = await strengthenSecret(secret, email);
  assertStrengthenGeneration(strengthenGeneration);
  const message = enc.encode(email.toLowerCase() + ":keygrain-id");
  const hash = await hmacSHA256(strengthened, message);
  assertStrengthenGeneration(strengthenGeneration);
  return Array.from(hash, b => b.toString(16).padStart(2, "0")).join("");
}

async function deriveEncryptionKey(secret, email) {
  const enc = new TextEncoder();
  const strengthenGeneration = getStrengthenGeneration();
  const strengthened = await strengthenSecret(secret, email);
  assertStrengthenGeneration(strengthenGeneration);
  const message = enc.encode(email.toLowerCase() + ":keygrain-encryption");
  const key = await hmacSHA256(strengthened, message);
  assertStrengthenGeneration(strengthenGeneration);
  return key;
}

async function encryptBlob(keyBytes, plaintext, additionalData) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, {name: "AES-GCM"}, false, ["encrypt"]);
  const params = {name: "AES-GCM", iv};
  if (additionalData) params.additionalData = additionalData;
  const ciphertext = await crypto.subtle.encrypt(params, cryptoKey, plaintext);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv);
  result.set(new Uint8Array(ciphertext), 12);
  return result;
}

async function decryptBlob(keyBytes, blob, additionalData) {
  const iv = blob.slice(0, 12);
  const ciphertext = blob.slice(12);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, {name: "AES-GCM"}, false, ["decrypt"]);
  const params = {name: "AES-GCM", iv};
  if (additionalData) params.additionalData = additionalData;
  return new Uint8Array(await crypto.subtle.decrypt(params, cryptoKey, ciphertext));
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(data) {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

// Metadata cache tamper detection
class MetadataTamperError extends Error {
  constructor(violations) {
    super("Metadata integrity check failed");
    this.name = "MetadataTamperError";
    this.violations = violations;
  }
}

async function getMetadataCache() {
  const data = await chrome.storage.local.get("syncMetadataCache");
  return data.syncMetadataCache || null;
}

async function setMetadataCache(metadata) {
  await chrome.storage.local.set({ syncMetadataCache: metadata });
}

function validateMetadataIntegrity(receivedMetadata, cachedMetadata) {
  const violations = [];
  const receivedById = new Map(receivedMetadata.map(m => [m.id, m]));

  // Check 1: Order consistency (relative order of shared UUIDs must be preserved)
  const cachedOrder = cachedMetadata.map(m => m.id);
  const receivedOrder = receivedMetadata.map(m => m.id);
  const sharedIds = new Set(cachedOrder.filter(id => receivedById.has(id)));
  const sharedInCachedOrder = cachedOrder.filter(id => sharedIds.has(id));
  const sharedInReceivedOrder = receivedOrder.filter(id => sharedIds.has(id));
  for (let i = 0; i < sharedInCachedOrder.length; i++) {
    if (sharedInCachedOrder[i] !== sharedInReceivedOrder[i]) {
      violations.push({ check: "order", details: "Relative order of UUIDs changed" });
      break;
    }
  }

  // Check 2: Timestamp monotonicity
  const cachedById = new Map(cachedMetadata.map(m => [m.id, m]));
  for (const received of receivedMetadata) {
    const cached = cachedById.get(received.id);
    if (cached && received.updated_at < cached.updated_at) {
      violations.push({ check: "timestamp", details: `UUID ${received.id}: updated_at went from ${cached.updated_at} to ${received.updated_at}` });
    }
  }

  if (violations.length > 0) {
    throw new MetadataTamperError(violations);
  }
}

// Bounded jittered backoff for the 409 (ETag conflict) retry chain.
const CONFLICT_BACKOFF_MS = [250, 1000, 3000];

function sleepWithJitter(ms) {
  const jittered = ms * (0.75 + Math.random() * 0.5); // +/-25%
  return new Promise(r => setTimeout(r, jittered));
}

// lastSuccessfulSyncAt is the causal barrier used to tell a routine remote deletion
// (apply silently) from one that would destroy an unsynced local change (retain for
// review). It is advanced ONLY on a fully confirmed sync — Frozen Req 8.
async function getLastSuccessfulSyncAt() {
  const data = await chrome.storage.local.get("lastSuccessfulSyncAt");
  return data.lastSuccessfulSyncAt || 0;
}

async function setLastSuccessfulSyncAt(ts) {
  await chrome.storage.local.set({lastSuccessfulSyncAt: ts});
}

// Known wallet keys (wallet_name:chain pairs seen from server)
async function getKnownWalletKeys() {
  const data = await chrome.storage.local.get("syncKnownWalletKeys");
  return new Set(data.syncKnownWalletKeys || []);
}

async function setKnownWalletKeys(keys) {
  await chrome.storage.local.set({syncKnownWalletKeys: [...keys]});
}

function walletKey(w) {
  return w.wallet_name.toLowerCase() + ":" + w.chain.toLowerCase();
}

/**
 * Merge local and remote wallets.
 * Merge key: wallet_name + chain (lowercased).
 * Conflict: most recent updated_at wins (falls back to created_at if updated_at absent).
 * Absence = deletion (same as services).
 */
function mergeWallets(localWallets, remoteWallets, knownWalletKeys) {
  const remoteByKey = new Map();
  for (const w of remoteWallets) remoteByKey.set(walletKey(w), w);

  const localByKey = new Map();
  for (const w of localWallets) localByKey.set(walletKey(w), w);

  const merged = [];

  // Remote wallets
  for (const [key, remote] of remoteByKey) {
    const local = localByKey.get(key);
    if (local) {
      // Both have it — most recent updated_at wins
      const localTs = local.updated_at || local.created_at || "";
      const remoteTs = remote.updated_at || remote.created_at || "";
      merged.push(localTs > remoteTs ? local : remote);
      localByKey.delete(key);
    } else {
      // Remote-only: new or deleted locally?
      if (knownWalletKeys.has(key)) {
        // Was known → deleted locally → don't include
      } else {
        merged.push(remote);
      }
    }
  }

  // Local-only wallets not in remote
  for (const [key, local] of localByKey) {
    if (remoteByKey.has(key)) continue;
    if (knownWalletKeys.has(key)) {
      // Was known remotely but now absent → deleted remotely → don't include
    } else {
      // New locally
      merged.push(local);
    }
  }

  const newKnownKeys = new Set(merged.map(w => walletKey(w)));
  return {merged, knownWalletKeys: newKnownKeys};
}

/**
 * Merge audit logs by union. Deduplicate by timestamp+wallet_name+chain+action.
 */
function mergeAuditLog(localLog, remoteLog) {
  const seen = new Set();
  const merged = [];
  for (const entry of [...localLog, ...remoteLog]) {
    const key = entry.timestamp + ":" + entry.wallet_name + ":" + entry.chain + ":" + entry.action;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged;
}

/**
 * Parse decrypted blob content. Handles both legacy (flat array) and new format.
 */
function parseBlobContent(parsed) {
  if (Array.isArray(parsed)) {
    return {services: parsed, wallets: [], wallet_audit_log: [], sync_conflicts: []};
  }
  return {
    services: parsed.services || [],
    wallets: parsed.wallets || [],
    wallet_audit_log: parsed.wallet_audit_log || [],
    sync_conflicts: parsed.sync_conflicts || []
  };
}

/**
 * Sync v3 deletion reconciliation.
 * See designs/sync-deletion-reconciliation.md §2.
 *
 * The central invariant: `synced === true` means a record bearing this id has been
 * confirmed present on the server at least once. It is a property of IDENTITY, not of
 * content — editing a service MUST NOT clear it, or rule 6 becomes unreachable for
 * edited records and deleted services resurrect.
 *
 * localServices:  [{id, site, email, ..., updated_at, synced}]
 * localTombstones:[{id, deleted_at}]  pending local deletions
 * remoteServices: decrypted blob service contents, index-aligned with remoteMetadata
 * remoteMetadata: [{id, updated_at}] from the server response
 * lastSyncAt:     lastSuccessfulSyncAt (ms); 0 when never synced
 *
 * Returns {merged, tombstones, deletedIds, review, resurrected, syncConflicts}
 *   merged      — services to keep locally and push
 *   tombstones  — tombstones to retain (cleared ones are dropped)
 *   deletedIds  — ids to declare in the PUT (only ids the server still holds)
 *   review      — records deleted remotely that this device had unsynced changes to
 *   resurrected — ids where a newer remote edit superseded a pending local deletion
 */
function reconcileServices(localServices, localTombstones, remoteServices, remoteMetadata, lastSyncAt, remoteExists = true) {
  const remoteByID = new Map();
  for (let i = 0; i < remoteMetadata.length; i++) {
    if (!remoteMetadata[i] || !remoteMetadata[i].id) continue;
    remoteByID.set(remoteMetadata[i].id, {
      ...remoteServices[i],
      id: remoteMetadata[i].id,
      updated_at: remoteMetadata[i].updated_at
    });
  }

  const localByID = new Map();
  const localWithoutId = [];
  for (const svc of localServices) {
    if (!svc) continue;
    if (svc.id) localByID.set(svc.id, svc);
    // Legacy records (pre-UUID v1 stores) can lack an id. They MUST be given one and
    // treated as unsynced creates — dropping them would silently lose the service. This
    // mirrors the same branch in SyncManager.kt.
    else localWithoutId.push(svc);
  }

  // Latest deletion intent per id.
  const tombByID = new Map();
  for (const t of localTombstones) {
    if (!t || !t.id) continue;
    const prev = tombByID.get(t.id);
    if (!prev || t.deleted_at > prev) tombByID.set(t.id, t.deleted_at);
  }

  let merged = [];
  let tombstones = [];
  let deletedIds = [];
  let review = [];
  const resurrected = [];

  if (!remoteExists) {
    // Frozen Req 11: no server record (fresh account, or server-side data loss). This is
    // NEVER interpreted as deletions — otherwise a lost blob would wipe every device.
    // Everything local is re-created, and pending tombstones are dropped because the
    // server holds nothing to delete.
    merged = localServices.filter(s => s && s.id).map(s => ({...s, synced: false}));
  } else {
    const allIds = new Set([...localByID.keys(), ...remoteByID.keys(), ...tombByID.keys()]);

    for (const id of allIds) {
      const L = localByID.get(id);
      const R = remoteByID.get(id);
      const T = tombByID.get(id);

      if (T !== undefined) {
        if (R && R.updated_at > T) {
          // Rule 7: a newer remote edit supersedes this pending deletion.
          merged.push({...R, synced: true});
          resurrected.push(id);
          // tombstone dropped
        } else {
          // Stays deleted. Declare it only if the server still holds it; otherwise the
          // deletion is already reflected remotely and the tombstone can be cleared
          // without forcing a PUT (§3 step 3, §4).
          if (R) {
            deletedIds.push(id);
            tombstones.push({id, deleted_at: T});
          }
        }
        continue;
      }

      if (L && R) {
        // Rules 1-3: newer wins, remote wins ties.
        const winner = L.updated_at > R.updated_at ? L : R;
        merged.push({...winner, id, synced: true});
        continue;
      }

      if (L) {
        if (!L.synced) {
          // Rule 4: never reached the server yet -> create remotely. Never deleted.
          merged.push(L);
        } else {
          // Rule 6: it was on the server and is now gone -> deleted elsewhere.
          // Retain for review ONLY when this device holds an unsynced change to it
          // (Frozen Req 7). Routine deletions leave no trace.
          if (L.updated_at > lastSyncAt) {
            review.push({service: L, deleted_at: Date.now(), seen: false});
          }
          // No tombstone: the server already lacks it.
        }
        continue;
      }

      // Rule 5: remote-only, no tombstone -> create locally.
      merged.push({...R, synced: true});
    }
  }

  // Legacy records with no id yet: assign one and treat as unsynced creates (rule 4).
  for (const svc of localWithoutId) {
    merged.push({...svc, id: crypto.randomUUID(), synced: false});
  }

  // Second pass — semantic duplicate collapse by (normalizeSite(site), email).
  // Unchanged from v2 except that a synced loser is now tombstoned + declared so the
  // duplicate is removed server-side instead of merely dropped locally.
  const seen = new Map();
  const syncConflicts = [];
  for (const svc of merged) {
    const key = (normalizeSite(svc.site) || svc.id) + "\n" + (svc.email || "").toLowerCase();
    const existing = seen.get(key);
    if (!existing) { seen.set(key, svc); continue; }
    let winner, loser;
    if (svc.updated_at > existing.updated_at || (svc.updated_at === existing.updated_at && svc.id < existing.id)) {
      winner = svc; loser = existing;
    } else {
      winner = existing; loser = svc;
    }
    seen.set(key, winner);
    if (loser.length !== winner.length || loser.symbols !== winner.symbols ||
        loser.counter !== winner.counter ||
        JSON.stringify(loser.totp || null) !== JSON.stringify(winner.totp || null) ||
        JSON.stringify(loser.ssh || null) !== JSON.stringify(winner.ssh || null)) {
      syncConflicts.push({winner_id: winner.id, loser, detected_at: new Date().toISOString()});
    }
    if (loser.synced && remoteByID.has(loser.id)) {
      if (!deletedIds.includes(loser.id)) deletedIds.push(loser.id);
      if (!tombstones.some(t => t.id === loser.id)) tombstones.push({id: loser.id, deleted_at: Date.now()});
    }
  }

  return {merged: [...seen.values()], tombstones, deletedIds, review, resurrected, syncConflicts};
}

/**
 * Canonical serialization of a sync blob payload, used ONLY to decide whether a PUT can
 * be skipped (Frozen Req 9). Must be byte-identical across platforms for the skip to
 * work, so ordering and key order are fixed here. Local-only fields (synced, frecency)
 * are excluded because they never enter the blob.
 */
// This is deliberately separate from JSON.stringify: Kotlin's Android JSON implementation
// does not promise the same escaping or object-key order. The accepted value domain is the
// finite, integral JSON data emitted by the sync models; malformed/non-finite values are not
// normalized here.
function canonicalSyncJSONString(value) {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    switch (code) {
      case 0x08: out += '\\b'; continue;
      case 0x09: out += '\\t'; continue;
      case 0x0a: out += '\\n'; continue;
      case 0x0c: out += '\\f'; continue;
      case 0x0d: out += '\\r'; continue;
      case 0x22: out += '\\\"'; continue;
      case 0x5c: out += '\\\\'; continue;
      default: break;
    }
    if (code <= 0x1f) {
      out += '\\u00' + code.toString(16).padStart(2, '0');
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i] + value[++i];
      } else {
        out += '\\u' + code.toString(16).padStart(4, '0');
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += '\\u' + code.toString(16).padStart(4, '0');
    } else {
      out += value[i];
    }
  }
  return out + '"';
}

function canonicalSyncJSON(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return canonicalSyncJSONString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('canonical sync JSON requires safe integers');
    return String(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalSyncJSON).join(',') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key =>
      canonicalSyncJSONString(key) + ':' + canonicalSyncJSON(value[key])
    ).join(',') + '}';
  }
  throw new Error('unsupported canonical sync JSON value');
}

function canonicalBlobPayload(services, metadata, wallets, auditLog, syncConflicts) {
  const svcByID = new Map();
  for (let i = 0; i < metadata.length; i++) {
    if (!metadata[i] || !metadata[i].id) continue;
    svcByID.set(metadata[i].id, {content: services[i] || {}, updated_at: metadata[i].updated_at});
  }
  const orderedServices = [...svcByID.keys()].sort().map(id => {
    const {content, updated_at} = svcByID.get(id);
    return {
      id,
      updated_at,
      name: content.name ?? null,
      site: content.site ?? null,
      email: content.email ?? null,
      length: content.length ?? null,
      symbols: content.symbols ?? null,
      counter: content.counter ?? null,
      migrating: content.migrating ?? null,
      totp: content.totp ?? null,
      ssh: content.ssh ?? null
    };
  });
  const orderedWallets = [...wallets].sort((a, b) => {
    const ka = walletKey(a), kb = walletKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const auditKey = e => [e.timestamp, e.wallet_name, e.chain, e.action].join("\u0000");
  const orderedAudit = [...auditLog].sort((a, b) => {
    const ka = auditKey(a), kb = auditKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const conflictKey = c => [c.detected_at, c.winner_id, c.loser && c.loser.id].join("\u0000");
  const orderedConflicts = [...syncConflicts].sort((a, b) => {
    const ka = conflictKey(a), kb = conflictKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const orderedServicePayloads = orderedServices.map(s =>
    '{"id":' + canonicalSyncJSON(s.id) +
    ',"updated_at":' + canonicalSyncJSON(s.updated_at) +
    ',"name":' + canonicalSyncJSON(s.name) +
    ',"site":' + canonicalSyncJSON(s.site) +
    ',"email":' + canonicalSyncJSON(s.email) +
    ',"length":' + canonicalSyncJSON(s.length) +
    ',"symbols":' + canonicalSyncJSON(s.symbols) +
    ',"counter":' + canonicalSyncJSON(s.counter) +
    ',"migrating":' + canonicalSyncJSON(s.migrating) +
    ',"totp":' + canonicalSyncJSON(s.totp) +
    ',"ssh":' + canonicalSyncJSON(s.ssh) + '}'
  );
  // Top-level and service field order are part of the existing comparison contract. Every
  // nested/variable object below is recursively canonicalized by canonicalSyncJSON.
  return '{"services":[' + orderedServicePayloads.join(',') + ']' +
    ',"wallets":' + canonicalSyncJSON(orderedWallets) +
    ',"wallet_audit_log":' + canonicalSyncJSON(orderedAudit) +
    ',"sync_conflicts":' + canonicalSyncJSON(orderedConflicts) + '}';
}

/**
 * One-time migration of the local payload from v1 (knownUUIDs) to v2 (synced +
 * tombstones). See design §8.
 *
 * `synced` defaults to FALSE when unknown: a false `false` only causes a harmless
 * idempotent re-push under the same UUID, whereas a false `true` risks deletion.
 * Every id that was known from the server but is no longer live becomes a tombstone,
 * so deletions that had not yet propagated are preserved.
 */
function migrateLocalPayload(payload, knownUUIDs, now) {
  const known = knownUUIDs instanceof Set ? knownUUIDs : new Set(knownUUIDs || []);
  const services = (payload.services || []).map(s => ({...s, synced: known.has(s.id)}));
  const liveIds = new Set(services.map(s => s.id));
  const tombstones = [...known]
    .filter(id => !liveIds.has(id))
    .map(id => ({id, deleted_at: now}));
  return {
    version: 2,
    services,
    wallets: payload.wallets || [],
    wallet_audit_log: payload.wallet_audit_log || [],
    tombstones,
    deletion_review: payload.deletion_review || []
  };
}

/**
 * Main sync function.
 * secret: master secret string
 * email: user email string
 * localServices: array of service objects with optional id/updated_at
 * localWallets: array of wallet objects [{wallet_name, chain, counter, email, mode, created_at, notes}]
 * localAuditLog: array of audit log entries
 *
 * Returns: {services, wallets, wallet_audit_log, status, etag, knownUUIDs}
 * Throws on auth/network/server errors.
 */
async function syncWithServer(secret, email, localServices, localWallets = [], localAuditLog = [], localTombstones = [], retryCount = 0) {
  const lookupId = await deriveLookupId(secret, email);
  const authPassword = await deriveAuthPassword(secret, email);
  const encKey = await deriveEncryptionKey(secret, email);
  const syncServer = await getSyncServer();
  const authHeader = "Basic " + btoa(lookupId + ":" + authPassword);
  try {
    // Step 1: GET remote state
    let getResp;
    try {
      getResp = await fetch(syncServer + "/api/sync/" + lookupId, {
        method: "GET",
        headers: {"Authorization": authHeader},
      });
    } catch (e) {
      throw new Error("network_error");
    }

    let remoteServices = [];
    let remoteWallets = [];
    let remoteAuditLog = [];
    let remoteConflicts = [];
    let remoteMetadata = [];
    let etag = null;
    let remoteExists = false;
    let knownWKeys = await getKnownWalletKeys();
    const lastSyncAt = await getLastSuccessfulSyncAt();

    if (getResp.status === 200) {
      remoteExists = true;
      const remote = await getResp.json();
      etag = (getResp.headers.get("ETag") || "").replace(/"/g, "");
      remoteMetadata = remote.services;

      // Validate checksum
      const blobBytes = base64ToArrayBuffer(remote.encrypted_blob);
      const checksum = await sha256Hex(blobBytes);
      if (checksum !== remote.checksum) throw new Error("checksum_mismatch");

      // Decrypt with AAD, fallback to no-AAD only for first-time migration
      const aad = new TextEncoder().encode(lookupId);
      let plaintext;
      try {
        plaintext = await decryptBlob(encKey, blobBytes, aad);
        await chrome.storage.local.set({ aadEnabled: true });
      } catch (e) {
        // Only allow no-AAD fallback if we've never successfully decrypted with AAD
        const { aadEnabled } = await chrome.storage.local.get("aadEnabled");
        if (aadEnabled) throw e;
        plaintext = await decryptBlob(encKey, blobBytes);
      }
      const parsed = JSON.parse(new TextDecoder().decode(plaintext));
      const blobContent = parseBlobContent(parsed);
      remoteServices = blobContent.services;
      remoteWallets = blobContent.wallets;
      remoteAuditLog = blobContent.wallet_audit_log;
      remoteConflicts = blobContent.sync_conflicts;

      // Validate length match (services metadata vs services content)
      if (remoteMetadata.length !== remoteServices.length) throw new Error("metadata_length_mismatch");

      // Validate metadata integrity against cache
      const cachedMeta = await getMetadataCache();
      if (cachedMeta) {
        validateMetadataIntegrity(remoteMetadata, cachedMeta);
      }
    } else if (getResp.status === 404) {
      // Frozen Req 11: no remote record. NEVER inferred as deletions — see
      // reconcileServices(remoteExists=false). Wallet known-keys are also reset so
      // local wallets are not read as "deleted remotely".
      remoteExists = false;
      knownWKeys = new Set();
      await setKnownWalletKeys(knownWKeys);
    } else if (getResp.status === 401) {
      throw new Error("auth_failed");
    } else if (getResp.status === 429) {
      const err = new Error("rate_limited");
      err.retryAfter = parseInt(getResp.headers.get("Retry-After"), 10) || 60;
      throw err;
    } else {
      throw new Error("server_error");
    }

    // Step 2: Reconcile
    const rec = reconcileServices(localServices, localTombstones, remoteServices, remoteMetadata, lastSyncAt, remoteExists);
    const merged = rec.merged;
    const {merged: mergedWallets, knownWalletKeys: newWKeys} = mergeWallets(localWallets, remoteWallets, knownWKeys);
    const mergedAuditLog = mergeAuditLog(localAuditLog, remoteAuditLog);

    // Empty-push protection: an empty push is legitimate only when every remote id it
    // drops is explicitly declared as deleted.
    if (merged.length === 0 && remoteMetadata.length > 0) {
      const declared = new Set(rec.deletedIds);
      const allDeclared = remoteMetadata.every(m => m && m.id && declared.has(m.id));
      if (!allDeclared) throw new Error("empty_push_blocked");
    }

    // Step 3: Build push payload
    const contentArray = merged.map(({id, updated_at, synced, ...content}) => content);
    const metadataArray = merged.map(s => ({id: s.id, updated_at: s.updated_at}));

    // Merge conflicts: remote + new, dedup by winner_id+loser.id, cap at 50
    const dismissData = await chrome.storage.local.get("conflictsDismissed");
    const effectiveRemoteConflicts = dismissData.conflictsDismissed ? [] : remoteConflicts;
    const conflictKeySet = new Set();
    const mergedConflicts = [];
    for (const c of [...effectiveRemoteConflicts, ...rec.syncConflicts]) {
      const ck = c.winner_id + "+" + (c.loser && c.loser.id);
      if (conflictKeySet.has(ck)) continue;
      conflictKeySet.add(ck);
      mergedConflicts.push(c);
    }
    mergedConflicts.sort((a, b) => a.detected_at < b.detected_at ? -1 : 1);
    const sync_conflicts = mergedConflicts.slice(-50);

    // Step 3b: no-op skip (Frozen Req 9). An idle sync costs one GET and no PUT, which
    // also stops the random-IV/new-ETag churn that manufactured cross-device 409s.
    if (remoteExists && rec.deletedIds.length === 0) {
      const localCanon = canonicalBlobPayload(contentArray, metadataArray, mergedWallets, mergedAuditLog, sync_conflicts);
      const remoteCanon = canonicalBlobPayload(remoteServices, remoteMetadata, remoteWallets, remoteAuditLog, remoteConflicts);
      if (localCanon === remoteCanon) {
        await setKnownWalletKeys(newWKeys);
        await setLastSuccessfulSyncAt(Date.now());
        return {
          services: merged, wallets: mergedWallets, wallet_audit_log: mergedAuditLog,
          sync_conflicts, status: "unchanged", etag,
          tombstones: rec.tombstones, review: rec.review, resurrected: rec.resurrected,
          skippedPut: true
        };
      }
    }

    const blobPayload = {services: contentArray, wallets: mergedWallets, wallet_audit_log: mergedAuditLog, sync_conflicts};
    const plaintext = new TextEncoder().encode(JSON.stringify(blobPayload));
    const aadEnc = new TextEncoder().encode(lookupId);
    const encrypted = await encryptBlob(encKey, plaintext, aadEnc);
    const encryptedB64 = arrayBufferToBase64(encrypted);
    const checksum = await sha256Hex(encrypted);

    const putHeaders = {
      "Authorization": authHeader,
      "Content-Type": "application/json",
    };
    if (etag) putHeaders["If-Match"] = '"' + etag + '"';

    // Step 4: PUT
    let putResp;
    try {
      putResp = await fetch(syncServer + "/api/sync/" + lookupId, {
        method: "PUT",
        headers: putHeaders,
        body: JSON.stringify({
          services: metadataArray,
          encrypted_blob: encryptedB64,
          checksum,
          deleted_ids: rec.deletedIds
        }),
      });
    } catch (e) {
      throw new Error("network_error");
    }

    if (putResp.status === 409) {
      // Bounded jittered backoff. Immediate recursion could burn 8 requests in
      // milliseconds against a per-lookup bucket of 20, self-inflicting a 429.
      if (retryCount < 3) {
        await sleepWithJitter(CONFLICT_BACKOFF_MS[retryCount]);
        return syncWithServer(secret, email, localServices, localWallets, localAuditLog, localTombstones, retryCount + 1);
      }
      throw new Error("conflict");
    }
    if (putResp.status === 401) throw new Error("auth_failed");
    if (putResp.status === 429) {
      const err = new Error("rate_limited");
      err.retryAfter = parseInt(putResp.headers.get("Retry-After"), 10) || 60;
      throw err;
    }
    if (putResp.status !== 200 && putResp.status !== 201) throw new Error("server_error");

    const putResult = await putResp.json();

    // Confirmed 2xx: only now is it safe to treat the pushed ids as synced, clear the
    // tombstones the server no longer holds, and advance the sync barrier (§3 step 5-6).
    await setMetadataCache(putResult.services);
    await setKnownWalletKeys(newWKeys);
    const pushedIds = new Set(metadataArray.map(m => m.id));
    const confirmedServices = merged.map(s => pushedIds.has(s.id) ? {...s, synced: true} : s);
    const remainingTombstones = rec.tombstones.filter(t => pushedIds.has(t.id));
    await setLastSuccessfulSyncAt(Date.now());

    const status = remoteExists ? "synced" : "created";
    await chrome.storage.local.set({syncConflicts: sync_conflicts, conflictsDismissed: false});
    return {
      services: confirmedServices, wallets: mergedWallets, wallet_audit_log: mergedAuditLog,
      sync_conflicts, status, etag: putResult.etag,
      tombstones: remainingTombstones, review: rec.review, resurrected: rec.resurrected,
      skippedPut: false
    };
  } finally {
    if (encKey) encKey.fill(0);
  }
}

function exportToFile(encryptedBlob, filename) {
  const blob = new Blob([encryptedBlob], {type: "application/octet-stream"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "keygrain-backup.keygrain";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Pure mapping of a DELETE /api/sync/:lookup_id HTTP status to an outcome.
 *
 * SAFETY (Invariant #1, mirrors the Android DeleteResult contract): the caller
 * MUST treat ONLY {ok:true} (HTTP 200 or 404) as a confirmed delete. For every
 * other status the server state is unknown or unchanged — the caller must NOT
 * wipe local data or flip offline mode, and should let the user retry.
 *
 * - 200: record removed.
 * - 404: no record existed. Deletion is idempotent in effect → treat as success.
 * - 401/403: credentials rejected; record left unchanged.
 * - 429: rate limited; record left unchanged.
 * - anything else: unknown server state.
 */
function classifyDeleteStatus(status) {
  if (status === 200 || status === 404) return {ok: true, result: "success"};
  if (status === 401 || status === 403) return {ok: false, result: "auth"};
  if (status === 429) return {ok: false, result: "rate_limited"};
  return {ok: false, result: "server"};
}

/**
 * Permanently delete this account's record from the sync server.
 *
 * Derives lookup_id/auth_password from secret/email and sends
 * DELETE /api/sync/:lookup_id with HTTP Basic auth. Returns the
 * classifyDeleteStatus() outcome; a transport failure returns
 * {ok:false, result:"network"}. The 200 body ({"status":"deleted"}) is
 * irrelevant to the outcome and is not parsed. The caller MUST treat only
 * {ok:true} as a confirmed delete (Invariant #1).
 */
async function deleteServerData(secret, email) {
  const lookupId = await deriveLookupId(secret, email);
  const authPassword = await deriveAuthPassword(secret, email);
  const syncServer = await getSyncServer();
  const authHeader = "Basic " + btoa(lookupId + ":" + authPassword);
  let resp;
  try {
    resp = await fetch(syncServer + "/api/sync/" + lookupId, {
      method: "DELETE",
      headers: {"Authorization": authHeader},
    });
  } catch (e) {
    return {ok: false, result: "network"};
  }
  return classifyDeleteStatus(resp.status);
}
