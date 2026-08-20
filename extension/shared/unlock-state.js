(function () {
// Keygrain sequential runtime authority. Runtime data is memory-only; browser
// adapters own persistence and lifecycle integration.
const KEYGRAIN_STATE = Object.freeze({
  LOCKED: "locked",
  FULL: "full",
  METADATA: "metadata",
});

const KEYGRAIN_SETTINGS_KEY = "keygrainSecurityLeaseSettings";
const KEYGRAIN_SETTINGS_VERSION = 1;
const KEYGRAIN_FULL_MIN_SECONDS = 30;
const KEYGRAIN_FULL_DEFAULT_SECONDS = 60;
const KEYGRAIN_FULL_NORMAL_MAX_SECONDS = 900;
const KEYGRAIN_FULL_EXCEPTIONAL_MAX_SECONDS = 1800;
const KEYGRAIN_METADATA_MIN_SECONDS = 0;
const KEYGRAIN_METADATA_DEFAULT_SECONDS = 14400;
const KEYGRAIN_METADATA_MAX_SECONDS = 86400;
const KEYGRAIN_FULL_WARNING_LEAD_SECONDS = 30;
const KEYGRAIN_METADATA_WARNING_LEAD_SECONDS = 900;
const KEYGRAIN_COMPLETION_GRACE_SECONDS = 5;

const KEYGRAIN_ALLOWED_INVALIDATIONS = new Set([
  "account_switch",
  "authentication_failure",
  "runtime_shutdown",
  "clock_rollback",
  "external_security_invalidation",
]);
const KEYGRAIN_PRIVATE = new Map();

function stateError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || (Object.prototype.toString.call(value) === "[object Object]"
      && prototype?.constructor?.name === "Object");
  } catch (_) {
    return false;
  }
}

function exactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function normalizeSecuritySettings(raw) {
  try {
    if (!isPlainObject(raw) || !exactKeys(raw, ["version", "fullLeaseSeconds", "metadataTailSeconds"])) {
      throw stateError("KEYGRAIN_SETTINGS_ERROR");
    }
    const values = {};
    for (const key of ["version", "fullLeaseSeconds", "metadataTailSeconds"]) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        throw stateError("KEYGRAIN_SETTINGS_ERROR");
      }
      values[key] = descriptor.value;
    }
    const {version, fullLeaseSeconds, metadataTailSeconds} = values;
    const validFull = Number.isSafeInteger(fullLeaseSeconds)
      && (fullLeaseSeconds >= KEYGRAIN_FULL_MIN_SECONDS && fullLeaseSeconds <= KEYGRAIN_FULL_NORMAL_MAX_SECONDS
        || fullLeaseSeconds === KEYGRAIN_FULL_EXCEPTIONAL_MAX_SECONDS);
    const validMetadata = Number.isSafeInteger(metadataTailSeconds)
      && metadataTailSeconds >= KEYGRAIN_METADATA_MIN_SECONDS
      && metadataTailSeconds <= KEYGRAIN_METADATA_MAX_SECONDS;
    if (version !== KEYGRAIN_SETTINGS_VERSION || !validFull || !validMetadata) {
      throw stateError("KEYGRAIN_SETTINGS_ERROR");
    }
    return Object.freeze({
      version: KEYGRAIN_SETTINGS_VERSION,
      fullLeaseSeconds,
      metadataTailSeconds,
    });
  } catch (error) {
    if (error?.code === "KEYGRAIN_SETTINGS_ERROR") throw error;
    throw stateError("KEYGRAIN_SETTINGS_ERROR");
  }
}

function migrateSecuritySettings(raw) {
  try {
    return {normalized: normalizeSecuritySettings(raw), needsWrite: false};
  } catch (_) {
    return {
      normalized: Object.freeze({
        version: KEYGRAIN_SETTINGS_VERSION,
        fullLeaseSeconds: KEYGRAIN_FULL_DEFAULT_SECONDS,
        metadataTailSeconds: KEYGRAIN_METADATA_DEFAULT_SECONDS,
      }),
      needsWrite: true,
    };
  }
}

