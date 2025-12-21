(async function () {
  // === DOM refs ===
  const lockScreen = document.getElementById("lock-screen");
  const mainScreen = document.getElementById("main-screen");
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

  // Email dialog
  const emailDialog = document.getElementById("email-dialog");
  const emailDialogTitle = document.getElementById("email-dialog-title");
  const syncEmail = document.getElementById("sync-email");
  const emailCancel = document.getElementById("email-cancel");
  const emailConfirm = document.getElementById("email-confirm");

  // Delete dialog
  const deleteDialog = document.getElementById("delete-dialog");
  const deleteServiceName = document.getElementById("delete-service-name");
  const deleteCancel = document.getElementById("delete-cancel");
  const deleteConfirm = document.getElementById("delete-confirm");

  // === State ===
  let currentSecret = null;
  let services = [];
  let deleteTarget = null;
  let emailCallback = null;
  let clearTimer = null;
  let fpTimer = null;
  let statusTimer = null;

  // === Helpers ===
  function showStatus(msg) {
    statusEl.textContent = msg;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ""; }, 3000);
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

  async function loadServices() {
    const data = await chrome.storage.local.get("services");
    const stored = data.services;
    services = (stored && stored.services) ? stored.services : [];
  }

  async function saveServices() {
    await chrome.storage.local.set({services: {version: 1, services}});
  }

  // === Rendering ===
  function showLockScreen() {
    lockScreen.classList.remove("hidden");
    mainScreen.classList.add("hidden");
    secretInput.value = "";
    fpContainer.textContent = "";
    unlockBtn.disabled = true;
    secretInput.focus();
  }

  function showMainScreen() {
    lockScreen.classList.add("hidden");
    mainScreen.classList.remove("hidden");
    renderServiceList();
  }

  function renderServiceList() {
    serviceList.textContent = "";
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
    filtered.forEach((svc) => {
      const realIdx = services.indexOf(svc);
      const row = document.createElement("div");
      row.className = "service-item";

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

  // === Event handlers ===
  secretInput.addEventListener("input", () => {
    unlockBtn.disabled = !secretInput.value;
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
    if (!s) return;
    await setSecret(s);
    currentSecret = s;
    await loadServices();
    showMainScreen();
  });

  lockBtn.addEventListener("click", async () => {
    await clearSecret();
    currentSecret = null;
    services = [];
    showLockScreen();
  });

  menuBtn.addEventListener("click", () => {
    menuDropdown.classList.toggle("hidden");
  });

  searchInput.addEventListener("input", () => renderServiceList());

  // Add service
  addBtn.addEventListener("click", () => {
    addName.value = "";
    addEmail.value = "";
    addLength.value = "20";
    addSymbols.value = "!@#$%&*-_=+?";
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

  // === Menu actions ===
  function promptEmail(title, cb) {
    emailDialogTitle.textContent = title;
    syncEmail.value = "";
    emailCallback = cb;
    emailDialog.classList.remove("hidden");
    syncEmail.focus();
  }

  emailCancel.addEventListener("click", () => {
    emailDialog.classList.add("hidden");
    emailCallback = null;
  });

  emailConfirm.addEventListener("click", () => {
    const email = syncEmail.value.trim();
    if (!email) { showStatus("Email is required."); return; }
    emailDialog.classList.add("hidden");
    if (emailCallback) emailCallback(email);
    emailCallback = null;
  });

  document.getElementById("backup-btn").addEventListener("click", () => {
    menuDropdown.classList.add("hidden");
    promptEmail("Backup", async (email) => {
      try {
        const json = JSON.stringify({version: 1, services});
        const etags = (await chrome.storage.local.get("etags")).etags || {};
        const lookupId = await deriveLookupId(currentSecret, email);
        const result = await backupToServer(currentSecret, email, json, etags[lookupId] || null);
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
  });

  document.getElementById("restore-btn").addEventListener("click", () => {
    menuDropdown.classList.add("hidden");
    promptEmail("Restore", async (email) => {
      try {
        const result = await restoreFromServer(currentSecret, email);
        services = result.services.services || result.services;
        await saveServices();
        if (result.etag) {
          const etags = (await chrome.storage.local.get("etags")).etags || {};
          const lookupId = await deriveLookupId(currentSecret, email);
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
  });

  document.getElementById("export-btn").addEventListener("click", () => {
    menuDropdown.classList.add("hidden");
    promptEmail("Export", async (email) => {
      try {
        const encKey = await deriveEncryptionKey(currentSecret, email);
        const json = JSON.stringify({version: 1, services});
        const encrypted = await encryptBlob(encKey, new TextEncoder().encode(json));
        encKey.fill(0);
        exportToFile(encrypted, "keygrain-backup.keygrain");
        showStatus("Export started.");
      } catch (e) {
        showStatus("Export failed: " + e.message);
      }
    });
  });

  document.getElementById("import-btn").addEventListener("click", () => {
    menuDropdown.classList.add("hidden");
    promptEmail("Import", async (email) => {
      await sendMsg({action: "setImportEmail", email});
      chrome.tabs.create({url: "import.html"});
    });
  });

  // === Init ===
  currentSecret = await getSecret();
  if (currentSecret) {
    await loadServices();
    showMainScreen();
  } else {
    showLockScreen();
  }
})();
