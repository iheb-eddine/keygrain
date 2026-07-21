// background.js — Chrome MV3 service worker
importScripts("lib/hash-wasm-argon2.js", "keygrain.js", "totp.js", "sync.js", "autofill.js", "inline-autofill.js");

const DEFAULT_LOCK_MINUTES = 15;

async function getLockMinutes() {
  const data = await chrome.storage.local.get("settings");
  return (data.settings && data.settings.autoLockMinutes) || DEFAULT_LOCK_MINUTES;
}

// === Badge helpers ===
function domainMatches(site, hostname) {
  if (!site || !hostname) return false;
  return site === hostname || hostname.endsWith("." + site);
}

async function hmacSHA256(key, message) {
  const k = await crypto.subtle.importKey("raw", key, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, message));
}

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function updateBadge(tabId) {
  const {secret, email} = await chrome.storage.session.get(["secret", "email"]);
  if (!secret || !email) {
    chrome.action.setBadgeText({text: "", tabId});
    return;
  }
  const data = await chrome.storage.local.get("services");
  if (!data.services || data.services.version !== 2) {
    chrome.action.setBadgeText({text: "", tabId});
    return;
  }
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  if (!tab.url) { chrome.action.setBadgeText({text: "", tabId}); return; }
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return; }
  if (!host) { chrome.action.setBadgeText({text: "", tabId}); return; }

  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const storageKey = await hmacSHA256(strengthened, enc.encode(email.toLowerCase() + ":keygrain-local-storage"));
  try {
    const iv = base64ToArrayBuffer(data.services.iv);
    const ciphertext = base64ToArrayBuffer(data.services.ciphertext);
    const aad = enc.encode(email.toLowerCase());
    const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
    const services = JSON.parse(new TextDecoder().decode(decrypted)).services || [];
    const count = services.filter(s => {
      const site = (s.site || s.name).toLowerCase();
      return domainMatches(site, host);
    }).length;
    chrome.action.setBadgeText({text: count > 0 ? String(count) : "", tabId});
  } catch {
    chrome.action.setBadgeText({text: "", tabId});
  }
}

chrome.tabs.onActivated.addListener(({tabId}) => updateBadge(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") updateBadge(tabId);
});

async function resetAutoLock() {
  const minutes = await getLockMinutes();
  chrome.alarms.create("autoLock", {delayInMinutes: minutes});
}

let bgSyncInProgress = false;
let lockDeferred = false;

