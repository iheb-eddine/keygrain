// KG-29 authoritative runtime state. This module stores only in-memory state;
// browser adapters own persistence/lifecycle integration.
const KG_UNLOCK_STATES = Object.freeze({
  LOCKED: "locked",
  SITES_AVAILABLE: "sites_available",
  SECRETS_AVAILABLE: "secrets_available",
});

const KG_TOTP_CACHE_TTL_MS = 120000;
const KG_RETENTION_MODES = Object.freeze({
  ASK_EVERY_TIME: "ask_every_time",
  DURATION: "duration",
});
const KG_SECURITY_DEFAULTS = Object.freeze({
  metadata: Object.freeze({mode: KG_RETENTION_MODES.DURATION, durationMinutes: 30}),
  sensitive: Object.freeze({mode: KG_RETENTION_MODES.ASK_EVERY_TIME, durationMinutes: null}),
  totpContinuationEnabled: true,
});
const KG_SENSITIVE_RETENTION_BOUNDS = Object.freeze({minMinutes: 1, maxMinutes: 30});

function kgNormalizeRetentionSetting(setting, {minMinutes = null, maxMinutes = null} = {}) {
  if (!setting || typeof setting !== "object") throw new TypeError("retention setting required");
  if (setting.mode === KG_RETENTION_MODES.ASK_EVERY_TIME) {
    return Object.freeze({mode: KG_RETENTION_MODES.ASK_EVERY_TIME, durationMinutes: null});
  }
  if (setting.mode !== KG_RETENTION_MODES.DURATION) throw new RangeError("invalid retention mode");
  const minutes = setting.durationMinutes;
  if (!Number.isSafeInteger(minutes) || minutes < 1) throw new RangeError("retention duration must be a positive whole number of minutes");
  if (minMinutes !== null && (!Number.isSafeInteger(minMinutes) || minutes < minMinutes)) {
    throw new RangeError("retention duration is below the allowed minimum");
  }
  if (maxMinutes !== null && (!Number.isSafeInteger(maxMinutes) || minutes > maxMinutes)) {
    throw new RangeError("retention duration exceeds the allowed maximum");
  }
  return Object.freeze({mode: KG_RETENTION_MODES.DURATION, durationMinutes: minutes});
}

function kgNormalizeSecuritySettings(settings = {}) {
  if (!settings || typeof settings !== "object") throw new TypeError("security settings must be an object");
  const metadata = kgNormalizeRetentionSetting(settings.metadata || KG_SECURITY_DEFAULTS.metadata);
  const sensitive = kgNormalizeRetentionSetting(
    settings.sensitive || KG_SECURITY_DEFAULTS.sensitive,
    KG_SENSITIVE_RETENTION_BOUNDS
  );
  const totpContinuationEnabled = settings.totpContinuationEnabled ?? KG_SECURITY_DEFAULTS.totpContinuationEnabled;
  if (typeof totpContinuationEnabled !== "boolean") throw new TypeError("TOTP continuation setting must be boolean");
  return Object.freeze({metadata, sensitive, totpContinuationEnabled});
}

function _kgCreateLease(now, setting, bounds = {}) {
  if (!Number.isFinite(now)) throw new RangeError("lease start must be finite");
  const normalized = kgNormalizeRetentionSetting(setting, bounds);
  if (normalized.mode === KG_RETENTION_MODES.ASK_EVERY_TIME) {
    return Object.freeze({mode: normalized.mode, startedAt: now, expiresAt: null});
  }
  const expiresAt = now + normalized.durationMinutes * 60000;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) throw new RangeError("lease expiry is invalid");
  return Object.freeze({mode: normalized.mode, durationMinutes: normalized.durationMinutes, startedAt: now, expiresAt});
}

function kgCreateSensitiveLease(now, setting) {
  return _kgCreateLease(now, setting, KG_SENSITIVE_RETENTION_BOUNDS);
}

