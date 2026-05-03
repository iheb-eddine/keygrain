// background.js — Chrome MV3 service worker
importScripts("lib/hash-wasm-argon2.js", "keygrain.js", "sync.js");

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
  } catch (e) {
    console.error("[keygrain] background sync error:", e?.message || e);
    if (e instanceof MetadataTamperError || e?.message === "checksum_mismatch") {
      chrome.alarms.clear("syncAlarm");
    }
    const errType = e?.message;
    if (errType === "network_error" || errType === "server_error") {
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
    chrome.storage.session.remove(["secret", "email"]);
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

// === Keyboard Shortcut ===
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "fill_credentials") return;
  const {secret, email} = await chrome.storage.session.get(["secret", "email"]);
  if (!secret || !email) {
    try { chrome.action.openPopup(); } catch {}
    return;
  }
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.url) return;
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return; }
  if (!host) return;

  const data = await chrome.storage.local.get("services");
  if (!data.services || data.services.version !== 2) {
    try { chrome.action.openPopup(); } catch {}
    return;
  }
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
    const matches = services.filter(s => {
      const site = (s.site || s.name).toLowerCase();
      return domainMatches(site, host);
    });
    if (matches.length !== 1) {
      try { chrome.action.openPopup(); } catch {}
      return;
    }
    const match = matches[0];
    const password = await derivePassword(secret, match.email, {site: match.site || match.name, length: match.length || 20, symbols: match.symbols || "!@#$%&*-_=+?", counter: match.counter || 1});
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["content.js"]});
    chrome.tabs.sendMessage(tab.id, {action: "fill", password, email: match.email});
  } catch {
    try { chrome.action.openPopup(); } catch {}
  }
});

// === Context Menu ===
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({id: "keygrain-fill", title: "Fill with Keygrain", contexts: ["editable"]});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "keygrain-fill" || !tab?.id) return;
  const {secret, email} = await chrome.storage.session.get(["secret", "email"]);
  if (!secret || !email) {
    chrome.action.openPopup();
    return;
  }
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return; }
  if (!host) return;

  const data = await chrome.storage.local.get("services");
  if (!data.services || data.services.version !== 2) return;
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
    const match = services.find(s => {
      const site = (s.site || s.name).toLowerCase();
      return domainMatches(site, host);
    });
    if (!match) return;
    const password = await derivePassword(secret, match.email, {site: match.site || match.name, length: match.length || 20, symbols: match.symbols || "!@#$%&*-_=+?", counter: match.counter || 1});
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["content.js"]});
    chrome.tabs.sendMessage(tab.id, {action: "fillContextMenu", password, email: match.email});
  } catch {}
});