async function backgroundSync() {
  const {secret, email} = await chrome.storage.session.get(["secret", "email"]);
  if (!secret || !email) return;
  const {popupActive} = await chrome.storage.local.get("popupActive");
  if (popupActive) return;
  bgSyncInProgress = true;
  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const storageKey = await hmacSHA256(strengthened, enc.encode(email.toLowerCase() + ":keygrain-local-storage"));
  try {
    const data = await chrome.storage.local.get("services");
    if (!data.services || data.services.version !== 2) return;
    const iv = base64ToArrayBuffer(data.services.iv);
    const ciphertext = base64ToArrayBuffer(data.services.ciphertext);
    const aad = enc.encode(email.toLowerCase());
    const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
    const parsed = JSON.parse(new TextDecoder().decode(decrypted));
    const localServices = parsed.services || [];
    const localWallets = parsed.wallets || [];
    const localAuditLog = parsed.wallet_audit_log || [];
    const result = await syncWithServer(secret, email, localServices, localWallets, localAuditLog);
    await setKnownUUIDs(result.knownUUIDs);
    // Re-encrypt and save
    const newPlaintext = enc.encode(JSON.stringify({version: 1, services: result.services, wallets: result.wallets, wallet_audit_log: result.wallet_audit_log}));
    const newIv = crypto.getRandomValues(new Uint8Array(12));
    const newKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["encrypt"]);
    const newCiphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv: newIv, additionalData: aad}, newKey, newPlaintext);
    await chrome.storage.local.set({services: {version: 2, iv: arrayBufferToBase64(newIv), ciphertext: arrayBufferToBase64(newCiphertext)}, lastSyncTime: Date.now(), lastSyncError: null});
    await chrome.storage.local.remove("syncRetryState");
    chrome.alarms.clear("syncRetry");
    await reregisterIfChanged();
  } catch (e) {
    if (e instanceof MetadataTamperError || e?.message === "checksum_mismatch") {
      chrome.alarms.clear("syncAlarm");
    }
    const errType = e?.message;
    if (errType === "rate_limited") {
      const delay = (e.retryAfter || 60) / 60;
      await chrome.storage.local.set({lastSyncError: {type: "rate_limited", message: "Rate limited. Retrying soon."}});
      chrome.alarms.create("syncRetry", {delayInMinutes: delay});
    } else if (errType === "network_error" || errType === "server_error") {
      const data = await chrome.storage.local.get("syncRetryState");
      const state = data.syncRetryState || {attempt: 0, nextRetryAt: null, errorType: null};
      state.attempt++;
      state.errorType = errType === "network_error" ? "network" : "server";
      if (state.attempt <= 2) {
        const delay = state.attempt === 1 ? 30 : 60;
        state.nextRetryAt = Date.now() + delay * 1000;
        await chrome.storage.local.set({syncRetryState: state, lastSyncError: {type: state.errorType, message: state.errorType === "network" ? "Connection error" : "Server error"}});
        chrome.alarms.create("syncRetry", {delayInMinutes: delay / 60});
      } else {
        state.nextRetryAt = null;
        await chrome.storage.local.set({syncRetryState: state, lastSyncError: {type: state.errorType, message: "Sync unavailable. Will retry on next change."}});
      }
    } else {
      await chrome.storage.local.set({lastSyncError: {type: errType === "auth_failed" ? "auth" : "other", message: e?.message || "Sync failed"}});
    }
  } finally { bgSyncInProgress = false; }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "autoLock") {
    if (bgSyncInProgress && !lockDeferred) {
      lockDeferred = true;
      chrome.alarms.create("autoLock", {delayInMinutes: 0.5});
      return;
    }
    lockDeferred = false;
    chrome.alarms.clear("syncAlarm");
    clearStrengthenCache();
    chrome.storage.session.remove(["secret", "email"]);
    await unregisterInline();
    broadcastInline({action: "inlineLockChanged", locked: true});
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (tab) chrome.action.setBadgeText({text: "", tabId: tab.id});
  }
  if (alarm.name === "syncAlarm") {
    backgroundSync();
  }
  if (alarm.name === "syncRetry") {
    backgroundSync();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "getSecret") {
    chrome.storage.session.get("secret", (data) => {
      sendResponse({secret: data.secret || null});
    });
    return true;
  }
  if (msg.action === "setSecret") {
    chrome.storage.session.set({secret: msg.secret}, () => {
      resetAutoLock();
      chrome.alarms.create("syncAlarm", {periodInMinutes: 5});
      registerInline().catch(() => {});
      sendResponse({ok: true});
    });
    return true;
  }
  if (msg.action === "heartbeat") {
    resetAutoLock();
    sendResponse({ok: true});
    return true;
  }
  if (msg.action === "clearSecret") {
    chrome.alarms.clear("autoLock");
    chrome.alarms.clear("syncAlarm");
    unregisterInline();
    broadcastInline({action: "inlineLockChanged", locked: true});
    chrome.storage.session.remove("secret", () => {
      chrome.tabs.query({active: true, currentWindow: true}, ([tab]) => {
        if (tab) chrome.action.setBadgeText({text: "", tabId: tab.id});
      });
      sendResponse({ok: true});
    });
    return true;
  }
  if (msg.action === "refreshBadge") {
    chrome.tabs.query({active: true, currentWindow: true}, ([tab]) => {
      if (tab) updateBadge(tab.id);
    });
    sendResponse({ok: true});
    return true;
  }
  if (msg.action === "getEmail") {
    chrome.storage.session.get("email", (data) => {
      sendResponse({email: data.email || null});
    });
    return true;
  }
  if (msg.action === "setEmail") {
    chrome.storage.session.set({email: msg.email}, () => {
      registerInline().catch(() => {});
      sendResponse({ok: true});
    });
    return true;
  }
  if (msg.action === "clearEmail") {
    chrome.storage.session.remove("email", () => {
      sendResponse({ok: true});
    });
    return true;
  }
  if (msg.action === "scheduleSyncRetry") {
    (async () => {
      const data = await chrome.storage.local.get("syncRetryState");
      const state = data.syncRetryState || {attempt: 0, nextRetryAt: null, errorType: null};
      state.attempt++;
      state.errorType = msg.errorType;
      if (state.attempt <= 2) {
        const delay = state.attempt === 1 ? 30 : 60;
        state.nextRetryAt = Date.now() + delay * 1000;
        await chrome.storage.local.set({syncRetryState: state});
        chrome.alarms.create("syncRetry", {delayInMinutes: delay / 60});
      } else {
        state.nextRetryAt = null;
        await chrome.storage.local.set({syncRetryState: state});
      }
      sendResponse({ok: true});
    })();
    return true;
  }
});