function _kgCopyLease(lease, bounds = {}) {
  if (!lease || typeof lease !== "object") throw new TypeError("lease required");
  if (!Number.isFinite(lease.startedAt)) throw new RangeError("lease start must be finite");
  if (lease.mode === KG_RETENTION_MODES.ASK_EVERY_TIME) {
    if (lease.expiresAt !== null) throw new RangeError("ask-every-time lease cannot expire later");
    return Object.freeze({mode: lease.mode, startedAt: lease.startedAt, expiresAt: null});
  }
  if (lease.mode !== KG_RETENTION_MODES.DURATION
    || !Number.isSafeInteger(lease.durationMinutes)
    || lease.durationMinutes < 1
    || (bounds.minMinutes !== undefined && lease.durationMinutes < bounds.minMinutes)
    || (bounds.maxMinutes !== undefined && lease.durationMinutes > bounds.maxMinutes)
    || !Number.isSafeInteger(lease.expiresAt)
    || lease.expiresAt !== lease.startedAt + lease.durationMinutes * 60000
    || lease.expiresAt <= lease.startedAt) {
    throw new RangeError("invalid fixed lease");
  }
  return Object.freeze({
    mode: lease.mode,
    durationMinutes: lease.durationMinutes,
    startedAt: lease.startedAt,
    expiresAt: lease.expiresAt,
  });
}

function _kgLegacyLease(expiresAt) {
  if (!Number.isFinite(expiresAt)) throw new RangeError("lease expiry must be finite");
  return Object.freeze({mode: "legacy", startedAt: null, expiresAt});
}

function _kgNow(clock) {
  const now = clock();
  if (!Number.isFinite(now)) throw new Error("invalid clock");
  return now;
}

function _kgClear(value) {
  if (!value) return;
  if (value instanceof Uint8Array) {
    value.fill(0);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) _kgClear(item);
    value.length = 0;
    return;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      const item = value[key];
      _kgClear(item);
      try { value[key] = null; } catch (_) {}
    }
  }
}

function _kgMetadataCopy(index) {
  if (!Array.isArray(index)) throw new TypeError("metadata index must be an array");
  return index.map(item => ({
    id: typeof item?.id === "string" ? item.id : "",
    site: typeof item?.site === "string" ? item.site : "",
    name: typeof item?.name === "string" ? item.name : "",
    email: typeof item?.email === "string" ? item.email : "",
    frecency: Number.isFinite(item?.frecency) ? item.frecency : 0,
    updated_at: Number.isFinite(item?.updated_at) ? item.updated_at : 0,
    hasTotp: item?.hasTotp === true,
  }));
}

class KGUnlockGeneration {
  constructor(initial = 0) {
    if (!Number.isSafeInteger(initial) || initial < 0) {
      throw new RangeError("initial generation must be a non-negative safe integer");
    }
    this._generation = initial;
  }

  get value() { return this._generation; }
  capture() { return this._generation; }
  isCurrent(generation) { return generation === this._generation; }
  invalidate() {
    if (this._generation === Number.MAX_SAFE_INTEGER) throw new Error("unlock generation exhausted");
    this._generation++;
    return this._generation;
  }
  assertCurrent(generation) {
    if (!this.isCurrent(generation)) throw new Error("stale unlock operation");
    return true;
  }
}

class KGUnlockStateManager {
  constructor({clock = () => Date.now()} = {}) {
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    this._clock = clock;
    this._lastNow = _kgNow(clock);
    this._stateGeneration = new KGUnlockGeneration();
    this._totpGeneration = new KGUnlockGeneration();
    this._metadata = null;
    this._metadataLease = null;
    this._metadataExpiresAt = null;
    this._secrets = null;
    this._sensitiveLease = null;
    this._secretsExpiresAt = null;
    this._email = null;
    this._totp = null;
  }

  get generation() { return this._stateGeneration.value; }
  get totpGeneration() { return this._totpGeneration.value; }

  capture() { return this._stateGeneration.capture(); }
  isCurrent(generation) { return this._stateGeneration.isCurrent(generation); }
  assertCurrent(generation) {
    this._expireIfNeeded(_kgNow(this._clock));
    return this._stateGeneration.assertCurrent(generation);
  }
  captureTotp() { return this._totpGeneration.capture(); }

  _observe(now) {
    if (!Number.isFinite(now)) throw new Error("invalid clock");
    if (now < this._lastNow) {
      this.lockEverything();
      throw new Error("clock rollback");
    }
    this._lastNow = now;
    return now;
  }

  _expireIfNeeded(now) {
    now = this._observe(now);
    let changed = false;
    if (this._metadata && this._metadataLease && this._metadataLease.expiresAt !== null && now >= this._metadataLease.expiresAt) {
      this._metadata = null;
      this._metadataLease = null;
      this._metadataExpiresAt = null;
      changed = true;
    }
    if (this._secrets && this._sensitiveLease && this._sensitiveLease.expiresAt !== null && now >= this._sensitiveLease.expiresAt) {
      if (this._secrets) _kgClear(this._secrets);
      this._secrets = null;
      this._sensitiveLease = null;
      this._secretsExpiresAt = null;
      changed = true;
    }
    if (this._totp && (now < this._totp.createdAt || now >= this._totp.expiresAt)) {
      this.clearTotpContinuation();
    }
    if (changed) this._stateGeneration.invalidate();
    return now;
  }

