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
  const syncIndicator = document.getElementById("sync-indicator");
  const syncTimeEl = document.getElementById("sync-time");
  const syncErrorEl = document.getElementById("sync-error");

  // Add dialog
  const addDialog = document.getElementById("add-dialog");
  const addName = document.getElementById("add-name");
  const addSite = document.getElementById("add-site");
  const addEmail = document.getElementById("add-email");
  const addLength = document.getElementById("add-length");
  const addSymbols = document.getElementById("add-symbols");
  const addCancel = document.getElementById("add-cancel");
  const addConfirm = document.getElementById("add-confirm");
  const addRuleIndicator = document.getElementById("add-rule-indicator");
  const addPwWarning = document.getElementById("add-pw-warning");
  const rotateSection = document.getElementById("rotate-section");
  const addCounter = document.getElementById("add-counter");
  const rotateBtn = document.getElementById("rotate-btn");
  const markRotatedBtn = document.getElementById("mark-rotated-btn");

  // TOTP dialog refs
  const addTotpMode = document.getElementById("add-totp-mode");
  const addTotpSeedGroup = document.getElementById("add-totp-seed-group");
  const addTotpSeed = document.getElementById("add-totp-seed");
  let originalTotpSeed = ""; // tracks the seed value loaded on edit

  // SSH dialog refs
  const addSshKeyname = document.getElementById("add-ssh-keyname");

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

  // Reset DOM refs
  const resetBtn = document.getElementById("reset-btn");
  const resetDialog = document.getElementById("reset-dialog");
  const resetInput = document.getElementById("reset-input");
  const resetConfirmBtn = document.getElementById("reset-confirm-btn");
  const resetCancel = document.getElementById("reset-cancel");

  // PIN DOM refs
  const pinScreen = document.getElementById("pin-screen");
  const pinInput = document.getElementById("pin-input");
  const pinUnlockBtn = document.getElementById("pin-unlock-btn");
  const pinError = document.getElementById("pin-error");
  const pinUseSecret = document.getElementById("pin-use-secret");
  const pinSetupBanner = document.getElementById("pin-setup-banner");
  const pinSetInput = document.getElementById("pin-set-input");
  const pinSkipBtn = document.getElementById("pin-skip-btn");
  const pinSaveBtn = document.getElementById("pin-save-btn");

  // === State ===
  let currentSecret = null;
  let currentEmail = null;
  let services = [];
  let wallets = [];
  let walletAuditLog = [];
  let deleteTarget = null;
  let editIndex = null;
  let clearTimer = null;
  let fpTimer = null;
  const statusTimerState = {id: null};
  let currentHostname = null;
  let focusedIndex = -1;
  let settings = {autoLockMinutes: 15, defaultLength: 20, defaultSymbols: "!@#$%&*-_=+?", serverUrl: "https://keygrain.com"};
  let isDemoMode = false;
  let siteRules = null;
  const RULES_PUBLIC_KEY = "nFoyzMF0v9XyAiRzBd5DVvfPJsiNmuDPB9e5Lxld5I0=";
  let autolockPollTimer = null;
  let syncGeneration = 0;
  let syncInProgress = false;
  let syncDebounceTimer = null;
  let skipNextDebounce = false;
  let lastSyncTime = null;
  let lastSyncError = null;
  let syncIndicatorInterval = null;

  const autolockWarning = document.getElementById("autolock-warning");
  const autolockExtend = document.getElementById("autolock-extend");

  const siteSuggestion = document.getElementById("site-suggestion");
  const quickFill = document.getElementById("quick-fill");
  const breachWarnings = document.getElementById("breach-warnings");

  // === Focus trap ===
  let settingsState = null;
  let resetState = null;
  let addState = null;
  let deleteState = null;

  const tryDemoLink = document.getElementById("try-demo");
  const demoBanner = document.getElementById("demo-banner");

  function enterDemoMode() {
    isDemoMode = true;
    currentSecret = "demo-secret-keygrain";
    currentEmail = "demo@example.com";
    services = [
      {name: "GitHub", site: "github.com", email: "demo@example.com", length: 20, symbols: "!@#$%&*-_=+?", counter: 1, updated_at: 1},
      {name: "Google", site: "google.com", email: "demo@example.com", length: 20, symbols: "!@#$%&*-_=+?", counter: 1, updated_at: 2},
      {name: "Netflix", site: "netflix.com", email: "demo@example.com", length: 20, symbols: "!@#$%&*-_=+?", counter: 1, updated_at: 3},
      {name: "Amazon", site: "amazon.com", email: "demo@example.com", length: 20, symbols: "!@#$%&*-_=+?", counter: 1, updated_at: 4},
      {name: "Twitter", site: "twitter.com", email: "demo@example.com", length: 20, symbols: "!@#$%&*-_=+?", counter: 1, updated_at: 5}
    ];
    demoBanner.classList.remove("hidden");
    showMainScreen();
  }

  tryDemoLink.addEventListener("click", (e) => {
    e.preventDefault();
    enterDemoMode();
  });



  // === Helpers ===

  async function loadSettings() {
    const data = await chrome.storage.local.get("settings");
    if (data.settings) Object.assign(settings, data.settings);
  }

  async function loadSiteRules() {
    const data = await chrome.storage.local.get("siteRules");
    const result = await fetchSiteRules(settings.serverUrl, data.siteRules, RULES_PUBLIC_KEY);
    siteRules = result.rules;
    if (result.cacheEntry) await chrome.storage.local.set({siteRules: result.cacheEntry});
  }

  async function loadBreaches() {
    const data = await chrome.storage.local.get("breachFeed");
    const result = await fetchBreachFeed(settings.serverUrl, data.breachFeed);
    if (result.cacheEntry) await chrome.storage.local.set({breachFeed: result.cacheEntry});
    if (result.breaches && result.breaches.length) {
      const d = await chrome.storage.local.get("dismissedBreaches");
      const matched = checkBreaches(result.breaches, services, d.dismissedBreaches || []);
      renderBreachWarnings(matched);
    }
  }

  function renderBreachWarnings(matched) {
    breachWarnings.textContent = "";
    const visible = matched.slice(0, 3);
    const remaining = matched.length - visible.length;
    visible.forEach(b => {
      const div = document.createElement("div");
      div.className = "breach-banner " + b.severity;
      div.setAttribute("tabindex", "0");
      const icon = b.severity === "info" ? '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.75 12h-1.5V7h1.5v5zm0-6.5h-1.5V4h1.5v1.5z"/></svg>' : '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8.56 1.69a.63.63 0 0 0-1.12 0L.34 14.03A.63.63 0 0 0 .9 15h14.2a.63.63 0 0 0 .56-.97L8.56 1.69zM8 12.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM7.25 6h1.5v4h-1.5V6z"/></svg>';
      const dateStr = new Date(b.date + "T00:00:00").toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"});
      const headline = document.createElement("div");
      headline.className = "breach-headline";
      headline.innerHTML = icon + " " + esc(b.domain) + " was breached (" + dateStr + ")";
      div.appendChild(headline);
      const desc = document.createElement("div");
      desc.className = "breach-desc";
      desc.textContent = b.description;
      div.appendChild(desc);
      if (b.action && b.severity !== "info") {
        const action = document.createElement("div");
        action.className = "breach-action";
        action.textContent = "\u2192 " + b.action;
        div.appendChild(action);
      }
      const dismiss = document.createElement("button");
      dismiss.className = "breach-dismiss";
      dismiss.textContent = "\u00D7";
      dismiss.setAttribute("aria-label", "Dismiss breach warning for " + b.domain);
      dismiss.addEventListener("click", async () => {
        const d = await chrome.storage.local.get("dismissedBreaches");
        const arr = d.dismissedBreaches || [];
        arr.push(b.id);
        await chrome.storage.local.set({dismissedBreaches: arr});
        div.remove();
      });
      div.appendChild(dismiss);
      breachWarnings.appendChild(div);
    });
    if (remaining > 0) {
      const more = document.createElement("div");
      more.className = "breach-more";
      more.textContent = "+" + remaining + " more breach warning" + (remaining > 1 ? "s" : "");
      more.addEventListener("click", () => {
        more.remove();
        matched.slice(3).forEach(b => {
          const div = document.createElement("div");
          div.className = "breach-banner " + b.severity;
          div.setAttribute("tabindex", "0");
          const icon = b.severity === "info" ? '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.75 12h-1.5V7h1.5v5zm0-6.5h-1.5V4h1.5v1.5z"/></svg>' : '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8.56 1.69a.63.63 0 0 0-1.12 0L.34 14.03A.63.63 0 0 0 .9 15h14.2a.63.63 0 0 0 .56-.97L8.56 1.69zM8 12.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM7.25 6h1.5v4h-1.5V6z"/></svg>';
          const dateStr = new Date(b.date + "T00:00:00").toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"});
          const headline = document.createElement("div");
          headline.className = "breach-headline";
          headline.innerHTML = icon + " " + esc(b.domain) + " was breached (" + dateStr + ")";
          div.appendChild(headline);
          const desc = document.createElement("div");
          desc.className = "breach-desc";
          desc.textContent = b.description;
          div.appendChild(desc);
          if (b.action && b.severity !== "info") {
            const action = document.createElement("div");
            action.className = "breach-action";
            action.textContent = "\u2192 " + b.action;
            div.appendChild(action);
          }
          const dismiss = document.createElement("button");
          dismiss.className = "breach-dismiss";
          dismiss.textContent = "\u00D7";
          dismiss.setAttribute("aria-label", "Dismiss breach warning for " + b.domain);
          dismiss.addEventListener("click", async () => {
            const d = await chrome.storage.local.get("dismissedBreaches");
            const arr = d.dismissedBreaches || [];
            arr.push(b.id);
            await chrome.storage.local.set({dismissedBreaches: arr});
            div.remove();
          });
          div.appendChild(dismiss);
          breachWarnings.appendChild(div);
        });
      });
      breachWarnings.appendChild(more);
    }
    const actionable = matched.filter(b => b.severity !== "info");
    if (actionable.length > 0) {
      const affectedIndices = new Set();
      actionable.forEach(b => {
        services.forEach((svc, i) => {
          const name = (svc.site || svc.name).toLowerCase().replace(/^www\./, "");
          if (name === b.domain || name.endsWith("." + b.domain)) affectedIndices.add(i);
        });
      });
      if (affectedIndices.size > 0) {
        const btn = document.createElement("button");
        btn.className = "breach-rotate-all";
        btn.textContent = "";
        btn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.65 2.35A7.96 7.96 0 0 0 8 0C3.58 0 0 3.58 0 8s3.58 8 8 8a7.99 7.99 0 0 0 7.56-5.34h-2.03A6 6 0 1 1 8 2a5.98 5.98 0 0 1 4.24 1.76L9 7h7V0l-2.35 2.35z"/></svg> Rotate all affected (' + affectedIndices.size + ')';
        btn.addEventListener("click", async () => {
          if (!confirm("This will generate new passwords for " + affectedIndices.size + " service" + (affectedIndices.size > 1 ? "s" : "") + ". You\u2019ll need to update them on each site.")) return;
          affectedIndices.forEach(i => {
            services[i].counter = (services[i].counter || 1) + 1;
            services[i].updated_at = nextTimestamp(services);
          });
          await saveServices();
          const d = await chrome.storage.local.get("dismissedBreaches");
          const arr = d.dismissedBreaches || [];
          actionable.forEach(b => { if (!arr.includes(b.id)) arr.push(b.id); });
          await chrome.storage.local.set({dismissedBreaches: arr});
          breachWarnings.textContent = "";
          const summary = document.createElement("div");
          summary.className = "breach-banner info";
          summary.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm3.35 6.35l-4 4a.5.5 0 0 1-.7 0l-2-2a.5.5 0 1 1 .7-.7L7 9.29l3.65-3.64a.5.5 0 1 1 .7.7z"/></svg> Rotated ' + affectedIndices.size + ' password' + (affectedIndices.size > 1 ? 's' : '') + '. Update them on each site.';
          breachWarnings.appendChild(summary);
          renderServiceList();
        });
        breachWarnings.appendChild(btn);
      }
    }
  }

  function applyRule(name) {
    if (!name || !name.includes(".")) { addRuleIndicator.classList.add("hidden"); return; }
    const domain = name.toLowerCase().replace(/^www\./, "");
    const rule = lookupRule(domain, siteRules);
    if (rule) {
      addLength.value = rule.maxLength || settings.defaultLength;
      addSymbols.value = rule.symbols || settings.defaultSymbols;
      addRuleIndicator.textContent = "\u2713 Optimized for " + rule.domain;
      addRuleIndicator.classList.remove("hidden");
    } else {
      addRuleIndicator.classList.add("hidden");
    }
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
        const result = await decryptServices(key, currentEmail, stored);
        services = result.services;
        wallets = result.wallets;
        walletAuditLog = result.walletAuditLog;
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
    if (isDemoMode) return;
    const key = await deriveStorageKey(currentSecret, currentEmail);
    try {
      const encrypted = await encryptServices(key, currentEmail, services, wallets, walletAuditLog);
      await chrome.storage.local.set({services: encrypted});
    } finally {
      key.fill(0);
    }
    syncGeneration++;
    if (skipNextDebounce) { skipNextDebounce = false; return; }
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(performAutoSync, 5000);
  }

  // === Background sync ===
  async function performAutoSync() {
    if (isDemoMode || syncInProgress || !currentSecret) return;
    syncInProgress = true;
    updateSyncIndicator();
    const gen = syncGeneration;
    try {
      const result = await syncWithServer(currentSecret, currentEmail, services, wallets, walletAuditLog);
      if (syncGeneration !== gen) return;
      skipNextDebounce = true;
      services = result.services;
      wallets = result.wallets;
      walletAuditLog = result.wallet_audit_log;
      await saveServices();
      await setKnownUUIDs(result.knownUUIDs);
      renderServiceList();
      lastSyncTime = Date.now();
      lastSyncError = null;
      await chrome.storage.local.set({lastSyncTime, lastSyncError: null});
      await chrome.storage.local.remove("syncRetryState");
    } catch (e) {
      const msg = e.message;
      let errorObj;
      if (e instanceof MetadataTamperError) {
        errorObj = {type: "integrity", message: "Data integrity error. Please contact support."};
      } else if (msg === "network_error") {
        errorObj = {type: "network", message: "Connection error"};
      } else if (msg === "server_error") {
        errorObj = {type: "server", message: "Server error"};
      } else if (msg === "auth_failed") {
        errorObj = {type: "auth", message: "Authentication failed"};
      } else {
        errorObj = {type: "other", message: msg || "Sync failed"};
      }
      lastSyncError = errorObj;
      await chrome.storage.local.set({lastSyncError: errorObj});
      if (errorObj.type === "network" || errorObj.type === "server") {
        sendMsg({action: "scheduleSyncRetry", errorType: errorObj.type});
      }
    } finally {
      syncInProgress = false;
      updateSyncIndicator();
    }
  }



  function updateSyncIndicator() {
    if (lastSyncError) {
      chrome.storage.local.get("syncRetryState", (data) => {
        const status = computeSyncStatus(syncInProgress, lastSyncError, lastSyncTime, data.syncRetryState);
        syncIndicator.classList.toggle("hidden", !status.visible);
        syncTimeEl.textContent = status.text;
        syncErrorEl.classList.toggle("hidden", !status.errorHtml);
        if (status.errorHtml) syncErrorEl.innerHTML = status.errorHtml;
      });
    } else {
      const status = computeSyncStatus(syncInProgress, lastSyncError, lastSyncTime, null);
      syncIndicator.classList.toggle("hidden", !status.visible);
      syncTimeEl.textContent = status.text;
      syncErrorEl.classList.toggle("hidden", !status.errorHtml);
      if (status.errorHtml) syncErrorEl.innerHTML = status.errorHtml;
    }
  }



  // === Rendering ===
  function showLockScreen() {
    lockScreen.classList.remove("hidden");
    mainScreen.classList.add("hidden");
    pinScreen.classList.add("hidden");
    secretInput.value = "";
    fpContainer.textContent = "";
    unlockBtn.disabled = true;
    document.body.style.height = "auto";
    emailInput.focus();
  }

  function showPinScreen() {
    pinScreen.classList.remove("hidden");
    lockScreen.classList.add("hidden");
    mainScreen.classList.add("hidden");
    pinInput.value = "";
    pinError.classList.add("hidden");
    pinUnlockBtn.disabled = true;
    pinInput.focus();
  }

  function showMainScreen() {
    lockScreen.classList.add("hidden");
    pinScreen.classList.add("hidden");
    mainScreen.classList.remove("hidden");
    // Force popup resize
    document.body.style.height = "auto";
    startAutolockWarning();
    searchInput.setAttribute("role", "combobox");
    searchInput.setAttribute("aria-controls", "service-list");
    searchInput.setAttribute("aria-expanded", "true");
    serviceList.setAttribute("role", "listbox");
    renderServiceList();
    startTOTPInterval();
    if (!syncIndicatorInterval) {
      syncIndicatorInterval = setInterval(updateSyncIndicator, 1000);
    }
  }

  function renderServiceList() {
    serviceList.textContent = "";
    focusedIndex = -1;
    searchInput.removeAttribute("aria-activedescendant");
    const filter = searchInput.value.trim();
    const filtered = getFilteredServices(services, filter);
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
      if ((svc.counter || 1) > 1) {
        const badge = document.createElement("span");
        badge.className = "version-badge";
        badge.textContent = "v" + svc.counter;
        name.appendChild(badge);
      }
      if (svc.migrating) {
        const mbadge = document.createElement("span");
        mbadge.className = "migrate-badge";
        mbadge.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8.56 1.69a.63.63 0 0 0-1.12 0L.34 14.03A.63.63 0 0 0 .9 15h14.2a.63.63 0 0 0 .56-.97L8.56 1.69zM8 12.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM7.25 6h1.5v4h-1.5V6z"/></svg> migrate';
        name.appendChild(mbadge);
      }
      const siteSpan = document.createElement("span");
      siteSpan.className = "service-site";
      siteSpan.textContent = svc.site || svc.name;
      const email = document.createElement("span");
      email.className = "service-email";
      email.textContent = svc.email;
      info.appendChild(name);
      info.appendChild(siteSpan);
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
      toggleBtn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3C4.36 3 1.26 5.28 0 8.5c1.26 3.22 4.36 5.5 8 5.5s6.74-2.28 8-5.5C14.74 5.28 11.64 3 8 3zm0 9.17a3.67 3.67 0 1 1 0-7.34 3.67 3.67 0 0 1 0 7.34zM8 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>';
      toggleBtn.setAttribute("aria-label", "Show password for " + svc.name);
      toggleBtn.addEventListener("click", () => handleToggle(toggleBtn, svc));

      const copyBtn = document.createElement("button");
      copyBtn.title = "Copy";
      copyBtn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5 2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1h1.5A1.5 1.5 0 0 1 14 3.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 14.5v-11A1.5 1.5 0 0 1 3.5 2H5zm1 0h4v1H6V2z"/></svg>';
      copyBtn.setAttribute("aria-label", "Copy password for " + svc.name);
      copyBtn.addEventListener("click", () => handleCopy(svc));

      const fillBtn = document.createElement("button");
      fillBtn.title = "Fill";
      fillBtn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6V2z"/></svg>';
      fillBtn.setAttribute("aria-label", "Fill password for " + svc.name);
      fillBtn.addEventListener("click", () => handleFill(svc));

      const delBtn = document.createElement("button");
      delBtn.title = "Delete";
      delBtn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 0a.5.5 0 0 0-.5.5V1H2a1 1 0 0 0-1 1v1h14V2a1 1 0 0 0-1-1h-3V.5a.5.5 0 0 0-.5-.5h-5zM2 4l.9 10.11A1.5 1.5 0 0 0 4.4 15.5h7.2a1.5 1.5 0 0 0 1.5-1.39L14 4H2z"/></svg>';
      delBtn.setAttribute("aria-label", "Delete " + svc.name);
      delBtn.addEventListener("click", () => handleDeletePrompt(realIdx));

      const editBtn = document.createElement("button");
      editBtn.title = "Edit";
      editBtn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M12.15 1.15a1.5 1.5 0 0 1 2.12 0l.58.58a1.5 1.5 0 0 1 0 2.12L5.37 13.33l-3.2.8.8-3.2 9.18-9.78z"/></svg>';
      editBtn.setAttribute("aria-label", "Edit " + svc.name);
      editBtn.addEventListener("click", () => handleEdit(realIdx));

      actions.appendChild(toggleBtn);
      actions.appendChild(copyBtn);
      actions.appendChild(fillBtn);
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      row.appendChild(info);
      row.appendChild(actions);

      // TOTP display
      if (svc.totp) {
        const totpRow = document.createElement("div");
        totpRow.className = "totp-row";
        totpRow.dataset.serviceIdx = String(realIdx);
        const codeSpan = document.createElement("span");
        codeSpan.className = "totp-code";
        codeSpan.textContent = "••••••";
        const countdown = document.createElement("div");
        countdown.className = "totp-countdown";
        const bar = document.createElement("div");
        bar.className = "totp-countdown-bar";
        countdown.appendChild(bar);
        const copyTotpBtn = document.createElement("button");
        copyTotpBtn.title = "Copy TOTP";
        copyTotpBtn.className = "totp-copy-btn";
        copyTotpBtn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5 2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1h1.5A1.5 1.5 0 0 1 14 3.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 14.5v-11A1.5 1.5 0 0 1 3.5 2H5zm1 0h4v1H6V2z"/></svg>';
        copyTotpBtn.setAttribute("aria-label", "Copy TOTP code for " + svc.name);
        copyTotpBtn.addEventListener("click", async () => {
          try {
            const {code} = await getTOTPCode(svc, currentSecret);
            await navigator.clipboard.writeText(code);
            showStatus(statusEl, "TOTP copied", statusTimerState);
          } catch (e) { showStatus(statusEl, "TOTP error: " + e.message, statusTimerState); }
        });
        totpRow.appendChild(codeSpan);
        totpRow.appendChild(countdown);
        totpRow.appendChild(copyTotpBtn);
        row.appendChild(totpRow);
      }

      // SSH display
      if (svc.ssh && svc.ssh.key_name) {
        const sshRow = document.createElement("div");
        sshRow.className = "ssh-row";
        const badge = document.createElement("span");
        badge.className = "ssh-badge";
        badge.textContent = "SSH";
        const keyLabel = document.createElement("span");
        keyLabel.className = "ssh-keyname";
        keyLabel.textContent = svc.ssh.key_name;
        const copySshBtn = document.createElement("button");
        copySshBtn.title = "Copy SSH public key";
        copySshBtn.className = "ssh-copy-btn";
        copySshBtn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5 2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1h1.5A1.5 1.5 0 0 1 14 3.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 14.5v-11A1.5 1.5 0 0 1 3.5 2H5zm1 0h4v1H6V2z"/></svg> Copy pubkey';
        copySshBtn.setAttribute("aria-label", "Copy SSH public key for " + svc.name);
        copySshBtn.addEventListener("click", async () => {
          try {
            const kp = await deriveSshKeypair(currentSecret, svc.email, {keyName: svc.ssh.key_name, counter: svc.ssh.counter || 1});
            const comment = svc.email.toLowerCase() + ":" + svc.ssh.key_name.toLowerCase();
            const line = formatAuthorizedKeys(kp.publicKey, comment);
            await navigator.clipboard.writeText(line);
            showStatus(statusEl, "SSH public key copied", statusTimerState);
          } catch (e) { showStatus(statusEl, "SSH error: " + e.message, statusTimerState); }
        });
        sshRow.appendChild(badge);
        sshRow.appendChild(keyLabel);
        sshRow.appendChild(copySshBtn);
        row.appendChild(sshRow);
      }

      serviceList.appendChild(row);
    });
    refreshTOTPCodes();
  }

  // === TOTP refresh ===
  let totpInterval = null;

  async function refreshTOTPCodes() {
    const rows = serviceList.querySelectorAll(".totp-row");
    for (const row of rows) {
      const idx = parseInt(row.dataset.serviceIdx, 10);
      const svc = services[idx];
      if (!svc || !svc.totp) continue;
      try {
        const {code, remaining} = await getTOTPCode(svc, currentSecret);
        const formatted = code.length === 8
          ? code.slice(0, 4) + " " + code.slice(4)
          : code.slice(0, 3) + " " + code.slice(3);
        row.querySelector(".totp-code").textContent = formatted;
        const period = svc.totp.period || 30;
        row.querySelector(".totp-countdown-bar").style.width = (remaining / period * 100) + "%";
      } catch { /* ignore */ }
    }
  }

  function startTOTPInterval() {
    if (totpInterval) return;
    totpInterval = setInterval(refreshTOTPCodes, 1000);
  }

  function stopTOTPInterval() {
    if (totpInterval) { clearInterval(totpInterval); totpInterval = null; }
  }

  // === Password derivation ===
  async function deriveForService(svc) {
    return derivePassword(currentSecret, svc.email, {
      site: svc.site || svc.name,
      length: svc.length || 20,
      symbols: svc.symbols || "!@#$%&*-_=+?",
      counter: svc.counter || 1
    });
  }

  // === Auto-detect site ===
  async function updateMigrateBtn() {
    const data = await chrome.storage.local.get("migrationChecklist");
    const cl = data.migrationChecklist;
    const btn = document.getElementById("migrate-btn");
    if (cl) {
      const pending = cl.items.filter(i => i.status === "pending").length;
      if (pending > 0) { btn.textContent = "Migration progress (" + pending + " remaining)"; return; }
    }
    btn.textContent = "Migrate from another manager";
  }

  async function autoDetectSite() {
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (tab?.url) {
        try { currentHostname = new URL(tab.url).hostname.replace(/^www\./, ''); } catch { return; }
      }
    } catch { return; }
    if (!currentHostname) return;
    const host = currentHostname.toLowerCase();
    // Extract base domain (e.g., google.com from calendar.google.com)
    const parts = host.split(".");
    const baseDomain = parts.length > 2 ? parts.slice(-2).join(".") : host;
    const matches = services.filter(s => {
      const site = (s.site || s.name).toLowerCase();
      return site === host || host.endsWith("." + site) || site === baseDomain || baseDomain.endsWith("." + site);
    });
    if (matches.length > 0) {
      searchInput.value = matches.length === 1 ? matches[0].name : currentHostname;
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
        editIndex = null;
        addName.value = currentHostname;
        addSite.value = currentHostname;
        addSite.disabled = false;
        addEmail.value = currentEmail || "";
        addLength.value = settings.defaultLength;
        addSymbols.value = settings.defaultSymbols;
        applyRule(currentHostname);
        addPwWarning.classList.add("hidden");
        rotateSection.classList.add("hidden");
        addSshKeyname.value = "";
        addDialog.querySelector("h2").textContent = "Add Service";
        addConfirm.textContent = "Add";
        addState = openDialog(addDialog);
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

  emailInput.addEventListener("input", () => {
    updateUnlockBtn();
  });

  secretInput.addEventListener("input", () => {
    updateUnlockBtn();
    // Strength meter
    const strengthMeter = document.getElementById("strength-meter");
    if (secretInput.value) {
      const bits = estimateEntropy(secretInput.value);
      const { label, cls } = entropyLabel(bits);
      strengthMeter.textContent = label + " (" + Math.round(bits) + " bits)";
      strengthMeter.className = "strength-meter " + cls;
    } else {
      strengthMeter.textContent = "";
      strengthMeter.className = "strength-meter";
    }
    if (fpTimer) clearTimeout(fpTimer);
    if (!secretInput.value) { fpContainer.textContent = ""; return; }
    fpContainer.textContent = "⏳";
    fpTimer = setTimeout(async () => {
      try {
        const indices = await secretFingerprint(secretInput.value);
        fpContainer.textContent = "";
        indices.forEach(i => {
          const dot = document.createElement("span");
          dot.className = "fp-dot";
          dot.style.background = WONG_PALETTE[i];
          fpContainer.appendChild(dot);
        });
      } catch (e) { fpContainer.textContent = ""; console.error("fingerprint error:", e); }
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
      showStatus(statusEl, "Wrong secret or email. Please try again.", statusTimerState);
      currentSecret = null;
      currentEmail = null;
      return;
    }
    // If no local services, try fetching from server (returning user on new device?)
    if (services.length === 0) {
      try {
        showStatus(statusEl, "Checking server...", statusTimerState);
        const result = await syncWithServer(s, e, services);
        if (result.services.length > 0) {
          // Server had data — returning user
          services = result.services;
          await saveServices();
          await setKnownUUIDs(result.knownUUIDs);
        }
      } catch { /* server unreachable or 404 — new user */ }
    }
    // If still no services (new user), ask to confirm secret
    if (services.length === 0) {
      showStatus(statusEl, "", statusTimerState);
      const confirmResult = await new Promise(resolve => {
        const dialog = document.createElement("div");
        dialog.className = "dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.innerHTML = `
          <h2>Confirm your master secret</h2>
          <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;">You're setting up Keygrain for the first time. Re-type your secret to make sure you didn't mistype it.</p>
          <input type="password" id="confirm-new-secret" autocomplete="off" placeholder="Re-type your secret" style="margin-bottom:12px;">
          <div class="dialog-actions">
            <button id="confirm-cancel">Cancel</button>
            <button id="confirm-ok">Confirm</button>
          </div>
        `;
        document.body.appendChild(dialog);
        const input = dialog.querySelector("#confirm-new-secret");
        input.focus();
        dialog.querySelector("#confirm-ok").addEventListener("click", () => {
          document.body.removeChild(dialog);
          resolve(input.value);
        });
        dialog.querySelector("#confirm-cancel").addEventListener("click", () => {
          document.body.removeChild(dialog);
          resolve(null);
        });
      });
      if (confirmResult === null || confirmResult !== s) {
        showStatus(statusEl, confirmResult === null ? "" : "Secrets don't match. Try again.", statusTimerState);
        currentSecret = null;
        currentEmail = null;
        return;
      }
    }
    await setSecret(s);
    await setEmail(e);
    await chrome.storage.local.set({lastEmail: e});
    const syncData = await chrome.storage.local.get(["lastSyncTime", "lastSyncError"]);
    lastSyncTime = syncData.lastSyncTime || null;
    lastSyncError = syncData.lastSyncError || null;
    showMainScreen();
    updateSyncIndicator();
    performAutoSync();
    await loadSiteRules();
    loadBreaches();
    autoDetectSite();
    updateMigrateBtn();
    // Offer PIN setup if not already set
    const pinCheck = await chrome.storage.local.get("pinData");
    if (!pinCheck.pinData) {
      pinSetupBanner.classList.remove("hidden");
    }
  });

  // === PIN event handlers ===
  pinInput.addEventListener("input", () => {
    const v = pinInput.value.replace(/\D/g, "").slice(0, 6);
    pinInput.value = v;
    pinUnlockBtn.disabled = v.length < 4;
  });

  pinUnlockBtn.addEventListener("click", async () => {
    const pin = pinInput.value;
    const data = await chrome.storage.local.get(["pinData", "pinFailCount"]);
    if (!data.pinData) return;
    try {
      const secret = await pinDecryptSecret(pin, data.pinData);
      await chrome.storage.local.set({pinFailCount: 0});
      const emailData = await chrome.storage.local.get("lastEmail");
      currentSecret = secret;
      currentEmail = emailData.lastEmail;
      let ok;
      try { ok = await loadServices(); } catch { ok = false; }
      if (!ok) {
        pinError.textContent = "Decryption succeeded but services failed to load. Use master secret.";
        pinError.classList.remove("hidden");
        currentSecret = null;
        currentEmail = null;
        return;
      }
      if (!currentEmail && services.length > 0) {
        const freq = {};
        services.forEach(s => { freq[s.email] = (freq[s.email] || 0) + 1; });
        currentEmail = Object.keys(freq).reduce((a, b) => freq[a] >= freq[b] ? a : b);
        await chrome.storage.local.set({lastEmail: currentEmail});
      }
      await setSecret(secret);
      await setEmail(currentEmail);
      const syncData = await chrome.storage.local.get(["lastSyncTime", "lastSyncError"]);
      lastSyncTime = syncData.lastSyncTime || null;
      lastSyncError = syncData.lastSyncError || null;
      showMainScreen();
      updateSyncIndicator();
      performAutoSync();
      await loadSiteRules();
      loadBreaches();
      autoDetectSite();
      updateMigrateBtn();
    } catch {
      const fails = (data.pinFailCount || 0) + 1;
      if (fails >= 5) {
        await chrome.storage.local.remove(["pinData", "pinFailCount"]);
        pinError.textContent = "Too many wrong attempts. PIN cleared.";
        pinError.classList.remove("hidden");
        setTimeout(showLockScreen, 1500);
      } else {
        await chrome.storage.local.set({pinFailCount: fails});
        pinError.textContent = "Wrong PIN. " + (5 - fails) + " attempt" + (5 - fails === 1 ? "" : "s") + " remaining.";
        pinError.classList.remove("hidden");
        pinInput.value = "";
        pinUnlockBtn.disabled = true;
      }
    }
  });

  pinUseSecret.addEventListener("click", (e) => {
    e.preventDefault();
    showLockScreen();
  });

  pinSetInput.addEventListener("input", () => {
    const v = pinSetInput.value.replace(/\D/g, "").slice(0, 6);
    pinSetInput.value = v;
  });

  pinSkipBtn.addEventListener("click", () => {
    pinSetupBanner.classList.add("hidden");
  });

  pinSaveBtn.addEventListener("click", async () => {
    if (isDemoMode) return;
    const pin = pinSetInput.value;
    if (!/^\d{4,6}$/.test(pin)) {
      showStatus(statusEl, "PIN must be 4-6 digits.", statusTimerState);
      return;
    }
    const stored = await pinEncryptSecret(pin, currentSecret);
    await chrome.storage.local.set({pinData: stored, pinFailCount: 0});
    pinSetupBanner.classList.add("hidden");
    showStatus(statusEl, "PIN set successfully.", statusTimerState);
  });

  // === Enter key → button click ===
  function enterToClick(input, btn) {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !btn.disabled) btn.click();
    });
  }

  // Lock screen
  emailInput.addEventListener("keydown", e => { if (e.key === "Enter") secretInput.focus(); });
  enterToClick(secretInput, unlockBtn);

  // PIN unlock
  enterToClick(pinInput, pinUnlockBtn);

  // PIN setup
  enterToClick(pinSetInput, pinSaveBtn);

  // Add/Edit dialog
  [addName, addSite, addEmail, addLength, addSymbols, addCounter, addTotpSeed, addSshKeyname].forEach(
    input => enterToClick(input, addConfirm)
  );

  // Settings dialog
  [setLockTimeout, setLength, setSymbols, setServerUrl].forEach(
    input => enterToClick(input, settingsSave)
  );

  lockBtn.addEventListener("click", async () => {
    isDemoMode = false;
    demoBanner.classList.add("hidden");
    stopAutolockWarning();
    stopTOTPInterval();
    if (syncDebounceTimer) { clearTimeout(syncDebounceTimer); syncDebounceTimer = null; }
    syncInProgress = false;
    if (syncIndicatorInterval) { clearInterval(syncIndicatorInterval); syncIndicatorInterval = null; }
    await clearSecret();
    await clearEmail();
    currentSecret = null;
    currentEmail = null;
    services = [];
    clearStrengthenCache();
    showLockScreen();
  });

  menuBtn.addEventListener("click", () => {
    const expanded = !menuDropdown.classList.contains("hidden");
    menuDropdown.classList.toggle("hidden");
    menuBtn.setAttribute("aria-expanded", String(!expanded));
  });

  syncErrorEl.addEventListener("click", () => {
    if (lastSyncError) showStatus(statusEl, lastSyncError.message || "Sync error", statusTimerState);
  });

  settingsBtn.addEventListener("click", () => {
    setLockTimeout.value = settings.autoLockMinutes;
    setLength.value = settings.defaultLength;
    setSymbols.value = settings.defaultSymbols;
    setServerUrl.value = settings.serverUrl;
    settingsState = openDialog(settingsPanel);
  });

  settingsCancel.addEventListener("click", () => {
    closeDialog(settingsPanel, settingsState);
  });

  settingsSave.addEventListener("click", async () => {
    const timeout = parseInt(setLockTimeout.value, 10);
    const length = parseInt(setLength.value, 10);
    const symbols = setSymbols.value;
    const url = setServerUrl.value.trim();
    if (!timeout || timeout < 1) { showStatus(statusEl, "Timeout must be at least 1 minute.", statusTimerState); return; }
    if (!length || length < 8) { showStatus(statusEl, "Length must be at least 8.", statusTimerState); return; }
    if (!symbols) { showStatus(statusEl, "At least one symbol is required.", statusTimerState); return; }
    if (!url.startsWith("https://")) { showStatus(statusEl, "Server URL must start with https://", statusTimerState); return; }
    settings = {autoLockMinutes: timeout, defaultLength: length, defaultSymbols: symbols, serverUrl: url};
    await chrome.storage.local.set({settings});
    closeDialog(settingsPanel, settingsState);
    showStatus(statusEl, "Settings saved.", statusTimerState);
  });

  searchInput.addEventListener("input", () => {
    siteSuggestion.classList.add("hidden");
    quickFill.classList.add("hidden");
    renderServiceList();
  });

  // === Reset handlers ===
  resetBtn.addEventListener("click", () => {
    resetInput.value = "";
    resetConfirmBtn.disabled = true;
    resetState = openDialog(resetDialog);
    resetInput.focus();
  });

  resetInput.addEventListener("input", () => {
    resetConfirmBtn.disabled = resetInput.value !== "RESET";
  });

  resetCancel.addEventListener("click", () => closeDialog(resetDialog, resetState));

  resetConfirmBtn.addEventListener("click", async () => {
    if (resetInput.value !== "RESET") return;
    isDemoMode = false;
    demoBanner.classList.add("hidden");
    stopAutolockWarning();
    stopTOTPInterval();
    if (syncDebounceTimer) { clearTimeout(syncDebounceTimer); syncDebounceTimer = null; }
    syncInProgress = false;
    if (syncIndicatorInterval) { clearInterval(syncIndicatorInterval); syncIndicatorInterval = null; }
    await clearSecret();
    await clearEmail();
    await chrome.storage.local.clear();
    clearStrengthenCache();
    currentSecret = null;
    currentEmail = null;
    services = [];
    wallets = [];
    walletAuditLog = [];
    closeDialog(resetDialog, resetState);
    closeDialog(settingsPanel, settingsState);
    showLockScreen();
  });

  enterToClick(resetInput, resetConfirmBtn);

  // Add service
  addBtn.addEventListener("click", () => {
    editIndex = null;
    addName.value = "";
    addSite.value = currentHostname || "";
    addSite.disabled = false;
    addEmail.value = currentEmail || "";
    addLength.value = settings.defaultLength;
    addSymbols.value = settings.defaultSymbols;
    addRuleIndicator.classList.add("hidden");
    addPwWarning.classList.add("hidden");
    rotateSection.classList.add("hidden");
    addTotpMode.value = "";
    addTotpSeed.value = "";
    originalTotpSeed = "";
    addTotpSeedGroup.classList.remove("hidden");
    addSshKeyname.value = "";
    addDialog.querySelector("h2").textContent = "Add Service";
    addConfirm.textContent = "Add";
    addState = openDialog(addDialog);
    addName.focus();
  });

  addCancel.addEventListener("click", () => closeDialog(addDialog, addState));

  addTotpMode.addEventListener("change", () => {
    addTotpSeedGroup.classList.toggle("hidden", addTotpMode.value === "derived" || addTotpMode.value === "");
  });

  addName.addEventListener("input", () => applyRule(addName.value.trim()));

  function checkPwWarning() {
    if (editIndex === null) { addPwWarning.classList.add("hidden"); return; }
    const orig = services[editIndex];
    const changed = parseInt(addLength.value, 10) !== (orig.length || 20) ||
      addSymbols.value !== (orig.symbols || "!@#$%&*-_=+?");
    addPwWarning.classList.toggle("hidden", !changed);
  }
  addLength.addEventListener("input", checkPwWarning);
  addSymbols.addEventListener("input", checkPwWarning);

  addConfirm.addEventListener("click", async () => {
    const name = addName.value.trim();
    const site = addSite.value.trim();
    const email = addEmail.value.trim();
    if (!name || !email) { showStatus(statusEl, "Name and email are required.", statusTimerState); return; }
    if (!site) { showStatus(statusEl, "Site is required.", statusTimerState); return; }
    const length = parseInt(addLength.value, 10);
    if (length < 8) { showStatus(statusEl, "Length must be at least 8.", statusTimerState); return; }
    const symbols = addSymbols.value;
    if (!symbols) { showStatus(statusEl, "At least one symbol is required.", statusTimerState); return; }
    // Name collision check
    const duplicate = services.some((s, i) => s.name === name && i !== editIndex);
    if (duplicate) { showStatus(statusEl, "A service with that name already exists.", statusTimerState); return; }
    // Build TOTP config
    let totp = null;
    const totpMode = addTotpMode.value;
    if (totpMode === "stored") {
      const seedInput = addTotpSeed.value.trim();
      if (!seedInput) { showStatus(statusEl, "TOTP seed is required for stored mode.", statusTimerState); return; }
      if (editIndex !== null && seedInput === originalTotpSeed && services[editIndex].totp && services[editIndex].totp.mode === "stored") {
        totp = services[editIndex].totp;
      } else {
        try {
          const parsed = parseTOTPInput(seedInput);
          const binary = String.fromCharCode(...parsed.seed);
          totp = {mode: "stored", seed: btoa(binary), digits: parsed.digits, period: parsed.period, algorithm: parsed.algorithm};
        } catch (e) { showStatus(statusEl, "Invalid TOTP input: " + e.message, statusTimerState); return; }
      }
    } else if (totpMode === "derived") {
      if (!email) { showStatus(statusEl, "Email is required for derived TOTP.", statusTimerState); return; }
      totp = {mode: "derived", digits: 6, period: 30, algorithm: "SHA1"};
    }
    // Build SSH config
    let ssh = null;
    const sshKeyname = addSshKeyname.value.trim();
    if (sshKeyname) {
      if (/\s/.test(sshKeyname)) { showStatus(statusEl, "SSH key name must not contain whitespace.", statusTimerState); return; }
      const sshCounter = (editIndex !== null && services[editIndex].ssh) ? services[editIndex].ssh.counter || 1 : 1;
      ssh = {key_name: sshKeyname, counter: sshCounter};
    }
    if (editIndex !== null) {
      const newCounter = parseInt(addCounter.value, 10);
      if (!newCounter || newCounter < 1 || !Number.isInteger(newCounter)) {
        showStatus(statusEl, "Password version must be a positive integer.", statusTimerState); return;
      }
      const oldCounter = services[editIndex].counter || 1;
      if (newCounter < oldCounter) {
        if (!confirm("Setting a lower version will revert to an older password. Continue?")) return;
      }
      if (newCounter > oldCounter) delete services[editIndex].migrating;
      services[editIndex] = {...services[editIndex], name, email, length, symbols, totp, ssh, counter: newCounter, updated_at: nextTimestamp(services)};
    } else {
      services.push({name, site: normalizeSite(site), email, length, symbols, counter: 1, totp, ssh, id: crypto.randomUUID(), updated_at: nextTimestamp(services)});
    }
    await saveServices();
    closeDialog(addDialog, addState);
    renderServiceList();
  });

  rotateBtn.addEventListener("click", () => {
    if (editIndex === null) return;
    if (!confirm("This will generate a new password for this service. The old password will no longer work. Continue?")) return;
    addCounter.value = parseInt(addCounter.value, 10) + 1;
  });

  markRotatedBtn.addEventListener("click", async () => {
    if (editIndex === null) return;
    delete services[editIndex].migrating;
    services[editIndex].updated_at = nextTimestamp(services);
    await saveServices();
    closeDialog(addDialog, addState);
    renderServiceList();
  });

  // Delete service
  function handleDeletePrompt(idx) {
    deleteTarget = idx;
    deleteServiceName.textContent = services[idx].name;
    deleteState = openDialog(deleteDialog);
  }

  // Edit service
  function handleEdit(idx) {
    const svc = services[idx];
    editIndex = idx;
    addName.value = svc.name;
    addSite.value = svc.site || svc.name;
    addSite.disabled = true;
    addEmail.value = svc.email;
    addLength.value = svc.length || 20;
    addSymbols.value = svc.symbols || "!@#$%&*-_=+?";
    addRuleIndicator.classList.add("hidden");
    addPwWarning.classList.add("hidden");
    rotateSection.classList.remove("hidden");
    addCounter.value = svc.counter || 1;
    markRotatedBtn.classList.toggle("hidden", !svc.migrating);
    // Populate TOTP
    if (svc.totp) {
      addTotpMode.value = svc.totp.mode;
      originalTotpSeed = svc.totp.mode === "stored" ? (svc.totp.seed || "") : "";
      addTotpSeed.value = originalTotpSeed;
      addTotpSeedGroup.classList.toggle("hidden", svc.totp.mode === "derived");
    } else {
      addTotpMode.value = "";
      addTotpSeed.value = "";
      originalTotpSeed = "";
      addTotpSeedGroup.classList.remove("hidden");
    }
    // Populate SSH
    addSshKeyname.value = (svc.ssh && svc.ssh.key_name) ? svc.ssh.key_name : "";
    addDialog.querySelector("h2").textContent = "Edit Service";
    addConfirm.textContent = "Save";
    addState = openDialog(addDialog);
    addName.focus();
  }

  deleteCancel.addEventListener("click", () => {
    closeDialog(deleteDialog, deleteState);
    deleteTarget = null;
  });

  deleteConfirm.addEventListener("click", async () => {
    if (deleteTarget !== null) {
      services.splice(deleteTarget, 1);
      await saveServices();
      renderServiceList();
    }
    closeDialog(deleteDialog, deleteState);
    deleteTarget = null;
  });

  // Toggle password visibility
  async function handleToggle(btn, svc) {
    const row = btn.closest(".service-item");
    let pwSpan = row.querySelector(".password-display");
    if (pwSpan) {
      pwSpan.remove();
      btn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3C4.36 3 1.26 5.28 0 8.5c1.26 3.22 4.36 5.5 8 5.5s6.74-2.28 8-5.5C14.74 5.28 11.64 3 8 3zm0 9.17a3.67 3.67 0 1 1 0-7.34 3.67 3.67 0 0 1 0 7.34zM8 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>';
      btn.setAttribute("aria-label", "Show password for " + svc.name);
      return;
    }
    const pw = await deriveForService(svc);
    pwSpan = document.createElement("span");
    pwSpan.className = "password-display";
    pwSpan.textContent = pw;
    row.querySelector(".service-actions").prepend(pwSpan);
    btn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3C4.36 3 1.26 5.28 0 8.5c1.26 3.22 4.36 5.5 8 5.5s6.74-2.28 8-5.5C14.74 5.28 11.64 3 8 3zm0 9.17a3.67 3.67 0 1 1 0-7.34 3.67 3.67 0 0 1 0 7.34zM8 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/><path d="M1.27 1.27a.75.75 0 0 1 1.06 0l12.4 12.4a.75.75 0 0 1-1.06 1.06L1.27 2.33a.75.75 0 0 1 0-1.06z"/></svg>';
    btn.setAttribute("aria-label", "Hide password for " + svc.name);
  }

  // Copy
  async function handleCopy(svc) {
    if (svc.migrating) {
      showStatus(statusEl, "⚠ Old password — visit the site and change it to the Keygrain-generated one.", statusTimerState);
    }
    const pw = await deriveForService(svc);
    await navigator.clipboard.writeText(pw);
    showStatus(statusEl, "Copied! Clears in 30s.", statusTimerState);
    svc.frecency = (svc.frecency || 0) * 0.95 + 1;
    await saveServices();
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(async () => {
      await navigator.clipboard.writeText("");
      showStatus(statusEl, "Clipboard cleared.", statusTimerState);
    }, 30000);
  }

  // Fill
  async function handleFill(svc) {
    if (svc.migrating) {
      showStatus(statusEl, "⚠ Old password — visit the site and change it to the Keygrain-generated one.", statusTimerState);
    }
    const pw = await deriveForService(svc);
    svc.frecency = (svc.frecency || 0) * 0.95 + 1;
    await saveServices();
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (!tab) { showStatus(statusEl, "No active tab.", statusTimerState); return; }
      if (typeof browser !== "undefined" && browser.tabs?.executeScript) {
        await browser.tabs.executeScript(tab.id, {file: "content.js"});
      } else {
        await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["content.js"]});
      }
      const resp = await chrome.tabs.sendMessage(tab.id, {action: "fill", password: pw, email: svc.email});
      if (resp?.success) {
        const msgs = {both: "Credentials filled.", password_only: "Password filled.", username_only: "Username filled."};
        showStatus(statusEl, msgs[resp.filled] || "Filled.", statusTimerState);
      } else {
        showStatus(statusEl, resp?.error || "No fillable fields found.", statusTimerState);
      }
    } catch {
      showStatus(statusEl, "Couldn't fill. Try copying instead.", statusTimerState);
    }
  }

  // === Keyboard navigation ===

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
      if (e.key === "Escape") { closeDialog(settingsPanel, settingsState); e.preventDefault(); }
      return;
    }
    if (!addDialog.classList.contains("hidden")) {
      if (e.key === "Escape") { closeDialog(addDialog, addState); e.preventDefault(); }
      return;
    }
    if (!deleteDialog.classList.contains("hidden")) {
      if (e.key === "Escape") { closeDialog(deleteDialog, deleteState); deleteTarget = null; e.preventDefault(); }
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
      const filtered = getFilteredServices(services, searchInput.value.trim());
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
  document.getElementById("export-btn").addEventListener("click", async () => {
    menuDropdown.classList.add("hidden");
    try {
      const encKey = await deriveEncryptionKey(currentSecret, currentEmail);
      const json = JSON.stringify({version: 1, services, wallets, wallet_audit_log: walletAuditLog});
      const encrypted = await encryptBlob(encKey, new TextEncoder().encode(json));
      encKey.fill(0);
      exportToFile(encrypted, "keygrain-backup.keygrain");
      showStatus(statusEl, "Export started.", statusTimerState);
    } catch (e) {
      showStatus(statusEl, "Export failed: " + e.message, statusTimerState);
    }
  });

  document.getElementById("import-btn").addEventListener("click", async () => {
    menuDropdown.classList.add("hidden");
    await setEmail(currentEmail);
    chrome.tabs.create({url: "import.html"});
  });

  document.getElementById("migrate-btn").addEventListener("click", async () => {
    menuDropdown.classList.add("hidden");
    const data = await chrome.storage.local.get("migrationChecklist");
    const cl = data.migrationChecklist;
    const pending = cl ? cl.items.filter(i => i.status === "pending").length : 0;
    chrome.tabs.create({url: pending > 0 ? "migrate.html#checklist" : "migrate.html"});
  });

  document.getElementById("help-btn").addEventListener("click", () => {
    menuDropdown.classList.add("hidden");
    chrome.tabs.create({url: "help.html"});
  });

  document.getElementById("wallet-btn").addEventListener("click", () => {
    menuDropdown.classList.add("hidden");
    chrome.tabs.create({url: "wallet-page.html"});
  });

  // === Auto-lock warning ===
  function startAutolockWarning() {
    if (autolockPollTimer) return;
    autolockPollTimer = setInterval(async () => {
      const alarm = await chrome.alarms.get("autoLock");
      if (alarm && alarm.scheduledTime - Date.now() <= 60000) {
        autolockWarning.classList.remove("hidden");
      } else {
        autolockWarning.classList.add("hidden");
      }
    }, 5000);
  }

  function stopAutolockWarning() {
    if (autolockPollTimer) { clearInterval(autolockPollTimer); autolockPollTimer = null; }
    autolockWarning.classList.add("hidden");
  }

  autolockExtend.addEventListener("click", async () => {
    await sendMsg({action: "heartbeat"});
    autolockWarning.classList.add("hidden");
  });

  // === Auto-lock heartbeat ===
  document.addEventListener("click", () => sendMsg({action: "heartbeat"}));
  document.addEventListener("keydown", () => sendMsg({action: "heartbeat"}));

  // === Init ===
  // One-time migration: clear stale data from pre-Argon2id algorithm
  const migCheck = await chrome.storage.local.get("v2_migrated");
  if (!migCheck.v2_migrated) {
    await chrome.storage.local.set({v2_migrated: true});
  }

  await loadSettings();
  currentSecret = await getSecret();
  currentEmail = await getEmail();
  if (currentSecret && currentEmail) {
    let ok;
    try { ok = await loadServices(); } catch { ok = false; }
    if (ok) {
      const syncData = await chrome.storage.local.get(["lastSyncTime", "lastSyncError"]);
      lastSyncTime = syncData.lastSyncTime || null;
      lastSyncError = syncData.lastSyncError || null;
      showMainScreen();
      updateSyncIndicator();
      performAutoSync();
      await loadSiteRules();
      loadBreaches();
      autoDetectSite();
      updateMigrateBtn();
    } else {
      currentSecret = null;
      currentEmail = null;
      await clearSecret();
      await clearEmail();
      showLockScreen();
    }
  } else {
    // Pre-fill email from lastEmail
    const data = await chrome.storage.local.get(["lastEmail", "pinData", "onboardingDone"]);
    if (data.pinData && data.lastEmail) {
      showPinScreen();
    } else if (data.lastEmail) {
      emailInput.value = data.lastEmail;
      updateUnlockBtn();
      showLockScreen();
    } else {
      showLockScreen();
      // Show onboarding overlay on first install
      if (!data.onboardingDone) {
        const overlay = document.getElementById("onboarding-overlay");
        overlay.classList.remove("hidden");
        let step = 1;
        overlay.addEventListener("click", () => {
          document.getElementById("onboarding-step-" + step).classList.add("hidden");
          step++;
          if (step <= 3) {
            document.getElementById("onboarding-step-" + step).classList.remove("hidden");
          } else {
            overlay.classList.add("hidden");
            chrome.storage.local.set({ onboardingDone: true });
          }
        });
      }
    }
  }
  window.addEventListener("unload", () => { chrome.storage.local.set({popupActive: false}); });
})();