// === Autofill: shared resolver + bounded settle loop ===
// Provably-bounded constants (see designs/extension-shortcut-robustness.md).
const SETTLE_MAX_TRIES = 4;
const GETCONTEXT_TIMEOUT_MS = 300;   // per-try; guards a hung/absent content script
const INTER_TRY_SLEEP_MS = 200;
const SETTLE_HARD_CEILING_MS = 1000; // wall-clock cap from loop start

function openPopupSafe() {
  try { chrome.action.openPopup(); } catch {}
}

function afSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Returns the content-script snapshot, or null on timeout / no content script.
async function afGetFillContext(tabId) {
  try {
    const ctx = await Promise.race([
      chrome.tabs.sendMessage(tabId, {action: "getFillContext"}).catch(() => null),
      afSleep(GETCONTEXT_TIMEOUT_MS).then(() => null)
    ]);
    return ctx || null;
  } catch {
    return null;
  }
}

// One user gesture (shortcut or context menu). Verifies unlock, resolves host,
// decrypts + narrows matches to the most-specific tier (filterMostSpecific — a
// subset of domainMatches), injects the content scripts, then runs the bounded
// settle loop feeding selectServiceForFill. Only a
// UNIQUE resolution derives ONE password + fires a single fill; every ambiguous /
// none / timeout / failure path defers to the popup. `fillAction` is "fill" for
// BOTH the shortcut and the context menu -- content.js's {action:"fill"} handler
// (performFill) fills the username + password together.
async function autofillForTab(tab, fillAction) {
  const {secret, email} = await chrome.storage.session.get(["secret", "email"]);
  if (!secret || !email) { openPopupSafe(); return; }
  if (!tab?.url) { openPopupSafe(); return; }
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { openPopupSafe(); return; }
  if (!host) { openPopupSafe(); return; }

  const data = await chrome.storage.local.get("services");
  if (!data.services || data.services.version !== 2) { openPopupSafe(); return; }

  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const storageKey = await hmacSHA256(strengthened, enc.encode(email.toLowerCase() + ":keygrain-local-storage"));
  let matches;
  try {
    const iv = base64ToArrayBuffer(data.services.iv);
    const ciphertext = base64ToArrayBuffer(data.services.ciphertext);
    const aad = enc.encode(email.toLowerCase());
    const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
    const services = JSON.parse(new TextDecoder().decode(decrypted)).services || [];
    matches = KeygrainAutofill.filterMostSpecific(services, host);
  } catch { openPopupSafe(); return; }

  if (matches.length === 0) { openPopupSafe(); return; }

  try {
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["autofill.js", "content.js"]});
  } catch { openPopupSafe(); return; }

  const loopStart = Date.now();
  for (let tryN = 1; tryN <= SETTLE_MAX_TRIES; tryN++) {
    if (Date.now() - loopStart >= SETTLE_HARD_CEILING_MS) break;
    const ctx = await afGetFillContext(tab.id);
    if (!ctx) { openPopupSafe(); return; }
    const decision = KeygrainAutofill.selectServiceForFill(matches, {pageEmail: ctx.pageEmail});
    if (decision.decision === "fill") {
      const svc = decision.service;
      const password = await derivePassword(secret, svc.email, {site: svc.site || svc.name, length: svc.length || 20, symbols: svc.symbols || "!@#$%&*-_=+?", counter: svc.counter || 1});
      chrome.tabs.sendMessage(tab.id, {action: fillAction, password, email: svc.email});
      return;
    }
    if (decision.decision === "none") { openPopupSafe(); return; }
    // ambiguous — retry only while the page shows neither field (still transitioning)
    if (!ctx.hasUsernameField && !ctx.hasPasswordField) {
      await afSleep(INTER_TRY_SLEEP_MS);
      continue;
    } else {
      break;
    }
  }
  openPopupSafe();
}

