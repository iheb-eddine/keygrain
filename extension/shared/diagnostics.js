/* Keygrain DEV-only diagnostics. Fixed labels only; never log caller data. */
(function installKeygrainDiagnostics(root) {
  "use strict";

  const DEV_MANIFEST_NAME = "Keygrain DEV";
  const CATEGORIES = Object.freeze([
    "popup_message_transport_failure",
    "background_startup_rejection",
    "worker_response_error",
  ]);
  const SAFE_CODES = Object.freeze([
    "KEYGRAIN_AUTH_PROTOCOL_ERROR",
    "KEYGRAIN_CONTEXT_ERROR",
    "KEYGRAIN_UNLOCK_FAILED",
    "KEYGRAIN_OPERATION_ERROR",
    "KEYGRAIN_CONSUMER_MIGRATION_REQUIRED",
    "KEYGRAIN_SETTINGS_STORAGE_ERROR",
    "KEYGRAIN_SETTINGS_ERROR",
    "KEYGRAIN_CONFIRMATION_ERROR",
    "KEYGRAIN_METADATA_ERROR",
    "KEYGRAIN_CLOCK_ROLLBACK",
    "KEYGRAIN_EXPIRED",
    "KEYGRAIN_STALE_OPERATION",
    "KEYGRAIN_INVALIDATION_ERROR",
    "KEYGRAIN_DERIVATION_ERROR",
    "KEYGRAIN_FILL_DELIVERY_ERROR",
    "KEYGRAIN_TOTP_ERROR",
    "KEYGRAIN_TOTP_DELIVERY_ERROR",
    "KEYGRAIN_SSH_ERROR",
    "KEYGRAIN_WALLET_ERROR",
    "ACCOUNT_NOT_FOUND",
    "ACCOUNT_EXISTS",
  ]);
  const categorySet = new Set(CATEGORIES);
  const safeCodeSet = new Set(SAFE_CODES);

  function runtimeApi() {
    try {
      return root.chrome?.runtime || root.browser?.runtime || null;
    } catch (_) {
      return null;
    }
  }

  function isEnabled() {
    try {
      const runtime = runtimeApi();
      return runtime !== null
        && typeof runtime.getManifest === "function"
        && runtime.getManifest()?.name === DEV_MANIFEST_NAME;
    } catch (_) {
      return false;
    }
  }

  function mapWorkerResponseCode(response) {
    try {
      if (!response || typeof response !== "object" || Array.isArray(response)) return "UNKNOWN";
      const code = response.code;
      return typeof code === "string" && safeCodeSet.has(code) ? code : "UNKNOWN";
    } catch (_) {
      return "UNKNOWN";
    }
  }

  function record(category, code) {
    if (!categorySet.has(category) || !isEnabled()) return false;
    try {
      const sink = root.console?.debug;
      if (typeof sink !== "function") return false;
      if (category === "worker_response_error") {
        const safeCode = safeCodeSet.has(code) ? code : "UNKNOWN";
        sink.call(root.console, "[Keygrain diagnostic]", category, safeCode);
      } else {
        sink.call(root.console, "[Keygrain diagnostic]", category);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function recordWorkerResponse(response) {
    return record("worker_response_error", mapWorkerResponseCode(response));
  }

  const diagnosticsInstance = Object.freeze({
    DEV_MANIFEST_NAME,
    CATEGORIES,
    SAFE_CODES,
    isEnabled,
    mapWorkerResponseCode,
    record,
    recordWorkerResponse,
  });

  root.KeygrainDiagnostics = diagnosticsInstance;
  // Aliased for backward compatibility if needed
  root.KeygrainDiagnostics = diagnosticsInstance;
})(globalThis);
