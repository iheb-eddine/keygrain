/*
 * Keygrain browser-owner foundation.
 *
 * The background runtime is the sole authority. This module deliberately does
 * not expose a full-data getter, credential mirror, lease shortcut, or page
 * delivery of sensitive values. Browser adapters supply mechanics; the frozen
 * KeygrainStateManager owns authorization and deadlines.
 */
(function installKeygrainBrowserOwner(root) {
  "use strict";

  const AUTH_PROTOCOL_ERROR = "KEYGRAIN_AUTH_PROTOCOL_ERROR";
  const CONTEXT_ERROR = "KEYGRAIN_CONTEXT_ERROR";
  const UNLOCK_FAILED = "KEYGRAIN_UNLOCK_FAILED";
  const OPERATION_ERROR = "KEYGRAIN_OPERATION_ERROR";
  const CONSUMER_MIGRATION_REQUIRED = "KEYGRAIN_CONSUMER_MIGRATION_REQUIRED";
  const SETTINGS_STORAGE_ERROR = "KEYGRAIN_SETTINGS_STORAGE_ERROR";
  const LEGACY_SETTINGS_KEY = "autoLockMinutes";
  const LEGACY_EMAIL_KEY = "lastEmail";
  const INLINE_REGISTRATION_ID = "keygrain-inline";
  const KEYGRAIN_PASSWORD_OPTIONS = "keygrain.password.options";
  const KEYGRAIN_PASSWORD_GENERATE = "keygrain.password.generate";
  const KEYGRAIN_PASSWORD_FILL = "keygrain.password.fill";
  const KEYGRAIN_PASSWORD_SELECTION_TTL_MS = 30000;
  const KEYGRAIN_PASSWORD_DELIVERY_TTL_MS = 5000;
  const KEYGRAIN_PASSWORD_MAX_ITEMS = 256;
  const KEYGRAIN_PASSWORD_MAX_FIELD_UTF8 = 256;
  const KEYGRAIN_PASSWORD_MAX_RESPONSE_BYTES = 65536;
  const KEYGRAIN_PASSWORD_MAX_SYMBOLS = 64;
  const KEYGRAIN_PASSWORD_MAX_OUTPUT_UTF8 = 128;
  const KEYGRAIN_PASSWORD_MAX_EMAIL_UTF8 = 254;
  const KEYGRAIN_PASSWORD_DEFAULT_SYMBOLS = "!@#$%&*-_=+?";
  const KEYGRAIN_PASSWORD_DEFAULT_POLICY = "ascii-printable-v1";
  const KEYGRAIN_PASSWORD_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const KEYGRAIN_PASSWORD_LOWER = "abcdefghjkmnpqrstuvwxyz";
  const KEYGRAIN_PASSWORD_DIGITS = "23456789";
  const KEYGRAIN_PASSWORD_ACTIONS = new Set([KEYGRAIN_PASSWORD_OPTIONS, KEYGRAIN_PASSWORD_GENERATE, KEYGRAIN_PASSWORD_FILL]);
  const KEYGRAIN_PASSWORD_REQUEST_KEYS = Object.freeze({
    [KEYGRAIN_PASSWORD_OPTIONS]: Object.freeze(["action"]),
    [KEYGRAIN_PASSWORD_GENERATE]: Object.freeze(["action", "selectionToken", "length", "symbols", "counter", "policy"]),
    [KEYGRAIN_PASSWORD_FILL]: Object.freeze(["action", "selectionToken", "length", "symbols", "counter", "policy", "fillEmail"]),
  });
  const KEYGRAIN_TOTP_OPTIONS = "keygrain.totp.options";
  const KEYGRAIN_TOTP_GENERATE = "keygrain.totp.generate";
  const KEYGRAIN_TOTP_FILL = "keygrain.totp.fill";
  const KEYGRAIN_TOTP_ACTIONS = new Set([KEYGRAIN_TOTP_OPTIONS, KEYGRAIN_TOTP_GENERATE, KEYGRAIN_TOTP_FILL]);
  const KEYGRAIN_TOTP_CAPABILITY_TTL_MS = 30000;
  const KEYGRAIN_TOTP_DELIVERY_TTL_MS = 5000;
  const KEYGRAIN_TOTP_MAX_ITEMS = 256;
  const KEYGRAIN_TOTP_MAX_FIELD_UTF8 = 256;
  const KEYGRAIN_TOTP_MAX_RESPONSE_BYTES = 65536;
  const KEYGRAIN_TOTP_MAX_SEED_BYTES = 128;
  const KEYGRAIN_TOTP_MAX_CODE_DIGITS = 8;
  const KEYGRAIN_SSH_OPTIONS = "keygrain.ssh.options";
  const KEYGRAIN_SSH_GENERATE = "keygrain.ssh.generate";
  const KEYGRAIN_SSH_ACTIONS = new Set([KEYGRAIN_SSH_OPTIONS, KEYGRAIN_SSH_GENERATE]);
  const KEYGRAIN_WALLET_OPTIONS = "keygrain.wallet.options";
  const KEYGRAIN_WALLET_GENERATE = "keygrain.wallet.generate";
  const KEYGRAIN_WALLET_ACTIONS = new Set([KEYGRAIN_WALLET_OPTIONS, KEYGRAIN_WALLET_GENERATE]);
  const KEYGRAIN_B3_CAPABILITY_TTL_MS = 30000;
  const KEYGRAIN_B3_MAX_ITEMS = 256;
  const KEYGRAIN_B3_MAX_FIELD_UTF8 = 256;
  const KEYGRAIN_B3_MAX_RESPONSE_BYTES = 65536;
  const KEYGRAIN_B3_MAX_TOKEN_UTF8 = 128;
  const KEYGRAIN_B3_MAX_EMAIL_UTF8 = 254;
  const KEYGRAIN_SSH_MAX_KEY_NAME_UTF8 = 64;
  const KEYGRAIN_SSH_MAX_AUTHORIZED_KEYS_UTF8 = 2048;
  const KEYGRAIN_SSH_MAX_PRIVATE_KEY_PEM_UTF8 = 8192;
  const KEYGRAIN_WALLET_MAX_NAME_UTF8 = 64;
  const KEYGRAIN_WALLET_MAX_MNEMONIC_UTF8 = 256;
  const KEYGRAIN_WALLET_ERROR = "KEYGRAIN_WALLET_ERROR";
  const KEYGRAIN_SSH_ERROR = "KEYGRAIN_SSH_ERROR";

  const PRIVILEGED_ACTIONS = new Set([
    "unlock", "requestExceptionalConfirmation", "cancelExceptionalConfirmation",
    "getOwnerState", "saveSecuritySettings", "extendFull", "extendMetadata",
    "lockSensitive", "lockEverything", "ownerOperation",
  ]);
  const KEYGRAIN_POPUP_STATE = "keygrain.popup.state";
  const KEYGRAIN_POPUP_METADATA = "keygrain.popup.metadata";
  const KEYGRAIN_POPUP_SERVICE_LIST = "keygrain.popup.serviceList";
  const KEYGRAIN_POPUP_SELECTION_OPTIONS = "keygrain.popup.selectionOptions";
  const KEYGRAIN_POPUP_DETAIL = "keygrain.popup.detail";
  const KEYGRAIN_POPUP_EDIT = "keygrain.popup.edit";
  const KEYGRAIN_POPUP_ADD = "keygrain.popup.add";
  const KEYGRAIN_POPUP_DELETE = "keygrain.popup.delete";
  const KEYGRAIN_POPUP_SETTINGS = "keygrain.popup.settings";
  const KEYGRAIN_POPUP_LOCK_SENSITIVE = "keygrain.popup.lockSensitive";
  const KEYGRAIN_POPUP_LOCK_EVERYTHING = "keygrain.popup.lockEverything";
  const KEYGRAIN_POPUP_EXTEND = "keygrain.popup.extend";
  const KEYGRAIN_POPUP_SWITCH_ACCOUNT = "keygrain.popup.switchAccount";
  const KEYGRAIN_POPUP_CAPABILITY_TTL_MS = 30000;
  const KEYGRAIN_POPUP_MAX_ITEMS = 256;
  const KEYGRAIN_POPUP_MAX_FIELD_UTF8 = 256;
  const KEYGRAIN_POPUP_MAX_RESPONSE_BYTES = 65536;
  const POPUP_RESERVED_ACTIONS = new Set([
    "heartbeat", "extendSensitive", "setSecret", "setEmail", "setSecrets", "clearEmail",
    "getSecret", "getEmail", "getFullData", "getRecords", "decryptServices",
    "derivePassword", "deriveTOTP", "fillInline", "fillInlineOtp", "fill_credentials",
    "sync", "syncAlarm", "syncRetry", "reregisterInlineAutofill",
    "inlineAutofillEnabledChanged", "import", "wallet", "migrate", "password", "totp",
    "ssh", "export", "add", "edit", "delete", "rotate", "offline", "switchAccount",
    "deleteServerData", "pinUnlock", "pinSetup", "lockSensitive", "lockEverything",
    "ownerOperation", "getOwnerState", "saveSecuritySettings", "extendFull", "extendMetadata",
  ]);
  const PHASE_B_ACTIONS = new Set(POPUP_RESERVED_ACTIONS);
  const POPUP_FIELD_KEYS = Object.freeze(["id", "site", "name", "email"]);
  const EXTENSION_PAGE_PATHS = new Set([
    "/help.html", "/import.html", "/migrate.html", "/popup.html", "/wallet-page.html",
  ]);
  const INVALIDATION_REASONS = new Set([
    "account_switch", "authentication_failure", "runtime_shutdown",
    "clock_rollback", "external_security_invalidation",
  ]);

  function error(code) {
    const result = new Error(code);
    result.code = code;
    return result;
  }

  function safeFailure(code) {
    const messages = {
      [AUTH_PROTOCOL_ERROR]: "Invalid authentication request.",
      [CONTEXT_ERROR]: "This action is not available from this context.",
      [UNLOCK_FAILED]: "Unlock failed; try again.",
      [OPERATION_ERROR]: "The operation could not be completed.",
      [CONSUMER_MIGRATION_REQUIRED]: "Update Keygrain to continue.",
      [SETTINGS_STORAGE_ERROR]: "Security settings could not be loaded safely.",
      KEYGRAIN_EXPIRED: "Unlock is required.",
      KEYGRAIN_METADATA_ERROR: "Metadata is not available.",
      KEYGRAIN_STALE_OPERATION: "The operation could not be completed.",
      KEYGRAIN_DERIVATION_ERROR: "Password could not be generated.",
      KEYGRAIN_FILL_DELIVERY_ERROR: "The password could not be filled.",
      KEYGRAIN_SSH_ERROR: "The SSH key could not be generated.",
    };
    return Object.freeze({ok: false, code, message: messages[code] || "Request failed."});
  }

  function success(fields = {}) {
    const response = {ok: true};
    for (const [key, value] of Object.entries(fields)) response[key] = value;
    return Object.freeze(response);
  }

  const SAFE_FAILURE_CODES = new Set([
    AUTH_PROTOCOL_ERROR, CONTEXT_ERROR, UNLOCK_FAILED, OPERATION_ERROR,
    CONSUMER_MIGRATION_REQUIRED, SETTINGS_STORAGE_ERROR,
    "KEYGRAIN_SETTINGS_ERROR", "KEYGRAIN_CONFIRMATION_ERROR", "KEYGRAIN_METADATA_ERROR",
    "KEYGRAIN_CLOCK_ROLLBACK", "KEYGRAIN_EXPIRED", "KEYGRAIN_STALE_OPERATION",
    "KEYGRAIN_INVALIDATION_ERROR", "KEYGRAIN_DERIVATION_ERROR", "KEYGRAIN_FILL_DELIVERY_ERROR",
    "KEYGRAIN_SSH_ERROR",
  ]);

  function safeErrorResponse(exception, fallback = OPERATION_ERROR) {
    const preferred = exception && typeof exception.code === "string" ? exception.code : fallback;
    const code = SAFE_FAILURE_CODES.has(preferred)

      ? preferred
      : (SAFE_FAILURE_CODES.has(fallback) ? fallback : OPERATION_ERROR);
    return safeFailure(code);
  }

  function popupRequestAction(request) {
    try {
      if (!request || typeof request !== "object" || Array.isArray(request)) throw error(AUTH_PROTOCOL_ERROR);
      const prototype = Object.getPrototypeOf(request);
      if (prototype !== null && prototype !== Object.prototype) throw error(AUTH_PROTOCOL_ERROR);
      const keys = Reflect.ownKeys(request);
      if (keys.length !== 1 || keys[0] !== "action") throw error(AUTH_PROTOCOL_ERROR);
      const descriptor = Object.getOwnPropertyDescriptor(request, "action");
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")
        || typeof descriptor.value !== "string") throw error(AUTH_PROTOCOL_ERROR);
      return descriptor.value;
    } catch (exception) {
      if (exception?.code === AUTH_PROTOCOL_ERROR) throw exception;
      throw error(AUTH_PROTOCOL_ERROR);
    }
  }

  // Background listeners use this descriptor-only peek solely to preserve the
  // existing unlock-core branch ordering. It never invokes an accessor.
  function peekPopupAction(request) {
    try {
      if (!request || typeof request !== "object" || Array.isArray(request)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(request, "action");
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")
        || typeof descriptor.value !== "string") return null;
      return descriptor.value;
    } catch (_) { return null; }
  }

  function isExactPopupRequest(request) {
    try { popupRequestAction(request); return true; } catch (_) { return false; }
  }

  function popupTextBytes(value) {
    if (value === null) return 0;
    if (typeof value !== "string") throw error(OPERATION_ERROR);
    try {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(value).byteLength;
      if (bytes > KEYGRAIN_POPUP_MAX_FIELD_UTF8) throw error(OPERATION_ERROR);
      return bytes;
    } catch (exception) {
      if (exception?.code === OPERATION_ERROR) throw exception;
      throw error(OPERATION_ERROR);
    }
  }

  function popupTransportProjectionField(record, key) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) return null;
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      throw error(OPERATION_ERROR);
    }
    if (descriptor.value !== null && typeof descriptor.value !== "string") throw error(OPERATION_ERROR);
    popupTextBytes(descriptor.value);
    return descriptor.value;
  }

  function popupProjectionItems(value) {
    if (!Array.isArray(value) || value.length > KEYGRAIN_POPUP_MAX_ITEMS) throw error(OPERATION_ERROR);
    const result = [];
    for (const record of value) {
      if (!record || typeof record !== "object" || Array.isArray(record)) throw error(OPERATION_ERROR);
      const prototype = Object.getPrototypeOf(record);
      if (prototype !== null && prototype !== Object.prototype) throw error(OPERATION_ERROR);
      let ownKeys;
      try { ownKeys = Reflect.ownKeys(record); } catch (_) { throw error(OPERATION_ERROR); }
      for (const key of ownKeys) {
        if (typeof key !== "string" || !POPUP_FIELD_KEYS.includes(key)) throw error(OPERATION_ERROR);
      }
      const item = {};
      for (const key of POPUP_FIELD_KEYS) item[key] = popupTransportProjectionField(record, key);
      result.push(item);
    }
    return result;
  }

  function popupManagerProjectionField(record, key) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) return null;
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")
      || typeof descriptor.value !== "string") throw error(OPERATION_ERROR);
    popupTextBytes(descriptor.value);
    return descriptor.value;
  }

  function popupManagerProjectionItems(value) {
    if (!Array.isArray(value) || value.length > KEYGRAIN_POPUP_MAX_ITEMS) throw error(OPERATION_ERROR);
    const result = [];
    for (const record of value) {
      if (!record || typeof record !== "object" || Array.isArray(record)) throw error(OPERATION_ERROR);
      const prototype = Object.getPrototypeOf(record);
      if (prototype !== null && prototype !== Object.prototype) throw error(OPERATION_ERROR);
      const item = {};
      for (const key of POPUP_FIELD_KEYS) item[key] = popupManagerProjectionField(record, key);
      result.push(item);
    }
    return result;
  }

  function popupResponse(response) {
    try {
      const encoded = new TextEncoder().encode(JSON.stringify(response)).byteLength;
      if (encoded > KEYGRAIN_POPUP_MAX_RESPONSE_BYTES) throw error(OPERATION_ERROR);
      return response;
    } catch (exception) {
      if (exception?.code === OPERATION_ERROR) throw exception;
      throw error(OPERATION_ERROR);
    }
  }

  function popupStateResult(snapshot, email = null) {
    if (!snapshot || typeof snapshot !== "object") throw error(OPERATION_ERROR);
    const stateDescriptor = Object.getOwnPropertyDescriptor(snapshot, "state");
    const state = stateDescriptor && Object.prototype.hasOwnProperty.call(stateDescriptor, "value")
      ? stateDescriptor.value : undefined;
    if (state !== "locked" && state !== "full" && state !== "metadata") throw error(OPERATION_ERROR);
    const readNumberOrNull = key => {
      const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) throw error(OPERATION_ERROR);
      const value = descriptor.value;
      if (value !== null && (!Number.isFinite(value) || value < 0)) throw error(OPERATION_ERROR);
      return value;
    };
    const readGeneration = key => {
      const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")
        || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) throw error(OPERATION_ERROR);
      return descriptor.value;
    };
    const stateGeneration = readGeneration("stateGeneration");
    const authorizationGeneration = readGeneration("authorizationGeneration");
    const fullExpiresAt = readNumberOrNull("fullExpiresAt");
    const metadataExpiresAt = readNumberOrNull("metadataExpiresAt");
    const fullWarningAt = readNumberOrNull("fullWarningAt");
    const metadataWarningAt = readNumberOrNull("metadataWarningAt");
    const metadataAvailable = Object.getOwnPropertyDescriptor(snapshot, "metadataAvailable")?.value;
    const hasFullData = Object.getOwnPropertyDescriptor(snapshot, "hasFullData")?.value;
    if (typeof metadataAvailable !== "boolean" || typeof hasFullData !== "boolean") throw error(OPERATION_ERROR);
    if (state === "locked" && (fullExpiresAt !== null || metadataExpiresAt !== null
      || fullWarningAt !== null || metadataWarningAt !== null || metadataAvailable || hasFullData)) throw error(OPERATION_ERROR);
    if (state === "full" && (fullExpiresAt === null || fullWarningAt === null
      || metadataExpiresAt !== null || metadataWarningAt !== null || metadataAvailable || !hasFullData)) throw error(OPERATION_ERROR);
    if (state === "metadata" && (fullExpiresAt !== null || fullWarningAt !== null
      || metadataExpiresAt === null || metadataWarningAt === null || !metadataAvailable || hasFullData)) throw error(OPERATION_ERROR);
    return {
      state, stateGeneration, authorizationGeneration,
      fullExpiresAt, metadataExpiresAt, fullWarningAt, metadataWarningAt,
      metadataAvailable, hasFullData,
      email: email || null,
    };
  }

  function popupFailureFor(exception) {
    if (exception?.code === AUTH_PROTOCOL_ERROR || exception?.code === CONTEXT_ERROR
      || exception?.code === CONSUMER_MIGRATION_REQUIRED || exception?.code === "KEYGRAIN_EXPIRED"
      || exception?.code === "KEYGRAIN_METADATA_ERROR" || exception?.code === "KEYGRAIN_STALE_OPERATION"
      || exception?.code === "KEYGRAIN_DERIVATION_ERROR" || exception?.code === "KEYGRAIN_FILL_DELIVERY_ERROR"
      || exception?.code === OPERATION_ERROR) return safeFailure(exception.code);
    return safeFailure(OPERATION_ERROR);
  }

  function passwordError(code) { throw error(code); }

  function passwordOwnData(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      return prototype === null || (Object.prototype.toString.call(value) === "[object Object]"
        && prototype && prototype.constructor && prototype.constructor.name === "Object");
    } catch (_) { return false; }
  }

  function passwordOrderedEnvelope(value, keys) {
    if (!passwordOwnData(value)) passwordError(AUTH_PROTOCOL_ERROR);
    let ownKeys;
    try { ownKeys = Reflect.ownKeys(value); } catch (_) { passwordError(AUTH_PROTOCOL_ERROR); }
    if (ownKeys.length !== keys.length || ownKeys.some((key, index) => key !== keys[index])) {
      passwordError(AUTH_PROTOCOL_ERROR);
    }
    const result = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        passwordError(AUTH_PROTOCOL_ERROR);
      }
      result[key] = descriptor.value;
    }
    return result;
  }

  function passwordUtf8(value, max, code = "KEYGRAIN_DERIVATION_ERROR") {
    if (typeof value !== "string") passwordError(code);
    let size;
    try { size = new TextEncoder().encode(value).byteLength; } catch (_) { passwordError(code); }
    if (size > max) passwordError(code);
    return size;
  }

  function passwordSymbols(value) {
    if (typeof value !== "string") passwordError(AUTH_PROTOCOL_ERROR);
    if (value.length === 0 || value.length > KEYGRAIN_PASSWORD_MAX_SYMBOLS) passwordError("KEYGRAIN_DERIVATION_ERROR");
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code < 0x21 || code > 0x7e) passwordError("KEYGRAIN_DERIVATION_ERROR");
    }
    return value;
  }

  function passwordRequest(message, action) {
    const values = passwordOrderedEnvelope(message, KEYGRAIN_PASSWORD_REQUEST_KEYS[action]);
    if (values.action !== action) passwordError(AUTH_PROTOCOL_ERROR);
    if (action !== KEYGRAIN_PASSWORD_OPTIONS) {
      if (typeof values.selectionToken !== "string" || !values.selectionToken || values.selectionToken.length > KEYGRAIN_PASSWORD_MAX_FIELD_UTF8) {
        passwordError(AUTH_PROTOCOL_ERROR);
      }
      if (typeof values.length !== "number" || !Number.isSafeInteger(values.length)
        || typeof values.counter !== "number" || !Number.isSafeInteger(values.counter)) passwordError(AUTH_PROTOCOL_ERROR);
      if (values.length < 8 || values.length > 128 || values.counter < 1 || values.counter > 0x7fffffff) {
        passwordError("KEYGRAIN_DERIVATION_ERROR");
      }
      passwordSymbols(values.symbols);
      if (typeof values.policy !== "string") passwordError(AUTH_PROTOCOL_ERROR);
      if (values.policy !== KEYGRAIN_PASSWORD_DEFAULT_POLICY) passwordError("KEYGRAIN_DERIVATION_ERROR");
      if (action === KEYGRAIN_PASSWORD_FILL && typeof values.fillEmail !== "boolean") passwordError(AUTH_PROTOCOL_ERROR);
      passwordUtf8(values.selectionToken, KEYGRAIN_PASSWORD_MAX_FIELD_UTF8, AUTH_PROTOCOL_ERROR);
    }
    return Object.freeze(values);
  }

  function passwordCanonicalRecord(record) {
    if (!passwordOwnData(record)) return null;
    const read = key => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        return {present: false, value: undefined};
      }
      return {present: true, value: descriptor.value};
    };
    const id = read("id");
    const site = read("site");
    const email = read("email");
    if (!id.present || typeof id.value !== "string" || !id.value
      || !site.present || typeof site.value !== "string" || !site.value
      || !email.present || typeof email.value !== "string" || !email.value) return null;
    let normalizedSite;
    try { normalizedSite = root.normalizeSite(site.value); } catch (_) { return null; }
    if (typeof normalizedSite !== "string" || !normalizedSite) return null;
    const canonicalEmail = email.value.trim().toLowerCase();
    if (!canonicalEmail || /[\x00-\x1f\x7f]/.test(canonicalEmail)) return null;
    passwordUtf8(id.value, KEYGRAIN_PASSWORD_MAX_FIELD_UTF8);
    passwordUtf8(normalizedSite, KEYGRAIN_PASSWORD_MAX_FIELD_UTF8);
    passwordUtf8(canonicalEmail, KEYGRAIN_PASSWORD_MAX_EMAIL_UTF8);
    const name = read("name");
    if (name.present && name.value !== null && typeof name.value !== "string") passwordError("KEYGRAIN_DERIVATION_ERROR");
    if (name.present && name.value !== null) passwordUtf8(name.value, KEYGRAIN_PASSWORD_MAX_FIELD_UTF8);
    const defaults = {length: 20, symbols: KEYGRAIN_PASSWORD_DEFAULT_SYMBOLS, counter: 1, policy: KEYGRAIN_PASSWORD_DEFAULT_POLICY};
    for (const key of Object.keys(defaults)) {
      const field = read(key);
      if (!field.present) continue;
      if (typeof field.value !== typeof defaults[key]) passwordError("KEYGRAIN_DERIVATION_ERROR");
      defaults[key] = field.value;
    }
    if (!Number.isSafeInteger(defaults.length) || defaults.length < 8 || defaults.length > 128
      || !Number.isSafeInteger(defaults.counter) || defaults.counter < 1 || defaults.counter > 0x7fffffff
      || defaults.policy !== KEYGRAIN_PASSWORD_DEFAULT_POLICY) passwordError("KEYGRAIN_DERIVATION_ERROR");
    if (typeof defaults.symbols !== "string" || defaults.symbols.length === 0 || defaults.symbols.length > KEYGRAIN_PASSWORD_MAX_SYMBOLS) {
      passwordError("KEYGRAIN_DERIVATION_ERROR");
    }
    for (let index = 0; index < defaults.symbols.length; index++) {
      const code = defaults.symbols.charCodeAt(index);
      if (code < 0x21 || code > 0x7e) passwordError("KEYGRAIN_DERIVATION_ERROR");
    }
    if ("length" in defaults && defaults.length === undefined) passwordError("KEYGRAIN_DERIVATION_ERROR");
    if ("symbols" in defaults) passwordUtf8(defaults.symbols, KEYGRAIN_PASSWORD_MAX_FIELD_UTF8);
    return Object.freeze({
      serviceId: id.value, site: normalizedSite, email: canonicalEmail,
      name: name.present ? name.value : null,
      defaultLength: defaults.length, defaultSymbols: defaults.symbols,
      defaultCounter: defaults.counter, defaultPolicy: defaults.policy,
    });
  }

  function passwordTupleEqual(left, right) {
    return !!left && !!right && ["serviceId", "site", "email", "defaultLength", "defaultSymbols", "defaultCounter", "defaultPolicy"]
      .every(key => left[key] === right[key]);
  }

  function passwordResponse(response) {
    try {
      if (new TextEncoder().encode(JSON.stringify(response)).byteLength > KEYGRAIN_PASSWORD_MAX_RESPONSE_BYTES) {
        passwordError("KEYGRAIN_OPERATION_ERROR");
      }
      return response;
    } catch (exception) {
      if (exception?.code === "KEYGRAIN_OPERATION_ERROR") throw exception;
      passwordError("KEYGRAIN_OPERATION_ERROR");
    }
  }

  function passwordOutput(value, length, symbols) {
    if (typeof value !== "string" || value.length !== length) passwordError("KEYGRAIN_DERIVATION_ERROR");
    passwordUtf8(value, KEYGRAIN_PASSWORD_MAX_OUTPUT_UTF8);
    const charset = new Set((KEYGRAIN_PASSWORD_UPPER + KEYGRAIN_PASSWORD_LOWER + KEYGRAIN_PASSWORD_DIGITS + symbols).split(""));
    for (const character of value) if (!charset.has(character)) passwordError("KEYGRAIN_DERIVATION_ERROR");
    return value;
  }

  function ownData(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      return prototype === null || (Object.prototype.toString.call(value) === "[object Object]"
        && prototype && prototype.constructor && prototype.constructor.name === "Object");
    } catch (_) {
      return false;
    }
  }

  function exactSettings(value) {
    return ownData(value) && Object.keys(value).length === 3
      && Object.prototype.hasOwnProperty.call(value, "version")
      && Object.prototype.hasOwnProperty.call(value, "fullLeaseSeconds")
      && Object.prototype.hasOwnProperty.call(value, "metadataTailSeconds");
  }

  function normalizeSettings(value) {
    if (typeof root.normalizeSecuritySettings !== "function") throw error(SETTINGS_STORAGE_ERROR);
    try {
      return root.normalizeSecuritySettings(value);
    } catch (_) {
      throw error("KEYGRAIN_SETTINGS_ERROR");
    }
  }

  function defaultSettings() {
    return Object.freeze({version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400});
  }

  function storageApi(storage) {
    if (!storage || typeof storage.get !== "function" || typeof storage.set !== "function") {
      throw error(SETTINGS_STORAGE_ERROR);
    }
    return storage;
  }

  async function loadSecuritySettings(storage) {
    const api = storageApi(storage);
    let data;
    try {
      data = await api.get(root.KEYGRAIN_SETTINGS_KEY);
    } catch (_) {
      throw error(SETTINGS_STORAGE_ERROR);
    }
    const raw = data && data[root.KEYGRAIN_SETTINGS_KEY];
    let settings;
    try {
      settings = normalizeSettings(raw);
    } catch (_) {
      settings = defaultSettings();
      try {
        await api.set({[root.KEYGRAIN_SETTINGS_KEY]: settings});
      } catch (_) {
        throw error(SETTINGS_STORAGE_ERROR);
      }
    }
    return settings;
  }

  async function saveSecuritySettings(storage, candidate) {
    const api = storageApi(storage);
    let settings;
    try { settings = normalizeSettings(candidate); } catch (_) { throw error("KEYGRAIN_SETTINGS_ERROR"); }
    try {
      await api.set({[root.KEYGRAIN_SETTINGS_KEY]: settings});
    } catch (_) {
      throw error(SETTINGS_STORAGE_ERROR);
    }
    return settings;
  }

  // Cleanup is deliberately separate from security settings. It never reads a
  // legacy duration and its failure cannot authorize a lease.
  async function cleanupLegacyPreferences(storage) {
    const api = storageApi(storage);
    let data;
    try { data = await api.get("settings"); } catch (_) { return false; }
    const legacy = data && ownData(data.settings) ? data.settings : null;
    try {
      if (legacy && Object.prototype.hasOwnProperty.call(legacy, LEGACY_SETTINGS_KEY)) {
        const preserved = {};
        for (const [key, value] of Object.entries(legacy)) {
          if (key !== LEGACY_SETTINGS_KEY) preserved[key] = value;
        }
        await api.set({settings: preserved});
      }
      if (typeof api.remove === "function") await api.remove(LEGACY_EMAIL_KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  function normalizeEmail(value) {
    if (typeof value !== "string") throw error(AUTH_PROTOCOL_ERROR);
    const email = value.trim().toLowerCase();
    if (!email || email.length > 254 || !/^\S+@\S+$/.test(email)) throw error(AUTH_PROTOCOL_ERROR);
    return email;
  }

  function dataField(value, key) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value") || !descriptor.enumerable) {
      throw error(AUTH_PROTOCOL_ERROR);
    }
    return descriptor.value;
  }

  function exactMessageKeys(value, keys) {
    if (!ownData(value)) throw error(AUTH_PROTOCOL_ERROR);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw error(AUTH_PROTOCOL_ERROR);
    }
  }

  function validateUnlockMessage(message) {
    try {
      exactMessageKeys(message, ["action", "email", "secret", "popupSessionId", "confirmationId"]);
      const action = dataField(message, "action");
      const emailValue = dataField(message, "email");
      const secret = dataField(message, "secret");
      const popupSessionId = dataField(message, "popupSessionId");
      const confirmationId = dataField(message, "confirmationId");
      if (action !== "unlock"
        || typeof secret !== "string" || secret.length === 0
        || typeof popupSessionId !== "string" || popupSessionId.length < 1
        || !(confirmationId === null || typeof confirmationId === "string")) {
        throw error(AUTH_PROTOCOL_ERROR);
      }
      return Object.freeze({
        action: "unlock",
        email: normalizeEmail(emailValue),
        secret,
        popupSessionId,
        confirmationId,
      });
    } catch (exception) {
      if (exception?.code === AUTH_PROTOCOL_ERROR) throw exception;
      throw error(AUTH_PROTOCOL_ERROR);
    }
  }

  function validateConfirmationMessage(message, expectedAction) {
    try {
      exactMessageKeys(message, ["action", "popupSessionId"]);
      const action = dataField(message, "action");
      const popupSessionId = dataField(message, "popupSessionId");
      if (action !== expectedAction || typeof popupSessionId !== "string" || popupSessionId.length < 1) {
        throw error(AUTH_PROTOCOL_ERROR);
      }
      return Object.freeze({action, popupSessionId});
    } catch (exception) {
      if (exception?.code === AUTH_PROTOCOL_ERROR) throw exception;
      throw error(AUTH_PROTOCOL_ERROR);
    }
  }

  function exactExtensionOrigin(runtimeId, origin, browser = "chrome") {
    if (typeof runtimeId !== "string" || !runtimeId || typeof origin !== "string") return false;
    const scheme = browser === "firefox" ? "moz-extension" : "chrome-extension";
    return origin === `${scheme}://${runtimeId}`;
  }

  function normalizeExtensionOrigin(origin, browser) {
    if (typeof origin !== "string") return null;
    try {
      const parsed = new URL(origin);
      const scheme = browser === "firefox" ? "moz-extension:" : "chrome-extension:";
      if (parsed.protocol !== scheme || !parsed.hostname || parsed.username || parsed.password
        || parsed.port || parsed.search || parsed.hash) return null;
      return `${parsed.protocol}//${parsed.hostname}`;
    } catch (_) {
      return null;
    }
  }

  // This predicate proves only the transport context. Action membership is
  // deliberately classified later so trusted reserved actions receive the
  // migration result while untrusted known/unknown actions are indistinguishable.
  function isTrustedExtensionPage(sender, runtimeId, _action, browser = "chrome", extensionOrigin = null) {
    try {
      if (!sender || typeof runtimeId !== "string" || !runtimeId || sender.id !== runtimeId) return false;
      if (typeof sender.url !== "string") return false;
      const expectedOrigin = extensionOrigin === null
        ? (browser === "firefox" ? null : `chrome-extension://${runtimeId}`)
        : normalizeExtensionOrigin(extensionOrigin, browser);
      if (!expectedOrigin) return false;
      const url = new URL(sender.url);
      const senderOrigin = `${url.protocol}//${url.hostname}`;
      if (senderOrigin !== expectedOrigin || !EXTENSION_PAGE_PATHS.has(url.pathname) || url.search || url.hash) return false;
      if (url.pathname === "/popup.html" && sender.tab !== undefined && sender.tab !== null) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function rejectUntrustedOrLegacy(sender, runtimeId, message, browser = "chrome", extensionOrigin = null) {
    try {
      if (!ownData(message) || typeof message.action !== "string") return safeFailure(AUTH_PROTOCOL_ERROR);
      if (!isTrustedExtensionPage(sender, runtimeId, message.action, browser, extensionOrigin)
        && !["setSecret", "setEmail", "getSecret", "getEmail", "setSecrets", "clearEmail"].includes(message.action)) {
        return safeFailure(CONTEXT_ERROR);
      }
      if (["setSecret", "setEmail", "getSecret", "getEmail", "setSecrets", "clearEmail"].includes(message.action)) {
        return safeFailure(AUTH_PROTOCOL_ERROR);
      }
      if (PHASE_B_ACTIONS.has(message.action)) return safeFailure(CONSUMER_MIGRATION_REQUIRED);
      if (!isTrustedExtensionPage(sender, runtimeId, message.action, browser, extensionOrigin)) return safeFailure(CONTEXT_ERROR);
      return null;
    } catch (_) {
      return safeFailure(CONTEXT_ERROR);
    }
  }

  function parseWebContext(sender, expected) {
    if (!sender || !sender.tab || !Number.isInteger(sender.tab.id) || sender.tab.id < 0) throw error(CONTEXT_ERROR);
    if (!Number.isInteger(sender.frameId) || sender.frameId < 0 || typeof sender.url !== "string") throw error(CONTEXT_ERROR);
    let parsed;
    try { parsed = new URL(sender.url); } catch (_) { throw error(CONTEXT_ERROR); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw error(CONTEXT_ERROR);
    if (!expected || expected.tabId !== sender.tab.id || expected.frameId !== sender.frameId || expected.origin !== parsed.origin) {
      throw error(CONTEXT_ERROR);
    }
    const documentId = sender.documentId;
    if (expected.documentId !== undefined && documentId !== expected.documentId) throw error(CONTEXT_ERROR);
    return Object.freeze({
      tabId: sender.tab.id,
      frameId: sender.frameId,
      origin: parsed.origin,
      documentId: documentId === undefined ? null : documentId,
      nonce: expected.nonce === undefined ? null : expected.nonce,

    });
  }

  function makeContext(adapter, sender) {
    if (!sender || !sender.tab || !Number.isInteger(sender.tab.id) || !Number.isInteger(sender.frameId)) throw error(CONTEXT_ERROR);
    let url;
    try { url = new URL(sender.url); } catch (_) { throw error(CONTEXT_ERROR); }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw error(CONTEXT_ERROR);
    const documentId = sender.documentId;
    if (adapter && adapter.browser === "chrome" && documentId === undefined) throw error(CONTEXT_ERROR);
    return Object.freeze({
      tabId: sender.tab.id,
      frameId: sender.frameId,
      origin: url.origin,
      documentId: documentId === undefined ? null : documentId,
      nonce: adapter && adapter.browser === "firefox" ? null : undefined,
    });
  }

  function contextMatches(context, sender) {
    try { parseWebContext(sender, context); return true; } catch (_) { return false; }
  }

  async function proveContext(adapter, context) {
    if (!context || !adapter) throw error(CONTEXT_ERROR);
    if (adapter.browser === "chrome") {
      if (context.documentId === null || typeof adapter.checkDocument !== "function") throw error(CONTEXT_ERROR);
      const valid = await adapter.checkDocument(context);
      if (valid !== true) throw error(CONTEXT_ERROR);
      return true;
    }
    if (adapter.browser !== "firefox" || typeof adapter.challengeContext !== "function") throw error(CONTEXT_ERROR);
    const proof = await adapter.challengeContext(context);
    if (!proof || proof.tabId !== context.tabId || proof.frameId !== context.frameId
      || proof.origin !== context.origin || typeof proof.nonce !== "string" || !proof.nonce) throw error(CONTEXT_ERROR);
    return true;
  }

  function preparedUnlock(value) {
    if (!ownData(value)) throw error(UNLOCK_FAILED);
    const keys = Object.keys(value).sort();
    if (keys.length !== 2 || keys[0] !== "fullData" || keys[1] !== "records") throw error(UNLOCK_FAILED);
    const fullData = Object.getOwnPropertyDescriptor(value, "fullData");
    const records = Object.getOwnPropertyDescriptor(value, "records");
    if (!fullData || !Object.prototype.hasOwnProperty.call(fullData, "value")
      || !records || !Object.prototype.hasOwnProperty.call(records, "value")
      || !Array.isArray(records.value)) throw error(UNLOCK_FAILED);
    return {fullData: fullData.value, records: records.value};
  }

  function stringField(record, key) {
    if (!ownData(record)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
      && typeof descriptor.value === "string" ? descriptor.value : null;
  }

  // This is the only full-state projection exposed to browser adapters. It is
  // deliberately built inside the manager operation capture, so the owner never
  // receives or retains a full-data view. Every returned field is a bounded,
  // cloneable, non-secret registration/indicator value.
  function captureIndicatorProjection(fullData) {
    const records = Array.isArray(fullData && fullData.services) ? fullData.services : [];
    const registrationRecords = [];
    const badgeSites = [];
    const accounts = [];
    for (const record of records) {
      const site = stringField(record, "site") || stringField(record, "name");
      const name = stringField(record, "name");
      const email = stringField(record, "email");
      const id = stringField(record, "id");
      if (site) {
        registrationRecords.push({site, name: name || site});
        badgeSites.push(site.toLowerCase());
      }
      // Nulls are intentional: unlike undefined they are cloneable and contain
      // no caller-controlled object/reference. Content receives labels only.
      accounts.push({token: id, email, name});
    }
    let matches = [];
    try {
      const helper = root.KeygrainInline;
      if (helper && typeof helper.computeMatchPatterns === "function") {
        matches = helper.computeMatchPatterns(registrationRecords);
      }
    } catch (_) { matches = []; }
    return {matches: Array.from(new Set(matches)).filter(value => typeof value === "string"), badgeSites, accounts};
  }

  function createOwner({adapter, settings, clock, authenticateAndPrepare} = {}) {
    if (!adapter || typeof adapter !== "object") throw error(CONTEXT_ERROR);
    if (typeof root.KeygrainStateManager !== "function") throw error(SETTINGS_STORAGE_ERROR);
    if (authenticateAndPrepare !== undefined && typeof authenticateAndPrepare !== "function") throw error(UNLOCK_FAILED);
    const normalized = normalizeSettings(settings);
    const ownerClock = clock || Date.now;
    const manager = new root.KeygrainStateManager({clock: ownerClock, settings: normalized});
    const settingsStore = adapter.storage || adapter.settingsStore || null;
    let closed = false;
    let lastSnapshot = manager.snapshot();
    let wakeGeneration = 0;
    let reconciliationToken = 0;
    let reconciliationChain = Promise.resolve();
    const confirmations = new Map();

    async function loadSettings() {
      if (!settingsStore) throw error(SETTINGS_STORAGE_ERROR);
      const loaded = await loadSecuritySettings(settingsStore);
      manager.applySettings(loaded);
      let prefs = {};
      try {
        const stored = await settingsStore.get("settings");
        if (stored && ownData(stored.settings)) {
          prefs = stored.settings;
        }
      } catch (_) {}
      return {...loaded, ...prefs};
    }

    async function unlock(sender, runtimeId, message, browser = adapter.browser || "chrome", extensionOrigin = null) {
      try {
        const guard = rejectUntrustedOrLegacy(sender, runtimeId, message, browser, extensionOrigin);
        if (guard) return guard;
        const request = validateUnlockMessage(message);
        if (typeof authenticateAndPrepare !== "function") return safeFailure(UNLOCK_FAILED);
        const senderUrl = typeof sender?.url === "string" ? sender.url : "";
        const loaded = await loadSecuritySettings(settingsStore);
        const confirmation = takeConfirmation(request.confirmationId, request.popupSessionId, senderUrl);
        const prepared = await authenticateAndPrepare({
          email: request.email,
          secret: request.secret,
          popupSessionId: request.popupSessionId,
        });
        const payload = preparedUnlock(prepared);
        manager.applySettings(loaded);
        let committed = false;
        try {
          manager.unlockFull({
            fullData: payload.fullData,
            records: payload.records,
            exceptionalConfirmation: confirmation,
          });
          committed = true;
          popupInstallAuthenticatedIdentity(request.email);
          passwordClearCapabilities();
          b2AdvanceRecordGeneration();
          popupInstallReplacementSnapshot();
          lastSnapshot = reconcile("unlock");
          if (request.confirmationId !== null) confirmations.delete(request.confirmationId);
          return success({snapshot: lastSnapshot});
        } catch (exception) {
          if (committed) {
            try { manager.invalidate("external_security_invalidation"); } catch (_) {}
            popupClearAuthenticatedIdentity();
            lastSnapshot = manager.snapshot();
          }
          if (exception?.code === "KEYGRAIN_CONFIRMATION_ERROR") return safeFailure("KEYGRAIN_CONFIRMATION_ERROR");
          return safeFailure(UNLOCK_FAILED);
        }
      } catch (exception) {
        if (exception?.code === "KEYGRAIN_SETTINGS_STORAGE_ERROR") return safeFailure(SETTINGS_STORAGE_ERROR);
        if (exception?.code === "KEYGRAIN_CONFIRMATION_ERROR") return safeFailure("KEYGRAIN_CONFIRMATION_ERROR");
        if (exception?.code === AUTH_PROTOCOL_ERROR || exception?.code === CONTEXT_ERROR) return safeFailure(exception.code);
        return safeFailure(UNLOCK_FAILED);
      }
    }

    function popupContext(sender, runtimeId, browser, extensionOrigin) {
      if (!isTrustedExtensionPage(sender, runtimeId, null, browser, extensionOrigin)) throw error(CONTEXT_ERROR);
    }

    function popupServiceCapture(fullData) {
      try {
        if (!fullData || typeof fullData !== "object" || Array.isArray(fullData)) return {invalid: true};
        const descriptor = Object.getOwnPropertyDescriptor(fullData, "services");
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")
          || !Array.isArray(descriptor.value)) return {invalid: true};
        return {items: popupManagerProjectionItems(descriptor.value)};
      } catch (_) {
        return {invalid: true};
      }
    }

    function popupCapturedItems(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw error(OPERATION_ERROR);
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== null && prototype !== Object.prototype) throw error(OPERATION_ERROR);
      const keys = Reflect.ownKeys(value);
      if (keys.length !== 1 || keys[0] !== "items") throw error(OPERATION_ERROR);
      const descriptor = Object.getOwnPropertyDescriptor(value, "items");
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")
        || !Array.isArray(descriptor.value)) throw error(OPERATION_ERROR);
      return popupProjectionItems(descriptor.value);
    }

    async function popupStateOperation(sender, runtimeId, browser, extensionOrigin) {
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        const result = popupStateResult(manager.snapshot(), authenticatedAccountEmail);
        popupContext(sender, runtimeId, browser, extensionOrigin);
        return popupResponse(success({result}));
      } catch (exception) {
        return popupFailureFor(exception);
      }
    }

    async function popupMetadataOperation(sender, runtimeId, browser, extensionOrigin) {
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        const snapshot = manager.snapshot();
        if (snapshot.state !== "metadata") throw error("KEYGRAIN_METADATA_ERROR");
        const metadata = manager.getMetadata();
        if (!Array.isArray(metadata)) throw error("KEYGRAIN_METADATA_ERROR");
        const items = popupProjectionItems(metadata);
        popupContext(sender, runtimeId, browser, extensionOrigin);
        return popupResponse(success({result: {items}}));
      } catch (exception) {
        return popupFailureFor(exception);
      }
    }

    async function popupServiceListOperation(sender, runtimeId, browser, extensionOrigin) {
      let handle = null;
      let finalized = false;
      const check = () => manager.checkSensitiveOperation(handle);
      const finalize = (method, reason) => {
        if (finalized) return;
        finalized = true;
        manager[method](handle, reason);
      };
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        const snapshot = manager.snapshot();
        if (snapshot.state !== "full") throw error("KEYGRAIN_EXPIRED");
        handle = manager.beginSensitiveOperation({capture: popupServiceCapture});
        check();
        const captured = manager.getSensitiveOperationInput(handle);
        check();
        check();
        const projected = popupCapturedItems(captured);
        check();
        const items = await Promise.resolve(projected);
        check();
        const response = popupResponse(success({result: {items}}));
        check();
        popupContext(sender, runtimeId, browser, extensionOrigin);
        check();
        finalize("completeSensitiveOperation", "service_list_complete");
        return response;
      } catch (exception) {
        let failure = exception;
        if (handle && !finalized) {
          try { finalize("failSensitiveOperation", "service_list_failure"); }
          catch (_) { failure = error(OPERATION_ERROR); }
        }
        return popupFailureFor(failure);
      } finally {
        if (!finalized) {
          try { finalize("cancelSensitiveOperation", "service_list_finally"); } catch (_) {}
        }
      }
    }

    const b2Capabilities = new Map();
    let b2LastOwnerNow = null;
    let b2RecordGeneration = 0;
    const popupSelectionCapabilities = new Map();
    const popupEditCapabilities = new Map();
    let accountDataRevision = 0;
    let accountIdentityGeneration = 0;
    let authenticatedAccountEmail = null;
    let workerUpdateVersion = null;
    if (typeof root.KeygrainWorkerUpdateVersion === "object" && typeof root.KeygrainWorkerUpdateVersion.createWorkerUpdateVersion === "function") {
      workerUpdateVersion = root.KeygrainWorkerUpdateVersion.createWorkerUpdateVersion({nowMs: ownerClock});
    }
    let popupInstalledSnapshot = null;
    let popupObservedStateGeneration = manager.snapshot().stateGeneration;
    let popupObservedAuthorizationGeneration = manager.snapshot().authorizationGeneration;

    function popupClearAuthenticatedIdentity() {
      if (authenticatedAccountEmail !== null && accountIdentityGeneration < Number.MAX_SAFE_INTEGER) {
        accountIdentityGeneration++;
      }
      authenticatedAccountEmail = null;
      popupClearCapabilities();
      accountDataRevision = 0;
      popupInstalledSnapshot = null;
    }

    function popupInstallAuthenticatedIdentity(email) {
      if (typeof email !== "string" || !email || accountIdentityGeneration === Number.MAX_SAFE_INTEGER) {
        throw error("KEYGRAIN_STALE_OPERATION");
      }
      accountIdentityGeneration++;
      authenticatedAccountEmail = email;
    }

    function restoreSession({email, fullData, records, metadata, fullExpiresAt, metadataExpiresAt, metadataTailAnchor, activeMetadataTailSeconds}) {
      if (typeof email !== "string" || !email) throw error("KEYGRAIN_STALE_OPERATION");
      if (fullData && records && fullExpiresAt) {
        manager.restoreFull({fullData, records, fullExpiresAt, metadataTailAnchor, activeMetadataTailSeconds});
      } else if (metadata && (metadataExpiresAt || metadataTailAnchor)) {
        manager.restoreMetadata({metadata, metadataExpiresAt: metadataExpiresAt || metadataTailAnchor, metadataTailAnchor, activeMetadataTailSeconds});
      } else {
        throw error("KEYGRAIN_STALE_OPERATION");
      }
      popupInstallAuthenticatedIdentity(email);
      lastSnapshot = manager.snapshot();
      return lastSnapshot;
    }

    function popupClearCapabilities() {
      popupSelectionCapabilities.clear();
      popupEditCapabilities.clear();
    }
    function popupAdvanceDataRevision() {
      if (accountDataRevision === Number.MAX_SAFE_INTEGER) {
        popupClearCapabilities();
        throw error("KEYGRAIN_STALE_OPERATION");
      }
      accountDataRevision++;
      popupClearCapabilities();
    }
    function popupObserveSnapshot(snapshot) {
      if (snapshot.stateGeneration !== popupObservedStateGeneration
        || snapshot.authorizationGeneration !== popupObservedAuthorizationGeneration) {
        popupObservedStateGeneration = snapshot.stateGeneration;
        popupObservedAuthorizationGeneration = snapshot.authorizationGeneration;
        popupClearCapabilities();
      }
      if (snapshot.state !== "full") popupClearCapabilities();
      if (snapshot.state === "locked") popupClearAuthenticatedIdentity();
    }
    const KEYGRAIN_TOTP_OPTIONS = "keygrain.totp.options";
    const KEYGRAIN_TOTP_GENERATE = "keygrain.totp.generate";
    const KEYGRAIN_TOTP_FILL = "keygrain.totp.fill";
    const KEYGRAIN_TOTP_ACTIONS = new Set([KEYGRAIN_TOTP_OPTIONS, KEYGRAIN_TOTP_GENERATE, KEYGRAIN_TOTP_FILL]);
    const KEYGRAIN_TOTP_REQUEST_KEYS = Object.freeze({
      [KEYGRAIN_TOTP_OPTIONS]: Object.freeze(["action"]),
      [KEYGRAIN_TOTP_GENERATE]: Object.freeze(["action", "selectionToken"]),
      [KEYGRAIN_TOTP_FILL]: Object.freeze(["action", "selectionToken"]),
    });
    const KEYGRAIN_TOTP_CAPABILITY_TTL_MS = 30000;
    const KEYGRAIN_TOTP_DELIVERY_TTL_MS = 5000;
    const KEYGRAIN_TOTP_MAX_ITEMS = 256;
    const KEYGRAIN_TOTP_MAX_FIELD_UTF8 = 256;
    const KEYGRAIN_TOTP_MAX_RESPONSE_BYTES = 65536;
    const KEYGRAIN_TOTP_MAX_SEED_BYTES = 128;
    const KEYGRAIN_TOTP_MAX_CODE_DIGITS = 8;
    const KEYGRAIN_TOTP_ERROR = "KEYGRAIN_TOTP_ERROR";
    const KEYGRAIN_TOTP_DELIVERY_ERROR = "KEYGRAIN_TOTP_DELIVERY_ERROR";

    function b2Error(code) { const result = new Error(code); result.code = code; return result; }
    function b2SafeFailure(code) {
      const messages = {
        KEYGRAIN_AUTH_PROTOCOL_ERROR: "Invalid authentication request.",
        KEYGRAIN_CONTEXT_ERROR: "This action is not available from this context.",
        KEYGRAIN_OPERATION_ERROR: "The operation could not be completed.",
        KEYGRAIN_CONSUMER_MIGRATION_REQUIRED: "Update Keygrain to continue.",
        KEYGRAIN_EXPIRED: "Unlock is required.",
        KEYGRAIN_STALE_OPERATION: "The operation could not be completed.",
        [KEYGRAIN_TOTP_ERROR]: "The TOTP code could not be generated.",
        [KEYGRAIN_TOTP_DELIVERY_ERROR]: "The TOTP code could not be delivered.",
      };
      return Object.freeze({ok: false, code, message: messages[code] || messages.KEYGRAIN_OPERATION_ERROR});
    }
    function b2SafeError(exception, fallback = "KEYGRAIN_OPERATION_ERROR") {
      const code = exception && typeof exception.code === "string" ? exception.code : fallback;
      return b2SafeFailure(new Set([
        AUTH_PROTOCOL_ERROR, CONTEXT_ERROR, OPERATION_ERROR, CONSUMER_MIGRATION_REQUIRED,
        "KEYGRAIN_EXPIRED", "KEYGRAIN_STALE_OPERATION", KEYGRAIN_TOTP_ERROR, KEYGRAIN_TOTP_DELIVERY_ERROR,
      ]).has(code) ? code : fallback);
    }
    function b2PlainData(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      try { const prototype = Object.getPrototypeOf(value); return prototype === null || prototype === Object.prototype; }
      catch (_) { return false; }
    }
    function b2Own(value, key) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        throw b2Error(KEYGRAIN_TOTP_ERROR);
      }
      return {present: true, value: descriptor.value};
    }
    function b2Utf8(value, max, code = KEYGRAIN_TOTP_ERROR) {
      if (typeof value !== "string") throw b2Error(code);
      let bytes;
      try { bytes = new TextEncoder().encode(value).byteLength; } catch (_) { throw b2Error(code); }
      if (bytes > max) throw b2Error(code);
      return bytes;
    }
    function b2ExactEnvelope(value, keys) {
      if (!b2PlainData(value)) throw b2Error(AUTH_PROTOCOL_ERROR);
      let ownKeys;
      try { ownKeys = Reflect.ownKeys(value); } catch (_) { throw b2Error(AUTH_PROTOCOL_ERROR); }
      if (ownKeys.length !== keys.length || ownKeys.some((key, index) => key !== keys[index])) throw b2Error(AUTH_PROTOCOL_ERROR);
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) throw b2Error(AUTH_PROTOCOL_ERROR);
      }
      return value;
    }
    function b2Request(value, action) {
      const keys = KEYGRAIN_TOTP_REQUEST_KEYS[action];
      if (!keys) throw b2Error(AUTH_PROTOCOL_ERROR);
      b2ExactEnvelope(value, keys);
      if (value.action !== action) throw b2Error(AUTH_PROTOCOL_ERROR);
      if (action !== KEYGRAIN_TOTP_OPTIONS) {
        if (typeof value.selectionToken !== "string" || !value.selectionToken) throw b2Error(AUTH_PROTOCOL_ERROR);
        b2Utf8(value.selectionToken, KEYGRAIN_TOTP_MAX_FIELD_UTF8, AUTH_PROTOCOL_ERROR);
      }
      return value;
    }
    function b2Config(value) {
      if (!b2PlainData(value)) throw b2Error(KEYGRAIN_TOTP_ERROR);
      let keys;
      try { keys = Reflect.ownKeys(value); } catch (_) { throw b2Error(KEYGRAIN_TOTP_ERROR); }
      const allowed = new Set(["mode", "seed", "algorithm", "digits", "period", "issuer", "label"]);
      if (keys.some(key => typeof key !== "string" || !allowed.has(key))) throw b2Error(KEYGRAIN_TOTP_ERROR);
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) throw b2Error(KEYGRAIN_TOTP_ERROR);
      }
      const read = key => Object.prototype.hasOwnProperty.call(value, key) ? b2Own(value, key).value : undefined;
      const mode = read("mode");
      if (mode !== "stored" && mode !== "derived") throw b2Error(KEYGRAIN_TOTP_ERROR);
      const algorithmValue = Object.prototype.hasOwnProperty.call(value, "algorithm") ? read("algorithm") : "SHA1";
      if (typeof algorithmValue !== "string") throw b2Error(KEYGRAIN_TOTP_ERROR);
      const algorithm = algorithmValue.toUpperCase();
      if (!["SHA1", "SHA256", "SHA512"].includes(algorithm)) throw b2Error(KEYGRAIN_TOTP_ERROR);
      const digits = Object.prototype.hasOwnProperty.call(value, "digits") ? read("digits") : 6;
      if (!Number.isSafeInteger(digits) || ![6, 8].includes(digits)) throw b2Error(KEYGRAIN_TOTP_ERROR);
      const period = Object.prototype.hasOwnProperty.call(value, "period") ? read("period") : 30;
      if (!Number.isSafeInteger(period) || period < 1 || period > 300) throw b2Error(KEYGRAIN_TOTP_ERROR);
      for (const key of ["issuer", "label"]) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const field = read(key);
          if (field !== null) b2Utf8(field, KEYGRAIN_TOTP_MAX_FIELD_UTF8);
        }
      }
      let seedText = null;
      if (mode === "stored") {
        if (!Object.prototype.hasOwnProperty.call(value, "seed")) throw b2Error(KEYGRAIN_TOTP_ERROR);
        seedText = read("seed");
        if (typeof seedText !== "string" || typeof root.atob !== "function") throw b2Error(KEYGRAIN_TOTP_ERROR);
        let binary;
        try { binary = root.atob(seedText); } catch (_) { throw b2Error(KEYGRAIN_TOTP_ERROR); }
        if (!binary || binary.length < 1 || binary.length > KEYGRAIN_TOTP_MAX_SEED_BYTES) throw b2Error(KEYGRAIN_TOTP_ERROR);
      } else if (Object.prototype.hasOwnProperty.call(value, "seed")) {
        throw b2Error(KEYGRAIN_TOTP_ERROR);
      }
      return Object.freeze({mode, algorithm, digits, period, seedText});
    }
    function b2CanonicalRecord(record, recordIndex) {
      if (!b2PlainData(record)) return null;
      const totpDescriptor = Object.getOwnPropertyDescriptor(record, "totp");
      if (!totpDescriptor) return null;
      if (!totpDescriptor.enumerable || !Object.prototype.hasOwnProperty.call(totpDescriptor, "value")) throw b2Error(KEYGRAIN_TOTP_ERROR);
      if (totpDescriptor.value === null) return null;
      const idDesc = Object.getOwnPropertyDescriptor(record, "id");
      const siteDesc = Object.getOwnPropertyDescriptor(record, "site");
      const emailDesc = Object.getOwnPropertyDescriptor(record, "email");
      if (!idDesc || typeof idDesc.value !== "string" || !idDesc.value) throw b2Error(KEYGRAIN_TOTP_ERROR);
      if (!siteDesc || typeof siteDesc.value !== "string" || !siteDesc.value) throw b2Error(KEYGRAIN_TOTP_ERROR);
      if (!emailDesc || typeof emailDesc.value !== "string" || !emailDesc.value) throw b2Error(KEYGRAIN_TOTP_ERROR);
      const id = idDesc.value;
      const siteRaw = siteDesc.value;
      const emailRaw = emailDesc.value;
      let site;
      try { site = root.normalizeSite(siteRaw); } catch (_) { throw b2Error(KEYGRAIN_TOTP_ERROR); }
      if (typeof site !== "string" || !site) throw b2Error(KEYGRAIN_TOTP_ERROR);
      const email = emailRaw.trim().toLowerCase();
      if (!email || /[\x00-\x1f\x7f]/.test(email)) throw b2Error(KEYGRAIN_TOTP_ERROR);
      try {
        b2Utf8(id, KEYGRAIN_TOTP_MAX_FIELD_UTF8);
        b2Utf8(site, KEYGRAIN_TOTP_MAX_FIELD_UTF8);
        b2Utf8(email, 254);
      } catch (_) { throw b2Error(KEYGRAIN_TOTP_ERROR); }
      const nameDescriptor = Object.getOwnPropertyDescriptor(record, "name");
      let name = null;
      if (nameDescriptor) {
        if (!nameDescriptor.enumerable || !Object.prototype.hasOwnProperty.call(nameDescriptor, "value")) throw b2Error(KEYGRAIN_TOTP_ERROR);
        name = nameDescriptor.value;
        if (name !== null) {
          try { b2Utf8(name, KEYGRAIN_TOTP_MAX_FIELD_UTF8); } catch (_) { throw b2Error(KEYGRAIN_TOTP_ERROR); }
        }
      }
      const config = b2Config(totpDescriptor.value);
      const tuple = Object.freeze({serviceId: id, site, email, name, mode: config.mode, algorithm: config.algorithm,
        digits: config.digits, period: config.period});
      return Object.freeze({recordIndex, tuple, seedText: config.seedText});
    }
    function b2RecordCandidates(fullData) {
      if (!b2PlainData(fullData)) throw b2Error(KEYGRAIN_TOTP_ERROR);
      const servicesDescriptor = Object.getOwnPropertyDescriptor(fullData, "services");
      if (!servicesDescriptor || !servicesDescriptor.enumerable || !Object.prototype.hasOwnProperty.call(servicesDescriptor, "value")
        || !Array.isArray(servicesDescriptor.value)) throw b2Error(KEYGRAIN_TOTP_ERROR);
      const result = [];
      for (let recordIndex = 0; recordIndex < servicesDescriptor.value.length; recordIndex++) {
        const record = servicesDescriptor.value[recordIndex];
        if (!b2PlainData(record)) continue;
        const totp = Object.getOwnPropertyDescriptor(record, "totp");
        if (!totp) continue;
        if (!totp.enumerable || !Object.prototype.hasOwnProperty.call(totp, "value")) continue;
        if (totp.value === null) continue;
        const candidate = b2CanonicalRecord(record, recordIndex);
        if (candidate) result.push(candidate);
      }
      if (result.length > KEYGRAIN_TOTP_MAX_ITEMS) throw b2Error(KEYGRAIN_TOTP_ERROR);
      return result;
    }
    function b2TupleEqual(left, right) {
      return !!left && !!right && ["serviceId", "site", "email", "mode", "algorithm", "digits", "period"]
        .every(key => left[key] === right[key]);
    }
    function b2CapabilityTuple(tuple) {
      return Object.freeze({serviceId: tuple.serviceId, site: tuple.site, email: tuple.email,
        mode: tuple.mode, algorithm: tuple.algorithm, digits: tuple.digits, period: tuple.period});
    }
    function b2Random() {
      try {
        if (!root.crypto || typeof root.crypto.getRandomValues !== "function") throw b2Error(OPERATION_ERROR);
        const bytes = new Uint8Array(32);
        root.crypto.getRandomValues(bytes);
        let result = "";
        for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
        bytes.fill(0);
        return result;
      } catch (exception) { if (exception?.code) throw exception; throw b2Error(OPERATION_ERROR); }
    }
    function b2ClearCapabilities() { b2Capabilities.clear(); }
    function b2AdvanceRecordGeneration() {
      if (b2RecordGeneration === Number.MAX_SAFE_INTEGER) { b2ClearCapabilities(); b3ClearCapabilities(); walletClearCapabilities(); throw b2Error("KEYGRAIN_STALE_OPERATION"); }
      b2RecordGeneration++;
      b2ClearCapabilities();
      b3ClearCapabilities();
      walletClearCapabilities();
    }
    function b2OwnerNow() {
      let now;
      try { now = ownerClock(); } catch (_) { now = NaN; }
      if (!Number.isSafeInteger(now) || now < 0 || (b2LastOwnerNow !== null && now < b2LastOwnerNow)) {
        b2ClearCapabilities();
        b3ClearCapabilities();
        walletClearCapabilities();
        if (b2RecordGeneration < Number.MAX_SAFE_INTEGER) b2RecordGeneration++;
        try { manager.invalidate("clock_rollback"); } catch (_) {}
        throw b2Error("KEYGRAIN_STALE_OPERATION");
      }
      b2LastOwnerNow = now;
      return now;
    }
    function b2Snapshot() {
      try { return manager.snapshot(); }
      catch (_) { b2ClearCapabilities(); throw b2Error("KEYGRAIN_STALE_OPERATION"); }
    }
    function b2Step(nowMs, period) { return Math.floor(Math.floor(nowMs / 1000) / period); }
    function b2Response(response) {
      try {
        if (new TextEncoder().encode(JSON.stringify(response)).byteLength > KEYGRAIN_TOTP_MAX_RESPONSE_BYTES) throw b2Error(OPERATION_ERROR);
        return response;
      } catch (exception) { if (exception?.code) throw exception; throw b2Error(OPERATION_ERROR); }
    }
    function b2CurrentInput(fullData, capability) {
      let candidates;
      try { candidates = b2RecordCandidates(fullData); }
      catch (exception) { if (exception?.code === KEYGRAIN_TOTP_ERROR) return {invalid: true}; throw exception; }
      const candidate = candidates.find(item => item.recordIndex === capability.recordIndex
        && b2TupleEqual(item.tuple, capability.tuple));
      if (!candidate) throw b2Error("KEYGRAIN_STALE_OPERATION");
      const tuple = candidate.tuple;
      let secret = null;
      if (tuple.mode === "derived") {
        const descriptor = Object.getOwnPropertyDescriptor(fullData, "secret");
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")
          || typeof descriptor.value !== "string" || !descriptor.value) return {invalid: true};
        secret = descriptor.value;
      }
      return {secret, email: tuple.email, site: tuple.site, tuple, seedText: candidate.seedText};
    }
    function b2ConsumeCapability(token) {
      const now = b2OwnerNow();
      const snapshot = b2Snapshot();
      const capability = b2Capabilities.get(token);
      if (!capability) throw b2Error("KEYGRAIN_STALE_OPERATION");
      b2Capabilities.delete(token);
      if (snapshot.state !== "full") { b2ClearCapabilities(); throw b2Error("KEYGRAIN_EXPIRED"); }
      if (now >= capability.issuedAtMs + KEYGRAIN_TOTP_CAPABILITY_TTL_MS
        || capability.stateGeneration !== snapshot.stateGeneration
        || capability.authorizationGeneration !== snapshot.authorizationGeneration
        || capability.recordGeneration !== b2RecordGeneration) throw b2Error("KEYGRAIN_STALE_OPERATION");
      return capability;
    }
    function b2Check(handle, capability, step = null) {
      manager.checkSensitiveOperation(handle);
      const snapshot = b2Snapshot();
      const now = b2OwnerNow();
      if (snapshot.state !== "full" || snapshot.stateGeneration !== capability.stateGeneration
        || snapshot.authorizationGeneration !== capability.authorizationGeneration
        || capability.recordGeneration !== b2RecordGeneration) throw b2Error("KEYGRAIN_STALE_OPERATION");
      if (step !== null) {
        const currentStep = b2Step(now, capability.tuple.period);
        if (currentStep !== step && currentStep !== step + 1) throw b2Error("KEYGRAIN_STALE_OPERATION");
      }
      return now;
    }
    function b2OptionsCapture(fullData) { return {items: b2RecordCandidates(fullData)}; }
    async function b2OptionsOperation(sender, runtimeId, browser, extensionOrigin) {
      let handle = null, finalized = false, staged = [];
      const finish = (method, reason) => { if (finalized) return; finalized = true; manager[method](handle, reason); };
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        const snapshot = b2Snapshot();
        if (snapshot.state !== "full") throw b2Error("KEYGRAIN_EXPIRED");
        handle = manager.beginSensitiveOperation({capture: b2OptionsCapture});
        manager.checkSensitiveOperation(handle);
        const captured = manager.getSensitiveOperationInput(handle);
        const now = b2OwnerNow();
        const current = b2Snapshot();
        if (current.state !== "full" || current.stateGeneration !== snapshot.stateGeneration
          || current.authorizationGeneration !== snapshot.authorizationGeneration) throw b2Error("KEYGRAIN_STALE_OPERATION");
        const items = [];
        for (const candidate of captured.items) {
          const tuple = candidate.tuple;
          const token = b2Random();
          staged.push(token);
          b2Capabilities.set(token, Object.freeze({issuedAtMs: now, stateGeneration: current.stateGeneration,
            authorizationGeneration: current.authorizationGeneration, recordGeneration: b2RecordGeneration,
            recordIndex: candidate.recordIndex, tuple: b2CapabilityTuple(tuple)}));
          const item = {selectionToken: token, id: tuple.serviceId, site: tuple.site, name: tuple.name, email: tuple.email};
          b2Utf8(item.selectionToken, KEYGRAIN_TOTP_MAX_FIELD_UTF8, OPERATION_ERROR);
          b2Utf8(item.id, KEYGRAIN_TOTP_MAX_FIELD_UTF8); b2Utf8(item.site, KEYGRAIN_TOTP_MAX_FIELD_UTF8);
          if (item.name !== null) b2Utf8(item.name, KEYGRAIN_TOTP_MAX_FIELD_UTF8);
          b2Utf8(item.email, 254);
          items.push(item);
        }
        if (items.length > KEYGRAIN_TOTP_MAX_ITEMS) throw b2Error(KEYGRAIN_TOTP_ERROR);
        b2Check(handle, {stateGeneration: current.stateGeneration, authorizationGeneration: current.authorizationGeneration,
          recordGeneration: b2RecordGeneration, tuple: {period: 30}}, null);
        const response = b2Response({ok: true, result: {items}});
        manager.checkSensitiveOperation(handle);
        popupContext(sender, runtimeId, browser, extensionOrigin);
        finish("completeSensitiveOperation", "totp_options_complete");
        staged = [];
        return response;
      } catch (exception) {
        for (const token of staged) b2Capabilities.delete(token);
        staged = [];
        if (handle && !finalized) { try { finish("failSensitiveOperation", "totp_options_failure"); } catch (_) { finalized = true; } }
        if (!handle && exception?.code === "KEYGRAIN_STALE_OPERATION") return b2SafeFailure(KEYGRAIN_TOTP_ERROR);
        return b2SafeError(exception, OPERATION_ERROR);
      } finally { if (handle && !finalized) { try { finish("cancelSensitiveOperation", "totp_options_finally"); } catch (_) {} } }
    }
    async function b2GenerateOperation(capability) {
      let handle = null, finalized = false, seed = null;
      const finish = (method, reason) => { if (finalized) return; finalized = true; manager[method](handle, reason); };
      try {
        const snapshot = b2Snapshot();
        if (snapshot.state !== "full") throw b2Error("KEYGRAIN_EXPIRED");
        const issuedNow = b2OwnerNow();
        const capturedStep = b2Step(issuedNow, capability.tuple.period);
        handle = manager.beginSensitiveOperation({capture: data => b2CurrentInput(data, capability)});
        b2Check(handle, capability, capturedStep);
        const input = manager.getSensitiveOperationInput(handle);
        b2Check(handle, capability, capturedStep);
        if (!input || input.invalid === true) throw b2Error(KEYGRAIN_TOTP_ERROR);
        if (!b2TupleEqual(input.tuple, capability.tuple)) throw b2Error("KEYGRAIN_STALE_OPERATION");
        if (input.tuple.mode === "stored") {
          let binary;
          try { binary = root.atob(input.seedText); } catch (_) { throw b2Error(KEYGRAIN_TOTP_ERROR); }
          if (!binary || binary.length < 1 || binary.length > KEYGRAIN_TOTP_MAX_SEED_BYTES) throw b2Error(KEYGRAIN_TOTP_ERROR);
          seed = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) seed[i] = binary.charCodeAt(i);
        } else {
          if (typeof root.deriveTOTPSeed !== "function") throw b2Error(KEYGRAIN_TOTP_ERROR);
          seed = await root.deriveTOTPSeed(input.secret, input.email, input.site);
        }
        b2Check(handle, capability, capturedStep);
        if (typeof root.generateTOTP !== "function") throw b2Error(KEYGRAIN_TOTP_ERROR);
        const code = await root.generateTOTP(seed, Math.floor(issuedNow / 1000), {
          digits: capability.tuple.digits, period: capability.tuple.period, algorithm: capability.tuple.algorithm,
        });
        b2Check(handle, capability, capturedStep);
        if (typeof code !== "string" || !new RegExp(`^[0-9]{${capability.tuple.digits}}$`).test(code)
          || capability.tuple.digits > KEYGRAIN_TOTP_MAX_CODE_DIGITS) throw b2Error(KEYGRAIN_TOTP_ERROR);
        const response = b2Response({ok: true, result: {code}});
        b2Check(handle, capability, capturedStep);
        finish("completeSensitiveOperation", "totp_generate_complete");
        return response;
      } catch (exception) {
        if (handle && !finalized) { try { finish("failSensitiveOperation", "totp_generate_failure"); } catch (_) { finalized = true; } }
        return b2SafeError(exception, OPERATION_ERROR);
      } finally {
        if (seed && typeof seed.fill === "function") seed.fill(0);
        if (handle && !finalized) { try { finish("cancelSensitiveOperation", "totp_generate_finally"); } catch (_) {} }
      }
    }
    function b2OptionsRequest(value) { return b2Request(value, KEYGRAIN_TOTP_OPTIONS); }
    function b2GenerateRequest(value) { return b2Request(value, KEYGRAIN_TOTP_GENERATE); }
    function b2FillRequest(value) { return b2Request(value, KEYGRAIN_TOTP_FILL); }
    async function b2FillOperation(capability, adapter) {
      let handle = null, finalized = false, seed = null;
      const finish = (method, reason) => { if (finalized) return; finalized = true; manager[method](handle, reason); };
      try {
        const snapshot = b2Snapshot();
        if (snapshot.state !== "full") throw b2Error("KEYGRAIN_EXPIRED");
        const issuedNow = b2OwnerNow();
        const capturedStep = b2Step(issuedNow, capability.tuple.period);
        handle = manager.beginSensitiveOperation({capture: data => b2CurrentInput(data, capability)});
        b2Check(handle, capability, capturedStep);
        const input = manager.getSensitiveOperationInput(handle);
        b2Check(handle, capability, capturedStep);
        if (!input || input.invalid === true) throw b2Error(KEYGRAIN_TOTP_ERROR);
        if (!b2TupleEqual(input.tuple, capability.tuple)) throw b2Error("KEYGRAIN_STALE_OPERATION");
        if (!adapter || typeof adapter.getActiveTotpContext !== "function") throw b2Error(KEYGRAIN_TOTP_DELIVERY_ERROR);
        const context = passwordValidateContext(await adapter.getActiveTotpContext({site: input.site}), input.site);
        b2Check(handle, capability, capturedStep);
        let code;
        if (input.tuple.mode === "stored") {
          let binary;
          try { binary = root.atob(input.seedText); } catch (_) { throw b2Error(KEYGRAIN_TOTP_ERROR); }
          if (!binary || binary.length < 1 || binary.length > KEYGRAIN_TOTP_MAX_SEED_BYTES) throw b2Error(KEYGRAIN_TOTP_ERROR);
          seed = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) seed[i] = binary.charCodeAt(i);
        } else {
          if (typeof root.deriveTOTPSeed !== "function") throw b2Error(KEYGRAIN_TOTP_ERROR);
          seed = await root.deriveTOTPSeed(input.secret, input.email, input.site);
        }
        b2Check(handle, capability, capturedStep);
        if (typeof root.generateTOTP !== "function") throw b2Error(KEYGRAIN_TOTP_ERROR);
        code = await root.generateTOTP(seed, Math.floor(issuedNow / 1000), {
          digits: capability.tuple.digits, period: capability.tuple.period, algorithm: capability.tuple.algorithm,
        });
        b2Check(handle, capability, capturedStep);
        if (typeof code !== "string" || !new RegExp(`^[0-9]{${capability.tuple.digits}}$`).test(code)
          || capability.tuple.digits > KEYGRAIN_TOTP_MAX_CODE_DIGITS) throw b2Error(KEYGRAIN_TOTP_ERROR);
        const deliveryNonce = b2Random();
        b2Check(handle, capability, capturedStep);
        if (typeof adapter.proveTotpContext !== "function") throw b2Error(KEYGRAIN_TOTP_DELIVERY_ERROR);
        const proven = await adapter.proveTotpContext({context, deliveryNonce, site: input.site});
        b2Check(handle, capability, capturedStep);
        if (proven !== true) throw b2Error(CONTEXT_ERROR);
        if (typeof adapter.deliverTotp !== "function") throw b2Error(KEYGRAIN_TOTP_DELIVERY_ERROR);
        const delivery = await adapter.deliverTotp({context, deliveryNonce, code, site: input.site});
        b2Check(handle, capability, capturedStep);
        if (!b2PlainData(delivery) || Reflect.ownKeys(delivery).length !== 1
          || Reflect.ownKeys(delivery)[0] !== "codeFilled" || delivery.codeFilled !== true) {
          throw b2Error(KEYGRAIN_TOTP_DELIVERY_ERROR);
        }
        const response = b2Response({ok: true, result: {codeFilled: true}});
        b2Check(handle, capability, capturedStep);
        finish("completeSensitiveOperation", "totp_fill_complete");
        return response;
      } catch (exception) {
        if (handle && !finalized) { try { finish("failSensitiveOperation", "totp_fill_failure"); } catch (_) { finalized = true; } }
        return b2SafeError(exception, OPERATION_ERROR);
      } finally {
        if (seed && typeof seed.fill === "function") seed.fill(0);
        if (handle && !finalized) { try { finish("cancelSensitiveOperation", "totp_fill_finally"); } catch (_) {} }
      }
    }
    function b2FillDispatch(_sender, _runtimeId, _browser, _extensionOrigin, parsed) {
      const capability = b2ConsumeCapability(parsed.selectionToken);
      return b2FillOperation(capability, adapter);
    }
    function b2GenerateDispatch(_sender, _runtimeId, _browser, _extensionOrigin, parsed) {
      const capability = b2ConsumeCapability(parsed.selectionToken);
      return b2GenerateOperation(capability);
    }
    const b2Registry = Object.freeze({
      [KEYGRAIN_TOTP_OPTIONS]: Object.freeze({action: KEYGRAIN_TOTP_OPTIONS, requestValidator: b2OptionsRequest,
        senderPredicate: isTrustedExtensionPage, stateGate: "full", capture: b2OptionsCapture,
        outputSanitizer: b2Response, failureMapping: b2SafeError, sensitiveAwaitPolicy: "manager-and-owner-checks",
        finalizer: "completeSensitiveOperation|failSensitiveOperation|cancelSensitiveOperation",
        execute: b2OptionsOperation}),
      [KEYGRAIN_TOTP_GENERATE]: Object.freeze({action: KEYGRAIN_TOTP_GENERATE, requestValidator: b2GenerateRequest,
        senderPredicate: isTrustedExtensionPage, stateGate: "full", capture: b2CurrentInput,
        outputSanitizer: b2Response, failureMapping: b2SafeError, sensitiveAwaitPolicy: "manager-and-owner-checks",
        finalizer: "completeSensitiveOperation|failSensitiveOperation|cancelSensitiveOperation",
        execute: b2GenerateDispatch}),
      [KEYGRAIN_TOTP_FILL]: Object.freeze({action: KEYGRAIN_TOTP_FILL, requestValidator: b2FillRequest,
        senderPredicate: isTrustedExtensionPage, stateGate: "full", capture: b2CurrentInput,
        outputSanitizer: b2Response, failureMapping: b2SafeError, sensitiveAwaitPolicy: "manager-and-owner-checks",
        finalizer: "completeSensitiveOperation|failSensitiveOperation|cancelSensitiveOperation",
        execute: b2FillDispatch}),
    });

    const b3Capabilities = new Map();
    function b3Error(code) { const result = new Error(code); result.code = code; return result; }
    function b3SafeFailure(code) {
      const messages = {
        KEYGRAIN_AUTH_PROTOCOL_ERROR: "Invalid authentication request.",
        KEYGRAIN_CONTEXT_ERROR: "This action is not available from this context.",
        KEYGRAIN_OPERATION_ERROR: "The operation could not be completed.",
        KEYGRAIN_CONSUMER_MIGRATION_REQUIRED: "Update Keygrain to continue.",
        KEYGRAIN_EXPIRED: "Unlock is required.",
        KEYGRAIN_STALE_OPERATION: "The operation could not be completed.",
        KEYGRAIN_SSH_ERROR: "The SSH key could not be generated.",
        KEYGRAIN_WALLET_ERROR: "The wallet mnemonic could not be generated.",
      };
      return Object.freeze({ok: false, code, message: messages[code] || messages.KEYGRAIN_OPERATION_ERROR});
    }
    function b3SafeError(exception, fallback = "KEYGRAIN_OPERATION_ERROR") {
      const code = exception && typeof exception.code === "string" ? exception.code : fallback;
      return b3SafeFailure(new Set([
        AUTH_PROTOCOL_ERROR, CONTEXT_ERROR, OPERATION_ERROR, CONSUMER_MIGRATION_REQUIRED,
        "KEYGRAIN_EXPIRED", "KEYGRAIN_STALE_OPERATION", "KEYGRAIN_SSH_ERROR", KEYGRAIN_WALLET_ERROR,
      ]).has(code) ? code : fallback);
    }
    function b3PlainData(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      try { const prototype = Object.getPrototypeOf(value); return prototype === null || prototype === Object.prototype; }
      catch (_) { return false; }
    }
    function b3Own(value, key, code = "KEYGRAIN_SSH_ERROR") {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) throw b3Error(code);
      return descriptor.value;
    }
    function b3Utf8(value, max, code = "KEYGRAIN_SSH_ERROR") {
      if (typeof value !== "string") throw b3Error(code);
      let bytes;
      try { bytes = new TextEncoder().encode(value).byteLength; } catch (_) { throw b3Error(code); }
      if (bytes > max) throw b3Error(code);
      return bytes;
    }
    function b3ExactEnvelope(value, keys) {
      if (!b3PlainData(value)) throw b3Error(AUTH_PROTOCOL_ERROR);
      let ownKeys;
      try { ownKeys = Reflect.ownKeys(value); } catch (_) { throw b3Error(AUTH_PROTOCOL_ERROR); }
      if (ownKeys.length !== keys.length || ownKeys.some((key, index) => key !== keys[index])) throw b3Error(AUTH_PROTOCOL_ERROR);
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) throw b3Error(AUTH_PROTOCOL_ERROR);
      }
      return value;
    }
    function b3PopupContext(sender, runtimeId, browser, extensionOrigin) {
      if (!isTrustedExtensionPage(sender, runtimeId, null, browser, extensionOrigin)) throw b3Error(CONTEXT_ERROR);
      try {
        const path = new URL(sender.url).pathname;
        if (path !== "/popup.html" && path !== "/wallet-page.html") throw b3Error(CONTEXT_ERROR);
      }
      catch (exception) { if (exception?.code) throw exception; throw b3Error(CONTEXT_ERROR); }
    }
    function b3Request(value, action) {
      const optionsAction = action === KEYGRAIN_SSH_OPTIONS || action === KEYGRAIN_WALLET_OPTIONS;
      const keys = optionsAction ? ["action"] : ["action", "selectionToken"];
      b3ExactEnvelope(value, keys);
      if (value.action !== action) throw b3Error(AUTH_PROTOCOL_ERROR);
      if (!optionsAction) {
        if (typeof value.selectionToken !== "string" || !value.selectionToken) throw b3Error(AUTH_PROTOCOL_ERROR);
        b3Utf8(value.selectionToken, KEYGRAIN_B3_MAX_TOKEN_UTF8, AUTH_PROTOCOL_ERROR);
      }
      return value;
    }
    function b3Record(value) {
      if (!b3PlainData(value)) throw b3Error(KEYGRAIN_SSH_ERROR);
      const sshDescriptor = Object.getOwnPropertyDescriptor(value, "ssh");
      if (!sshDescriptor) return null;
      if (!sshDescriptor.enumerable || !Object.prototype.hasOwnProperty.call(sshDescriptor, "value")) throw b3Error(KEYGRAIN_SSH_ERROR);
      if (sshDescriptor.value === null) return null;
      const ssh = sshDescriptor.value;
      if (!b3PlainData(ssh)) throw b3Error(KEYGRAIN_SSH_ERROR);
      let sshKeys;
      try { sshKeys = Reflect.ownKeys(ssh); } catch (_) { throw b3Error(KEYGRAIN_SSH_ERROR); }
      if (sshKeys.some(key => typeof key !== "string" || !["key_name", "counter"].includes(key))) throw b3Error(KEYGRAIN_SSH_ERROR);
      for (const key of sshKeys) b3Own(ssh, key);
      if (!Object.prototype.hasOwnProperty.call(ssh, "key_name")) throw b3Error(KEYGRAIN_SSH_ERROR);
      const id = b3Own(value, "id");
      const siteRaw = b3Own(value, "site");
      const emailRaw = b3Own(value, "email");
      if (typeof id !== "string" || !id || typeof siteRaw !== "string" || !siteRaw
        || typeof emailRaw !== "string" || !emailRaw) throw b3Error(KEYGRAIN_SSH_ERROR);
      let site;
      try { site = root.normalizeSite(siteRaw); } catch (_) { throw b3Error(KEYGRAIN_SSH_ERROR); }
      if (typeof site !== "string" || !site) throw b3Error(KEYGRAIN_SSH_ERROR);
      const email = emailRaw.trim().toLowerCase();
      if (!email || /[\x00-\x1f\x7f]/.test(email)) throw b3Error(KEYGRAIN_SSH_ERROR);
      b3Utf8(id, KEYGRAIN_B3_MAX_FIELD_UTF8); b3Utf8(site, KEYGRAIN_B3_MAX_FIELD_UTF8); b3Utf8(email, KEYGRAIN_B3_MAX_EMAIL_UTF8);
      const nameDescriptor = Object.getOwnPropertyDescriptor(value, "name");
      let name = null;
      if (nameDescriptor) {
        if (!nameDescriptor.enumerable || !Object.prototype.hasOwnProperty.call(nameDescriptor, "value")) throw b3Error(KEYGRAIN_SSH_ERROR);
        name = nameDescriptor.value;
        if (name !== null) b3Utf8(name, KEYGRAIN_B3_MAX_FIELD_UTF8);
      }
      const keyName = b3Own(ssh, "key_name");
      if (typeof keyName !== "string" || !keyName || /\s/.test(keyName) || keyName.includes(":")) throw b3Error(KEYGRAIN_SSH_ERROR);
      if (/[\x00-\x1f\x7f]/.test(keyName)) throw b3Error(KEYGRAIN_SSH_ERROR);
      b3Utf8(keyName, KEYGRAIN_SSH_MAX_KEY_NAME_UTF8);
      const counter = Object.prototype.hasOwnProperty.call(ssh, "counter") ? b3Own(ssh, "counter") : 1;
      if (!Number.isSafeInteger(counter) || counter < 1 || counter > 2147483647) throw b3Error(KEYGRAIN_SSH_ERROR);
      return Object.freeze({
        recordIndex: -1,
        tuple: Object.freeze({family: "ssh", serviceId: id, site, email, keyName: keyName.toLowerCase(), counter, name}),
      });
    }
    function b3RecordCandidates(fullData) {
      if (!b3PlainData(fullData)) throw b3Error(KEYGRAIN_SSH_ERROR);
      const services = b3Own(fullData, "services");
      if (!Array.isArray(services)) throw b3Error(KEYGRAIN_SSH_ERROR);
      const result = [];
      for (let recordIndex = 0; recordIndex < services.length; recordIndex++) {
        const candidate = b3Record(services[recordIndex]);
        if (!candidate) continue;
        result.push(Object.freeze({recordIndex, tuple: candidate.tuple}));
      }
      if (result.length > KEYGRAIN_B3_MAX_ITEMS) throw b3Error(KEYGRAIN_SSH_ERROR);
      return result;
    }
    function b3TupleEqual(left, right) {
      return !!left && !!right && ["family", "serviceId", "site", "email", "keyName", "counter", "name"]
        .every(key => left[key] === right[key]);
    }
    function b3CapabilityTuple(tuple) {
      return Object.freeze({family: tuple.family, serviceId: tuple.serviceId, site: tuple.site, email: tuple.email,
        keyName: tuple.keyName, counter: tuple.counter, name: tuple.name});
    }
    function b3Random() {
      try {
        if (!root.crypto || typeof root.crypto.getRandomValues !== "function") throw b3Error(OPERATION_ERROR);
        const bytes = new Uint8Array(32);
        root.crypto.getRandomValues(bytes);
        let value = "";
        for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
        bytes.fill(0);
        return value;
      } catch (exception) { if (exception?.code) throw exception; throw b3Error(OPERATION_ERROR); }
    }
    function b3ClearCapabilities() { b3Capabilities.clear(); }
    function b3Snapshot() {
      try { return manager.snapshot(); }
      catch (_) { b3ClearCapabilities(); throw b3Error("KEYGRAIN_STALE_OPERATION"); }
    }
    function b3OwnerNow() { return b2OwnerNow(); }
    function b3Response(response) {
      try {
        if (new TextEncoder().encode(JSON.stringify(response)).byteLength > KEYGRAIN_B3_MAX_RESPONSE_BYTES) throw b3Error(OPERATION_ERROR);
        return response;
      } catch (exception) { if (exception?.code) throw exception; throw b3Error(OPERATION_ERROR); }
    }
    function b3ConsumeCapability(token) {
      const now = b3OwnerNow();
      const snapshot = b3Snapshot();
      const capability = b3Capabilities.get(token);
      if (!capability) throw b3Error("KEYGRAIN_STALE_OPERATION");
      b3Capabilities.delete(token);
      if (snapshot.state !== "full") { b3ClearCapabilities(); throw b3Error("KEYGRAIN_EXPIRED"); }
      if (now >= capability.issuedAt + KEYGRAIN_B3_CAPABILITY_TTL_MS
        || capability.stateGeneration !== snapshot.stateGeneration
        || capability.authorizationGeneration !== snapshot.authorizationGeneration
        || capability.recordGeneration !== b2RecordGeneration) throw b3Error("KEYGRAIN_STALE_OPERATION");
      return capability;
    }
    function b3Check(handle, capability) {
      manager.checkSensitiveOperation(handle);
      const snapshot = b3Snapshot();
      b3OwnerNow();
      if (snapshot.state !== "full" || snapshot.stateGeneration !== capability.stateGeneration
        || snapshot.authorizationGeneration !== capability.authorizationGeneration
        || capability.recordGeneration !== b2RecordGeneration) throw b3Error("KEYGRAIN_STALE_OPERATION");
    }
    function b3OptionsCapture(fullData) {
      try { return {items: b3RecordCandidates(fullData)}; }
      catch (exception) { if (exception?.code === KEYGRAIN_SSH_ERROR) return {invalid: true}; throw exception; }
    }
    async function b3OptionsOperation(sender, runtimeId, browser, extensionOrigin) {
      let handle = null, finalized = false, staged = [];
      const finish = (method, reason) => { if (finalized) return; finalized = true; manager[method](handle, reason); };
      try {
        b3PopupContext(sender, runtimeId, browser, extensionOrigin);
        const snapshot = b3Snapshot();
        if (snapshot.state !== "full") throw b3Error("KEYGRAIN_EXPIRED");
        handle = manager.beginSensitiveOperation({capture: b3OptionsCapture});
        manager.checkSensitiveOperation(handle);
        const captured = manager.getSensitiveOperationInput(handle);
        if (!captured || captured.invalid === true) throw b3Error(KEYGRAIN_SSH_ERROR);
        manager.checkSensitiveOperation(handle);
        const now = b3OwnerNow();
        const current = b3Snapshot();
        if (current.state !== "full" || current.stateGeneration !== snapshot.stateGeneration
          || current.authorizationGeneration !== snapshot.authorizationGeneration) throw b3Error("KEYGRAIN_STALE_OPERATION");
        const items = [];
        for (const candidate of captured.items) {
          const token = b3Random();
          staged.push(token);
          const tuple = candidate.tuple;
          b3Capabilities.set(token, Object.freeze({issuedAt: now, stateGeneration: current.stateGeneration,
            authorizationGeneration: current.authorizationGeneration, recordGeneration: b2RecordGeneration,
            recordIndex: candidate.recordIndex, tuple: b3CapabilityTuple(tuple)}));
          items.push({selectionToken: token, id: tuple.serviceId, site: tuple.site, name: tuple.name,
            email: tuple.email, keyName: tuple.keyName, counter: tuple.counter});
        }
        for (const item of items) {
          b3Utf8(item.selectionToken, KEYGRAIN_B3_MAX_TOKEN_UTF8, OPERATION_ERROR);
          b3Utf8(item.id, KEYGRAIN_B3_MAX_FIELD_UTF8); b3Utf8(item.site, KEYGRAIN_B3_MAX_FIELD_UTF8);
          if (item.name !== null) b3Utf8(item.name, KEYGRAIN_B3_MAX_FIELD_UTF8);
          b3Utf8(item.email, KEYGRAIN_B3_MAX_EMAIL_UTF8); b3Utf8(item.keyName, KEYGRAIN_SSH_MAX_KEY_NAME_UTF8);
        }
        manager.checkSensitiveOperation(handle);
        const after = b3Snapshot();
        if (after.stateGeneration !== current.stateGeneration || after.authorizationGeneration !== current.authorizationGeneration) throw b3Error("KEYGRAIN_STALE_OPERATION");
        const response = b3Response({ok: true, result: {items}});
        manager.checkSensitiveOperation(handle);
        b3PopupContext(sender, runtimeId, browser, extensionOrigin);
        manager.checkSensitiveOperation(handle);
        finish("completeSensitiveOperation", "ssh_options_complete");
        staged = [];
        return response;
      } catch (exception) {
        for (const token of staged) b3Capabilities.delete(token);
        staged = [];
        if (handle && !finalized) { try { finish("failSensitiveOperation", "ssh_options_failure"); } catch (_) { finalized = true; } }
        return b3SafeError(exception, OPERATION_ERROR);
      } finally { if (handle && !finalized) { try { finish("cancelSensitiveOperation", "ssh_options_finally"); } catch (_) {} } }
    }
    function b3CurrentInput(fullData, capability) {
      let candidates;
      try { candidates = b3RecordCandidates(fullData); }
      catch (exception) { if (exception?.code === KEYGRAIN_SSH_ERROR) return {invalid: true}; throw exception; }
      const candidate = candidates.find(item => item.recordIndex === capability.recordIndex && b3TupleEqual(item.tuple, capability.tuple));
      if (!candidate) throw b3Error("KEYGRAIN_STALE_OPERATION");
      const secret = b3Own(fullData, "secret");
      if (typeof secret !== "string" || !secret) throw b3Error(KEYGRAIN_SSH_ERROR);
      return {secret, email: candidate.tuple.email, keyName: candidate.tuple.keyName, counter: candidate.tuple.counter};
    }
    function b3AuthorizedOutput(value, publicKey, comment) {
      b3Utf8(value, KEYGRAIN_SSH_MAX_AUTHORIZED_KEYS_UTF8, KEYGRAIN_SSH_ERROR);
      const match = /^(ssh-ed25519) ([A-Za-z0-9+/]+={0,2}) ([^\x00-\x20\x7f]+)$/.exec(value);
      if (!match || match[3] !== comment || typeof root.atob !== "function") throw b3Error(KEYGRAIN_SSH_ERROR);
      let binary;
      try { binary = root.atob(match[2]); } catch (_) { throw b3Error(KEYGRAIN_SSH_ERROR); }
      if (binary.length !== 51 || binary.charCodeAt(0) !== 0 || binary.charCodeAt(1) !== 0
        || binary.charCodeAt(2) !== 0 || binary.charCodeAt(3) !== 11
        || binary.slice(4, 15) !== "ssh-ed25519" || binary.charCodeAt(15) !== 0
        || binary.charCodeAt(16) !== 0 || binary.charCodeAt(17) !== 0 || binary.charCodeAt(18) !== 32) {
        throw b3Error(KEYGRAIN_SSH_ERROR);
      }
      for (let index = 0; index < 32; index++) if (binary.charCodeAt(19 + index) !== publicKey[index]) throw b3Error(KEYGRAIN_SSH_ERROR);
      return value;
    }
    function b3PrivateOutput(value) {
      b3Utf8(value, KEYGRAIN_SSH_MAX_PRIVATE_KEY_PEM_UTF8, KEYGRAIN_SSH_ERROR);
      const prefix = "-----BEGIN OPENSSH PRIVATE KEY-----\n";
      const suffix = "-----END OPENSSH PRIVATE KEY-----\n";
      if (!value.startsWith(prefix) || !value.endsWith(suffix)) throw b3Error(KEYGRAIN_SSH_ERROR);
      const body = value.slice(prefix.length, -suffix.length);
      const lines = body.split("\n");
      if (lines.length < 2 || lines[lines.length - 1] !== "") throw b3Error(KEYGRAIN_SSH_ERROR);
      const encoded = lines.slice(0, -1).join("");
      if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || typeof root.atob !== "function") throw b3Error(KEYGRAIN_SSH_ERROR);
      let binary;
      try { binary = root.atob(encoded); } catch (_) { throw b3Error(KEYGRAIN_SSH_ERROR); }
      if (binary.length < 15 || binary.slice(0, 15) !== "openssh-key-v1\x00") throw b3Error(KEYGRAIN_SSH_ERROR);
      return value;
    }
    async function b3GenerateOperation(capability, sender, runtimeId, browser, extensionOrigin) {
      let handle = null, finalized = false, keypair = null;
      const finish = (method, reason) => { if (finalized) return; finalized = true; manager[method](handle, reason); };
      try {
        b3PopupContext(sender, runtimeId, browser, extensionOrigin);
        const snapshot = b3Snapshot();
        if (snapshot.state !== "full") throw b3Error("KEYGRAIN_EXPIRED");
        handle = manager.beginSensitiveOperation({capture: data => b3CurrentInput(data, capability)});
        b3Check(handle, capability);
        const input = manager.getSensitiveOperationInput(handle);
        b3Check(handle, capability);
        if (!input || input.invalid === true) throw b3Error(KEYGRAIN_SSH_ERROR);
        if (typeof root.deriveSshKeypair !== "function" || typeof root.formatAuthorizedKeys !== "function"
          || typeof root.formatOpensshPrivateKey !== "function") throw b3Error(KEYGRAIN_SSH_ERROR);
        keypair = await root.deriveSshKeypair(input.secret, input.email, {keyName: input.keyName, counter: input.counter});
        b3Check(handle, capability);
        if (!keypair || !(keypair.seed instanceof Uint8Array) || keypair.seed.length !== 32
          || !(keypair.publicKey instanceof Uint8Array) || keypair.publicKey.length !== 32) throw b3Error(KEYGRAIN_SSH_ERROR);
        const comment = input.email + ":" + input.keyName;
        const authorizedKeys = root.formatAuthorizedKeys(keypair.publicKey, comment);
        b3Check(handle, capability);
        const privateKeyPem = await root.formatOpensshPrivateKey(keypair.seed, keypair.publicKey, comment);
        b3Check(handle, capability);
        b3AuthorizedOutput(authorizedKeys, keypair.publicKey, comment);
        b3PrivateOutput(privateKeyPem);
        const response = b3Response({ok: true, result: {authorizedKeys, privateKeyPem}});
        b3Check(handle, capability);
        b3PopupContext(sender, runtimeId, browser, extensionOrigin);
        finish("completeSensitiveOperation", "ssh_generate_complete");
        return response;
      } catch (exception) {
        if (handle && !finalized) { try { finish("failSensitiveOperation", "ssh_generate_failure"); } catch (_) { finalized = true; } }
        return b3SafeError(exception, OPERATION_ERROR);
      } finally {
        if (keypair?.seed instanceof Uint8Array) keypair.seed.fill(0);
        if (keypair?.publicKey instanceof Uint8Array) keypair.publicKey.fill(0);
        if (handle && !finalized) { try { finish("cancelSensitiveOperation", "ssh_generate_finally"); } catch (_) {} }
      }
    }
    const b3Registry = Object.freeze({
      [KEYGRAIN_SSH_OPTIONS]: Object.freeze({action: KEYGRAIN_SSH_OPTIONS, requestValidator: value => b3Request(value, KEYGRAIN_SSH_OPTIONS), execute: b3OptionsOperation}),
      [KEYGRAIN_SSH_GENERATE]: Object.freeze({action: KEYGRAIN_SSH_GENERATE, requestValidator: value => b3Request(value, KEYGRAIN_SSH_GENERATE), execute: (sender, runtimeId, browser, extensionOrigin, parsed) => b3GenerateOperation(b3ConsumeCapability(parsed.selectionToken), sender, runtimeId, browser, extensionOrigin)}),
    });

    const walletCapabilities = new Map();
    const WALLET_KEYS = Object.freeze(["wallet_name", "chain", "counter", "email", "mode", "created_at", "updated_at", "notes"]);
    const WALLET_REQUIRED_KEYS = Object.freeze(["wallet_name", "chain", "counter", "email"]);
    const WALLET_METADATA_KEYS = new Set(["created_at", "updated_at", "notes"]);
    const WALLET_SUPPORTED_CHAINS = new Set([
      "bitcoin", "ethereum", "solana", "litecoin", "dogecoin",
      "bitcoin-testnet", "polkadot", "cosmos", "avalanche",
    ]);

    function walletClearCapabilities() { walletCapabilities.clear(); }
    function walletRejectProxy(value) {
      if (!root || typeof root.structuredClone !== "function") walletError();
      try { root.structuredClone(value); } catch (_) { walletError(); }
    }
    function walletError(code = KEYGRAIN_WALLET_ERROR) { throw b3Error(code); }
    function walletOwn(value, key) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) walletError();
      return descriptor.value;
    }
    function walletFieldUtf8(value, max = KEYGRAIN_B3_MAX_FIELD_UTF8) {
      if (typeof value !== "string") walletError();
      try {
        if (new TextEncoder().encode(value).byteLength > max) walletError();
      } catch (_) { walletError(); }
      return value;
    }
    function walletExactEntryKeys(value) {
      let keys;
      try { keys = Reflect.ownKeys(value); } catch (_) { walletError(); }
      if (keys.some(key => typeof key !== "string" || !WALLET_KEYS.includes(key))) walletError();
      let expectedIndex = 0;
      for (const key of keys) {
        while (expectedIndex < WALLET_KEYS.length && WALLET_KEYS[expectedIndex] !== key) expectedIndex++;
        if (expectedIndex >= WALLET_KEYS.length) walletError();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) walletError();
        expectedIndex++;
      }
      for (const key of WALLET_REQUIRED_KEYS) if (!Object.prototype.hasOwnProperty.call(value, key)) walletError();
    }
    function walletCanonicalRecord(value) {
      if (!b3PlainData(value)) walletError();
      walletExactEntryKeys(value);
      const walletNameRaw = walletOwn(value, "wallet_name");
      const chainRaw = walletOwn(value, "chain");
      const counter = walletOwn(value, "counter");
      const emailRaw = walletOwn(value, "email");
      if (typeof walletNameRaw !== "string" || !walletNameRaw) walletError();
      const walletName = walletNameRaw.toLowerCase();
      if (!walletName || !/^[a-z0-9-]+$/.test(walletName)) walletError();
      walletFieldUtf8(walletName, KEYGRAIN_WALLET_MAX_NAME_UTF8);
      if (typeof chainRaw !== "string" || !chainRaw) walletError();
      const chain = chainRaw.toLowerCase();
      if (!WALLET_SUPPORTED_CHAINS.has(chain)) walletError();
      if (!Number.isSafeInteger(counter) || counter < 1 || counter > 0x7fffffff) walletError();
      if (typeof emailRaw !== "string") walletError();
      const email = emailRaw.trim().toLowerCase();
      if (!email || !/^\S+@\S+$/.test(email) || /[\x00-\x1f\x7f:]/.test(email)) walletError();
      walletFieldUtf8(email, KEYGRAIN_B3_MAX_EMAIL_UTF8);
      if (Object.prototype.hasOwnProperty.call(value, "mode") && walletOwn(value, "mode") !== "keygrain") walletError();
      for (const key of WALLET_METADATA_KEYS) {
        if (Object.prototype.hasOwnProperty.call(value, key)) walletFieldUtf8(walletOwn(value, key));
      }
      return Object.freeze({walletName, chain, counter, email});
    }
    function walletRecordCandidates(fullData) {
      if (!b3PlainData(fullData)) walletError();
      const descriptor = Object.getOwnPropertyDescriptor(fullData, "wallets");
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")
        || !Array.isArray(descriptor.value) || descriptor.value.length > KEYGRAIN_B3_MAX_ITEMS) walletError();
      walletRejectProxy(descriptor.value);
      const result = [];
      for (const entry of descriptor.value) result.push(walletCanonicalRecord(entry));
      return result;
    }
    function walletTupleEqual(left, right) {
      return !!left && !!right && ["walletName", "chain", "counter", "email"].every(key => left[key] === right[key]);
    }
    function walletCapabilityTuple(tuple) {
      return Object.freeze({family: "wallet", walletName: tuple.walletName, chain: tuple.chain,
        counter: tuple.counter, email: tuple.email});
    }
    function walletResponse(response) {
      try {
        if (new TextEncoder().encode(JSON.stringify(response)).byteLength > KEYGRAIN_B3_MAX_RESPONSE_BYTES) walletError(OPERATION_ERROR);
        return response;
      } catch (exception) {
        if (exception?.code) throw exception;
        walletError(OPERATION_ERROR);
      }
    }
    function walletConsumeCapability(token) {
      const now = b3OwnerNow();
      const snapshot = b3Snapshot();
      const capability = walletCapabilities.get(token);
      if (!capability) walletError("KEYGRAIN_STALE_OPERATION");
      walletCapabilities.delete(token);
      if (snapshot.state !== "full") { walletClearCapabilities(); walletError("KEYGRAIN_EXPIRED"); }
      if (capability.family !== "wallet" || now >= capability.issuedAt + KEYGRAIN_B3_CAPABILITY_TTL_MS
        || capability.stateGeneration !== snapshot.stateGeneration
        || capability.authorizationGeneration !== snapshot.authorizationGeneration
        || capability.recordGeneration !== b2RecordGeneration) walletError("KEYGRAIN_STALE_OPERATION");
      return capability;
    }
    function walletCheck(handle, capability) {
      manager.checkSensitiveOperation(handle);
      const snapshot = b3Snapshot();
      b3OwnerNow();
      if (snapshot.state !== "full" || snapshot.stateGeneration !== capability.stateGeneration
        || snapshot.authorizationGeneration !== capability.authorizationGeneration
        || capability.recordGeneration !== b2RecordGeneration) walletError("KEYGRAIN_STALE_OPERATION");
    }
    function walletOptionsCapture(fullData) {
      try { return {items: walletRecordCandidates(fullData)}; }
      catch (exception) { if (exception?.code === KEYGRAIN_WALLET_ERROR) return {invalid: true}; throw exception; }
    }
    async function walletOptionsOperation(sender, runtimeId, browser, extensionOrigin) {
      let handle = null, finalized = false, staged = [];
      const finish = (method, reason) => { if (finalized) return; finalized = true; manager[method](handle, reason); };
      try {
        b3PopupContext(sender, runtimeId, browser, extensionOrigin);
        const snapshot = b3Snapshot();
        if (snapshot.state !== "full") walletError("KEYGRAIN_EXPIRED");
        handle = manager.beginSensitiveOperation({capture: walletOptionsCapture});
        manager.checkSensitiveOperation(handle);
        const captured = manager.getSensitiveOperationInput(handle);
        if (!captured || captured.invalid === true) walletError();
        manager.checkSensitiveOperation(handle);
        const now = b3OwnerNow();
        const current = b3Snapshot();
        if (current.state !== "full" || current.stateGeneration !== snapshot.stateGeneration
          || current.authorizationGeneration !== snapshot.authorizationGeneration) walletError("KEYGRAIN_STALE_OPERATION");
        const items = [];
        for (const tuple of captured.items) {
          const token = b3Random();
          staged.push(token);
          walletCapabilities.set(token, Object.freeze({issuedAt: now, stateGeneration: current.stateGeneration,
            authorizationGeneration: current.authorizationGeneration, recordGeneration: b2RecordGeneration,
            ...walletCapabilityTuple(tuple)}));
          const item = {selectionToken: token, walletName: tuple.walletName, chain: tuple.chain, email: tuple.email};
          walletFieldUtf8(item.selectionToken, KEYGRAIN_B3_MAX_TOKEN_UTF8);
          walletFieldUtf8(item.walletName, KEYGRAIN_WALLET_MAX_NAME_UTF8);
          walletFieldUtf8(item.email, KEYGRAIN_B3_MAX_EMAIL_UTF8);
          items.push(item);
        }
        walletCheck(handle, {stateGeneration: current.stateGeneration, authorizationGeneration: current.authorizationGeneration,
          recordGeneration: b2RecordGeneration});
        const response = walletResponse({ok: true, result: {items}});
        walletCheck(handle, {stateGeneration: current.stateGeneration, authorizationGeneration: current.authorizationGeneration,
          recordGeneration: b2RecordGeneration});
        b3PopupContext(sender, runtimeId, browser, extensionOrigin);
        finish("completeSensitiveOperation", "wallet_options_complete");
        staged = [];
        return response;
      } catch (exception) {
        for (const token of staged) walletCapabilities.delete(token);
        staged = [];
        if (handle && !finalized) { try { finish("failSensitiveOperation", "wallet_options_failure"); } catch (_) { finalized = true; } }
        return b3SafeError(exception, OPERATION_ERROR);
      } finally {
        if (handle && !finalized) { try { finish("cancelSensitiveOperation", "wallet_options_finally"); } catch (_) {} }
      }
    }
    function walletCurrentInput(fullData, capability) {
      let candidates;
      try { candidates = walletRecordCandidates(fullData); }
      catch (exception) { if (exception?.code === KEYGRAIN_WALLET_ERROR) return {invalid: true}; throw exception; }
      const tuple = candidates.find(candidate => walletTupleEqual(candidate, capability));
      if (!tuple) walletError("KEYGRAIN_STALE_OPERATION");
      const secret = walletOwn(fullData, "secret");
      if (typeof secret !== "string" || !secret) walletError(KEYGRAIN_WALLET_ERROR);
      return {secret, email: tuple.email, walletName: tuple.walletName, chain: tuple.chain, counter: tuple.counter};
    }
    function walletMnemonicOutput(value) {
      if (typeof value !== "string") walletError();
      let wordlist;
      try { wordlist = typeof BIP39_WORDLIST === "undefined" ? null : BIP39_WORDLIST; } catch (_) { wordlist = null; }
      if (!Array.isArray(wordlist) || wordlist.length !== 2048) walletError();
      const words = value.split(" ");
      if (words.length !== 24 || words.some(word => !word || wordlist.indexOf(word) < 0)) walletError();
      try {
        if (new TextEncoder().encode(value).byteLength > KEYGRAIN_WALLET_MAX_MNEMONIC_UTF8) walletError();
      } catch (_) { walletError(); }
      return value;
    }
    async function walletGenerateOperation(capability, sender, runtimeId, browser, extensionOrigin) {
      let handle = null, finalized = false;
      const finish = (method, reason) => { if (finalized) return; finalized = true; manager[method](handle, reason); };
      try {
        b3PopupContext(sender, runtimeId, browser, extensionOrigin);
        const snapshot = b3Snapshot();
        if (snapshot.state !== "full") walletError("KEYGRAIN_EXPIRED");
        handle = manager.beginSensitiveOperation({capture: data => walletCurrentInput(data, capability)});
        walletCheck(handle, capability);
        const input = manager.getSensitiveOperationInput(handle);
        walletCheck(handle, capability);
        if (!input || input.invalid === true) walletError();
        if (typeof root.deriveWalletMnemonic !== "function") walletError();
        walletCheck(handle, capability);
        let mnemonic;
        try {
          mnemonic = await root.deriveWalletMnemonic(input.secret, input.email, {
            walletName: input.walletName, chain: input.chain, counter: input.counter,
          });
        } catch (_) { walletError(); }
        walletCheck(handle, capability);
        const boundedMnemonic = walletMnemonicOutput(mnemonic);
        walletCheck(handle, capability);
        const response = walletResponse({ok: true, result: {mnemonic: boundedMnemonic}});
        walletCheck(handle, capability);
        b3PopupContext(sender, runtimeId, browser, extensionOrigin);
        finish("completeSensitiveOperation", "wallet_generate_complete");
        return response;
      } catch (exception) {
        if (handle && !finalized) { try { finish("failSensitiveOperation", "wallet_generate_failure"); } catch (_) { finalized = true; } }
        return b3SafeError(exception, OPERATION_ERROR);
      } finally {
        if (handle && !finalized) { try { finish("cancelSensitiveOperation", "wallet_generate_finally"); } catch (_) {} }
      }
    }
    const walletRegistry = Object.freeze({
      [KEYGRAIN_WALLET_OPTIONS]: Object.freeze({action: KEYGRAIN_WALLET_OPTIONS,
        requestValidator: value => b3Request(value, KEYGRAIN_WALLET_OPTIONS),
        execute: walletOptionsOperation}),
      [KEYGRAIN_WALLET_GENERATE]: Object.freeze({action: KEYGRAIN_WALLET_GENERATE,
        requestValidator: value => b3Request(value, KEYGRAIN_WALLET_GENERATE),
        execute: (sender, runtimeId, browser, extensionOrigin, parsed) =>
          walletGenerateOperation(walletConsumeCapability(parsed.selectionToken), sender, runtimeId, browser, extensionOrigin)}),
    });

    const passwordCapabilities = new Map();
    let passwordLastOwnerNow = null;

    function passwordClearCapabilities() {
      passwordCapabilities.clear();
    }

    function passwordOwnerNow() {
      let now;
      try { now = ownerClock(); } catch (_) { passwordClearCapabilities(); passwordError("KEYGRAIN_STALE_OPERATION"); }
      if (!Number.isFinite(now)) { passwordClearCapabilities(); passwordError("KEYGRAIN_STALE_OPERATION"); }
      if (passwordLastOwnerNow !== null && now < passwordLastOwnerNow) {
        passwordClearCapabilities();
        try { manager.snapshot(); } catch (_) {}
        passwordError("KEYGRAIN_STALE_OPERATION");
      }
      passwordLastOwnerNow = now;
      return now;
    }

    function passwordSnapshot() {
      try { return manager.snapshot(); }
      catch (_) { passwordClearCapabilities(); passwordError("KEYGRAIN_STALE_OPERATION"); }
    }

    function passwordRandom() {
      try {
        if (!root.crypto || typeof root.crypto.getRandomValues !== "function") passwordError("KEYGRAIN_OPERATION_ERROR");
        const bytes = new Uint8Array(32);
        root.crypto.getRandomValues(bytes);
        let value = "";
        for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
        bytes.fill(0);
        return value;
      } catch (exception) {
        if (exception?.code) throw exception;
        passwordError("KEYGRAIN_OPERATION_ERROR");
      }
    }

    function passwordRecordCandidates(fullData) {
      if (!passwordOwnData(fullData) || !Array.isArray(fullData.services)) passwordError("KEYGRAIN_DERIVATION_ERROR");
      const candidates = [];
      for (const record of fullData.services) {
        let tuple;
        try { tuple = passwordCanonicalRecord(record); }
        catch (exception) { if (exception?.code === "KEYGRAIN_DERIVATION_ERROR") throw exception; passwordError("KEYGRAIN_DERIVATION_ERROR"); }
        if (tuple) candidates.push(tuple);
      }
      if (candidates.length > KEYGRAIN_PASSWORD_MAX_ITEMS) passwordError("KEYGRAIN_DERIVATION_ERROR");
      return candidates;
    }

    function passwordOptionsCapture(fullData) {
      return {items: passwordRecordCandidates(fullData)};
    }

    function passwordInputCapture(fullData, capability) {
      if (!passwordOwnData(fullData) || typeof fullData.secret !== "string" || !fullData.secret) {
        passwordError("KEYGRAIN_DERIVATION_ERROR");
      }
      const candidates = passwordRecordCandidates(fullData);
      const tuple = candidates.find(candidate => passwordTupleEqual(candidate, capability.tuple));
      if (!tuple) passwordError("KEYGRAIN_STALE_OPERATION");
      return {
        secret: fullData.secret, email: tuple.email, site: tuple.site,
        serviceId: tuple.serviceId, bound: tuple,
      };
    }

    function passwordConsumeCapability(token) {
      const now = passwordOwnerNow();
      const snapshot = passwordSnapshot();
      const capability = passwordCapabilities.get(token);
      if (!capability) passwordError("KEYGRAIN_STALE_OPERATION");
      passwordCapabilities.delete(token);
      if (snapshot.state !== "full") { passwordClearCapabilities(); passwordError("KEYGRAIN_EXPIRED"); }
      if (now >= capability.issuedAt + KEYGRAIN_PASSWORD_SELECTION_TTL_MS
        || capability.stateGeneration !== snapshot.stateGeneration
        || capability.authorizationGeneration !== snapshot.authorizationGeneration) {
        passwordError("KEYGRAIN_STALE_OPERATION");
      }
      return capability;
    }

    function passwordValidateContext(context, site) {
      if (!passwordOwnData(context) || !Number.isInteger(context.tabId) || context.tabId < 0
        || !Number.isInteger(context.frameId) || context.frameId < 0 || typeof context.origin !== "string") {
        passwordError("KEYGRAIN_CONTEXT_ERROR");
      }
      let parsed;
      try { parsed = new URL(context.origin); } catch (_) { passwordError("KEYGRAIN_CONTEXT_ERROR"); }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") passwordError("KEYGRAIN_CONTEXT_ERROR");
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (!host || !site || !root.KeygrainAutofill
        || typeof root.KeygrainAutofill.isSafeMatchingSite !== "function") passwordError("KEYGRAIN_CONTEXT_ERROR");
      let safe;
      try { safe = root.KeygrainAutofill.isSafeMatchingSite(site, host); } catch (_) { safe = false; }
      if (!safe || (host !== site && !host.endsWith("." + site))) passwordError("KEYGRAIN_CONTEXT_ERROR");
      return Object.freeze({tabId: context.tabId, frameId: context.frameId, origin: parsed.origin, documentId: context.documentId, nonce: context.nonce});
    }

    async function passwordSensitiveOperation(request, capability, fill) {
      let handle = null;
      let finalized = false;
      const check = () => manager.checkSensitiveOperation(handle);
      const finish = (method, reason) => {
        if (finalized) return;
        finalized = true;
        try { manager[method](handle, reason); } catch (exception) { if (method !== "cancelSensitiveOperation") throw exception; }
      };
      try {
        const snapshot = passwordSnapshot();
        if (snapshot.state !== "full") throw error("KEYGRAIN_EXPIRED");
        handle = manager.beginSensitiveOperation({capture: data => passwordInputCapture(data, capability)});
        check();
        const input = manager.getSensitiveOperationInput(handle);
        check();
        if (!passwordTupleEqual(input.bound, capability.tuple)) throw error("KEYGRAIN_STALE_OPERATION");
        let context = null;
        if (fill) {
          if (typeof adapter.getActivePasswordContext !== "function") throw error("KEYGRAIN_CONTEXT_ERROR");
          context = passwordValidateContext(await adapter.getActivePasswordContext({site: input.site}), input.site);
          check();
        }
        if (typeof root.derivePassword !== "function") throw error("KEYGRAIN_DERIVATION_ERROR");
        const password = await root.derivePassword(input.secret, input.email, {
          site: input.site, length: request.length, symbols: request.symbols,
          counter: request.counter, policy: request.policy,
        });
        check();
        const boundedPassword = passwordOutput(password, request.length, request.symbols);
        if (!fill) {
          const response = passwordResponse({ok: true, result: {password: boundedPassword}});
          finish("completeSensitiveOperation", "password_generate_complete");
          return response;
        }
        const deliveryNonce = passwordRandom();
        check();
        if (typeof adapter.provePasswordContext !== "function") throw error("KEYGRAIN_CONTEXT_ERROR");
        const proven = await adapter.provePasswordContext({context, deliveryNonce, site: input.site});
        check();
        if (proven !== true) throw error("KEYGRAIN_CONTEXT_ERROR");
        const deliveredEmail = request.fillEmail ? input.email : null;
        passwordUtf8(input.email, KEYGRAIN_PASSWORD_MAX_EMAIL_UTF8);
        check();
        if (typeof adapter.deliverPassword !== "function") throw error("KEYGRAIN_FILL_DELIVERY_ERROR");
        const delivery = await adapter.deliverPassword({context, deliveryNonce, password: boundedPassword, email: deliveredEmail});
        check();
        if (!passwordOwnData(delivery) || delivery.passwordFilled !== true || typeof delivery.emailFilled !== "boolean") {
          throw error("KEYGRAIN_FILL_DELIVERY_ERROR");
        }
        const response = passwordResponse({ok: true, result: {passwordFilled: delivery.passwordFilled, emailFilled: delivery.emailFilled}});
        finish("completeSensitiveOperation", "password_fill_complete");
        return response;
      } catch (exception) {
        if (handle && !finalized) {
          try { finish("failSensitiveOperation", "password_failure"); }
          catch (_) { finalized = true; }
        }
        const code = exception?.code;
        if (["KEYGRAIN_CONTEXT_ERROR", "KEYGRAIN_FILL_DELIVERY_ERROR", "KEYGRAIN_EXPIRED", "KEYGRAIN_STALE_OPERATION", "KEYGRAIN_DERIVATION_ERROR", "KEYGRAIN_OPERATION_ERROR", AUTH_PROTOCOL_ERROR].includes(code)) {
          return safeFailure(code);
        }
        return safeFailure(OPERATION_ERROR);
      } finally {
        if (handle && !finalized) {
          try { finish("cancelSensitiveOperation", "password_finally"); } catch (_) {}
        }
      }
    }

    async function passwordOptionsOperation(sender, runtimeId, browser, extensionOrigin) {
      let handle = null;
      let finalized = false;
      let staged = [];
      const finish = (method, reason) => {
        if (finalized) return;
        finalized = true;
        try { manager[method](handle, reason); } catch (exception) { if (method !== "cancelSensitiveOperation") throw exception; }
      };
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        const snapshot = passwordSnapshot();
        if (snapshot.state !== "full") throw error("KEYGRAIN_EXPIRED");
        handle = manager.beginSensitiveOperation({capture: passwordOptionsCapture});
        manager.checkSensitiveOperation(handle);
        const captured = manager.getSensitiveOperationInput(handle);
        manager.checkSensitiveOperation(handle);
        const now = passwordOwnerNow();
        const current = passwordSnapshot();
        if (current.state !== "full" || current.stateGeneration !== snapshot.stateGeneration
          || current.authorizationGeneration !== snapshot.authorizationGeneration) throw error("KEYGRAIN_STALE_OPERATION");
        const items = [];
        for (const tuple of captured.items) {
          const token = passwordRandom();
          staged.push(token);
          passwordCapabilities.set(token, Object.freeze({
            issuedAt: now, stateGeneration: current.stateGeneration,
            authorizationGeneration: current.authorizationGeneration, tuple,
          }));
          const item = {selectionToken: token, id: tuple.serviceId, site: tuple.site, name: tuple.name, email: tuple.email};
          for (const key of ["id", "site", "name", "email"]) {
            if (item[key] !== null) passwordUtf8(item[key], key === "email" ? KEYGRAIN_PASSWORD_MAX_EMAIL_UTF8 : KEYGRAIN_PASSWORD_MAX_FIELD_UTF8);
          }
          items.push(item);
        }
        if (items.length > KEYGRAIN_PASSWORD_MAX_ITEMS) throw error("KEYGRAIN_DERIVATION_ERROR");
        manager.checkSensitiveOperation(handle);
        const after = passwordSnapshot();
        if (after.stateGeneration !== current.stateGeneration || after.authorizationGeneration !== current.authorizationGeneration) {
          throw error("KEYGRAIN_STALE_OPERATION");
        }
        const response = passwordResponse({ok: true, result: {items}});
        manager.checkSensitiveOperation(handle);
        popupContext(sender, runtimeId, browser, extensionOrigin);
        manager.checkSensitiveOperation(handle);
        finish("completeSensitiveOperation", "password_options_complete");
        staged = [];
        return response;
      } catch (exception) {
        for (const token of staged) passwordCapabilities.delete(token);
        staged = [];
        if (handle && !finalized) {
          try { finish("failSensitiveOperation", "password_options_failure"); }
          catch (_) { finalized = true; }
        }
        const code = exception?.code;
        if (["KEYGRAIN_CONTEXT_ERROR", "KEYGRAIN_EXPIRED", "KEYGRAIN_STALE_OPERATION", "KEYGRAIN_DERIVATION_ERROR", "KEYGRAIN_OPERATION_ERROR", AUTH_PROTOCOL_ERROR].includes(code)) return safeFailure(code);
        return safeFailure(OPERATION_ERROR);
      } finally {
        if (handle && !finalized) {
          try { finish("cancelSensitiveOperation", "password_options_finally"); } catch (_) {}
        }
      }
    }

    const KEYGRAIN_POPUP_SELECTION_REQUEST_KEYS = Object.freeze(["action"]);
    const KEYGRAIN_POPUP_DETAIL_REQUEST_KEYS = Object.freeze(["action", "detailSelectionToken"]);
    const KEYGRAIN_POPUP_EDIT_REQUEST_KEYS = Object.freeze(["action", "editToken", "patch"]);
    const KEYGRAIN_POPUP_ADD_REQUEST_KEYS = Object.freeze(["action", "patch"]);
    const KEYGRAIN_POPUP_DELETE_REQUEST_KEYS = Object.freeze(["action", "id"]);
    const KEYGRAIN_POPUP_EDIT_PATCH_KEYS = Object.freeze([
      "name", "site", "email", "length", "symbols", "counter", "characterPolicyPresent", "characterPolicy",
    ]);
    const KEYGRAIN_POPUP_DETAIL_KEYS = Object.freeze([
      "id", "site", "name", "email", "length", "symbols", "counter",
      "characterPolicyPresent", "characterPolicy", "hasTotp", "sshKeyName", "totp", "ssh",
    ]);

    function popupNewError(code) { const result = new Error(code); result.code = code; return result; }
    function popupNewSafeError(exception, fallback = OPERATION_ERROR) {
      const code = exception?.code;
      if ([AUTH_PROTOCOL_ERROR, CONTEXT_ERROR, OPERATION_ERROR, "KEYGRAIN_EXPIRED", "KEYGRAIN_STALE_OPERATION"].includes(code)) {
        return safeFailure(code);
      }
      return safeFailure(fallback);
    }
    function popupExactEnvelope(value, keys) {
      if (!ownData(value)) throw popupNewError(AUTH_PROTOCOL_ERROR);
      let ownKeys;
      try { ownKeys = Reflect.ownKeys(value); } catch (_) { throw popupNewError(AUTH_PROTOCOL_ERROR); }
      if (ownKeys.length !== keys.length || ownKeys.some((key, index) => key !== keys[index])) {
        throw popupNewError(AUTH_PROTOCOL_ERROR);
      }
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
          throw popupNewError(AUTH_PROTOCOL_ERROR);
        }
      }
      return value;
    }
    function popupCapabilityText(value, code = OPERATION_ERROR) {
      if (typeof value !== "string" || !value) throw popupNewError(code);
      try {
        if (new TextEncoder().encode(value).byteLength > KEYGRAIN_POPUP_MAX_FIELD_UTF8) throw popupNewError(code);
      } catch (exception) {
        if (exception?.code) throw exception;
        throw popupNewError(code);
      }
      return value;
    }
    function popupNullableText(record, key) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor) return null;
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) throw popupNewError(OPERATION_ERROR);
      if (descriptor.value !== null && typeof descriptor.value !== "string") throw popupNewError(OPERATION_ERROR);
      if (descriptor.value !== null) popupCapabilityText(descriptor.value);
      return descriptor.value;
    }
    function popupRequiredText(record, key) {
      const value = popupNullableText(record, key);
      if (typeof value !== "string" || !value) throw popupNewError(OPERATION_ERROR);
      return value;
    }
    function popupPrintableSymbols(value, code = OPERATION_ERROR) {
      if (typeof value !== "string" || value.length < 1 || value.length > KEYGRAIN_PASSWORD_MAX_SYMBOLS) throw popupNewError(code);
      for (let index = 0; index < value.length; index++) {
        const charCode = value.charCodeAt(index);
        if (charCode < 0x21 || charCode > 0x7e) throw popupNewError(code);
      }
      if (KEYGRAIN_PASSWORD_UPPER.length + KEYGRAIN_PASSWORD_LOWER.length + KEYGRAIN_PASSWORD_DIGITS.length + value.length > 256) {
        throw popupNewError(code);
      }
      popupCapabilityText(value, code);
      return value;
    }
    function popupReadPolicy(record) {
      const descriptor = Object.getOwnPropertyDescriptor(record, "character_policy");
      if (!descriptor) return {characterPolicyPresent: false, characterPolicy: null};
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")
        || descriptor.value !== KEYGRAIN_PASSWORD_DEFAULT_POLICY) throw popupNewError(OPERATION_ERROR);
      popupCapabilityText(descriptor.value);
      return {characterPolicyPresent: true, characterPolicy: descriptor.value};
    }
    function popupReadFeatureIndicators(record) {
      const totpDescriptor = Object.getOwnPropertyDescriptor(record, "totp");
      let hasTotp = false;
      let totp = null;
      if (totpDescriptor) {
        if (!totpDescriptor.enumerable || !Object.prototype.hasOwnProperty.call(totpDescriptor, "value")) throw popupNewError(OPERATION_ERROR);
        if (totpDescriptor.value !== null) {
          let conf;
          try { conf = b2Config(totpDescriptor.value); } catch (_) { throw popupNewError(OPERATION_ERROR); }
          hasTotp = true;
          totp = { mode: conf.mode, algorithm: conf.algorithm, digits: conf.digits, period: conf.period, seed: conf.seedText };
        }
      }
      const sshDescriptor = Object.getOwnPropertyDescriptor(record, "ssh");
      let sshKeyName = null;
      let ssh = null;
      if (sshDescriptor) {
        if (!sshDescriptor.enumerable || !Object.prototype.hasOwnProperty.call(sshDescriptor, "value")) throw popupNewError(OPERATION_ERROR);
        if (sshDescriptor.value !== null) {
          let candidate;
          try { candidate = b3Record(record); } catch (_) { throw popupNewError(OPERATION_ERROR); }
          sshKeyName = candidate?.tuple?.keyName || null;
          if (sshKeyName !== null) {
            popupCapabilityText(sshKeyName);
            ssh = { key_name: candidate.tuple.keyName, counter: candidate.tuple.counter };
          }
        }
      }
      return {hasTotp, sshKeyName, totp, ssh};
    }
    function popupFullDetail(record) {
      if (!record || typeof record !== "object" || Array.isArray(record)) throw popupNewError(OPERATION_ERROR);
      const prototype = Object.getPrototypeOf(record);
      if (prototype !== null && prototype !== Object.prototype) throw popupNewError(OPERATION_ERROR);
      const id = popupNullableText(record, "id");
      const site = popupNullableText(record, "site");
      const name = popupNullableText(record, "name");
      const email = popupNullableText(record, "email");
      const lengthDescriptor = Object.getOwnPropertyDescriptor(record, "length");
      const symbolsDescriptor = Object.getOwnPropertyDescriptor(record, "symbols");
      const counterDescriptor = Object.getOwnPropertyDescriptor(record, "counter");
      const length = lengthDescriptor ? lengthDescriptor.value : 20;
      const symbols = symbolsDescriptor ? symbolsDescriptor.value : KEYGRAIN_PASSWORD_DEFAULT_SYMBOLS;
      const counter = counterDescriptor ? counterDescriptor.value : 1;
      if (lengthDescriptor && (!lengthDescriptor.enumerable || !Object.prototype.hasOwnProperty.call(lengthDescriptor, "value"))) throw popupNewError(OPERATION_ERROR);
      if (symbolsDescriptor && (!symbolsDescriptor.enumerable || !Object.prototype.hasOwnProperty.call(symbolsDescriptor, "value"))) throw popupNewError(OPERATION_ERROR);
      if (counterDescriptor && (!counterDescriptor.enumerable || !Object.prototype.hasOwnProperty.call(counterDescriptor, "value"))) throw popupNewError(OPERATION_ERROR);
      if (!Number.isSafeInteger(length) || length < 8 || length > 128) throw popupNewError(OPERATION_ERROR);
      popupPrintableSymbols(symbols);
      if (!Number.isSafeInteger(counter) || counter < 1 || counter > 0x7fffffff) throw popupNewError(OPERATION_ERROR);
      const policy = popupReadPolicy(record);
      const features = popupReadFeatureIndicators(record);
      const item = {
        id, site, name, email, length, symbols, counter,
        characterPolicyPresent: policy.characterPolicyPresent,
        characterPolicy: policy.characterPolicy,
        hasTotp: features.hasTotp,
        sshKeyName: features.sshKeyName,
        totp: features.totp,
        ssh: features.ssh,
      };
      if (new TextEncoder().encode(JSON.stringify(item)).byteLength > KEYGRAIN_POPUP_MAX_RESPONSE_BYTES) throw popupNewError(OPERATION_ERROR);
      return item;
    }
    function popupSelectionItem(record) {
      const item = popupFullDetail(record);
      return {id: item.id, site: item.site, name: item.name, email: item.email};
    }
    function popupDetailRequest(value) {
      popupExactEnvelope(value, KEYGRAIN_POPUP_DETAIL_REQUEST_KEYS);
      if (value.action !== KEYGRAIN_POPUP_DETAIL || typeof value.detailSelectionToken !== "string") throw popupNewError(AUTH_PROTOCOL_ERROR);
      popupCapabilityText(value.detailSelectionToken, AUTH_PROTOCOL_ERROR);
      return value;
    }
    function popupEditPatch(value) {
      if (!ownData(value)) throw popupNewError(AUTH_PROTOCOL_ERROR);
      const requiredKeys = ["name", "site", "email", "length", "symbols", "counter", "characterPolicyPresent", "characterPolicy"];
      for (const key of requiredKeys) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) throw popupNewError(AUTH_PROTOCOL_ERROR);
      }
      const allowedKeys = new Set([...requiredKeys, "totp", "ssh"]);
      for (const key of Reflect.ownKeys(value)) {
        if (!allowedKeys.has(key)) throw popupNewError(AUTH_PROTOCOL_ERROR);
      }
      const name = value.name;
      if (name !== null && typeof name !== "string") throw popupNewError(AUTH_PROTOCOL_ERROR);
      if (name !== null) popupCapabilityText(name, AUTH_PROTOCOL_ERROR);
      if (typeof value.site !== "string" || !value.site || typeof value.email !== "string" || !value.email) throw popupNewError(AUTH_PROTOCOL_ERROR);
      popupCapabilityText(value.site, AUTH_PROTOCOL_ERROR); popupCapabilityText(value.email, AUTH_PROTOCOL_ERROR);
      try {
        const normalized = root.normalizeSite(value.site);
        if (typeof normalized !== "string" || !normalized) throw new Error("site");
      } catch (_) { throw popupNewError(OPERATION_ERROR); }
      if (!value.email.trim() || /[\x00-\x1f\x7f]/.test(value.email)) throw popupNewError(OPERATION_ERROR);
      if (!Number.isSafeInteger(value.length) || value.length < 8 || value.length > 128
        || !Number.isSafeInteger(value.counter) || value.counter < 1 || value.counter > 0x7fffffff) throw popupNewError(OPERATION_ERROR);
      popupPrintableSymbols(value.symbols);
      if (typeof value.characterPolicyPresent !== "boolean") throw popupNewError(AUTH_PROTOCOL_ERROR);
      if (value.characterPolicyPresent !== (value.characterPolicy !== null)) throw popupNewError(AUTH_PROTOCOL_ERROR);
      if (value.characterPolicyPresent && value.characterPolicy !== KEYGRAIN_PASSWORD_DEFAULT_POLICY) throw popupNewError(OPERATION_ERROR);
      if (value.characterPolicy !== null) popupCapabilityText(value.characterPolicy, OPERATION_ERROR);

      let totp = undefined;
      if (Object.prototype.hasOwnProperty.call(value, "totp")) {
        if (value.totp !== null) {
          try { b2Config(value.totp); totp = value.totp; } catch (_) { throw popupNewError(OPERATION_ERROR); }
        } else {
          totp = null;
        }
      }
      let ssh = undefined;
      if (Object.prototype.hasOwnProperty.call(value, "ssh")) {
        if (value.ssh !== null) {
          if (!value.ssh || typeof value.ssh !== "object" || typeof value.ssh.key_name !== "string" || !value.ssh.key_name) throw popupNewError(OPERATION_ERROR);
          ssh = {key_name: value.ssh.key_name, counter: Number.isSafeInteger(value.ssh.counter) ? value.ssh.counter : 1};
        } else {
          ssh = null;
        }
      }
      const patch = {
        name, site: value.site, email: value.email, length: value.length, symbols: value.symbols,
        counter: value.counter, characterPolicyPresent: value.characterPolicyPresent, characterPolicy: value.characterPolicy,
      };
      if (totp !== undefined) patch.totp = totp;
      if (ssh !== undefined) patch.ssh = ssh;
      return Object.freeze(patch);
    }
    function popupEditRequest(value) {
      popupExactEnvelope(value, KEYGRAIN_POPUP_EDIT_REQUEST_KEYS);
      if (value.action !== KEYGRAIN_POPUP_EDIT || typeof value.editToken !== "string") throw popupNewError(AUTH_PROTOCOL_ERROR);
      popupCapabilityText(value.editToken, AUTH_PROTOCOL_ERROR);
      return {token: value.editToken, patch: popupEditPatch(value.patch)};
    }
    
    function popupSettingsRequest(request) {
      if (!request || typeof request !== "object" || Array.isArray(request)) throw popupNewError(AUTH_PROTOCOL_ERROR);
      popupExactEnvelope(request, ["action", "patch"]);
      if (!request.patch || typeof request.patch !== "object" || Array.isArray(request.patch)) throw popupNewError(AUTH_PROTOCOL_ERROR);
      return request;
    }
    function popupAddRequest(value) {
      popupExactEnvelope(value, KEYGRAIN_POPUP_ADD_REQUEST_KEYS);
      if (value.action !== KEYGRAIN_POPUP_ADD) throw popupNewError(AUTH_PROTOCOL_ERROR);
      return {patch: popupEditPatch(value.patch)};
    }
    function popupDeleteRequest(value) {
      popupExactEnvelope(value, KEYGRAIN_POPUP_DELETE_REQUEST_KEYS);
      if (value.action !== KEYGRAIN_POPUP_DELETE || typeof value.id !== "string") throw popupNewError(AUTH_PROTOCOL_ERROR);
      return {id: value.id};
    }
    function popupAssertDetail(item) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw popupNewError(OPERATION_ERROR);
      const keys = Reflect.ownKeys(item);
      if (keys.length !== KEYGRAIN_POPUP_DETAIL_KEYS.length || keys.some((key, index) => key !== KEYGRAIN_POPUP_DETAIL_KEYS[index])) throw popupNewError(OPERATION_ERROR);
      for (const key of ["id", "site", "name", "email", "sshKeyName"]) {
        if (item[key] !== null && typeof item[key] !== "string") throw popupNewError(OPERATION_ERROR);
        if (item[key] !== null) popupCapabilityText(item[key]);
      }
      if (!Number.isSafeInteger(item.length) || item.length < 8 || item.length > 128
        || !Number.isSafeInteger(item.counter) || item.counter < 1 || item.counter > 0x7fffffff
        || typeof item.characterPolicyPresent !== "boolean" || typeof item.hasTotp !== "boolean") throw popupNewError(OPERATION_ERROR);
      popupPrintableSymbols(item.symbols);
      if (item.characterPolicyPresent !== (item.characterPolicy !== null)
        || (item.characterPolicyPresent && item.characterPolicy !== KEYGRAIN_PASSWORD_DEFAULT_POLICY)) throw popupNewError(OPERATION_ERROR);
      if (item.characterPolicy !== null) popupCapabilityText(item.characterPolicy);
      if (item.totp !== null) {
        if (!item.totp || typeof item.totp !== "object" || Array.isArray(item.totp)) throw popupNewError(OPERATION_ERROR);
      }
      if (item.ssh !== null) {
        if (!item.ssh || typeof item.ssh !== "object" || Array.isArray(item.ssh)) throw popupNewError(OPERATION_ERROR);
      }
      return item;
    }
    function popupFullSelectionCapture(fullData) {
      if (!fullData || typeof fullData !== "object" || !Array.isArray(fullData.services) || fullData.services.length > KEYGRAIN_POPUP_MAX_ITEMS) throw popupNewError(OPERATION_ERROR);
      const items = [];
      for (let sourceOrdinal = 0; sourceOrdinal < fullData.services.length; sourceOrdinal++) {
        const record = fullData.services[sourceOrdinal];
        const detail = popupFullDetail(record);
        items.push({sourceOrdinal, detail, safe: popupSelectionItem(record)});
      }
      return {items};
    }
    function popupFullSelectionRequest(value) {
      popupExactEnvelope(value, KEYGRAIN_POPUP_SELECTION_REQUEST_KEYS);
      if (value.action !== KEYGRAIN_POPUP_SELECTION_OPTIONS) throw popupNewError(AUTH_PROTOCOL_ERROR);
      return value;
    }
    function popupSelectionToken() {
      try {
        if (!root.crypto || typeof root.crypto.getRandomValues !== "function") throw popupNewError(OPERATION_ERROR);
        const bytes = new Uint8Array(32); root.crypto.getRandomValues(bytes);
        let token = ""; for (const byte of bytes) token += byte.toString(16).padStart(2, "0");
        bytes.fill(0); return token;
      } catch (exception) { if (exception?.code) throw exception; throw popupNewError(OPERATION_ERROR); }
    }
    function popupInstallReplacementSnapshot() {
      // This identity is created only after an owner-controlled full-payload
      // install boundary (unlock or the named serialized replacement hook).
      popupAdvanceDataRevision();
      popupInstalledSnapshot = Object.freeze({identity: Object.freeze({}), dataRevision: accountDataRevision});
    }
    function popupCurrentState() {
      const snapshot = manager.snapshot();
      popupObserveSnapshot(snapshot);
      return snapshot;
    }
    function popupSelectionConsume(token) {
      const now = b2OwnerNow();
      const snapshot = popupCurrentState();
      const capability = popupSelectionCapabilities.get(token);
      if (!capability) throw popupNewError("KEYGRAIN_STALE_OPERATION");
      popupSelectionCapabilities.delete(token);
      if (snapshot.state !== "full") { popupClearCapabilities(); throw popupNewError("KEYGRAIN_EXPIRED"); }
      if (now >= capability.issuedAt + KEYGRAIN_POPUP_CAPABILITY_TTL_MS
        || capability.stateGeneration !== snapshot.stateGeneration
        || capability.authorizationGeneration !== snapshot.authorizationGeneration
        || capability.dataRevision !== accountDataRevision) throw popupNewError("KEYGRAIN_STALE_OPERATION");
      return capability;
    }
    function popupCheckCapability(capability) {
      const snapshot = popupCurrentState();
      const now = b2OwnerNow();
      if (snapshot.state !== "full" || snapshot.stateGeneration !== capability.stateGeneration
        || snapshot.authorizationGeneration !== capability.authorizationGeneration
        || capability.dataRevision !== accountDataRevision || now >= capability.issuedAt + KEYGRAIN_POPUP_CAPABILITY_TTL_MS) {
        throw popupNewError("KEYGRAIN_STALE_OPERATION");
      }
      return snapshot;
    }
    async function popupSelectionOptionsOperation(sender, runtimeId, browser, extensionOrigin) {
      let handle = null, finalized = false, staged = [];
      const finish = (method, reason) => { if (finalized) return; finalized = true; manager[method](handle, reason); };
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        const snapshot = popupCurrentState();
        if (snapshot.state !== "full") throw popupNewError("KEYGRAIN_EXPIRED");
        handle = manager.beginSensitiveOperation({capture: popupFullSelectionCapture});
        manager.checkSensitiveOperation(handle);
        const captured = manager.getSensitiveOperationInput(handle);
        const now = b2OwnerNow();
        const current = popupCurrentState();
        if (current.state !== "full" || current.stateGeneration !== snapshot.stateGeneration
          || current.authorizationGeneration !== snapshot.authorizationGeneration) throw popupNewError("KEYGRAIN_STALE_OPERATION");
        popupSelectionCapabilities.clear();
        popupEditCapabilities.clear();
        const items = [];
        for (const entry of captured.items) {
          const token = popupSelectionToken(); staged.push(token);
          popupSelectionCapabilities.set(token, Object.freeze({issuedAt: now,
            stateGeneration: current.stateGeneration, authorizationGeneration: current.authorizationGeneration,
            dataRevision: accountDataRevision, accountGeneration: accountIdentityGeneration, snapshot: popupInstalledSnapshot,
            sourceOrdinal: entry.sourceOrdinal, safe: entry.safe, detail: entry.detail}));
          items.push({detailSelectionToken: token, id: entry.safe.id, site: entry.safe.site, name: entry.safe.name, email: entry.safe.email});
        }
        if (new TextEncoder().encode(JSON.stringify({ok: true, result: {items}})).byteLength > KEYGRAIN_POPUP_MAX_RESPONSE_BYTES) throw popupNewError(OPERATION_ERROR);
        manager.checkSensitiveOperation(handle); popupContext(sender, runtimeId, browser, extensionOrigin); manager.checkSensitiveOperation(handle);
        const response = popupResponse(success({result: {items}}));
        finish("completeSensitiveOperation", "popup_selection_options_complete"); staged = [];
        return response;
      } catch (exception) {
        for (const token of staged) popupSelectionCapabilities.delete(token);
        if (handle && !finalized) { try { finish("failSensitiveOperation", "popup_selection_options_failure"); } catch (_) { finalized = true; } }
        return popupNewSafeError(exception);
      } finally { if (handle && !finalized) { try { finish("cancelSensitiveOperation", "popup_selection_options_finally"); } catch (_) {} } }
    }
    async function popupDetailOperation(sender, runtimeId, browser, extensionOrigin, parsed) {
      let handle = null, finalized = false, editToken = null;
      const finish = (method, reason) => { if (finalized || !handle) return; finalized = true; manager[method](handle, reason); };
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        const capability = popupSelectionConsume(parsed.detailSelectionToken);
        handle = manager.beginSensitiveOperation({capture: popupFullSelectionCapture});
        manager.checkSensitiveOperation(handle);
        const captured = manager.getSensitiveOperationInput(handle);
        popupCheckCapability(capability);
        if (popupInstalledSnapshot !== capability.snapshot) throw popupNewError("KEYGRAIN_STALE_OPERATION");
        const entry = captured.items[capability.sourceOrdinal];
        if (!entry || JSON.stringify(entry.safe) !== JSON.stringify(capability.safe)
          || JSON.stringify(entry.detail) !== JSON.stringify(capability.detail)) throw popupNewError("KEYGRAIN_STALE_OPERATION");
        const item = popupAssertDetail(entry.detail);
        editToken = popupSelectionToken();
        const current = popupCurrentState();
        popupEditCapabilities.set(editToken, Object.freeze({issuedAt: b2OwnerNow(), stateGeneration: current.stateGeneration,
          authorizationGeneration: current.authorizationGeneration, dataRevision: accountDataRevision,
          accountGeneration: capability.accountGeneration, snapshot: capability.snapshot,
          sourceOrdinal: capability.sourceOrdinal, item}));
        const response = popupResponse(success({result: {item, editToken}}));
        manager.checkSensitiveOperation(handle); popupContext(sender, runtimeId, browser, extensionOrigin); manager.checkSensitiveOperation(handle);
        finish("completeSensitiveOperation", "popup_detail_complete");
        return response;
      } catch (exception) {
        if (editToken) popupEditCapabilities.delete(editToken);
        if (handle && !finalized) { try { finish("failSensitiveOperation", "popup_detail_failure"); } catch (_) { finalized = true; } }
        return popupNewSafeError(exception);
      } finally { if (handle && !finalized) { try { finish("cancelSensitiveOperation", "popup_detail_finally"); } catch (_) {} } }
    }
    async function popupEditOperation(sender, runtimeId, browser, extensionOrigin, parsed) {
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        const snapshot = popupCurrentState();
        if (snapshot.state !== "full") throw popupNewError("KEYGRAIN_EXPIRED");
        const capability = popupEditCapabilities.get(parsed.token);
        if (!capability) throw popupNewError("KEYGRAIN_STALE_OPERATION");
        popupCheckCapability(capability);
        if (popupInstalledSnapshot !== capability.snapshot) throw popupNewError("KEYGRAIN_STALE_OPERATION");
        popupEditCapabilities.delete(parsed.token);
        if (typeof adapter.commitKeygrainPopupServiceEdit !== "function") throw popupNewError(OPERATION_ERROR);
        
        const patch = {...parsed.patch};
        if (workerUpdateVersion !== null) patch.updated_at = workerUpdateVersion.next({targetVersion: capability.item.updated_at || 0, localKnownVersion: 0, remoteKnownVersion: 0});
        
        const opHandle = manager.beginSensitiveOperation({capture: data => ({fullData: data})});
        let input;
        try {
          input = manager.getSensitiveOperationInput(opHandle);
        } catch (_) {
          manager.cancelSensitiveOperation(opHandle, "edit_input_error");
          throw popupNewError(OPERATION_ERROR);
        }
        if (!input?.fullData?.services || !Array.isArray(input.fullData.services)) {
          manager.cancelSensitiveOperation(opHandle, "edit_data_missing");
          throw popupNewError(OPERATION_ERROR);
        }
        
        const nextServices = [...input.fullData.services];
        const idx = capability.sourceOrdinal;
        if (idx < 0 || idx >= nextServices.length) {
          manager.cancelSensitiveOperation(opHandle, "edit_ordinal_out_of_bounds");
          throw popupNewError("KEYGRAIN_STALE_OPERATION");
        }
        
        nextServices[idx] = {...nextServices[idx], ...patch};
        const nextFullData = {
          secret: (typeof input.fullData.secret === "string" && input.fullData.secret) ? input.fullData.secret : "authenticated-secret",
          email: (typeof input.fullData.email === "string" && input.fullData.email) ? input.fullData.email : "user@example.com",
          wallets: Array.isArray(input.fullData.wallets) ? input.fullData.wallets : [],
          walletAuditLog: Array.isArray(input.fullData.walletAuditLog) ? input.fullData.walletAuditLog : [],
          tombstones: Array.isArray(input.fullData.tombstones) ? input.fullData.tombstones : [],
          deletionReview: Array.isArray(input.fullData.deletionReview) ? input.fullData.deletionReview : [],
          ...input.fullData,
          services: nextServices,
        };
        
        const result = await adapter.commitKeygrainPopupServiceEdit({
          email: input.fullData.email,
          secret: input.fullData.secret,
          fullData: nextFullData,
          accountGeneration: capability.accountGeneration,
          authorizationGeneration: snapshot.authorizationGeneration,
          stateGeneration: snapshot.stateGeneration,
          sourceOrdinal: capability.sourceOrdinal,
          expectedRecordRevision: {accountDataRevision: capability.dataRevision, sourceOrdinal: capability.sourceOrdinal},
          patch,
        });
        if (!result || !result.ok) {
          manager.cancelSensitiveOperation(opHandle, "commit_failed");
          throw popupNewError(OPERATION_ERROR);
        }
        
        manager.installFullPayloadReplacement({
          operationHandle: opHandle,
          fullData: nextFullData,
          records: nextServices,
        });
        popupInstallReplacementSnapshot();
        passwordClearCapabilities();
        b2AdvanceRecordGeneration();
        return popupResponse(success());
      } catch (exception) { return popupNewSafeError(exception); }
    }

    async function popupAddOperation(sender, runtimeId, browser, extensionOrigin, parsed) {
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        const snapshot = popupCurrentState();
        if (snapshot.state !== "full") throw popupNewError("KEYGRAIN_EXPIRED");
        if (typeof adapter.commitKeygrainPopupServiceAdd !== "function") throw popupNewError(OPERATION_ERROR);
        
        const patch = {...parsed.patch};
        patch.id = (typeof crypto.randomUUID === "function") ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");
        const v = (workerUpdateVersion !== null) ? workerUpdateVersion.next({targetVersion: 0, localKnownVersion: 0, remoteKnownVersion: 0}) : Date.now();
        patch.created_at = v;
        patch.updated_at = v;
        
        const opHandle = manager.beginSensitiveOperation({capture: data => ({fullData: data})});
        let input;
        try {
          input = manager.getSensitiveOperationInput(opHandle);
        } catch (_) {
          manager.cancelSensitiveOperation(opHandle, "add_input_error");
          throw popupNewError(OPERATION_ERROR);
        }
        if (!input?.fullData?.services || !Array.isArray(input.fullData.services)) {
          manager.cancelSensitiveOperation(opHandle, "add_data_missing");
          throw popupNewError(OPERATION_ERROR);
        }
        
        const nextServices = [...input.fullData.services, patch];
        const nextFullData = {
          secret: (typeof input.fullData.secret === "string" && input.fullData.secret) ? input.fullData.secret : "authenticated-secret",
          email: (typeof input.fullData.email === "string" && input.fullData.email) ? input.fullData.email : "user@example.com",
          wallets: Array.isArray(input.fullData.wallets) ? input.fullData.wallets : [],
          walletAuditLog: Array.isArray(input.fullData.walletAuditLog) ? input.fullData.walletAuditLog : [],
          tombstones: Array.isArray(input.fullData.tombstones) ? input.fullData.tombstones : [],
          deletionReview: Array.isArray(input.fullData.deletionReview) ? input.fullData.deletionReview : [],
          ...input.fullData,
          services: nextServices,
        };
        
        const result = await adapter.commitKeygrainPopupServiceAdd({
          email: input.fullData.email,
          secret: input.fullData.secret,
          fullData: nextFullData,
          accountGeneration: accountIdentityGeneration,
          authorizationGeneration: snapshot.authorizationGeneration,
          stateGeneration: snapshot.stateGeneration,
          patch,
        });
        if (!result || !result.ok) {
          manager.cancelSensitiveOperation(opHandle, "commit_failed");
          throw popupNewError(OPERATION_ERROR);
        }
        
        manager.installFullPayloadReplacement({
          operationHandle: opHandle,
          fullData: nextFullData,
          records: nextServices,
        });
        popupInstallReplacementSnapshot();
        passwordClearCapabilities();
        b2AdvanceRecordGeneration();
        return popupResponse(success());
      } catch (exception) { return popupNewSafeError(exception); }
    }
    async function popupDeleteOperation(sender, runtimeId, browser, extensionOrigin, parsed) {
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        const snapshot = popupCurrentState();
        if (snapshot.state !== "full") throw popupNewError("KEYGRAIN_EXPIRED");
        if (typeof adapter.commitKeygrainPopupServiceDelete !== "function") throw popupNewError(OPERATION_ERROR);
        
        const deleted_at = (workerUpdateVersion !== null) ? workerUpdateVersion.next({targetVersion: 0, localKnownVersion: 0, remoteKnownVersion: 0}) : Date.now();
        
        const opHandle = manager.beginSensitiveOperation({capture: data => ({fullData: data})});
        let input;
        try {
          input = manager.getSensitiveOperationInput(opHandle);
        } catch (_) {
          manager.cancelSensitiveOperation(opHandle, "delete_input_error");
          throw popupNewError(OPERATION_ERROR);
        }
        if (!input?.fullData?.services || !Array.isArray(input.fullData.services)) {
          manager.cancelSensitiveOperation(opHandle, "delete_data_missing");
          throw popupNewError(OPERATION_ERROR);
        }
        
        const nextServices = input.fullData.services.filter(s => s.id !== parsed.id);
        const nextTombstones = Array.isArray(input.fullData.tombstones) ? [...input.fullData.tombstones] : [];
        nextTombstones.push({id: parsed.id, deleted_at});
        const nextFullData = {
          secret: (typeof input.fullData.secret === "string" && input.fullData.secret) ? input.fullData.secret : "authenticated-secret",
          email: (typeof input.fullData.email === "string" && input.fullData.email) ? input.fullData.email : "user@example.com",
          wallets: Array.isArray(input.fullData.wallets) ? input.fullData.wallets : [],
          walletAuditLog: Array.isArray(input.fullData.walletAuditLog) ? input.fullData.walletAuditLog : [],
          deletionReview: Array.isArray(input.fullData.deletionReview) ? input.fullData.deletionReview : [],
          ...input.fullData,
          services: nextServices,
          tombstones: nextTombstones,
        };
        
        const result = await adapter.commitKeygrainPopupServiceDelete({
          email: input.fullData.email,
          secret: input.fullData.secret,
          fullData: nextFullData,
          accountGeneration: accountIdentityGeneration,
          authorizationGeneration: snapshot.authorizationGeneration,
          stateGeneration: snapshot.stateGeneration,
          id: parsed.id,
          deleted_at,
        });
        if (!result || !result.ok) {
          manager.cancelSensitiveOperation(opHandle, "commit_failed");
          throw popupNewError(OPERATION_ERROR);
        }
        
        manager.installFullPayloadReplacement({
          operationHandle: opHandle,
          fullData: nextFullData,
          records: nextServices,
        });
        popupInstallReplacementSnapshot();
        passwordClearCapabilities();
        b2AdvanceRecordGeneration();
        return popupResponse(success());
      } catch (exception) { return popupNewSafeError(exception); }
    }
    
    async function popupSettingsOperation(sender, runtimeId, browser, extensionOrigin, parsed) {
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        const snapshot = popupCurrentState();
        if (snapshot.state === "locked") throw popupNewError("KEYGRAIN_EXPIRED");
        if (!parsed.patch || typeof parsed.patch !== 'object') throw popupNewError(AUTH_PROTOCOL_ERROR);
        const currentSettings = await loadSettings();
        let finalSettings = currentSettings;
        if (Object.keys(parsed.patch).length > 0) {
          const candidate = {...currentSettings, ...parsed.patch};
          finalSettings = await saveSettings(candidate);
          const currentSnapshot = manager.snapshot();
          if (currentSnapshot.state === "full" && parsed.patch.fullLeaseSeconds !== undefined) {
            let exceptionalConfirmation = null;
            if (finalSettings.fullLeaseSeconds === root.KEYGRAIN_FULL_EXCEPTIONAL_MAX_SECONDS) {
              exceptionalConfirmation = (root.confirmExceptionalFullLease || globalThis.confirmExceptionalFullLease)(manager);
            }
            manager.extendFull({exceptionalConfirmation});
          } else if (currentSnapshot.state === "metadata" && parsed.patch.metadataTailSeconds !== undefined) {
            manager.extendMetadata();
          }
          lastSnapshot = manager.snapshot();
          scheduleIndicatorReconcile("settings_changed", currentSnapshot, lastSnapshot);
        }
        return popupResponse(success({result: {settings: finalSettings}}));
      } catch (exception) { return popupNewSafeError(exception); }
    }
    async function popupLockOperation(sender, runtimeId, browser, extensionOrigin, everything) {
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        popupClearCapabilities(); passwordClearCapabilities(); b2AdvanceRecordGeneration();
        const before = manager.snapshot();
        const after = everything ? manager.lockEverything() : manager.lockSensitive();
        if (everything || after.state === "locked") popupClearAuthenticatedIdentity();
        popupInstalledSnapshot = after.state === "full" ? popupInstalledSnapshot : null;
        lastSnapshot = after;
        popupObservedStateGeneration = after.stateGeneration;
        popupObservedAuthorizationGeneration = after.authorizationGeneration;
        if (before.stateGeneration !== after.stateGeneration || before.authorizationGeneration !== after.authorizationGeneration) {
          scheduleIndicatorReconcile(everything ? "popup_lock_everything" : "popup_lock_sensitive", before, after);
        }
        const result = popupStateResult(after, authenticatedAccountEmail);
        popupContext(sender, runtimeId, browser, extensionOrigin);
        return popupResponse(success({result}));
      } catch (exception) { return popupNewSafeError(exception); }
    }

    async function popupSwitchAccountOperation(sender, runtimeId, browser, extensionOrigin) {
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        popupClearCapabilities();
        passwordClearCapabilities();
        b2AdvanceRecordGeneration();
        popupClearAuthenticatedIdentity();
        popupInstalledSnapshot = null;
        lastSnapshot = manager.invalidate("account_switch");
        if (typeof adapter.switchAccount === "function") {
          await adapter.switchAccount();
        }
        return popupResponse(success());
      } catch (exception) {
        return popupNewSafeError(exception);
      }
    }

    async function popupExtendOperation(sender, runtimeId, browser, extensionOrigin) {
      try {
        popupContext(sender, runtimeId, browser, extensionOrigin);
        const before = popupCurrentState();
        if (before.state === "full") {
          let exceptionalConfirmation = null;
          const currentSettings = await loadSettings();
          if (currentSettings?.fullLeaseSeconds === root.KEYGRAIN_FULL_EXCEPTIONAL_MAX_SECONDS) {
            exceptionalConfirmation = root.confirmExceptionalFullLease(manager);
          }
          const lease = manager.extendFull({exceptionalConfirmation});
          if (lease) {
            lastSnapshot = manager.snapshot();
            scheduleIndicatorReconcile("popup_extend_full", before, lastSnapshot);
          }
        } else if (before.state === "metadata") {
          const lease = manager.extendMetadata();
          if (lease) {
            lastSnapshot = manager.snapshot();
            scheduleIndicatorReconcile("popup_extend_metadata", before, lastSnapshot);
          }
        }
        const after = popupCurrentState();
        const result = popupStateResult(after, authenticatedAccountEmail);
        return popupResponse(success({result}));
      } catch (exception) {
        return popupNewSafeError(exception);
      }
    }

    const popupRegistry = Object.freeze({
      [KEYGRAIN_POPUP_STATE]: Object.freeze({
        action: KEYGRAIN_POPUP_STATE, requestValidator: popupRequestAction,
        senderPredicate: isTrustedExtensionPage, stateGate: "any",
        capture: null, projection: (snapshot) => popupStateResult(snapshot, authenticatedAccountEmail), outputSanitizer: popupResponse,
        failureMapping: popupFailureFor, finalizer: null, execute: popupStateOperation,
      }),
      [KEYGRAIN_POPUP_METADATA]: Object.freeze({
        action: KEYGRAIN_POPUP_METADATA, requestValidator: popupRequestAction,
        senderPredicate: isTrustedExtensionPage, stateGate: "metadata",
        capture: "getMetadata", projection: popupProjectionItems, outputSanitizer: popupResponse,
        failureMapping: popupFailureFor, finalizer: null, execute: popupMetadataOperation,
      }),
      [KEYGRAIN_POPUP_SERVICE_LIST]: Object.freeze({
        action: KEYGRAIN_POPUP_SERVICE_LIST, requestValidator: popupRequestAction,
        senderPredicate: isTrustedExtensionPage, stateGate: "full",
        capture: popupServiceCapture, projection: popupCapturedItems, outputSanitizer: popupResponse,
        failureMapping: popupFailureFor, finalizer: "completeSensitiveOperation|failSensitiveOperation|cancelSensitiveOperation",
        execute: popupServiceListOperation,
      }),
      [KEYGRAIN_POPUP_SELECTION_OPTIONS]: Object.freeze({action: KEYGRAIN_POPUP_SELECTION_OPTIONS, execute: popupSelectionOptionsOperation}),
      [KEYGRAIN_POPUP_DETAIL]: Object.freeze({action: KEYGRAIN_POPUP_DETAIL, execute: popupDetailOperation}),
      [KEYGRAIN_POPUP_EDIT]: Object.freeze({action: KEYGRAIN_POPUP_EDIT, execute: popupEditOperation}),

      [KEYGRAIN_POPUP_ADD]: Object.freeze({action: KEYGRAIN_POPUP_ADD, execute: popupAddOperation}),
      [KEYGRAIN_POPUP_DELETE]: Object.freeze({action: KEYGRAIN_POPUP_DELETE, execute: popupDeleteOperation}),
      [KEYGRAIN_POPUP_SETTINGS]: Object.freeze({action: KEYGRAIN_POPUP_SETTINGS, execute: popupSettingsOperation}),

      [KEYGRAIN_POPUP_LOCK_SENSITIVE]: Object.freeze({action: KEYGRAIN_POPUP_LOCK_SENSITIVE, execute: (s, r, b, o) => popupLockOperation(s, r, b, o, false)}),
      [KEYGRAIN_POPUP_LOCK_EVERYTHING]: Object.freeze({action: KEYGRAIN_POPUP_LOCK_EVERYTHING, execute: (s, r, b, o) => popupLockOperation(s, r, b, o, true)}),
      [KEYGRAIN_POPUP_EXTEND]: Object.freeze({action: KEYGRAIN_POPUP_EXTEND, execute: popupExtendOperation}),
      [KEYGRAIN_POPUP_SWITCH_ACCOUNT]: Object.freeze({action: KEYGRAIN_POPUP_SWITCH_ACCOUNT, execute: popupSwitchAccountOperation}),
    });

    async function dispatchPopupRequest(sender, runtimeId, request, browser = adapter.browser || "chrome", extensionOrigin = null) {
      // Context is checked before touching request shape or action membership.
      if (!isTrustedExtensionPage(sender, runtimeId, null, browser, extensionOrigin)) {
        return safeFailure(CONTEXT_ERROR);
      }
      // Extension pages other than the exact popup cannot reach any popup
      // dispatch schema probe. B3 and all popup operations share this boundary.
      try {
        const dispatchPath = new URL(sender.url).pathname;
        if (dispatchPath !== "/popup.html") return safeFailure(CONTEXT_ERROR);
      } catch (_) { return safeFailure(CONTEXT_ERROR); }
      let action;
      try { action = peekPopupAction(request); if (typeof action !== "string") throw error(AUTH_PROTOCOL_ERROR); }
      catch (exception) { return popupFailureFor(exception); }
      if (KEYGRAIN_SSH_ACTIONS.has(action) || KEYGRAIN_WALLET_ACTIONS.has(action)) {
        try { b3PopupContext(sender, runtimeId, browser, extensionOrigin); }
        catch (exception) { return b3SafeError(exception, OPERATION_ERROR); }
        const entry = b3Registry[action] || walletRegistry[action];
        try {
          const parsed = entry.requestValidator(request);
          if (action === KEYGRAIN_SSH_OPTIONS || action === KEYGRAIN_WALLET_OPTIONS) return entry.execute(sender, runtimeId, browser, extensionOrigin);
          return entry.execute(sender, runtimeId, browser, extensionOrigin, parsed);
        } catch (exception) {
          return b3SafeError(exception, OPERATION_ERROR);
        }
      }
      if (KEYGRAIN_TOTP_ACTIONS.has(action)) {
        const entry = b2Registry[action];
        try {
          const parsed = entry.requestValidator(request);
          if (action === KEYGRAIN_TOTP_OPTIONS) return entry.execute(sender, runtimeId, browser, extensionOrigin);
          return entry.execute(sender, runtimeId, browser, extensionOrigin, parsed);
        } catch (exception) {
          return b2SafeError(exception, OPERATION_ERROR);
        }
      }
      if (KEYGRAIN_PASSWORD_ACTIONS.has(action)) {
        try {
          const parsed = passwordRequest(request, action);
          if (action === KEYGRAIN_PASSWORD_OPTIONS) return passwordOptionsOperation(sender, runtimeId, browser, extensionOrigin);
          const capability = passwordConsumeCapability(parsed.selectionToken);
          return passwordSensitiveOperation(parsed, capability, action === KEYGRAIN_PASSWORD_FILL);
        } catch (exception) {
          return popupFailureFor(exception);
        }
      }
      if (action === KEYGRAIN_POPUP_SELECTION_OPTIONS) {
        try { popupFullSelectionRequest(request); } catch (exception) { return popupNewSafeError(exception, AUTH_PROTOCOL_ERROR); }
        return popupRegistry[action].execute(sender, runtimeId, browser, extensionOrigin);
      }
      if (action === KEYGRAIN_POPUP_DETAIL) {
        let parsed;
        try { parsed = popupDetailRequest(request); } catch (exception) { return popupNewSafeError(exception, AUTH_PROTOCOL_ERROR); }
        return popupRegistry[action].execute(sender, runtimeId, browser, extensionOrigin, parsed);
      }
      if (action === KEYGRAIN_POPUP_EDIT) {
        let parsed;
        try { parsed = popupEditRequest(request); } catch (exception) { return popupNewSafeError(exception, AUTH_PROTOCOL_ERROR); }
        return popupRegistry[action].execute(sender, runtimeId, browser, extensionOrigin, parsed);
      }

      if (action === KEYGRAIN_POPUP_ADD) {
        let parsed;
        try { parsed = popupAddRequest(request); } catch (exception) { return popupNewSafeError(exception, AUTH_PROTOCOL_ERROR); }
        return popupRegistry[action].execute(sender, runtimeId, browser, extensionOrigin, parsed);
      }
      if (action === KEYGRAIN_POPUP_DELETE) {
        let parsed;
        try { parsed = popupDeleteRequest(request); } catch (exception) { return popupNewSafeError(exception, AUTH_PROTOCOL_ERROR); }
        return popupRegistry[action].execute(sender, runtimeId, browser, extensionOrigin, parsed);
      }
      
      if (action === KEYGRAIN_POPUP_SETTINGS) {
        let parsed;
        try { parsed = popupSettingsRequest(request); } catch (exception) { return popupNewSafeError(exception, AUTH_PROTOCOL_ERROR); }
        return popupRegistry[action].execute(sender, runtimeId, browser, extensionOrigin, parsed);
      }
      if (action === KEYGRAIN_POPUP_LOCK_SENSITIVE || action === KEYGRAIN_POPUP_LOCK_EVERYTHING || action === KEYGRAIN_POPUP_SWITCH_ACCOUNT) {
        try { popupExactEnvelope(request, ["action"]); if (request.action !== action) throw popupNewError(AUTH_PROTOCOL_ERROR); }
        catch (exception) { return popupNewSafeError(exception, AUTH_PROTOCOL_ERROR); }
        return popupRegistry[action].execute(sender, runtimeId, browser, extensionOrigin);
      }
      try { popupRequestAction(request); }
      catch (exception) { return popupFailureFor(exception); }
      const entry = popupRegistry[action];
      if (entry) return entry.execute(sender, runtimeId, browser, extensionOrigin);
      if (POPUP_RESERVED_ACTIONS.has(action)) return safeFailure(CONSUMER_MIGRATION_REQUIRED);
      return safeFailure(AUTH_PROTOCOL_ERROR);
    }


    function dispatchLegacyOrPhaseB(sender, runtimeId, message, browser = adapter.browser || "chrome", extensionOrigin = null) {
      try {
        if (!isTrustedExtensionPage(sender, runtimeId, null, browser, extensionOrigin)) return safeFailure(CONTEXT_ERROR);
        const action = popupRequestAction(message);
        return POPUP_RESERVED_ACTIONS.has(action)
          ? safeFailure(CONSUMER_MIGRATION_REQUIRED)
          : safeFailure(AUTH_PROTOCOL_ERROR);
      } catch (exception) {
        return popupFailureFor(exception);
      }
    }

    async function saveSettings(candidate) {
      if (!settingsStore) throw error(SETTINGS_STORAGE_ERROR);
      if (!candidate || typeof candidate !== "object") throw error("KEYGRAIN_SETTINGS_ERROR");

      const currentSec = await loadSecuritySettings(settingsStore);
      let secCandidate = {...currentSec};
      let hasSec = false;
      if (candidate.fullLeaseSeconds !== undefined) { secCandidate.fullLeaseSeconds = candidate.fullLeaseSeconds; hasSec = true; }
      if (candidate.metadataTailSeconds !== undefined) { secCandidate.metadataTailSeconds = candidate.metadataTailSeconds; hasSec = true; }
      if (candidate.version !== undefined) { secCandidate.version = candidate.version; hasSec = true; }

      let savedSec = currentSec;
      if (hasSec) {
        savedSec = await saveSecuritySettings(settingsStore, secCandidate);
        manager.applySettings(savedSec);
      }

      const prefKeys = Object.keys(candidate).filter(k => k !== "fullLeaseSeconds" && k !== "metadataTailSeconds" && k !== "version");
      let prefs = {};
      try {
        const stored = await settingsStore.get("settings");
        if (stored && ownData(stored.settings)) {
          prefs = {...stored.settings};
        }
      } catch (_) {}

      if (prefKeys.length > 0) {
        for (const k of prefKeys) {
          prefs[k] = candidate[k];
        }
        if (candidate.inPageAutofill !== undefined || candidate.inlineAutofillEnabled !== undefined) {
          const flag = candidate.inPageAutofill !== undefined ? !!candidate.inPageAutofill : !!candidate.inlineAutofillEnabled;
          prefs.inPageAutofill = flag;
          prefs.inlineAutofillEnabled = flag;
          try {
            await settingsStore.set({inlineAutofillEnabled: flag});
          } catch (_) {}
        }
        await settingsStore.set({settings: prefs});
      }

      return {...savedSec, ...prefs};
    }

    function snapshot() {
      if (closed) return manager.snapshot();
      lastSnapshot = manager.snapshot();
      return lastSnapshot;
    }

    function scheduleIndicatorReconcile(reason, before, after) {
      const token = ++reconciliationToken;
      const expectedStateGeneration = after.stateGeneration;
      const expectedAuthorizationGeneration = after.authorizationGeneration;
      const run = async () => {
        if (token !== reconciliationToken || closed) return;
        let handle = null;
        let finalized = false;
        const check = () => {
          if (token !== reconciliationToken) throw error("KEYGRAIN_STALE_OPERATION");
          if (after.state === "full") {
            if (!handle) throw error("KEYGRAIN_STALE_OPERATION");
            manager.checkSensitiveOperation(handle);
            return true;
          }
          const current = manager.snapshot();
          if (current.stateGeneration !== expectedStateGeneration
            || current.authorizationGeneration !== expectedAuthorizationGeneration
            || current.state !== after.state) throw error("KEYGRAIN_STALE_OPERATION");
          return true;
        };
        try {
          let projection = null;
          if (after.state === "full") {
            handle = manager.beginSensitiveOperation({capture: captureIndicatorProjection});
            projection = manager.getSensitiveOperationInput(handle);
            check();
          } else if (after.state === "metadata") {
            const metadata = manager.getMetadata();
            if (!Array.isArray(metadata)) throw error("KEYGRAIN_STALE_OPERATION");
            projection = captureIndicatorProjection({services: metadata});
            check();
          }
          if (typeof adapter.reconcileIndicators === "function") {
            await adapter.reconcileIndicators({
              reason,
              before,
              after,
              generation: token,
              projection,
              check,
            });
          }
          check();
          if (handle) {
            manager.completeSensitiveOperation(handle);
            finalized = true;
          }
        } catch (exception) {
          if (handle && !finalized) {
            try { manager.failSensitiveOperation(handle); } catch (_) {}
            finalized = true;
          }
          // Stale/expired work is deliberately silent: its adapter must not
          // clear or replace a newer generation's indicator/registration.
          if (exception?.code === "KEYGRAIN_STALE_OPERATION" || exception?.code === "KEYGRAIN_EXPIRED") return;
        } finally {
          if (handle && !finalized) {
            try { manager.cancelSensitiveOperation(handle, "indicator_reconcile"); } catch (_) {}
          }
        }
      };
      reconciliationChain = reconciliationChain.then(run, run).catch(() => {});
      return reconciliationChain;
    }

    function reconcile(reason = "owner") {
      if (closed) return manager.snapshot();
      const before = lastSnapshot;
      let after;
      try { after = manager.expire(); }
      catch (exception) {
        popupClearAuthenticatedIdentity();
        throw exception;
      }
      lastSnapshot = after;
      if (after.state === "locked") popupClearAuthenticatedIdentity();
      if (before.stateGeneration !== after.stateGeneration || before.authorizationGeneration !== after.authorizationGeneration) {
        passwordClearCapabilities();
        b2AdvanceRecordGeneration();
        popupObservedStateGeneration = after.stateGeneration;
        popupObservedAuthorizationGeneration = after.authorizationGeneration;
      }
      wakeGeneration++;
      scheduleIndicatorReconcile(reason, before, after);
      return after;
    }

    function whenReconciled() {
      return reconciliationChain;
    }

    function issueConfirmation(sessionId, senderUrl = "") {
      if (typeof sessionId !== "string" || !sessionId || typeof senderUrl !== "string") throw error(CONTEXT_ERROR);
      const token = root.confirmExceptionalFullLease(manager);
      const uuid = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") ? crypto.randomUUID() : (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") ? Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("") : Math.random().toString(36).slice(2);
      const id = `${sessionId}:${uuid}`;
      confirmations.set(id, {sessionId, senderUrl, token});
      return id;
    }

    function takeConfirmation(id, sessionId, senderUrl = "") {
      if (id === null) return null;
      const record = confirmations.get(id);
      if (!record || record.sessionId !== sessionId || record.senderUrl !== senderUrl) throw error("KEYGRAIN_CONFIRMATION_ERROR");
      return record.token;
    }

    function clearConfirmationSession(sessionId) {
      for (const [id, record] of confirmations) if (record.sessionId === sessionId) confirmations.delete(id);
    }

    function shutdown(reason = "runtime_shutdown") {
      if (!INVALIDATION_REASONS.has(reason)) throw error("KEYGRAIN_INVALIDATION_ERROR");
      closed = true;
      confirmations.clear();
      passwordClearCapabilities();
      popupClearCapabilities();
      b2AdvanceRecordGeneration();
      popupClearAuthenticatedIdentity();
      const result = manager.invalidate(reason);
      if (typeof adapter.shutdown === "function") {
        try { adapter.shutdown(); } catch (_) {}
      }
      return result;
    }

    function getServicesList() {
      const snap = manager.snapshot();
      if (snap.state === "locked") return null;
      if (snap.state === "full") {
        const opHandle = manager.beginSensitiveOperation({capture: fullData => ({services: fullData?.services || []})});
        try {
          const input = manager.getSensitiveOperationInput(opHandle);
          return input?.services || [];
        } finally {
          try { manager.completeSensitiveOperation(opHandle, "get_services_list"); } catch (_) {}
        }
      }
      return manager.getMetadata() || [];
    }

    async function derivePasswordForService(serviceIdOrMatcher) {
      const snap = manager.snapshot();
      if (snap.state !== "full") return null;
      let result = null;
      const opHandle = manager.beginSensitiveOperation({capture: fullData => ({secret: fullData?.secret, email: fullData?.email, services: fullData?.services || []})});
      try {
        const input = manager.getSensitiveOperationInput(opHandle);
        if (input?.secret && input?.services) {
          let svc = null;
          if (typeof serviceIdOrMatcher === "string") {
            svc = input.services.find(s => s.id === serviceIdOrMatcher);
          } else if (typeof serviceIdOrMatcher === "function") {
            svc = input.services.find(serviceIdOrMatcher);
          }
          if (svc) {
            const site = svc.site || svc.name;
            const length = svc.length || 20;
            const symbols = svc.symbols || "!@#$%&*-_=+?";
            const counter = svc.counter || 1;
            const pw = await root.derivePassword(input.secret, svc.email || input.email, {site, length, symbols, counter});
            result = {password: pw, email: svc.email || input.email, service: svc};
          }
        }
      } finally {
        try { manager.completeSensitiveOperation(opHandle, "derive_password_autofill"); } catch (_) {}
      }
      return result;
    }

    async function deriveTotpForService(serviceIdOrMatcher) {
      const snap = manager.snapshot();
      if (snap.state !== "full") return null;
      let result = null;
      const opHandle = manager.beginSensitiveOperation({capture: fullData => ({secret: fullData?.secret, services: fullData?.services || []})});
      try {
        const input = manager.getSensitiveOperationInput(opHandle);
        if (input?.secret && input?.services) {
          let svc = null;
          if (typeof serviceIdOrMatcher === "string") {
            svc = input.services.find(s => s.id === serviceIdOrMatcher);
          } else if (typeof serviceIdOrMatcher === "function") {
            svc = input.services.find(serviceIdOrMatcher);
          }
          if (svc && svc.totp) {
            let seed = null;
            try {
              if (svc.totp.mode === "stored") {
                const binary = root.atob(svc.totp.seed);
                seed = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) seed[i] = binary.charCodeAt(i);
              } else {
                seed = await root.deriveTOTPSeed(input.secret, svc.email, svc.site);
              }
              const nowSec = Math.floor(b2OwnerNow() / 1000);
              const digits = svc.totp.digits || 6;
              const period = svc.totp.period || 30;
              const algorithm = svc.totp.algorithm || "SHA-1";
              const code = await root.generateTOTP(seed, nowSec, {digits, period, algorithm});
              result = {code, period, email: svc.email, service: svc};
            } finally {
              if (seed && typeof seed.fill === "function") seed.fill(0);
            }
          }
        }
      } finally {
        try { manager.completeSensitiveOperation(opHandle, "derive_totp_autofill"); } catch (_) {}
      }
      return result;
    }

    async function deriveCustomWalletMnemonic({walletName, chain, counter, email}) {
      const snap = manager.snapshot();
      if (snap.state !== "full") return null;
      let result = null;
      const opHandle = manager.beginSensitiveOperation({capture: fullData => ({secret: fullData?.secret, email: fullData?.email})});
      try {
        const input = manager.getSensitiveOperationInput(opHandle);
        if (input?.secret) {
          const mnemonic = await root.deriveWalletMnemonic(input.secret, email || input.email, {walletName, chain, counter});
          result = {mnemonic};
        }
      } finally {
        try { manager.completeSensitiveOperation(opHandle, "derive_wallet_custom"); } catch (_) {}
      }
      return result;
    }

    return Object.freeze({
      adapter,
      manager,
      loadSettings,
      saveSettings,
      unlock,
      dispatchPopupRequest,
      dispatchLegacyOrPhaseB,
      snapshot,
      reconcile,
      whenReconciled,
      issueConfirmation,
      takeConfirmation,
      clearConfirmationSession,
      shutdown,
      restoreSession,
      getMetadata: () => manager.getMetadata(),
      getServicesList,
      derivePasswordForService,
      deriveTotpForService,
      deriveCustomWalletMnemonic,
      getAuthenticatedEmail: () => authenticatedAccountEmail,
      get generation() { return wakeGeneration; },
      get closed() { return closed; },
      constants: Object.freeze({
        AUTH_PROTOCOL_ERROR, CONTEXT_ERROR, UNLOCK_FAILED, OPERATION_ERROR,
        CONSUMER_MIGRATION_REQUIRED, SETTINGS_STORAGE_ERROR, INLINE_REGISTRATION_ID,
        KEYGRAIN_POPUP_SELECTION_OPTIONS, KEYGRAIN_POPUP_DETAIL, KEYGRAIN_POPUP_EDIT, KEYGRAIN_POPUP_ADD, KEYGRAIN_POPUP_DELETE, KEYGRAIN_POPUP_SETTINGS, KEYGRAIN_POPUP_LOCK_SENSITIVE, KEYGRAIN_POPUP_LOCK_EVERYTHING,
        KEYGRAIN_POPUP_CAPABILITY_TTL_MS,
        KEYGRAIN_PASSWORD_OPTIONS, KEYGRAIN_PASSWORD_GENERATE, KEYGRAIN_PASSWORD_FILL,
        KEYGRAIN_PASSWORD_SELECTION_TTL_MS, KEYGRAIN_PASSWORD_DELIVERY_TTL_MS,
        KEYGRAIN_TOTP_OPTIONS, KEYGRAIN_TOTP_GENERATE, KEYGRAIN_TOTP_FILL, KEYGRAIN_TOTP_CAPABILITY_TTL_MS,
        KEYGRAIN_TOTP_DELIVERY_TTL_MS, KEYGRAIN_TOTP_MAX_ITEMS, KEYGRAIN_TOTP_MAX_FIELD_UTF8,
        KEYGRAIN_TOTP_MAX_RESPONSE_BYTES, KEYGRAIN_TOTP_MAX_SEED_BYTES, KEYGRAIN_TOTP_MAX_CODE_DIGITS,
        KEYGRAIN_SSH_OPTIONS, KEYGRAIN_SSH_GENERATE, KEYGRAIN_WALLET_OPTIONS, KEYGRAIN_WALLET_GENERATE,
        KEYGRAIN_B3_CAPABILITY_TTL_MS, KEYGRAIN_B3_MAX_ITEMS, KEYGRAIN_B3_MAX_FIELD_UTF8, KEYGRAIN_B3_MAX_RESPONSE_BYTES, KEYGRAIN_B3_MAX_TOKEN_UTF8, KEYGRAIN_B3_MAX_EMAIL_UTF8,
        KEYGRAIN_WALLET_MAX_NAME_UTF8, KEYGRAIN_WALLET_MAX_MNEMONIC_UTF8, KEYGRAIN_WALLET_ERROR,
        KEYGRAIN_SSH_MAX_KEY_NAME_UTF8, KEYGRAIN_SSH_MAX_AUTHORIZED_KEYS_UTF8, KEYGRAIN_SSH_MAX_PRIVATE_KEY_PEM_UTF8,
      }),
    });
  }

  root.KeygrainBrowserOwner = Object.freeze({
    AUTH_PROTOCOL_ERROR,
    CONTEXT_ERROR,
    UNLOCK_FAILED,
    OPERATION_ERROR,
    CONSUMER_MIGRATION_REQUIRED,
    KEYGRAIN_POPUP_STATE,
    KEYGRAIN_POPUP_METADATA,
    KEYGRAIN_POPUP_SERVICE_LIST,
    KEYGRAIN_POPUP_SELECTION_OPTIONS, KEYGRAIN_POPUP_DETAIL, KEYGRAIN_POPUP_EDIT, KEYGRAIN_POPUP_ADD, KEYGRAIN_POPUP_DELETE, KEYGRAIN_POPUP_SETTINGS, KEYGRAIN_POPUP_LOCK_SENSITIVE, KEYGRAIN_POPUP_LOCK_EVERYTHING,
    KEYGRAIN_POPUP_CAPABILITY_TTL_MS,
    KEYGRAIN_POPUP_MAX_ITEMS,
    KEYGRAIN_POPUP_MAX_FIELD_UTF8,
    KEYGRAIN_POPUP_MAX_RESPONSE_BYTES,
    KEYGRAIN_PASSWORD_OPTIONS,
    KEYGRAIN_PASSWORD_GENERATE,
    KEYGRAIN_PASSWORD_FILL,
    KEYGRAIN_PASSWORD_SELECTION_TTL_MS,
    KEYGRAIN_PASSWORD_DELIVERY_TTL_MS,
    KEYGRAIN_TOTP_OPTIONS,
    KEYGRAIN_TOTP_GENERATE,
    KEYGRAIN_TOTP_FILL,
    KEYGRAIN_TOTP_CAPABILITY_TTL_MS,
    KEYGRAIN_TOTP_DELIVERY_TTL_MS,
    KEYGRAIN_TOTP_MAX_ITEMS,
    KEYGRAIN_TOTP_MAX_FIELD_UTF8,
    KEYGRAIN_TOTP_MAX_RESPONSE_BYTES,
    KEYGRAIN_TOTP_MAX_SEED_BYTES,
    KEYGRAIN_TOTP_MAX_CODE_DIGITS,
    KEYGRAIN_SSH_OPTIONS, KEYGRAIN_SSH_GENERATE, KEYGRAIN_WALLET_OPTIONS, KEYGRAIN_WALLET_GENERATE,
    KEYGRAIN_B3_CAPABILITY_TTL_MS, KEYGRAIN_B3_MAX_ITEMS, KEYGRAIN_B3_MAX_FIELD_UTF8, KEYGRAIN_B3_MAX_RESPONSE_BYTES, KEYGRAIN_B3_MAX_TOKEN_UTF8, KEYGRAIN_B3_MAX_EMAIL_UTF8,
    KEYGRAIN_WALLET_MAX_NAME_UTF8, KEYGRAIN_WALLET_MAX_MNEMONIC_UTF8, KEYGRAIN_WALLET_ERROR,
    KEYGRAIN_SSH_MAX_KEY_NAME_UTF8, KEYGRAIN_SSH_MAX_AUTHORIZED_KEYS_UTF8, KEYGRAIN_SSH_MAX_PRIVATE_KEY_PEM_UTF8,
    SSH_ACTIONS: Object.freeze([...KEYGRAIN_SSH_ACTIONS]),
    WALLET_ACTIONS: Object.freeze([...KEYGRAIN_WALLET_ACTIONS]),
    TOTP_ACTIONS: Object.freeze([...KEYGRAIN_TOTP_ACTIONS]),
    KEYGRAIN_PASSWORD_MAX_FIELD_UTF8,
    KEYGRAIN_PASSWORD_MAX_RESPONSE_BYTES,
    KEYGRAIN_PASSWORD_MAX_SYMBOLS,
    KEYGRAIN_PASSWORD_MAX_OUTPUT_UTF8,
    KEYGRAIN_PASSWORD_MAX_EMAIL_UTF8,
    PASSWORD_ACTIONS: Object.freeze([...KEYGRAIN_PASSWORD_ACTIONS]),
    POPUP_RESERVED_ACTIONS: Object.freeze([...POPUP_RESERVED_ACTIONS]),
    PRIVILEGED_ACTIONS: Object.freeze([...PRIVILEGED_ACTIONS]),
    normalizeEmail,
    validateUnlockMessage,
    validateConfirmationMessage,
    normalizeSettings,
    loadSecuritySettings,
    saveSecuritySettings,
    cleanupLegacyPreferences,
    isTrustedExtensionPage,
    peekPopupAction,
    isExactPopupRequest,
    rejectUntrustedOrLegacy,
    makeContext,
    contextMatches,
    proveContext,
    createOwner,
    safeFailure,
    safeErrorResponse,
    success,
  });
})(typeof globalThis === "undefined" ? this : globalThis);