// The OTP analogue of autofillForTab: same decrypt block + bounded settle loop +
// selectServiceForFill, but candidates are narrowed to services with a `totp` config
// (Frozen Req 2/5) and a UNIQUE resolution derives the current code (getTOTPCode; the
// seed stays in the bg + is zeroed in getTOTPCode's own finally) and sends
// {action:"fillOtp", code}. Every ambiguous / none / timeout / failure path defers to
// the popup (the email-labelled chooser, §D7 Layer 3). Callers: the context-aware
// fill_credentials shortcut (focused-OTP branch) and the keygrain-fill-otp context item.
async function autofillOtpForTab(tab) {
  const {secret, email} = await chrome.storage.session.get(["secret", "email"]);
  if (!secret || !email) { openPopupSafe(); return; }
  if (!tab?.url) { openPopupSafe(); return; }
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { openPopupSafe(); return; }
  if (!host) { openPopupSafe(); return; }

  const data = await chrome.storage.local.get("services");
  if (!data.services || data.services.version !== 2) { openPopupSafe(); return; }

  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const storageKey = await hmacSHA256(strengthened, enc.encode(email.toLowerCase() + ":keygrain-local-storage"));
  let matches;
  try {
    const iv = base64ToArrayBuffer(data.services.iv);
    const ciphertext = base64ToArrayBuffer(data.services.ciphertext);
    const aad = enc.encode(email.toLowerCase());
    const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
    const services = JSON.parse(new TextDecoder().decode(decrypted)).services || [];
    matches = KeygrainAutofill.filterMostSpecific(services, host).filter((s) => s && s.totp);
  } catch { openPopupSafe(); return; }

  if (matches.length === 0) { openPopupSafe(); return; }

  try {
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["autofill.js", "content.js"]});
  } catch { openPopupSafe(); return; }

  const loopStart = Date.now();
  for (let tryN = 1; tryN <= SETTLE_MAX_TRIES; tryN++) {
    if (Date.now() - loopStart >= SETTLE_HARD_CEILING_MS) break;
    const ctx = await afGetFillContext(tab.id);
    if (!ctx) { openPopupSafe(); return; }
    const decision = KeygrainAutofill.selectServiceForFill(matches, {pageEmail: ctx.pageEmail});
    if (decision.decision === "fill") {
      // Defer on a corrupt totp config (bad stored base32 / unknown mode) rather than
      // unhandled-reject (Layer 3 / Regression-Risk "defer on failure").
      let code;
      try { code = (await getTOTPCode(decision.service, secret)).code; }
      catch { openPopupSafe(); return; }
      chrome.tabs.sendMessage(tab.id, {action: "fillOtp", code});
      return;
    }
    if (decision.decision === "none") { openPopupSafe(); return; }
    // ambiguous — retry only while the OTP field hasn't rendered yet (multi-step)
    if (!ctx.hasOtpField) {
      await afSleep(INTER_TRY_SLEEP_MS);
      continue;
    } else {
      break;
    }
  }
  openPopupSafe();
}

// Read-only focused-field OTP probe for the context-aware shortcut (§D3). Returns
// true ONLY on a positive focused-OTP signal; EVERY other condition (locked, no url,
// injection failure, absent/hung content script, getFillContext timeout, or a non-OTP /
// no focused field) returns false -> the UNCHANGED credentials path (Frozen Req 9).
async function focusedFieldIsOtp(tab) {
  const {secret, email} = await chrome.storage.session.get(["secret", "email"]);
  if (!secret || !email) return false;
  if (!tab?.url) return false;
  try { await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["autofill.js", "content.js"]}); }
  catch { return false; }
  const ctx = await afGetFillContext(tab.id);
  return !!(ctx && ctx.focusedIsOtp);
}

// === Keyboard Shortcut ===
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "fill_credentials") return;
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  // Context-aware (§D3): a focused OTP field fills the current code; EVERY other case
  // fills credentials exactly as before via the UNCHANGED autofillForTab(tab, "fill").
  if (await focusedFieldIsOtp(tab)) await autofillOtpForTab(tab);
  else await autofillForTab(tab, "fill");
});

// === Context Menu ===
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({id: "keygrain-fill", title: "Fill with Keygrain", contexts: ["editable"]});
  chrome.contextMenus.create({id: "keygrain-fill-otp", title: "Fill one-time code with Keygrain", contexts: ["editable"]});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "keygrain-fill") await autofillForTab(tab, "fill");
  else if (info.menuItemId === "keygrain-fill-otp") await autofillOtpForTab(tab);
});

