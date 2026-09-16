// sync.js — Sync v2: per-service merge (depends on keygrain.js)
const DEFAULT_SYNC_SERVER = "https://keygrain.com";

// The strict protocol token is defined by Design 0 Amendment A.9 and the
// enforcing server. The pure classifier is wired into the GET boundary so the
// current v2 writer continues only for valid legacy metadata and fails closed
// before any strict/unsafe response can reach the write path.
const STRICT_SYNC_CAPABILITY = "account_defaults_immutable_v1";
const STRICT_SYNC_PAYLOAD_VERSION = 3;
const STRICT_SYNC_MIN_WRITER_PROTOCOL = 3;
const DEFAULTS_SCHEMA = 1;
const DEFAULTS_POLICY = "ascii-printable-v1";
const NORMALIZED_EMAIL_RE = /^[a-z0-9.!#$%&'*+\/?^_\x60{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const LOOKUP_ID_RE = /^[0-9a-f]{64}$/;
const COMMITMENT_DOMAIN = "keygrain-account-defaults-v1\0";
const V3_AAD_DOMAIN = "keygrain-sync-v3\0";

function assertCanonicalDefaults(defaults) {
  if (defaults === null || typeof defaults !== "object" || Array.isArray(defaults)) {
    throw new TypeError("defaults must be a plain object");
  }
  const prototype = Object.getPrototypeOf(defaults);
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError("defaults must not inherit fields");
  }
  const ownKeys = Object.getOwnPropertyNames(defaults).sort();
  if (Object.getOwnPropertySymbols(defaults).length !== 0 ||
      ownKeys.join("\0") !== "length\0policy\0schema\0symbols") {
    throw new TypeError("defaults must contain exactly the canonical fields");
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(defaults, key);
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      throw new TypeError("defaults fields must be enumerable data properties");
    }
  }
  if (!Number.isSafeInteger(defaults.schema) || defaults.schema !== DEFAULTS_SCHEMA) {
    throw new RangeError("unsupported defaults schema");
  }
  if (!Number.isSafeInteger(defaults.length) || defaults.length < 8 || defaults.length > 128) {
    throw new RangeError("defaults length is invalid");
  }
  if (defaults.policy !== DEFAULTS_POLICY) {
    throw new RangeError("defaults policy is invalid");
  }
  if (typeof defaults.symbols !== "string" || defaults.symbols.length === 0) {
    throw new TypeError("defaults symbols are invalid");
  }
  for (let i = 0; i < defaults.symbols.length; i++) {
    const code = defaults.symbols.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) {
      throw new RangeError("defaults symbols are invalid");
    }
  }
  if (UPPER.length + LOWER.length + DIGITS.length + defaults.symbols.length > 256) {
    throw new RangeError("defaults charset is too large");
  }
  return defaults;
}

function canonicalAccountDefaultsJSON(defaults) {
  assertCanonicalDefaults(defaults);
  return "{\"length\":" + defaults.length +
    ",\"policy\":" + JSON.stringify(defaults.policy) +
    ",\"schema\":" + defaults.schema +
    ",\"symbols\":" + JSON.stringify(defaults.symbols) + "}";
}

function assertNormalizedEmail(normalizedEmail) {
  if (typeof normalizedEmail !== "string" || normalizedEmail.length < 1 ||
      normalizedEmail.length > 254 || !NORMALIZED_EMAIL_RE.test(normalizedEmail)) {
    throw new TypeError("normalized email is invalid");
  }
}

function assertStrengthenedKey(strengthened) {
  if (!(strengthened instanceof Uint8Array) || strengthened.length !== 32) {
    throw new TypeError("strengthened key must be exactly 32 bytes");
  }
}

async function deriveDefaultsCommitment(strengthened, normalizedEmail, defaults) {
  assertStrengthenedKey(strengthened);
  assertNormalizedEmail(normalizedEmail);
  const canonical = canonicalAccountDefaultsJSON(defaults);
  const encoder = new TextEncoder();
  const strengthenedCopy = new Uint8Array(strengthened);
  const derivationMessage = encoder.encode(normalizedEmail + ":keygrain-defaults-commitment");
  let commitKey;
  try {
    commitKey = await hmacSHA256(strengthenedCopy, derivationMessage);
    const commitmentMessage = encoder.encode(COMMITMENT_DOMAIN + canonical);
    const commitment = await hmacSHA256(commitKey, commitmentMessage);
    return Array.from(commitment, b => b.toString(16).padStart(2, "0")).join("");
  } finally {
    strengthenedCopy.fill(0);
    derivationMessage.fill(0);
    if (commitKey) commitKey.fill(0);
  }
}

function assertLookupId(lookupId) {
  if (typeof lookupId !== "string" || !LOOKUP_ID_RE.test(lookupId)) {
    throw new TypeError("lookup id is invalid");
  }
}

