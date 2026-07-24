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
  const versionDisplay = document.getElementById("version-display");

  // In-page autofill (Settings toggle + consent dialog)
  const inlineAutofillToggle = document.getElementById("inline-autofill-toggle");
  const inlineConsentDialog = document.getElementById("inline-consent-dialog");
  const inlineConsentCancel = document.getElementById("inline-consent-cancel");
  const inlineConsentConfirm = document.getElementById("inline-consent-confirm");

  // Keyboard shortcut section (Settings)
  const shortcutCurrent = document.getElementById("shortcut-current");
  const shortcutCurrentNote = document.getElementById("shortcut-current-note");
  const shortcutStepsEl = document.getElementById("shortcut-customize-steps");
  const shortcutOpenBtn = document.getElementById("shortcut-open-btn");
  const shortcutCopyBtn = document.getElementById("shortcut-copy-url");

  // Main-screen shortcut tip
  const shortcutTip = document.getElementById("shortcut-tip");
  const shortcutTipText = document.getElementById("shortcut-tip-text");
  const shortcutTipCustomize = document.getElementById("shortcut-tip-customize");
  const shortcutTipDismiss = document.getElementById("shortcut-tip-dismiss");

  // Reset DOM refs
  const resetBtn = document.getElementById("reset-btn");
  const resetDialog = document.getElementById("reset-dialog");
  const resetInput = document.getElementById("reset-input");
  const resetConfirmBtn = document.getElementById("reset-confirm-btn");
  const resetCancel = document.getElementById("reset-cancel");

  // Account management refs (offline mode / switch account / delete server data)
  const offlineBtn = document.getElementById("offline-btn");
  const switchAccountBtn = document.getElementById("switch-account-btn");
  const switchAccountLock = document.getElementById("switch-account-lock");
  const switchAccountDialog = document.getElementById("switch-account-dialog");
  const switchAccountCancel = document.getElementById("switch-account-cancel");
  const switchAccountConfirm = document.getElementById("switch-account-confirm");
  const deleteServerBtn = document.getElementById("delete-server-btn");
  const deleteServerDialog = document.getElementById("delete-server-dialog");
  const deleteServerKeepLocal = document.getElementById("delete-server-keep-local");
  const deleteServerSubtext = document.getElementById("delete-server-subtext");
  const deleteServerError = document.getElementById("delete-server-error");
  const deleteServerCancel = document.getElementById("delete-server-cancel");
  const deleteServerConfirm = document.getElementById("delete-server-confirm");

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
  // When true, the service list is scoped to the auto-detected current site
  // (filterMostSpecific) instead of the fuzzy search. Persists across re-renders
  // (sync/add/edit/delete/rotate) until the user manually searches or clears.
  let siteScopeActive = false;
  // The exact array most recently rendered into the list, so keyboard Enter
  // fills the row actually shown (not a recomputed fuzzy list).
  let renderedServices = [];
  let settings = {autoLockMinutes: 15, defaultLength: 20, defaultSymbols: "!@#$%&*-_=+?", serverUrl: "https://keygrain.com"};
  let isDemoMode = false;
  let offlineMode = false;
  let deleteServerInProgress = false;
  const isFirefox = (typeof browser !== "undefined" && !!browser.storage) || /firefox/i.test(navigator.userAgent || "");
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent || "");
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
  let sessionPrivKeyConfirmed = false;

  const autolockWarning = document.getElementById("autolock-warning");
  const autolockExtend = document.getElementById("autolock-extend");

  const siteSuggestion = document.getElementById("site-suggestion");
  const quickFill = document.getElementById("quick-fill");
  const breachWarnings = document.getElementById("breach-warnings");
  const conflictBanner = document.getElementById("conflict-banner");

  // === Focus trap ===
  let settingsState = null;
  let resetState = null;
  let addState = null;
  let deleteState = null;
  let inlineConsentState = null;
  let switchAccountState = null;
  let deleteServerState = null;

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



  // === Private key confirmation dialog ===
  function showPrivKeyConfirmDialog() {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "privkey-confirm-overlay";
      const dialog = document.createElement("div");
      dialog.className = "privkey-confirm-dialog";
      dialog.setAttribute("role", "alertdialog");
      dialog.setAttribute("aria-labelledby", "privkey-confirm-title");
      dialog.setAttribute("aria-describedby", "privkey-confirm-desc");
      dialog.innerHTML = '<h3 id="privkey-confirm-title">Export private key?</h3>' +
        '<p id="privkey-confirm-desc">Private keys are sensitive. The key will be copied to your clipboard.</p>' +
        '<div class="privkey-confirm-actions">' +
        '<button class="privkey-confirm-cancel">Cancel</button>' +
        '<button class="privkey-confirm-ok">Copy to clipboard</button></div>';
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      const cancel = dialog.querySelector(".privkey-confirm-cancel");
      const ok = dialog.querySelector(".privkey-confirm-ok");
      function cleanup(result) { overlay.remove(); resolve(result); }
      cancel.addEventListener("click", () => cleanup(false));
      ok.addEventListener("click", () => cleanup(true));
      overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(false); });
      dialog.addEventListener("keydown", (e) => { if (e.key === "Escape") cleanup(false); });
      ok.focus();
    });
  }

  // === Helpers ===

  const SVG_INFO = "M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.75 12h-1.5V7h1.5v5zm0-6.5h-1.5V4h1.5v1.5z";
  const SVG_WARNING = "M8.56 1.69a.63.63 0 0 0-1.12 0L.34 14.03A.63.63 0 0 0 .9 15h14.2a.63.63 0 0 0 .56-.97L8.56 1.69zM8 12.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM7.25 6h1.5v4h-1.5V6z";
  const SVG_ROTATE = "M13.65 2.35A7.96 7.96 0 0 0 8 0C3.58 0 0 3.58 0 8s3.58 8 8 8a7.99 7.99 0 0 0 7.56-5.34h-2.03A6 6 0 1 1 8 2a5.98 5.98 0 0 1 4.24 1.76L9 7h7V0l-2.35 2.35z";
  const SVG_CHECK = "M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm3.35 6.35l-4 4a.5.5 0 0 1-.7 0l-2-2a.5.5 0 1 1 .7-.7L7 9.29l3.65-3.64a.5.5 0 1 1 .7.7z";

  function createSvgIcon(pathD, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("fill", "currentColor");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", pathD);
    svg.appendChild(p);
    return svg;
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get("settings");
    if (data.settings) Object.assign(settings, data.settings);
  }

  async function loadOfflineMode() {
    const data = await chrome.storage.local.get("offlineMode");
    offlineMode = !!data.offlineMode;
  }

  // Account-scoped storage keys wiped by Switch account and the delete-local
  // branch of Delete server data. Device/config keys (settings, onboardingDone,
  // inlineAutofillEnabled, siteRules, breachFeed, shortcutHintDismissed,
  // v2_migrated) are intentionally preserved. This differs from Reset Keygrain,
  // which clears everything.
  const ACCOUNT_SCOPED_KEYS = [
    "services", "syncKnownUUIDs", "syncKnownWalletKeys", "syncMetadataCache",
    "syncConflicts", "conflictsDismissed", "lastSyncTime", "lastSyncError",
    "syncRetryState", "aadEnabled", "pinData", "pinFailCount", "lastEmail",
    "dismissedBreaches", "migrationChecklist", "offlineMode", "popupActive"
  ];

  // Wipe all account-scoped data on this device and reset in-memory state. Shared
  // by Switch account and the delete-local branch of Delete server data. Never
  // touches the server.
  async function wipeLocalAccountData() {
    isDemoMode = false;
    demoBanner.classList.add("hidden");
    stopAutolockWarning();
    stopTOTPInterval();
    if (syncDebounceTimer) { clearTimeout(syncDebounceTimer); syncDebounceTimer = null; }
    syncInProgress = false;
    syncGeneration++;
    if (syncIndicatorInterval) { clearInterval(syncIndicatorInterval); syncIndicatorInterval = null; }
    await clearSecret();
    await clearEmail();
    await chrome.storage.local.remove(ACCOUNT_SCOPED_KEYS);
    clearStrengthenCache();
    try { await navigator.clipboard.writeText(""); } catch (_) {}
    currentSecret = null;
    currentEmail = null;
    services = [];
    wallets = [];
    walletAuditLog = [];
    offlineMode = false;
    lastSyncTime = null;
    lastSyncError = null;
  }

  async function performSwitchAccount() {
    await wipeLocalAccountData();
    showLockScreen();
  }

  // Reveal the lock-screen "Use a different account" affordance only when this
  // device already holds an account's local data (so it is actionable). Called
  // (fire-and-forget) from showLockScreen.
  async function updateSwitchAccountLink() {
    try {
      const data = await chrome.storage.local.get("services");
      const hasLocal = !!(data.services && (data.services.version === 1 || data.services.version === 2));
      switchAccountLock.classList.toggle("hidden", !hasLocal);
    } catch { switchAccountLock.classList.add("hidden"); }
  }

  function updateOfflineBtn() {
    offlineBtn.setAttribute("aria-checked", String(offlineMode));
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
    // Re-evaluate the shortcut tip after breach content is (or isn't) rendered,
    // chained off loadBreaches' completion so breach suppression is honored.
    await renderShortcutTip();
  }

  function renderBreachWarnings(matched) {
    breachWarnings.textContent = "";
    const visible = matched.slice(0, 3);
    const remaining = matched.length - visible.length;
    visible.forEach(b => {
      const div = document.createElement("div");
      div.className = "breach-banner " + b.severity;
      div.setAttribute("tabindex", "0");
      const dateStr = new Date(b.date + "T00:00:00").toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"});
      const headline = document.createElement("div");
      headline.className = "breach-headline";
      headline.appendChild(createSvgIcon(b.severity === "info" ? SVG_INFO : SVG_WARNING, "icon"));
      headline.append(" " + b.domain + " was breached (" + dateStr + ")");
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
          const dateStr = new Date(b.date + "T00:00:00").toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"});
          const headline = document.createElement("div");
          headline.className = "breach-headline";
          headline.appendChild(createSvgIcon(b.severity === "info" ? SVG_INFO : SVG_WARNING, "icon"));
          headline.append(" " + b.domain + " was breached (" + dateStr + ")");
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
        btn.appendChild(createSvgIcon(SVG_ROTATE, "icon"));
        btn.append(" Rotate all affected (" + affectedIndices.size + ")");
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
          summary.appendChild(createSvgIcon(SVG_CHECK, "icon"));
          summary.append(" Rotated " + affectedIndices.size + " password" + (affectedIndices.size > 1 ? "s" : "") + ". Update them on each site.");
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
    // Single choke point (RH2): notify the background to re-diff the inline
    // registration whenever the service list is persisted (incl. sync merges).
    sendMsg({action: "reregisterInlineAutofill"}).catch(() => {});
    syncGeneration++;
    if (skipNextDebounce) { skipNextDebounce = false; return; }
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(performAutoSync, 5000);
  }

  // === Background sync ===
  async function performAutoSync() {
    if (isDemoMode || syncInProgress || !currentSecret || offlineMode || deleteServerInProgress) return;
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
      if (!serviceList.querySelector(".password-display")) renderServiceList();
      lastSyncTime = Date.now();
      lastSyncError = null;
      await chrome.storage.local.set({lastSyncTime, lastSyncError: null});
      await chrome.storage.local.remove("syncRetryState");
      renderConflictBanner();
    } catch (e) {
      const msg = e.message;
      let errorObj;
      if (e instanceof MetadataTamperError) {
        errorObj = {type: "integrity", message: "Data integrity error. Please contact support."};
      } else if (msg === "rate_limited") {
        errorObj = {type: "rate_limited", message: "Rate limited. Retrying soon.", retryAfter: e.retryAfter || 60};
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
      if (errorObj.type === "network" || errorObj.type === "server" || errorObj.type === "rate_limited") {
        sendMsg({action: "scheduleSyncRetry", errorType: errorObj.type, retryAfter: errorObj.retryAfter});
      }
    } finally {
      syncInProgress = false;
      updateSyncIndicator();
    }
  }



  function updateSyncIndicator() {
    if (offlineMode) {
      syncIndicator.classList.remove("hidden");
      syncTimeEl.textContent = "Offline";
      syncErrorEl.classList.add("hidden");
      return;
    }
    if (lastSyncError) {
      chrome.storage.local.get("syncRetryState", (data) => {
        const status = computeSyncStatus(syncInProgress, lastSyncError, lastSyncTime, data.syncRetryState);
        syncIndicator.classList.toggle("hidden", !status.visible);
        syncTimeEl.textContent = status.text;
        syncErrorEl.classList.toggle("hidden", !status.errorHtml);
        if (status.errorText) {
          syncErrorEl.textContent = "";
          syncErrorEl.appendChild(createSvgIcon(SVG_WARNING, "icon"));
          syncErrorEl.append(" " + status.errorText);
        }
      });
    } else {
      const status = computeSyncStatus(syncInProgress, lastSyncError, lastSyncTime, null);
      syncIndicator.classList.toggle("hidden", !status.visible);
      syncTimeEl.textContent = status.text;
      syncErrorEl.classList.toggle("hidden", !status.errorHtml);
      if (status.errorText) {
        syncErrorEl.textContent = "";
        syncErrorEl.appendChild(createSvgIcon(SVG_WARNING, "icon"));
        syncErrorEl.append(" " + status.errorText);
      }
    }
  }

  async function renderConflictBanner() {
    const data = await chrome.storage.local.get("syncConflicts");
    const conflicts = data.syncConflicts || [];
    if (conflicts.length === 0) { conflictBanner.classList.add("hidden"); return; }
    conflictBanner.className = "conflict-banner";
    conflictBanner.innerHTML = "";
    const text = document.createElement("span");
    text.className = "conflict-text";
    text.textContent = "\u26A0 " + conflicts.length + " sync conflict" + (conflicts.length > 1 ? "s" : "") + " detected (duplicate entries with different settings)";
    const dismiss = document.createElement("button");
    dismiss.className = "conflict-dismiss";
    dismiss.textContent = "\u00D7";
    dismiss.setAttribute("aria-label", "Dismiss sync conflicts");
    dismiss.addEventListener("click", async () => {
      await chrome.storage.local.set({syncConflicts: [], conflictsDismissed: true});
      conflictBanner.classList.add("hidden");
      syncGeneration++;
    });
    conflictBanner.appendChild(text);
    conflictBanner.appendChild(dismiss);
  }


  // === Keyboard shortcut discoverability ===
  async function getCurrentShortcut() {
    // Live, platform-correct value the browser currently has bound. Any failure
    // (API absent on old engines, or rejection) collapses to "" → "Not set".
    try {
      return pickShortcut(await chrome.commands.getAll());
    } catch {
      return "";
    }
  }

  async function renderShortcutSettings() {
    const info = shortcutCustomizeInfo(isFirefox);
    // Rebuild the steps list idempotently: clear, then one <li> per step via
    // textContent (no innerHTML, no accumulation across reopens).
    shortcutStepsEl.textContent = "";
    info.steps.forEach(step => {
      const li = document.createElement("li");
      li.textContent = step;
      shortcutStepsEl.appendChild(li);
    });
    // Auto-open button only where the engine supports it (Chromium). Toggled
    // synchronously from the sync method so the focus trap never sees a
    // transient state before the await below resolves.
    shortcutOpenBtn.classList.toggle("hidden", info.method !== "tabs");
    // Current shortcut — never empty. Stays "Not set" until the live value
    // resolves, then shows the verbatim label (or "Not set" if unbound).
    shortcutCurrent.textContent = "Not set";
    const shortcut = await getCurrentShortcut();
    const hint = shortcutHintText({shortcut, isMac});
    shortcutCurrent.textContent = hint.isSet ? hint.label : "Not set";
    shortcutCurrentNote.classList.toggle("hidden", hint.isSet);
  }

  function openShortcutCustomize() {
    const info = shortcutCustomizeInfo(isFirefox);
    if (info.method === "tabs") {
      // Best-effort convenience only. The steps + copyable URL stay visible
      // regardless of outcome (some Chromium forks open a blocked tab without
      // throwing), so a stranded user always has the manual path.
      try { chrome.tabs.create({url: info.url}); } catch (_) {}
    }
  }

  async function renderShortcutTip() {
    // Idempotent: only toggles hidden + sets textContent (no listeners, no
    // element creation), so it is safe to call multiple times per render.
    const data = await chrome.storage.local.get("shortcutHintDismissed");
    const shortcut = await getCurrentShortcut();
    // Re-evaluate suppression AFTER the awaits so it reflects the freshest
    // banner state at write time (banners load async, after showMainScreen).
    const suppressed = data.shortcutHintDismissed
      || breachWarnings.children.length > 0
      || !pinSetupBanner.classList.contains("hidden")
      || !demoBanner.classList.contains("hidden");
    if (suppressed) { shortcutTip.classList.add("hidden"); return; }
    const hint = shortcutHintText({shortcut, isMac});
    shortcutTipText.textContent = hint.isSet
      ? "Fill without opening Keygrain \u2014 press " + hint.label + " for the current site (with a one-time-code field focused it fills your 2FA code), or right-click a field and choose \"Fill with Keygrain\"."
      : "Fill without opening Keygrain \u2014 set a keyboard shortcut for the current site, or right-click a field and choose \"Fill with Keygrain\".";
    shortcutTip.classList.remove("hidden");
  }

  async function dismissShortcutTip() {
    shortcutTip.classList.add("hidden");
    await chrome.storage.local.set({shortcutHintDismissed: true});
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
    updateSwitchAccountLink();
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
    renderConflictBanner();
    updateOfflineBtn();
    if (!syncIndicatorInterval) {
      syncIndicatorInterval = setInterval(updateSyncIndicator, 1000);
    }
    renderShortcutTip();
  }

  function renderServiceList() {
    serviceList.textContent = "";
    focusedIndex = -1;
    searchInput.removeAttribute("aria-activedescendant");
    const filter = searchInput.value.trim();
    const filtered = (siteScopeActive && currentHostname)
      ? KeygrainAutofill.filterMostSpecific(services, currentHostname.toLowerCase())
      : getFilteredServices(services, filter);
    // Set before any early-return so Enter never indexes a stale rendered list.
    renderedServices = filtered;
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
        totpRow.dataset.totpRevealed = "false";
        const revealBtn = document.createElement("button");
        revealBtn.className = "totp-reveal-btn";
        revealBtn.title = "Show TOTP";
        revealBtn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3C4.36 3 1.26 5.28 0 8.5c1.26 3.22 4.36 5.5 8 5.5s6.74-2.28 8-5.5C14.74 5.28 11.64 3 8 3zm0 9.17a3.67 3.67 0 1 1 0-7.34 3.67 3.67 0 0 1 0 7.34zM8 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>';
        revealBtn.setAttribute("aria-label", "Show TOTP code for " + svc.name);
        revealBtn.addEventListener("click", async () => {
          const revealed = totpRow.dataset.totpRevealed === "true";
          totpRow.dataset.totpRevealed = String(!revealed);
          if (!revealed) {
            try {
              const {code} = await getTOTPCode(svc, currentSecret);
              const formatted = code.length === 8 ? code.slice(0, 4) + " " + code.slice(4) : code.slice(0, 3) + " " + code.slice(3);
              codeSpan.textContent = formatted;
            } catch { codeSpan.textContent = "Error"; }
            revealBtn.setAttribute("aria-label", "Hide TOTP code for " + svc.name);
          } else {
            codeSpan.textContent = "\u2022\u2022\u2022\u2022\u2022\u2022";
            revealBtn.setAttribute("aria-label", "Show TOTP code for " + svc.name);
          }
        });
        const codeSpan = document.createElement("span");
        codeSpan.className = "totp-code";
        codeSpan.textContent = "\u2022\u2022\u2022\u2022\u2022\u2022";
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
            if (clearTimer) clearTimeout(clearTimer);
            clearTimer = setTimeout(async () => {
              try { await navigator.clipboard.writeText(""); } catch (_) {}
            }, 30000);
            showStatus(statusEl, "TOTP copied", statusTimerState);
          } catch (e) { showStatus(statusEl, "TOTP error: " + e.message, statusTimerState); }
        });
        totpRow.appendChild(revealBtn);
        totpRow.appendChild(codeSpan);
        totpRow.appendChild(countdown);
        totpRow.appendChild(copyTotpBtn);
        const fillTotpBtn = document.createElement("button");
        fillTotpBtn.title = "Fill one-time code";
        fillTotpBtn.className = "totp-fill-btn";
        fillTotpBtn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6V2z"/></svg> Fill code';
        fillTotpBtn.setAttribute("aria-label", "Fill one-time code for " + svc.name);
        fillTotpBtn.addEventListener("click", () => handleFillOtp(svc));
        totpRow.appendChild(fillTotpBtn);
        if (svc.totp.mode === "derived") {
          const copySeedBtn = document.createElement("button");
          copySeedBtn.title = "Copy TOTP seed (base32)";
          copySeedBtn.className = "totp-copy-seed-btn";
          copySeedBtn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a4 4 0 0 0-4 4v3H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm2 7V5a2 2 0 1 0-4 0v3h4z"/></svg> Copy seed';
          copySeedBtn.setAttribute("aria-label", "Copy TOTP seed for " + svc.name);
          copySeedBtn.addEventListener("click", async () => {
            try {
              const seed = await deriveTOTPSeed(currentSecret, svc.email, svc.site);
              const base32 = seedToBase32(seed);
              seed.fill(0);
              await navigator.clipboard.writeText(base32);
              if (clearTimer) clearTimeout(clearTimer);
              clearTimer = setTimeout(async () => {
                try { await navigator.clipboard.writeText(""); } catch (_) {}
              }, 30000);
              showStatus(statusEl, "TOTP seed copied", statusTimerState);
            } catch (e) { showStatus(statusEl, "Seed error: " + e.message, statusTimerState); }
          });
          totpRow.appendChild(copySeedBtn);
        }
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

        // Private key export button (separate row)
        const sshPrivRow = document.createElement("div");
        sshPrivRow.className = "ssh-privkey-row";
        const exportBtn = document.createElement("button");
        exportBtn.className = "ssh-privkey-btn";
        exportBtn.title = "Export SSH private key to clipboard";
        exportBtn.innerHTML = '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a4 4 0 0 0-4 4c0 1.2.5 2.3 1.4 3l-.4.5V10a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V8.5l-.4-.5A4 4 0 0 0 8 1zm0 2a2 2 0 0 1 2 2 2 2 0 0 1-.6 1.4l-.4.4V9H7V6.8l-.4-.4A2 2 0 0 1 6 5a2 2 0 0 1 2-2z"/><rect x="6" y="12" width="4" height="1" rx=".5"/><rect x="6.5" y="14" width="3" height="1" rx=".5"/></svg> Export private key';
        exportBtn.setAttribute("aria-label", "Export SSH private key for " + svc.name);
        exportBtn.addEventListener("click", async () => {
          try {
            if (!sessionPrivKeyConfirmed) {
              const confirmed = await showPrivKeyConfirmDialog();
              if (!confirmed) return;
              sessionPrivKeyConfirmed = true;
            }
            const kp = await deriveSshKeypair(currentSecret, svc.email, {keyName: svc.ssh.key_name, counter: svc.ssh.counter || 1});
            const comment = svc.email.toLowerCase() + ":" + svc.ssh.key_name.toLowerCase();
            const pem = await formatOpensshPrivateKey(kp.seed, kp.publicKey, comment);
            kp.seed.fill(0);
            await navigator.clipboard.writeText(pem);
            if (clearTimer) clearTimeout(clearTimer);
            clearTimer = setTimeout(async () => {
              try { await navigator.clipboard.writeText(""); } catch (_) {}
            }, 30000);
            showStatus(statusEl, "Private key copied", statusTimerState);
          } catch (e) { showStatus(statusEl, "SSH error: " + e.message, statusTimerState); }
        });
        sshPrivRow.appendChild(exportBtn);
        row.appendChild(sshPrivRow);
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
        const period = svc.totp.period || 30;
        row.querySelector(".totp-countdown-bar").style.width = (remaining / period * 100) + "%";
        if (row.dataset.totpRevealed === "true") {
          const formatted = code.length === 8
            ? code.slice(0, 4) + " " + code.slice(4)
            : code.slice(0, 3) + " " + code.slice(3);
          row.querySelector(".totp-code").textContent = formatted;
        }
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
    const matches = KeygrainAutofill.filterMostSpecific(services, host);
    if (matches.length > 0) {
      siteScopeActive = true;
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
      siteScopeActive = false;
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
      } catch (e) { fpContainer.textContent = ""; }
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
      // Distinguish a typo from an intentional attempt to use a *different*
      // account. If a local (encrypted) account already exists on this device,
      // the entered credentials simply don't match it — tell the user plainly
      // and surface the switch-account affordance instead of a dead-end error.
      let hasLocal = false;
      try {
        const data = await chrome.storage.local.get("services");
        hasLocal = !!(data.services && (data.services.version === 1 || data.services.version === 2));
      } catch { /* ignore */ }
      if (hasLocal) {
        showStatus(statusEl, "That email and secret don\u2019t match the account saved on this device. Check for typos \u2014 or, to set up a different account, choose \u201CUse a different account\u201D below.", statusTimerState, 8000);
        switchAccountLock.classList.remove("hidden");
      } else {
        showStatus(statusEl, "Wrong secret or email. Please try again.", statusTimerState);
      }
      currentSecret = null;
      currentEmail = null;
      return;
    }
    // If no local services, try fetching from server (returning user on new
    // device?). Skipped in offline mode — offline means "don't touch the server".
    if (services.length === 0 && !offlineMode) {
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
    // Re-evaluate the tip after the pin-setup banner decision so it is suppressed
    // on the common first-unlock-without-PIN path.
    renderShortcutTip();
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
    chrome.storage.local.get("inlineAutofillEnabled").then(d => { inlineAutofillToggle.checked = !!d.inlineAutofillEnabled; }).catch(() => {});
    settingsState = openDialog(settingsPanel);
    versionDisplay.textContent = "Keygrain v" + chrome.runtime.getManifest().version;
    renderShortcutSettings();
  });

  // Shortcut customize controls — listeners attached ONCE (render only updates content)
  shortcutOpenBtn.addEventListener("click", openShortcutCustomize);
  shortcutCopyBtn.addEventListener("click", async () => {
    const info = shortcutCustomizeInfo(isFirefox);
    try {
      await navigator.clipboard.writeText(info.url);
      showStatus(statusEl, "Copied " + info.url, statusTimerState);
    } catch {
      showStatus(statusEl, "Copy failed", statusTimerState);
    }
  });

  // Main-screen tip controls — listeners attached ONCE (render only toggles/sets text)
  shortcutTipDismiss.addEventListener("click", dismissShortcutTip);
  shortcutTipCustomize.addEventListener("click", () => {
    settingsBtn.click(); // reuse the exact Settings open path (populates + renderShortcutSettings)
    const section = document.getElementById("shortcut-section");
    if (section) section.scrollIntoView({block: "nearest"});
    shortcutCopyBtn.focus(); // always-visible control (open-btn is hidden on Firefox)
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
    if (length > 128) { showStatus(statusEl, "Length must not exceed 128.", statusTimerState); return; }
    if (!symbols) { showStatus(statusEl, "At least one symbol is required.", statusTimerState); return; }
    if (24 + 24 + 8 + symbols.length > 256) { showStatus(statusEl, "Symbol charset too long (max " + (256 - 24 - 24 - 8) + " characters).", statusTimerState); return; }
    if (!url.startsWith("https://")) { showStatus(statusEl, "Server URL must start with https://", statusTimerState); return; }
    settings = {autoLockMinutes: timeout, defaultLength: length, defaultSymbols: symbols, serverUrl: url};
    await chrome.storage.local.set({settings});
    closeDialog(settingsPanel, settingsState);
    showStatus(statusEl, "Settings saved.", statusTimerState);
  });

  // === In-page autofill toggle + consent ===
  inlineAutofillToggle.addEventListener("change", () => {
    if (inlineAutofillToggle.checked) {
      // Turning ON: show the consent dialog FIRST. No permission is requested
      // until the user clicks "Turn on" (a fresh, explicit gesture).
      inlineConsentState = openDialog(inlineConsentDialog);
      // Move focus into the consent dialog so ITS focus trap governs (the dialogs
      // are siblings; without this, focus would stay on the toggle inside the
      // settings panel and Tab would cycle the settings trap). "Not now" is the
      // safe default (an accidental Enter dismisses rather than grants).
      inlineConsentCancel.focus();
    } else {
      onInlineToggleOff();
    }
  });

  inlineConsentCancel.addEventListener("click", () => {
    inlineAutofillToggle.checked = false;
    closeDialog(inlineConsentDialog, inlineConsentState);
  });

  inlineConsentConfirm.addEventListener("click", async () => {
    // The permission request MUST be the FIRST statement (no await before it) or
    // the user-gesture token is lost and chrome.permissions.request throws.
    const granted = await chrome.permissions.request({origins: ["*://*/*"]});
    if (!granted) {
      inlineAutofillToggle.checked = false;
      closeDialog(inlineConsentDialog, inlineConsentState);
      showStatus(statusEl, "No problem — you can turn this on later.", statusTimerState);
      return;
    }
    await chrome.storage.local.set({inlineAutofillEnabled: true});
    await sendMsg({action: "inlineAutofillEnabledChanged", enabled: true});
    closeDialog(inlineConsentDialog, inlineConsentState);
    showStatus(statusEl, "In-page autofill is on.", statusTimerState);
  });

  async function onInlineToggleOff() {
    await chrome.permissions.remove({origins: ["*://*/*"]});
    await chrome.storage.local.set({inlineAutofillEnabled: false});
    await sendMsg({action: "inlineAutofillEnabledChanged", enabled: false});
    showStatus(statusEl, "In-page autofill turned off.", statusTimerState);
  }

  searchInput.addEventListener("input", () => {
    siteScopeActive = false;
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

  // === Offline mode ===
  offlineBtn.addEventListener("click", async () => {
    menuDropdown.classList.add("hidden");
    if (isDemoMode) { showStatus(statusEl, "Not available in demo mode.", statusTimerState); return; }
    offlineMode = !offlineMode;
    await chrome.storage.local.set({offlineMode});
    updateOfflineBtn();
    updateSyncIndicator();
    // Turning offline OFF resumes syncing so local data is pushed back up.
    if (!offlineMode) performAutoSync();
    showStatus(statusEl, offlineMode ? "Offline mode on \u2014 sync paused." : "Offline mode off \u2014 syncing.", statusTimerState);
  });

  // === Switch account ===
  switchAccountBtn.addEventListener("click", () => {
    menuDropdown.classList.add("hidden");
    if (isDemoMode) { showStatus(statusEl, "Not available in demo mode.", statusTimerState); return; }
    switchAccountState = openDialog(switchAccountDialog, menuBtn);
    switchAccountCancel.focus();
  });

  switchAccountLock.addEventListener("click", (e) => {
    e.preventDefault();
    switchAccountState = openDialog(switchAccountDialog, switchAccountLock);
    switchAccountCancel.focus();
  });

  switchAccountCancel.addEventListener("click", () => closeDialog(switchAccountDialog, switchAccountState));

  switchAccountConfirm.addEventListener("click", async () => {
    closeDialog(switchAccountDialog, switchAccountState);
    await performSwitchAccount();
    showStatus(statusEl, "Account switched. Enter a different email and master secret.", statusTimerState);
  });

  // === Delete server data ===
  function renderDeleteServerSubtext() {
    deleteServerSubtext.textContent = deleteServerKeepLocal.checked
      ? "Your data stays on this device in offline mode. It\u2019s removed from the server, but you can restore it later by turning Offline mode off to sync again."
      : "Your data will also be permanently erased from this device.";
  }

  deleteServerKeepLocal.addEventListener("change", renderDeleteServerSubtext);

  deleteServerBtn.addEventListener("click", () => {
    menuDropdown.classList.add("hidden");
    if (isDemoMode) { showStatus(statusEl, "Not available in demo mode.", statusTimerState); return; }
    deleteServerError.classList.add("hidden");
    deleteServerError.textContent = "";
    deleteServerKeepLocal.checked = true;
    deleteServerInProgress = false;
    deleteServerConfirm.disabled = false;
    deleteServerCancel.disabled = false;
    deleteServerKeepLocal.disabled = false;
    renderDeleteServerSubtext();
    deleteServerState = openDialog(deleteServerDialog, menuBtn);
    deleteServerCancel.focus();
  });

  deleteServerCancel.addEventListener("click", () => {
    if (deleteServerInProgress) return;
    closeDialog(deleteServerDialog, deleteServerState);
  });

  deleteServerConfirm.addEventListener("click", async () => {
    if (deleteServerInProgress || isDemoMode || !currentSecret || !currentEmail) return;
    deleteServerInProgress = true;
    deleteServerError.classList.add("hidden");
    deleteServerConfirm.disabled = true;
    deleteServerCancel.disabled = true;
    deleteServerKeepLocal.disabled = true;
    const keepLocal = deleteServerKeepLocal.checked;
    // Race guards so nothing recreates the record we're deleting:
    //  (a) bump syncGeneration to void any in-flight popup sync's write-back;
    //  (b) clear the pending debounced sync;
    //  (c) go offline in storage BEFORE the network call — the service-worker
    //      backgroundSync is gated ONLY by offlineMode, so this stops it from
    //      GET-404 -> PUT re-creating the record. deleteServerInProgress guards
    //      the popup's own performAutoSync.
    // The prior offline flag is restored on any non-confirmed outcome, so a
    // failed delete leaves state unchanged (Invariant #1).
    syncGeneration++;
    if (syncDebounceTimer) { clearTimeout(syncDebounceTimer); syncDebounceTimer = null; }
    const prevOffline = offlineMode;
    offlineMode = true;
    await chrome.storage.local.set({offlineMode: true});
    updateOfflineBtn();
    updateSyncIndicator();
    try {
      const result = await deleteServerData(currentSecret, currentEmail);
      // SAFETY (Invariant #1): only a confirmed delete (200/404) wipes/keeps state.
      if (result.ok) {
        if (keepLocal) {
          // offlineMode is already true + persisted — keep the data on-device.
          closeDialog(deleteServerDialog, deleteServerState);
          showStatus(statusEl, "Server data deleted. Your data is still on this device \u2014 turn Offline mode off to sync again.", statusTimerState, 6000);
        } else {
          closeDialog(deleteServerDialog, deleteServerState);
          await performSwitchAccount();  // wipes local (also resets offlineMode)
          showStatus(statusEl, "Server and local data deleted.", statusTimerState);
        }
      } else {
        // Nothing changed on the server — restore the prior offline flag.
        offlineMode = prevOffline;
        await chrome.storage.local.set({offlineMode: prevOffline});
        updateOfflineBtn();
        updateSyncIndicator();
        const messages = {
          auth: "Couldn\u2019t verify your account. Nothing was changed.",
          rate_limited: "Too many requests. Wait a moment and try again. Nothing was changed.",
          server: "Couldn\u2019t reach the server. Nothing was changed \u2014 please try again.",
          network: "Couldn\u2019t reach the server. Nothing was changed \u2014 please try again."
        };
        deleteServerError.textContent = messages[result.result] || "Something went wrong. Nothing was changed.";
        deleteServerError.classList.remove("hidden");
      }
    } catch (e) {
      // Fail-closed: any unexpected throwable leaves everything untouched.
      offlineMode = prevOffline;
      await chrome.storage.local.set({offlineMode: prevOffline});
      updateOfflineBtn();
      updateSyncIndicator();
      deleteServerError.textContent = "Something went wrong. Nothing was changed \u2014 please try again.";
      deleteServerError.classList.remove("hidden");
    } finally {
      deleteServerInProgress = false;
      deleteServerConfirm.disabled = false;
      deleteServerCancel.disabled = false;
      deleteServerKeepLocal.disabled = false;
    }
  });

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
    if (length > 128) { showStatus(statusEl, "Length must not exceed 128.", statusTimerState); return; }
    const symbols = addSymbols.value;
    if (!symbols) { showStatus(statusEl, "At least one symbol is required.", statusTimerState); return; }
    if (24 + 24 + 8 + symbols.length > 256) { showStatus(statusEl, "Symbol charset too long (max " + (256 - 24 - 24 - 8) + " characters).", statusTimerState); return; }
    // Duplicate check: same (site, email) pair must not exist
    const normalizedSite = normalizeSite(site);
    const emailLower = email.toLowerCase();
    const duplicate = services.some((s, i) => i !== editIndex && normalizeSite(s.site) === normalizedSite && s.email.toLowerCase() === emailLower);
    if (duplicate) { showStatus(statusEl, "A service with that site and email already exists.", statusTimerState); return; }
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
      document.getElementById("add-totp-section").open = true;
      addTotpMode.value = svc.totp.mode;
      originalTotpSeed = svc.totp.mode === "stored" ? (svc.totp.seed || "") : "";
      addTotpSeed.value = originalTotpSeed;
      addTotpSeedGroup.classList.toggle("hidden", svc.totp.mode === "derived");
    } else {
      document.getElementById("add-totp-section").open = false;
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
    showStatus(statusEl, "Copied!", statusTimerState);
    svc.frecency = (svc.frecency || 0) * 0.95 + 1;
    await saveServices();
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(async () => {
      try { await navigator.clipboard.writeText(""); } catch (_) {}
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
      // autofill.js MUST load before content.js: content.js (performFill/getFillContext) calls KeygrainAutofill, which autofill.js defines. Do not remove — mirrors the background inject + handleFillOtp.
      if (typeof browser !== "undefined" && browser.tabs?.executeScript) {
        await browser.tabs.executeScript(tab.id, {file: "autofill.js"});
        await browser.tabs.executeScript(tab.id, {file: "content.js"});
      } else {
        await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["autofill.js", "content.js"]});
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

  // Fill one-time code. Mirrors handleFill's inject+send, but derives the CURRENT code
  // (getTOTPCode; the popup already holds the secret to display it) and AWAITS content.js's
  // {filled,reason,max} for an honest status. Injects ["autofill.js","content.js"]:
  // performOtpFill needs KeygrainAutofill (decision driver-d-001 / FLAG 2) — do NOT reduce
  // to content.js-only or it ReferenceErrors when autofill.js isn't already in the page.
  // No frecency/saveServices (D6 omits it). Only the derived code crosses; no auto-submit.
  async function handleFillOtp(svc) {
    try {
      const {code} = await getTOTPCode(svc, currentSecret);
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (!tab) { showStatus(statusEl, "No active tab.", statusTimerState); return; }
      if (typeof browser !== "undefined" && browser.tabs?.executeScript) {
        await browser.tabs.executeScript(tab.id, {file: "autofill.js"});
        await browser.tabs.executeScript(tab.id, {file: "content.js"});
      } else {
        await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["autofill.js", "content.js"]});
      }
      const resp = await chrome.tabs.sendMessage(tab.id, {action: "fillOtp", code});
      if (resp && resp.filled) {
        showStatus(statusEl, "Code filled.", statusTimerState);
      } else if (resp && resp.reason === "field_too_small") {
        showStatus(statusEl, "This field only accepts " + resp.max + " digits.", statusTimerState);
      } else {
        showStatus(statusEl, "No one-time-code field found.", statusTimerState);
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
    if (!switchAccountDialog.classList.contains("hidden")) {
      if (e.key === "Escape") { closeDialog(switchAccountDialog, switchAccountState); e.preventDefault(); }
      return;
    }
    if (!deleteServerDialog.classList.contains("hidden")) {
      if (e.key === "Escape" && !deleteServerInProgress) { closeDialog(deleteServerDialog, deleteServerState); e.preventDefault(); }
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
      if (renderedServices[focusedIndex]) handleFill(renderedServices[focusedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (focusedIndex >= 0) {
        focusedIndex = -1;
        applyFocus();
        searchInput.focus();
      } else if (searchInput.value) {
        siteScopeActive = false;
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
  await loadOfflineMode();
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
