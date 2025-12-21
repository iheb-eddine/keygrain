// background.js — Chrome MV3 service worker
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "getSecret") {
    chrome.storage.session.get("secret", (data) => {
      sendResponse({secret: data.secret || null});
    });
    return true;
  }
  if (msg.action === "setSecret") {
    chrome.storage.session.set({secret: msg.secret}, () => {
      sendResponse({ok: true});
    });
    return true;
  }
  if (msg.action === "clearSecret") {
    chrome.storage.session.remove("secret", () => {
      sendResponse({ok: true});
    });
    return true;
  }
  if (msg.action === "getImportEmail") {
    chrome.storage.session.get("importEmail", (data) => {
      sendResponse({email: data.importEmail || null});
    });
    return true;
  }
  if (msg.action === "setImportEmail") {
    chrome.storage.session.set({importEmail: msg.email}, () => {
      sendResponse({ok: true});
    });
    return true;
  }
});
