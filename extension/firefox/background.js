// background.js — Firefox MV2 background page
let sessionSecret = null;
let sessionEmail = null;

const DEFAULT_LOCK_MINUTES = 15;

async function getLockMinutes() {
  const data = await browser.storage.local.get("settings");
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
  if (!sessionSecret || !sessionEmail) {
    browser.browserAction.setBadgeText({text: "", tabId});
    return;
  }
  const data = await browser.storage.local.get("services");
  if (!data.services || data.services.version !== 2) {
    browser.browserAction.setBadgeText({text: "", tabId});
    return;
  }
  let tab;
  try { tab = await browser.tabs.get(tabId); } catch { return; }
  if (!tab.url) { browser.browserAction.setBadgeText({text: "", tabId}); return; }
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return; }
  if (!host) { browser.browserAction.setBadgeText({text: "", tabId}); return; }

  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(sessionSecret, sessionEmail);
  const storageKey = await hmacSHA256(strengthened, enc.encode(sessionEmail.toLowerCase() + ":keygrain-local-storage"));
  try {
    const iv = base64ToArrayBuffer(data.services.iv);
    const ciphertext = base64ToArrayBuffer(data.services.ciphertext);
    const aad = enc.encode(sessionEmail.toLowerCase());
    const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
    const services = JSON.parse(new TextDecoder().decode(decrypted)).services || [];
    const count = services.filter(s => {
      const site = (s.site || s.name).toLowerCase();
      return domainMatches(site, host);
    }).length;
    browser.browserAction.setBadgeText({text: count > 0 ? String(count) : "", tabId});
  } catch {
    browser.browserAction.setBadgeText({text: "", tabId});
  }
}

browser.tabs.onActivated.addListener(({tabId}) => updateBadge(tabId));
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") updateBadge(tabId);
});

async function resetAutoLock() {
  const minutes = await getLockMinutes();
  browser.alarms.create("autoLock", {delayInMinutes: minutes});
}

let bgSyncInProgress = false;
let lockDeferred = false;

