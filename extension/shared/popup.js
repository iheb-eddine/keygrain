(async function () {
  const MESSAGES = {
    LENGTH_MIN: "Password length must be at least 8 characters.",
    SYMBOLS_REQUIRED: "At least one symbol character is required.",
    COPIED: "Copied! Clipboard clears in 30 seconds.",
    CLIPBOARD_CLEARED: "Clipboard cleared.",
    FILL_SUCCESS: "Password filled into the page.",
    FILL_NO_FIELD: "No password field found on this page. Click on the password field and try again.",
    FILL_ERROR: "Couldn't fill the password. Try copying it manually instead.",
  };

  const form = document.getElementById("form");
  const output = document.getElementById("output");
  const status = document.getElementById("status");
  const copyBtn = document.getElementById("copy");
  const fillBtn = document.getElementById("fill");
  const secretInput = document.getElementById("secret");
  const fpContainer = document.getElementById("fingerprint");

  let clearTimer = null;
  let fpTimer = null;

  const optionsPanel = document.getElementById("options-panel");
  optionsPanel.addEventListener("toggle", () => {
    optionsPanel.querySelector("summary").textContent = optionsPanel.open ? "⚙️ Hide options" : "⚙️ Options";
  });

  // Fingerprint debounce
  secretInput.addEventListener("input", () => {
    if (fpTimer) clearTimeout(fpTimer);
    if (!secretInput.value) { fpContainer.textContent = ""; return; }
    fpTimer = setTimeout(async () => {
      const indices = await secretFingerprint(secretInput.value);
      fpContainer.textContent = "";
      indices.forEach(i => {
        const dot = document.createElement("span");
        dot.className = "fp-dot";
        dot.style.background = WONG_PALETTE[i];
        fpContainer.appendChild(dot);
      });
    }, 500);
  });

  // Resolve current tab hostname
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  const hostname = tab?.url ? new URL(tab.url).hostname : "";

  // Load saved settings for this domain
  const key = `domains.${hostname}`;
  const stored = (await chrome.storage.local.get(key))[key];
  if (stored) {
    document.getElementById("email").value = stored.email || "";
    document.getElementById("length").value = stored.length || 20;
    document.getElementById("symbols").value = stored.symbols || "!@#$%&*-_=+?";
    document.getElementById("salt").value = stored.salt || "";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const secret = document.getElementById("secret").value;
    const email = document.getElementById("email").value;
    const length = parseInt(document.getElementById("length").value, 10);
    const symbols = document.getElementById("symbols").value;
    const salt = document.getElementById("salt").value;

    if (length < 8) { status.textContent = MESSAGES.LENGTH_MIN; return; }
    if (!symbols) { status.textContent = MESSAGES.SYMBOLS_REQUIRED; return; }

    output.value = await derivePassword(secret, email, length, symbols, salt);
    status.textContent = "";

    // Save settings (never the secret)
    await chrome.storage.local.set({[key]: {email, length, symbols, salt}});
  });

  copyBtn.addEventListener("click", async () => {
    if (!output.value) return;
    await navigator.clipboard.writeText(output.value);
    status.textContent = MESSAGES.COPIED;
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(async () => {
      await navigator.clipboard.writeText("");
      status.textContent = MESSAGES.CLIPBOARD_CLEARED;
    }, 30000);
  });

  async function injectContentScript(tabId) {
    if (typeof browser !== "undefined" && browser.tabs?.executeScript) {
      await browser.tabs.executeScript(tabId, {file: "content.js"});
    } else {
      await chrome.scripting.executeScript({target: {tabId}, files: ["content.js"]});
    }
  }

  fillBtn.addEventListener("click", async () => {
    if (!output.value) return;
    try {
      await injectContentScript(tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, {action: "fill", password: output.value});
      if (response?.success) {
        status.textContent = MESSAGES.FILL_SUCCESS;
      } else {
        status.textContent = MESSAGES.FILL_NO_FIELD;
      }
    } catch (err) {
      console.error("Fill failed:", err);
      status.textContent = MESSAGES.FILL_ERROR;
    }
  });
})();
