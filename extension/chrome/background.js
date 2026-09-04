// background.js — Chrome MV3 service worker
importScripts("worker-update-version.js", "lib/public_suffix_list.js", "public-suffix.js", "lib/hash-wasm-argon2.js", "keygrain.js", "unlock-state.js", "popup-crypto.js", "worker-ingress.js", "lib/tweetnacl.js", "ssh.js", "bip39-wordlist.js", "wallet.js", "browser-owner.js", "diagnostics.js", "totp.js", "sync.js", "autofill.js", "inline-autofill.js");

const KEYGRAIN_DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  fullLeaseSeconds: 60,
  metadataTailSeconds: 14400,
});
const KEYGRAIN_PHASE_B_ACTION = "KEYGRAIN_CONSUMER_MIGRATION_REQUIRED";

function chromeExtensionOrigin() {
  try {
    const parsed = new URL(chrome.runtime.getURL(""));
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch (_) {
    return null;
  }
}

const KEYGRAIN_EXTENSION_ORIGIN = chromeExtensionOrigin();
const INLINE_SCRIPT_ID = "keygrain-inline";
const INLINE_JS = ["lib/public_suffix_list.js", "public-suffix.js", "autofill.js", "inline-autofill.js", "inline-autofill-ui.js", "content.js"];
let chromeInlineRegistered = false;
let chromeRegistrationUnknown = false;
let chromeIndicatorUnknown = false;

function chromeAdapterError() {
  return Object.assign(new Error("adapter_failure"), {code: "KEYGRAIN_ADAPTER_ERROR"});
}

function chromeHost(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch (_) { return null; }
}

function chromeSiteMatches(site, host) {
  if (!site || !host || !globalThis.KeygrainAutofill
    || typeof globalThis.KeygrainAutofill.isSafeMatchingSite !== "function") return false;
  try {
    return globalThis.KeygrainAutofill.isSafeMatchingSite(site, host)
      && (site === host || host.endsWith("." + site));
  } catch (_) { return false; }
}

async function chromeClearBadges(check) {
  let tabs;
  try { tabs = await chrome.tabs.query({}); check(); }
  catch (error) {
    if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
    chromeIndicatorUnknown = true;
    throw chromeAdapterError();
  }
  for (const tab of tabs || []) {
    if (tab.id == null) continue;
    try { check(); await Promise.resolve(chrome.action.setBadgeText({text: "", tabId: tab.id})); check(); }
    catch (error) {
      if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
      chromeIndicatorUnknown = true;
      throw chromeAdapterError();
    }
  }
}

async function chromeUnregister(check) {
  if (!chromeInlineRegistered && !chromeRegistrationUnknown) return;
  try {
    check();
    await Promise.resolve(chrome.scripting.unregisterContentScripts({ids: [INLINE_SCRIPT_ID]}));
    check();
    chromeInlineRegistered = false;
    chromeRegistrationUnknown = false;
  } catch (error) {
    if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
    chromeRegistrationUnknown = true;
    throw chromeAdapterError();
  }
}

async function chromeCommitPopupEdit(payload) {
  if (!payload || !payload.email || !payload.secret || !payload.fullData) {
    throw KeygrainBrowserOwner.safeFailure("KEYGRAIN_STALE_OPERATION");
  }
  await persistV2(payload.email, payload.secret, payload.fullData);
  syncWithServer(payload.secret, payload.email, payload.fullData.services, payload.fullData.wallets, payload.fullData.walletAuditLog || [], payload.fullData.tombstones || []).catch(() => {});
  return {ok: true};
}

async function chromeCommitPopupAdd(payload) {
  if (!payload || !payload.email || !payload.secret || !payload.fullData) {
    throw KeygrainBrowserOwner.safeFailure("KEYGRAIN_STALE_OPERATION");
  }
  await persistV2(payload.email, payload.secret, payload.fullData);
  syncWithServer(payload.secret, payload.email, payload.fullData.services, payload.fullData.wallets, payload.fullData.walletAuditLog || [], payload.fullData.tombstones || []).catch(() => {});
  return {ok: true};
}

async function chromeCommitPopupDelete(payload) {
  if (!payload || !payload.email || !payload.secret || !payload.fullData) {
    throw KeygrainBrowserOwner.safeFailure("KEYGRAIN_STALE_OPERATION");
  }
  await persistV2(payload.email, payload.secret, payload.fullData);
  syncWithServer(payload.secret, payload.email, payload.fullData.services, payload.fullData.wallets, payload.fullData.walletAuditLog || [], payload.fullData.tombstones || []).catch(() => {});
  return {ok: true};
}

async function chromeReconcileIndicators({after, projection, check}) {
  try {
    check();
    await Promise.resolve(chrome.alarms.clear("keygrain-state-wake"));
    check();
    const deadline = after && (after.state === "full" ? after.fullExpiresAt : after.state === "metadata" ? after.metadataExpiresAt : null);

    const sessionStore = chrome.storage?.session;
    if (sessionStore && after) {
      const sessionData = await sessionStore.get("keygrainSession");
      const session = sessionData?.keygrainSession;
      if (session && session.email) {
        if (after.state === "locked") {
          await sessionStore.remove("keygrainSession");
        } else {
          const settings = await chromeOwner.loadSettings();
          const metaTailSec = settings?.metadataTailSeconds !== undefined ? settings.metadataTailSeconds : (KEYGRAIN_DEFAULT_SETTINGS?.metadataTailSeconds || 28500);
          const fullExpiresAt = after.state === "full" ? after.fullExpiresAt : null;
          const metadataTailAnchor = after.metadataExpiresAt || (fullExpiresAt ? fullExpiresAt + metaTailSec * 1000 : null);
          const metadata = extractMetadata();
          await sessionStore.set({
            keygrainSession: {
              ...session,
              secret: (after.state === "full" && session.secret) ? session.secret : null,
              fullExpiresAt,
              metadataExpiresAt: after.metadataExpiresAt,
              metadataTailAnchor,
              metadata,
            }
          });
        }
      }
    }
    if (deadline !== null && deadline !== undefined) {
      check();
      await Promise.resolve(chrome.alarms.create("keygrain-state-wake", {when: deadline}));
      check();
    }
  } catch (error) {
    if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
  }
  try { await chromeUnregister(check); }
  catch (error) {
    if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
    try { await chromeClearBadges(check); } catch (cleanupError) {
      if (cleanupError?.code === "KEYGRAIN_STALE_OPERATION") throw cleanupError;
    }
    return;
  }
  if (chromeRegistrationUnknown || chromeIndicatorUnknown) return;
  const state = after && after.state;
  let enabled = false;
  if (state === "full" || state === "metadata") {
    try {
      const s = await chrome.storage.local.get("settings");
      check();
      const raw = await chrome.storage.local.get("inlineAutofillEnabled");
      check();
      enabled = Boolean(s?.settings?.inPageAutofill ?? s?.settings?.inlineAutofillEnabled ?? raw?.inlineAutofillEnabled ?? false);
    } catch (error) {
      if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
      await chromeClearBadges(check);
      return;
    }
  }
  const matches = projection && Array.isArray(projection.matches) ? projection.matches : [];
  try {
    if (enabled && matches.length) {
      check();
      await Promise.resolve(chrome.scripting.registerContentScripts([{
        id: INLINE_SCRIPT_ID,
        matches,
        js: INLINE_JS,
        runAt: "document_idle",
        allFrames: false,
        persistAcrossSessions: false,
        world: "ISOLATED",
      }]));
      chromeInlineRegistered = true;
      check();
      let tabs = [];
      try { tabs = await chrome.tabs.query({}); check(); } catch (error) {
        if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
        throw chromeAdapterError();
      }
      const sites = projection && Array.isArray(projection.badgeSites) ? projection.badgeSites : [];
      for (const tab of tabs || []) {
        const host = chromeHost(tab.url);
        if (tab.id == null || !host || !sites.some(site => chromeSiteMatches(site, host))) continue;
        try {
          check();
          await Promise.resolve(chrome.scripting.executeScript({target: {tabId: tab.id}, files: INLINE_JS}));
          check();
        } catch (error) {
          if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
          throw chromeAdapterError();
        }
      }
    }
    let tabs = [];
    try { tabs = await chrome.tabs.query({}); check(); } catch (error) {
      if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
      throw chromeAdapterError();
    }
    const sites = projection && Array.isArray(projection.badgeSites) ? projection.badgeSites : [];
    for (const tab of tabs || []) {
      if (tab.id == null) continue;
      const host = chromeHost(tab.url);
      const count = (state === "full" || state === "metadata") && host
        ? sites.filter(site => chromeSiteMatches(site, host)).length : 0;
      try {
        check();
        await Promise.resolve(chrome.action.setBadgeText({text: count ? String(count) : "", tabId: tab.id}));
        check();
      } catch (error) {
        if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
        throw chromeAdapterError();
      }
    }
  } catch (error) {
    if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
    // Registration/badge APIs are advisory. Remove the registration and clear
    // indicators before returning a safe-disabled result.
    try { await chromeUnregister(check); } catch (cleanupError) {
      if (cleanupError?.code === "KEYGRAIN_STALE_OPERATION") throw cleanupError;
    }
    try { await chromeClearBadges(check); } catch (cleanupError) {
      if (cleanupError?.code === "KEYGRAIN_STALE_OPERATION") throw cleanupError;
    }
  }
}

async function chromeShutdown() {
  try {
    const registered = await Promise.resolve(chrome.scripting.getRegisteredContentScripts({ids: [INLINE_SCRIPT_ID]}));
    if (Array.isArray(registered) && registered.length) {
      await Promise.resolve(chrome.scripting.unregisterContentScripts({ids: [INLINE_SCRIPT_ID]}));
    }
    chromeInlineRegistered = false;
    chromeRegistrationUnknown = false;
  } catch (_) {
    chromeRegistrationUnknown = true;
  }
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs || []) if (tab.id != null) {
      await Promise.resolve(chrome.action.setBadgeText({text: "", tabId: tab.id}));
    }
    chromeIndicatorUnknown = false;
  } catch (_) {
    chromeIndicatorUnknown = true;
  }
}

