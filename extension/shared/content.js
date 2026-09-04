// Keygrain B1 content boundary. This file is a DOM adapter only: the worker owns
// service selection, derivation, proof binding, and the only credential payload.
if (!window.__keygrain_injected) {
  window.__keygrain_injected = true;
  const runtime = globalThis.browser?.runtime || globalThis.chrome?.runtime;
  const KEYGRAIN_PASSWORD_DELIVERY_TTL_MS = 5000;
  const KEYGRAIN_PASSWORD_MAX_OUTPUT_UTF8 = 128;
  const KEYGRAIN_PASSWORD_MAX_EMAIL_UTF8 = 254;
  const KEYGRAIN_SAFE_FAILURE = Object.freeze({ok: false, code: "KEYGRAIN_CONTEXT_ERROR", message: "This action is not available from this context."});
  const KEYGRAIN_MIGRATION_FAILURE = Object.freeze({ok: false, code: "KEYGRAIN_CONSUMER_MIGRATION_REQUIRED", message: "Update Keygrain to continue."});
  let documentNonce = null;
  let slot = {documentNonce: null, pendingChallenge: null, pendingDeliveryNonce: null, proven: null, timer: null};
  let totpSlot = {documentNonce: null, pendingChallenge: null, pendingDeliveryNonce: null, proven: null, timer: null};
  const KEYGRAIN_TOTP_MAX_FIELD_UTF8 = 256;
  const KEYGRAIN_TOTP_DELIVERY_TTL_MS = 5000;
  const KEYGRAIN_TOTP_SAFE_FAILURE = Object.freeze({ok: false, code: "KEYGRAIN_CONTEXT_ERROR", message: "This action is not available from this context."});
  const KEYGRAIN_TOTP_PROTOCOL_FAILURE = Object.freeze({ok: false, code: "KEYGRAIN_AUTH_PROTOCOL_ERROR", message: "Invalid authentication request."});
  const KEYGRAIN_TOTP_DELIVERY_FAILURE = Object.freeze({ok: false, code: "KEYGRAIN_TOTP_DELIVERY_ERROR", message: "The TOTP code could not be delivered."});

  function randomNonce() {
    try {
      if (!globalThis.crypto || typeof crypto.getRandomValues !== "function") return null;
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      let value = "";
      for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
      bytes.fill(0);
      return value;
    } catch (_) { return null; }
  }
  documentNonce = randomNonce();
  slot.documentNonce = documentNonce;

  function exactData(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
        const standardKeys = Reflect.ownKeys(Object.prototype);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")
          || typeof descriptor.value !== "function" || descriptor.value.name !== "Object"
          || Reflect.ownKeys(prototype).length !== standardKeys.length
          || Reflect.ownKeys(prototype).some(key => !standardKeys.includes(key))) return false;
      }
    } catch (_) { return false; }
    let ownKeys;
    try { ownKeys = Reflect.ownKeys(value); } catch (_) { return false; }
    if (ownKeys.length !== keys.length || ownKeys.some((key, index) => key !== keys[index])) return false;
    return keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor && descriptor.enumerable && Object.prototype.hasOwnProperty.call(descriptor, "value");
    });
  }

  function workerSenderURL() {
    try {
      if (!runtime || typeof runtime.getURL !== "function") return null;
      return globalThis.browser?.runtime ? runtime.getURL("background.js") : runtime.getURL("/");
    } catch (_) { return null; }
  }

  function validWorkerSender(sender) {
    try {
      if (!runtime || !sender || sender.id !== runtime.id) return false;
      if (typeof sender.url === "string" && sender.url) {
        const workerUrl = workerSenderURL();
        if (workerUrl && sender.url !== workerUrl && !sender.url.startsWith(runtime.getURL(""))) {
          return false;
        }
      }
      return true;
    } catch (_) { return false; }
  }

  function validPageContext() {
    try { return location.protocol === "http:" || location.protocol === "https:"; } catch (_) { return false; }
  }

  function clearSlot() {
    if (slot.timer) clearTimeout(slot.timer);
    slot = {documentNonce, pendingChallenge: null, pendingDeliveryNonce: null, proven: null, timer: null};
  }

  function armSlot(challenge, deliveryNonce, sender) {
    clearSlot();
    slot.pendingChallenge = challenge;
    slot.pendingDeliveryNonce = deliveryNonce;
    const tabId = sender && sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : null;
    const frameId = sender && Number.isInteger(sender.frameId) ? sender.frameId : null;
    slot.proven = {
      challenge, deliveryNonce, senderTabId: tabId, senderFrameId: frameId,
      pageOrigin: location.origin, senderDocumentIdOrNull: sender && sender.documentId !== undefined ? sender.documentId : null,
    };
    slot.timer = setTimeout(clearSlot, KEYGRAIN_PASSWORD_DELIVERY_TTL_MS);
  }

  function clearTotpSlot() {
    if (totpSlot.timer) clearTimeout(totpSlot.timer);
    totpSlot = {documentNonce, pendingChallenge: null, pendingDeliveryNonce: null, proven: null, timer: null};
  }

  function armTotpSlot(challenge, deliveryNonce, sender) {
    clearTotpSlot();
    totpSlot.pendingChallenge = challenge;
    totpSlot.pendingDeliveryNonce = deliveryNonce;
    const tabId = sender && sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : null;
    const frameId = sender && Number.isInteger(sender.frameId) ? sender.frameId : null;
    totpSlot.proven = {
      challenge, deliveryNonce, senderTabId: tabId, senderFrameId: frameId,
      pageOrigin: location.origin, senderDocumentIdOrNull: sender && sender.documentId !== undefined ? sender.documentId : null,
    };
    totpSlot.timer = setTimeout(clearTotpSlot, KEYGRAIN_TOTP_DELIVERY_TTL_MS);
  }

  function boundedTotpText(value) {
    if (typeof value !== "string" || !value) return false;
    try { return new TextEncoder().encode(value).byteLength <= KEYGRAIN_TOTP_MAX_FIELD_UTF8; } catch (_) { return false; }
  }

  function handleTotpProbe(message, sender, sendResponse) {
    if (!validWorkerSender(sender) || !validPageContext()
      || !exactData(message, ["action", "challenge", "deliveryNonce"])
      || message.action !== "keygrain.totp.contextProbe" || !boundedTotpText(message.challenge)
      || !boundedTotpText(message.deliveryNonce) || !documentNonce) return false;
    let hasOtpField = false;
    try {
      const {descriptors} = fieldDescriptors();
      const key = KeygrainAutofill.pickOtpField(descriptors);
      const descriptor = key === null || key === undefined ? null : descriptors[key];
      hasOtpField = !!descriptor && descriptor.visible === true && descriptor.disabled !== true
        && descriptor.readOnly !== true && KeygrainAutofill.isOtpDescriptor(descriptor);
    } catch (_) { clearTotpSlot(); return false; }
    if (!hasOtpField) return false;
    armTotpSlot(message.challenge, message.deliveryNonce, sender);
    const proof = {action: "keygrain.totp.contextProof", challenge: message.challenge, nonce: documentNonce, hasOtpField: true};
    sendProof(proof);
    sendResponse(proof);
    return true;
  }

  function handleTotpDelivery(message, sender, sendResponse) {
    const shapeValid = exactData(message, ["action", "deliveryNonce", "code"]);
    const senderTabId = sender && sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : null;
    const senderFrameId = sender && Number.isInteger(sender.frameId) ? sender.frameId : null;
    if (!validWorkerSender(sender) || !validPageContext() || !totpSlot.proven
      || senderTabId !== totpSlot.proven.senderTabId || senderFrameId !== totpSlot.proven.senderFrameId
      || (sender && sender.documentId !== undefined ? sender.documentId : null) !== totpSlot.proven.senderDocumentIdOrNull
      || totpSlot.proven.pageOrigin !== location.origin || !shapeValid
      || message.action !== "keygrain.totp.fillResult" || message.deliveryNonce !== totpSlot.proven.deliveryNonce) {
      clearTotpSlot();
      const failure = shapeValid ? KEYGRAIN_TOTP_SAFE_FAILURE : KEYGRAIN_TOTP_PROTOCOL_FAILURE;
      sendResponse(failure);
      return true;
    }
    if (!/^[0-9]{6}$|^[0-9]{8}$/.test(message.code)) {
      clearTotpSlot(); sendResponse(KEYGRAIN_TOTP_DELIVERY_FAILURE); return true;
    }
    let field = null;
    try {
      const {descriptors, els} = fieldDescriptors();
      const key = KeygrainAutofill.pickOtpField(descriptors);
      if (key === null || key === undefined || !els[key] || descriptors[key]?.visible !== true
        || descriptors[key]?.disabled === true || descriptors[key]?.readOnly === true
        || !KeygrainAutofill.isOtpDescriptor(descriptors[key])
        || !KeygrainAutofill.otpCodeFitsField(message.code.length, descriptors[key]?.maxlength)) {
        clearTotpSlot(); sendResponse(KEYGRAIN_TOTP_DELIVERY_FAILURE); return true;
      }
      field = els[key];
    } catch (_) { clearTotpSlot(); sendResponse(KEYGRAIN_TOTP_DELIVERY_FAILURE); return true; }
    clearTotpSlot();
    try {
      fillField(field, message.code);
    } catch (_) { sendResponse(KEYGRAIN_TOTP_DELIVERY_FAILURE); return true; }
    const response = {ok: true, result: {codeFilled: true}};
    sendProof(response);
    sendResponse(response);
    return true;
  }

  function fieldDescriptors() {
    const els = Array.from(document.querySelectorAll("input"));
    const active = document.activeElement;
    const descriptors = els.map((el, index) => {
      const descriptor = KeygrainAutofill.describeField(el, active);
      descriptor.key = index;
      return descriptor;
    });
    return {descriptors, els};
  }

  function fillField(field, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", {bubbles: true}));
    field.dispatchEvent(new Event("change", {bubbles: true}));
  }

  function b1Fill(password, email) {
    const {descriptors, els} = fieldDescriptors();
    const passwordKey = KeygrainAutofill.pickPasswordField(descriptors);
    const usernameKey = email === null ? null : KeygrainAutofill.pickUsernameField(descriptors);
    const passwordField = passwordKey === null || passwordKey === undefined ? null : els[passwordKey];
    const usernameField = usernameKey === null || usernameKey === undefined ? null : els[usernameKey];
    let emailFilled = false;
    if (usernameField && email !== null) { fillField(usernameField, email); emailFilled = true; }
    let passwordFilled = false;
    if (passwordField) { fillField(passwordField, password); passwordFilled = true; }
    return {passwordFilled, emailFilled};
  }

  function safeText(value, max) {
    if (typeof value !== "string") return false;
    try { return new TextEncoder().encode(value).byteLength <= max; } catch (_) { return false; }
  }

  function sendProof(proof) {
    try { if (runtime && typeof runtime.sendMessage === "function") void Promise.resolve(runtime.sendMessage(proof)).catch(() => {}); } catch (_) {}
  }

  function handleProbe(message, sender, sendResponse) {
    if (!validWorkerSender(sender) || !validPageContext() || !exactData(message, ["action", "challenge", "deliveryNonce"])
      || message.action !== "keygrain.password.contextProbe" || !safeText(message.challenge, 256)
      || !message.challenge || !safeText(message.deliveryNonce, 256) || !message.deliveryNonce
      || !documentNonce) return false;
    armSlot(message.challenge, message.deliveryNonce, sender);
    let hasPasswordField = false;
    let hasUsernameField = false;
    try {
      const {descriptors} = fieldDescriptors();
      hasPasswordField = descriptors.some(descriptor => KeygrainAutofill.isPasswordDescriptor(descriptor));
      hasUsernameField = descriptors.some(descriptor => KeygrainAutofill.isFillableUsernameDescriptor(descriptor));
    } catch (_) { clearSlot(); return false; }
    const proof = {action: "keygrain.password.contextProof", challenge: message.challenge, nonce: documentNonce, hasPasswordField, hasUsernameField};
    sendProof(proof);
    sendResponse(proof);
    return true;
  }

  function handleDelivery(message, sender, sendResponse) {
    const senderTabId = sender && sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : null;
    const senderFrameId = sender && Number.isInteger(sender.frameId) ? sender.frameId : null;
    if (!validWorkerSender(sender) || !validPageContext() || !slot.proven
      || senderTabId !== slot.proven.senderTabId || senderFrameId !== slot.proven.senderFrameId
      || (sender && sender.documentId !== undefined ? sender.documentId : null) !== slot.proven.senderDocumentIdOrNull
      || slot.proven.pageOrigin !== location.origin || !exactData(message, ["action", "deliveryNonce", "password", "email"])
      || message.action !== "keygrain.password.fillResult" || message.deliveryNonce !== slot.proven.deliveryNonce) {
      clearSlot();
      sendResponse(!exactData(message, ["action", "deliveryNonce", "password", "email"]) || message?.action !== "keygrain.password.fillResult"
        ? {ok: false, code: "KEYGRAIN_AUTH_PROTOCOL_ERROR", message: "Invalid authentication request."} : KEYGRAIN_SAFE_FAILURE);
      return true;
    }
    if (typeof message.password !== "string" || message.password.length < 8 || message.password.length > 128
      || !safeText(message.password, KEYGRAIN_PASSWORD_MAX_OUTPUT_UTF8)
      || !(message.email === null || (safeText(message.email, KEYGRAIN_PASSWORD_MAX_EMAIL_UTF8) && message.email.length > 0))) {
      clearSlot();
      const failure = {ok: false, code: "KEYGRAIN_FILL_DELIVERY_ERROR", message: "The password could not be filled."};
      sendProof(failure);
      sendResponse(failure);
      return true;
    }
    const proven = slot.proven;
    clearSlot();
    let result;
    try { result = b1Fill(message.password, message.email); }
    catch (_) {
      const failure = {ok: false, code: "KEYGRAIN_FILL_DELIVERY_ERROR", message: "The password could not be filled."};
      sendProof(failure);
      sendResponse(failure);
      return true;
    }
    const response = {ok: true, result: {passwordFilled: result.passwordFilled, emailFilled: result.emailFilled}};
    sendProof(response);
    void proven;
    sendResponse(response);
    return true;
  }

  function onMessage(message, sender, sendResponse) {
    const action = (() => {
      try {
        const descriptor = message && typeof message === "object" ? Object.getOwnPropertyDescriptor(message, "action") : null;
        return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value") ? descriptor.value : null;
      } catch (_) { return null; }
    })();
    if (action === "keygrain.password.contextProbe") return handleProbe(message, sender, sendResponse);
    if (action === "keygrain.password.fillResult") return handleDelivery(message, sender, sendResponse);
    if (action === "keygrain.totp.contextProbe") return handleTotpProbe(message, sender, sendResponse);
    if (action === "keygrain.totp.fillResult") return handleTotpDelivery(message, sender, sendResponse);
    if (action === "fill" || action === "fillContextMenu" || action === "fillOtp" || action === "getFillContext") {
      sendResponse(KEYGRAIN_MIGRATION_FAILURE);
      return true;
    }
    return false;
  }

  if (runtime?.onMessage?.addListener) runtime.onMessage.addListener(onMessage);
  window.addEventListener?.("pagehide", () => { clearSlot(); clearTotpSlot(); });
}