async function backgroundSync() {
  if (!sessionSecret || !sessionEmail) return;
  const {popupActive} = await browser.storage.local.get("popupActive");
  if (popupActive) return;
  bgSyncInProgress = true;
  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(sessionSecret, sessionEmail);
  const storageKey = await hmacSHA256(strengthened, enc.encode(sessionEmail.toLowerCase() + ":keygrain-local-storage"));
  try {
    const data = await browser.storage.local.get("services");
    if (!data.services || data.services.version !== 2) return;
    const iv = base64ToArrayBuffer(data.services.iv);
    const ciphertext = base64ToArrayBuffer(data.services.ciphertext);
    const aad = enc.encode(sessionEmail.toLowerCase());
    const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
    const parsed = JSON.parse(new TextDecoder().decode(decrypted));
    const localServices = parsed.services || [];
    const localWallets = parsed.wallets || [];
    const localAuditLog = parsed.wallet_audit_log || [];
    const result = await syncWithServer(sessionSecret, sessionEmail, localServices, localWallets, localAuditLog);
    await setKnownUUIDs(result.knownUUIDs);
    const newPlaintext = enc.encode(JSON.stringify({version: 1, services: result.services, wallets: result.wallets, wallet_audit_log: result.wallet_audit_log}));
    const newIv = crypto.getRandomValues(new Uint8Array(12));
    const newKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["encrypt"]);
    const newCiphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv: newIv, additionalData: aad}, newKey, newPlaintext);
    await browser.storage.local.set({services: {version: 2, iv: arrayBufferToBase64(newIv), ciphertext: arrayBufferToBase64(newCiphertext)}, lastSyncTime: Date.now(), lastSyncError: null});
    await browser.storage.local.remove("syncRetryState");
    browser.alarms.clear("syncRetry");
    await reregisterIfChanged();
  } catch (e) {
    if (e instanceof MetadataTamperError || e?.message === "checksum_mismatch") {
      browser.alarms.clear("syncAlarm");
    }
    const errType = e?.message;
    if (errType === "rate_limited") {
      const delay = (e.retryAfter || 60) / 60;
      await browser.storage.local.set({lastSyncError: {type: "rate_limited", message: "Rate limited. Retrying soon."}});
      browser.alarms.create("syncRetry", {delayInMinutes: delay});
    } else if (errType === "network_error" || errType === "server_error") {
      const data = await browser.storage.local.get("syncRetryState");
      const state = data.syncRetryState || {attempt: 0, nextRetryAt: null, errorType: null};
      state.attempt++;
      state.errorType = errType === "network_error" ? "network" : "server";
      if (state.attempt <= 2) {
        const delay = state.attempt === 1 ? 30 : 60;
        state.nextRetryAt = Date.now() + delay * 1000;
        await browser.storage.local.set({syncRetryState: state, lastSyncError: {type: state.errorType, message: state.errorType === "network" ? "Connection error" : "Server error"}});
        browser.alarms.create("syncRetry", {delayInMinutes: delay / 60});
      } else {
        state.nextRetryAt = null;
        await browser.storage.local.set({syncRetryState: state, lastSyncError: {type: state.errorType, message: "Sync unavailable. Will retry on next change."}});
      }
    } else {
      await browser.storage.local.set({lastSyncError: {type: errType === "auth_failed" ? "auth" : "other", message: e?.message || "Sync failed"}});
    }
  } finally { bgSyncInProgress = false; }
}

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "autoLock") {
    if (bgSyncInProgress && !lockDeferred) {
      lockDeferred = true;
      browser.alarms.create("autoLock", {delayInMinutes: 0.5});
      return;
    }
    lockDeferred = false;
    browser.alarms.clear("syncAlarm");
    clearStrengthenCache();
    sessionSecret = null;
    sessionEmail = null;
    await unregisterInline();
    broadcastInline({action: "inlineLockChanged", locked: true});
    const [tab] = await browser.tabs.query({active: true, currentWindow: true});
    if (tab) browser.browserAction.setBadgeText({text: "", tabId: tab.id});
  }
  if (alarm.name === "syncAlarm") {
    backgroundSync();
  }
  if (alarm.name === "syncRetry") {
    backgroundSync();
  }
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === "getSecret") {
    return Promise.resolve({secret: sessionSecret});
  }
  if (msg.action === "setSecret") {
    sessionSecret = msg.secret;
    resetAutoLock();
    browser.alarms.create("syncAlarm", {periodInMinutes: 5});
    registerInline().catch(() => {});
    return Promise.resolve({ok: true});
  }
  if (msg.action === "heartbeat") {
    resetAutoLock();
    return Promise.resolve({ok: true});
  }
  if (msg.action === "clearSecret") {
    sessionSecret = null;
    browser.alarms.clear("autoLock");
    browser.alarms.clear("syncAlarm");
    unregisterInline();
    broadcastInline({action: "inlineLockChanged", locked: true});
    browser.tabs.query({active: true, currentWindow: true}).then(([tab]) => {
      if (tab) browser.browserAction.setBadgeText({text: "", tabId: tab.id});
    });
    return Promise.resolve({ok: true});
  }
  if (msg.action === "refreshBadge") {
    browser.tabs.query({active: true, currentWindow: true}).then(([tab]) => {
      if (tab) updateBadge(tab.id);
    });
    return Promise.resolve({ok: true});
  }
  if (msg.action === "getEmail") {
    return Promise.resolve({email: sessionEmail});
  }
  if (msg.action === "setEmail") {
    sessionEmail = msg.email;
    registerInline().catch(() => {});
    return Promise.resolve({ok: true});
  }
  if (msg.action === "clearEmail") {
    sessionEmail = null;
    return Promise.resolve({ok: true});
  }
  if (msg.action === "scheduleSyncRetry") {
    return (async () => {
      const data = await browser.storage.local.get("syncRetryState");
      const state = data.syncRetryState || {attempt: 0, nextRetryAt: null, errorType: null};
      state.attempt++;
      state.errorType = msg.errorType;
      if (state.attempt <= 2) {
        const delay = state.attempt === 1 ? 30 : 60;
        state.nextRetryAt = Date.now() + delay * 1000;
        await browser.storage.local.set({syncRetryState: state});
        browser.alarms.create("syncRetry", {delayInMinutes: delay / 60});
      } else {
        state.nextRetryAt = null;
        await browser.storage.local.set({syncRetryState: state});
      }
      return {ok: true};
    })();
  }
});

