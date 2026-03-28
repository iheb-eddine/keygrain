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
  } catch (e) {
    console.error("[keygrain] background sync error:", e?.message || e);
    if (e instanceof MetadataTamperError || e?.message === "checksum_mismatch") {
      browser.alarms.clear("syncAlarm");
    }
    const errType = e?.message;
    if (errType === "network_error" || errType === "server_error") {
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
    sessionSecret = null;
    sessionEmail = null;
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

// === Keyboard Shortcut ===
browser.commands.onCommand.addListener(async (command) => {
  if (command !== "fill_credentials") return;
  if (!sessionSecret || !sessionEmail) {
    try { browser.browserAction.openPopup(); } catch {}
    return;
  }
  const [tab] = await browser.tabs.query({active: true, currentWindow: true});
  if (!tab?.url) return;
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return; }
  if (!host) return;

  const data = await browser.storage.local.get("services");
  if (!data.services || data.services.version !== 2) {
    try { browser.browserAction.openPopup(); } catch {}
    return;
  }
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
    const matches = services.filter(s => {
      const site = (s.site || s.name).toLowerCase();
      return domainMatches(site, host);
    });
    if (matches.length !== 1) {
      try { browser.browserAction.openPopup(); } catch {}
      return;
    }
    const match = matches[0];
    const password = await derivePassword(sessionSecret, match.email, {site: match.site || match.name, length: match.length || 20, symbols: match.symbols || "!@#$%&*-_=+?", counter: match.counter || 1});
    await browser.tabs.executeScript(tab.id, {file: "content.js"});
    browser.tabs.sendMessage(tab.id, {action: "fill", password, email: match.email});
  } catch {
    try { browser.browserAction.openPopup(); } catch {}
  }
});

// === Context Menu ===
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({id: "keygrain-fill", title: "Fill with Keygrain", contexts: ["editable"]});
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "keygrain-fill" || !tab?.id) return;
  if (!sessionSecret || !sessionEmail) {
    browser.browserAction.openPopup();
    return;
  }
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return; }
  if (!host) return;

  const data = await browser.storage.local.get("services");
  if (!data.services || data.services.version !== 2) return;
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
    const match = services.find(s => {
      const site = (s.site || s.name).toLowerCase();
      return domainMatches(site, host);
    });
    if (!match) return;
    const password = await derivePassword(sessionSecret, match.email, {site: match.site || match.name, length: match.length || 20, symbols: match.symbols || "!@#$%&*-_=+?", counter: match.counter || 1});
    await browser.tabs.executeScript(tab.id, {file: "content.js"});
    browser.tabs.sendMessage(tab.id, {action: "fillContextMenu", password, email: match.email});
  } catch {}
});