  _stateWithoutExpiry() {
    if (this._secrets !== null) return KG_UNLOCK_STATES.SECRETS_AVAILABLE;
    if (this._metadata !== null) return KG_UNLOCK_STATES.SITES_AVAILABLE;
    return KG_UNLOCK_STATES.LOCKED;
  }

  get state() {
    this._expireIfNeeded(_kgNow(this._clock));
    return this._stateWithoutExpiry();
  }

  get hasMetadata() {
    this._expireIfNeeded(_kgNow(this._clock));
    return this._metadata !== null;
  }

  get hasSecrets() {
    this._expireIfNeeded(_kgNow(this._clock));
    return this._secrets !== null;
  }

  get hasTotpContinuation() {
    this._expireIfNeeded(_kgNow(this._clock));
    return this._totp !== null;
  }

  get email() {
    this._expireIfNeeded(_kgNow(this._clock));
    return (this._metadata !== null || this._secrets !== null) ? this._email : null;
  }

  snapshot() {
    this._expireIfNeeded(_kgNow(this._clock));
    return Object.freeze({
      state: this._stateWithoutExpiry(),
      generation: this.generation,
      totpGeneration: this.totpGeneration,
      hasMetadata: this._metadata !== null,
      hasSecrets: this._secrets !== null,
      hasTotpContinuation: this._totp !== null,
      metadataExpiresAt: this._metadataLease?.expiresAt ?? null,
      secretsExpiresAt: this._sensitiveLease?.expiresAt ?? null,
      metadataLease: this._metadataLease,
      sensitiveLease: this._sensitiveLease,
      totpExpiresAt: this._totp?.expiresAt ?? null,
    });
  }

  get metadataLease() {
    this._expireIfNeeded(_kgNow(this._clock));
    return this._metadataLease;
  }

  get sensitiveLease() {
    this._expireIfNeeded(_kgNow(this._clock));
    return this._sensitiveLease;
  }

  setMetadata(index, leaseOrExpiresAt) {
    this._expireIfNeeded(_kgNow(this._clock));
    const lease = typeof leaseOrExpiresAt === "number"
      ? _kgLegacyLease(leaseOrExpiresAt)
      : _kgCopyLease(leaseOrExpiresAt);
    this._metadata = _kgMetadataCopy(index);
    this._metadataLease = lease;
    this._metadataExpiresAt = lease.expiresAt;
    this._stateGeneration.invalidate();
  }

  getMetadata() {
    this._expireIfNeeded(_kgNow(this._clock));
    return this._metadata ? _kgMetadataCopy(this._metadata) : null;
  }

  setSecrets(payload, leaseOrExpiresAt = null) {
    this._expireIfNeeded(_kgNow(this._clock));
    let lease = null;
    if (leaseOrExpiresAt !== null) {
      lease = typeof leaseOrExpiresAt === "number"
        ? _kgLegacyLease(leaseOrExpiresAt)
        : _kgCopyLease(leaseOrExpiresAt, KG_SENSITIVE_RETENTION_BOUNDS);
    }
    this._secrets = payload;
    this._sensitiveLease = lease;
    this._secretsExpiresAt = lease?.expiresAt ?? null;
    this._stateGeneration.invalidate();
  }

  renewMetadataLease(setting) {
    const now = this._expireIfNeeded(_kgNow(this._clock));
    if (this._metadata === null) return null;
    const lease = _kgCreateLease(now, setting);
    this._metadataLease = lease;
    this._metadataExpiresAt = lease.expiresAt;
    this._stateGeneration.invalidate();
    return lease;
  }

  renewSensitiveLease(setting) {
    const now = this._expireIfNeeded(_kgNow(this._clock));
    if (this._secrets === null) return null;
    const lease = kgCreateSensitiveLease(now, setting);
    this._sensitiveLease = lease;
    this._secretsExpiresAt = lease.expiresAt;
    this._stateGeneration.invalidate();
    return lease;
  }

  getSecrets() {
    this._expireIfNeeded(_kgNow(this._clock));
    return this._secrets;
  }

  setEmail(email) {
    this._expireIfNeeded(_kgNow(this._clock));
    if (email !== null && typeof email !== "string") throw new TypeError("email must be a string or null");
    this._email = email;
  }

