// sync.js — Sync v2: per-service merge (depends on keygrain.js)
const DEFAULT_SYNC_SERVER = "https://keygrain.secbytech.com";

async function getSyncServer() {
  const data = await chrome.storage.local.get("settings");
  return (data.settings && data.settings.serverUrl) || DEFAULT_SYNC_SERVER;
}

async function deriveLookupId(secret, email) {
  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const message = enc.encode(email.toLowerCase() + ":keygrain-id");
  const hash = await hmacSHA256(strengthened, message);
  return Array.from(hash, b => b.toString(16).padStart(2, "0")).join("");
}

async function deriveEncryptionKey(secret, email) {
  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const message = enc.encode(email.toLowerCase() + ":keygrain-encryption");
  return hmacSHA256(strengthened, message);
}

async function encryptBlob(keyBytes, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, {name: "AES-GCM"}, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv}, cryptoKey, plaintext);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv);
  result.set(new Uint8Array(ciphertext), 12);
  return result;
}

async function decryptBlob(keyBytes, blob) {
  const iv = blob.slice(0, 12);
  const ciphertext = blob.slice(12);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, {name: "AES-GCM"}, false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({name: "AES-GCM", iv}, cryptoKey, ciphertext));
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

// Load known UUIDs from storage
async function getKnownUUIDs() {
  const data = await chrome.storage.local.get("syncKnownUUIDs");
  return new Set(data.syncKnownUUIDs || []);
}

async function setKnownUUIDs(uuids) {
  await chrome.storage.local.set({syncKnownUUIDs: [...uuids]});
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
 * Conflict: most recent created_at wins.
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
      // Both have it — most recent created_at wins
      merged.push(local.created_at > remote.created_at ? local : remote);
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
    return {services: parsed, wallets: [], wallet_audit_log: []};
  }
  return {
    services: parsed.services || [],
    wallets: parsed.wallets || [],
    wallet_audit_log: parsed.wallet_audit_log || []
  };
}

/**
 * Merge local and remote services.
 * localServices: [{name, site, email, length, symbols, counter, id, updated_at}, ...]
 * remoteServices: same format (decrypted from blob)
 * remoteMetadata: [{id, updated_at}, ...] from server response
 * knownUUIDs: Set of UUIDs previously seen from server
 *
 * Returns: {merged: [...], knownUUIDs: Set}
 */