const chromePasswordBindings = new Map();
const chromePasswordPendingProofs = new Map();
const chromePasswordPendingDeliveries = new Map();

function chromeExact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")
        || typeof descriptor.value !== "function" || descriptor.value.name !== "Object"
        || Reflect.ownKeys(prototype).some(key => !Reflect.ownKeys(Object.prototype).includes(key)
          || Reflect.ownKeys(prototype).length !== Reflect.ownKeys(Object.prototype).length)) return false;
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

function chromeRandomNonce() {
  try {
    if (!globalThis.crypto || typeof crypto.getRandomValues !== "function") throw new Error("random");
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    let result = "";
    for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
    bytes.fill(0);
    return result;
  } catch (_) { throw chromeAdapterError(); }
}

async function chromeCurrentPasswordTab() {
  let validTabs = [];
  try {
    const queries = [
      {active: true, lastFocusedWindow: true, windowType: "normal"},
      {active: true, lastFocusedWindow: true},
      {active: true, currentWindow: true, windowType: "normal"},
      {active: true, currentWindow: true},
      {active: true, windowType: "normal"},
      {active: true},
    ];
    for (const q of queries) {
      const tabs = await chrome.tabs.query(q);
      if (Array.isArray(tabs) && tabs.length > 0) {
        const matching = tabs.filter(t => t && Number.isInteger(t.id) && t.id >= 0 && typeof t.url === "string" && (t.url.startsWith("http:") || t.url.startsWith("https:")));
        if (matching.length > 0) {
          validTabs = matching;
          break;
        }
      }
    }
  } catch (_) { throw chromeAdapterError(); }
  if (validTabs.length === 0) throw chromeAdapterError();
  const tab = validTabs[0];
  let parsed;
  try { parsed = new URL(tab.url); } catch (_) { throw chromeAdapterError(); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw chromeAdapterError();
  return Object.freeze({tabId: tab.id, frameId: 0, origin: parsed.origin, url: tab.url});
}

function chromePageSender(sender, expected, documentId) {
  if (!sender || sender.id !== chrome.runtime.id || !sender.tab
    || typeof sender.documentId !== "string" || !sender.documentId
    || !Number.isInteger(sender.tab.id) || !Number.isInteger(sender.frameId) || sender.tab.id !== expected.tabId || sender.frameId !== expected.frameId
    || typeof sender.url !== "string" || (documentId !== undefined && sender.documentId !== documentId)) return false;
  try {
    const parsed = new URL(sender.url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === expected.origin;
  } catch (_) { return false; }
}

function chromeClearBinding(deliveryNonce) {
  const binding = chromePasswordBindings.get(deliveryNonce);
  chromePasswordBindings.delete(deliveryNonce);
  chromePasswordPendingProofs.delete(deliveryNonce);
  if (binding) {
    if (binding.timer) clearTimeout(binding.timer);
    chromePasswordPendingDeliveries.delete(`${binding.tabId}:${binding.frameId}:${binding.documentId}`);
  }
  return binding;
}

function chromeReceiveProof(message, sender) {
  if (!chromeExact(message, ["action", "challenge", "nonce", "hasPasswordField", "hasUsernameField"])
    || message.action !== "keygrain.password.contextProof" || typeof message.challenge !== "string"
    || typeof message.nonce !== "string" || !message.nonce
    || typeof message.hasPasswordField !== "boolean" || typeof message.hasUsernameField !== "boolean") return false;
  for (const [deliveryNonce, pending] of chromePasswordPendingProofs) {
    if (pending.challenge !== message.challenge || !chromePageSender(sender, pending.context, sender.documentId)) continue;
    chromePasswordPendingProofs.delete(deliveryNonce);
    clearTimeout(pending.timer);
    const binding = {tabId: pending.context.tabId, frameId: pending.context.frameId, origin: pending.context.origin,
      documentId: sender.documentId, documentNonce: message.nonce, deliveryNonce};
    chromePasswordBindings.set(deliveryNonce, binding);
    binding.timer = setTimeout(() => chromeClearBinding(deliveryNonce), KeygrainBrowserOwner.KEYGRAIN_PASSWORD_DELIVERY_TTL_MS);
    pending.resolve({ok: true, binding});
    return true;
  }
  return false;
}

function chromeReceiveDelivery(message, sender) {
  if (!chromeExact(message, ["ok", "result"]) || message.ok !== true
    || !chromeExact(message.result, ["passwordFilled", "emailFilled"])
    || typeof message.result.passwordFilled !== "boolean" || typeof message.result.emailFilled !== "boolean") return false;
  for (const [key, resolve] of chromePasswordPendingDeliveries) {
    if (!resolve) continue;
    const [tabId, frameId, documentId] = key.split(":");
    const expected = {tabId: Number(tabId), frameId: Number(frameId), origin: null};
    const binding = [...chromePasswordBindings.values()].find(item => item.tabId === expected.tabId
      && item.frameId === expected.frameId && item.documentId === documentId);
    if (binding && chromePageSender(sender, binding, binding.documentId)) {
      chromePasswordPendingDeliveries.delete(key);
      clearTimeout(resolve.timer);
      resolve.resolve(message.result);
      return true;
    }
  }
  return false;
}

async function chromeGetActivePasswordContext() {
  try { return await chromeCurrentPasswordTab(); }
  catch (_) { throw Object.assign(new Error("context"), {code: "KEYGRAIN_CONTEXT_ERROR"}); }
}

async function chromeInjectBridge(context) {
  const current = await chromeCurrentPasswordTab();
  if (current.tabId !== context.tabId || current.frameId !== context.frameId || current.origin !== context.origin) {
    throw Object.assign(new Error("context"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  try {
    await Promise.resolve(chrome.scripting.executeScript({
      target: {tabId: context.tabId, frameIds: [context.frameId]},
      files: ["lib/public_suffix_list.js", "public-suffix.js", "autofill.js", "content.js"],
    }));
  } catch (_) {
    throw Object.assign(new Error("inject"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  const latest = await chromeCurrentPasswordTab();
  if (latest.tabId !== context.tabId || latest.frameId !== context.frameId || latest.origin !== context.origin) {
    throw Object.assign(new Error("context"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
}

function chromeClearPendingPasswordProof(deliveryNonce) {
  const pending = chromePasswordPendingProofs.get(deliveryNonce);
  if (!pending) return;
  chromePasswordPendingProofs.delete(deliveryNonce);
  clearTimeout(pending.timer);
}

async function chromeProvePasswordContext({context, deliveryNonce}) {
  const current = await chromeCurrentPasswordTab();
  if (current.tabId !== context.tabId || current.frameId !== context.frameId || current.origin !== context.origin) throw Object.assign(new Error("context"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  const challenge = chromeRandomNonce();
  const proof = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chromePasswordPendingProofs.delete(deliveryNonce); reject(Object.assign(new Error("timeout"), {code: "KEYGRAIN_CONTEXT_ERROR"})); }, KeygrainBrowserOwner.KEYGRAIN_PASSWORD_DELIVERY_TTL_MS);
    chromePasswordPendingProofs.set(deliveryNonce, {challenge, context, timer, resolve, reject});
  });
  const probe = {action: "keygrain.password.contextProbe", challenge, deliveryNonce};
  try {
    await chromeInjectBridge(context);
    await chrome.tabs.sendMessage(context.tabId, probe, {frameId: context.frameId !== undefined ? context.frameId : 0});
  } catch (_) {
    if (!chromePasswordBindings.has(deliveryNonce)) {
      chromeClearPendingPasswordProof(deliveryNonce);
      throw Object.assign(new Error("probe"), {code: "KEYGRAIN_CONTEXT_ERROR"});
    }
  }
  const result = await proof;
  if (!result?.binding || !chromePasswordBindings.has(deliveryNonce)) throw Object.assign(new Error("proof"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  return true;
}

async function chromeDeliverPassword({context, deliveryNonce, password, email}) {
  const binding = chromePasswordBindings.get(deliveryNonce);
  if (!binding || binding.tabId !== context.tabId || binding.frameId !== context.frameId || binding.origin !== context.origin) throw Object.assign(new Error("delivery"), {code: "KEYGRAIN_FILL_DELIVERY_ERROR"});
  const current = await chromeCurrentPasswordTab();
  if (current.tabId !== binding.tabId || current.frameId !== binding.frameId || current.origin !== binding.origin) {
    chromeClearBinding(deliveryNonce);
    throw Object.assign(new Error("navigation"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  const result = new Promise((resolve, reject) => {
    const key = `${binding.tabId}:${binding.frameId}:${binding.documentId}`;
    const timer = setTimeout(() => { chromePasswordPendingDeliveries.delete(key); chromeClearBinding(deliveryNonce); reject(Object.assign(new Error("timeout"), {code: "KEYGRAIN_FILL_DELIVERY_ERROR"})); }, KeygrainBrowserOwner.KEYGRAIN_PASSWORD_DELIVERY_TTL_MS);
    chromePasswordPendingDeliveries.set(key, {resolve, timer});
  });
  const delivery = {action: "keygrain.password.fillResult", deliveryNonce, password, email};
  try { chrome.tabs.sendMessage(binding.tabId, delivery, {frameId: binding.frameId !== undefined ? binding.frameId : 0}).catch(() => {}); }
  catch (_) { chromeClearBinding(deliveryNonce); throw Object.assign(new Error("delivery"), {code: "KEYGRAIN_FILL_DELIVERY_ERROR"}); }
  const response = await result;
  const latest = await chromeCurrentPasswordTab();
  if (latest.tabId !== binding.tabId || latest.frameId !== binding.frameId || latest.origin !== binding.origin) {
    chromeClearBinding(deliveryNonce);
    throw Object.assign(new Error("navigation"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  chromeClearBinding(deliveryNonce);
  return response;
}

function chromeShutdownPasswordBindings() {
  for (const nonce of [...chromePasswordBindings.keys()]) chromeClearBinding(nonce);
  chromePasswordPendingProofs.clear();
  chromePasswordPendingDeliveries.clear();
}

function chromeInvalidateTab(tabId) {
  for (const [nonce, binding] of chromePasswordBindings) if (binding.tabId === tabId) chromeClearBinding(nonce);
  for (const [nonce, pending] of chromePasswordPendingProofs) if (pending.context.tabId === tabId) {
    clearTimeout(pending.timer); chromePasswordPendingProofs.delete(nonce); pending.reject?.(Object.assign(new Error("navigation"), {code: "KEYGRAIN_CONTEXT_ERROR"}));
  }
}

const chromeTotpBindings = new Map();
const chromeTotpPendingProofs = new Map();
const chromeTotpPendingDeliveries = new Map();

function chromeTotpBounded(value) {
  try { return typeof value === "string" && value.length > 0
    && new TextEncoder().encode(value).byteLength <= KeygrainBrowserOwner.KEYGRAIN_TOTP_MAX_FIELD_UTF8; }
  catch (_) { return false; }
}

function chromeClearTotpBinding(deliveryNonce) {
  const binding = chromeTotpBindings.get(deliveryNonce);
  chromeTotpBindings.delete(deliveryNonce);
  const proof = chromeTotpPendingProofs.get(deliveryNonce);
  if (proof) {
    clearTimeout(proof.timer); chromeTotpPendingProofs.delete(deliveryNonce);
    proof.reject?.(Object.assign(new Error("shutdown"), {code: "KEYGRAIN_CONTEXT_ERROR"}));
  }
  const pending = chromeTotpPendingDeliveries.get(deliveryNonce);
  if (pending) {
    clearTimeout(pending.timer); chromeTotpPendingDeliveries.delete(deliveryNonce);
    pending.reject?.(Object.assign(new Error("shutdown"), {code: "KEYGRAIN_TOTP_DELIVERY_ERROR"}));
  }
  if (binding?.timer) clearTimeout(binding.timer);
  return binding;
}

function chromeClearTotpPendingProof(deliveryNonce) {
  const proof = chromeTotpPendingProofs.get(deliveryNonce);
  if (!proof) return;
  chromeTotpPendingProofs.delete(deliveryNonce);
  clearTimeout(proof.timer);
}

function chromeReceiveTotpProof(message, sender) {
  if (!chromeExact(message, ["action", "challenge", "nonce", "hasOtpField"])
    || message.action !== "keygrain.totp.contextProof" || !chromeTotpBounded(message.challenge)
    || !chromeTotpBounded(message.nonce) || message.hasOtpField !== true) return false;
  for (const [deliveryNonce, pending] of chromeTotpPendingProofs) {
    if (pending.challenge !== message.challenge || !chromePageSender(sender, pending.context, sender.documentId)) continue;
    chromeTotpPendingProofs.delete(deliveryNonce);
    clearTimeout(pending.timer);
    const binding = {tabId: pending.context.tabId, frameId: pending.context.frameId,
      origin: pending.context.origin, documentId: sender.documentId, documentNonce: message.nonce, deliveryNonce};
    binding.timer = setTimeout(() => chromeClearTotpBinding(deliveryNonce), KeygrainBrowserOwner.KEYGRAIN_TOTP_DELIVERY_TTL_MS);
    chromeTotpBindings.set(deliveryNonce, binding);
    pending.resolve(true);
    return true;
  }
  return false;
}

function chromeReceiveTotpDelivery(message, sender) {
  if (!chromeExact(message, ["ok", "result"]) || message.ok !== true
    || !chromeExact(message.result, ["codeFilled"]) || message.result.codeFilled !== true) return false;
  for (const [deliveryNonce, pending] of chromeTotpPendingDeliveries) {
    const binding = chromeTotpBindings.get(deliveryNonce);
    if (binding && chromePageSender(sender, binding, binding.documentId)) {
      chromeTotpPendingDeliveries.delete(deliveryNonce);
      clearTimeout(pending.timer);
      pending.resolve({codeFilled: true});
      return true;
    }
  }
  return false;
}

async function chromeGetActiveTotpContext() {
  try { return await chromeCurrentPasswordTab(); }
  catch (_) { throw Object.assign(new Error("context"), {code: "KEYGRAIN_CONTEXT_ERROR"}); }
}

async function chromeProveTotpContext({context, deliveryNonce}) {
  const current = await chromeCurrentPasswordTab();
  if (current.tabId !== context.tabId || current.frameId !== context.frameId || current.origin !== context.origin) {
    throw Object.assign(new Error("context"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  const challenge = chromeRandomNonce();
  const proof = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chromeTotpPendingProofs.delete(deliveryNonce);
      reject(Object.assign(new Error("timeout"), {code: "KEYGRAIN_TOTP_DELIVERY_ERROR"}));
    }, KeygrainBrowserOwner.KEYGRAIN_TOTP_DELIVERY_TTL_MS);
    chromeTotpPendingProofs.set(deliveryNonce, {challenge, context, timer, resolve, reject});
  });
  try {
    await chromeInjectBridge(context);
    await chrome.tabs.sendMessage(context.tabId, {action: "keygrain.totp.contextProbe", challenge, deliveryNonce}, {frameId: context.frameId !== undefined ? context.frameId : 0});
  } catch (_) {
    if (!chromeTotpBindings.has(deliveryNonce)) {
      chromeClearTotpPendingProof(deliveryNonce);
      throw Object.assign(new Error("probe"), {code: "KEYGRAIN_CONTEXT_ERROR"});
    }
  }
  return proof;
}

async function chromeDeliverTotp({context, deliveryNonce, code}) {
  const binding = chromeTotpBindings.get(deliveryNonce);
  if (!binding || binding.tabId !== context.tabId || binding.frameId !== context.frameId || binding.origin !== context.origin) {
    throw Object.assign(new Error("delivery"), {code: "KEYGRAIN_TOTP_DELIVERY_ERROR"});
  }
  const current = await chromeCurrentPasswordTab();
  if (current.tabId !== binding.tabId || current.frameId !== binding.frameId || current.origin !== binding.origin) {
    chromeClearTotpBinding(deliveryNonce);
    throw Object.assign(new Error("navigation"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chromeClearTotpBinding(deliveryNonce);
      reject(Object.assign(new Error("timeout"), {code: "KEYGRAIN_TOTP_DELIVERY_ERROR"}));
    }, KeygrainBrowserOwner.KEYGRAIN_TOTP_DELIVERY_TTL_MS);
    chromeTotpPendingDeliveries.set(deliveryNonce, {resolve, reject, timer});
  });
  try {
    chrome.tabs.sendMessage(binding.tabId, {action: "keygrain.totp.fillResult", deliveryNonce, code}, {frameId: binding.frameId !== undefined ? binding.frameId : 0}).catch(() => {});
  } catch (_) {
    chromeClearTotpBinding(deliveryNonce);
    throw Object.assign(new Error("delivery"), {code: "KEYGRAIN_TOTP_DELIVERY_ERROR"});
  }
  const response = await result;
  const latest = await chromeCurrentPasswordTab();
  if (latest.tabId !== binding.tabId || latest.frameId !== binding.frameId || latest.origin !== binding.origin) {
    chromeClearTotpBinding(deliveryNonce);
    throw Object.assign(new Error("navigation"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  chromeClearTotpBinding(deliveryNonce);
  return response;
}

function chromeShutdownTotpBindings() {
  for (const nonce of [...chromeTotpBindings.keys(), ...chromeTotpPendingProofs.keys(), ...chromeTotpPendingDeliveries.keys()]) chromeClearTotpBinding(nonce);
  chromeTotpPendingProofs.clear();
  chromeTotpPendingDeliveries.clear();
}

function chromeInvalidateTotpTab(tabId) {
  for (const [nonce, binding] of chromeTotpBindings) if (binding.tabId === tabId) chromeClearTotpBinding(nonce);
  for (const [nonce, pending] of chromeTotpPendingProofs) if (pending.context.tabId === tabId) {
    chromeClearTotpBinding(nonce);
  }
}

const chromeOwnerAdapter = Object.freeze({
  browser: "chrome",
  storage: chrome.storage.local,
  runtimeId: () => chrome.runtime.id,
  reconcileIndicators: chromeReconcileIndicators,
  shutdown: async () => { await chromeShutdownPasswordBindings(); chromeShutdownTotpBindings(); await chromeShutdown(); },
  getActivePasswordContext: chromeGetActivePasswordContext,
  getActiveTotpContext: chromeGetActiveTotpContext,
  proveTotpContext: chromeProveTotpContext,
  deliverTotp: chromeDeliverTotp,
  provePasswordContext: chromeProvePasswordContext,
  deliverPassword: chromeDeliverPassword,
  commitKeygrainPopupServiceEdit: chromeCommitPopupEdit,
  commitKeygrainPopupServiceAdd: chromeCommitPopupAdd,
  commitKeygrainPopupServiceDelete: chromeCommitPopupDelete,
  switchAccount: async () => {
    await chrome.storage.local.remove([
      "services", "syncKnownUUIDs", "lastSyncTime", "lastSuccessfulSyncAt",
      "pinHash", "pinSalt", "pinIterations", "pinLength",
      "autofillRules", "lastSyncETag", "account_email"
    ]);
    await clearMemorySession();
    try {
      const sessionStore = chrome.storage?.session;
      if (sessionStore) await sessionStore.remove(["keygrainSession", "pendingAutofillIntent"]);
    } catch (_) {}
    try {
      const prev = chromeIngressPromise;
      chromeIngressPromise = createChromeIngress();
      prev?.then?.(ingress => ingress.revokeAll?.())?.catch?.(() => {});
    } catch (_) {}
    await chromeShutdown();
  },
});

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || (Object.prototype.toString.call(value) === "[object Object]"
      && prototype?.constructor?.name === "Object");
  } catch (_) { return false; }
}

function preparedPayload(payload) {
  if (!payload || !Array.isArray(payload.services) || !Array.isArray(payload.wallets)
    || !Array.isArray(payload.walletAuditLog) || !Array.isArray(payload.tombstones)
    || !Array.isArray(payload.deletionReview)) throw new Error("invalid_payload");
  for (const record of payload.services) if (!plainRecord(record)) throw new Error("invalid_payload");
  return {
    fullData: {
      secret: payload.secret,
      email: payload.email,
      services: payload.services,
      wallets: payload.wallets,
      walletAuditLog: payload.walletAuditLog,
      tombstones: payload.tombstones,
      deletionReview: payload.deletionReview,
    },
    records: payload.services,
  };
}

async function persistV2(email, secret, payload) {
  const key = await deriveStorageKey(secret, email);
  try {
    const encrypted = await encryptServices(key, email, payload.services, payload.wallets,
      payload.walletAuditLog, payload.tombstones, payload.deletionReview);
    await chrome.storage.local.set({
      services: encrypted,
      account_email: (email || "").toLowerCase()
    });
  } finally {
    if (key && typeof key.fill === "function") key.fill(0);
  }
}

function requiredArray(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value[key])) {
    throw new Error("invalid_payload");
  }
  return value[key];
}

function acceptedV2(local) {
  return validateLocalPayload(local);
}

function preparedFromAccepted(accepted, email, secret) {
  return preparedPayload({
    secret,
    email,
    services: accepted.services,
    wallets: accepted.wallets,
    walletAuditLog: accepted.walletAuditLog,
    tombstones: accepted.tombstones,
    deletionReview: accepted.deletionReview,
  });
}

function syncLocalV2(result) {
  const local = {
    version: 2,
    services: requiredArray(result, "services"),
    wallets: requiredArray(result, "wallets"),
    wallet_audit_log: requiredArray(result, "wallet_audit_log"),
    tombstones: requiredArray(result, "tombstones"),
    deletion_review: requiredArray(result, "review"),
  };
  return acceptedV2(local);
}

function knownUUIDs(data) {
  if (data.syncKnownUUIDs === undefined) return [];
  if (!Array.isArray(data.syncKnownUUIDs)) throw new Error("invalid_payload");
  return data.syncKnownUUIDs;
}

async function readAndPrepare({email, secret}) {
  const data = await chrome.storage.local.get(["services", "syncKnownUUIDs", "lastSyncTime", "account_email"]);
  const stored = data.services;
  const storedAccountEmail = data.account_email;
  const isDifferentAccount = Boolean(
    stored !== undefined &&
    storedAccountEmail &&
    storedAccountEmail.toLowerCase() !== (email || "").toLowerCase()
  );
  let accepted;
  let prepared;
  let migrateMarkers = false;

  if (stored === undefined || isDifferentAccount) {
    const result = await syncWithServer(secret, email, [], [], [], []);
    accepted = syncLocalV2(result);
    prepared = preparedFromAccepted(accepted, email, secret);
  } else if (stored && stored.version === 1) {
    const legacy = validateLocalPayload(stored);
    const migrated = migrateLocalPayload({
      services: legacy.services,
      wallets: legacy.wallets,
      wallet_audit_log: legacy.walletAuditLog,
      deletion_review: legacy.deletionReview,
    }, new Set(knownUUIDs(data)), Date.now());
    accepted = acceptedV2(migrated);
    prepared = preparedFromAccepted(accepted, email, secret);
    migrateMarkers = true;
  } else if (stored && stored.version === 2) {
    const key = await deriveStorageKey(secret, email);
    try {
      let decoded;
      try {
        decoded = await decryptServices(key, email, stored);
      } catch (err) {
        throw Object.assign(new Error("authentication_failed"), {code: "Keygrain_AUTH_FAILED", originalError: err});
      }
      if (decoded.payloadVersion === 1) {
        const migrated = migrateLocalPayload({
          services: decoded.services,
          wallets: decoded.wallets,
          wallet_audit_log: decoded.walletAuditLog,
          deletion_review: decoded.deletionReview,
        }, new Set(knownUUIDs(data)), Date.now());
        accepted = acceptedV2(migrated);
        prepared = preparedFromAccepted(accepted, email, secret);
        migrateMarkers = true;
      } else if (decoded.payloadVersion === 2) {
        accepted = acceptedV2({
          version: 2,
          services: decoded.services,
          wallets: decoded.wallets,
          wallet_audit_log: decoded.walletAuditLog,
          tombstones: decoded.tombstones,
          deletion_review: decoded.deletionReview,
        });
        prepared = preparedFromAccepted(accepted, email, secret);
      } else {
        throw new Error("invalid_payload");
      }
    } finally {
      if (key && typeof key.fill === "function") key.fill(0);
    }
  } else {
    throw new Error("invalid_payload");
  }

  if (migrateMarkers) {
    await persistV2(email, secret, prepared.fullData);
    await chrome.storage.local.remove("syncKnownUUIDs");
    if (data.lastSyncTime !== undefined) {
      await chrome.storage.local.set({lastSuccessfulSyncAt: data.lastSyncTime || 0});
    }
  } else if (stored === undefined || isDifferentAccount) {
    await persistV2(email, secret, prepared.fullData);
  }
  return prepared;
}

const chromeOwner = KeygrainBrowserOwner.createOwner({
  adapter: chromeOwnerAdapter,
  settings: KEYGRAIN_DEFAULT_SETTINGS,
  authenticateAndPrepare: readAndPrepare,
});

function extractMetadata() {
  try {
    const services = chromeOwner.getServicesList ? (chromeOwner.getServicesList() || []) : [];
    if (services.length > 0) {
      return services.map(s => ({
        id: String(s.id || ""),
        site: String(s.site || ""),
        name: String(s.name || ""),
        email: String(s.email || "")
      }));
    }
    const meta = chromeOwner.getMetadata ? (chromeOwner.getMetadata() || []) : [];
    return meta.map(s => ({
      id: String(s.id || ""),
      site: String(s.site || ""),
      name: String(s.name || ""),
      email: String(s.email || "")
    }));
  } catch (_) {
    return [];
  }
}

async function saveSession({ email, secret, snap }) {
  try {
    const sessionStore = chrome.storage?.session;
    if (!sessionStore) return;
    if (snap && (snap.state === "full" || snap.state === "metadata")) {
      const settings = await chromeOwner.loadSettings();
      const metaTailSec = settings?.metadataTailSeconds !== undefined ? settings.metadataTailSeconds : (KEYGRAIN_DEFAULT_SETTINGS?.metadataTailSeconds || 28500);
      const fullExpiresAt = snap.state === "full" ? snap.fullExpiresAt : null;
      const metadataTailAnchor = snap.metadataExpiresAt || (fullExpiresAt ? fullExpiresAt + metaTailSec * 1000 : null);
      const metadata = extractMetadata();
      await sessionStore.set({
        keygrainSession: {
          email,
          secret: (snap.state === "full" && secret) ? secret : null,
          fullExpiresAt,
          metadataExpiresAt: snap.metadataExpiresAt,
          metadataTailAnchor,
          metadata,
        }
      });
    } else {
      await sessionStore.remove("keygrainSession");
    }
  } catch (_) {}
}

async function clearMemorySession() {
  try {
    const sessionStore = chrome.storage?.session;
    if (sessionStore) await sessionStore.remove(["keygrainSession", "pendingAutofillIntent"]);
  } catch (_) {}
  try {
    if (typeof clearStrengthenCache === "function") clearStrengthenCache();
  } catch (_) {}
}

async function checkAccountExists(email, secret) {
  try {
    const data = await chrome.storage.local.get(["services", "settings", "account_email"]);
    const stored = data.services;
    const storedAccountEmail = data.account_email;
    const normalizedEmail = (email || "").toLowerCase();

    if (stored !== undefined) {
      if (storedAccountEmail) {
        if (storedAccountEmail.toLowerCase() === normalizedEmail) {
          return true;
        }
      } else {
        if (stored.version === 1) return true;
        if (stored.version === 2) {
          let key;
          try {
            key = await deriveStorageKey(secret, email);
            const decoded = await decryptServices(key, email, stored);
            if (decoded) return true;
          } catch (_) {
          } finally {
            if (key && typeof key.fill === "function") key.fill(0);
          }
        }
      }
    }

    try {
      const lookupId = await deriveLookupId(secret, email);
      const authPassword = await deriveAuthPassword(secret, email);
      const serverUrl = (data.settings && data.settings.serverUrl) || (typeof DEFAULT_SYNC_SERVER !== "undefined" ? DEFAULT_SYNC_SERVER : "https://keygrain.com");
      const authHeader = "Basic " + btoa(lookupId + ":" + authPassword);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const resp = await fetch(serverUrl.replace(/\/+$/, "") + "/api/sync/" + lookupId, {
        method: "GET",
        headers: {Authorization: authHeader},
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (resp.status === 200 || resp.status === 401) {
        return true;
      }
    } catch (_) {}
  } catch (_) {}
  return false;
}

function createChromeIngress() {
  return KeygrainWorkerIngress.createIngress({
    crypto: globalThis.crypto,
    runtimeAdmission: {
      issue({runtimeContext}) {
        return KeygrainBrowserOwner.isTrustedExtensionPage(runtimeContext?.sender, chrome.runtime.id, "unlock", "chrome", KEYGRAIN_EXTENSION_ORIGIN);
      },
      admit({runtimeContext}) {
        return KeygrainBrowserOwner.isTrustedExtensionPage(runtimeContext?.sender, chrome.runtime.id, "unlock", "chrome", KEYGRAIN_EXTENSION_ORIGIN);
      },
    },
    onAuthenticatedUnlock: async (email, secret, runtimeContext) => {
      if (runtimeContext?.isCreate) {
        const exists = await checkAccountExists(email, secret);
        if (exists) {
          return {
            ok: false,
            code: "ACCOUNT_EXISTS",
            message: "Account already exists. Please use 'Unlock Account' to log in.",
          };
        }
        try {
          await chromeOwner.switchAccount?.(
            runtimeContext.sender,
            chrome.runtime.id,
            "chrome",
            KEYGRAIN_EXTENSION_ORIGIN,
          );
        } catch (_) {}
      }
      const settings = await chromeOwner.loadSettings();
      let confirmationId = null;
      if (settings?.fullLeaseSeconds === 1800) {
        try {
          confirmationId = chromeOwner.issueConfirmation(
            runtimeContext.popupSessionId || ("unlock-" + Date.now()),
            runtimeContext.sender?.url || ""
          );
        } catch (_) {}
      }
      const res = await chromeOwner.unlock(
        runtimeContext.sender,
        chrome.runtime.id,
        {action: "unlock", email, secret, popupSessionId: runtimeContext.popupSessionId, confirmationId},
        "chrome",
        KEYGRAIN_EXTENSION_ORIGIN,
      );
      if (res?.ok) {
        const snap = typeof chromeOwner.snapshot === "function" ? chromeOwner.snapshot() : null;
        if (snap) await saveSession({ email, secret, snap });
        return {ok: true};
      }
      return res || {ok: false, code: "KEYGRAIN_UNLOCK_FAILED", message: "Unlock failed; try again."};
    },
  });
}

let chromeIngressPromise = createChromeIngress();

const startupPromise = (async () => {
  await chromeShutdown();
  await chromeOwner.loadSettings();
  await KeygrainBrowserOwner.cleanupLegacyPreferences(chrome.storage.local);
  try {
    const sessionData = await chrome.storage?.session?.get("keygrainSession");
    const session = sessionData?.keygrainSession;
    if (session && session.email) {
      const now = Date.now();
      if (session.secret && session.fullExpiresAt && now < session.fullExpiresAt) {
        const prepared = await readAndPrepare({
          email: session.email,
          secret: session.secret,
          popupSessionId: "sw-restore-" + Date.now(),
        });
        const payload = chromeOwner.preparedUnlock ? chromeOwner.preparedUnlock(prepared) : prepared;
        chromeOwner.restoreSession({
          email: session.email,
          fullData: payload.fullData,
          records: payload.records,
          fullExpiresAt: session.fullExpiresAt,
          metadataTailAnchor: session.metadataTailAnchor,
          activeMetadataTailSeconds: (session.metadataTailAnchor && session.fullExpiresAt)
            ? Math.round((session.metadataTailAnchor - session.fullExpiresAt) / 1000)
            : null,
        });
      } else if (session.metadataTailAnchor && now < session.metadataTailAnchor && Array.isArray(session.metadata)) {
        chromeOwner.restoreSession({
          email: session.email,
          metadata: session.metadata,
          metadataExpiresAt: session.metadataExpiresAt || session.metadataTailAnchor,
          metadataTailAnchor: session.metadataTailAnchor,
          activeMetadataTailSeconds: (session.metadataTailAnchor && session.fullExpiresAt)
            ? Math.round((session.metadataTailAnchor - session.fullExpiresAt) / 1000)
            : null,
        });
        if (session.secret) {
          await chrome.storage?.session?.set({
            keygrainSession: {
              ...session,
              secret: null,
              fullExpiresAt: null,
            }
          });
        }
      } else {
        await chrome.storage?.session?.remove("keygrainSession");
      }
    }
  } catch (_) {}
  chromeOwner.reconcile("startup");
  await chromeOwner.whenReconciled();
})();

if (chrome.tabs?.onActivated?.addListener) {
  chrome.tabs.onActivated.addListener(() => {
    startupPromise.then(() => {
      chromeOwner.reconcile("tab_activated");
    }).catch(() => {});
  });
}
if (chrome.tabs?.onUpdated?.addListener) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    chromeInvalidateTab(tabId);
    chromeInvalidateTotpTab(tabId);
    if (changeInfo.status === "complete") {
      startupPromise.then(() => {
        chromeOwner.reconcile("tab_updated");
      }).catch(() => {});
    }
  });
}
if (chrome.tabs?.onReplaced?.addListener) chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  chromeInvalidateTab(addedTabId); chromeInvalidateTab(removedTabId);
  chromeInvalidateTotpTab(addedTabId); chromeInvalidateTotpTab(removedTabId);
});
if (chrome.tabs?.onRemoved?.addListener) chrome.tabs.onRemoved.addListener(tabId => { chromeInvalidateTab(tabId); chromeInvalidateTotpTab(tabId); });
if (chrome.alarms?.onAlarm?.addListener) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === "keygrain-state-wake") startupPromise.then(async () => { const snap = await chromeOwner.reconcile("wake");
      if (snap) {
        if (snap.state === "locked") {
          await clearMemorySession();
        } else if (snap.state === "metadata") {
          const sessionStore = chrome.storage?.session;
          if (sessionStore) {
            const sessionData = await sessionStore.get("keygrainSession");
            const session = sessionData?.keygrainSession;
            if (session) {
              session.secret = null;
              session.fullExpiresAt = null;
              session.metadataExpiresAt = snap.metadataExpiresAt;
              session.metadataTailAnchor = snap.metadataExpiresAt;
              session.metadata = extractMetadata();
              await sessionStore.set({ keygrainSession: session });
            }
          }
        }
      }
    }).catch(() => {});
  });
}

function safeMessageError(error) {
  return KeygrainBrowserOwner.safeErrorResponse(error, KeygrainBrowserOwner.UNLOCK_FAILED);
}

// === Autofill: shared resolver + bounded settle loop ===
const SETTLE_MAX_TRIES = 4;
const GETCONTEXT_TIMEOUT_MS = 300;
const INTER_TRY_SLEEP_MS = 200;
const SETTLE_HARD_CEILING_MS = 1000;

function openPopupSafe() {
  try { chrome.action.openPopup(); } catch {}
}

function afSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function focusedFieldIsOtp(tab) {
  const snap = chromeOwner.snapshot();
  if (snap.state !== "full") return false;
  if (!tab?.url) return false;
  try {
    const [{result}] = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: () => {
        const active = document.activeElement;
        if (!active || active.tagName !== "INPUT") return false;
        const name = (active.name || "").toLowerCase();
        const id = (active.id || "").toLowerCase();
        const autocomplete = (active.autocomplete || "").toLowerCase();
        return autocomplete === "one-time-code" || name.includes("otp") || name.includes("2fa") || id.includes("otp") || id.includes("2fa");
      }
    });
    return !!result;
  } catch (_) {
    return false;
  }
}

async function tabAutofill(tab) {
  await startupPromise;
  const snap = chromeOwner.snapshot();
  if (snap.state === "locked") {
    openPopupSafe();
    return;
  }
  if (!tab?.url) { openPopupSafe(); return; }
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { openPopupSafe(); return; }
  if (!host) { openPopupSafe(); return; }

  const services = chromeOwner.getServicesList();
  if (!services || !services.length) { openPopupSafe(); return; }
  const matches = (globalThis.KeygrainAutofill || (typeof KeygrainAutofill !== "undefined" ? KeygrainAutofill : null)).filterMostSpecific(services, host);
  if (matches.length === 0) { openPopupSafe(); return; }

  if (matches.length > 1) {
    let triggered = false;
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: "triggerInlineDropdown", kind: "login" });
      if (resp?.ok) triggered = true;
    } catch (_) {}
    if (!triggered) {
      try {
        if (chrome.scripting?.executeScript) {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: INLINE_JS });
          const resp = await chrome.tabs.sendMessage(tab.id, { action: "triggerInlineDropdown", kind: "login" });
          if (resp?.ok) triggered = true;
        }
      } catch (_) {}
    }
    if (!triggered) {
      openPopupSafe();
    }
    return;
  }

  // Exactly 1 match in metadata mode -> record intent and prompt for secret
  if (snap.state === "metadata") {
    if (matches[0]?.id) {
      await chrome.storage?.session?.set({
        pendingAutofillIntent: {
          action: "fillPassword",
          id: matches[0].id,
          tabId: tab.id,
          url: tab.url,
        }
      });
    }
    openPopupSafe();
    return;
  }

  const bestMatch = matches[0];
  const derived = await chromeOwner.derivePasswordForService(bestMatch.id);
  if (!derived) { openPopupSafe(); return; }

  let origin;
  try { origin = new URL(tab.url).origin; } catch { openPopupSafe(); return; }
  const context = {tabId: tab.id, frameId: 0, origin};
  const deliveryNonce = chromeRandomNonce();
  try {
    await chromeProvePasswordContext({context, deliveryNonce});
    await chromeDeliverPassword({context, deliveryNonce, password: derived.password, email: derived.email});
  } catch (_) {
    openPopupSafe();
  }
}

