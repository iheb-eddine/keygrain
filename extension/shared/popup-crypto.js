// arrayBufferToBase64 and base64ToArrayBuffer provided by sync.js (loaded before this file)

async function pinDeriveKey(pin, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256"},
    keyMaterial, {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]
  );
}

async function pinEncryptSecret(pin, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pinDeriveKey(pin, salt);
  const ciphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, new TextEncoder().encode(secret));
  return {encrypted: arrayBufferToBase64(ciphertext), salt: arrayBufferToBase64(salt), iv: arrayBufferToBase64(iv)};
}

async function pinDecryptSecret(pin, stored) {
  const salt = base64ToArrayBuffer(stored.salt);
  const iv = base64ToArrayBuffer(stored.iv);
  const key = await pinDeriveKey(pin, salt);
  const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv}, key, base64ToArrayBuffer(stored.encrypted));
  return new TextDecoder().decode(decrypted);
}

async function deriveStorageKey(secret, email) {
  const enc = new TextEncoder();
  const strengthenGeneration = getStrengthenGeneration();
  const strengthened = await strengthenSecret(secret, email);
  assertStrengthenGeneration(strengthenGeneration);
  const message = enc.encode(email.toLowerCase() + ":keygrain-local-storage");
  const key = await hmacSHA256(strengthened, message);
  assertStrengthenGeneration(strengthenGeneration);
  return key;
}

// Local encrypted payload, version 2 (Sync v3 — see
// designs/sync-deletion-reconciliation.md §1). Adds, relative to version 1:
//   - services[].synced   : identity has been confirmed on the server at least once
//   - tombstones          : [{id, deleted_at}] pending deletions, local-only
//   - deletion_review     : [{service, deleted_at, seen}] conflict cases, local-only
// tombstones and deletion_review are NEVER synced; they do not enter the sync blob.
const LOCAL_PAYLOAD_VERSION = 2;
const LOCAL_PAYLOAD_V3_VERSION = 3;
const LOCAL_PENDING_SYNC_VERSION = 1;
const LOCAL_MUTATION_ID_BYTES = 32;
const LOCAL_BASE64URL = /^[A-Za-z0-9_-]+$/;
const LOCAL_MAX_UPDATE_VERSION = Number.MAX_SAFE_INTEGER;

function localBytesToBase64Url(value) {
  return arrayBufferToBase64(value).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function localBase64UrlToBytes(value) {
  if (typeof value !== "string" || !LOCAL_BASE64URL.test(value)) throw new Error("invalid_local_payload");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const bytes = new Uint8Array(base64ToArrayBuffer(padded));
  if (localBytesToBase64Url(bytes) !== value) throw new Error("invalid_local_payload");
  return bytes;
}

function createLocalMutationId() {
  return localBytesToBase64Url(crypto.getRandomValues(new Uint8Array(LOCAL_MUTATION_ID_BYTES)));
}

function localPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null) return true;
    const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
    return Object.prototype.toString.call(value) === "[object Object]"
      && Object.getPrototypeOf(prototype) === null
      && typeof constructor === "function" && constructor.name === "Object";
  } catch (_) {
    return false;
  }
}

function localOwnValue(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    throw new Error("invalid_local_payload");
  }
  return descriptor.value;
}

function localOwnKeys(object) {
  const keys = Object.getOwnPropertyNames(object);
  if (typeof Object.getOwnPropertySymbols === "function") keys.push(...Object.getOwnPropertySymbols(object));
  return keys;
}

function localAllowedKeys(object, allowed, required = []) {
  const actual = localOwnKeys(object);
  if (actual.some(key => typeof key !== "string" || !allowed.includes(key))
    || required.some(key => !actual.includes(key))) throw new Error("invalid_local_payload");
}

function localExactKeys(object, expected) {
  const actual = localOwnKeys(object);
  if (actual.length !== expected.length || actual.some(key => typeof key !== "string" || !expected.includes(key))) {
    throw new Error("invalid_local_payload");
  }
}

