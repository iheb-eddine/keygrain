const KEYGRAIN_DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  fullLeaseSeconds: 60,
  metadataTailSeconds: 14400,
});
const KEYGRAIN_PHASE_B_ACTION = "KEYGRAIN_CONSUMER_MIGRATION_REQUIRED";

function firefoxExtensionOrigin() {
  try {
    const parsed = new URL(browser.runtime.getURL(""));
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch (_) {
    return null;
  }
}

const KEYGRAIN_EXTENSION_ORIGIN = firefoxExtensionOrigin();
const INLINE_SCRIPT_ID = "keygrain-inline";
const INLINE_JS = ["lib/public_suffix_list.js", "public-suffix.js", "autofill.js", "inline-autofill.js", "inline-autofill-ui.js", "content.js"];
let firefoxInlineRegistration = false;
let firefoxRegistrationUnknown = false;
let firefoxIndicatorUnknown = false;

function firefoxAdapterError() {
  return Object.assign(new Error("adapter_failure"), {code: "KEYGRAIN_ADAPTER_ERROR"});
}

function firefoxHost(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch (_) { return null; }
}

function firefoxSiteMatches(site, host) {
  if (!site || !host || !globalThis.KeygrainAutofill
    || typeof globalThis.KeygrainAutofill.isSafeMatchingSite !== "function") return false;
  try {
    return globalThis.KeygrainAutofill.isSafeMatchingSite(site, host)
      && (site === host || host.endsWith("." + site));
  } catch (_) { return false; }
}

async function firefoxClearBadges(check) {
  let tabs;
  try { tabs = await browser.tabs.query({}); check(); }
  catch (error) {
    if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
    firefoxIndicatorUnknown = true;
    throw firefoxAdapterError();
  }
  for (const tab of tabs || []) {
    if (tab.id == null) continue;
    try { check(); await Promise.resolve(browser.action.setBadgeText({text: "", tabId: tab.id})); check(); }
    catch (error) {
      if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
      firefoxIndicatorUnknown = true;
      throw firefoxAdapterError();
    }
  }
}

async function firefoxUnregister(check) {
  if (!firefoxInlineRegistration && !firefoxRegistrationUnknown) return;
  try {
    check();
    await Promise.resolve(browser.scripting.unregisterContentScripts({ids: [INLINE_SCRIPT_ID]}));
    check();
    firefoxInlineRegistration = false;
    firefoxRegistrationUnknown = false;
  } catch (error) {
    if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
    firefoxRegistrationUnknown = true;
    throw firefoxAdapterError();
  }
}

async function firefoxCommitPopupEdit(payload) {
  if (!payload || !payload.email || !payload.secret || !payload.fullData) {
    throw KeygrainBrowserOwner.safeFailure("KEYGRAIN_STALE_OPERATION");
  }
  await persistV2(payload.email, payload.secret, payload.fullData);
  syncWithServer(payload.secret, payload.email, payload.fullData.services, payload.fullData.wallets, payload.fullData.walletAuditLog || [], payload.fullData.tombstones || []).catch(() => {});
  return {ok: true};
}

async function firefoxCommitPopupAdd(payload) {
  if (!payload || !payload.email || !payload.secret || !payload.fullData) {
    throw KeygrainBrowserOwner.safeFailure("KEYGRAIN_STALE_OPERATION");
  }
  await persistV2(payload.email, payload.secret, payload.fullData);
  syncWithServer(payload.secret, payload.email, payload.fullData.services, payload.fullData.wallets, payload.fullData.walletAuditLog || [], payload.fullData.tombstones || []).catch(() => {});
  return {ok: true};
}

async function firefoxCommitPopupDelete(payload) {
  if (!payload || !payload.email || !payload.secret || !payload.fullData) {
    throw KeygrainBrowserOwner.safeFailure("KEYGRAIN_STALE_OPERATION");
  }
  await persistV2(payload.email, payload.secret, payload.fullData);
  syncWithServer(payload.secret, payload.email, payload.fullData.services, payload.fullData.wallets, payload.fullData.walletAuditLog || [], payload.fullData.tombstones || []).catch(() => {});
  return {ok: true};
}

async function firefoxReconcileIndicators({after, projection, check}) {
  try {
    check();
    await Promise.resolve(browser.alarms.clear("keygrain-state-wake"));
    check();
    const deadline = after && (after.state === "full" ? after.fullExpiresAt : after.state === "metadata" ? after.metadataExpiresAt : null);

    const sessionStore = getFirefoxSessionStorage();
    if (sessionStore && after) {
      const sessionData = await sessionStore.get("keygrainSession");
      const session = sessionData?.keygrainSession;
      if (session && session.email) {
        if (after.state === "locked") {
          await sessionStore.remove("keygrainSession");
        } else {
          const settings = await firefoxOwner.loadSettings();
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
      await Promise.resolve(browser.alarms.create("keygrain-state-wake", {when: deadline}));
      check();
    }
  } catch (error) {
    if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
  }
  try { await firefoxUnregister(check); }
  catch (error) {
    if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
    try { await firefoxClearBadges(check); } catch (cleanupError) {
      if (cleanupError?.code === "KEYGRAIN_STALE_OPERATION") throw cleanupError;
    }
    return;
  }
  if (firefoxRegistrationUnknown || firefoxIndicatorUnknown) return;
  const state = after && after.state;
  let enabled = false;
  if (state === "full" || state === "metadata") {
    try {
      const s = await browser.storage.local.get("settings");
      check();
      const raw = await browser.storage.local.get("inlineAutofillEnabled");
      check();
      enabled = Boolean(s?.settings?.inPageAutofill ?? s?.settings?.inlineAutofillEnabled ?? raw?.inlineAutofillEnabled ?? false);
    } catch (error) {
      if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
      await firefoxClearBadges(check);
      return;
    }
  }
  const matches = projection && Array.isArray(projection.matches) ? projection.matches : [];
  try {
    if (enabled && matches.length) {
      check();
      await Promise.resolve(browser.scripting.registerContentScripts([{
        id: INLINE_SCRIPT_ID,
        matches,
        js: INLINE_JS,
        runAt: "document_idle",
        allFrames: false,
        persistAcrossSessions: false,
      }]));
      firefoxInlineRegistration = true;
      check();
      const tabs = await browser.tabs.query({});
      check();
      const sites = projection && Array.isArray(projection.badgeSites) ? projection.badgeSites : [];
      for (const tab of tabs || []) {
        const host = firefoxHost(tab.url);
        if (tab.id == null || !host || !sites.some(site => firefoxSiteMatches(site, host))) continue;
        try {
          check();
          await Promise.resolve(browser.scripting.executeScript({target: {tabId: tab.id}, files: INLINE_JS}));
          check();
        } catch (error) {
          if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
          throw firefoxAdapterError();
        }
      }
    }
    const tabs = await browser.tabs.query({});
    check();
    const sites = projection && Array.isArray(projection.badgeSites) ? projection.badgeSites : [];
    for (const tab of tabs || []) {
      if (tab.id == null) continue;
      const host = firefoxHost(tab.url);
      const count = (state === "full" || state === "metadata") && host
        ? sites.filter(site => firefoxSiteMatches(site, host)).length : 0;
      try {
        check();
        await Promise.resolve(browser.action.setBadgeText({text: count ? String(count) : "", tabId: tab.id}));
        check();
      } catch (error) {
        if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
        throw firefoxAdapterError();
      }
    }
  } catch (error) {
    if (error?.code === "KEYGRAIN_STALE_OPERATION") throw error;
    try { await firefoxUnregister(check); } catch (cleanupError) {
      if (cleanupError?.code === "KEYGRAIN_STALE_OPERATION") throw cleanupError;
    }
    try { await firefoxClearBadges(check); } catch (cleanupError) {
      if (cleanupError?.code === "KEYGRAIN_STALE_OPERATION") throw cleanupError;
    }
  }
}

async function firefoxShutdown() {
  try {
    const registered = await Promise.resolve(browser.scripting.getRegisteredContentScripts({ids: [INLINE_SCRIPT_ID]}));
    if (Array.isArray(registered) && registered.length) {
      await Promise.resolve(browser.scripting.unregisterContentScripts({ids: [INLINE_SCRIPT_ID]}));
    }
    firefoxInlineRegistration = false;
    firefoxRegistrationUnknown = false;
  } catch (_) {
    firefoxRegistrationUnknown = true;
  }
  try {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs || []) if (tab.id != null) {
      await Promise.resolve(browser.action.setBadgeText({text: "", tabId: tab.id}));
    }
    firefoxIndicatorUnknown = false;
  } catch (_) {
    firefoxIndicatorUnknown = true;
  }
}

const firefoxPasswordBindings = new Map();
const firefoxPasswordPendingProofs = new Map();
const firefoxPasswordPendingDeliveries = new Map();

function firefoxExact(value, keys) {
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

function firefoxRandomNonce() {
  try {
    if (!globalThis.crypto || typeof crypto.getRandomValues !== "function") throw new Error("random");
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    let result = "";
    for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
    bytes.fill(0);
    return result;
  } catch (_) { throw firefoxAdapterError(); }
}

async function firefoxCurrentPasswordTab() {
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
      const tabs = await browser.tabs.query(q);
      if (Array.isArray(tabs) && tabs.length > 0) {
        const matching = tabs.filter(t => t && Number.isInteger(t.id) && t.id >= 0 && typeof t.url === "string" && (t.url.startsWith("http:") || t.url.startsWith("https:")));
        if (matching.length > 0) {
          validTabs = matching;
          break;
        }
      }
    }
  } catch (_) { throw firefoxAdapterError(); }
  if (validTabs.length === 0) throw firefoxAdapterError();
  const tab = validTabs[0];
  let parsed;
  try { parsed = new URL(tab.url); } catch (_) { throw firefoxAdapterError(); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw firefoxAdapterError();
  return Object.freeze({tabId: tab.id, frameId: 0, origin: parsed.origin, url: tab.url});
}

function firefoxPageSender(sender, expected) {
  if (!sender || sender.id !== browser.runtime.id || !sender.tab
    || !Number.isInteger(sender.tab.id) || !Number.isInteger(sender.frameId) || sender.tab.id !== expected.tabId || sender.frameId !== expected.frameId || typeof sender.url !== "string") return false;
  try {
    const parsed = new URL(sender.url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === expected.origin;
  } catch (_) { return false; }
}

function firefoxClearBinding(deliveryNonce) {
  const binding = firefoxPasswordBindings.get(deliveryNonce);
  firefoxPasswordBindings.delete(deliveryNonce);
  firefoxPasswordPendingProofs.delete(deliveryNonce);
  if (binding) {
    if (binding.timer) clearTimeout(binding.timer);
    firefoxPasswordPendingDeliveries.delete(`${binding.tabId}:${binding.frameId}:${binding.documentNonce}`);
  }
  return binding;
}

function firefoxReceiveProof(message, sender) {
  if (!firefoxExact(message, ["action", "challenge", "nonce", "hasPasswordField", "hasUsernameField"])
    || message.action !== "keygrain.password.contextProof" || typeof message.challenge !== "string"
    || typeof message.nonce !== "string" || !message.nonce || typeof message.hasPasswordField !== "boolean"
    || typeof message.hasUsernameField !== "boolean") return false;
  for (const [deliveryNonce, pending] of firefoxPasswordPendingProofs) {
    if (pending.challenge !== message.challenge || !firefoxPageSender(sender, pending.context)) continue;
    firefoxPasswordPendingProofs.delete(deliveryNonce);
    clearTimeout(pending.timer);
    const binding = {tabId: pending.context.tabId, frameId: pending.context.frameId, origin: pending.context.origin,
      documentNonce: message.nonce, deliveryNonce};
    firefoxPasswordBindings.set(deliveryNonce, binding);
    binding.timer = setTimeout(() => firefoxClearBinding(deliveryNonce), KeygrainBrowserOwner.KEYGRAIN_PASSWORD_DELIVERY_TTL_MS);
    pending.resolve({ok: true, binding});
    return true;
  }
  return false;
}

function firefoxReceiveDelivery(message, sender) {
  if (!firefoxExact(message, ["ok", "result"]) || message.ok !== true
    || !firefoxExact(message.result, ["passwordFilled", "emailFilled"])
    || typeof message.result.passwordFilled !== "boolean" || typeof message.result.emailFilled !== "boolean") return false;
  for (const [key, pending] of firefoxPasswordPendingDeliveries) {
    const [tabId, frameId, documentNonce] = key.split(":");
    const binding = [...firefoxPasswordBindings.values()].find(item => item.tabId === Number(tabId)
      && item.frameId === Number(frameId) && item.documentNonce === documentNonce);
    if (binding && firefoxPageSender(sender, binding)) {
      firefoxPasswordPendingDeliveries.delete(key);
      clearTimeout(pending.timer);
      pending.resolve(message.result);
      return true;
    }
  }
  return false;
}

async function firefoxGetActivePasswordContext() {
  try { return await firefoxCurrentPasswordTab(); }
  catch (_) { throw Object.assign(new Error("context"), {code: "KEYGRAIN_CONTEXT_ERROR"}); }
}

async function firefoxInjectBridge(context) {
  const current = await firefoxCurrentPasswordTab();
  if (current.tabId !== context.tabId || current.frameId !== context.frameId || current.origin !== context.origin) {
    throw Object.assign(new Error("context"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  try {
    for (const file of ["lib/public_suffix_list.js", "public-suffix.js", "autofill.js", "content.js"]) {
      await Promise.resolve(browser.scripting.executeScript({
        target: {tabId: context.tabId, frameIds: [context.frameId]},
        files: [file],
      }));
    }
  } catch (_) {
    throw Object.assign(new Error("inject"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  const latest = await firefoxCurrentPasswordTab();
  if (latest.tabId !== context.tabId || latest.frameId !== context.frameId || latest.origin !== context.origin) {
    throw Object.assign(new Error("context"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
}

function firefoxClearPendingPasswordProof(deliveryNonce) {
  const pending = firefoxPasswordPendingProofs.get(deliveryNonce);
  if (!pending) return;
  firefoxPasswordPendingProofs.delete(deliveryNonce);
  clearTimeout(pending.timer);
}

async function firefoxProvePasswordContext({context, deliveryNonce}) {
  const current = await firefoxCurrentPasswordTab();
  if (current.tabId !== context.tabId || current.frameId !== context.frameId || current.origin !== context.origin) throw Object.assign(new Error("context"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  const challenge = firefoxRandomNonce();
  const proof = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { firefoxPasswordPendingProofs.delete(deliveryNonce); reject(Object.assign(new Error("timeout"), {code: "KEYGRAIN_CONTEXT_ERROR"})); }, KeygrainBrowserOwner.KEYGRAIN_PASSWORD_DELIVERY_TTL_MS);
    firefoxPasswordPendingProofs.set(deliveryNonce, {challenge, context, timer, resolve, reject});
  });
  const probe = {action: "keygrain.password.contextProbe", challenge, deliveryNonce};
  try {
    await firefoxInjectBridge(context);
    const direct = await browser.tabs.sendMessage(context.tabId, probe, {frameId: context.frameId !== undefined ? context.frameId : 0});
    if (direct?.action === "keygrain.password.contextProof" && direct.challenge === challenge && typeof direct.nonce === "string" && direct.nonce) {
      const pending = firefoxPasswordPendingProofs.get(deliveryNonce);
      if (pending) {
        firefoxPasswordPendingProofs.delete(deliveryNonce);
        clearTimeout(pending.timer);
        const binding = {tabId: context.tabId, frameId: context.frameId, origin: context.origin,
          documentNonce: direct.nonce, deliveryNonce};
        firefoxPasswordBindings.set(deliveryNonce, binding);
        binding.timer = setTimeout(() => firefoxClearBinding(deliveryNonce), KeygrainBrowserOwner.KEYGRAIN_PASSWORD_DELIVERY_TTL_MS);
        pending.resolve({ok: true, binding});
      }
    }
  } catch (_) {
    if (!firefoxPasswordBindings.has(deliveryNonce)) {
      firefoxClearPendingPasswordProof(deliveryNonce);
      throw Object.assign(new Error("probe"), {code: "KEYGRAIN_CONTEXT_ERROR"});
    }
  }
  const result = await proof;
  if (!result?.binding || !firefoxPasswordBindings.has(deliveryNonce)) throw Object.assign(new Error("proof"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  return true;
}

async function firefoxDeliverPassword({context, deliveryNonce, password, email}) {
  const binding = firefoxPasswordBindings.get(deliveryNonce);
  if (!binding || binding.tabId !== context.tabId || binding.frameId !== context.frameId || binding.origin !== context.origin) throw Object.assign(new Error("delivery"), {code: "KEYGRAIN_FILL_DELIVERY_ERROR"});
  const current = await firefoxCurrentPasswordTab();
  if (current.tabId !== binding.tabId || current.frameId !== binding.frameId || current.origin !== binding.origin) {
    firefoxClearBinding(deliveryNonce);
    throw Object.assign(new Error("navigation"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  const result = new Promise((resolve, reject) => {
    const key = `${binding.tabId}:${binding.frameId}:${binding.documentNonce}`;
    const timer = setTimeout(() => { firefoxPasswordPendingDeliveries.delete(key); firefoxClearBinding(deliveryNonce); reject(Object.assign(new Error("timeout"), {code: "KEYGRAIN_FILL_DELIVERY_ERROR"})); }, KeygrainBrowserOwner.KEYGRAIN_PASSWORD_DELIVERY_TTL_MS);
    firefoxPasswordPendingDeliveries.set(key, {resolve, timer});
  });
  const delivery = {action: "keygrain.password.fillResult", deliveryNonce, password, email};
  let direct = null;
  try { direct = await browser.tabs.sendMessage(binding.tabId, delivery, {frameId: binding.frameId !== undefined ? binding.frameId : 0}); }
  catch (_) { firefoxClearBinding(deliveryNonce); throw Object.assign(new Error("delivery"), {code: "KEYGRAIN_FILL_DELIVERY_ERROR"}); }
  let response = null;
  if (direct?.ok === true && direct?.result && typeof direct.result.passwordFilled === "boolean") {
    const key = `${binding.tabId}:${binding.frameId}:${binding.documentNonce}`;
    const pending = firefoxPasswordPendingDeliveries.get(key);
    if (pending) {
      firefoxPasswordPendingDeliveries.delete(key);
      clearTimeout(pending.timer);
    }
    response = direct.result;
  } else {
    response = await result;
  }
  const latest = await firefoxCurrentPasswordTab();
  if (latest.tabId !== binding.tabId || latest.frameId !== binding.frameId || latest.origin !== binding.origin) {
    firefoxClearBinding(deliveryNonce);
    throw Object.assign(new Error("navigation"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  firefoxClearBinding(deliveryNonce);
  return response;
}

function firefoxShutdownPasswordBindings() {
  for (const nonce of [...firefoxPasswordBindings.keys()]) firefoxClearBinding(nonce);
  firefoxPasswordPendingProofs.clear();
  firefoxPasswordPendingDeliveries.clear();
}

function firefoxInvalidateTab(tabId) {
  for (const [nonce, binding] of firefoxPasswordBindings) if (binding.tabId === tabId) firefoxClearBinding(nonce);
  for (const [nonce, pending] of firefoxPasswordPendingProofs) if (pending.context.tabId === tabId) {
    clearTimeout(pending.timer); firefoxPasswordPendingProofs.delete(nonce); pending.reject?.(Object.assign(new Error("navigation"), {code: "KEYGRAIN_CONTEXT_ERROR"}));
  }
}

const firefoxTotpBindings = new Map();
const firefoxTotpPendingProofs = new Map();
const firefoxTotpPendingDeliveries = new Map();

function firefoxTotpBounded(value) {
  try { return typeof value === "string" && value.length > 0
    && new TextEncoder().encode(value).byteLength <= KeygrainBrowserOwner.KEYGRAIN_TOTP_MAX_FIELD_UTF8; }
  catch (_) { return false; }
}

function firefoxClearTotpBinding(deliveryNonce) {
  const binding = firefoxTotpBindings.get(deliveryNonce);
  firefoxTotpBindings.delete(deliveryNonce);
  const proof = firefoxTotpPendingProofs.get(deliveryNonce);
  if (proof) {
    clearTimeout(proof.timer); firefoxTotpPendingProofs.delete(deliveryNonce);
    proof.reject?.(Object.assign(new Error("shutdown"), {code: "KEYGRAIN_CONTEXT_ERROR"}));
  }
  const pending = firefoxTotpPendingDeliveries.get(deliveryNonce);
  if (pending) {
    clearTimeout(pending.timer); firefoxTotpPendingDeliveries.delete(deliveryNonce);
    pending.reject?.(Object.assign(new Error("shutdown"), {code: "KEYGRAIN_TOTP_DELIVERY_ERROR"}));
  }
  if (binding?.timer) clearTimeout(binding.timer);
  return binding;
}

function firefoxClearTotpPendingProof(deliveryNonce) {
  const proof = firefoxTotpPendingProofs.get(deliveryNonce);
  if (!proof) return;
  firefoxTotpPendingProofs.delete(deliveryNonce);
  clearTimeout(proof.timer);
}

function firefoxReceiveTotpProof(message, sender) {
  if (!firefoxExact(message, ["action", "challenge", "nonce", "hasOtpField"])
    || message.action !== "keygrain.totp.contextProof" || !firefoxTotpBounded(message.challenge)
    || !firefoxTotpBounded(message.nonce) || message.hasOtpField !== true) return false;
  for (const [deliveryNonce, pending] of firefoxTotpPendingProofs) {
    if (pending.challenge !== message.challenge || !firefoxPageSender(sender, pending.context)
     ) continue;
    firefoxTotpPendingProofs.delete(deliveryNonce);
    clearTimeout(pending.timer);
    const binding = {tabId: pending.context.tabId, frameId: pending.context.frameId,
      origin: pending.context.origin, documentNonce: message.nonce, deliveryNonce};
    binding.timer = setTimeout(() => firefoxClearTotpBinding(deliveryNonce), KeygrainBrowserOwner.KEYGRAIN_TOTP_DELIVERY_TTL_MS);
    firefoxTotpBindings.set(deliveryNonce, binding);
    pending.resolve(true);
    return true;
  }
  return false;
}

function firefoxReceiveTotpDelivery(message, sender) {
  if (!firefoxExact(message, ["ok", "result"]) || message.ok !== true
    || !firefoxExact(message.result, ["codeFilled"]) || message.result.codeFilled !== true) return false;
  for (const [deliveryNonce, pending] of firefoxTotpPendingDeliveries) {
    const binding = firefoxTotpBindings.get(deliveryNonce);
    if (binding && firefoxPageSender(sender, binding)) {
      firefoxTotpPendingDeliveries.delete(deliveryNonce);
      clearTimeout(pending.timer);
      pending.resolve({codeFilled: true});
      return true;
    }
  }
  return false;
}

async function firefoxGetActiveTotpContext() {
  try { return await firefoxCurrentPasswordTab(); }
  catch (_) { throw Object.assign(new Error("context"), {code: "KEYGRAIN_CONTEXT_ERROR"}); }
}

async function firefoxProveTotpContext({context, deliveryNonce}) {
  const current = await firefoxCurrentPasswordTab();
  if (current.tabId !== context.tabId || current.frameId !== context.frameId || current.origin !== context.origin) {
    throw Object.assign(new Error("context"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  const challenge = firefoxRandomNonce();
  const proof = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      firefoxTotpPendingProofs.delete(deliveryNonce);
      reject(Object.assign(new Error("timeout"), {code: "KEYGRAIN_TOTP_DELIVERY_ERROR"}));
    }, KeygrainBrowserOwner.KEYGRAIN_TOTP_DELIVERY_TTL_MS);
    firefoxTotpPendingProofs.set(deliveryNonce, {challenge, context, timer, resolve, reject});
  });
  try {
    await firefoxInjectBridge(context);
    const direct = await browser.tabs.sendMessage(context.tabId, {action: "keygrain.totp.contextProbe", challenge, deliveryNonce}, {frameId: context.frameId !== undefined ? context.frameId : 0});
    if (direct?.action === "keygrain.totp.contextProof" && direct.challenge === challenge && typeof direct.nonce === "string" && direct.nonce && direct.hasOtpField === true) {
      const pending = firefoxTotpPendingProofs.get(deliveryNonce);
      if (pending) {
        firefoxTotpPendingProofs.delete(deliveryNonce);
        clearTimeout(pending.timer);
        const binding = {tabId: context.tabId, frameId: context.frameId, origin: context.origin,
          documentNonce: direct.nonce, deliveryNonce};
        binding.timer = setTimeout(() => firefoxClearTotpBinding(deliveryNonce), KeygrainBrowserOwner.KEYGRAIN_TOTP_DELIVERY_TTL_MS);
        firefoxTotpBindings.set(deliveryNonce, binding);
        pending.resolve(true);
      }
    }
  } catch (_) {
    if (!firefoxTotpBindings.has(deliveryNonce)) {
      firefoxClearTotpPendingProof(deliveryNonce);
      throw Object.assign(new Error("probe"), {code: "KEYGRAIN_CONTEXT_ERROR"});
    }
  }
  return proof;
}

async function firefoxDeliverTotp({context, deliveryNonce, code}) {
  const binding = firefoxTotpBindings.get(deliveryNonce);
  if (!binding || binding.tabId !== context.tabId || binding.frameId !== context.frameId || binding.origin !== context.origin) {
    throw Object.assign(new Error("delivery"), {code: "KEYGRAIN_TOTP_DELIVERY_ERROR"});
  }
  const current = await firefoxCurrentPasswordTab();
  if (current.tabId !== binding.tabId || current.frameId !== binding.frameId || current.origin !== binding.origin) {
    firefoxClearTotpBinding(deliveryNonce);
    throw Object.assign(new Error("navigation"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      firefoxClearTotpBinding(deliveryNonce);
      reject(Object.assign(new Error("timeout"), {code: "KEYGRAIN_TOTP_DELIVERY_ERROR"}));
    }, KeygrainBrowserOwner.KEYGRAIN_TOTP_DELIVERY_TTL_MS);
    firefoxTotpPendingDeliveries.set(deliveryNonce, {resolve, reject, timer});
  });
  let direct = null;
  try {
    direct = await browser.tabs.sendMessage(binding.tabId, {action: "keygrain.totp.fillResult", deliveryNonce, code}, {frameId: binding.frameId !== undefined ? binding.frameId : 0});
  } catch (_) {
    firefoxClearTotpBinding(deliveryNonce);
    throw Object.assign(new Error("delivery"), {code: "KEYGRAIN_TOTP_DELIVERY_ERROR"});
  }
  let response = null;
  if (direct?.ok === true && direct?.result && direct.result.codeFilled === true) {
    const pending = firefoxTotpPendingDeliveries.get(deliveryNonce);
    if (pending) {
      firefoxTotpPendingDeliveries.delete(deliveryNonce);
      clearTimeout(pending.timer);
    }
    response = direct.result;
  } else {
    response = await result;
  }
  const latest = await firefoxCurrentPasswordTab();
  if (latest.tabId !== binding.tabId || latest.frameId !== binding.frameId || latest.origin !== binding.origin) {
    firefoxClearTotpBinding(deliveryNonce);
    throw Object.assign(new Error("navigation"), {code: "KEYGRAIN_CONTEXT_ERROR"});
  }
  firefoxClearTotpBinding(deliveryNonce);
  return response;
}

function firefoxShutdownTotpBindings() {
  for (const nonce of [...firefoxTotpBindings.keys(), ...firefoxTotpPendingProofs.keys(), ...firefoxTotpPendingDeliveries.keys()]) firefoxClearTotpBinding(nonce);
  firefoxTotpPendingProofs.clear();
  firefoxTotpPendingDeliveries.clear();
}

function firefoxInvalidateTotpTab(tabId) {
  for (const [nonce, binding] of firefoxTotpBindings) if (binding.tabId === tabId) firefoxClearTotpBinding(nonce);
  for (const [nonce, pending] of firefoxTotpPendingProofs) if (pending.context.tabId === tabId) {
    firefoxClearTotpBinding(nonce);
  }
}

const firefoxOwnerAdapter = Object.freeze({
  browser: "firefox",
  storage: browser.storage.local,
  runtimeId: () => browser.runtime.id,
  reconcileIndicators: firefoxReconcileIndicators,
  shutdown: async () => { firefoxShutdownPasswordBindings(); firefoxShutdownTotpBindings(); await firefoxShutdown(); },
  getActivePasswordContext: firefoxGetActivePasswordContext,
  getActiveTotpContext: firefoxGetActiveTotpContext,
  proveTotpContext: firefoxProveTotpContext,
  deliverTotp: firefoxDeliverTotp,
  provePasswordContext: firefoxProvePasswordContext,
  deliverPassword: firefoxDeliverPassword,
  commitKeygrainPopupServiceEdit: firefoxCommitPopupEdit,
  commitKeygrainPopupServiceAdd: firefoxCommitPopupAdd,
  commitKeygrainPopupServiceDelete: firefoxCommitPopupDelete,
  switchAccount: async () => {
    await browser.storage.local.remove([
      "services", "syncKnownUUIDs", "lastSyncTime", "lastSuccessfulSyncAt",
      "pinHash", "pinSalt", "pinIterations", "pinLength",
      "autofillRules", "lastSyncETag", "account_email"
    ]);
    await clearMemorySession();
    try {
      const sessionStore = getFirefoxSessionStorage();
      if (sessionStore) await sessionStore.remove(["keygrainSession", "pendingAutofillIntent"]);
    } catch (_) {}
    try {
      const prev = firefoxIngressPromise;
      firefoxIngressPromise = createFirefoxIngress();
      prev?.then?.(ingress => ingress.revokeAll?.())?.catch?.(() => {});
    } catch (_) {}
    await firefoxShutdown();
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
    await browser.storage.local.set({
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
  const data = await browser.storage.local.get(["services", "syncKnownUUIDs", "lastSyncTime", "account_email"]);
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
    await browser.storage.local.remove("syncKnownUUIDs");
    if (data.lastSyncTime !== undefined) {
      await browser.storage.local.set({lastSuccessfulSyncAt: data.lastSyncTime || 0});
    }
  } else if (stored === undefined || isDifferentAccount) {
    await persistV2(email, secret, prepared.fullData);
  }
  return prepared;
}

const firefoxOwner = KeygrainBrowserOwner.createOwner({
  adapter: firefoxOwnerAdapter,
  settings: KEYGRAIN_DEFAULT_SETTINGS,
  authenticateAndPrepare: readAndPrepare,
});

function getFirefoxSessionStorage() {
  try {
    if (typeof browser !== "undefined" && browser?.storage?.session) return browser.storage.session;
    if (typeof chrome !== "undefined" && chrome?.storage?.session) return chrome.storage.session;
  } catch (_) {}
  return null;
}

function extractMetadata() {
  try {
    const services = firefoxOwner.getServicesList ? (firefoxOwner.getServicesList() || []) : [];
    if (services.length > 0) {
      return services.map(s => ({
        id: String(s.id || ""),
        site: String(s.site || ""),
        name: String(s.name || ""),
        email: String(s.email || "")
      }));
    }
    const meta = firefoxOwner.getMetadata ? (firefoxOwner.getMetadata() || []) : [];
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
    const sessionStore = getFirefoxSessionStorage();
    if (!sessionStore) return;
    if (snap && (snap.state === "full" || snap.state === "metadata")) {
      const settings = await firefoxOwner.loadSettings();
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
    const sessionStore = getFirefoxSessionStorage();
    if (sessionStore) await sessionStore.remove(["keygrainSession", "pendingAutofillIntent"]);
  } catch (_) {}
  try {
    if (typeof clearStrengthenCache === "function") clearStrengthenCache();
  } catch (_) {}
}

async function checkAccountExists(email, secret) {
  try {
    const data = await browser.storage.local.get(["services", "settings", "account_email"]);
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

function createFirefoxIngress() {
  return KeygrainWorkerIngress.createIngress({
    crypto: globalThis.crypto,
    runtimeAdmission: {
      issue({runtimeContext}) {
        return KeygrainBrowserOwner.isTrustedExtensionPage(runtimeContext?.sender, browser.runtime.id, "unlock", "firefox", KEYGRAIN_EXTENSION_ORIGIN);
      },
      admit({runtimeContext}) {
        return KeygrainBrowserOwner.isTrustedExtensionPage(runtimeContext?.sender, browser.runtime.id, "unlock", "firefox", KEYGRAIN_EXTENSION_ORIGIN);
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
          await firefoxOwner.switchAccount?.(
            runtimeContext.sender,
            browser.runtime.id,
            "firefox",
            KEYGRAIN_EXTENSION_ORIGIN,
          );
        } catch (_) {}
      }
      const settings = await firefoxOwner.loadSettings();
      let confirmationId = null;
      if (settings?.fullLeaseSeconds === 1800) {
        try {
          confirmationId = firefoxOwner.issueConfirmation(
            runtimeContext.popupSessionId || ("unlock-" + Date.now()),
            runtimeContext.sender?.url || ""
          );
        } catch (_) {}
      }
      const res = await firefoxOwner.unlock(
        runtimeContext.sender,
        browser.runtime.id,
        {action: "unlock", email, secret, popupSessionId: runtimeContext.popupSessionId, confirmationId},
        "firefox",
        KEYGRAIN_EXTENSION_ORIGIN,
      );
      if (res?.ok) {
        const snap = typeof firefoxOwner.snapshot === "function" ? firefoxOwner.snapshot() : null;
        if (snap) await saveSession({ email, secret, snap });
        return {ok: true};
      }
      return res || {ok: false, code: "KEYGRAIN_UNLOCK_FAILED", message: "Unlock failed; try again."};
    },
  });
}

let firefoxIngressPromise = createFirefoxIngress();

const startupPromise = (async () => {
  await firefoxShutdown();
  await firefoxOwner.loadSettings();
  await KeygrainBrowserOwner.cleanupLegacyPreferences(browser.storage.local);
  try {
    const sessionStore = getFirefoxSessionStorage();
    const sessionData = await sessionStore?.get("keygrainSession");
    const session = sessionData?.keygrainSession;
    if (session && session.email) {
      const now = Date.now();
      if (session.secret && session.fullExpiresAt && now < session.fullExpiresAt) {
        const prepared = await readAndPrepare({
          email: session.email,
          secret: session.secret,
          popupSessionId: "sw-restore-" + Date.now(),
        });
        const payload = firefoxOwner.preparedUnlock ? firefoxOwner.preparedUnlock(prepared) : prepared;
        firefoxOwner.restoreSession({
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
        firefoxOwner.restoreSession({
          email: session.email,
          metadata: session.metadata,
          metadataExpiresAt: session.metadataExpiresAt || session.metadataTailAnchor,
          metadataTailAnchor: session.metadataTailAnchor,
          activeMetadataTailSeconds: (session.metadataTailAnchor && session.fullExpiresAt)
            ? Math.round((session.metadataTailAnchor - session.fullExpiresAt) / 1000)
            : null,
        });
        if (session.secret) {
          await sessionStore?.set({
            keygrainSession: {
              ...session,
              secret: null,
              fullExpiresAt: null,
            }
          });
        }
      } else {
        await sessionStore?.remove("keygrainSession");
      }
    }
  } catch (_) {}
  firefoxOwner.reconcile("startup");
  await firefoxOwner.whenReconciled();
})();

if (browser.tabs?.onActivated?.addListener) {
  browser.tabs.onActivated.addListener(() => {
    startupPromise.then(() => {
      firefoxOwner.reconcile("tab_activated");
    }).catch(() => {});
  });
}
if (browser.tabs?.onUpdated?.addListener) {
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    firefoxInvalidateTab(tabId);
    firefoxInvalidateTotpTab(tabId);
    if (changeInfo.status === "complete") {
      startupPromise.then(() => {
        firefoxOwner.reconcile("tab_updated");
      }).catch(() => {});
    }
  });
}
if (browser.tabs?.onReplaced?.addListener) browser.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  firefoxInvalidateTab(addedTabId); firefoxInvalidateTab(removedTabId);
  firefoxInvalidateTotpTab(addedTabId); firefoxInvalidateTotpTab(removedTabId);
});
if (browser.tabs?.onRemoved?.addListener) browser.tabs.onRemoved.addListener(tabId => { firefoxInvalidateTab(tabId); firefoxInvalidateTotpTab(tabId); });
if (browser.alarms?.onAlarm?.addListener) {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === "keygrain-state-wake") startupPromise.then(async () => { const snap = await firefoxOwner.reconcile("wake");
      if (snap) {
        if (snap.state === "locked") {
          await clearMemorySession();
        } else if (snap.state === "metadata") {
          const sessionStore = getFirefoxSessionStorage();
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
  try { browser.action?.openPopup?.(); } catch {}
}

function afSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function focusedFieldIsOtp(tab) {
  const snap = firefoxOwner.snapshot();
  if (snap.state !== "full") return false;
  if (!tab?.url) return false;
  try {
    if (browser.scripting?.executeScript) {
      const [{result}] = await browser.scripting.executeScript({
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
    }
  } catch { return false; }
  return false;
}

async function tabAutofill(tab) {
  await startupPromise;
  const snap = firefoxOwner.snapshot();
  if (snap.state === "locked") {
    openPopupSafe();
    return;
  }
  if (!tab?.url) { openPopupSafe(); return; }
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { openPopupSafe(); return; }
  if (!host) { openPopupSafe(); return; }

  const services = firefoxOwner.getServicesList();
  if (!services || !services.length) { openPopupSafe(); return; }
  const matches = (globalThis.KeygrainAutofill || (typeof KeygrainAutofill !== "undefined" ? KeygrainAutofill : null)).filterMostSpecific(services, host);
  if (matches.length === 0) { openPopupSafe(); return; }

  if (matches.length > 1) {
    let triggered = false;
    try {
      const resp = await browser.tabs.sendMessage(tab.id, { action: "triggerInlineDropdown", kind: "login" });
      if (resp?.ok) triggered = true;
    } catch (_) {}
    if (!triggered) {
      try {
        if (browser.scripting?.executeScript) {
          await browser.scripting.executeScript({ target: { tabId: tab.id }, files: INLINE_JS });
          const resp = await browser.tabs.sendMessage(tab.id, { action: "triggerInlineDropdown", kind: "login" });
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
      const sessionStore = getFirefoxSessionStorage();
      await sessionStore?.set({
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
  const derived = await firefoxOwner.derivePasswordForService(bestMatch.id);
  if (!derived) { openPopupSafe(); return; }

  let origin;
  try { origin = new URL(tab.url).origin; } catch { openPopupSafe(); return; }
  const context = {tabId: tab.id, frameId: 0, origin};
  const deliveryNonce = firefoxRandomNonce();
  try {
    await firefoxProvePasswordContext({context, deliveryNonce});
    await firefoxDeliverPassword({context, deliveryNonce, password: derived.password, email: derived.email});
  } catch (_) {
    openPopupSafe();
  }
}

async function tabAutofillOtp(tab) {
  await startupPromise;
  const snap = firefoxOwner.snapshot();
  if (snap.state === "locked") {
    openPopupSafe();
    return;
  }
  if (!tab?.url) { openPopupSafe(); return; }
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { openPopupSafe(); return; }
  if (!host) { openPopupSafe(); return; }

  const services = firefoxOwner.getServicesList();
  if (!services || !services.length) { openPopupSafe(); return; }
  const matches = (globalThis.KeygrainAutofill || (typeof KeygrainAutofill !== "undefined" ? KeygrainAutofill : null)).filterMostSpecific(services, host).filter(s => s && s.totp);
  if (matches.length === 0) { openPopupSafe(); return; }

  if (matches.length > 1) {
    let triggered = false;
    try {
      const resp = await browser.tabs.sendMessage(tab.id, { action: "triggerInlineDropdown", kind: "otp" });
      if (resp?.ok) triggered = true;
    } catch (_) {}
    if (!triggered) {
      try {
        if (browser.scripting?.executeScript) {
          await browser.scripting.executeScript({ target: { tabId: tab.id }, files: INLINE_JS });
          const resp = await browser.tabs.sendMessage(tab.id, { action: "triggerInlineDropdown", kind: "otp" });
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
      const sessionStore = getFirefoxSessionStorage();
      await sessionStore?.set({
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
  const derived = await firefoxOwner.deriveTotpForService(bestMatch.id);
  if (!derived?.code) { openPopupSafe(); return; }

  let origin;
  try { origin = new URL(tab.url).origin; } catch { openPopupSafe(); return; }
  const context = {tabId: tab.id, frameId: 0, origin};
  const deliveryNonce = firefoxRandomNonce();
  try {
    await firefoxProveTotpContext({context, deliveryNonce});
    await firefoxDeliverTotp({context, deliveryNonce, code: derived.code});
  } catch (_) {
    openPopupSafe();
  }
}

// === Keyboard Shortcut ===
if (browser.commands?.onCommand?.addListener) {
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== "fill_credentials") return;
    const [tab] = await browser.tabs.query({active: true, currentWindow: true});
    if (!tab) return;
    if (await focusedFieldIsOtp(tab)) await tabAutofillOtp(tab);
    else await tabAutofill(tab);
  });
}

// === Context Menu ===
if (browser.runtime?.onInstalled?.addListener) {
  browser.runtime.onInstalled.addListener(() => {
    try {
      browser.contextMenus?.create({id: "keygrain-fill", title: "Fill with Keygrain", contexts: ["editable"]});
      browser.contextMenus?.create({id: "keygrain-fill-otp", title: "Fill one-time code with Keygrain", contexts: ["editable"]});
    } catch (_) {}
  });
}

if (browser.contextMenus?.onClicked?.addListener) {
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === "keygrain-fill") await tabAutofill(tab);
    else if (info.menuItemId === "keygrain-fill-otp") await tabAutofillOtp(tab);
  });
}

async function inlineEnabled() {
  const settings = await firefoxOwner.loadSettings();
  return !!(settings?.inPageAutofill || settings?.inlineAutofillEnabled);
}

function inlineUnlocked() {
  const snap = firefoxOwner.snapshot();
  return snap.state === "full" || snap.state === "metadata";
}

async function broadcastInline(msg) {
  let tabs;
  try { tabs = await browser.tabs.query({}); } catch { return; }
  for (const tab of tabs) {
    if (tab.id == null) continue;
    browser.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

browser.permissions?.onRemoved?.addListener(async (permissions) => {
  if (permissions.origins && permissions.origins.includes("*://*/*")) {
    await firefoxOwner.saveSettings({inPageAutofill: false});
    await broadcastInline({action: "inlineDisabled"});
    await firefoxOwner.reconcile("permission_removed");
  }
});

browser.permissions?.onAdded?.addListener(async (permissions) => {
  if (permissions.origins && permissions.origins.includes("*://*/*")) {
    await firefoxOwner.saveSettings({inPageAutofill: true});
    await firefoxOwner.reconcile("permission_added");
  }
});

browser.runtime.onMessage.addListener((message, sender) => {
  const inboundAction = KeygrainBrowserOwner.peekPopupAction(message);
  if (inboundAction === "keygrain.password.contextProof") {
    firefoxReceiveProof(message, sender);
    return false;
  }
  if (inboundAction === "keygrain.totp.contextProof") {
    firefoxReceiveTotpProof(message, sender);
    return false;
  }
  if (inboundAction === "keygrain.password.fillResult") {
    firefoxReceiveDelivery(message, sender);
    return false;
  }
  if (inboundAction === "keygrain.totp.fillResult") {
    firefoxReceiveTotpDelivery(message, sender);
    return false;
  }
  if (sender && sender.tab && (firefoxReceiveTotpDelivery(message, sender) || firefoxReceiveDelivery(message, sender))) return false;

  // Inline Autofill and Content Script Actions
  if (inboundAction === "inlineAutofillEnabledChanged") {
    return (async () => {
      await startupPromise;
      if (!message.enabled) {
        await broadcastInline({action: "inlineDisabled"});
      }
      await firefoxOwner.reconcile("setting_changed");
      return {ok: true};
    })();
  }
  if (inboundAction === "reregisterInlineAutofill") {
    return (async () => {
      await startupPromise;
      await firefoxOwner.reconcile("setting_changed");
      return {ok: true};
    })();
  }
  if (inboundAction === "getInlineMatches") {
    return (async () => {
      try {
        await startupPromise;
        const tabUrl = sender.tab?.url || sender.url;
        if (!tabUrl) return {enabled: false, locked: false, accounts: []};
        const isDemand = !!message?.onDemand;
        if (!isDemand && !(await inlineEnabled())) return {enabled: false, locked: false, accounts: []};
        const snap = firefoxOwner.snapshot();
        if (snap.state === "locked") return {enabled: true, locked: true, accounts: []};
        const host = new URL(tabUrl).hostname.replace(/^www\./, "").toLowerCase();
        let services = firefoxOwner.getServicesList();
        if (!services && snap.state === "metadata") {
          services = firefoxOwner.getMetadata() || null;
        }
        if (!services) return {enabled: true, locked: snap.state !== "full", accounts: []};
        const autofillHelper = globalThis.KeygrainAutofill || (typeof KeygrainAutofill !== "undefined" ? KeygrainAutofill : null);
        const inlineHelper = globalThis.KeygrainInline || (typeof KeygrainInline !== "undefined" ? KeygrainInline : null);
        const matches = autofillHelper ? autofillHelper.filterMostSpecific(services, host) : [];
        const ranked = autofillHelper ? autofillHelper.rankServices(matches) : [];
        const accounts = inlineHelper ? ranked.map(inlineHelper.sanitizeAccountForContent) : [];
        return {enabled: true, locked: false, accounts};
      } catch {
        return {enabled: true, locked: false, accounts: []};
      }
    })();
  }
  if (inboundAction === "getInlineOtpMatches") {
    return (async () => {
      try {
        await startupPromise;
        const tabUrl = sender.tab?.url || sender.url;
        if (!tabUrl) return {enabled: false, locked: false, accounts: []};
        const isDemand = !!message?.onDemand;
        if (!isDemand && !(await inlineEnabled())) return {enabled: false, locked: false, accounts: []};
        const snap = firefoxOwner.snapshot();
        if (snap.state === "locked") return {enabled: true, locked: true, accounts: []};
        const host = new URL(tabUrl).hostname.replace(/^www\./, "").toLowerCase();
        let services = firefoxOwner.getServicesList();
        if (!services && snap.state === "metadata") {
          services = firefoxOwner.getMetadata() || null;
        }
        if (!services) return {enabled: true, locked: snap.state !== "full", accounts: []};
        const autofillHelper = globalThis.KeygrainAutofill || (typeof KeygrainAutofill !== "undefined" ? KeygrainAutofill : null);
        const inlineHelper = globalThis.KeygrainInline || (typeof KeygrainInline !== "undefined" ? KeygrainInline : null);
        const matches = autofillHelper ? autofillHelper.filterMostSpecific(services, host).filter(s => snap.state === "metadata" || (s && s.totp)) : [];
        const ranked = autofillHelper ? autofillHelper.rankServices(matches) : [];
        const accounts = inlineHelper ? ranked.map(inlineHelper.sanitizeAccountForContent) : [];
        return {enabled: true, locked: false, accounts};
      } catch {
        return {enabled: true, locked: false, accounts: []};
      }
    })();
  }
  if (inboundAction === "fillInline") {
    (async () => {
      try {
        await startupPromise;
        const tabUrl = sender.tab?.url || sender.url;
        if (!tabUrl) return;
        const snap = firefoxOwner.snapshot();
        if (snap.state !== "full") {
          if (snap.state === "metadata") {
            const sessionStore = getFirefoxSessionStorage();
            await sessionStore?.set({
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
        const derived = await firefoxOwner.derivePasswordForService(s => s.id === message.token && firefoxSiteMatches(s.site || s.name, host));
        if (!derived) return;
        let origin;
        try { origin = new URL(tabUrl).origin; } catch { return; }
        const context = {tabId: sender.tab?.id != null ? sender.tab.id : null, frameId: sender.frameId || 0, origin};
        const deliveryNonce = firefoxRandomNonce();
        await firefoxProvePasswordContext({context, deliveryNonce});
        await firefoxDeliverPassword({context, deliveryNonce, password: derived.password, email: derived.email});
      } catch {}
    })();
    return false;
  }
  if (inboundAction === "fillInlineOtp") {
    (async () => {
      try {
        await startupPromise;
        const tabUrl = sender.tab?.url || sender.url;
        if (!tabUrl) return;
        const snap = firefoxOwner.snapshot();
        if (snap.state !== "full") {
          if (snap.state === "metadata") {
            const sessionStore = getFirefoxSessionStorage();
            await sessionStore?.set({
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
        const derived = await firefoxOwner.deriveTotpForService(s => s.id === message.token && firefoxSiteMatches(s.site || s.name, host) && s.totp);
        if (!derived?.code) return;
        let origin;
        try { origin = new URL(tabUrl).origin; } catch { return; }
        const context = {tabId: sender.tab?.id != null ? sender.tab.id : null, frameId: sender.frameId || 0, origin};
        const deliveryNonce = firefoxRandomNonce();
        await firefoxProveTotpContext({context, deliveryNonce});
        await firefoxDeliverTotp({context, deliveryNonce, code: derived.code});
      } catch {}
    })();
    return false;
  }

  // Extension Pages & Popups
  if (!KeygrainBrowserOwner.isTrustedExtensionPage(sender, browser.runtime.id, null, "firefox", KEYGRAIN_EXTENSION_ORIGIN)) {
    return Promise.resolve(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR));
  }
  const action = inboundAction;

  if (action === "deriveCustomWalletMnemonic") {
    return startupPromise.then(() => firefoxOwner.deriveCustomWalletMnemonic(message))
      .then(res => {
        if (!res) return KeygrainBrowserOwner.safeFailure("LOCKED");
        return KeygrainBrowserOwner.success(res);
      }).catch(safeMessageError);
  }
  if (action === "getUnlockState") {
    return startupPromise.then(async () => {
      const snap = firefoxOwner.snapshot();
      let email = null;
      if (snap.state === "full") {
        const opHandle = firefoxOwner.manager.beginSensitiveOperation({capture: fullData => ({email: fullData?.email || null})});
        try {
          const input = firefoxOwner.manager.getSensitiveOperationInput(opHandle);
          email = input?.email || null;
        } finally {
          try { firefoxOwner.manager.completeSensitiveOperation(opHandle, "get_unlock_state"); } catch (_) {}
        }
      }
      let authenticatedEmail = firefoxOwner.getAuthenticatedEmail?.() || email;
      if (!authenticatedEmail) {
        try {
          const sessionStore = getFirefoxSessionStorage();
          const sessionData = await sessionStore?.get("keygrainSession");
          authenticatedEmail = sessionData?.keygrainSession?.email || null;
        } catch (_) {}
      }
      return KeygrainBrowserOwner.success({
        state: snap.state,
        isUnlocked: snap.state === "full",
        email: authenticatedEmail,
      });
    }).catch(safeMessageError);
  }
  if (action === "getSecret" || action === "getEmail") {
    return startupPromise.then(async () => {
      const snap = firefoxOwner.snapshot();
      if (snap.state !== "full") return KeygrainBrowserOwner.safeFailure("LOCKED");
      let secret = null;
      let email = null;
      const opHandle = firefoxOwner.manager.beginSensitiveOperation({capture: fullData => ({secret: fullData?.secret, email: fullData?.email})});
      try {
        const input = firefoxOwner.manager.getSensitiveOperationInput(opHandle);
        secret = input?.secret || null;
        email = input?.email || null;
      } finally {
        try { firefoxOwner.manager.completeSensitiveOperation(opHandle, "get_credentials"); } catch (_) {}
      }
      if (action === "getSecret") return {secret};
      return {email};
    }).catch(safeMessageError);
  }
  if (action === "getSavedWallets") {
    return startupPromise.then(async () => {
      const snap = firefoxOwner.snapshot();
      if (snap.state === "locked") return KeygrainBrowserOwner.safeFailure("LOCKED");
      let wallets = [];
      const opHandle = firefoxOwner.manager.beginSensitiveOperation({capture: fullData => ({wallets: fullData?.wallets || []})});
      try {
        const input = firefoxOwner.manager.getSensitiveOperationInput(opHandle);
        wallets = input?.wallets || [];
      } finally {
        try { firefoxOwner.manager.completeSensitiveOperation(opHandle, "get_saved_wallets"); } catch (_) {}
      }
      return KeygrainBrowserOwner.success({wallets});
    }).catch(safeMessageError);
  }
  if (action === "saveWallet") {
    return startupPromise.then(async () => {
      const snap = firefoxOwner.snapshot();
      if (snap.state === "locked") return KeygrainBrowserOwner.safeFailure("LOCKED");
      const { walletName, chain, counter, email } = message;
      if (!walletName || !chain || !counter) return KeygrainBrowserOwner.safeFailure("INVALID_PARAMS");
      let updatedWallets = [];
      let fullDataToPersist = null;
      let accountEmail = "";
      const opHandle = firefoxOwner.manager.beginSensitiveOperation({
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
        firefoxOwner.manager.getSensitiveOperationInput(opHandle);
      } finally {
        try { firefoxOwner.manager.completeSensitiveOperation(opHandle, "save_wallet"); } catch (_) {}
      }
      if (fullDataToPersist) {
        try {
          const sessionStore = getFirefoxSessionStorage();
          const sessionData = await sessionStore?.get("keygrainSession");
          const activeSecret = sessionData?.keygrainSession?.secret;
          if (activeSecret && accountEmail) {
            await persistV2(accountEmail, activeSecret, fullDataToPersist);
          }
        } catch (_) {}
      }
      return KeygrainBrowserOwner.success({ wallets: updatedWallets });
    }).catch(safeMessageError);
  }
  if (action === "issueUnlockChallenge") {
    try {
      if (!KeygrainBrowserOwner.isTrustedExtensionPage(sender, browser.runtime.id, "unlock", "firefox", KEYGRAIN_EXTENSION_ORIGIN)
        || !message || Object.keys(message).length !== 2 || message.action !== action
        || typeof message.popupSessionId !== "string" || message.popupSessionId.length < 1) {
        return Promise.resolve(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR));
      }
      return firefoxIngressPromise
        .then(ingress => ingress.issueChallenge({sender, popupSessionId: message.popupSessionId}))
        .then(challenge => KeygrainBrowserOwner.success({challenge}))
        .catch(safeMessageError);
    } catch (_) { return Promise.resolve(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR)); }
  }
  if (action === "unlockEncrypted") {
    try {
      if (!KeygrainBrowserOwner.isTrustedExtensionPage(sender, browser.runtime.id, "unlock", "firefox", KEYGRAIN_EXTENSION_ORIGIN)
        || !message || (Object.keys(message).length !== 3 && Object.keys(message).length !== 4) || message.action !== action
        || typeof message.popupSessionId !== "string" || message.popupSessionId.length < 1
        || !message.envelope || typeof message.envelope !== "object" || Array.isArray(message.envelope)) {
        return Promise.resolve(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR));
      }
      return firefoxIngressPromise
        .then(ingress => ingress.admitUnlock({sender, popupSessionId: message.popupSessionId, isCreate: Boolean(message.isCreate)}, message.envelope))
        .catch(safeMessageError);
    } catch (_) { return Promise.resolve(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR)); }
  }
  if (action === "requestExceptionalConfirmation") {
    try {
      if (!KeygrainBrowserOwner.isTrustedExtensionPage(sender, browser.runtime.id, action, "firefox", KEYGRAIN_EXTENSION_ORIGIN)) {
        return Promise.resolve(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR));
      }
      const request = KeygrainBrowserOwner.validateConfirmationMessage(message, action);
      return startupPromise.then(() => {
        const id = firefoxOwner.issueConfirmation(request.popupSessionId, sender.url);
        return KeygrainBrowserOwner.success({confirmationId: id});
      }).catch(safeMessageError);
    } catch (error) { return Promise.resolve(safeMessageError(error)); }
  }
  if (action === "cancelExceptionalConfirmation") {
    try {
      if (!KeygrainBrowserOwner.isTrustedExtensionPage(sender, browser.runtime.id, action, "firefox", KEYGRAIN_EXTENSION_ORIGIN)) {
        return Promise.resolve(KeygrainBrowserOwner.safeFailure(KeygrainBrowserOwner.CONTEXT_ERROR));
      }
      const request = KeygrainBrowserOwner.validateConfirmationMessage(message, action);
      return startupPromise.then(() => {
        firefoxOwner.clearConfirmationSession(request.popupSessionId);
        return KeygrainBrowserOwner.success();
      }).catch(safeMessageError);
    } catch (error) { return Promise.resolve(safeMessageError(error)); }
  }
  if (KeygrainBrowserOwner.isExactPopupRequest(message)
    && (action === "heartbeat" || action === "extendSensitive" || action === "sync"
      || KeygrainBrowserOwner.POPUP_RESERVED_ACTIONS.includes(action))) {
    return startupPromise.then(async () => {
      const res = firefoxOwner.dispatchLegacyOrPhaseB(sender, browser.runtime.id, message, "firefox", KEYGRAIN_EXTENSION_ORIGIN);
      const snap = typeof firefoxOwner.snapshot === "function" ? firefoxOwner.snapshot() : null;
      const sessionStore = getFirefoxSessionStorage();
      if (snap) {
        if (snap.state === "locked") {
          await clearMemorySession();
        } else if (snap.state === "full" || snap.state === "metadata") {
          const sessionData = await sessionStore?.get("keygrainSession");
          const session = sessionData?.keygrainSession;
          if (session) {
            const settings = await firefoxOwner.loadSettings();
            const metaTailSec = settings?.metadataTailSeconds !== undefined ? settings.metadataTailSeconds : (KEYGRAIN_DEFAULT_SETTINGS?.metadataTailSeconds || 28500);
            session.secret = snap.state === "full" ? session.secret : null;
            session.fullExpiresAt = snap.state === "full" ? snap.fullExpiresAt : null;
            session.metadataExpiresAt = snap.metadataExpiresAt;
            session.metadataTailAnchor = snap.metadataExpiresAt || (snap.fullExpiresAt ? snap.fullExpiresAt + metaTailSec * 1000 : null);
            session.metadata = extractMetadata();
            await sessionStore?.set({ keygrainSession: session });
          }
        }
      }
      return res;
    }).catch(safeMessageError);
  }
  return startupPromise
    .then(() => firefoxOwner.dispatchPopupRequest(sender, browser.runtime.id, message, "firefox", KEYGRAIN_EXTENSION_ORIGIN))
    .then(async (res) => {
      const snap = typeof firefoxOwner.snapshot === "function" ? firefoxOwner.snapshot() : null;
      const sessionStore = getFirefoxSessionStorage();
      if (snap) {
        if (snap.state === "locked") {
          await clearMemorySession();
        } else if (snap.state === "full" || snap.state === "metadata") {
          const sessionData = await sessionStore?.get("keygrainSession");
          const session = sessionData?.keygrainSession;
          if (session) {
            const settings = await firefoxOwner.loadSettings();
            const metaTailSec = settings?.metadataTailSeconds !== undefined ? settings.metadataTailSeconds : (KEYGRAIN_DEFAULT_SETTINGS?.metadataTailSeconds || 28500);
            session.secret = snap.state === "full" ? session.secret : null;
            session.fullExpiresAt = snap.state === "full" ? snap.fullExpiresAt : null;
            session.metadataExpiresAt = snap.metadataExpiresAt;
            session.metadataTailAnchor = snap.metadataExpiresAt || (snap.fullExpiresAt ? snap.fullExpiresAt + metaTailSec * 1000 : null);
            session.metadata = extractMetadata();
            await sessionStore?.set({ keygrainSession: session });
          }
        }
      }
      return res;
    }).catch(safeMessageError);
});

if (browser.runtime.onConnect) {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === "keygrain-keepalive") {
      port.onMessage.addListener((msg) => {
        if (msg === "ping") {
          try { port.postMessage("pong"); } catch (_) {}
        }
      });
    }
  });
}

if (browser.runtime.onSuspend) browser.runtime.onSuspend.addListener(() => {
  firefoxIngressPromise.then(ingress => ingress.revokeAll()).catch(() => {});
  try { firefoxOwner.shutdown("runtime_shutdown"); } catch (_) {}
});