// ===================================================================
// Native in-field autofill — Increment A (plumbing, NO visible UI).
// Scoped content-script registration lifecycle + stateless,
// server-authoritative fill. In Increment A the registered js list is
// ["autofill.js","content.js"] — the inline UI files are added in
// Increment B. See designs/extension-native-infield-autofill.md.
// ===================================================================
const INLINE_SCRIPT_ID = "keygrain-inline";
const INLINE_JS = ["autofill.js", "inline-autofill.js", "inline-autofill-ui.js", "content.js"];

async function inlineEnabled() {
  const data = await chrome.storage.local.get("inlineAutofillEnabled");
  return !!data.inlineAutofillEnabled;
}

async function inlineUnlocked() {
  const {secret, email} = await chrome.storage.session.get(["secret", "email"]);
  return !!(secret && email);
}

// MIRRORS the existing inlined decrypt block (updateBadge / backgroundSync /
// autofillForTab). Returns the services array, or null when locked / no v2
// store / decrypt fails. NEVER returns the secret.
async function decryptServices() {
  const {secret, email} = await chrome.storage.session.get(["secret", "email"]);
  if (!secret || !email) return null;
  const data = await chrome.storage.local.get("services");
  if (!data.services || data.services.version !== 2) return null;
  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const storageKey = await hmacSHA256(strengthened, enc.encode(email.toLowerCase() + ":keygrain-local-storage"));
  try {
    const iv = base64ToArrayBuffer(data.services.iv);
    const ciphertext = base64ToArrayBuffer(data.services.ciphertext);
    const aad = enc.encode(email.toLowerCase());
    const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
    return JSON.parse(new TextDecoder().decode(decrypted)).services || [];
  } catch {
    return null;
  } finally {
    if (storageKey && storageKey.fill) storageKey.fill(0);
  }
}

// Order-independent match-pattern set equality.
function inlineSetEquals(a, b) {
  const sa = Array.isArray(a) ? a : [];
  const sb = Array.isArray(b) ? b : [];
  if (sa.length !== sb.length) return false;
  const setA = new Set(sa);
  for (const x of sb) if (!setA.has(x)) return false;
  return true;
}