function localOrderedKeys(object, expected) {
  const actual = localOwnKeys(object);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("invalid_local_payload");
  }
}

function localPendingSync(value) {
  if (value === null) return null;
  if (!localPlainObject(value)) throw new Error("invalid_local_payload");
  localOrderedKeys(value, ["version", "mutationId", "updateVersion"]);
  if (localOwnValue(value, "version") !== LOCAL_PENDING_SYNC_VERSION) throw new Error("invalid_local_payload");
  const mutationId = localOwnValue(value, "mutationId");
  const bytes = localBase64UrlToBytes(mutationId);
  if (bytes.length !== LOCAL_MUTATION_ID_BYTES) throw new Error("invalid_local_payload");
  const updateVersion = localOwnValue(value, "updateVersion");
  if (!Number.isSafeInteger(updateVersion) || updateVersion < 0 || updateVersion > LOCAL_MAX_UPDATE_VERSION) {
    throw new Error("invalid_local_payload");
  }
  return {version: LOCAL_PENDING_SYNC_VERSION, mutationId, updateVersion};
}

function localCollection(value) {
  if (!Array.isArray(value)) throw new Error("invalid_local_payload");
  for (const entry of value) if (!localPlainObject(entry)) throw new Error("invalid_local_payload");
  return value.slice();
}

// The local encrypted-storage plaintext reader. This is intentionally separate
// from sync.js's server plaintext parser: similar field names do not make those
// two data domains interchangeable. The helper validates only the outer local
// container; nested record semantics belong to Phase B operations.
function validateLocalPayload(data) {
  if (Array.isArray(data)) {
    return {
      services: localCollection(data),
      wallets: [],
      walletAuditLog: [],
      tombstones: [],
      deletionReview: [],
      pendingSync: null,
      payloadVersion: 1,
    };
  }
  if (!localPlainObject(data)) throw new Error("invalid_local_payload");

  const version = localOwnValue(data, "version");
  if (!Number.isInteger(version)) throw new Error("invalid_local_payload");
  if (version === 1) {
    localAllowedKeys(data, ["version", "services", "wallets", "wallet_audit_log"], ["version", "services"]);
    const services = localCollection(localOwnValue(data, "services"));
    const wallets = Object.prototype.hasOwnProperty.call(data, "wallets")
      ? localCollection(localOwnValue(data, "wallets")) : [];
    const walletAuditLog = Object.prototype.hasOwnProperty.call(data, "wallet_audit_log")
      ? localCollection(localOwnValue(data, "wallet_audit_log")) : [];
    return {services, wallets, walletAuditLog, tombstones: [], deletionReview: [], pendingSync: null, payloadVersion: 1};
  }
  if (version === 2) {
    localExactKeys(data, ["version", "services", "wallets", "wallet_audit_log", "tombstones", "deletion_review"]);
    return {
      services: localCollection(localOwnValue(data, "services")),
      wallets: localCollection(localOwnValue(data, "wallets")),
      walletAuditLog: localCollection(localOwnValue(data, "wallet_audit_log")),
      tombstones: localCollection(localOwnValue(data, "tombstones")),
      deletionReview: localCollection(localOwnValue(data, "deletion_review")),
      pendingSync: null,
      payloadVersion: 2,
    };
  }
  if (version === LOCAL_PAYLOAD_V3_VERSION) {
    localOrderedKeys(data, ["version", "services", "wallets", "wallet_audit_log", "tombstones", "deletion_review", "pending_sync"]);
    return {
      services: localCollection(localOwnValue(data, "services")),
      wallets: localCollection(localOwnValue(data, "wallets")),
      walletAuditLog: localCollection(localOwnValue(data, "wallet_audit_log")),
      tombstones: localCollection(localOwnValue(data, "tombstones")),
      deletionReview: localCollection(localOwnValue(data, "deletion_review")),
      pendingSync: localPendingSync(localOwnValue(data, "pending_sync")),
      payloadVersion: LOCAL_PAYLOAD_V3_VERSION,
    };
  }
  throw new Error("invalid_local_payload");
}