async function tabAutofillOtp(tab) {
  await startupPromise;
  const snap = chromeOwner.snapshot();
  if (snap.state === "locked") {
    openPopupSafe();
    return;
  }
  if (!tab?.url) { openPopupSafe(); return; }
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { openPopupSafe(); return; }
  if (!host) { openPopupSafe(); return; }

  const services = chromeOwner.getServicesList();
  if (!services || !services.length) { openPopupSafe(); return; }
  const matches = (globalThis.KeygrainAutofill || (typeof KeygrainAutofill !== "undefined" ? KeygrainAutofill : null)).filterMostSpecific(services, host).filter(s => s && s.totp);
  if (matches.length === 0) { openPopupSafe(); return; }

  if (matches.length > 1) {
    let triggered = false;
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: "triggerInlineDropdown", kind: "otp" });
      if (resp?.ok) triggered = true;
    } catch (_) {}
    if (!triggered) {
      try {
        if (chrome.scripting?.executeScript) {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: INLINE_JS });
          const resp = await chrome.tabs.sendMessage(tab.id, { action: "triggerInlineDropdown", kind: "otp" });
          if (resp?.ok) triggered = true;
        }
      } catch (_) {}
    }
    if (!triggered) {
      openPopupSafe();
    }
    return;
  }

  // Exactly 1 match in metadata mode -> record intent and prompt for secret
  if (snap.state === "metadata") {
    if (matches[0]?.id) {
      await chrome.storage?.session?.set({
        pendingAutofillIntent: {
          action: "fillTotp",
          id: matches[0].id,
          tabId: tab.id,
          url: tab.url,
        }
      });
    }
    openPopupSafe();
    return;
  }

  const bestMatch = matches[0];
  const derived = await chromeOwner.deriveTotpForService(bestMatch.id);
  if (!derived?.code) { openPopupSafe(); return; }

  let origin;
  try { origin = new URL(tab.url).origin; } catch { openPopupSafe(); return; }
  const context = {tabId: tab.id, frameId: 0, origin};
  const deliveryNonce = chromeRandomNonce();
  try {
    await chromeProveTotpContext({context, deliveryNonce});
    await chromeDeliverTotp({context, deliveryNonce, code: derived.code});
  } catch (_) {
    openPopupSafe();
  }
}

