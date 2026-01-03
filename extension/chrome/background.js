// background.js — Chrome MV3 service worker
const DEFAULT_LOCK_MINUTES = 15;

async function getLockMinutes() {
  const data = await chrome.storage.local.get("settings");
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
  const storageKey = await hmacSHA256(enc.encode(secret), enc.encode(email.toLowerCase() + ":keygrain-local-storage"));
  try {
    const iv = base64ToArrayBuffer(data.services.iv);
    const ciphertext = base64ToArrayBuffer(data.services.ciphertext);
    const aad = enc.encode(email.toLowerCase());
    const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
    const services = JSON.parse(new TextDecoder().decode(decrypted)).services || [];
    const count = services.filter(s => {
      const name = s.name.toLowerCase();
      return name.includes(host) || host.includes(name);
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

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "autoLock") {
    chrome.storage.session.remove(["secret", "email"]);
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (tab) chrome.action.setBadgeText({text: "", tabId: tab.id});
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
});