function confirmExceptionalFullLease(manager) {
  const state = KEYGRAIN_PRIVATE.get(manager);
  if (!state) throw stateError("KEYGRAIN_CONFIRMATION_ERROR");
  const token = Object.freeze({});
  state.confirmations.set(token, {revision: state.settingsRevision, used: false});
  return token;
}

function projectMetadataState(records) {
  if (!Array.isArray(records)) throw stateError("KEYGRAIN_METADATA_ERROR");
  try {
    const output = records.map(record => {
      if (!isPlainObject(record)) throw stateError("KEYGRAIN_METADATA_ERROR");
      const entry = {};
      for (const key of ["id", "site", "name", "email"]) {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || descriptor.value === null) {
          entry[key] = null;
        } else if (!Object.prototype.hasOwnProperty.call(descriptor, "value")
          || typeof descriptor.value !== "string") {
          throw stateError("KEYGRAIN_METADATA_ERROR");
        } else {
          entry[key] = descriptor.value;
        }
      }
      return Object.freeze(entry);
    });
    return Object.freeze(output);
  } catch (error) {
    if (error?.code === "KEYGRAIN_METADATA_ERROR") throw error;
    throw stateError("KEYGRAIN_METADATA_ERROR");
  }
}

function clearMemory(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (value instanceof Uint8Array) {
    value.fill(0);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) clearMemory(item, seen);
    value.length = 0;
    return;
  }
  for (const key of Object.keys(value)) {
    const item = value[key];
    clearMemory(item, seen);
    try { value[key] = null; } catch (_) {}
  }
}

function cloneData(value, seen = new Map(), depth = 0) {
  if (depth > 32) throw stateError("KEYGRAIN_STALE_OPERATION");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw stateError("KEYGRAIN_STALE_OPERATION");
    return value;
  }
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value !== "object" || typeof value === "function" || value instanceof Promise) {
    throw stateError("KEYGRAIN_STALE_OPERATION");
  }
  if (seen.has(value)) throw stateError("KEYGRAIN_STALE_OPERATION");
  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (const item of value) result.push(cloneData(item, seen, depth + 1));
    seen.delete(value);
    return result;
  }
  if (!isPlainObject(value)) throw stateError("KEYGRAIN_STALE_OPERATION");
  const result = Object.create(null);
  seen.set(value, result);
  for (const key of Object.keys(value)) result[key] = cloneData(value[key], seen, depth + 1);
  seen.delete(value);
  return result;
}

function metadataCopy(metadata) {
  return metadata.map(entry => ({
    id: entry.id,
    site: entry.site,
    name: entry.name,
    email: entry.email,
  }));
}

function operationHandleCopy(handle) {
  return Object.freeze({
    operationId: handle.operationId,
    authorizationGeneration: handle.authorizationGeneration,
    acceptedAt: handle.acceptedAt,
    fullExpiresAt: handle.fullExpiresAt,
    effectiveDeadline: handle.effectiveDeadline,
  });
}

class KeygrainStateManager {
  constructor({clock, settings} = {}) {
    if (typeof clock !== "function") throw stateError("KEYGRAIN_SETTINGS_ERROR");
    const normalized = normalizeSecuritySettings(settings);
    const initialNow = clock();
    if (!Number.isFinite(initialNow)) throw stateError("KEYGRAIN_CLOCK_ROLLBACK");
    const privateState = {
      clock,
      lastNow: initialNow,
      settings: normalized,
      settingsRevision: 0,
      confirmations: new WeakMap(),
      operations: new Map(),
      nextOperationId: 1,
    };
    KEYGRAIN_PRIVATE.set(this, privateState);
    this._state = KEYGRAIN_STATE.LOCKED;
    this._stateGeneration = 0;
    this._authorizationGeneration = 0;
    this._fullData = null;
    this._metadata = null;
    this._fullExpiresAt = null;
    this._metadataExpiresAt = null;
    this._metadataTailAnchor = null;
    this._activeMetadataTailSeconds = null;
  }

  _private() { return KEYGRAIN_PRIVATE.get(this); }