// === Keyboard Shortcut ===
if (chrome.commands?.onCommand?.addListener) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "fill_credentials") return;
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab) return;
    if (await focusedFieldIsOtp(tab)) await tabAutofillOtp(tab);
    else await tabAutofill(tab);
  });
}

// === Context Menu ===
if (chrome.runtime?.onInstalled?.addListener) {
  chrome.runtime.onInstalled.addListener(() => {
    try {
      chrome.contextMenus?.create({id: "keygrain-fill", title: "Fill with Keygrain", contexts: ["editable"]});
      chrome.contextMenus?.create({id: "keygrain-fill-otp", title: "Fill one-time code with Keygrain", contexts: ["editable"]});
    } catch (_) {}
  });
}

if (chrome.contextMenus?.onClicked?.addListener) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === "keygrain-fill") await tabAutofill(tab);
    else if (info.menuItemId === "keygrain-fill-otp") await tabAutofillOtp(tab);
  });
}

// === In-Page Autofill Helpers ===
async function inlineEnabled() {
  const settings = await chromeOwner.loadSettings();
  return !!(settings?.inPageAutofill || settings?.inlineAutofillEnabled);
}

function inlineUnlocked() {
  const snap = chromeOwner.snapshot();
  return snap.state === "full" || snap.state === "metadata";
}