async function encryptServices(storageKey, email, services, wallets, walletAuditLog, tombstones = [], deletionReview = []) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(email.toLowerCase());
  const plaintext = new TextEncoder().encode(JSON.stringify({
    version: LOCAL_PAYLOAD_VERSION,
    services,
    wallets,
    wallet_audit_log: walletAuditLog,
    tombstones,
    deletion_review: deletionReview
  }));
  const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, plaintext);
  return {
    version: 2,
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertext)
  };
}

async function decryptServices(storageKey, email, stored) {
  const iv = base64ToArrayBuffer(stored.iv);
  const ciphertext = base64ToArrayBuffer(stored.ciphertext);
  const aad = new TextEncoder().encode(email.toLowerCase());
  const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
  const data = JSON.parse(new TextDecoder().decode(decrypted));
  return validateLocalPayload(data);
}

async function encryptServicesV3(storageKey, email, payload) {
  const normalized = validateLocalPayload(payload);
  if (normalized.payloadVersion !== LOCAL_PAYLOAD_V3_VERSION) throw new Error("invalid_local_payload");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(email.toLowerCase());
  const plaintext = new TextEncoder().encode(JSON.stringify({
    version: LOCAL_PAYLOAD_V3_VERSION,
    services: normalized.services,
    wallets: normalized.wallets,
    wallet_audit_log: normalized.walletAuditLog,
    tombstones: normalized.tombstones,
    deletion_review: normalized.deletionReview,
    pending_sync: normalized.pendingSync
  }));
  try {
    const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["encrypt"]);
    const ciphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, plaintext);
    return {version: 2, iv: arrayBufferToBase64(iv), ciphertext: arrayBufferToBase64(ciphertext)};
  } finally {
    plaintext.fill(0); iv.fill(0); aad.fill(0);
  }
}

function localCanonicalJson(value, seen = new Set()) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("invalid_local_payload");
    return String(value);
  }
  if (typeof value !== "object" || seen.has(value)) throw new Error("invalid_local_payload");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some(key => typeof key !== "string")) throw new Error("invalid_local_payload");
      const names = Object.getOwnPropertyNames(value);
      if (names.length !== value.length + 1 || !names.includes("length")) throw new Error("invalid_local_payload");
      const items = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) throw new Error("invalid_local_payload");
        items.push(localCanonicalJson(descriptor.value, seen));
      }
      return "[" + items.join(",") + "]";
    }
    if (!localPlainObject(value)) throw new Error("invalid_local_payload");
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== "string")) throw new Error("invalid_local_payload");
    const entries = keys.map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) throw new Error("invalid_local_payload");
      return [key, descriptor.value];
    }).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
    return "{" + entries.map(([key, item]) => JSON.stringify(key) + ":" + localCanonicalJson(item, seen)).join(",") + "}";
  } finally {
    seen.delete(value);
  }
}

function canonicalLocalPayloadJson(payload) {
  if (!localPlainObject(payload)) throw new Error("invalid_local_payload");
  localOrderedKeys(payload, ["version", "services", "wallets", "wallet_audit_log", "tombstones", "deletion_review", "pending_sync"]);
  const normalized = validateLocalPayload(payload);
  if (normalized.payloadVersion !== LOCAL_PAYLOAD_V3_VERSION) throw new Error("invalid_local_payload");
  const fields = [
    ["version", LOCAL_PAYLOAD_V3_VERSION],
    ["services", normalized.services],
    ["wallets", normalized.wallets],
    ["wallet_audit_log", normalized.walletAuditLog],
    ["tombstones", normalized.tombstones],
    ["deletion_review", normalized.deletionReview],
    ["pending_sync", normalized.pendingSync]
  ];
  return "{" + fields.map(([key, value]) => JSON.stringify(key) + ":" + localCanonicalJson(value)).join(",") + "}";
}

async function fingerprintLocalPayload(payload) {
  const bytes = new TextEncoder().encode(canonicalLocalPayloadJson(payload));
  try {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  } finally {
    bytes.fill(0);
  }
}