  _bumpState() {
    if (this._stateGeneration === Number.MAX_SAFE_INTEGER) throw stateError("KEYGRAIN_INVALIDATION_ERROR");
    this._stateGeneration++;
  }

  _bumpAuthorization() {
    if (this._authorizationGeneration === Number.MAX_SAFE_INTEGER) throw stateError("KEYGRAIN_INVALIDATION_ERROR");
    this._authorizationGeneration++;
  }

  _readNow() {
    const privateState = this._private();
    let now;
    try { now = privateState.clock(); } catch (_) { now = NaN; }
    if (!Number.isFinite(now)) {
      this._failClosedRollback();
      throw stateError("KEYGRAIN_CLOCK_ROLLBACK");
    }
    if (now < privateState.lastNow) {
      this._failClosedRollback();
      throw stateError("KEYGRAIN_CLOCK_ROLLBACK");
    }
    privateState.lastNow = now;
    return now;
  }

  _failClosedRollback() {
    if (this._fullData !== null) clearMemory(this._fullData);
    this._fullData = null;
    this._metadata = null;
    this._state = KEYGRAIN_STATE.LOCKED;
    this._fullExpiresAt = null;
    this._metadataExpiresAt = null;
    this._metadataTailAnchor = null;
    this._activeMetadataTailSeconds = null;
    this._clearOperations();
    this._bumpState();
    this._bumpAuthorization();
  }

  _clearOperations() {
    const privateState = this._private();
    for (const operation of privateState.operations.values()) clearMemory(operation.input);
    privateState.operations.clear();
  }

  _sweepOperations(now) {
    const privateState = this._private();
    for (const [id, operation] of privateState.operations) {
      if (now >= operation.handle.effectiveDeadline) {
        clearMemory(operation.input);
        privateState.operations.delete(id);
      }
    }
  }

  _reconcile(now, sweepOperations = true) {
    const privateState = this._private();
    if (this._state === KEYGRAIN_STATE.FULL && now >= this._fullExpiresAt) {
      const activeTailSeconds = this._activeMetadataTailSeconds;
      if (this._fullData !== null) clearMemory(this._fullData);
      this._fullData = null;
      this._fullExpiresAt = null;
      this._activeMetadataTailSeconds = null;
      this._bumpState();
      if (activeTailSeconds === 0) {
        this._metadata = null;
        this._metadataExpiresAt = null;
        this._metadataTailAnchor = null;
        this._state = KEYGRAIN_STATE.LOCKED;
      } else {
        this._state = KEYGRAIN_STATE.METADATA;
        this._metadataExpiresAt = this._metadataTailAnchor;
        if (now >= this._metadataExpiresAt) {
          this._metadata = null;
          this._metadataExpiresAt = null;
          this._metadataTailAnchor = null;
          this._state = KEYGRAIN_STATE.LOCKED;
          this._bumpState();
        }
      }
    } else if (this._state === KEYGRAIN_STATE.METADATA && now >= this._metadataExpiresAt) {
      this._metadata = null;
      this._metadataExpiresAt = null;
      this._metadataTailAnchor = null;
      this._activeMetadataTailSeconds = null;
      this._state = KEYGRAIN_STATE.LOCKED;
      this._bumpState();
    }
    if (sweepOperations) this._sweepOperations(now);
  }

  _snapshotWithoutRead() {
    const privateState = this._private();
    const full = this._state === KEYGRAIN_STATE.FULL;
    const metadata = this._state === KEYGRAIN_STATE.METADATA;
    return Object.freeze({
      state: this._state,
      stateGeneration: this._stateGeneration,
      authorizationGeneration: this._authorizationGeneration,
      fullExpiresAt: full ? this._fullExpiresAt : null,
      metadataExpiresAt: metadata ? this._metadataExpiresAt : null,
      fullWarningAt: full ? this._fullExpiresAt - KEYGRAIN_FULL_WARNING_LEAD_SECONDS * 1000 : null,
      metadataWarningAt: metadata ? this._metadataExpiresAt - KEYGRAIN_METADATA_WARNING_LEAD_SECONDS * 1000 : null,
      metadataAvailable: metadata,
      hasFullData: full && this._fullData !== null,
    });
  }