async function broadcastInline(msg) {
  let tabs;
  try { tabs = await chrome.tabs.query({}); } catch { return; }
  for (const tab of tabs) {
    if (tab.id == null) continue;
    chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

chrome.permissions?.onRemoved?.addListener(async (permissions) => {
  if (permissions.origins && permissions.origins.includes("*://*/*")) {
    await chromeOwner.saveSettings({inPageAutofill: false});
    await broadcastInline({action: "inlineDisabled"});
    await chromeOwner.reconcile("permission_removed");
  }
});

chrome.permissions?.onAdded?.addListener(async (permissions) => {
  if (permissions.origins && permissions.origins.includes("*://*/*")) {
    await chromeOwner.saveSettings({inPageAutofill: true});
    await chromeOwner.reconcile("permission_added");
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const inboundAction = KeygrainBrowserOwner.peekPopupAction(message);
  if (inboundAction === "keygrain.password.contextProof") {
    chromeReceiveProof(message, sender);
    return false;
  }
  if (inboundAction === "keygrain.totp.contextProof") {
    chromeReceiveTotpProof(message, sender);
    return false;
  }
  if (inboundAction === "keygrain.password.fillResult") {
    chromeReceiveDelivery(message, sender);
    return false;
  }
  if (inboundAction === "keygrain.totp.fillResult") {
    chromeReceiveTotpDelivery(message, sender);
    return false;
  }
  if (sender && sender.tab && (chromeReceiveTotpDelivery(message, sender) || chromeReceiveDelivery(message, sender))) return false;

  // Inline Autofill and Content Script Actions
  if (inboundAction === "inlineAutofillEnabledChanged") {
    (async () => {
      await startupPromise;
      if (!message.enabled) {
        await broadcastInline({action: "inlineDisabled"});
      }
      await chromeOwner.reconcile("setting_changed");
      sendResponse({ok: true});
    })();
    return true;
  }
  if (inboundAction === "reregisterInlineAutofill") {
    (async () => {
      await startupPromise;
      await chromeOwner.reconcile("setting_changed");
      sendResponse({ok: true});
    })();
    return true;
  }
  if (inboundAction === "getInlineMatches") {
    (async () => {
      try {
        await startupPromise;
        const tabUrl = sender.tab?.url || sender.url;
        if (!tabUrl) return sendResponse({enabled: false, locked: false, accounts: []});
        const isDemand = !!message?.onDemand;
        if (!isDemand && !(await inlineEnabled())) return sendResponse({enabled: false, locked: false, accounts: []});
        const snap = chromeOwner.snapshot();
        if (snap.state === "locked") return sendResponse({enabled: true, locked: true, accounts: []});
        const host = new URL(tabUrl).hostname.replace(/^www\./, "").toLowerCase();
        let services = chromeOwner.getServicesList();
        if (!services && snap.state === "metadata") {
          services = chromeOwner.getMetadata() || null;
        }
        if (!services) return sendResponse({enabled: true, locked: snap.state !== "full", accounts: []});
        const autofillHelper = globalThis.KeygrainAutofill || (typeof KeygrainAutofill !== "undefined" ? KeygrainAutofill : null);
        const inlineHelper = globalThis.KeygrainInline || (typeof KeygrainInline !== "undefined" ? KeygrainInline : null);
        const matches = autofillHelper ? autofillHelper.filterMostSpecific(services, host) : [];
        const ranked = autofillHelper ? autofillHelper.rankServices(matches) : [];
        const accounts = inlineHelper ? ranked.map(inlineHelper.sanitizeAccountForContent) : [];
        sendResponse({enabled: true, locked: false, accounts});
      } catch {
        sendResponse({enabled: true, locked: false, accounts: []});
      }
    })();
    return true;
  }
  if (inboundAction === "getInlineOtpMatches") {
    (async () => {
      try {
        await startupPromise;
        const tabUrl = sender.tab?.url || sender.url;
        if (!tabUrl) return sendResponse({enabled: false, locked: false, accounts: []});
        const isDemand = !!message?.onDemand;
        if (!isDemand && !(await inlineEnabled())) return sendResponse({enabled: false, locked: false, accounts: []});
        const snap = chromeOwner.snapshot();
        if (snap.state === "locked") return sendResponse({enabled: true, locked: true, accounts: []});
        const host = new URL(tabUrl).hostname.replace(/^www\./, "").toLowerCase();
        let services = chromeOwner.getServicesList();
        if (!services && snap.state === "metadata") {
          services = chromeOwner.getMetadata() || null;
        }
        if (!services) return sendResponse({enabled: true, locked: snap.state !== "full", accounts: []});
        const autofillHelper = globalThis.KeygrainAutofill || (typeof KeygrainAutofill !== "undefined" ? KeygrainAutofill : null);
        const inlineHelper = globalThis.KeygrainInline || (typeof KeygrainInline !== "undefined" ? KeygrainInline : null);
        const matches = autofillHelper ? autofillHelper.filterMostSpecific(services, host).filter(s => snap.state === "metadata" || (s && s.totp)) : [];
        const ranked = autofillHelper ? autofillHelper.rankServices(matches) : [];
        const accounts = inlineHelper ? ranked.map(inlineHelper.sanitizeAccountForContent) : [];
        sendResponse({enabled: true, locked: false, accounts});
      } catch {
        sendResponse({enabled: true, locked: false, accounts: []});
      }
    })();
    return true;
  }
  if (inboundAction === "fillInline") {
    (async () => {
      try {
        await startupPromise;
        const tabUrl = sender.tab?.url || sender.url;
        if (!tabUrl) return;
        const snap = chromeOwner.snapshot();
        if (snap.state !== "full") {
          if (snap.state === "metadata") {
            await chrome.storage?.session?.set({
              pendingAutofillIntent: {
                action: "fillPassword",
                id: message.token,
                tabId: sender.tab?.id,
                url: tabUrl,
              }
            });
          }
          openPopupSafe();
          return;
        }
        const host = new URL(tabUrl).hostname.replace(/^www\./, "").toLowerCase();
        const derived = await chromeOwner.derivePasswordForService(s => s.id === message.token && chromeSiteMatches(s.site || s.name, host));
        if (!derived) return;
        let origin;
        try { origin = new URL(tabUrl).origin; } catch { return; }
        const context = {tabId: sender.tab?.id != null ? sender.tab.id : null, frameId: sender.frameId || 0, origin};
        const deliveryNonce = chromeRandomNonce();
        await chromeProvePasswordContext({context, deliveryNonce});
        await chromeDeliverPassword({context, deliveryNonce, password: derived.password, email: derived.email});
      } catch {}
    })();
    return true;
  }
  if (inboundAction === "fillInlineOtp") {
    (async () => {
      try {
        await startupPromise;
        const tabUrl = sender.tab?.url || sender.url;
        if (!tabUrl) return;
        const snap = chromeOwner.snapshot();
        if (snap.state !== "full") {
          if (snap.state === "metadata") {
            await chrome.storage?.session?.set({
              pendingAutofillIntent: {
                action: "fillTotp",
                id: message.token,
                tabId: sender.tab?.id,
                url: tabUrl,
              }
            });
          }
          openPopupSafe();
          return;
        }
        const host = new URL(tabUrl).hostname.replace(/^www\./, "").toLowerCase();
        const derived = await chromeOwner.deriveTotpForService(s => s.id === message.token && chromeSiteMatches(s.site || s.name, host) && s.totp);
        if (!derived?.code) return;
        let origin;
        try { origin = new URL(tabUrl).origin; } catch { return; }
        const context = {tabId: sender.tab?.id != null ? sender.tab.id : null, frameId: sender.frameId || 0, origin};
        const deliveryNonce = chromeRandomNonce();
        await chromeProveTotpContext({context, deliveryNonce});
        await chromeDeliverTotp({context, deliveryNonce, code: derived.code});
      } catch {}
    })();
    return true;
  }

  // Extension Pages & Popups
  if (!KeygrainBrowserOwner.isTrustedExtensionPage(sender, chrome.runtime.id, null, "chrome", KEYGRAIN_EXTENSION_ORIGIN)) {
    sendResponse(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR));
    return true;
  }
  const action = inboundAction;

  if (action === "deriveCustomWalletMnemonic") {
    startupPromise.then(() => chromeOwner.deriveCustomWalletMnemonic(message))
      .then(res => {
        if (!res) sendResponse(KeygrainBrowserOwner.safeFailure("LOCKED"));
        else sendResponse(KeygrainBrowserOwner.success(res));
      }, err => sendResponse(safeMessageError(err)));
    return true;
  }
  if (action === "getUnlockState") {
    startupPromise.then(async () => {
      const snap = chromeOwner.snapshot();
      let email = null;
      if (snap.state === "full") {
        const opHandle = chromeOwner.manager.beginSensitiveOperation({capture: fullData => ({email: fullData?.email || null})});
        try {
          const input = chromeOwner.manager.getSensitiveOperationInput(opHandle);
          email = input?.email || null;
        } finally {
          try { chromeOwner.manager.completeSensitiveOperation(opHandle, "get_unlock_state"); } catch (_) {}
        }
      }
      let authenticatedEmail = chromeOwner.getAuthenticatedEmail?.() || email;
      if (!authenticatedEmail) {
        try {
          const sessionData = await chrome.storage?.session?.get("keygrainSession");
          authenticatedEmail = sessionData?.keygrainSession?.email || null;
        } catch (_) {}
      }
      sendResponse(KeygrainBrowserOwner.success({
        state: snap.state,
        isUnlocked: snap.state === "full",
        email: authenticatedEmail,
      }));
    }).catch(err => sendResponse(safeMessageError(err)));
    return true;
  }
  if (action === "getSecret" || action === "getEmail") {
    startupPromise.then(async () => {
      const snap = chromeOwner.snapshot();
      if (snap.state !== "full") return sendResponse(KeygrainBrowserOwner.safeFailure("LOCKED"));
      let secret = null;
      let email = null;
      const opHandle = chromeOwner.manager.beginSensitiveOperation({capture: fullData => ({secret: fullData?.secret, email: fullData?.email})});
      try {
        const input = chromeOwner.manager.getSensitiveOperationInput(opHandle);
        secret = input?.secret || null;
        email = input?.email || null;
      } finally {
        try { chromeOwner.manager.completeSensitiveOperation(opHandle, "get_credentials"); } catch (_) {}
      }
      if (action === "getSecret") sendResponse({secret});
      else sendResponse({email});
    }).catch(err => sendResponse(safeMessageError(err)));
    return true;
  }
  if (action === "getSavedWallets") {
    startupPromise.then(async () => {
      const snap = chromeOwner.snapshot();
      if (snap.state === "locked") return sendResponse(KeygrainBrowserOwner.safeFailure("LOCKED"));
      let wallets = [];
      const opHandle = chromeOwner.manager.beginSensitiveOperation({capture: fullData => ({wallets: fullData?.wallets || []})});
      try {
        const input = chromeOwner.manager.getSensitiveOperationInput(opHandle);
        wallets = input?.wallets || [];
      } finally {
        try { chromeOwner.manager.completeSensitiveOperation(opHandle, "get_saved_wallets"); } catch (_) {}
      }
      sendResponse(KeygrainBrowserOwner.success({wallets}));
    }).catch(err => sendResponse(safeMessageError(err)));
    return true;
  }
  if (action === "saveWallet") {
    startupPromise.then(async () => {
      const snap = chromeOwner.snapshot();
      if (snap.state === "locked") return sendResponse(KeygrainBrowserOwner.safeFailure("LOCKED"));
      const { walletName, chain, counter, email } = message;
      if (!walletName || !chain || !counter) return sendResponse(KeygrainBrowserOwner.safeFailure("INVALID_PARAMS"));
      let updatedWallets = [];
      let fullDataToPersist = null;
      let accountEmail = "";
      const opHandle = chromeOwner.manager.beginSensitiveOperation({
        capture: fullData => {
          if (!fullData) return null;
          const current = Array.isArray(fullData.wallets) ? [...fullData.wallets] : [];
          const nowIso = new Date().toISOString();
          const normName = String(walletName).trim().toLowerCase();
          const normChain = String(chain).trim().toLowerCase();
          const normEmail = (email || fullData.email || "").trim().toLowerCase();
          const existingIdx = current.findIndex(w => (w.wallet_name || "").toLowerCase() === normName && (w.chain || "").toLowerCase() === normChain);
          if (existingIdx >= 0) {
            current[existingIdx] = {
              ...current[existingIdx],
              counter: Number(counter),
              email: normEmail,
              updated_at: nowIso,
            };
          } else {
            current.push({
              wallet_name: normName,
              chain: normChain,
              counter: Number(counter),
              email: normEmail,
              mode: "keygrain",
              created_at: nowIso,
              updated_at: nowIso,
              notes: "",
            });
          }
          fullData.wallets = current;
          updatedWallets = current;
          fullDataToPersist = fullData;
          accountEmail = fullData.email || email;
          return { wallets: current };
        }
      });
      try {
        chromeOwner.manager.getSensitiveOperationInput(opHandle);
      } finally {
        try { chromeOwner.manager.completeSensitiveOperation(opHandle, "save_wallet"); } catch (_) {}
      }
      if (fullDataToPersist) {
        try {
          const sessionData = await chrome.storage?.session?.get("keygrainSession");
          const activeSecret = sessionData?.keygrainSession?.secret;
          if (activeSecret && accountEmail) {
            await persistV2(accountEmail, activeSecret, fullDataToPersist);
          }
        } catch (_) {}
      }
      sendResponse(KeygrainBrowserOwner.success({ wallets: updatedWallets }));
    }).catch(err => sendResponse(safeMessageError(err)));
    return true;
  }
  if (action === "issueUnlockChallenge") {
    try {
      if (!KeygrainBrowserOwner.isTrustedExtensionPage(sender, chrome.runtime.id, "unlock", "chrome", KEYGRAIN_EXTENSION_ORIGIN)
        || !message || Object.keys(message).length !== 2 || message.action !== action
        || typeof message.popupSessionId !== "string" || message.popupSessionId.length < 1) {
        sendResponse(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR));
        return false;
      }
      chromeIngressPromise
        .then(ingress => ingress.issueChallenge({sender, popupSessionId: message.popupSessionId}))
        .then(challenge => sendResponse(KeygrainBrowserOwner.success({challenge})))
        .catch(err => sendResponse(safeMessageError(err)));
      return true;
    } catch (_) {
      sendResponse(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR));
      return false;
    }
  }
  if (action === "unlockEncrypted") {
    try {
      if (!KeygrainBrowserOwner.isTrustedExtensionPage(sender, chrome.runtime.id, "unlock", "chrome", KEYGRAIN_EXTENSION_ORIGIN)
        || !message || (Object.keys(message).length !== 3 && Object.keys(message).length !== 4) || message.action !== action
        || typeof message.popupSessionId !== "string" || message.popupSessionId.length < 1
        || !message.envelope || typeof message.envelope !== "object" || Array.isArray(message.envelope)) {
        sendResponse(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR));
        return false;
      }
      chromeIngressPromise
        .then(ingress => ingress.admitUnlock({sender, popupSessionId: message.popupSessionId, isCreate: Boolean(message.isCreate)}, message.envelope))
        .then(res => sendResponse(res))
        .catch(err => sendResponse(safeMessageError(err)));
      return true;
    } catch (_) {
      sendResponse(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR));
      return false;
    }
  }
  if (action === "requestExceptionalConfirmation") {
    try {
      if (!KeygrainBrowserOwner.isTrustedExtensionPage(sender, chrome.runtime.id, action, "chrome", KEYGRAIN_EXTENSION_ORIGIN)) {
        sendResponse(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR));
      } else {
        const request = KeygrainBrowserOwner.validateConfirmationMessage(message, action);
        startupPromise.then(() => {
          const id = chromeOwner.issueConfirmation(request.popupSessionId, sender.url);
          return KeygrainBrowserOwner.success({confirmationId: id});
        }).then(sendResponse, error => sendResponse(safeMessageError(error)));
      }
    } catch (error) { sendResponse(safeMessageError(error)); }
    return true;
  }
  if (action === "cancelExceptionalConfirmation") {
    try {
      if (!KeygrainBrowserOwner.isTrustedExtensionPage(sender, chrome.runtime.id, action, "chrome", KEYGRAIN_EXTENSION_ORIGIN)) {
        sendResponse(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR));
      } else {
        const request = KeygrainBrowserOwner.validateConfirmationMessage(message, action);
        startupPromise.then(() => {
          chromeOwner.clearConfirmationSession(request.popupSessionId);
          return KeygrainBrowserOwner.success();
        }).then(sendResponse, error => sendResponse(safeMessageError(error)));
      }
    } catch (error) { sendResponse(safeMessageError(error)); }
    return true;
  }
  if (KeygrainBrowserOwner.isExactPopupRequest(message)
    && (action === "heartbeat" || action === "extendSensitive" || action === "sync"
      || KeygrainBrowserOwner.POPUP_RESERVED_ACTIONS.includes(action))) {
    startupPromise.then(async () => {
      const res = chromeOwner.dispatchLegacyOrPhaseB(sender, chrome.runtime.id, message, "chrome", KEYGRAIN_EXTENSION_ORIGIN);
      const snap = typeof chromeOwner.snapshot === "function" ? chromeOwner.snapshot() : null;
      if (snap) {
        if (snap.state === "locked") {
          await clearMemorySession();
        } else if (snap.state === "full" || snap.state === "metadata") {
          const sessionData = await chrome.storage?.session?.get("keygrainSession");
          const session = sessionData?.keygrainSession;
          if (session) {
            const settings = await chromeOwner.loadSettings();
            const metaTailSec = settings?.metadataTailSeconds !== undefined ? settings.metadataTailSeconds : (KEYGRAIN_DEFAULT_SETTINGS?.metadataTailSeconds || 28500);
            session.secret = snap.state === "full" ? session.secret : null;
            session.fullExpiresAt = snap.state === "full" ? snap.fullExpiresAt : null;
            session.metadataExpiresAt = snap.metadataExpiresAt;
            session.metadataTailAnchor = snap.metadataExpiresAt || (snap.fullExpiresAt ? snap.fullExpiresAt + metaTailSec * 1000 : null);
            session.metadata = extractMetadata();
            await chrome.storage?.session?.set({ keygrainSession: session });
          }
        }
      }
      sendResponse(res);
    }).catch(error => sendResponse(safeMessageError(error)));
    return true;
  }
  startupPromise
    .then(() => chromeOwner.dispatchPopupRequest(sender, chrome.runtime.id, message, "chrome", KEYGRAIN_EXTENSION_ORIGIN))
    .then(async (res) => {
      const snap = typeof chromeOwner.snapshot === "function" ? chromeOwner.snapshot() : null;
      if (snap) {
        if (snap.state === "locked") {
          await clearMemorySession();
        } else if (snap.state === "full" || snap.state === "metadata") {
          const sessionData = await chrome.storage?.session?.get("keygrainSession");
          const session = sessionData?.keygrainSession;
          if (session) {
            const settings = await chromeOwner.loadSettings();
            const metaTailSec = settings?.metadataTailSeconds !== undefined ? settings.metadataTailSeconds : (KEYGRAIN_DEFAULT_SETTINGS?.metadataTailSeconds || 28500);
            session.secret = snap.state === "full" ? session.secret : null;
            session.fullExpiresAt = snap.state === "full" ? snap.fullExpiresAt : null;
            session.metadataExpiresAt = snap.metadataExpiresAt;
            session.metadataTailAnchor = snap.metadataExpiresAt || (snap.fullExpiresAt ? snap.fullExpiresAt + metaTailSec * 1000 : null);
            session.metadata = extractMetadata();
            await chrome.storage?.session?.set({ keygrainSession: session });
          }
        }
      }
      sendResponse(res);
    }, error => sendResponse(safeMessageError(error)));
  return true;
});

chrome.runtime.onConnect?.addListener((port) => {
  if (port.name === "keygrain-keepalive") {
    port.onMessage.addListener((msg) => {
      if (msg === "ping") {
        try { port.postMessage("pong"); } catch (_) {}
      }
    });
  }
});

chrome.runtime.onSuspend?.addListener(() => {
  chromeIngressPromise.then(ingress => ingress.revokeAll()).catch(() => {});
  try { chromeOwner.shutdown("runtime_shutdown"); } catch (_) {}
});