  clearEmail() {
    this._email = null;
  }

  setTotpContinuation(cache) {
    if (!cache || typeof cache !== "object") throw new TypeError("TOTP cache required");
    if (typeof cache.serviceId !== "string" || !cache.serviceId) throw new TypeError("TOTP service ID required");
    if (!Number.isInteger(cache.period) || cache.period < 1 || cache.period > 300) throw new RangeError("invalid TOTP period");
    if (!Number.isFinite(cache.createdAt) || !Number.isFinite(cache.expiresAt) || cache.expiresAt <= cache.createdAt) {
      throw new RangeError("invalid TOTP cache lifetime");
    }
    if (cache.expiresAt - cache.createdAt > KG_TOTP_CACHE_TTL_MS) throw new RangeError("TOTP cache exceeds maximum lifetime");
    if (!Array.isArray(cache.entries) || cache.entries.length === 0) throw new TypeError("TOTP cache entries required");
    this._totp = {
      serviceId: cache.serviceId,
      tabId: cache.tabId ?? null,
      origin: cache.origin ?? null,
      period: cache.period,
      entries: cache.entries.map(entry => ({
        counter: entry.counter,
        code: entry.code,
        validFrom: entry.validFrom,
        validUntil: entry.validUntil,
      })),
      createdAt: cache.createdAt,
      expiresAt: cache.expiresAt,
      generation: this._totpGeneration.value,
    };
  }

  getTotpContinuation({serviceId, tabId = null, origin = null, now = _kgNow(this._clock)} = {}) {
    now = this._expireIfNeeded(now);
    const cache = this._totp;
    if (!cache) return null;
    if (now < cache.createdAt || now >= cache.expiresAt) {
      this.clearTotpContinuation();
      return null;
    }
    if (cache.generation !== this._totpGeneration.value || serviceId !== cache.serviceId) return null;
    if (cache.tabId !== null && tabId !== cache.tabId) return null;
    if (cache.origin !== null && origin !== cache.origin) return null;
    const counter = Math.floor((now / 1000) / cache.period);
    const entry = cache.entries.find(item =>
      item.counter === counter && now >= item.validFrom && now < item.validUntil
    );
    return entry ? {code: entry.code, counter: entry.counter, expiresAt: cache.expiresAt} : null;
  }

  clearTotpContinuation() {
    if (this._totp) _kgClear(this._totp);
    this._totp = null;
    this._totpGeneration.invalidate();
  }

  clearGeneralSensitive({retainTotp = true} = {}) {
    if (this._secrets) _kgClear(this._secrets);
    this._secrets = null;
    this._sensitiveLease = null;
    this._secretsExpiresAt = null;
    this._stateGeneration.invalidate();
    if (!retainTotp) this.clearTotpContinuation();
  }

  clearMetadata() {
    this._metadata = null;
    this._metadataLease = null;
    this._metadataExpiresAt = null;
    this._stateGeneration.invalidate();
  }

  lockSecrets() {
    this.clearGeneralSensitive({retainTotp: false});
  }

  lockEverything() {
    this.clearGeneralSensitive({retainTotp: false});
    this.clearMetadata();
    this.clearEmail();
  }

  invalidate(reason = "invalidated", {clearTotp = true} = {}) {
    void reason;
    this.clearGeneralSensitive({retainTotp: !clearTotp});
    if (clearTotp && this._totp) this.clearTotpContinuation();
    return this.generation;
  }

  expire(now = _kgNow(this._clock)) {
    this._expireIfNeeded(now);
    return this.snapshot();
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.KG_UNLOCK_STATES = KG_UNLOCK_STATES;
  globalThis.KG_TOTP_CACHE_TTL_MS = KG_TOTP_CACHE_TTL_MS;
  globalThis.KG_RETENTION_MODES = KG_RETENTION_MODES;
  globalThis.KG_SECURITY_DEFAULTS = KG_SECURITY_DEFAULTS;
  globalThis.KG_SENSITIVE_RETENTION_BOUNDS = KG_SENSITIVE_RETENTION_BOUNDS;
  globalThis.kgNormalizeRetentionSetting = kgNormalizeRetentionSetting;
  globalThis.kgNormalizeSecuritySettings = kgNormalizeSecuritySettings;
  globalThis.kgCreateSensitiveLease = kgCreateSensitiveLease;
  globalThis.KGUnlockGeneration = KGUnlockGeneration;
  globalThis.KGUnlockStateManager = KGUnlockStateManager;
}
