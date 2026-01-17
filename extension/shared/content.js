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

  function isVisible(el) {
    return el.offsetParent !== null && el.offsetWidth > 0 && !el.disabled;
  }

  function findUsernameField(scope) {
    const selectors = [
      'input[autocomplete="username"]',
      'input[autocomplete="email"]',
      'input[type="email"]',
      'input[type="text"][name*="user" i]',
      'input[type="text"][name*="email" i]',
      'input[type="text"][name*="login" i]',
      'input[type="text"][id*="user" i]',
      'input[type="text"][id*="email" i]',
      'input[type="text"][id*="login" i]'
    ];
    for (const sel of selectors) {
      const fields = scope.querySelectorAll(sel);
      for (const f of fields) {
        if (isVisible(f)) return f;
      }
    }
    return null;
  }

  function fillField(field, value) {
    const nativeSet = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, "value"
    ).set;
    nativeSet.call(field, value);
    field.dispatchEvent(new Event("input", {bubbles: true}));
    field.dispatchEvent(new Event("change", {bubbles: true}));
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "fill") {
      const pwField = findPasswordField();
      const scope = pwField?.closest("form") || document;
      let usernameField = null;
      if (msg.email) {
        usernameField = findUsernameField(scope);
        if (!usernameField && scope !== document) usernameField = findUsernameField(document);
      }
      if (usernameField) fillField(usernameField, msg.email);
      if (pwField) fillField(pwField, msg.password);
      if (usernameField && pwField) sendResponse({success: true, filled: "both"});
      else if (pwField) sendResponse({success: true, filled: "password_only"});
      else if (usernameField) sendResponse({success: true, filled: "username_only"});
      else sendResponse({success: false, error: "No fillable fields found."});
    }
    if (msg.action === "fillContextMenu") {
      const target = lastContextMenuTarget;
      if (target?.tagName === "INPUT" && target.type === "password") {
        fillField(target, msg.password);
        sendResponse({success: true});
      } else if (target?.tagName === "INPUT" && msg.email) {
        fillField(target, msg.email);
        sendResponse({success: true});
      } else {
        const field = findPasswordField();
        if (field) {
          fillField(field, msg.password);
          sendResponse({success: true});
        } else {
          sendResponse({success: false, error: "No password field found."});
        }
      }
    }
    return true;
  });
}