function buildV3SyncAAD(lookupId, defaultsState, commitment) {
  assertLookupId(lookupId);
  if (defaultsState !== "UNSEALED" && defaultsState !== "ABSENT" && defaultsState !== "PRESENT") {
    throw new TypeError("defaults state is invalid");
  }
  if (defaultsState === "PRESENT") {
    if (typeof commitment !== "string" || !/^[0-9a-f]{64}$/.test(commitment)) {
      throw new TypeError("present defaults commitment is invalid");
    }
  } else if (commitment !== null) {
    throw new TypeError("unsealed or absent defaults must not have a commitment");
  }
  return new TextEncoder().encode(V3_AAD_DOMAIN + lookupId + "\0" + defaultsState + "\0" +
    (commitment || ""));
}

function unsafeSyncCapability(reason) {
  return {status: "unsafe", writer_status: "blocked", reason};
}

function hasLegacySyncResponseShape(response) {
  if (response === null || typeof response !== "object" || Array.isArray(response) ||
      !Number.isSafeInteger(response.version)) return false;
  const blob = Object.getOwnPropertyDescriptor(response, "encrypted_blob");
  const checksum = Object.getOwnPropertyDescriptor(response, "checksum");
  return !!blob && typeof blob.value === "string" && blob.value.length > 0 &&
    !!checksum && typeof checksum.value === "string" && /^[0-9a-f]{64}$/i.test(checksum.value);
}

function hasSyncResponseShape(response) {
  return hasLegacySyncResponseShape(response);
}

/**
 * Classify the capability envelope returned by the sync server.
 *
 * An entirely absent envelope is the only legacy result. A complete exact
 * strict envelope is recognized, but this existing v2 writer cannot satisfy
 * its protocol-3 minimum and therefore must not write it. Every partial,
 * malformed, or contradictory envelope is unsafe rather than a reason to
 * fall back to a v2 PUT.
 */
function classifySyncCapabilities(metadata) {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return unsafeSyncCapability("capability_metadata_malformed");
  }

  const hasPayloadVersion = "payload_version" in metadata;
  const hasMinWriterProtocol = "min_writer_protocol" in metadata;
  const hasCapabilities = "capabilities" in metadata;
  const presentCount = [hasPayloadVersion, hasMinWriterProtocol, hasCapabilities]
    .filter(Boolean).length;

  if (presentCount === 0) {
    return {
      status: "legacy",
      writer_status: "legacy_v2",
      reason: "capability_metadata_absent"
    };
  }
  if (presentCount !== 3) {
    return unsafeSyncCapability("capability_metadata_incomplete");
  }

  const payloadVersion = metadata.payload_version;
  const minWriterProtocol = metadata.min_writer_protocol;
  const capabilities = metadata.capabilities;
  if (!Number.isSafeInteger(payloadVersion) ||
      !Number.isSafeInteger(minWriterProtocol) ||
      !Array.isArray(capabilities) ||
      capabilities.some(capability => typeof capability !== "string")) {
    return unsafeSyncCapability("capability_metadata_malformed");
  }

  const exactCapability = capabilities.length === 1 && capabilities[0] === STRICT_SYNC_CAPABILITY;
  if (minWriterProtocol === STRICT_SYNC_MIN_WRITER_PROTOCOL &&
      (payloadVersion !== STRICT_SYNC_PAYLOAD_VERSION || !exactCapability)) {
    return unsafeSyncCapability("min_writer_protocol_contradiction");
  }
  if (payloadVersion !== STRICT_SYNC_PAYLOAD_VERSION) {
    return unsafeSyncCapability("payload_version_unsupported");
  }
  if (minWriterProtocol !== STRICT_SYNC_MIN_WRITER_PROTOCOL) {
    return unsafeSyncCapability("min_writer_protocol_unsupported");
  }
  if (!exactCapability) {
    return unsafeSyncCapability("capability_unsupported");
  }

  return {
    status: "strict_compatible",
    writer_status: "upgrade_required",
    reason: "strict_account_requires_protocol_3",
    payload_version: payloadVersion,
    min_writer_protocol: minWriterProtocol,
    capabilities: [...capabilities]
  };
}

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

async function getSyncVersion() {
  const data = await chrome.storage.local.get(["syncVersion", "sync_version"]);
  return data.syncVersion || data.sync_version || 0;
}

async function setSyncVersion(version) {
  await chrome.storage.local.set({syncVersion: version, sync_version: version});
}

// Known wallet keys (wallet_id pairs seen from server)
async function getKnownWalletKeys() {
  const data = await chrome.storage.local.get("syncKnownWalletKeys");
  return new Set(data.syncKnownWalletKeys || []);
}

async function setKnownWalletKeys(keys) {
  await chrome.storage.local.set({syncKnownWalletKeys: [...keys]});
}

async function getKnownSshKeys() {
  const data = await chrome.storage.local.get("syncKnownSshKeys");
  return new Set(data.syncKnownSshKeys || []);
}

