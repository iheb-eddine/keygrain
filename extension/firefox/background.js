// background.js — Firefox MV2 background page
let sessionSecret = null;
let sessionEmail = null;

const DEFAULT_LOCK_MINUTES = 15;

async function getLockMinutes() {
  const data = await browser.storage.local.get("settings");
  return (data.settings && data.settings.autoLockMinutes) || DEFAULT_LOCK_MINUTES;
}

// === Badge helpers ===
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
  const storageKey = await hmacSHA256(enc.encode(sessionSecret), enc.encode(sessionEmail.toLowerCase() + ":keygrain-local-storage"));
  try {
    const iv = base64ToArrayBuffer(data.services.iv);
    const ciphertext = base64ToArrayBuffer(data.services.ciphertext);
    const aad = enc.encode(sessionEmail.toLowerCase());
    const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
    const services = JSON.parse(new TextDecoder().decode(decrypted)).services || [];
    const count = services.filter(s => {
      const name = s.name.toLowerCase();
      return name.includes(host) || host.includes(name);
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

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "autoLock") {
    sessionSecret = null;
    sessionEmail = null;
    const [tab] = await browser.tabs.query({active: true, currentWindow: true});
    if (tab) browser.browserAction.setBadgeText({text: "", tabId: tab.id});
  }
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === "getSecret") {
    return Promise.resolve({secret: sessionSecret});
  }
  if (msg.action === "setSecret") {
    sessionSecret = msg.secret;
    resetAutoLock();
    return Promise.resolve({ok: true});
  }
  if (msg.action === "heartbeat") {
    resetAutoLock();
    return Promise.resolve({ok: true});
  }
  if (msg.action === "clearSecret") {
    sessionSecret = null;
    browser.alarms.clear("autoLock");
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
});