  _validateConfirmation(token, required) {
    if (!required) return;
    const privateState = this._private();
    const record = token && typeof token === "object" ? privateState.confirmations.get(token) : null;
    if (!record || record.used || record.revision !== privateState.settingsRevision) {
      throw stateError("KEYGRAIN_CONFIRMATION_ERROR");
    }
  }

  _consumeConfirmation(token, required) {
    if (!required) return;
    const privateState = this._private();
    const record = privateState.confirmations.get(token);
    if (!record || record.used || record.revision !== privateState.settingsRevision) {
      throw stateError("KEYGRAIN_CONFIRMATION_ERROR");
    }
    record.used = true;
  }

  _validateDeadline(startedAt, seconds) {
    if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(seconds)) {
      throw stateError("KEYGRAIN_SETTINGS_ERROR");
    }
    const expiresAt = startedAt + seconds * 1000;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= startedAt) throw stateError("KEYGRAIN_SETTINGS_ERROR");
    return expiresAt;
  }

  applySettings(normalizedSettings) {
    const settings = normalizeSecuritySettings(normalizedSettings);
    const oldSettings = this._private().settings;
    this._private().settings = settings;
    if (oldSettings.fullLeaseSeconds !== settings.fullLeaseSeconds
      || oldSettings.metadataTailSeconds !== settings.metadataTailSeconds) {
      this._private().settingsRevision++;
    }
  }

  snapshot() {
    const now = this._readNow();
    this._reconcile(now);
    return this._snapshotWithoutRead();
  }

  getMetadata() {
    const now = this._readNow();
    this._reconcile(now);
    return this._state === KEYGRAIN_STATE.METADATA ? metadataCopy(this._metadata) : null;
  }

  warningStatus() {
    const now = this._readNow();
    this._reconcile(now);
    const full = this._state === KEYGRAIN_STATE.FULL;
    const metadata = this._state === KEYGRAIN_STATE.METADATA;
    return Object.freeze({
      fullDue: full && now >= this._fullExpiresAt - KEYGRAIN_FULL_WARNING_LEAD_SECONDS * 1000 && now < this._fullExpiresAt,
      metadataDue: metadata && now >= this._metadataExpiresAt - KEYGRAIN_METADATA_WARNING_LEAD_SECONDS * 1000 && now < this._metadataExpiresAt,
      fullRemainingMs: full ? Math.max(0, this._fullExpiresAt - now) : null,
      metadataRemainingMs: metadata ? Math.max(0, this._metadataExpiresAt - now) : null,
    });
  }

  unlockFull({fullData, records, exceptionalConfirmation = null} = {}) {
    const metadata = projectMetadataState(records);
    let clonedFullData;
    try {
      clonedFullData = cloneData(fullData);
    } catch (_) {
      throw stateError("KEYGRAIN_STALE_OPERATION");
    }
    const privateState = this._private();
    const requiresConfirmation = privateState.settings.fullLeaseSeconds === KEYGRAIN_FULL_EXCEPTIONAL_MAX_SECONDS;
    this._validateConfirmation(exceptionalConfirmation, requiresConfirmation);
    const now = this._readNow();
    const expiresAt = this._validateDeadline(now, privateState.settings.fullLeaseSeconds);
    const metadataTailAnchor = privateState.settings.metadataTailSeconds === 0
      ? null
      : this._validateDeadline(expiresAt, privateState.settings.metadataTailSeconds);
    if (this._fullData !== null) clearMemory(this._fullData);
    this._clearOperations();
    this._fullData = clonedFullData;
    this._metadata = metadata;
    this._fullExpiresAt = expiresAt;
    this._metadataTailAnchor = privateState.settings.metadataTailSeconds === 0 ? null : metadataTailAnchor;
    this._activeMetadataTailSeconds = privateState.settings.metadataTailSeconds;
    this._metadataExpiresAt = null;
    this._state = KEYGRAIN_STATE.FULL;
    this._bumpState();
    this._bumpAuthorization();
    this._consumeConfirmation(exceptionalConfirmation, requiresConfirmation);
    return Object.freeze({startedAt: now, expiresAt, durationSeconds: privateState.settings.fullLeaseSeconds});
  }

  extendFull({exceptionalConfirmation = null} = {}) {
    const now = this._readNow();
    this._reconcile(now);
    if (this._state !== KEYGRAIN_STATE.FULL) return null;
    const privateState = this._private();
    const requiresConfirmation = privateState.settings.fullLeaseSeconds === KEYGRAIN_FULL_EXCEPTIONAL_MAX_SECONDS;
    this._validateConfirmation(exceptionalConfirmation, requiresConfirmation);
    const expiresAt = this._validateDeadline(now, privateState.settings.fullLeaseSeconds);
    const metadataTailAnchor = privateState.settings.metadataTailSeconds === 0
      ? null
      : this._validateDeadline(expiresAt, privateState.settings.metadataTailSeconds);
    this._fullExpiresAt = expiresAt;
    this._metadataTailAnchor = privateState.settings.metadataTailSeconds === 0 ? null : metadataTailAnchor;
    this._activeMetadataTailSeconds = privateState.settings.metadataTailSeconds;
    this._bumpState();
    this._bumpAuthorization();
    this._clearOperations();
    this._consumeConfirmation(exceptionalConfirmation, requiresConfirmation);
    return Object.freeze({startedAt: now, expiresAt, durationSeconds: privateState.settings.fullLeaseSeconds});
  }

  restoreFull({fullData, records, fullExpiresAt, metadataTailAnchor = null, activeMetadataTailSeconds = null} = {}) {
    const now = this._readNow();
    if (typeof fullExpiresAt !== "number" || !Number.isFinite(fullExpiresAt) || now >= fullExpiresAt) {
      throw stateError("KEYGRAIN_EXPIRED");
    }
    const metadata = projectMetadataState(records);
    let clonedFullData;
    try {
      clonedFullData = cloneData(fullData);
    } catch (_) {
      throw stateError("KEYGRAIN_STALE_OPERATION");
    }
    const privateState = this._private();
    if (this._fullData !== null) clearMemory(this._fullData);
    this._clearOperations();
    this._fullData = clonedFullData;
    this._metadata = metadata;
    this._fullExpiresAt = fullExpiresAt;
    this._metadataTailAnchor = metadataTailAnchor;
    this._activeMetadataTailSeconds = activeMetadataTailSeconds ?? privateState.settings.metadataTailSeconds;
    this._metadataExpiresAt = null;
    this._state = KEYGRAIN_STATE.FULL;
    this._bumpState();
    this._bumpAuthorization();
    return this._snapshotWithoutRead();
  }

  restoreMetadata({metadata, metadataExpiresAt, metadataTailAnchor = null, activeMetadataTailSeconds = null} = {}) {
    const now = this._readNow();
    if (typeof metadataExpiresAt !== "number" || !Number.isFinite(metadataExpiresAt) || now >= metadataExpiresAt) {
      throw stateError("KEYGRAIN_EXPIRED");
    }
    if (!Array.isArray(metadata)) {
      throw stateError("KEYGRAIN_STALE_OPERATION");
    }
    let clonedMetadata;
    try {
      clonedMetadata = cloneData(metadata);
    } catch (_) {
      throw stateError("KEYGRAIN_STALE_OPERATION");
    }
    const privateState = this._private();
    if (this._fullData !== null) clearMemory(this._fullData);
    this._clearOperations();
    this._fullData = null;
    this._metadata = clonedMetadata;
    this._fullExpiresAt = null;
    this._metadataExpiresAt = metadataExpiresAt;
    this._metadataTailAnchor = metadataTailAnchor || metadataExpiresAt;
    this._activeMetadataTailSeconds = activeMetadataTailSeconds ?? privateState.settings.metadataTailSeconds;
    this._state = KEYGRAIN_STATE.METADATA;
    this._bumpState();
    this._bumpAuthorization();
    return this._snapshotWithoutRead();
  }

  expire() {
    const now = this._readNow();
    this._reconcile(now);
    return this._snapshotWithoutRead();
  }

  installFullPayloadReplacement({operationHandle, fullData, records} = {}) {
    // This is a narrow owner handoff, not a general setter. Validate every
    // candidate value before touching manager-owned state or operation inputs.
    if (!isPlainObject(fullData) || !Array.isArray(records) || fullData.services !== records) {
      throw stateError("KEYGRAIN_STALE_OPERATION");
    }
    let clonedFullData;
    let metadata;
    try {
      metadata = projectMetadataState(records);
      clonedFullData = cloneData(fullData);
      if (!isPlainObject(clonedFullData)
        || typeof clonedFullData.secret !== "string" || !clonedFullData.secret
        || typeof clonedFullData.email !== "string" || !clonedFullData.email
        || !Array.isArray(clonedFullData.services)
        || !Array.isArray(clonedFullData.wallets)
        || !Array.isArray(clonedFullData.walletAuditLog)
        || !Array.isArray(clonedFullData.tombstones)
        || !Array.isArray(clonedFullData.deletionReview)) {
        throw stateError("KEYGRAIN_STALE_OPERATION");
      }
    } catch (error) {
      if (clonedFullData !== undefined) clearMemory(clonedFullData);
      if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
      throw stateError("KEYGRAIN_STALE_OPERATION");
    }

    try {
      const now = this._readNow();
      this._reconcile(now, false);
      if (this._state !== KEYGRAIN_STATE.FULL || this._fullData === null
        || this._fullExpiresAt === null) throw stateError("KEYGRAIN_EXPIRED");
      this.checkSensitiveOperation(operationHandle);
      const privateState = this._private();
      if (this._authorizationGeneration === Number.MAX_SAFE_INTEGER
        || this._stateGeneration === Number.MAX_SAFE_INTEGER
        || !privateState.operations.has(operationHandle.operationId)) {
        throw stateError("KEYGRAIN_STALE_OPERATION");
      }

      // No deadline is recomputed here. The existing full lease, metadata-tail
      // anchor, and active tail remain exactly as established by unlock/extend.
      clearMemory(this._fullData);
      this._fullData = clonedFullData;
      clonedFullData = undefined;
      this._metadata = metadata;
      this._clearOperations();
      this._bumpState();
      this._bumpAuthorization();
      return this._snapshotWithoutRead();
    } catch (error) {
      if (clonedFullData !== undefined) clearMemory(clonedFullData);
      if (error?.code === "KEYGRAIN_EXPIRED" || error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
      throw stateError("KEYGRAIN_STALE_OPERATION");
    }
  }

  lockSensitive() {
    const now = this._readNow();
    this._reconcile(now);
    if (this._state !== KEYGRAIN_STATE.FULL) return this._snapshotWithoutRead();
    const privateState = this._private();
    const metadataExpiresAt = privateState.settings.metadataTailSeconds === 0
      ? null
      : this._validateDeadline(now, privateState.settings.metadataTailSeconds);
    if (this._fullData !== null) clearMemory(this._fullData);
    this._fullData = null;
    this._fullExpiresAt = null;
    this._clearOperations();
    this._bumpAuthorization();
    this._bumpState();
    if (privateState.settings.metadataTailSeconds === 0) {
      this._metadata = null;
      this._metadataExpiresAt = null;
      this._metadataTailAnchor = null;
      this._activeMetadataTailSeconds = null;
      this._state = KEYGRAIN_STATE.LOCKED;
    } else {
      this._state = KEYGRAIN_STATE.METADATA;
      this._metadataExpiresAt = metadataExpiresAt;
      this._metadataTailAnchor = this._metadataExpiresAt;
      this._activeMetadataTailSeconds = privateState.settings.metadataTailSeconds;
    }
    return this._snapshotWithoutRead();
  }

  lockEverything() {
    const now = this._readNow();
    this._reconcile(now);
    const changed = this._state !== KEYGRAIN_STATE.LOCKED
      || this._fullData !== null
      || this._metadata !== null
      || this._private().operations.size > 0;
    if (this._fullData !== null) clearMemory(this._fullData);
    this._fullData = null;
    this._metadata = null;
    this._fullExpiresAt = null;
    this._metadataExpiresAt = null;
    this._metadataTailAnchor = null;
    this._activeMetadataTailSeconds = null;
    this._state = KEYGRAIN_STATE.LOCKED;
    if (changed) {
      this._clearOperations();
      this._bumpState();
      this._bumpAuthorization();
    }
    void now;
    return this._snapshotWithoutRead();
  }

  extendMetadata() {
    const now = this._readNow();
    this._reconcile(now);
    if (this._state !== KEYGRAIN_STATE.METADATA) return null;
    const seconds = this._private().settings.metadataTailSeconds;
    if (seconds === 0) return null;
    const expiresAt = this._validateDeadline(now, seconds);
    this._metadataExpiresAt = expiresAt;
    this._metadataTailAnchor = expiresAt;
    this._activeMetadataTailSeconds = seconds;
    this._bumpState();
    return Object.freeze({startedAt: now, expiresAt, durationSeconds: seconds});
  }

  beginSensitiveOperation({capture} = {}) {
    const now = this._readNow();
    this._reconcile(now);
    if (this._state !== KEYGRAIN_STATE.FULL || now >= this._fullExpiresAt) throw stateError("KEYGRAIN_EXPIRED");
    if (typeof capture !== "function") throw stateError("KEYGRAIN_STALE_OPERATION");
    let view;
    let input;
    try {
      view = cloneData(this._fullData);
      input = cloneData(capture(view));
    } catch (_) {
      throw stateError("KEYGRAIN_STALE_OPERATION");
    } finally {
      if (view !== undefined) clearMemory(view);
    }
    const privateState = this._private();
    const operationId = privateState.nextOperationId++;
    const acceptedAt = now;
    const fullExpiresAt = this._fullExpiresAt;
    const effectiveDeadline = Math.min(
      fullExpiresAt + KEYGRAIN_COMPLETION_GRACE_SECONDS * 1000,
      acceptedAt + KEYGRAIN_COMPLETION_GRACE_SECONDS * 1000,
    );
    const handle = operationHandleCopy({
      operationId,
      authorizationGeneration: this._authorizationGeneration,
      acceptedAt,
      fullExpiresAt,
      effectiveDeadline,
    });
    privateState.operations.set(operationId, {handle, input});
    return handle;
  }

  _operation(handle) {
    try {
      if (!handle || typeof handle !== "object") throw stateError("KEYGRAIN_STALE_OPERATION");
      const keys = Object.keys(handle).sort().join(",");
      if (keys !== "acceptedAt,authorizationGeneration,effectiveDeadline,fullExpiresAt,operationId") {
        throw stateError("KEYGRAIN_STALE_OPERATION");
      }
      const values = {};
      for (const key of ["operationId", "authorizationGeneration", "acceptedAt", "fullExpiresAt", "effectiveDeadline"]) {
        const descriptor = Object.getOwnPropertyDescriptor(handle, key);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
          throw stateError("KEYGRAIN_STALE_OPERATION");
        }
        values[key] = descriptor.value;
      }
      const privateState = this._private();
      const operation = privateState.operations.get(values.operationId);
      if (!operation
        || values.authorizationGeneration !== operation.handle.authorizationGeneration
        || values.acceptedAt !== operation.handle.acceptedAt
        || values.fullExpiresAt !== operation.handle.fullExpiresAt
        || values.effectiveDeadline !== operation.handle.effectiveDeadline) {
        throw stateError("KEYGRAIN_STALE_OPERATION");
      }
      return operation;
    } catch (error) {
      if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
      throw stateError("KEYGRAIN_STALE_OPERATION");
    }
  }

  checkSensitiveOperation(handle) {
    const now = this._readNow();
    this._reconcile(now, false);
    const operation = this._operation(handle);
    if (operation.handle.authorizationGeneration !== this._authorizationGeneration) {
      clearMemory(operation.input);
      this._private().operations.delete(operation.handle.operationId);
      throw stateError("KEYGRAIN_STALE_OPERATION");
    }
    if (now >= operation.handle.effectiveDeadline) {
      clearMemory(operation.input);
      this._private().operations.delete(operation.handle.operationId);
      throw stateError("KEYGRAIN_EXPIRED");
    }
    return true;
  }

  getSensitiveOperationInput(handle) {
    this.checkSensitiveOperation(handle);
    try {
      return cloneData(this._operation(handle).input);
    } catch (_) {
      throw stateError("KEYGRAIN_STALE_OPERATION");
    }
  }

  completeSensitiveOperation(handle) {
    this.checkSensitiveOperation(handle);
    const operation = this._operation(handle);
    clearMemory(operation.input);
    this._private().operations.delete(handle.operationId);
  }

  failSensitiveOperation(handle) {
    this.completeSensitiveOperation(handle);
  }

  cancelSensitiveOperation(handle, reason) {
    void reason;
    const operation = this._operation(handle);
    clearMemory(operation.input);
    this._private().operations.delete(handle.operationId);
  }

  invalidate(reason) {
    if (!KEYGRAIN_ALLOWED_INVALIDATIONS.has(reason)) throw stateError("KEYGRAIN_INVALIDATION_ERROR");
    this._readNow();
    if (this._fullData !== null) clearMemory(this._fullData);
    this._fullData = null;
    this._metadata = null;
    this._fullExpiresAt = null;
    this._metadataExpiresAt = null;
    this._metadataTailAnchor = null;
    this._activeMetadataTailSeconds = null;
    this._state = KEYGRAIN_STATE.LOCKED;
    this._clearOperations();
    this._bumpState();
    this._bumpAuthorization();
    return this._snapshotWithoutRead();
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.KEYGRAIN_STATE = KEYGRAIN_STATE;
  globalThis.KEYGRAIN_SETTINGS_KEY = KEYGRAIN_SETTINGS_KEY;
  globalThis.KEYGRAIN_SETTINGS_VERSION = KEYGRAIN_SETTINGS_VERSION;
  globalThis.KEYGRAIN_FULL_MIN_SECONDS = KEYGRAIN_FULL_MIN_SECONDS;
  globalThis.KEYGRAIN_FULL_DEFAULT_SECONDS = KEYGRAIN_FULL_DEFAULT_SECONDS;
  globalThis.KEYGRAIN_FULL_NORMAL_MAX_SECONDS = KEYGRAIN_FULL_NORMAL_MAX_SECONDS;
  globalThis.KEYGRAIN_FULL_EXCEPTIONAL_MAX_SECONDS = KEYGRAIN_FULL_EXCEPTIONAL_MAX_SECONDS;
  globalThis.KEYGRAIN_METADATA_MIN_SECONDS = KEYGRAIN_METADATA_MIN_SECONDS;
  globalThis.KEYGRAIN_METADATA_DEFAULT_SECONDS = KEYGRAIN_METADATA_DEFAULT_SECONDS;
  globalThis.KEYGRAIN_METADATA_MAX_SECONDS = KEYGRAIN_METADATA_MAX_SECONDS;
  globalThis.KEYGRAIN_FULL_WARNING_LEAD_SECONDS = KEYGRAIN_FULL_WARNING_LEAD_SECONDS;
  globalThis.KEYGRAIN_METADATA_WARNING_LEAD_SECONDS = KEYGRAIN_METADATA_WARNING_LEAD_SECONDS;
  globalThis.KEYGRAIN_COMPLETION_GRACE_SECONDS = KEYGRAIN_COMPLETION_GRACE_SECONDS;
  globalThis.KeygrainStateManager = KeygrainStateManager;
  globalThis.normalizeSecuritySettings = normalizeSecuritySettings;
  globalThis.migrateSecuritySettings = migrateSecuritySettings;
  globalThis.confirmExceptionalFullLease = confirmExceptionalFullLease;
  globalThis.projectMetadataState = projectMetadataState;
}

})();