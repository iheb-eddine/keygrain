// Keygrain worker-owned observed-causality update version helper.
// This module is intentionally independent of popup, storage, sync, and crypto.
(function installKeygrainWorkerUpdateVersion(root) {
  "use strict";

  const MAX_SAFE = Number.MAX_SAFE_INTEGER;
  const UPDATE_VERSION_ERROR = "KEYGRAIN_OPERATION_ERROR";

  function fail() {
    const error = new Error(UPDATE_VERSION_ERROR);
    error.code = UPDATE_VERSION_ERROR;
    throw error;
  }

  function plainData(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      return prototype === null || prototype === Object.prototype;
    } catch (_) {
      return false;
    }
  }

  function ownData(value, key) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) fail();
    return descriptor.value;
  }

  function safeFloor(value, allowUndefined = false) {
    if (allowUndefined && value === undefined) return 0;
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE) fail();
    return value;
  }

  function createWorkerUpdateVersion({nowMs} = {}) {
    if (typeof nowMs !== "function") fail();
    let lastIssuedVersion = 0;

    function next(input) {
      if (!plainData(input)) fail();
      let keys;
      try { keys = Reflect.ownKeys(input); } catch (_) { fail(); }
      if (keys.length !== 3 || keys[0] !== "targetVersion"
        || keys[1] !== "localKnownVersion" || keys[2] !== "remoteKnownVersion") fail();

      const targetVersion = safeFloor(ownData(input, "targetVersion"), true);
      const localKnownVersion = safeFloor(ownData(input, "localKnownVersion"));
      const remoteKnownVersion = safeFloor(ownData(input, "remoteKnownVersion"));

      let reading;
      try { reading = nowMs(); } catch (_) { fail(); }
      if (typeof reading !== "number" || !Number.isFinite(reading) || reading < 0 || reading > MAX_SAFE) fail();
      const clockFloor = Math.floor(reading);
      const floor = Math.max(targetVersion, localKnownVersion, remoteKnownVersion, lastIssuedVersion, 0);
      if (floor >= MAX_SAFE) fail();
      const assignedVersion = Math.max(clockFloor, floor + 1);
      if (!Number.isSafeInteger(assignedVersion) || assignedVersion < 0 || assignedVersion > MAX_SAFE) fail();
      lastIssuedVersion = assignedVersion;
      return assignedVersion;
    }

    return Object.freeze({next});
  }

  if (typeof root !== "undefined") {
    root.KeygrainWorkerUpdateVersion = Object.freeze({createWorkerUpdateVersion});
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
