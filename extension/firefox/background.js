// background.js — Firefox MV2 background page
let sessionSecret = null;
let importEmail = null;

browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === "getSecret") {
    return Promise.resolve({secret: sessionSecret});
  }
  if (msg.action === "setSecret") {
    sessionSecret = msg.secret;
    return Promise.resolve({ok: true});
  }
  if (msg.action === "clearSecret") {
    sessionSecret = null;
    return Promise.resolve({ok: true});
  }
  if (msg.action === "getImportEmail") {
    return Promise.resolve({email: importEmail});
  }
  if (msg.action === "setImportEmail") {
    importEmail = msg.email;
    return Promise.resolve({ok: true});
  }
});
