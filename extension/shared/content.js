if (!window.__keygrain_injected) {
  window.__keygrain_injected = true;

  let lastContextMenuTarget = null;

  document.addEventListener("contextmenu", (e) => {
    lastContextMenuTarget = e.target;
  });

  function findPasswordField() {
    const focused = document.activeElement;
    if (focused?.type === "password") return focused;

    const fields = document.querySelectorAll('input[type="password"]');
    for (const f of fields) {
      if (f.offsetParent !== null && f.offsetWidth > 0) return f;
    }

    const candidates = document.querySelectorAll(
      'input[autocomplete*="password"], input[name*="pass" i], input[id*="pass" i]'
    );
    for (const c of candidates) {
      if (c.offsetParent !== null) return c;
    }
    return null;
  }

  function fillField(field, password) {
    const nativeSet = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, "value"
    ).set;
    nativeSet.call(field, password);
    field.dispatchEvent(new Event("input", {bubbles: true}));
    field.dispatchEvent(new Event("change", {bubbles: true}));
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "fill") {
      const field = findPasswordField();
      if (field) {
        fillField(field, msg.password);
        sendResponse({success: true});
      } else {
        sendResponse({success: false, error: "No password field found."});
      }
    }
    if (msg.action === "fillContextMenu") {
      const field = lastContextMenuTarget?.tagName === "INPUT" ? lastContextMenuTarget : findPasswordField();
      if (field) {
        fillField(field, msg.password);
        sendResponse({success: true});
      } else {
        sendResponse({success: false, error: "No password field found."});
      }
    }
    return true;
  });
}
