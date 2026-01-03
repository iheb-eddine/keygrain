(async function () {
  // === DOM refs ===
  const lockScreen = document.getElementById("lock-screen");
  const mainScreen = document.getElementById("main-screen");
  const emailInput = document.getElementById("email");
  const secretInput = document.getElementById("secret");
  const fpContainer = document.getElementById("fingerprint");
  const unlockBtn = document.getElementById("unlock-btn");
  const lockBtn = document.getElementById("lock-btn");
  const menuBtn = document.getElementById("menu-btn");
  const menuDropdown = document.getElementById("menu-dropdown");
  const searchInput = document.getElementById("search");
  const serviceList = document.getElementById("service-list");
  const addBtn = document.getElementById("add-btn");
  const statusEl = document.getElementById("status");

  // Add dialog
  const addDialog = document.getElementById("add-dialog");
  const addName = document.getElementById("add-name");
  const addEmail = document.getElementById("add-email");
  const addLength = document.getElementById("add-length");
  const addSymbols = document.getElementById("add-symbols");
  const addSalt = document.getElementById("add-salt");
  const addCancel = document.getElementById("add-cancel");
  const addConfirm = document.getElementById("add-confirm");

  // Delete dialog
  const deleteDialog = document.getElementById("delete-dialog");
  const deleteServiceName = document.getElementById("delete-service-name");
  const deleteCancel = document.getElementById("delete-cancel");
  const deleteConfirm = document.getElementById("delete-confirm");

  // Settings
  const settingsBtn = document.getElementById("settings-btn");
  const settingsPanel = document.getElementById("settings-panel");
  const setLockTimeout = document.getElementById("set-lock-timeout");
  const setLength = document.getElementById("set-length");
  const setSymbols = document.getElementById("set-symbols");
  const setServerUrl = document.getElementById("set-server-url");
  const settingsCancel = document.getElementById("settings-cancel");
  const settingsSave = document.getElementById("settings-save");

  // === State ===
  let currentSecret = null;
  let currentEmail = null;
  let services = [];
  let deleteTarget = null;
  let clearTimer = null;
  let fpTimer = null;
  let statusTimer = null;
  let currentHostname = null;
  let focusedIndex = -1;
  let settings = {autoLockMinutes: 15, defaultLength: 20, defaultSymbols: "!@#$%&*-_=+?", serverUrl: "https://keygrain.secbytech.com"};

  const siteSuggestion = document.getElementById("site-suggestion");
  const quickFill = document.getElementById("quick-fill");

  // === Helpers ===
  function showStatus(msg) {
    statusEl.textContent = msg;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ""; }, 3000);
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get("settings");
    if (data.settings) Object.assign(settings, data.settings);
  }

  async function sendMsg(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch {
      await new Promise(r => setTimeout(r, 100));
      return chrome.runtime.sendMessage(msg);
    }
  }

  async function getSecret() {
    const resp = await sendMsg({action: "getSecret"});
    return resp?.secret || null;
  }
  async function setSecret(s) { return sendMsg({action: "setSecret", secret: s}); }
  async function clearSecret() { return sendMsg({action: "clearSecret"}); }

  async function getEmail() {
    const resp = await sendMsg({action: "getEmail"});
    return resp?.email || null;
  }
  async function setEmail(e) { return sendMsg({action: "setEmail", email: e}); }
  async function clearEmail() { return sendMsg({action: "clearEmail"}); }

  // === Base64 utilities ===
  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // === Local storage encryption ===
  async function deriveStorageKey(secret, email) {
    const enc = new TextEncoder();
    const message = enc.encode(email.toLowerCase() + ":keygrain-local-storage");
    return hmacSHA256(enc.encode(secret), message);
  }

  async function encryptServices(storageKey, email, servicesArray) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode(email.toLowerCase());
    const plaintext = new TextEncoder().encode(JSON.stringify({version: 1, services: servicesArray}));
    const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["encrypt"]);
    const ciphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, plaintext);
    return {
      version: 2,
      iv: arrayBufferToBase64(iv),
      ciphertext: arrayBufferToBase64(ciphertext)
    };
  }

  async function decryptServices(storageKey, email, stored) {
    const iv = base64ToArrayBuffer(stored.iv);
    const ciphertext = base64ToArrayBuffer(stored.ciphertext);
    const aad = new TextEncoder().encode(email.toLowerCase());
    const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
    const data = JSON.parse(new TextDecoder().decode(decrypted));
    return data.services || data;
  }

  async function loadServices() {
    const data = await chrome.storage.local.get("services");
    const stored = data.services;
    if (!stored) { services = []; return true; }

    if (stored.version === 1) {
      // v1 plaintext — migrate to v2
      if (!Array.isArray(stored.services)) return false;
      services = stored.services;
      await saveServices();
      return true;
    }

    if (stored.version === 2) {
      const key = await deriveStorageKey(currentSecret, currentEmail);
      try {
        services = await decryptServices(key, currentEmail, stored);
        return true;
      } catch {
        return false;
      } finally {
        key.fill(0);
      }
    }

    return false;
  }

  async function saveServices() {
    const key = await deriveStorageKey(currentSecret, currentEmail);
    try {
      const encrypted = await encryptServices(key, currentEmail, services);
      await chrome.storage.local.set({services: encrypted});
    } finally {
      key.fill(0);
    }
  }

  // === Rendering ===
  function showLockScreen() {
    lockScreen.classList.remove("hidden");
    mainScreen.classList.add("hidden");
    secretInput.value = "";
    fpContainer.textContent = "";
    unlockBtn.disabled = true;
    emailInput.focus();
  }

  function showMainScreen() {
    lockScreen.classList.add("hidden");
    mainScreen.classList.remove("hidden");
    searchInput.setAttribute("role", "combobox");
    searchInput.setAttribute("aria-controls", "service-list");
    searchInput.setAttribute("aria-expanded", "true");
    serviceList.setAttribute("role", "listbox");
    renderServiceList();
  }

  function renderServiceList() {
    serviceList.textContent = "";
    focusedIndex = -1;
    searchInput.removeAttribute("aria-activedescendant");
    const filter = searchInput.value.toLowerCase();
    const filtered = services.filter(s =>
      s.name.toLowerCase().includes(filter) || s.email.toLowerCase().includes(filter)
    );
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = services.length === 0 ? "No services yet" : "No matches";
      serviceList.appendChild(empty);
      return;
    }
    filtered.forEach((svc, i) => {
      const realIdx = services.indexOf(svc);
      const row = document.createElement("div");
      row.className = "service-item";
      row.id = "service-item-" + i;
      row.setAttribute("role", "option");
      row.setAttribute("tabindex", "-1");
      row.setAttribute("aria-selected", "false");

      const info = document.createElement("div");
      info.className = "service-info";
      const name = document.createElement("span");
      name.className = "service-name";
      name.textContent = svc.name;
      const email = document.createElement("span");
      email.className = "service-email";
      email.textContent = svc.email;
      info.appendChild(name);
      info.appendChild(email);

      const len = svc.length || 20;
      const tier = len >= 20 ? "strong" : len >= 13 ? "good" : "fair";
      const label = len >= 20 ? "Strong" : len >= 13 ? "Good" : "Fair";
      const bar = document.createElement("div");
      bar.className = "strength-bar " + tier;
      bar.setAttribute("aria-label", "Password strength: " + label);
      info.appendChild(bar);

      const actions = document.createElement("div");
      actions.className = "service-actions";

      const toggleBtn = document.createElement("button");
      toggleBtn.title = "Show/Hide";
      toggleBtn.textContent = "👁";
      toggleBtn.addEventListener("click", () => handleToggle(toggleBtn, svc));

      const copyBtn = document.createElement("button");
      copyBtn.title = "Copy";
      copyBtn.textContent = "📋";
      copyBtn.addEventListener("click", () => handleCopy(svc));

      const fillBtn = document.createElement("button");
      fillBtn.title = "Fill";
      fillBtn.textContent = "▶";
      fillBtn.addEventListener("click", () => handleFill(svc));

      const delBtn = document.createElement("button");
      delBtn.title = "Delete";
      delBtn.textContent = "🗑";
      delBtn.addEventListener("click", () => handleDeletePrompt(realIdx));

      actions.appendChild(toggleBtn);
      actions.appendChild(copyBtn);
      actions.appendChild(fillBtn);
      actions.appendChild(delBtn);

      row.appendChild(info);
      row.appendChild(actions);
      serviceList.appendChild(row);
    });
  }

  // === Password derivation ===
  async function deriveForService(svc) {
    return derivePassword(currentSecret, svc.email, svc.length || 20, svc.symbols || "!@#$%&*-_=+?", svc.salt || "");
  }

  // === Auto-detect site ===
  async function autoDetectSite() {
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (tab?.url) {
        try { currentHostname = new URL(tab.url).hostname.replace(/^www\./, ''); } catch { return; }
      }
    } catch { return; }
    if (!currentHostname) return;
    const host = currentHostname.toLowerCase();
    const matches = services.filter(s => {
      const name = s.name.toLowerCase();
      return name.includes(host) || host.includes(name);
    });
    if (matches.length > 0) {
      searchInput.value = currentHostname;
      renderServiceList();
      if (matches.length === 1) {
        const btn = document.createElement("button");
        btn.textContent = "Fill " + matches[0].name;
        btn.addEventListener("click", () => handleFill(matches[0]).then(() => window.close()));
        quickFill.textContent = "";
        quickFill.appendChild(btn);
        quickFill.classList.remove("hidden");
      }
    } else {
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = "Add " + currentHostname + "?";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        siteSuggestion.classList.add("hidden");
        addName.value = currentHostname;
        addEmail.value = currentEmail || "";
        addLength.value = settings.defaultLength;
        addSymbols.value = settings.defaultSymbols;
        addSalt.value = "";
        addDialog.classList.remove("hidden");
        addName.focus();
      });
      siteSuggestion.textContent = "";
      siteSuggestion.appendChild(link);
      siteSuggestion.classList.remove("hidden");
    }
  }

  // === Event handlers ===
  function updateUnlockBtn() {
    unlockBtn.disabled = !emailInput.value.trim() || !secretInput.value;
  }

  emailInput.addEventListener("input", updateUnlockBtn);

  secretInput.addEventListener("input", () => {
    updateUnlockBtn();
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

  unlockBtn.addEventListener("click", async () => {
    const s = secretInput.value;
    const e = emailInput.value.trim().toLowerCase();
    if (!s || !e) return;
    currentSecret = s;
    currentEmail = e;
    let ok;
    try { ok = await loadServices(); } catch { ok = false; }
    if (!ok) {
      showStatus("Wrong secret or email. Please try again.");
      currentSecret = null;
      currentEmail = null;
      return;
    }
    await setSecret(s);
    await setEmail(e);
    await chrome.storage.local.set({lastEmail: e});
    showMainScreen();
    autoDetectSite();
  });

  lockBtn.addEventListener("click", async () => {
    await clearSecret();
    await clearEmail();
    currentSecret = null;
    currentEmail = null;
    services = [];
    showLockScreen();
  });

  menuBtn.addEventListener("click", () => {
    menuDropdown.classList.toggle("hidden");
  });

  settingsBtn.addEventListener("click", () => {
    setLockTimeout.value = settings.autoLockMinutes;
    setLength.value = settings.defaultLength;
    setSymbols.value = settings.defaultSymbols;
    setServerUrl.value = settings.serverUrl;
    settingsPanel.classList.remove("hidden");
  });

  settingsCancel.addEventListener("click", () => settingsPanel.classList.add("hidden"));

  settingsSave.addEventListener("click", async () => {
    const timeout = parseInt(setLockTimeout.value, 10);
    const length = parseInt(setLength.value, 10);
    const symbols = setSymbols.value;
    const url = setServerUrl.value.trim();
    if (!timeout || timeout < 1) { showStatus("Timeout must be at least 1 minute."); return; }
    if (!length || length < 8) { showStatus("Length must be at least 8."); return; }
    if (!symbols) { showStatus("At least one symbol is required."); return; }
    if (!url.startsWith("https://")) { showStatus("Server URL must start with https://"); return; }
    settings = {autoLockMinutes: timeout, defaultLength: length, defaultSymbols: symbols, serverUrl: url};
    await chrome.storage.local.set({settings});
    settingsPanel.classList.add("hidden");
    showStatus("Settings saved.");
  });

  searchInput.addEventListener("input", () => {
    siteSuggestion.classList.add("hidden");
    quickFill.classList.add("hidden");
    renderServiceList();
  });

  // Add service
  addBtn.addEventListener("click", () => {
    addName.value = "";
    addEmail.value = "";
    addLength.value = settings.defaultLength;
    addSymbols.value = settings.defaultSymbols;
    addSalt.value = "";
    addDialog.classList.remove("hidden");
    addName.focus();
  });

  addCancel.addEventListener("click", () => addDialog.classList.add("hidden"));

  addConfirm.addEventListener("click", async () => {
    const name = addName.value.trim();
    const email = addEmail.value.trim();
    if (!name || !email) { showStatus("Name and email are required."); return; }
    const length = parseInt(addLength.value, 10);
    if (length < 8) { showStatus("Length must be at least 8."); return; }
    const symbols = addSymbols.value;
    if (!symbols) { showStatus("At least one symbol is required."); return; }
    services.push({name, email, length, symbols, salt: addSalt.value});
    await saveServices();
    addDialog.classList.add("hidden");
    renderServiceList();
  });

  // Delete service
  function handleDeletePrompt(idx) {
    deleteTarget = idx;
    deleteServiceName.textContent = services[idx].name;
    deleteDialog.classList.remove("hidden");
  }

  deleteCancel.addEventListener("click", () => {
    deleteDialog.classList.add("hidden");
    deleteTarget = null;
  });

  deleteConfirm.addEventListener("click", async () => {
    if (deleteTarget !== null) {
      services.splice(deleteTarget, 1);
      await saveServices();
      renderServiceList();
    }
    deleteDialog.classList.add("hidden");
    deleteTarget = null;
  });

  // Toggle password visibility
  async function handleToggle(btn, svc) {
    const row = btn.closest(".service-item");
    let pwSpan = row.querySelector(".password-display");
    if (pwSpan) {
      pwSpan.remove();
      btn.textContent = "👁";
      return;
    }
    const pw = await deriveForService(svc);
    pwSpan = document.createElement("span");
    pwSpan.className = "password-display";
    pwSpan.textContent = pw;
    pwSpan.style.fontSize = "0.75rem";
    pwSpan.style.fontFamily = "monospace";
    pwSpan.style.marginRight = "4px";
    row.querySelector(".service-actions").prepend(pwSpan);
    btn.textContent = "🙈";
  }

  // Copy
  async function handleCopy(svc) {
    const pw = await deriveForService(svc);
    await navigator.clipboard.writeText(pw);
    showStatus("Copied! Clears in 30s.");
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(async () => {
      await navigator.clipboard.writeText("");
      showStatus("Clipboard cleared.");
    }, 30000);
  }

  // Fill
  async function handleFill(svc) {
    const pw = await deriveForService(svc);
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (!tab) { showStatus("No active tab."); return; }
      if (typeof browser !== "undefined" && browser.tabs?.executeScript) {
        await browser.tabs.executeScript(tab.id, {file: "content.js"});
      } else {
        await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["content.js"]});
      }
      const resp = await chrome.tabs.sendMessage(tab.id, {action: "fill", password: pw});
      showStatus(resp?.success ? "Password filled." : "No password field found.");
    } catch {
      showStatus("Couldn't fill. Try copying instead.");
    }
  }

  // === Keyboard navigation ===
  function getFilteredServices() {
    const filter = searchInput.value.toLowerCase();
    return services.filter(s =>
      s.name.toLowerCase().includes(filter) || s.email.toLowerCase().includes(filter)
    );
  }

  function applyFocus() {
    const rows = serviceList.querySelectorAll(".service-item");
    rows.forEach((r, i) => {
      r.classList.toggle("focused", i === focusedIndex);
      r.setAttribute("aria-selected", i === focusedIndex ? "true" : "false");
    });
    if (focusedIndex >= 0 && rows[focusedIndex]) {
      searchInput.setAttribute("aria-activedescendant", "service-item-" + focusedIndex);
      rows[focusedIndex].scrollIntoView({block: "nearest"});
    } else {
      searchInput.removeAttribute("aria-activedescendant");
    }
  }

  document.addEventListener("keydown", (e) => {
    // Dialogs: Escape closes them
    if (!settingsPanel.classList.contains("hidden")) {
      if (e.key === "Escape") { settingsPanel.classList.add("hidden"); e.preventDefault(); }
      return;
    }
    if (!addDialog.classList.contains("hidden")) {
      if (e.key === "Escape") { addDialog.classList.add("hidden"); e.preventDefault(); }
      return;
    }
    if (!deleteDialog.classList.contains("hidden")) {
      if (e.key === "Escape") { deleteDialog.classList.add("hidden"); deleteTarget = null; e.preventDefault(); }
      return;
    }

    // Only handle keys on main screen
    if (mainScreen.classList.contains("hidden")) return;

    const rows = serviceList.querySelectorAll(".service-item");
    const count = rows.length;

    if (e.key === "ArrowDown") {
      if (e.target === searchInput || focusedIndex >= 0) {
        e.preventDefault();
        focusedIndex = Math.min(focusedIndex + 1, count - 1);
        applyFocus();
      }
    } else if (e.key === "ArrowUp") {
      if (focusedIndex >= 0) {
        e.preventDefault();
        focusedIndex--;
        if (focusedIndex < 0) searchInput.focus();
        applyFocus();
      }
    } else if (e.key === "Enter" && focusedIndex >= 0) {
      e.preventDefault();
      const filtered = getFilteredServices();
      if (filtered[focusedIndex]) handleFill(filtered[focusedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (focusedIndex >= 0) {
        focusedIndex = -1;
        applyFocus();
        searchInput.focus();
      } else if (searchInput.value) {
        searchInput.value = "";
        renderServiceList();
        searchInput.focus();
      } else {
        window.close();
      }
    }
  });

  // === Menu actions ===
  document.getElementById("backup-btn").addEventListener("click", async () => {
    menuDropdown.classList.add("hidden");
    try {
      const json = JSON.stringify({version: 1, services});
      const etags = (await chrome.storage.local.get("etags")).etags || {};
      const lookupId = await deriveLookupId(currentSecret, currentEmail);
      const result = await backupToServer(currentSecret, currentEmail, json, etags[lookupId] || null);
      if (result.etag) {
        etags[lookupId] = result.etag;
        await chrome.storage.local.set({etags});
      }
      showStatus("Backup complete.");
    } catch (e) {
      if (e.message === "conflict") showStatus("Conflict! Restore first, then backup.");
      else if (e.message === "auth_failed") showStatus("Authentication failed.");
      else showStatus("Backup failed: " + e.message);
    }
  });

  document.getElementById("restore-btn").addEventListener("click", async () => {
    menuDropdown.classList.add("hidden");
    try {
      const result = await restoreFromServer(currentSecret, currentEmail);
      services = result.services.services || result.services;
      await saveServices();
      if (result.etag) {
        const etags = (await chrome.storage.local.get("etags")).etags || {};
        const lookupId = await deriveLookupId(currentSecret, currentEmail);
        etags[lookupId] = result.etag;
        await chrome.storage.local.set({etags});
      }
      renderServiceList();
      showStatus("Restored " + services.length + " services.");
    } catch (e) {
      if (e.message === "not_found") showStatus("No backup found.");
      else if (e.message === "auth_failed") showStatus("Authentication failed.");
      else showStatus("Restore failed. Wrong secret or corrupted backup.");
    }
  });

  document.getElementById("export-btn").addEventListener("click", async () => {
    menuDropdown.classList.add("hidden");
    try {
      const encKey = await deriveEncryptionKey(currentSecret, currentEmail);
      const json = JSON.stringify({version: 1, services});
      const encrypted = await encryptBlob(encKey, new TextEncoder().encode(json));
      encKey.fill(0);
      exportToFile(encrypted, "keygrain-backup.keygrain");
      showStatus("Export started.");
    } catch (e) {
      showStatus("Export failed: " + e.message);
    }
  });

  document.getElementById("import-btn").addEventListener("click", async () => {
    menuDropdown.classList.add("hidden");
    await setEmail(currentEmail);
    chrome.tabs.create({url: "import.html"});
  });

  // === Auto-lock heartbeat ===
  document.addEventListener("click", () => sendMsg({action: "heartbeat"}));
  document.addEventListener("keydown", () => sendMsg({action: "heartbeat"}));

  // === Init ===
  await loadSettings();
  currentSecret = await getSecret();
  currentEmail = await getEmail();
  if (currentSecret && currentEmail) {
    let ok;
    try { ok = await loadServices(); } catch { ok = false; }
    if (ok) {
      showMainScreen();
      autoDetectSite();
    } else {
      currentSecret = null;
      currentEmail = null;
      await clearSecret();
      await clearEmail();
      showLockScreen();
    }
  } else {
    // Pre-fill email from lastEmail
    const data = await chrome.storage.local.get("lastEmail");
    if (data.lastEmail) emailInput.value = data.lastEmail;
    updateUnlockBtn();
    showLockScreen();
  }
})();