function mergeServices(localServices, remoteServices, remoteMetadata, knownUUIDs) {
  const remoteByID = new Map();
  for (let i = 0; i < remoteMetadata.length; i++) {
    if (!remoteMetadata[i].id) continue;
    remoteByID.set(remoteMetadata[i].id, {meta: remoteMetadata[i], data: remoteServices[i]});
  }

  const localByID = new Map();
  const localNew = [];
  for (const svc of localServices) {
    if (svc.id) {
      localByID.set(svc.id, svc);
    } else {
      localNew.push(svc);
    }
  }

  const merged = [];

  // Services present in both local and remote (by UUID)
  for (const [id, remote] of remoteByID) {
    const local = localByID.get(id);
    if (local) {
      // Both have it — newer wins, remote wins ties
      if (local.updated_at > remote.meta.updated_at) {
        merged.push(local);
      } else {
        merged.push({...remote.data, id, updated_at: remote.meta.updated_at});
      }
      localByID.delete(id);
    } else {
      // Remote-only: new from another device or deleted locally?
      if (knownUUIDs.has(id)) {
        // Was known → deleted locally → don't include
      } else {
        // New from another device → add
        merged.push({...remote.data, id, updated_at: remote.meta.updated_at});
      }
    }
  }

  // Local services with UUID not in remote → deleted on another device
  for (const [id, svc] of localByID) {
    if (remoteByID.has(id)) continue; // already handled
    // UUID exists locally but not in remote → deleted remotely
    // Don't include in merged
  }

  // Local services with no UUID → new locally
  for (const svc of localNew) {
    merged.push(svc);
  }

  // New known UUIDs = all UUIDs in merged that have an id
  const newKnown = new Set();
  for (const svc of merged) {
    if (svc.id) newKnown.add(svc.id);
  }

  return {merged, knownUUIDs: newKnown};
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
async function syncWithServer(secret, email, localServices, localWallets = [], localAuditLog = [], retryCount = 0) {
  const lookupId = await deriveLookupId(secret, email);
  const authPassword = await deriveAuthPassword(secret, email);
  const encKey = await deriveEncryptionKey(secret, email);
  const syncServer = await getSyncServer();
  const authHeader = "Basic " + btoa(lookupId + ":" + authPassword);
  try {
    // Step 1: GET remote state
    const getResp = await fetch(syncServer + "/api/sync/" + lookupId, {
      method: "GET",
      headers: {"Authorization": authHeader},
    });

    let remoteServices = [];
    let remoteWallets = [];
    let remoteAuditLog = [];
    let remoteMetadata = [];
    let etag = null;
    let knownUUIDs = await getKnownUUIDs();
    let knownWKeys = await getKnownWalletKeys();

    if (getResp.status === 200) {
      const remote = await getResp.json();
      etag = (getResp.headers.get("ETag") || "").replace(/"/g, "");
      remoteMetadata = remote.services;

      // Validate checksum
      const blobBytes = base64ToArrayBuffer(remote.encrypted_blob);
      const checksum = await sha256Hex(blobBytes);
      if (checksum !== remote.checksum) throw new Error("checksum_mismatch");

      // Decrypt
      const plaintext = await decryptBlob(encKey, blobBytes);
      const parsed = JSON.parse(new TextDecoder().decode(plaintext));
      const blobContent = parseBlobContent(parsed);
      remoteServices = blobContent.services;
      remoteWallets = blobContent.wallets;
      remoteAuditLog = blobContent.wallet_audit_log;

      // Validate length match (services metadata vs services content)
      if (remoteMetadata.length !== remoteServices.length) throw new Error("metadata_length_mismatch");

      // Validate metadata integrity against cache
      const cached = await getMetadataCache();
      if (cached) {
        validateMetadataIntegrity(remoteMetadata, cached);
      }
    } else if (getResp.status === 404) {
      // No remote state — push everything
    } else if (getResp.status === 401) {
      throw new Error("auth_failed");
    } else {
      throw new Error("server_error");
    }

    // Step 2: Merge
    const {merged, knownUUIDs: newKnown} = mergeServices(localServices, remoteServices, remoteMetadata, knownUUIDs);
    const {merged: mergedWallets, knownWalletKeys: newWKeys} = mergeWallets(localWallets, remoteWallets, knownWKeys);
    const mergedAuditLog = mergeAuditLog(localAuditLog, remoteAuditLog);

    // Step 3: Empty push protection
    if (merged.length === 0 && remoteMetadata.length > 0) {
      throw new Error("empty_push_blocked");
    }
    if (mergedWallets.length === 0 && remoteWallets.length > 0) {
      throw new Error("empty_wallet_push_blocked");
    }

    // Step 4: Build push payload
    const contentArray = merged.map(({id, updated_at, ...content}) => content);
    const metadataArray = merged.map(s => ({id: s.id || null, updated_at: s.updated_at}));

    const blobPayload = {services: contentArray, wallets: mergedWallets, wallet_audit_log: mergedAuditLog};
    const plaintext = new TextEncoder().encode(JSON.stringify(blobPayload));
    const encrypted = await encryptBlob(encKey, plaintext);
    const encryptedB64 = arrayBufferToBase64(encrypted);
    const checksum = await sha256Hex(encrypted);

    const putHeaders = {
      "Authorization": authHeader,
      "Content-Type": "application/json",
    };
    if (etag) putHeaders["If-Match"] = '"' + etag + '"';

    // Step 5: PUT
    const putResp = await fetch(syncServer + "/api/sync/" + lookupId, {
      method: "PUT",
      headers: putHeaders,
      body: JSON.stringify({services: metadataArray, encrypted_blob: encryptedB64, checksum}),
    });

    if (putResp.status === 409) {
      // Conflict — retry once
      if (retryCount < 1) return syncWithServer(secret, email, localServices, localWallets, localAuditLog, retryCount + 1);
      throw new Error("conflict");
    }
    if (putResp.status === 401) throw new Error("auth_failed");
    if (putResp.status !== 200 && putResp.status !== 201) throw new Error("server_error");

    const putResult = await putResp.json();

    // Step 6: Update local state with server-assigned UUIDs
    const finalServices = merged.map((svc, i) => ({
      ...svc,
      id: putResult.services[i].id,
      updated_at: svc.updated_at,
    }));

    // Update known UUIDs and wallet keys
    const finalKnown = new Set(putResult.services.map(s => s.id).filter(Boolean));
    await setMetadataCache(putResult.services);
    await setKnownWalletKeys(newWKeys);

    const status = getResp.status === 404 ? "created" : "synced";
    return {services: finalServices, wallets: mergedWallets, wallet_audit_log: mergedAuditLog, status, etag: putResult.etag, knownUUIDs: finalKnown};
  } finally {
    encKey.fill(0);
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