async function setKnownSshKeys(keys) {
  await chrome.storage.local.set({syncKnownSshKeys: [...keys]});
}

function sshKeyId(k) {
  const primary = (k && (k.key_name || k.id || "")) + "";
  return primary.toLowerCase().trim();
}

function normalizeTimestampMs(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  const s = String(ts).trim();
  const num = Number(s);
  if (!Number.isNaN(num)) {
    if (num > 100000000000) return num;
    if (num > 1000000000) return num * 1000;
    return num;
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function mergeSshKeys(localSshKeys, remoteSshKeys, localTombstones = [], remoteTombstones = [], lastSyncAt = 0, remoteExists = true) {
  const tombByKey = new Map();
  const tombs = Array.isArray(localTombstones) ? localTombstones : [];
  for (const t of tombs) {
    if (!t) continue;
    const ts = normalizeTimestampMs(t.deleted_at);
    if (t.id) {
      const key = String(t.id).toLowerCase().trim();
      const prev = tombByKey.get(key);
      if (prev === undefined || ts > prev) {
        tombByKey.set(key, ts);
      }
    }
  }

  const remoteTombByKey = new Map();
  const rTombs = Array.isArray(remoteTombstones) ? remoteTombstones : [];
  for (const t of rTombs) {
    if (!t) continue;
    const ts = normalizeTimestampMs(t.deleted_at);
    if (t.id) {
      const key = String(t.id).toLowerCase().trim();
      const prev = remoteTombByKey.get(key);
      if (prev === undefined || ts > prev) {
        remoteTombByKey.set(key, ts);
      }
    }
  }

  function getTombstoneDeletedAt(map, k) {
    if (!k) return undefined;
    const candidates = [
      k.id ? String(k.id).toLowerCase().trim() : null,
      k.key_name ? String(k.key_name).toLowerCase().trim().replace(/\s+/g, "-") : null,
      sshKeyId(k).toLowerCase().trim(),
    ].filter(Boolean);

    let maxTs = undefined;
    for (const c of candidates) {
      const ts = map.get(c);
      if (ts !== undefined && (maxTs === undefined || ts > maxTs)) {
        maxTs = ts;
      }
    }
    return maxTs;
  }

  const localById = new Map();
  const localByKey = new Map();
  for (const k of (localSshKeys || [])) {
    if (!k) continue;
    if (k.id) localById.set(String(k.id).toLowerCase().trim(), k);
    localByKey.set(sshKeyId(k), k);
  }

  const merged = [];
  const retainedTombstones = [];
  const handledTombstoneKeys = new Set();
  const handledLocalKeys = new Set();
  const handledLocalIds = new Set();

  for (const remote of (remoteSshKeys || [])) {
    if (!remote) continue;
    const rKey = sshKeyId(remote);
    const rId = remote.id ? String(remote.id).toLowerCase().trim() : null;

    let local = null;
    if (rId && !handledLocalIds.has(rId) && localById.has(rId)) {
      local = localById.get(rId);
    } else if (!handledLocalKeys.has(rKey) && localByKey.has(rKey)) {
      const candidate = localByKey.get(rKey);
      const candId = candidate.id ? String(candidate.id).toLowerCase().trim() : null;
      if (!candId || !rId || candId === rId) {
        if (!candId || !handledLocalIds.has(candId)) {
          local = candidate;
        }
      }
    }

    if (local) {
      const localTs = normalizeTimestampMs(local.updated_at || local.created_at);
      const remoteTs = normalizeTimestampMs(remote.updated_at || remote.created_at);
      merged.push(localTs > remoteTs ? local : remote);

      if (local.id) handledLocalIds.add(String(local.id).toLowerCase().trim());
      handledLocalKeys.add(sshKeyId(local));
      if (remote.id) handledLocalIds.add(String(remote.id).toLowerCase().trim());
      handledLocalKeys.add(rKey);
    } else {
      const tombDeletedAt = getTombstoneDeletedAt(tombByKey, remote);
      const remoteTs = normalizeTimestampMs(remote.updated_at || remote.created_at);
      if (tombDeletedAt !== undefined && tombDeletedAt > remoteTs) {
        const tombId = remote.id || remote.key_name || rKey;
        retainedTombstones.push({ id: tombId, deleted_at: tombDeletedAt });
        const candidates = [
          remote.id ? String(remote.id).toLowerCase().trim() : null,
          remote.key_name ? String(remote.key_name).toLowerCase().trim().replace(/\s+/g, "-") : null,
          sshKeyId(remote).toLowerCase().trim(),
        ].filter(Boolean);
        for (const c of candidates) handledTombstoneKeys.add(c);
      } else {
        if (tombDeletedAt !== undefined) {
          const candidates = [
            remote.id ? String(remote.id).toLowerCase().trim() : null,
            remote.key_name ? String(remote.key_name).toLowerCase().trim().replace(/\s+/g, "-") : null,
            sshKeyId(remote).toLowerCase().trim(),
          ].filter(Boolean);
          for (const c of candidates) handledTombstoneKeys.add(c);
        }
        merged.push(remote);
      }
    }
  }

  for (const local of (localSshKeys || [])) {
    if (!local) continue;
    const lKey = sshKeyId(local);
    const lId = local.id ? String(local.id).toLowerCase().trim() : null;
    if (handledLocalKeys.has(lKey) || (lId && handledLocalIds.has(lId))) continue;

    const remoteTombDeletedAt = getTombstoneDeletedAt(remoteTombByKey, local);
    const localTs = normalizeTimestampMs(local.updated_at || local.created_at);
    if (remoteTombDeletedAt !== undefined && remoteTombDeletedAt > localTs) {
      // Remote tombstone explicitly deleted it
      continue;
    }
    if (remoteExists && lastSyncAt > 0 && localTs <= lastSyncAt) {
      // Was synced before, no newer edit, absent remotely -> deleted remotely
      continue;
    }
    merged.push(local);
    if (lId) handledLocalIds.add(lId);
    handledLocalKeys.add(lKey);
  }

  // Post-merge LWW deduplication: collapse duplicates by UUID and by sshKeyId
  const dedupedById = new Map();
  for (const item of merged) {
    if (!item) continue;
    const id = item.id ? String(item.id).toLowerCase().trim() : null;
    if (id) {
      const prev = dedupedById.get(id);
      if (!prev) {
        dedupedById.set(id, item);
      } else {
        const itemTs = normalizeTimestampMs(item.updated_at || item.created_at);
        const prevTs = normalizeTimestampMs(prev.updated_at || prev.created_at);
        if (itemTs > prevTs) dedupedById.set(id, item);
      }
    }
  }

  const deduped = [];
  const seenKeys = new Map();
  for (const item of merged) {
    if (!item) continue;
    const id = item.id ? String(item.id).toLowerCase().trim() : null;
    if (id && dedupedById.get(id) !== item) continue;

    const key = sshKeyId(item);
    const prev = seenKeys.get(key);
    if (!prev) {
      seenKeys.set(key, item);
      deduped.push(item);
    } else {
      const itemTs = normalizeTimestampMs(item.updated_at || item.created_at);
      const prevTs = normalizeTimestampMs(prev.updated_at || prev.created_at);
      if (itemTs > prevTs) {
        const idx = deduped.indexOf(prev);
        if (idx >= 0) deduped[idx] = item;
        seenKeys.set(key, item);
      }
    }
  }

  const newKnownKeys = new Set(deduped.map(k => sshKeyId(k)));
  return { merged: deduped, tombstones: retainedTombstones, knownSshKeys: newKnownKeys };
}

function walletKey(w) {
  return (w && (w.wallet_id || w.wallet_name || w.id || "")).toLowerCase().trim();
}

/**
 * Merge local and remote wallets.
 * Merge key: wallet identifier (lowercased).
 * Conflict: most recent updated_at wins (falls back to created_at if updated_at absent).
 * Deletion is explicitly tracked via tombstones.
 */
function mergeWallets(localWallets, remoteWallets, localTombstones = [], remoteTombstones = [], lastSyncAt = 0, remoteExists = true) {
  const tombByKey = new Map();
  const tombs = Array.isArray(localTombstones) ? localTombstones : [];
  for (const t of tombs) {
    if (!t) continue;
    const ts = normalizeTimestampMs(t.deleted_at);
    if (t.id) {
      const key = String(t.id).toLowerCase().trim();
      const prev = tombByKey.get(key);
      if (prev === undefined || ts > prev) {
        tombByKey.set(key, ts);
      }
    }
  }

  const remoteTombByKey = new Map();
  const rTombs = Array.isArray(remoteTombstones) ? remoteTombstones : [];
  for (const t of rTombs) {
    if (!t) continue;
    const ts = normalizeTimestampMs(t.deleted_at);
    if (t.id) {
      const key = String(t.id).toLowerCase().trim();
      const prev = remoteTombByKey.get(key);
      if (prev === undefined || ts > prev) {
        remoteTombByKey.set(key, ts);
      }
    }
  }

  function getTombstoneDeletedAt(map, w) {
    if (!w) return undefined;
    const candidates = [
      w.id ? String(w.id).toLowerCase().trim() : null,
      walletKey(w).toLowerCase().trim(),
      w.wallet_id ? String(w.wallet_id).toLowerCase().trim() : null,
      w.wallet_name ? String(w.wallet_name).toLowerCase().trim() : null,
    ].filter(Boolean);

    let maxTs = undefined;
    for (const c of candidates) {
      const ts = map.get(c);
      if (ts !== undefined && (maxTs === undefined || ts > maxTs)) {
        maxTs = ts;
      }
    }
    return maxTs;
  }

  const localById = new Map();
  const localByKey = new Map();
  for (const w of (localWallets || [])) {
    if (!w) continue;
    if (w.id) localById.set(String(w.id).toLowerCase().trim(), w);
    localByKey.set(walletKey(w), w);
  }

  const merged = [];
  const retainedTombstones = [];
  const handledTombstoneKeys = new Set();
  const handledLocalKeys = new Set();
  const handledLocalIds = new Set();

  for (const remote of (remoteWallets || [])) {
    if (!remote) continue;
    const rKey = walletKey(remote);
    const rId = remote.id ? String(remote.id).toLowerCase().trim() : null;

    let local = null;
    if (rId && !handledLocalIds.has(rId) && localById.has(rId)) {
      local = localById.get(rId);
    } else if (!handledLocalKeys.has(rKey) && localByKey.has(rKey)) {
      const candidate = localByKey.get(rKey);
      const candId = candidate.id ? String(candidate.id).toLowerCase().trim() : null;
      if (!candId || !rId || candId === rId) {
        if (!candId || !handledLocalIds.has(candId)) {
          local = candidate;
        }
      }
    }

    if (local) {
      const localTs = normalizeTimestampMs(local.updated_at || local.created_at);
      const remoteTs = normalizeTimestampMs(remote.updated_at || remote.created_at);
      merged.push(localTs > remoteTs ? local : remote);

      if (local.id) handledLocalIds.add(String(local.id).toLowerCase().trim());
      handledLocalKeys.add(walletKey(local));
      if (remote.id) handledLocalIds.add(String(remote.id).toLowerCase().trim());
      handledLocalKeys.add(rKey);
    } else {
      const tombDeletedAt = getTombstoneDeletedAt(tombByKey, remote);
      const remoteTs = normalizeTimestampMs(remote.updated_at || remote.created_at);
      if (tombDeletedAt !== undefined && tombDeletedAt > remoteTs) {
        const tombId = remote.id || remote.wallet_id || remote.wallet_name || rKey;
        retainedTombstones.push({ id: tombId, deleted_at: tombDeletedAt });
        const candidates = [
          remote.id ? String(remote.id).toLowerCase().trim() : null,
          walletKey(remote).toLowerCase().trim(),
          remote.wallet_id ? String(remote.wallet_id).toLowerCase().trim() : null,
          remote.wallet_name ? String(remote.wallet_name).toLowerCase().trim() : null,
        ].filter(Boolean);
        for (const c of candidates) handledTombstoneKeys.add(c);
      } else {
        if (tombDeletedAt !== undefined) {
          const candidates = [
            remote.id ? String(remote.id).toLowerCase().trim() : null,
            walletKey(remote).toLowerCase().trim(),
            remote.wallet_id ? String(remote.wallet_id).toLowerCase().trim() : null,
            remote.wallet_name ? String(remote.wallet_name).toLowerCase().trim() : null,
          ].filter(Boolean);
          for (const c of candidates) handledTombstoneKeys.add(c);
        }
        merged.push(remote);
      }
    }
  }

  for (const local of (localWallets || [])) {
    if (!local) continue;
    const lKey = walletKey(local);
    const lId = local.id ? String(local.id).toLowerCase().trim() : null;
    if (handledLocalKeys.has(lKey) || (lId && handledLocalIds.has(lId))) continue;

    const remoteTombDeletedAt = getTombstoneDeletedAt(remoteTombByKey, local);
    const localTs = normalizeTimestampMs(local.updated_at || local.created_at);
    if (remoteTombDeletedAt !== undefined && remoteTombDeletedAt > localTs) {
      // Remote tombstone explicitly deleted it
      continue;
    }
    if (remoteExists && lastSyncAt > 0 && localTs <= lastSyncAt) {
      // Was synced before, no newer edit, absent remotely -> deleted remotely
      continue;
    }
    merged.push(local);
    if (lId) handledLocalIds.add(lId);
    handledLocalKeys.add(lKey);
  }

  // Post-merge LWW deduplication: collapse duplicates by UUID and by walletKey
  const dedupedById = new Map();
  for (const item of merged) {
    if (!item) continue;
    const id = item.id ? String(item.id).toLowerCase().trim() : null;
    if (id) {
      const prev = dedupedById.get(id);
      if (!prev) {
        dedupedById.set(id, item);
      } else {
        const itemTs = normalizeTimestampMs(item.updated_at || item.created_at);
        const prevTs = normalizeTimestampMs(prev.updated_at || prev.created_at);
        if (itemTs > prevTs) dedupedById.set(id, item);
      }
    }
  }

  const deduped = [];
  const seenKeys = new Map();
  for (const item of merged) {
    if (!item) continue;
    const id = item.id ? String(item.id).toLowerCase().trim() : null;
    if (id && dedupedById.get(id) !== item) continue;

    const key = walletKey(item);
    const prev = seenKeys.get(key);
    if (!prev) {
      seenKeys.set(key, item);
      deduped.push(item);
    } else {
      const itemTs = normalizeTimestampMs(item.updated_at || item.created_at);
      const prevTs = normalizeTimestampMs(prev.updated_at || prev.created_at);
      if (itemTs > prevTs) {
        const idx = deduped.indexOf(prev);
        if (idx >= 0) deduped[idx] = item;
        seenKeys.set(key, item);
      }
    }
  }

  const newKnownKeys = new Set(deduped.map(w => walletKey(w)));
  return { merged: deduped, tombstones: retainedTombstones, knownWalletKeys: newKnownKeys };
}

/**
 * Deprecated: wallet_audit_log is eliminated from sync payloads.
 */
function mergeAuditLog() {
  return [];
}

/**
 * Parse decrypted blob content. Handles both legacy (flat array) and new format.
 */
function parseBlobContent(parsed) {
  if (Array.isArray(parsed)) {
    return {services: parsed, wallets: [], sync_conflicts: [], ssh_keys: []};
  }
  return {
    services: parsed.services || [],
    wallets: parsed.wallets || [],
    sync_conflicts: parsed.sync_conflicts || [],
    ssh_keys: parsed.ssh_keys || []
  };
}

/**
 * Sync v3 deletion reconciliation.
 * See the sync v3 reconciliation contract §2.
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

function canonicalBlobPayload(services, metadata, wallets = [], syncConflicts = [], sshKeys = []) {
  const svcByID = new Map();
  if (Array.isArray(metadata) && metadata.length > 0) {
    for (let i = 0; i < metadata.length; i++) {
      if (!metadata[i] || !metadata[i].id) continue;
      svcByID.set(metadata[i].id, {content: services[i] || {}, updated_at: metadata[i].updated_at});
    }
  } else if (Array.isArray(services)) {
    for (let i = 0; i < services.length; i++) {
      const s = services[i];
      if (!s || !s.id) continue;
      svcByID.set(s.id, {content: s, updated_at: s.updated_at});
    }
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
    const ka = (a && (a.wallet_id || a.wallet_name || a.id || "")).toLowerCase();
    const kb = (b && (b.wallet_id || b.wallet_name || b.id || "")).toLowerCase();
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
  const orderedSshKeys = [...(sshKeys || [])].sort((a, b) => {
    const ka = sshKeyId(a), kb = sshKeyId(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  // Top-level and service field order are part of the existing comparison contract. Every
  // nested/variable object below is recursively canonicalized by canonicalSyncJSON.
  return '{"services":[' + orderedServicePayloads.join(',') + ']' +
    ',"ssh_keys":' + canonicalSyncJSON(orderedSshKeys) +
    ',"wallets":' + canonicalSyncJSON(orderedWallets) +
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
    tombstones,
    deletion_review: payload.deletion_review || []
  };
}

/**
 * Main sync function.
 * secret: master secret string
 * email: user email string
 * localServices: array of service objects with optional id/updated_at
 * localWallets: array of wallet objects [{wallet_name, counter, created_at, updated_at, notes}]
 * localTombstones: array of tombstone objects [{id, deleted_at}]
 *
 * Returns: {services, wallets, ssh_keys, status, etag, knownUUIDs}
 * Throws on auth/network/server errors.
 */
async function syncWithServer(secret, email, localServices, localWallets = [], localTombstones = [], retryCount = 0, isCreate = false, localSshKeys = [], localWalletTombstones = [], localSshTombstones = []) {
  const storageArea = (typeof chrome !== "undefined" && chrome.storage?.local) ? chrome.storage.local : (typeof browser !== "undefined" && browser.storage?.local ? browser.storage.local : null);
  if (storageArea) {
    const { offline_mode } = await storageArea.get("offline_mode");
    if (offline_mode) {
      return { ok: true, status: "offline", offline: true };
    }
    if (!localWalletTombstones || localWalletTombstones.length === 0) {
      const wData = await storageArea.get("wallet_tombstones");
      if (Array.isArray(wData.wallet_tombstones)) localWalletTombstones = wData.wallet_tombstones;
    }
    if (!localSshTombstones || localSshTombstones.length === 0) {
      const sData = await storageArea.get("ssh_tombstones");
      if (Array.isArray(sData.ssh_tombstones)) localSshTombstones = sData.ssh_tombstones;
    }
  }
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
      throw Object.assign(new Error("network_error"), {code: "NETWORK_ERROR"});
    }

    let remoteServices = [];
    let remoteWallets = [];
    let remoteAuditLog = [];
    let remoteConflicts = [];
    let remoteMetadata = [];
    let remoteSshKeys = [];
    let etag = null;
    let remoteExists = false;
    let remoteVersion = 0;
    const lastSyncAt = await getLastSuccessfulSyncAt();

    if (getResp.status === 200) {
      remoteExists = true;
      const remote = await getResp.json();
      const capabilityStatus = classifySyncCapabilities(remote);
      if (capabilityStatus.status !== "legacy" || !hasLegacySyncResponseShape(remote)) {
        throw new Error("upgrade_required");
      }
      remoteVersion = Number.isSafeInteger(remote.version) ? remote.version : 0;
      etag = (getResp.headers.get("ETag") || "").replace(/"/g, "");

      // Validate checksum
      const blobBytes = base64ToArrayBuffer(remote.encrypted_blob);
      const checksum = await sha256Hex(blobBytes);
      if (checksum.toLowerCase() !== remote.checksum.toLowerCase()) throw new Error("checksum_mismatch");

      // Decrypt with AAD, fallback to no-AAD only for first-time migration
      const aad = new TextEncoder().encode(lookupId);
      let plaintext;
      try {
        plaintext = await decryptBlob(encKey, blobBytes, aad);
        if (storageArea) {
          await storageArea.set({ aadEnabled: true });
        }
      } catch (e) {
        // Only allow no-AAD fallback if we've never successfully decrypted with AAD
        let aadEnabled = false;
        if (storageArea) {
          const res = await storageArea.get("aadEnabled");
          aadEnabled = res?.aadEnabled;
        }
        if (aadEnabled) throw e;
        plaintext = await decryptBlob(encKey, blobBytes);
      }
      const parsed = JSON.parse(new TextDecoder().decode(plaintext));
      const blobContent = parseBlobContent(parsed);
      remoteServices = blobContent.services;
      remoteWallets = blobContent.wallets;
      remoteConflicts = blobContent.sync_conflicts;
      remoteSshKeys = blobContent.ssh_keys || [];

      // Extract metadata from services (or use remote.services if provided in legacy fixtures)
      if (Array.isArray(remote.services) && remote.services.length > 0 && remote.services[0] && remote.services[0].id) {
        remoteMetadata = remote.services;
      } else {
        remoteMetadata = remoteServices.map(s => ({id: s.id, updated_at: s.updated_at}));
      }

      // Validate length match only if outer services array was explicitly provided by the server
      if (Array.isArray(remote.services) && remote.services.length !== remoteServices.length) {
        throw new Error("metadata_length_mismatch");
      }

      // Validate metadata integrity against cache if outer metadata was present
      if (Array.isArray(remote.services) && remote.services.length > 0) {
        const cachedMeta = await getMetadataCache();
        if (cachedMeta) {
          validateMetadataIntegrity(remoteMetadata, cachedMeta);
        }
      }
    } else if (getResp.status === 404) {
      if (!isCreate && localServices.length === 0 && localWallets.length === 0 && localSshKeys.length === 0) {
        throw Object.assign(new Error("account_not_found"), {code: "ACCOUNT_NOT_FOUND"});
      }
      // Initial state
      remoteExists = false;
      remoteVersion = 0;
    } else if (getResp.status === 401) {
      throw Object.assign(new Error("auth_failed"), {code: "AUTH_FAILED"});
    } else if (getResp.status === 429) {
      const err = Object.assign(new Error("rate_limited"), {code: "RATE_LIMITED"});
      err.retryAfter = parseInt(getResp.headers.get("Retry-After"), 10) || 60;
      throw err;
    } else {
      throw Object.assign(new Error("server_error"), {code: "SERVER_ERROR"});
    }

    // Step 2: Reconcile
    const rec = reconcileServices(localServices, localTombstones, remoteServices, remoteMetadata, lastSyncAt, remoteExists);
    const merged = rec.merged;
    const {merged: mergedWallets, tombstones: remWalletTombstones} = mergeWallets(localWallets, remoteWallets, localWalletTombstones, [], lastSyncAt, remoteExists);
    const {merged: mergedSshKeys, tombstones: remSshTombstones} = mergeSshKeys(localSshKeys, remoteSshKeys, localSshTombstones, [], lastSyncAt, remoteExists);

    // Empty-push protection: an empty push is legitimate only when every remote id it
    // drops is explicitly declared as deleted.
    if (merged.length === 0 && remoteMetadata.length > 0) {
      const declared = new Set(rec.deletedIds);
      const allDeclared = remoteMetadata.every(m => m && m.id && declared.has(m.id));
      if (!allDeclared) throw Object.assign(new Error("empty_push_blocked"), {code: "EMPTY_PUSH_BLOCKED"});
    }

    // Step 3: Build push payload
    const contentArray = merged.map(({id, updated_at, synced, ...content}) => content);
    const metadataArray = merged.map(s => ({id: s.id, updated_at: s.updated_at}));

    // Merge conflicts: remote + new, dedup by winner_id+loser.id, cap at 50
    const dismissData = (storageArea ? await storageArea.get("conflictsDismissed") : await chrome.storage.local.get("conflictsDismissed"));
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

    // Step 3b: Client Dirty-Checking (Zero-Write on No-Op)
    const hasPendingTombstones = rec.tombstones.length > 0 || rec.deletedIds.length > 0 || remWalletTombstones.length > 0 || remSshTombstones.length > 0;
    if (remoteExists && !hasPendingTombstones) {
      const localCanon = canonicalBlobPayload(contentArray, metadataArray, mergedWallets, sync_conflicts, mergedSshKeys);
      const remoteCanon = canonicalBlobPayload(remoteServices, remoteMetadata, remoteWallets, remoteConflicts, remoteSshKeys);
      if (localCanon === remoteCanon) {
        await setLastSuccessfulSyncAt(Date.now());
        await setSyncVersion(remoteVersion);
        if (storageArea) {
          await storageArea.set({
            syncVersion: remoteVersion,
            sync_version: remoteVersion,
            wallet_tombstones: remWalletTombstones,
            ssh_tombstones: remSshTombstones,
          });
        }
        return {
          services: merged,
          wallets: mergedWallets,
          ssh_keys: mergedSshKeys,
          sync_conflicts,
          status: "unchanged",
          version: remoteVersion,
          etag,
          tombstones: rec.tombstones,
          walletTombstones: remWalletTombstones,
          sshTombstones: remSshTombstones,
          review: rec.review,
          resurrected: rec.resurrected,
          skippedPut: true
        };
      }
    }

    // Step 4: Encrypt and PUT request
    const cleanServices = merged.map(({synced, frecency, ...s}) => s);
    const blobPayload = {
      services: cleanServices,
      ssh_keys: mergedSshKeys,
      wallets: mergedWallets,
      sync_conflicts
    };
    const plaintext = new TextEncoder().encode(JSON.stringify(blobPayload));
    const aadEnc = new TextEncoder().encode(lookupId);
    const encrypted = await encryptBlob(encKey, plaintext, aadEnc);
    const encryptedB64 = arrayBufferToBase64(encrypted);
    const checksum = await sha256Hex(encrypted);

    const nextVersion = remoteExists ? (remoteVersion + 1) : 1;

    const putHeaders = {
      "Authorization": authHeader,
      "Content-Type": "application/json",
    };
    if (etag) putHeaders["If-Match"] = '"' + etag + '"';

    let putResp;
    try {
      putResp = await fetch(syncServer + "/api/sync/" + lookupId, {
        method: "PUT",
        headers: putHeaders,
        body: JSON.stringify({
          version: nextVersion,
          encrypted_blob: encryptedB64,
          checksum
        }),
      });
    } catch (e) {
      throw Object.assign(new Error("network_error"), {code: "NETWORK_ERROR"});
    }

    if (putResp.status === 409) {
      try { await putResp.json(); } catch (_) {}
      if (retryCount < 3) {
        await sleepWithJitter(CONFLICT_BACKOFF_MS[retryCount]);
        return syncWithServer(secret, email, localServices, localWallets, localTombstones, retryCount + 1, isCreate, localSshKeys, localWalletTombstones, localSshTombstones);
      }
      throw Object.assign(new Error("conflict"), {code: "CONFLICT", status: "conflict"});
    }
    if (putResp.status === 401) throw Object.assign(new Error("auth_failed"), {code: "AUTH_FAILED"});
    if (putResp.status === 429) {
      const err = Object.assign(new Error("rate_limited"), {code: "RATE_LIMITED"});
      err.retryAfter = parseInt(putResp.headers.get("Retry-After"), 10) || 60;
      throw err;
    }
    if (putResp.status !== 200 && putResp.status !== 201) throw new Error("server_error");

    const putResult = await putResp.json();
    const finalVersion = putResult.version || nextVersion;
    const finalEtag = putResult.etag || (putResp.headers.get("ETag") || "").replace(/"/g, "");

    await setLastSuccessfulSyncAt(Date.now());
    await setSyncVersion(finalVersion);
    if (putResult.services) {
      await setMetadataCache(putResult.services);
    } else {
      await setMetadataCache(metadataArray);
    }

    const confirmedServices = merged.map(s => ({...s, synced: true}));
    const status = remoteExists ? "synced" : "created";
    if (storageArea) {
      await storageArea.set({
        syncVersion: finalVersion,
        sync_version: finalVersion,
        syncConflicts: sync_conflicts,
        conflictsDismissed: false,
        wallet_tombstones: [],
        ssh_tombstones: [],
      });
    }
    return {
      services: confirmedServices,
      wallets: mergedWallets,
      ssh_keys: mergedSshKeys,
      sync_conflicts,
      status,
      version: finalVersion,
      etag: finalEtag,
      tombstones: [],
      walletTombstones: [],
      sshTombstones: [],
      review: rec.review,
      resurrected: rec.resurrected,
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