// === Autofill: shared resolver + bounded settle loop ===
// Provably-bounded constants (see designs/extension-shortcut-robustness.md).
const SETTLE_MAX_TRIES = 4;
const GETCONTEXT_TIMEOUT_MS = 300;   // per-try; guards a hung/absent content script
const INTER_TRY_SLEEP_MS = 200;
const SETTLE_HARD_CEILING_MS = 1000; // wall-clock cap from loop start

function openPopupSafe() {
  try { browser.browserAction.openPopup(); } catch {}
}

function afSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Returns the content-script snapshot, or null on timeout / no content script.
// The .catch on sendMessage prevents an orphaned rejection (if the message
// rejects after the timeout already won the race) from surfacing as an
// unhandled-rejection warning in the background page.
async function afGetFillContext(tabId) {
  try {
    const ctx = await Promise.race([
      browser.tabs.sendMessage(tabId, {action: "getFillContext"}).catch(() => null),
      afSleep(GETCONTEXT_TIMEOUT_MS).then(() => null)
    ]);
    return ctx || null;
  } catch {
    return null;
  }
}

// One user gesture (shortcut or context menu). Same logic as Chrome; injects via
// TWO sequential awaited executeScript calls (autofill.js first). Only a UNIQUE
// resolution derives ONE password + fires a single fill; every other path defers
// to the popup. storageKey is zeroed in the finally (preserving + extending the
// pattern that previously lived only in the context-menu path).
async function autofillForTab(tab, fillAction) {
  if (!sessionSecret || !sessionEmail) { openPopupSafe(); return; }
  if (!tab?.url) { openPopupSafe(); return; }
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { openPopupSafe(); return; }
  if (!host) { openPopupSafe(); return; }

  const data = await browser.storage.local.get("services");
  if (!data.services || data.services.version !== 2) { openPopupSafe(); return; }

  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(sessionSecret, sessionEmail);
  const storageKey = await hmacSHA256(strengthened, enc.encode(sessionEmail.toLowerCase() + ":keygrain-local-storage"));
  try {
    let matches;
    try {
      const iv = base64ToArrayBuffer(data.services.iv);
      const ciphertext = base64ToArrayBuffer(data.services.ciphertext);
      const aad = enc.encode(sessionEmail.toLowerCase());
      const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
      const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
      const services = JSON.parse(new TextDecoder().decode(decrypted)).services || [];
      matches = KeygrainAutofill.filterMostSpecific(services, host);
    } catch { openPopupSafe(); return; }

    if (matches.length === 0) { openPopupSafe(); return; }

    try {
      await browser.tabs.executeScript(tab.id, {file: "autofill.js"});
      await browser.tabs.executeScript(tab.id, {file: "content.js"});
    } catch { openPopupSafe(); return; }

    const loopStart = Date.now();
    for (let tryN = 1; tryN <= SETTLE_MAX_TRIES; tryN++) {
      if (Date.now() - loopStart >= SETTLE_HARD_CEILING_MS) break;
      const ctx = await afGetFillContext(tab.id);
      if (!ctx) { openPopupSafe(); return; }
      const decision = KeygrainAutofill.selectServiceForFill(matches, {pageEmail: ctx.pageEmail});
      if (decision.decision === "fill") {
        const svc = decision.service;
        const password = await derivePassword(sessionSecret, svc.email, {site: svc.site || svc.name, length: svc.length || 20, symbols: svc.symbols || "!@#$%&*-_=+?", counter: svc.counter || 1});
        browser.tabs.sendMessage(tab.id, {action: fillAction, password, email: svc.email});
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
  } finally {
    if (storageKey && storageKey.fill) storageKey.fill(0);
  }
}

// The OTP analogue of autofillForTab (MV2 parity to chrome): same decrypt block +
// bounded settle loop + selectServiceForFill, narrowed to services with a `totp` config
// (Frozen Req 2/5); a UNIQUE resolution derives the current code (getTOTPCode; the seed
// stays in the bg page + is zeroed in getTOTPCode's own finally) and sends
// {action:"fillOtp", code}. Every ambiguous / none / timeout / failure path defers to the
// popup (§D7 Layer 3). storageKey is zeroed in the finally (FF invariant). Callers: the
// context-aware fill_credentials shortcut (focused-OTP branch) + the keygrain-fill-otp item.
async function autofillOtpForTab(tab) {
  if (!sessionSecret || !sessionEmail) { openPopupSafe(); return; }
  if (!tab?.url) { openPopupSafe(); return; }
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { openPopupSafe(); return; }
  if (!host) { openPopupSafe(); return; }

  const data = await browser.storage.local.get("services");
  if (!data.services || data.services.version !== 2) { openPopupSafe(); return; }

  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(sessionSecret, sessionEmail);
  const storageKey = await hmacSHA256(strengthened, enc.encode(sessionEmail.toLowerCase() + ":keygrain-local-storage"));
  try {
    let matches;
    try {
      const iv = base64ToArrayBuffer(data.services.iv);
      const ciphertext = base64ToArrayBuffer(data.services.ciphertext);
      const aad = enc.encode(sessionEmail.toLowerCase());
      const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
      const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
      const services = JSON.parse(new TextDecoder().decode(decrypted)).services || [];
      matches = KeygrainAutofill.filterMostSpecific(services, host).filter((s) => s && s.totp);
    } catch { openPopupSafe(); return; }

    if (matches.length === 0) { openPopupSafe(); return; }

    try {
      await browser.tabs.executeScript(tab.id, {file: "autofill.js"});
      await browser.tabs.executeScript(tab.id, {file: "content.js"});
    } catch { openPopupSafe(); return; }

    const loopStart = Date.now();
    for (let tryN = 1; tryN <= SETTLE_MAX_TRIES; tryN++) {
      if (Date.now() - loopStart >= SETTLE_HARD_CEILING_MS) break;
      const ctx = await afGetFillContext(tab.id);
      if (!ctx) { openPopupSafe(); return; }
      const decision = KeygrainAutofill.selectServiceForFill(matches, {pageEmail: ctx.pageEmail});
      if (decision.decision === "fill") {
        // Defer on a corrupt totp config rather than unhandled-reject (Layer 3 / Regression-Risk).
        let code;
        try { code = (await getTOTPCode(decision.service, sessionSecret)).code; }
        catch { openPopupSafe(); return; }
        browser.tabs.sendMessage(tab.id, {action: "fillOtp", code});
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
  } finally {
    if (storageKey && storageKey.fill) storageKey.fill(0);
  }
}

// Read-only focused-field OTP probe for the context-aware shortcut (§D3). Returns true
// ONLY on a positive focused-OTP signal; EVERY other condition (locked, no url, injection
// failure, absent/hung content script, getFillContext timeout, non-OTP / no focused field)
// returns false -> the UNCHANGED credentials path (Frozen Req 9). No decrypt -> no finally.
async function focusedFieldIsOtp(tab) {
  if (!sessionSecret || !sessionEmail) return false;
  if (!tab?.url) return false;
  try {
    await browser.tabs.executeScript(tab.id, {file: "autofill.js"});
    await browser.tabs.executeScript(tab.id, {file: "content.js"});
  } catch { return false; }
  const ctx = await afGetFillContext(tab.id);
  return !!(ctx && ctx.focusedIsOtp);
}

// === Keyboard Shortcut ===
browser.commands.onCommand.addListener(async (command) => {
  if (command !== "fill_credentials") return;
  const [tab] = await browser.tabs.query({active: true, currentWindow: true});
  // Context-aware (§D3): a focused OTP field fills the current code; EVERY other case
  // fills credentials exactly as before via the UNCHANGED autofillForTab(tab, "fill").
  if (await focusedFieldIsOtp(tab)) await autofillOtpForTab(tab);
  else await autofillForTab(tab, "fill");
});

// === Context Menu ===
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({id: "keygrain-fill", title: "Fill with Keygrain", contexts: ["editable"]});
  browser.contextMenus.create({id: "keygrain-fill-otp", title: "Fill one-time code with Keygrain", contexts: ["editable"]});
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "keygrain-fill") await autofillForTab(tab, "fill");
  else if (info.menuItemId === "keygrain-fill-otp") await autofillOtpForTab(tab);
});

// ===================================================================
// Native in-field autofill — Increment A (plumbing, NO visible UI).
// MV2 mirror of chrome/background.js: scoped content-script registration
// lifecycle + stateless, server-authoritative fill. Registered js list in
// Increment A is ["autofill.js","content.js"] — the inline UI files are added
// in Increment B. See designs/extension-native-infield-autofill.md.
// ===================================================================
const INLINE_SCRIPT_ID = "keygrain-inline";
const INLINE_JS = ["autofill.js", "inline-autofill.js", "inline-autofill-ui.js", "content.js"];

// MV2 registration is session-scoped to the persistent background page. There is
// no getRegisteredContentScripts, so we cache the currently-registered match set
// (inlineRegMatches) to diff against in reregisterIfChanged. It is set ONLY after
// a successful register and cleared in unregisterInline, so it always tracks the
// live handle.
let inlineRegHandle = null;
let inlineRegMatches = [];

async function inlineEnabled() {
  const data = await browser.storage.local.get("inlineAutofillEnabled");
  return !!data.inlineAutofillEnabled;
}

function inlineUnlocked() {
  return !!(sessionSecret && sessionEmail);
}

// MIRRORS the existing inlined decrypt block (updateBadge / backgroundSync /
// autofillForTab) using the in-memory session state; preserves the storageKey
// zeroing pattern. Returns the services array, or null when locked / no v2 store
// / decrypt fails. NEVER returns the secret.
async function decryptServices() {
  if (!sessionSecret || !sessionEmail) return null;
  const data = await browser.storage.local.get("services");
  if (!data.services || data.services.version !== 2) return null;
  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(sessionSecret, sessionEmail);
  const storageKey = await hmacSHA256(strengthened, enc.encode(sessionEmail.toLowerCase() + ":keygrain-local-storage"));
  try {
    const iv = base64ToArrayBuffer(data.services.iv);
    const ciphertext = base64ToArrayBuffer(data.services.ciphertext);
    const aad = enc.encode(sessionEmail.toLowerCase());
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
  try { tabs = await browser.tabs.query({}); } catch { return; }
  for (const tab of tabs) {
    if (tab.id == null) continue;
    browser.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

// Serialize all registration mutations through a FIFO chain. This is REQUIRED on
// MV2: browser.contentScripts.register returns a per-call handle, so two
// concurrent registers would each overwrite inlineRegHandle and ORPHAN the
// earlier handle (unregisterInline could never remove it — it would survive
// disable/lock until browser restart, an FR1/FR3 teardown gap). Serializing so
// only one register/unregister runs at a time makes doUnregisterInline always
// remove the single live handle before the next register. The do*Inline cores
// call each other DIRECTLY (never re-entering the chain) so there is no deadlock.
let inlineOpChain = Promise.resolve();
function inlineSerialize(op) {
  inlineOpChain = inlineOpChain.then(op, op).catch(() => {});
  return inlineOpChain;
}

async function doUnregisterInline() {
  if (inlineRegHandle) {
    try { await inlineRegHandle.unregister(); } catch {}
    inlineRegHandle = null;
  }
  inlineRegMatches = [];
}

// Register the inline content script for the user's saved-domain match patterns.
// No-ops when disabled/locked/no-matches. computeMatchPatterns always yields a
// fully-valid array (CR2). inlineRegMatches is cached ONLY after a successful
// register (never before), so it always tracks the live handle.
async function doRegisterInline() {
  if (!(await inlineEnabled()) || !inlineUnlocked()) return;
  const matches = KeygrainInline.computeMatchPatterns(await decryptServices());
  await doUnregisterInline();
  if (!matches.length) return;
  try {
    inlineRegHandle = await browser.contentScripts.register({
      matches,
      js: INLINE_JS.map(f => ({file: f})),
      runAt: "document_idle",
      allFrames: false,
    });
    inlineRegMatches = matches;
    // contentScripts.register only injects into pages loaded AFTER this point, so
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
// only: the master secret NEVER crosses to the content world. Re-injection is
// harmless: autofill.js + inline-autofill.js are pure and content.js
// (__keygrain_injected) + inline-autofill-ui.js (__keygrain_inline_injected)
// guard against double-injection. The per-tab loop is wrapped in a SINGLE
// try/catch PER TAB (not per file): a restricted page (about:, addons, reader)
// throws on the first file, so we skip the WHOLE tab rather than leave a partial
// injection (autofill.js without content.js -> a later fillInline->fill would
// have no content.js listener). Files load sequentially so autofill.js +
// inline-autofill.js are present before inline-autofill-ui.js + content.js.
async function injectIntoOpenSavedTabs() {
  if (!(await inlineEnabled()) || !inlineUnlocked()) return;
  const services = await decryptServices();
  if (!services || !services.length) return;
  let tabs;
  try { tabs = await browser.tabs.query({}); } catch { return; }
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
      for (const file of INLINE_JS) {
        await browser.tabs.executeScript(tab.id, {file});
      }
    } catch {}
  }
}

// Re-register only if the pattern set changed (services changed / post-sync).
// MV2 has no getRegisteredContentScripts, so diff against the cached set.
async function doReregisterIfChanged() {
  try {
    if (!(await inlineEnabled()) || !inlineUnlocked()) return;
    const matches = KeygrainInline.computeMatchPatterns(await decryptServices());
    if (inlineSetEquals(inlineRegMatches, matches)) return;
    await doRegisterInline();
  } catch {}
}

// Public, serialized entry points (called from the hooks + the inline listener).
function registerInline() { return inlineSerialize(doRegisterInline); }
function unregisterInline() { return inlineSerialize(doUnregisterInline); }
function reregisterIfChanged() { return inlineSerialize(doReregisterIfChanged); }

// Separate listener for inline actions ONLY (design Decision 1). The existing
// listener returns undefined for these actions, so Firefox falls through to here.
browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === "inlineAutofillEnabledChanged") {
    return (async () => {
      if (msg.enabled) {
        await registerInline();
      } else {
        await unregisterInline();
        await broadcastInline({action: "inlineDisabled"});
      }
      return {ok: true};
    })();
  }
  if (msg.action === "reregisterInlineAutofill") {
    return (async () => {
      await reregisterIfChanged();
      return {ok: true};
    })();
  }
  if (msg.action === "getInlineMatches") {
    return (async () => {
      try {
        if (!sender.tab || !sender.tab.url) return {enabled: false, locked: false, accounts: []};
        if (!(await inlineEnabled())) return {enabled: false, locked: false, accounts: []};
        if (!inlineUnlocked()) return {enabled: true, locked: true, accounts: []};
        const host = new URL(sender.tab.url).hostname.replace(/^www\./, "").toLowerCase();
        const services = await decryptServices();
        if (!services) return {enabled: true, locked: false, accounts: []};
        const matches = KeygrainAutofill.filterMostSpecific(services, host);
        const ranked = KeygrainAutofill.rankServices(matches);
        const accounts = ranked.map(KeygrainInline.sanitizeAccountForContent);
        return {enabled: true, locked: false, accounts};
      } catch {
        return {enabled: true, locked: false, accounts: []};
      }
    })();
  }
  if (msg.action === "getInlineOtpMatches") {
    return (async () => {
      try {
        if (!sender.tab || !sender.tab.url) return {enabled: false, locked: false, accounts: []};
        if (!(await inlineEnabled())) return {enabled: false, locked: false, accounts: []};
        if (!inlineUnlocked()) return {enabled: true, locked: true, accounts: []};
        const host = new URL(sender.tab.url).hostname.replace(/^www\./, "").toLowerCase();
        const services = await decryptServices();
        if (!services) return {enabled: true, locked: false, accounts: []};
        // Same as getInlineMatches but narrowed to services with a totp config (Frozen
        // Req 2). Reuses the UNCHANGED sanitizeAccountForContent whitelist -> no new field
        // crosses to content ("has totp" is implicit in whether the account appears).
        const matches = KeygrainAutofill.filterMostSpecific(services, host).filter((s) => s && s.totp);
        const ranked = KeygrainAutofill.rankServices(matches);
        const accounts = ranked.map(KeygrainInline.sanitizeAccountForContent);
        return {enabled: true, locked: false, accounts};
      } catch {
        return {enabled: true, locked: false, accounts: []};
      }
    })();
  }
  if (msg.action === "fillInline") {
    (async () => {
      try {
        if (!sender.tab || !sender.tab.url) return;
        if (!(await inlineEnabled()) || !inlineUnlocked()) return;
        const host = new URL(sender.tab.url).hostname.replace(/^www\./, "").toLowerCase();
        if (!sessionSecret || !sessionEmail) return;
        const services = await decryptServices();
        if (!services) return;
        const svc = services.find(s => s.id === msg.token && domainMatches((s.site || s.name).toLowerCase(), host));
        if (!svc) return;
        const password = await derivePassword(sessionSecret, svc.email, {site: svc.site || svc.name, length: svc.length || 20, symbols: svc.symbols || "!@#$%&*-_=+?", counter: svc.counter || 1});
        browser.tabs.sendMessage(sender.tab.id, {action: "fill", password, email: svc.email}).catch(() => {});
      } catch {}
    })();
    return; // stateless, fire-and-forget
  }
  if (msg.action === "fillInlineOtp") {
    (async () => {
      try {
        if (!sender.tab || !sender.tab.url) return;
        if (!(await inlineEnabled()) || !inlineUnlocked()) return;
        const host = new URL(sender.tab.url).hostname.replace(/^www\./, "").toLowerCase();
        if (!sessionSecret || !sessionEmail) return;
        const services = await decryptServices();
        if (!services) return;
        // Server-authoritative: re-verify id===token && domainMatches && s.totp; the seed
        // never crosses — only the derived code goes back via {action:"fillOtp"}.
        const svc = services.find(s => s.id === msg.token && domainMatches((s.site || s.name).toLowerCase(), host) && s.totp);
        if (!svc) return;
        const {code} = await getTOTPCode(svc, sessionSecret);
        browser.tabs.sendMessage(sender.tab.id, {action: "fillOtp", code}).catch(() => {});
      } catch {}
    })();
    return; // stateless, fire-and-forget
  }
});

// Broad optional origin removed via the browser's own extension settings —
// reconcile: disable the feature, tear down, and notify live tabs.
browser.permissions.onRemoved.addListener(async (permissions) => {
  if (permissions.origins && permissions.origins.includes("*://*/*")) {
    await browser.storage.local.set({inlineAutofillEnabled: false});
    await unregisterInline();
    await broadcastInline({action: "inlineDisabled"});
  }
});

// Broad optional origin GRANTED (the popup's permissions.request, or a manual
// grant via the browser's extension settings) — complete the enable from the
// background page (always alive on MV2) so a popup killed by the permission
// prompt can't leave the feature granted-but-off (the first-run failure this
// fixes). Mirror of onRemoved. NO broadcast on enable: registerInline injects on
// the next page load, matching the popup's inlineAutofillEnabledChanged:true
// path, and registerInline is serialized + idempotent (unregister-then-register),
// so a double call (surviving popup + this) is harmless.
browser.permissions.onAdded.addListener(async (permissions) => {
  if (permissions.origins && permissions.origins.includes("*://*/*")) {
    await browser.storage.local.set({inlineAutofillEnabled: true});
    await registerInline();
  }
});