// Broadcast to every tab; never throws (per-tab send failures are ignored —
// most tabs have no inline content script).
async function broadcastInline(msg) {
  let tabs;
  try { tabs = await chrome.tabs.query({}); } catch { return; }
  for (const tab of tabs) {
    if (tab.id == null) continue;
    chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

// Serialize all registration mutations through a FIFO chain. Concurrent triggers
// (e.g. two rapid pattern-changing saveServices -> reregisterInlineAutofill) must
// NOT interleave their register/unregister awaits. The public registerInline /
// unregisterInline / reregisterIfChanged run through this chain; the do*Inline
// cores call each other DIRECTLY (never re-entering the chain), so there is no
// self-deadlock (doRegisterInline -> doUnregisterInline; doReregister -> doRegister).
let inlineOpChain = Promise.resolve();
function inlineSerialize(op) {
  inlineOpChain = inlineOpChain.then(op, op).catch(() => {});
  return inlineOpChain;
}

async function doUnregisterInline() {
  try { await chrome.scripting.unregisterContentScripts({ids: [INLINE_SCRIPT_ID]}); } catch {}
}

// Register the inline content script for the user's saved-domain match
// patterns. No-ops when disabled/locked/no-matches. computeMatchPatterns always
// yields a fully-valid array (CR2), so registerContentScripts cannot be
// batch-rejected by one malformed stored site.
async function doRegisterInline() {
  if (!(await inlineEnabled()) || !(await inlineUnlocked())) return;
  const matches = KeygrainInline.computeMatchPatterns(await decryptServices());
  await doUnregisterInline();
  if (!matches.length) return;
  try {
    await chrome.scripting.registerContentScripts([{
      id: INLINE_SCRIPT_ID,
      matches,
      js: INLINE_JS,
      runAt: "document_idle",
      allFrames: false,
      persistAcrossSessions: false,
      world: "ISOLATED",
    }]);
    // registerContentScripts only injects into pages loaded AFTER this point, so
    // an already-open saved-domain tab shows no icon until refreshed. Inject now
    // into the matching open tabs (awaited inside the serialized chain so a
    // subsequent lock/disable teardown cannot interleave and strand a just-
    // injected tab). See injectIntoOpenSavedTabs.
    await injectIntoOpenSavedTabs();
  } catch {}
}

// After a successful registration, inject the inline content script into
// ALREADY-OPEN tabs whose host matches a saved service so the in-field icon
// appears WITHOUT a manual refresh. Self-gated (enabled+unlocked) and host-
// filtered by the SAME domainMatches scope used at registration + runtime, so it
// NEVER injects into a non-saved-domain tab. decryptServices returns metadata
// only: the master secret NEVER crosses to the content world (a fill still
// derives its password solely via the existing fillInline->fill path).
// Re-injection is harmless: autofill.js + inline-autofill.js are pure and
// content.js (__keygrain_injected) + inline-autofill-ui.js
// (__keygrain_inline_injected) guard against double-injection. Restricted pages
// (chrome://, about:, the Web Store) throw on executeScript and are skipped.
async function injectIntoOpenSavedTabs() {
  if (!(await inlineEnabled()) || !(await inlineUnlocked())) return;
  const services = await decryptServices();
  if (!services || !services.length) return;
  let tabs;
  try { tabs = await chrome.tabs.query({}); } catch { return; }
  for (const tab of tabs) {
    if (tab.id == null || !tab.url) continue;
    let host;
    try {
      const u = new URL(tab.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      host = u.hostname.replace(/^www\./, "").toLowerCase();
    } catch { continue; }
    if (!host) continue;
    if (!services.some(s => domainMatches((s.site || s.name).toLowerCase(), host))) continue;
    try {
      await chrome.scripting.executeScript({target: {tabId: tab.id}, files: INLINE_JS});
    } catch {}
  }
}

// Re-register only if the pattern set changed (services changed / post-sync).
async function doReregisterIfChanged() {
  try {
    if (!(await inlineEnabled()) || !(await inlineUnlocked())) return;
    const matches = KeygrainInline.computeMatchPatterns(await decryptServices());
    let cur = [];
    try { cur = await chrome.scripting.getRegisteredContentScripts({ids: [INLINE_SCRIPT_ID]}); } catch {}
    if (inlineSetEquals(cur[0] && cur[0].matches, matches)) return;
    await doRegisterInline();
  } catch {}
}

// Public, serialized entry points (called from the hooks + the inline listener).
function registerInline() { return inlineSerialize(doRegisterInline); }
function unregisterInline() { return inlineSerialize(doUnregisterInline); }
function reregisterIfChanged() { return inlineSerialize(doReregisterIfChanged); }

// Separate listener for inline actions ONLY (design Decision 1). Disjoint action
// set from the main listener above, so both coexist without interfering.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "inlineAutofillEnabledChanged") {
    (async () => {
      if (msg.enabled) {
        await registerInline();
      } else {
        await unregisterInline();
        await broadcastInline({action: "inlineDisabled"});
      }
      sendResponse({ok: true});
    })();
    return true;
  }
  if (msg.action === "reregisterInlineAutofill") {
    (async () => {
      await reregisterIfChanged();
      sendResponse({ok: true});
    })();
    return true;
  }
  if (msg.action === "getInlineMatches") {
    (async () => {
      try {
        if (!sender.tab || !sender.tab.url) return sendResponse({enabled: false, locked: false, accounts: []});
        if (!(await inlineEnabled())) return sendResponse({enabled: false, locked: false, accounts: []});
        if (!(await inlineUnlocked())) return sendResponse({enabled: true, locked: true, accounts: []});
        const host = new URL(sender.tab.url).hostname.replace(/^www\./, "").toLowerCase();
        const services = await decryptServices();
        if (!services) return sendResponse({enabled: true, locked: false, accounts: []});
        const matches = KeygrainAutofill.filterMostSpecific(services, host);
        const ranked = KeygrainAutofill.rankServices(matches);
        const accounts = ranked.map(KeygrainInline.sanitizeAccountForContent);
        sendResponse({enabled: true, locked: false, accounts});
      } catch {
        sendResponse({enabled: true, locked: false, accounts: []});
      }
    })();
    return true;
  }
  if (msg.action === "getInlineOtpMatches") {
    (async () => {
      try {
        if (!sender.tab || !sender.tab.url) return sendResponse({enabled: false, locked: false, accounts: []});
        if (!(await inlineEnabled())) return sendResponse({enabled: false, locked: false, accounts: []});
        if (!(await inlineUnlocked())) return sendResponse({enabled: true, locked: true, accounts: []});
        const host = new URL(sender.tab.url).hostname.replace(/^www\./, "").toLowerCase();
        const services = await decryptServices();
        if (!services) return sendResponse({enabled: true, locked: false, accounts: []});
        // Same as getInlineMatches but narrowed to services with a totp config (Frozen
        // Req 2). Reuses the UNCHANGED sanitizeAccountForContent whitelist -> no new field
        // crosses to content ("has totp" is implicit in whether the account appears).
        const matches = KeygrainAutofill.filterMostSpecific(services, host).filter((s) => s && s.totp);
        const ranked = KeygrainAutofill.rankServices(matches);
        const accounts = ranked.map(KeygrainInline.sanitizeAccountForContent);
        sendResponse({enabled: true, locked: false, accounts});
      } catch {
        sendResponse({enabled: true, locked: false, accounts: []});
      }
    })();
    return true;
  }
  if (msg.action === "fillInline") {
    (async () => {
      try {
        if (!sender.tab || !sender.tab.url) return;
        if (!(await inlineEnabled()) || !(await inlineUnlocked())) return;
        const host = new URL(sender.tab.url).hostname.replace(/^www\./, "").toLowerCase();
        const {secret, email} = await chrome.storage.session.get(["secret", "email"]);
        if (!secret || !email) return;
        const services = await decryptServices();
        if (!services) return;
        const svc = services.find(s => s.id === msg.token && domainMatches((s.site || s.name).toLowerCase(), host));
        if (!svc) return;
        const password = await derivePassword(secret, svc.email, {site: svc.site || svc.name, length: svc.length || 20, symbols: svc.symbols || "!@#$%&*-_=+?", counter: svc.counter || 1});
        chrome.tabs.sendMessage(sender.tab.id, {action: "fill", password, email: svc.email}).catch(() => {});
      } catch {}
    })();
    return; // stateless, fire-and-forget
  }
  if (msg.action === "fillInlineOtp") {
    (async () => {
      try {
        if (!sender.tab || !sender.tab.url) return;
        if (!(await inlineEnabled()) || !(await inlineUnlocked())) return;
        const host = new URL(sender.tab.url).hostname.replace(/^www\./, "").toLowerCase();
        const {secret, email} = await chrome.storage.session.get(["secret", "email"]);
        if (!secret || !email) return;
        const services = await decryptServices();
        if (!services) return;
        // Server-authoritative: re-verify id===token && domainMatches && s.totp; the seed
        // never crosses — only the derived code goes back via {action:"fillOtp"}.
        const svc = services.find(s => s.id === msg.token && domainMatches((s.site || s.name).toLowerCase(), host) && s.totp);
        if (!svc) return;
        const {code} = await getTOTPCode(svc, secret);
        chrome.tabs.sendMessage(sender.tab.id, {action: "fillOtp", code}).catch(() => {});
      } catch {}
    })();
    return; // stateless, fire-and-forget
  }
});

// Broad optional origin removed via the browser's own extension settings —
// reconcile: disable the feature, tear down, and notify live tabs.
chrome.permissions.onRemoved.addListener(async (permissions) => {
  if (permissions.origins && permissions.origins.includes("*://*/*")) {
    await chrome.storage.local.set({inlineAutofillEnabled: false});
    await unregisterInline();
    await broadcastInline({action: "inlineDisabled"});
  }
});

// Broad optional origin GRANTED (the popup's permissions.request, or a manual
// grant via the browser's extension settings) — complete the enable from the
// background, which ALWAYS survives even when the permission prompt closes the
// popup before its own post-grant steps run (the first-run failure this fixes).
// Mirror of onRemoved. NO broadcast on enable: registerInline injects on the next
// page load, matching the popup's inlineAutofillEnabledChanged:true path, and
// registerInline is serialized + idempotent (unregister-then-register), so a
// double call (surviving popup + this) is harmless.
chrome.permissions.onAdded.addListener(async (permissions) => {
  if (permissions.origins && permissions.origins.includes("*://*/*")) {
    await chrome.storage.local.set({inlineAutofillEnabled: true});
    await registerInline();
  }
});
