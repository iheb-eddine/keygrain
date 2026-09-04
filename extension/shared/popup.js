(async function () {
  "use strict";

  const KEYGRAIN_POPUP_MAX_ITEMS = 256;
  const KEYGRAIN_POPUP_MAX_FIELD_UTF8 = 256;
  const KEYGRAIN_POPUP_MAX_RESPONSE_BYTES = 65536;
  const FIXED_ACTIONS = Object.freeze({
    state: "keygrain.popup.state",
    settings: "keygrain.popup.settings",
    lockSensitive: "keygrain.popup.lockSensitive",
    lockAll: "keygrain.popup.lockEverything",
    extendLease: "keygrain.popup.extend",
    switchAccount: "keygrain.popup.switchAccount",
    metadata: "keygrain.popup.metadata",
    serviceList: "keygrain.popup.serviceList",
    selectionOptions: "keygrain.popup.selectionOptions",
    detail: "keygrain.popup.detail",
    add: "keygrain.popup.add",
    delete: "keygrain.popup.delete",
    edit: "keygrain.popup.edit",
    passwordOptions: "keygrain.password.options",
    passwordGenerate: "keygrain.password.generate",
    passwordFill: "keygrain.password.fill",
    totpOptions: "keygrain.totp.options",
    totpGenerate: "keygrain.totp.generate",
    totpFill: "keygrain.totp.fill",
    sshOptions: "keygrain.ssh.options",
    sshGenerate: "keygrain.ssh.generate",
    walletOptions: "keygrain.wallet.options",
    walletGenerate: "keygrain.wallet.generate",
  });
  const KEYGRAIN_TOTP_MAX_ITEMS = 256;
  const KEYGRAIN_TOTP_MAX_RESPONSE_BYTES = 65536;
  const KEYGRAIN_SSH_MAX_AUTHORIZED_KEYS_UTF8 = 2048;
  const KEYGRAIN_SSH_MAX_PRIVATE_KEY_PEM_UTF8 = 8192;
  const KEYGRAIN_WALLET_MAX_NAME_UTF8 = 64;
  const KEYGRAIN_WALLET_MAX_MNEMONIC_UTF8 = 256;
  const KEYGRAIN_WALLET_MAX_TOKEN_UTF8 = 128;

  const SVG_EYE = `<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3C4.5 3 1.5 5.5 0 8c1.5 2.5 4.5 5 8 5s6.5-2.5 8-5c-1.5-2.5-4.5-5-8-5zm0 8.5A3.5 3.5 0 1 1 8 4.5a3.5 3.5 0 0 1 0 7zm0-5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>`;
  const SVG_EYE_SLASH = `<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c4 0 6.5 3.5 7 4.5-.47.935-2.4 3.75-5.5 4.412l.859.826zm-2.146-2.147l-4.5-4.5A2.001 2.001 0 0 1 8 6a2 2 0 0 1 2 2c0 .414-.125.798-.339 1.118l-.872-.027zm-7.625 5.615l13.707-13.707-.707-.708L.881 14l.707.706zM2.641 4.762C.94 6.28 0 8 0 8s3 5.5 8 5.5c1.037 0 2.016-.242 2.89-.661l-.758-.758A6.05 6.05 0 0 1 8 12.5C4 12.5 1.5 9 1 8c.47-.935 2.4-3.75 5.5-4.412l-.859-.826z"/></svg>`;
  const SVG_COPY = `<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5z"/></svg>`;
  const SVG_FILL = `<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14 0H2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2zM4 3h8v2H4V3zm0 4h8v2H4V7zm0 4h5v2H4v-2z"/></svg>`;
  const SVG_EDIT = `<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175l-.886 2.215 2.214-.886L3.032 10.675z"/></svg>`;
  const SVG_DELETE = `<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>`;

  const loadingScreen = document.getElementById("loading-screen");
  const lockScreen = document.getElementById("lock-screen");
  const updateRequiredScreen = document.getElementById("update-required-screen");
  const mainScreen = document.getElementById("main-screen");
  const pinScreen = document.getElementById("pin-screen");
  const authModeUnlock = document.getElementById("auth-mode-unlock");
  const authModeCreate = document.getElementById("auth-mode-create");
  const emailInput = document.getElementById("email");
  const createConfirmEmailGroup = document.getElementById("create-confirm-email-group");
  const confirmEmailInput = document.getElementById("confirm-email");
  const confirmEmailMatch = document.getElementById("confirm-email-match");
  const secretInput = document.getElementById("secret");
  const fingerprintContainer = document.getElementById("fingerprint");
  const createConfirmGroup = document.getElementById("create-confirm-group");
  const confirmSecretInput = document.getElementById("confirm-secret");
  const confirmFingerprintContainer = document.getElementById("confirm-fingerprint");
  const confirmSecretMatch = document.getElementById("confirm-secret-match");
  const unlockBtn = document.getElementById("unlock-btn");
  const createBtn = document.getElementById("create-btn");
  const statusEl = document.getElementById("status");
  const serviceList = document.getElementById("service-list");
  const searchInput = document.getElementById("search");
  const updateStatus = document.getElementById("sync-error");
  const autolockWarning = document.getElementById("autolock-warning");
  const autolockExtend = document.getElementById("autolock-extend");
  const versionDisplay = document.getElementById("version-display");
  const tryDemoLink = document.getElementById("try-demo");
  const leaseStatus = document.getElementById("lease-status");
  const leaseStateBadge = document.getElementById("lease-state-badge");
  const leaseCountdown = document.getElementById("lease-countdown");
  const headerExtendBtn = document.getElementById("header-extend-btn");
  const lockError = document.getElementById("lock-error");

  const sshDialog = document.getElementById("ssh-dialog");
  const sshDialogSubtitle = document.getElementById("ssh-dialog-subtitle");
  const sshDialogPubkey = document.getElementById("ssh-dialog-pubkey");
  const sshDialogPrivkey = document.getElementById("ssh-dialog-privkey");
  const sshCopyPubBtn = document.getElementById("ssh-copy-pub-btn");
  const sshDownloadPubBtn = document.getElementById("ssh-download-pub-btn");
  const sshCopyPrivBtn = document.getElementById("ssh-copy-priv-btn");
  const sshDownloadPrivBtn = document.getElementById("ssh-download-priv-btn");
  const sshTogglePrivBtn = document.getElementById("ssh-toggle-priv-btn");
  const sshPrivkeyContainer = document.getElementById("ssh-privkey-container");
  const sshDialogClose = document.getElementById("ssh-dialog-close");
  let currentSshDownloadFilename = "id_ed25519";

  function downloadTextFile(content, filename) {
    if (!content) return;
    try {
      const blob = new Blob([content], {type: "text/plain;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (_) {}
  }

  function showLockError(msg, html = null) {
    if (!lockError) return;
    if (html) {
      lockError.innerHTML = html;
      const switchUnlock = document.getElementById("lock-switch-unlock");
      if (switchUnlock) {
        switchUnlock.addEventListener("click", (e) => {
          e.preventDefault();
          setAuthMode("unlock");
          secretInput?.focus();
        });
      }
      const switchCreate = document.getElementById("lock-switch-create");
      if (switchCreate) {
        switchCreate.addEventListener("click", (e) => {
          e.preventDefault();
          setAuthMode("create");
          secretInput?.focus();
        });
      }
    } else {
      lockError.textContent = msg || "";
    }
    if (msg || html) {
      lockError.classList.remove("hidden");
    } else {
      lockError.classList.add("hidden");
    }
  }

  function clearLockError() {
    if (!lockError) return;
    lockError.textContent = "";
    lockError.innerHTML = "";
    lockError.classList.add("hidden");
  }

  function closeSshDialog() {
    if (!sshDialog) return;
    sshDialog.classList.add("hidden");
    if (sshDialogPubkey) sshDialogPubkey.value = "";
    if (sshDialogPrivkey) sshDialogPrivkey.value = "";
    if (sshDialogSubtitle) sshDialogSubtitle.textContent = "";
    if (sshPrivkeyContainer) sshPrivkeyContainer.classList.add("hidden");
    if (sshTogglePrivBtn) sshTogglePrivBtn.textContent = "Show on screen";
  }

  if (sshDialogClose) {
    sshDialogClose.addEventListener("click", () => {
      closeSshDialog();
    });
  }

  if (sshTogglePrivBtn) {
    sshTogglePrivBtn.addEventListener("click", () => {
      if (!sshPrivkeyContainer) return;
      const isHidden = sshPrivkeyContainer.classList.toggle("hidden");
      sshTogglePrivBtn.textContent = isHidden ? "Show on screen" : "Hide from screen";
    });
  }

  if (sshCopyPubBtn) {
    sshCopyPubBtn.addEventListener("click", async () => {
      if (sshDialogPubkey?.value && typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(sshDialogPubkey.value);
        showStatus(statusEl, "SSH public key copied!");
      }
    });
  }

  if (sshDownloadPubBtn) {
    sshDownloadPubBtn.addEventListener("click", () => {
      if (sshDialogPubkey?.value) {
        downloadTextFile(sshDialogPubkey.value, `${currentSshDownloadFilename}.pub`);
        showStatus(statusEl, "SSH public key downloaded!");
      }
    });
  }

  if (sshCopyPrivBtn) {
    sshCopyPrivBtn.addEventListener("click", async () => {
      if (sshDialogPrivkey?.value && typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(sshDialogPrivkey.value);
        showStatus(statusEl, "SSH private key copied!");
      }
    });
  }

  if (sshDownloadPrivBtn) {
    sshDownloadPrivBtn.addEventListener("click", () => {
      if (sshDialogPrivkey?.value) {
        downloadTextFile(sshDialogPrivkey.value, currentSshDownloadFilename);
        showStatus(statusEl, "SSH private key downloaded!");
      }
    });
  }

  const addBtn = document.getElementById("add-btn");
  const addDialog = document.getElementById("add-dialog");
  const addDialogTitle = document.getElementById("add-dialog-title");
  const addName = document.getElementById("add-name");
  const addSite = document.getElementById("add-site");
  const addEmail = document.getElementById("add-email");
  const addLength = document.getElementById("add-length");
  const addSymbols = document.getElementById("add-symbols");
  const addCounter = document.getElementById("add-counter");
  const addTotpMode = document.getElementById("add-totp-mode");
  const addTotpSeedGroup = document.getElementById("add-totp-seed-group");
  const addTotpSeed = document.getElementById("add-totp-seed");
  const addTotpSection = document.getElementById("add-totp-section");
  const addSshSection = document.getElementById("add-ssh-section");
  const addSshKeyname = document.getElementById("add-ssh-keyname");
  const addEditWarning = document.getElementById("add-edit-warning");
  const rotateSection = document.getElementById("rotate-section");
  const rotateBtn = document.getElementById("rotate-btn");
  const addCancel = document.getElementById("add-cancel");
  const addConfirm = document.getElementById("add-confirm");

  const reauthDialog = document.getElementById("reauth-dialog");
  const reauthSecret = document.getElementById("reauth-secret");
  const reauthFingerprint = document.getElementById("reauth-fingerprint");
  const reauthError = document.getElementById("reauth-error");
  const reauthCancel = document.getElementById("reauth-cancel");
  const reauthConfirm = document.getElementById("reauth-confirm");

  const deleteDialog = document.getElementById("delete-dialog");
  const deleteServiceName = document.getElementById("delete-service-name");
  const deleteTotpWarning = document.getElementById("delete-totp-warning");
  const deleteCancel = document.getElementById("delete-cancel");
  const deleteConfirm = document.getElementById("delete-confirm");

  const menuBtn = document.getElementById("menu-btn");
  const menuDropdown = document.getElementById("menu-dropdown");
  const lockBtn = document.getElementById("lock-btn");
  const menuLockSecret = document.getElementById("menu-lock-secret");
  const menuLockAll = document.getElementById("menu-lock-all");
  const exportBtn = document.getElementById("export-btn");
  const importBtn = document.getElementById("import-btn");
  const migrateBtn = document.getElementById("migrate-btn");
  const walletBtn = document.getElementById("wallet-btn");
  const helpBtn = document.getElementById("help-btn");
  const offlineBtn = document.getElementById("offline-btn");
  const switchAccountBtn = document.getElementById("switch-account-btn");
  const switchAccountLock = document.getElementById("switch-account-lock");
  const switchAccountDialog = document.getElementById("switch-account-dialog");
  const switchAccountCancel = document.getElementById("switch-account-cancel");
  const switchAccountConfirm = document.getElementById("switch-account-confirm");
  const deleteServerBtn = document.getElementById("delete-server-btn");
  const deleteServerDialog = document.getElementById("delete-server-dialog");
  const deleteServerCancel = document.getElementById("delete-server-cancel");
  const deleteServerConfirm = document.getElementById("delete-server-confirm");

  const settingsBtn = document.getElementById("settings-btn");
  const settingsPanel = document.getElementById("settings-panel");
  const settingsCancel = document.getElementById("settings-cancel");
  const settingsSave = document.getElementById("settings-save");
  const inlineAutofillToggle = document.getElementById("inline-autofill-toggle");
  const inlineConsentDialog = document.getElementById("inline-consent-dialog");
  const inlineConsentCancel = document.getElementById("inline-consent-cancel");
  const inlineConsentConfirm = document.getElementById("inline-consent-confirm");

  const resetBtn = document.getElementById("reset-btn");
  const resetDialog = document.getElementById("reset-dialog");
  const resetInput = document.getElementById("reset-input");
  const resetConfirmBtn = document.getElementById("reset-confirm-btn");
  const resetCancel = document.getElementById("reset-cancel");

  const popupSessionId = (() => {
    try {
      if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
      return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");
    } catch (_) { return null; }
  })();

  let popupRenderItems = [];
  let currentOwnerState = null;
  let currentSnapshot = null;
  let renderEpoch = 0;
  let fingerprintTimer = null;
  let fingerprintGeneration = 0;
  let requestInFlight = false;
  let currentEditToken = null;
  let currentEditId = null;
  let deleteTargetId = null;
  let activeTimers = new Set();

  function registerTimer(timerId) {
    if (timerId) {
      if (typeof timerId?.unref === "function") timerId.unref();
      activeTimers.add(timerId);
    }
    return timerId;
  }

  function clearAllTimers() {
    for (const timerId of activeTimers) {
      if (typeof clearTimeout === "function") clearTimeout(timerId);
      if (typeof clearInterval === "function") clearInterval(timerId);
    }
    activeTimers.clear();
  }

  try {
    const keepalivePort = (globalThis.chrome || globalThis.browser)?.runtime?.connect?.({name: "keygrain-keepalive"});
    if (keepalivePort) {
      const pingTimer = setInterval(() => { try { keepalivePort.postMessage("ping"); } catch (_) {} }, 20000);
      window.addEventListener("pagehide", () => { clearInterval(pingTimer); try { keepalivePort.disconnect(); } catch (_) {} });
    }
  } catch (_) {}

  let countdownInterval = null;
  let heartbeatInterval = null;

  function formatRemainingTime(seconds) {
    if (seconds <= 0) return "00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}h ${m}m`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function updateLeaseCountdown(fromTicker = false) {
    if (!leaseStatus || !leaseCountdown) return;
    const now = Date.now();
    if (currentOwnerState === "full" && currentSnapshot?.fullExpiresAt) {
      leaseStatus.classList.remove("hidden");
      if (headerExtendBtn) headerExtendBtn.classList.remove("hidden");
      if (leaseStateBadge) {
        leaseStateBadge.textContent = "Unlocked";
        leaseStateBadge.className = "lease-state-badge badge-unlocked";
      }
      const remaining = Math.max(0, Math.floor((currentSnapshot.fullExpiresAt - now) / 1000));
      leaseCountdown.textContent = formatRemainingTime(remaining);
      leaseCountdown.title = `Master secret lease expires in ${remaining}s`;
      if (fromTicker && remaining === 0) {
        requestOwnerView();
      }
    } else if (currentOwnerState === "metadata" && currentSnapshot?.metadataExpiresAt) {
      leaseStatus.classList.remove("hidden");
      if (headerExtendBtn) headerExtendBtn.classList.remove("hidden");
      if (leaseStateBadge) {
        leaseStateBadge.textContent = "Metadata";
        leaseStateBadge.className = "lease-state-badge badge-metadata";
      }
      const remaining = Math.max(0, Math.floor((currentSnapshot.metadataExpiresAt - now) / 1000));
      leaseCountdown.textContent = formatRemainingTime(remaining);
      leaseCountdown.title = `Metadata cache expires in ${remaining}s`;
      if (fromTicker && remaining === 0) {
        requestOwnerView();
      }
    } else {
      leaseStatus.classList.add("hidden");
      if (headerExtendBtn) headerExtendBtn.classList.add("hidden");
    }
  }

  function startCountdownTicker() {
    if (countdownInterval || typeof setInterval !== "function") return;
    countdownInterval = setInterval(() => {
      updateLeaseCountdown(true);
    }, 1000);
    if (countdownInterval && typeof countdownInterval.unref === "function") {
      countdownInterval.unref();
    }
  }

  function startHeartbeat() {
    if (heartbeatInterval || typeof setInterval !== "function") return;
    heartbeatInterval = setInterval(async () => {
      try {
        if (typeof document !== "undefined" && document.hasFocus && document.hasFocus()) {
          const res = await sendMsg({action: FIXED_ACTIONS.state});
          const snap = res?.result || res?.snapshot;
          if (res?.ok && snap) {
            const prevState = currentOwnerState;
            currentSnapshot = snap;
            currentOwnerState = snap.state;
            updateLeaseCountdown();
            if (prevState && prevState !== currentOwnerState) {
              requestOwnerView();
            }
          }
        }
      } catch (_) {}
    }, 10000);
    if (heartbeatInterval && typeof heartbeatInterval.unref === "function") {
      heartbeatInterval.unref();
    }
  }

  async function acquirePasswordToken(id) {
    if (currentOwnerState !== "full") return null;
    try {
      const res = await sendMsg({action: FIXED_ACTIONS.passwordOptions});
      const items = res?.result?.items || res?.items;
      if (res?.ok && Array.isArray(items)) {
        for (const item of items) {
          const match = popupRenderItems.find(p => p.id === item.id);
          if (match) match.passwordToken = item.selectionToken;
        }
        const match = items.find(i => i.id === id);
        return match?.selectionToken || null;
      }
    } catch (_) {}
    return null;
  }

  async function acquireTotpToken(id) {
    if (currentOwnerState !== "full") return null;
    try {
      const res = await sendMsg({action: FIXED_ACTIONS.totpOptions});
      const items = res?.result?.items || res?.items;
      if (res?.ok && Array.isArray(items)) {
        for (const item of items) {
          const match = popupRenderItems.find(p => p.id === item.id);
          if (match) match.totpToken = item.selectionToken;
        }
        const match = items.find(i => i.id === id);
        return match?.selectionToken || null;
      }
    } catch (_) {}
    return null;
  }

  async function acquireSshToken(id) {
    if (currentOwnerState !== "full") return null;
    try {
      const res = await sendMsg({action: FIXED_ACTIONS.sshOptions});
      const items = res?.result?.items || res?.items;
      if (res?.ok && Array.isArray(items)) {
        for (const item of items) {
          const match = popupRenderItems.find(p => p.id === item.id);
          if (match) match.sshToken = item.selectionToken;
        }
        const match = items.find(i => i.id === id);
        return match?.selectionToken || null;
      }
    } catch (_) {}
    return null;
  }

  async function openSshDialog(item) {
    if (!item) return;
    if (!item.sshToken) {
      if (currentOwnerState === "metadata") {
        promptReauth({action: () => openSshDialog(item), id: item.id});
        return;
      }
      const token = await acquireSshToken(item.id);
      if (!token) return;
      item.sshToken = token;
    }
    const token = item.sshToken;
    item.sshToken = null;
    try {
      let genRes = await sendMsg({action: FIXED_ACTIONS.sshGenerate, selectionToken: token});
      if (genRes?.code === "KEYGRAIN_STALE_OPERATION") {
        const freshToken = await acquireSshToken(item.id);
        if (freshToken) {
          genRes = await sendMsg({action: FIXED_ACTIONS.sshGenerate, selectionToken: freshToken});
        }
      }
      if (genRes?.ok && genRes.result?.authorizedKeys) {
        const rawKeyName = item.sshKeyName || item.name || item.site || "id_ed25519";
        currentSshDownloadFilename = rawKeyName.replace(/[^a-zA-Z0-9_\-]/g, "_");
        if (sshDialogSubtitle) sshDialogSubtitle.textContent = `Key name: ${item.sshKeyName || "default"}`;
        if (sshDialogPubkey) sshDialogPubkey.value = genRes.result.authorizedKeys;
        if (sshDialogPrivkey) sshDialogPrivkey.value = genRes.result.privateKeyPem || "";
        if (sshPrivkeyContainer) sshPrivkeyContainer.classList.add("hidden");
        if (sshTogglePrivBtn) sshTogglePrivBtn.textContent = "Show on screen";
        sshDialog?.classList.remove("hidden");
      } else if (genRes?.code === "KEYGRAIN_EXPIRED") {
        promptReauth({action: () => openSshDialog(item), id: item.id});
      } else {
        showStatus(statusEl, "Failed to generate SSH keys.");
      }
    } catch (_) {
      showStatus(statusEl, "Failed to generate SSH keys.");
    }
  }

  async function acquireDetailToken(id) {
    if (currentOwnerState !== "full") return null;
    try {
      const res = await sendMsg({action: FIXED_ACTIONS.selectionOptions});
      const items = validateSelectionOptionsResponse(res);
      if (Array.isArray(items)) {
        for (const item of items) {
          const match = popupRenderItems.find(p => p.id === item.id);
          if (match) match.detailSelectionToken = item.detailSelectionToken;
        }
        const match = items.find(i => i.id === id);
        return match?.detailSelectionToken || null;
      }
    } catch (_) {}
    return null;
  }

  function stopLongLivedTimers() {
    if (countdownInterval && typeof clearInterval === "function") {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if (heartbeatInterval && typeof clearInterval === "function") {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  function showStatus(element, message) {
    if (!element) return;
    element.textContent = typeof message === "string" ? message : "";
    element.classList.toggle("hidden", !element.textContent);
  }

  function clearFingerprint() {
    fingerprintGeneration++;
    if (fingerprintTimer !== null) clearTimeout(fingerprintTimer);
    fingerprintTimer = null;
    if (fingerprintContainer) fingerprintContainer.textContent = "";
  }

  function scheduleFingerprint() {
    clearFingerprint();
    if (!fingerprintContainer || !secretInput?.value) return;
    const generation = fingerprintGeneration;
    const secret = secretInput.value;
    fingerprintContainer.textContent = "⏳";
    fingerprintTimer = setTimeout(async () => {
      fingerprintTimer = null;
      try {
        const indices = await secretFingerprint(secret);
        if (generation !== fingerprintGeneration || !Array.isArray(indices) || indices.length !== 4
          || !Array.isArray(WONG_PALETTE)) throw new Error("fingerprint_invalid");
        const colors = indices.map(index => {
          if (!Number.isSafeInteger(index) || index < 0 || index >= WONG_PALETTE.length
            || typeof WONG_PALETTE[index] !== "string") throw new Error("fingerprint_invalid");
          return WONG_PALETTE[index];
        });
        if (generation !== fingerprintGeneration) return;
        fingerprintContainer.textContent = "";
        for (const color of colors) {
          const dot = document.createElement("span");
          dot.className = "fp-dot";
          dot.style.background = color;
          fingerprintContainer.appendChild(dot);
        }
      } catch (_) {
        if (generation === fingerprintGeneration) fingerprintContainer.textContent = "";
      }
    }, 500);
  }

  let reauthFingerprintTimer = null;
  let reauthFingerprintGeneration = 0;

  function clearReauthFingerprint() {
    reauthFingerprintGeneration++;
    if (reauthFingerprintTimer !== null) clearTimeout(reauthFingerprintTimer);
    reauthFingerprintTimer = null;
    if (reauthFingerprint) reauthFingerprint.textContent = "";
  }

  function scheduleReauthFingerprint() {
    clearReauthFingerprint();
    if (!reauthFingerprint || !reauthSecret?.value) return;
    const generation = reauthFingerprintGeneration;
    const secret = reauthSecret.value;
    reauthFingerprint.textContent = "⏳";
    reauthFingerprintTimer = setTimeout(async () => {
      reauthFingerprintTimer = null;
      try {
        const indices = await secretFingerprint(secret);
        if (generation !== reauthFingerprintGeneration || !Array.isArray(indices) || indices.length !== 4
          || !Array.isArray(WONG_PALETTE)) throw new Error("fingerprint_invalid");
        const colors = indices.map(index => {
          if (!Number.isSafeInteger(index) || index < 0 || index >= WONG_PALETTE.length
            || typeof WONG_PALETTE[index] !== "string") throw new Error("fingerprint_invalid");
          return WONG_PALETTE[index];
        });
        if (generation !== reauthFingerprintGeneration) return;
        reauthFingerprint.textContent = "";
        for (const color of colors) {
          const dot = document.createElement("span");
          dot.className = "fp-dot";
          dot.style.background = color;
          reauthFingerprint.appendChild(dot);
        }
      } catch (_) {
        if (generation === reauthFingerprintGeneration) reauthFingerprint.textContent = "";
      }
    }, 500);
  }

  let confirmFingerprintTimer = null;
  let confirmFingerprintGeneration = 0;

  function clearConfirmFingerprint() {
    confirmFingerprintGeneration++;
    if (confirmFingerprintTimer !== null) clearTimeout(confirmFingerprintTimer);
    confirmFingerprintTimer = null;
    if (confirmFingerprintContainer) confirmFingerprintContainer.textContent = "";
  }

  function scheduleConfirmFingerprint() {
    clearConfirmFingerprint();
    if (!confirmFingerprintContainer || !confirmSecretInput?.value) return;
    const generation = confirmFingerprintGeneration;
    const secret = confirmSecretInput.value;
    confirmFingerprintContainer.textContent = "⏳";
    confirmFingerprintTimer = setTimeout(async () => {
      confirmFingerprintTimer = null;
      try {
        const indices = await secretFingerprint(secret);
        if (generation !== confirmFingerprintGeneration || !Array.isArray(indices) || indices.length !== 4
          || !Array.isArray(WONG_PALETTE)) throw new Error("fingerprint_invalid");
        const colors = indices.map(index => {
          if (!Number.isSafeInteger(index) || index < 0 || index >= WONG_PALETTE.length
            || typeof WONG_PALETTE[index] !== "string") throw new Error("fingerprint_invalid");
          return WONG_PALETTE[index];
        });
        if (generation !== confirmFingerprintGeneration) return;
        confirmFingerprintContainer.textContent = "";
        for (const color of colors) {
          const dot = document.createElement("span");
          dot.className = "fp-dot";
          dot.style.background = color;
          confirmFingerprintContainer.appendChild(dot);
        }
      } catch (_) {
        if (generation === confirmFingerprintGeneration) confirmFingerprintContainer.textContent = "";
      }
    }, 500);
  }

  let authMode = "unlock";

  function updateCreateButtonState() {
    const email = emailInput?.value?.trim() || "";
    const confirmEmail = confirmEmailInput?.value?.trim() || "";
    const secret = secretInput?.value || "";
    const confirm = confirmSecretInput?.value || "";
    if (confirmEmailMatch) {
      if (!confirmEmail || !email) {
        confirmEmailMatch.textContent = "";
      } else if (email.toLowerCase() === confirmEmail.toLowerCase()) {
        confirmEmailMatch.textContent = "✓ Emails match";
        confirmEmailMatch.style.color = "var(--success)";
      } else {
        confirmEmailMatch.textContent = "⚠️ Emails do not match";
        confirmEmailMatch.style.color = "var(--error)";
      }
    }
    if (confirmSecretMatch) {
      if (!confirm || !secret) {
        confirmSecretMatch.textContent = "";
      } else if (secret === confirm) {
        confirmSecretMatch.textContent = "✓ Master secrets match";
        confirmSecretMatch.style.color = "var(--success)";
      } else {
        confirmSecretMatch.textContent = "⚠️ Master secrets do not match";
        confirmSecretMatch.style.color = "var(--error)";
      }
    }
    if (createBtn) {
      const emailsMatch = Boolean(email && confirmEmail && (email.toLowerCase() === confirmEmail.toLowerCase()));
      const secretsMatch = Boolean(secret && confirm && (secret === confirm));
      createBtn.disabled = !emailsMatch || !secretsMatch;
    }
  }

  function setAuthMode(mode) {
    authMode = mode;
    clearLockError();
    if (statusEl) statusEl.textContent = "";
    if (mode === "create") {
      authModeCreate?.classList.add("active");
      authModeCreate?.setAttribute?.("aria-selected", "true");
      authModeUnlock?.classList.remove("active");
      authModeUnlock?.setAttribute?.("aria-selected", "false");
      createConfirmEmailGroup?.classList.remove("hidden");
      createConfirmGroup?.classList.remove("hidden");
      unlockBtn?.classList.add("hidden");
      createBtn?.classList.remove("hidden");
      updateCreateButtonState();
    } else {
      authModeUnlock?.classList.add("active");
      authModeUnlock?.setAttribute?.("aria-selected", "true");
      authModeCreate?.classList.remove("active");
      authModeCreate?.setAttribute?.("aria-selected", "false");
      createConfirmEmailGroup?.classList.add("hidden");
      createConfirmGroup?.classList.add("hidden");
      unlockBtn?.classList.remove("hidden");
      createBtn?.classList.add("hidden");
      if (confirmEmailInput) confirmEmailInput.value = "";
      if (confirmEmailMatch) confirmEmailMatch.textContent = "";
      if (confirmSecretInput) confirmSecretInput.value = "";
      if (confirmSecretMatch) confirmSecretMatch.textContent = "";
      clearConfirmFingerprint();
      if (unlockBtn) unlockBtn.disabled = !emailInput?.value || !secretInput?.value;
    }
  }

  function showLoadingScreen(message) {
    if (typeof loadingScreen !== "undefined" && loadingScreen) {
      if (typeof loadingScreen.querySelector === "function") {
        const textEl = loadingScreen.querySelector(".loading-text");
        if (textEl && message) textEl.textContent = message;
      }
      if (loadingScreen.classList && typeof loadingScreen.classList.remove === "function") {
        loadingScreen.classList.remove("hidden");
      }
    }
    if (typeof lockScreen !== "undefined" && lockScreen?.classList) lockScreen.classList.add("hidden");
    if (typeof pinScreen !== "undefined" && pinScreen?.classList) pinScreen.classList.add("hidden");
    if (typeof mainScreen !== "undefined" && mainScreen?.classList) mainScreen.classList.add("hidden");
    if (typeof updateRequiredScreen !== "undefined" && updateRequiredScreen?.classList) updateRequiredScreen.classList.add("hidden");
  }

  function showUpdateRequiredScreen() {
    renderEpoch++;
    popupRenderItems = [];
    if (typeof clearAllTimers === "function") clearAllTimers();
    if (typeof clearFingerprint === "function") clearFingerprint();
    if (typeof loadingScreen !== "undefined" && loadingScreen?.classList) loadingScreen.classList.add("hidden");
    if (updateRequiredScreen) {
      updateRequiredScreen.classList.remove("hidden");
    }
    if (lockScreen) lockScreen.classList.add("hidden");
    if (pinScreen) pinScreen.classList.add("hidden");
    if (mainScreen) mainScreen.classList.add("hidden");
    if (statusEl) statusEl.textContent = "";
    updateRequiredScreen?.focus();
  }

  function showPinScreen() {
    if (typeof loadingScreen !== "undefined" && loadingScreen?.classList) loadingScreen.classList.add("hidden");
    if (updateRequiredScreen) updateRequiredScreen.classList.add("hidden");
    if (lockScreen) lockScreen.classList.remove("hidden");
    if (pinScreen) pinScreen.classList.add("hidden");
    if (mainScreen) mainScreen.classList.add("hidden");
  }

  function showLockScreen() {
    renderEpoch++;
    popupRenderItems = [];
    currentOwnerState = "locked";
    currentSnapshot = null;
    clearLockError();
    if (typeof clearAllTimers === "function") clearAllTimers();
    if (typeof clearFingerprint === "function") clearFingerprint();
    if (typeof clearConfirmFingerprint === "function") clearConfirmFingerprint();
    if (serviceList) serviceList.textContent = "";
    if (typeof loadingScreen !== "undefined" && loadingScreen?.classList) loadingScreen.classList.add("hidden");
    if (updateRequiredScreen) updateRequiredScreen.classList.add("hidden");
    if (lockScreen) lockScreen.classList.remove("hidden");
    if (pinScreen) pinScreen.classList.add("hidden");
    if (mainScreen) mainScreen.classList.add("hidden");
    if (settingsPanel) settingsPanel.classList.add("hidden");
    if (switchAccountLock) switchAccountLock.classList.remove("hidden");
    if (confirmEmailInput) confirmEmailInput.value = "";
    if (confirmEmailMatch) confirmEmailMatch.textContent = "";
    if (confirmSecretInput) confirmSecretInput.value = "";
    if (confirmSecretMatch) confirmSecretMatch.textContent = "";
    setAuthMode("unlock");
    updateLeaseCountdown();
    showStatus(statusEl, "");
    emailInput?.focus();
  }

  function showMainScreen() {
    if (typeof loadingScreen !== "undefined" && loadingScreen?.classList) loadingScreen.classList.add("hidden");
    if (updateRequiredScreen) updateRequiredScreen.classList.add("hidden");
    if (lockScreen) lockScreen.classList.add("hidden");
    if (pinScreen) pinScreen.classList.add("hidden");
    if (mainScreen) mainScreen.classList.remove("hidden");
    updateLeaseCountdown();
  }

  function safeFailureMessage(response) {
    if (response && response.ok === false && typeof response.message === "string") return response.message;
    return "Unlock failed; try again.";
  }

  async function sendMsg(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (_) {
      return {ok: false, code: "KEYGRAIN_CONTEXT_ERROR", message: "Extension context invalidated."};
    }
  }

  function fieldBytes(value) {
    if (value === null) return 0;
    if (typeof value !== "string") throw new Error("popup_type");
    const bytes = new TextEncoder().encode(value).byteLength;
    if (bytes > KEYGRAIN_POPUP_MAX_FIELD_UTF8) throw new Error("popup_field_bound");
    return bytes;
  }

  function exactKeys(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("popup_envelope");
    const actual = Object.keys(value);
    if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) throw new Error("popup_keys");
  }

  function validateItemsResponse(response) {
    exactKeys(response, ["ok", "result"]);
    if (response.ok !== true) throw new Error("popup_failure");
    exactKeys(response.result, ["items"]);
    const items = response.result.items;
    if (!Array.isArray(items) || items.length > KEYGRAIN_POPUP_MAX_ITEMS) throw new Error("popup_items");
    const result = [];
    for (const item of items) {
      exactKeys(item, ["id", "site", "name", "email"]);
      for (const key of ["id", "site", "name", "email"]) fieldBytes(item[key]);
      result.push({id: item.id, site: item.site, name: item.name, email: item.email});
    }
    if (new TextEncoder().encode(JSON.stringify(response)).byteLength > KEYGRAIN_POPUP_MAX_RESPONSE_BYTES) {
      throw new Error("popup_response_bound");
    }
    return result;
  }

  function validateStateResponse(response) {
    exactKeys(response, ["ok", "result"]);
    if (response.ok !== true) throw new Error("popup_failure");
    const allowed9 = [
      "state", "stateGeneration", "authorizationGeneration", "fullExpiresAt", "metadataExpiresAt",
      "fullWarningAt", "metadataWarningAt", "metadataAvailable", "hasFullData",
    ];
    const allowed10 = [...allowed9, "email"];
    const actualKeys = Object.keys(response.result);
    if (actualKeys.length === 9) {
      exactKeys(response.result, allowed9);
    } else {
      exactKeys(response.result, allowed10);
    }
    const state = response.result;
    if (!new Set(["locked", "full", "metadata"]).has(state.state)
      || !Number.isSafeInteger(state.stateGeneration) || state.stateGeneration < 0
      || !Number.isSafeInteger(state.authorizationGeneration) || state.authorizationGeneration < 0) {
      throw new Error("popup_state");
    }
    for (const key of ["fullExpiresAt", "metadataExpiresAt", "fullWarningAt", "metadataWarningAt"]) {
      if (state[key] !== null && (!Number.isFinite(state[key]) || state[key] < 0)) throw new Error("popup_state");
    }
    if (typeof state.metadataAvailable !== "boolean" || typeof state.hasFullData !== "boolean") throw new Error("popup_state");
    if (state.email !== undefined && state.email !== null && typeof state.email !== "string") throw new Error("popup_state");
    if (state.state === "locked" && (state.fullExpiresAt !== null || state.metadataExpiresAt !== null
      || state.fullWarningAt !== null || state.metadataWarningAt !== null || state.metadataAvailable || state.hasFullData)) throw new Error("popup_state");
    if (state.state === "full" && (state.fullExpiresAt === null || state.fullWarningAt === null
      || state.metadataExpiresAt !== null || state.metadataWarningAt !== null || state.metadataAvailable || !state.hasFullData)) throw new Error("popup_state");
    if (state.state === "metadata" && (state.fullExpiresAt !== null || state.fullWarningAt !== null
      || state.metadataExpiresAt === null || state.metadataWarningAt === null || !state.metadataAvailable || state.hasFullData)) throw new Error("popup_state");
    if (new TextEncoder().encode(JSON.stringify(response)).byteLength > KEYGRAIN_POPUP_MAX_RESPONSE_BYTES) throw new Error("popup_response_bound");
    return state;
  }

  function validatePasswordOptionsResponse(response) {
    if (!response || typeof response !== "object" || response.ok !== true || !response.result || !Array.isArray(response.result.items)) return [];
    if (response.result.items.length > KEYGRAIN_POPUP_MAX_ITEMS) throw new Error("popup_items");
    const items = response.result.items.map(item => {
      exactKeys(item, ["selectionToken", "id", "site", "name", "email"]);
      if (typeof item.selectionToken !== "string" || !item.selectionToken) throw new Error("popup_token");
      for (const key of ["selectionToken", "id", "site", "name", "email"]) fieldBytes(item[key]);
      return {selectionToken: item.selectionToken, id: item.id, site: item.site, name: item.name, email: item.email};
    });
    if (new TextEncoder().encode(JSON.stringify(response)).byteLength > KEYGRAIN_POPUP_MAX_RESPONSE_BYTES) throw new Error("popup_response_bound");
    return items;
  }

  function validateSelectionOptionsResponse(response) {
    if (!response || typeof response !== "object" || response.ok !== true || !response.result || !Array.isArray(response.result.items)) return [];
    if (response.result.items.length > KEYGRAIN_POPUP_MAX_ITEMS) throw new Error("popup_items");
    return response.result.items;
  }

  function validateTotpOptionsResponse(response) {
    if (!response || typeof response !== "object" || response.ok !== true || !response.result || !Array.isArray(response.result.items)) return [];
    return response.result.items;
  }

  function validateSshOptionsResponse(response) {
    if (!response || typeof response !== "object" || response.ok !== true || !response.result || !Array.isArray(response.result.items)) return [];
    return response.result.items;
  }

  function getStrengthClass(length) {
    if (length >= 20) return "strong";
    if (length >= 12) return "good";
    return "fair";
  }

  function renderFullServiceList(services, epoch, expectedState) {
    if (!serviceList) return;
    serviceList.textContent = "";

    if (!services || services.length === 0) {
      if (expectedState && expectedState.state !== "locked") {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "No services yet. Click \"+ Add service\" below.";
        serviceList.appendChild(empty);
      }
      return;
    }

    for (const [index, item] of services.entries()) {
      const row = document.createElement("div");
      row.className = "service-item";
      row.id = "service-item-" + index;
      row.dataset.serviceId = item.id || "";
      if (typeof row.setAttribute === "function") {
        row.setAttribute("role", "option");
        row.setAttribute("tabindex", "-1");
        row.setAttribute("aria-selected", "false");
      }

      // --- Info column ---
      const info = document.createElement("div");
      info.className = "service-info";

      const name = document.createElement("span");
      name.className = "service-name";
      name.textContent = item.name || item.site || "Unnamed service";
      if (item.counter && item.counter > 1) {
        const badge = document.createElement("span");
        badge.className = "version-badge";
        badge.textContent = "v" + item.counter;
        name.appendChild(badge);
      }

      const site = document.createElement("span");
      site.className = "service-site";
      site.textContent = item.site || "";

      const email = document.createElement("span");
      email.className = "service-email";
      email.textContent = item.email || "";

      info.appendChild(name);
      info.appendChild(site);
      info.appendChild(email);
      if (item.length !== undefined) {
        const strength = document.createElement("div");
        strength.className = "strength-bar " + getStrengthClass(item.length || 20);
        info.appendChild(strength);
      }
      row.appendChild(info);

      // --- Actions column ---
      const actions = document.createElement("div");
      actions.className = "service-actions";

      // 1. Reveal/Hide button
      const toggleBtn = document.createElement("button");
      toggleBtn.className = "toggle-btn";
      toggleBtn.type = "button";
      toggleBtn.title = "Reveal password";
      toggleBtn.innerHTML = SVG_EYE;
      let revealedSpan = null;
      let revealTimer = null;
      toggleBtn.addEventListener("click", async () => {
        if (epoch !== renderEpoch) return;
        if (revealedSpan) {
          revealedSpan.remove();
          revealedSpan = null;
          toggleBtn.innerHTML = SVG_EYE;
          toggleBtn.title = "Reveal password";
          if (revealTimer) {
            clearTimeout(revealTimer);
            activeTimers.delete(revealTimer);
            revealTimer = null;
          }
          return;
        }
        let token = item.passwordToken;
        if (!token) {
          if (currentOwnerState === "metadata") {
            promptReauth({action: "togglePassword", id: item.id});
            return;
          }
          token = await acquirePasswordToken(item.id);
          if (!token) return;
        }
        item.passwordToken = null;
        toggleBtn.disabled = true;
        try {
          let genRes = await sendMsg({
            action: FIXED_ACTIONS.passwordGenerate,
            selectionToken: token,
            length: item.length || 20,
            symbols: item.symbols || "!@#$%&*-_=+?",
            counter: item.counter || 1,
            policy: "ascii-printable-v1",
          });
          if (genRes?.code === "KEYGRAIN_STALE_OPERATION") {
            const freshToken = await acquirePasswordToken(item.id);
            if (freshToken) {
              genRes = await sendMsg({
                action: FIXED_ACTIONS.passwordGenerate,
                selectionToken: freshToken,
                length: item.length || 20,
                symbols: item.symbols || "!@#$%&*-_=+?",
                counter: item.counter || 1,
                policy: "ascii-printable-v1",
              });
            }
          }
          const postStateRes = await sendMsg({action: FIXED_ACTIONS.state});
          if (epoch !== renderEpoch) return;
          const postState = validateStateResponse(postStateRes);
          if (postState.state === "locked") {
            showLockScreen();
            return;
          }
          if (genRes?.ok && genRes.result?.password) {
            revealedSpan = document.createElement("span");
            revealedSpan.className = "password-display";
            revealedSpan.textContent = genRes.result.password;
            const strengthBar = typeof info.querySelector === "function" ? info.querySelector(".strength-bar") : null;
            if (strengthBar && typeof info.insertBefore === "function") {
              info.insertBefore(revealedSpan, strengthBar);
            } else if (typeof info.appendChild === "function") {
              info.appendChild(revealedSpan);
            }
            toggleBtn.innerHTML = SVG_EYE_SLASH;
            toggleBtn.title = "Hide password";
            revealTimer = registerTimer(setTimeout(() => {
              if (revealedSpan) {
                revealedSpan.remove();
                revealedSpan = null;
                toggleBtn.innerHTML = SVG_EYE;
                toggleBtn.title = "Reveal password";
              }
            }, 30000));
          } else if (genRes?.code === "KEYGRAIN_EXPIRED") {
            promptReauth({action: "togglePassword", id: item.id});
          }
        } finally {
          toggleBtn.disabled = false;
        }
      });
      actions.appendChild(toggleBtn);

      // 2. Copy button
      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-btn";
      copyBtn.type = "button";
      copyBtn.title = "Copy password";
      copyBtn.innerHTML = SVG_COPY;
      copyBtn.addEventListener("click", async () => {
        if (revealedSpan && revealedSpan.textContent) {
          const pass = revealedSpan.textContent;
          if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(pass);
            showStatus(statusEl, "Copied!");
            registerTimer(setTimeout(async () => {
              try {
                if (navigator?.clipboard?.readText) {
                  const current = await navigator.clipboard.readText();
                  if (current === pass) await navigator.clipboard.writeText("");
                }
              } catch (_) {}
            }, 30000));
          }
          return;
        }
        let token = item.passwordToken;
        if (!token) {
          if (currentOwnerState === "metadata") {
            promptReauth({action: "copyPassword", id: item.id});
            return;
          }
          token = await acquirePasswordToken(item.id);
          if (!token) return;
        }
        item.passwordToken = null;
        copyBtn.disabled = true;
        try {
          let genRes = await sendMsg({
            action: FIXED_ACTIONS.passwordGenerate,
            selectionToken: token,
            length: item.length || 20,
            symbols: item.symbols || "!@#$%&*-_=+?",
            counter: item.counter || 1,
            policy: "ascii-printable-v1",
          });
          if (genRes?.code === "KEYGRAIN_STALE_OPERATION") {
            const freshToken = await acquirePasswordToken(item.id);
            if (freshToken) {
              genRes = await sendMsg({
                action: FIXED_ACTIONS.passwordGenerate,
                selectionToken: freshToken,
                length: item.length || 20,
                symbols: item.symbols || "!@#$%&*-_=+?",
                counter: item.counter || 1,
                policy: "ascii-printable-v1",
              });
            }
          }
          const postStateRes = await sendMsg({action: FIXED_ACTIONS.state});
          if (epoch !== renderEpoch) return;
          const postState = validateStateResponse(postStateRes);
          if (postState.state === "locked") {
            showLockScreen();
            return;
          }
          if (genRes?.ok && genRes.result?.password) {
            if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
              await navigator.clipboard.writeText(genRes.result.password);
              showStatus(statusEl, "Copied!");
              registerTimer(setTimeout(async () => {
                try {
                  if (navigator?.clipboard?.readText) {
                    const current = await navigator.clipboard.readText();
                    if (current === genRes.result.password) await navigator.clipboard.writeText("");
                  }
                } catch (_) {}
              }, 30000));
            }
          } else if (genRes?.code === "KEYGRAIN_EXPIRED") {
            promptReauth({action: "copyPassword", id: item.id});
          }
        } finally {
          copyBtn.disabled = false;
        }
      });
      actions.appendChild(copyBtn);

      // 3. Fill button
      const fillBtn = document.createElement("button");
      fillBtn.className = "fill-btn";
      fillBtn.type = "button";
      fillBtn.title = "Fill credentials";
      fillBtn.innerHTML = SVG_FILL;
      fillBtn.addEventListener("click", async () => {
        let token = item.passwordToken;
        if (!token) {
          if (currentOwnerState === "metadata") {
            promptReauth({action: "fillPassword", id: item.id});
            return;
          }
          token = await acquirePasswordToken(item.id);
          if (!token) return;
        }
        item.passwordToken = null;
        fillBtn.disabled = true;
        try {
          let fillRes = await sendMsg({
            action: FIXED_ACTIONS.passwordFill,
            selectionToken: token,
            length: item.length || 20,
            symbols: item.symbols || "!@#$%&*-_=+?",
            counter: item.counter || 1,
            policy: "ascii-printable-v1",
            fillEmail: true,
          });
          if (fillRes?.code === "KEYGRAIN_STALE_OPERATION") {
            const freshToken = await acquirePasswordToken(item.id);
            if (freshToken) {
              fillRes = await sendMsg({
                action: FIXED_ACTIONS.passwordFill,
                selectionToken: freshToken,
                length: item.length || 20,
                symbols: item.symbols || "!@#$%&*-_=+?",
                counter: item.counter || 1,
                policy: "ascii-printable-v1",
                fillEmail: true,
              });
            }
          }
          const postStateRes = await sendMsg({action: FIXED_ACTIONS.state});
          if (epoch !== renderEpoch) return;
          const postState = validateStateResponse(postStateRes);
          if (postState.state === "locked") {
            showLockScreen();
            return;
          }
          if (fillRes?.ok && fillRes.result?.passwordFilled) {
            showStatus(statusEl, "Credentials filled.");
          } else if (fillRes?.code === "KEYGRAIN_EXPIRED") {
            promptReauth({action: "fillPassword", id: item.id});
          } else {
            showStatus(statusEl, "Active tab does not match or no fillable fields. Try copying instead.");
          }
        } finally {
          fillBtn.disabled = false;
        }
      });
      actions.appendChild(fillBtn);

      // 4. Edit button
      const editBtn = document.createElement("button");
      editBtn.className = "edit-btn";
      editBtn.type = "button";
      editBtn.title = "Edit service";
      editBtn.innerHTML = SVG_EDIT;
      editBtn.addEventListener("click", async () => {
        editBtn.disabled = true;
        try {
          if (currentOwnerState === "metadata") {
            promptReauth({action: "edit", id: item.id});
            return;
          }
          let token = item.detailSelectionToken;
          if (!token) {
            token = await acquireDetailToken(item.id);
          }
          if (!token) {
            promptReauth({action: "edit", id: item.id});
            return;
          }
          item.detailSelectionToken = null;
          let detailRes = await sendMsg({
            action: FIXED_ACTIONS.detail,
            detailSelectionToken: token,
          });
          if (detailRes?.code === "KEYGRAIN_STALE_OPERATION") {
            const freshToken = await acquireDetailToken(item.id);
            if (freshToken) {
              detailRes = await sendMsg({
                action: FIXED_ACTIONS.detail,
                detailSelectionToken: freshToken,
              });
            }
          }
          if (detailRes?.ok && detailRes.result?.item) {
            const detail = detailRes.result.item;
            currentEditToken = detailRes.result.editToken;
            currentEditId = detail.id;
            if (addDialogTitle) addDialogTitle.textContent = "Edit Service";
            if (addConfirm) addConfirm.textContent = "Save";
            if (addEditWarning) addEditWarning.classList.remove("hidden");
            if (addName) addName.value = detail.name || "";
            if (addSite) addSite.value = detail.site || "";
            if (addEmail) addEmail.value = detail.email || "";
            if (addLength) addLength.value = detail.length || 20;
            if (addSymbols) addSymbols.value = detail.symbols || "!@#$%&*-_=+?";
            if (addCounter) addCounter.value = detail.counter || 1;
            rotateSection?.classList.remove("hidden");
            if (addTotpMode) {
              if (detail.totp?.mode === "derived") {
                addTotpMode.value = "derived";
                if (addTotpSeedGroup) addTotpSeedGroup.classList.add("hidden");
                if (addTotpSeed) addTotpSeed.value = "";
              } else if (detail.totp?.mode === "stored") {
                addTotpMode.value = "stored";
                if (addTotpSeedGroup) addTotpSeedGroup.classList.remove("hidden");
                try {
                  if (addTotpSeed) addTotpSeed.value = detail.totp.seed ? atob(detail.totp.seed) : "";
                } catch (_) {
                  if (addTotpSeed) addTotpSeed.value = detail.totp.seed || "";
                }
              } else {
                addTotpMode.value = "";
                if (addTotpSeedGroup) addTotpSeedGroup.classList.add("hidden");
                if (addTotpSeed) addTotpSeed.value = "";
              }
            }
            if (addTotpSection) addTotpSection.open = !!detail.totp?.mode;
            if (addSshKeyname) {
              addSshKeyname.value = detail.ssh?.key_name || "";
            }
            if (addSshSection) addSshSection.open = !!detail.ssh?.key_name;
            addDialog?.classList.remove("hidden");
            addName?.focus();
          } else if (detailRes?.code === "KEYGRAIN_EXPIRED") {
            promptReauth({action: "edit", id: item.id});
          }
        } finally {
          editBtn.disabled = false;
        }
      });
      actions.appendChild(editBtn);

      // 5. Delete button
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.type = "button";
      deleteBtn.title = "Delete service";
      deleteBtn.innerHTML = SVG_DELETE;
      deleteBtn.addEventListener("click", () => {
        if (currentOwnerState === "metadata") {
          promptReauth({action: "delete", id: item.id});
          return;
        }
        deleteTargetId = item.id;
        if (deleteServiceName) {
          deleteServiceName.textContent = item.name || item.site || "this service";
        }
        if (deleteTotpWarning) {
          deleteTotpWarning.classList.toggle("hidden", !item.hasTotp);
        }
        deleteDialog?.classList.remove("hidden");
        deleteCancel?.focus();
      });
      actions.appendChild(deleteBtn);

      row.appendChild(actions);

      // --- Inline TOTP row (if service has TOTP) ---
      if (item.hasTotp) {
        const totpRow = document.createElement("div");
        totpRow.className = "totp-row";

        const badge = document.createElement("span");
        badge.className = "totp-badge";
        badge.textContent = "TOTP";

        const codeSpan = document.createElement("span");
        codeSpan.className = "totp-code";
        codeSpan.textContent = "••••••";

        const countdown = document.createElement("div");
        countdown.className = "totp-countdown";
        const countdownBar = document.createElement("div");
        countdownBar.className = "totp-countdown-bar";
        countdown.appendChild(countdownBar);

        const revealTotpBtn = document.createElement("button");
        revealTotpBtn.className = "totp-reveal-btn";
        revealTotpBtn.type = "button";
        revealTotpBtn.title = "Reveal TOTP";
        revealTotpBtn.innerHTML = SVG_EYE;

        let totpRevealed = false;
        let totpTimer = null;
        let remainingSeconds = 30;

        const updateTotp = async () => {
          let token = item.totpToken;
          if (!token) {
            if (currentOwnerState === "metadata") {
              promptReauth({action: "revealTotp", id: item.id});
              return;
            }
            if (!totpRevealed) return;
            token = await acquireTotpToken(item.id);
            if (!token) return;
          }
          item.totpToken = null;
          try {
            let genRes = await sendMsg({action: FIXED_ACTIONS.totpGenerate, selectionToken: token});
            if (genRes?.code === "KEYGRAIN_STALE_OPERATION") {
              const freshToken = await acquireTotpToken(item.id);
              if (freshToken) {
                genRes = await sendMsg({action: FIXED_ACTIONS.totpGenerate, selectionToken: freshToken});
              }
            }
            if (genRes?.ok && genRes.result?.code) {
              codeSpan.textContent = genRes.result.code;
              const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
              if (countdownBar?.style) countdownBar.style.width = ((remaining / 30) * 100) + "%";
            } else if (genRes?.code === "KEYGRAIN_EXPIRED") {
              promptReauth({action: "revealTotp", id: item.id});
            }
          } catch (_) {}
        };

        revealTotpBtn.addEventListener("click", async () => {
          if (totpRevealed) {
            totpRevealed = false;
            codeSpan.textContent = "••••••";
            if (countdownBar?.style) countdownBar.style.width = "0%";
            revealTotpBtn.innerHTML = SVG_EYE;
            if (totpTimer && typeof clearInterval === "function") clearInterval(totpTimer);
            return;
          }
          totpRevealed = true;
          revealTotpBtn.innerHTML = SVG_EYE_SLASH;
          remainingSeconds = 30 - (Math.floor(Date.now() / 1000) % 30);
          if (countdownBar?.style) countdownBar.style.width = ((remainingSeconds / 30) * 100) + "%";
          await updateTotp();
          if (typeof setInterval === "function") {
            totpTimer = registerTimer(setInterval(async () => {
              if (!totpRevealed) return;
              const currentRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
              if (countdownBar?.style) countdownBar.style.width = ((currentRemaining / 30) * 100) + "%";
              if (currentRemaining > remainingSeconds || currentRemaining === 30) {
                await updateTotp();
              }
              remainingSeconds = currentRemaining;
            }, 1000));
          }
        });

        const copyTotpBtn = document.createElement("button");
        copyTotpBtn.className = "totp-copy-btn";
        copyTotpBtn.type = "button";
        copyTotpBtn.title = "Copy TOTP code";
        copyTotpBtn.innerHTML = SVG_COPY;
        copyTotpBtn.addEventListener("click", async () => {
          copyTotpBtn.disabled = true;
          try {
            let token = item.totpToken;
            if (!token) {
              if (currentOwnerState === "metadata") {
                promptReauth({action: "copyTotp", id: item.id});
              }
              return;
            }
            item.totpToken = null;
            let genRes = await sendMsg({action: FIXED_ACTIONS.totpGenerate, selectionToken: token});
            if (genRes?.code === "KEYGRAIN_STALE_OPERATION") {
              const freshToken = await acquireTotpToken(item.id);
              if (freshToken) {
                genRes = await sendMsg({action: FIXED_ACTIONS.totpGenerate, selectionToken: freshToken});
              }
            }
            if (genRes?.ok && genRes.result?.code) {
              if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(genRes.result.code);
              }
              showStatus(statusEl, "TOTP copied!");
            } else if (genRes?.code === "KEYGRAIN_EXPIRED") {
              promptReauth({action: "copyTotp", id: item.id});
            } else {
              showStatus(statusEl, "Failed to generate TOTP code.");
            }
          } catch (_) {
          } finally {
            copyTotpBtn.disabled = false;
          }
        });

        const fillTotpBtn = document.createElement("button");
        fillTotpBtn.className = "totp-fill-btn";
        fillTotpBtn.type = "button";
        fillTotpBtn.title = "Fill TOTP code";
        fillTotpBtn.innerHTML = SVG_FILL;
        fillTotpBtn.addEventListener("click", async () => {
          fillTotpBtn.disabled = true;
          try {
            let token = item.totpToken;
            if (!token) {
              if (currentOwnerState === "metadata") {
                promptReauth({action: "fillTotp", id: item.id});
              }
              return;
            }
            item.totpToken = null;
            let fillRes = await sendMsg({action: FIXED_ACTIONS.totpFill, selectionToken: token});
            if (fillRes?.code === "KEYGRAIN_STALE_OPERATION") {
              const freshToken = await acquireTotpToken(item.id);
              if (freshToken) {
                fillRes = await sendMsg({action: FIXED_ACTIONS.totpFill, selectionToken: freshToken});
              }
            }
            if (fillRes?.ok) {
              window.close();
            } else if (fillRes?.code === "KEYGRAIN_EXPIRED") {
              promptReauth({action: "fillTotp", id: item.id});
            } else {
              showStatus(statusEl, "The TOTP code could not be delivered.");
            }
          } catch (_) {
          } finally {
            fillTotpBtn.disabled = false;
          }
        });

        totpRow.appendChild(badge);
        totpRow.appendChild(codeSpan);
        totpRow.appendChild(countdown);
        totpRow.appendChild(revealTotpBtn);
        totpRow.appendChild(copyTotpBtn);
        totpRow.appendChild(fillTotpBtn);
        row.appendChild(totpRow);
      }

      // --- Inline SSH row (if service has SSH) ---
      if (item.sshKeyName) {
        const sshRow = document.createElement("div");
        sshRow.className = "ssh-row";

        const badge = document.createElement("span");
        badge.className = "ssh-badge";
        badge.textContent = "SSH";

        const keyName = document.createElement("span");
        keyName.className = "ssh-keyname";
        keyName.textContent = item.sshKeyName;

        const copyPubBtn = document.createElement("button");
        copyPubBtn.className = "ssh-copy-btn";
        copyPubBtn.type = "button";
        copyPubBtn.innerHTML = SVG_COPY + " Copy pubkey";
        copyPubBtn.addEventListener("click", async () => {
          copyPubBtn.disabled = true;
          try {
            let token = item.sshToken;
            if (!token) {
              if (currentOwnerState === "metadata") {
                promptReauth({action: "copyPub", id: item.id});
                return;
              }
              token = await acquireSshToken(item.id);
              if (!token) return;
            }
            item.sshToken = null;
            let genRes = await sendMsg({action: FIXED_ACTIONS.sshGenerate, selectionToken: token});
            if (genRes?.code === "KEYGRAIN_STALE_OPERATION") {
              const freshToken = await acquireSshToken(item.id);
              if (freshToken) {
                genRes = await sendMsg({action: FIXED_ACTIONS.sshGenerate, selectionToken: freshToken});
              }
            }
            if (genRes?.ok && genRes.result?.authorizedKeys) {
              if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(genRes.result.authorizedKeys);
              }
              showStatus(statusEl, "SSH public key copied!");
            } else if (genRes?.code === "KEYGRAIN_EXPIRED") {
              promptReauth({action: "copyPub", id: item.id});
            } else {
              showStatus(statusEl, "Failed to copy SSH public key.");
            }
          } catch (_) {
          } finally {
            copyPubBtn.disabled = false;
          }
        });

        const viewKeysBtn = document.createElement("button");
        viewKeysBtn.className = "ssh-copy-btn";
        viewKeysBtn.type = "button";
        viewKeysBtn.innerHTML = SVG_EYE + " View Keys";
        viewKeysBtn.addEventListener("click", () => {
          openSshDialog(item);
        });

        sshRow.appendChild(badge);
        sshRow.appendChild(keyName);
        sshRow.appendChild(copyPubBtn);
        sshRow.appendChild(viewKeysBtn);
        row.appendChild(sshRow);
      }

      serviceList.appendChild(row);
    }
  }

  function renderItems(items, state) {
    popupRenderItems = items || [];
    renderFullServiceList(popupRenderItems, renderEpoch, state);
  }

  async function requestOwnerView() {
    const epoch = ++renderEpoch;
    clearAllTimers();
    requestInFlight = true;
    if (currentOwnerState === null) {
      showLoadingScreen("Opening Keygrain...");
    }
    try {
      const stateResponse = await sendMsg({action: FIXED_ACTIONS.state});
      if (epoch !== renderEpoch) return;
      if (!stateResponse?.ok) {
        renderItems([]);
        if (stateResponse?.code === "KEYGRAIN_CONSUMER_MIGRATION_REQUIRED") {
          showUpdateRequiredScreen();
        } else {
          showLockScreen();
        }
        return;
      }
      const state = validateStateResponse(stateResponse);
      currentOwnerState = state.state;
      currentSnapshot = state;
      if (state.state === "locked") {
        currentOwnerState = "locked";
        showLockScreen();
        return;
      }

      const action = state.state === "metadata" ? FIXED_ACTIONS.metadata : FIXED_ACTIONS.serviceList;
      const response = await sendMsg({action});
      if (epoch !== renderEpoch) return;

      const deliveryStateResponse = await sendMsg({action: FIXED_ACTIONS.state});
      if (epoch !== renderEpoch) return;
      const deliveryState = validateStateResponse(deliveryStateResponse);
      if (deliveryState.stateGeneration !== state.stateGeneration || deliveryState.authorizationGeneration !== state.authorizationGeneration) return;

      const boundedItems = validateItemsResponse(response);

      if (state.state === "full") {
        const [pwRes, selRes, totpRes, sshRes] = await Promise.all([
          sendMsg({action: FIXED_ACTIONS.passwordOptions}),
          sendMsg({action: FIXED_ACTIONS.selectionOptions}),
          sendMsg({action: FIXED_ACTIONS.totpOptions}),
          sendMsg({action: FIXED_ACTIONS.sshOptions}),
        ]);
        if (epoch !== renderEpoch) return;

        const postCapabilityStateResponse = await sendMsg({action: FIXED_ACTIONS.state});
        if (epoch !== renderEpoch) return;
        const postState = validateStateResponse(postCapabilityStateResponse);
        if (postState.state !== "full" || postState.stateGeneration !== state.stateGeneration || postState.authorizationGeneration !== state.authorizationGeneration) {
          showLockScreen();
          return;
        }

        const pwItems = validatePasswordOptionsResponse(pwRes);
        const selItems = validateSelectionOptionsResponse(selRes);
        const totpItems = validateTotpOptionsResponse(totpRes);
        const sshItems = validateSshOptionsResponse(sshRes);

        const mergedMap = new Map();
        for (const item of boundedItems) {
          mergedMap.set(item.id, {...item});
        }
        for (const item of selItems) {
          const existing = mergedMap.get(item.id) || {id: item.id, site: item.site, name: item.name, email: item.email};
          existing.detailSelectionToken = item.detailSelectionToken;
          mergedMap.set(item.id, existing);
        }
        for (const item of pwItems) {
          const existing = mergedMap.get(item.id) || {id: item.id, site: item.site, name: item.name, email: item.email};
          existing.passwordToken = item.selectionToken;
          mergedMap.set(item.id, existing);
        }
        for (const item of totpItems) {
          if (item.id && mergedMap.has(item.id)) {
            const existing = mergedMap.get(item.id);
            existing.totpToken = item.selectionToken;
            existing.hasTotp = true;
          }
        }
        for (const item of sshItems) {
          if (item.id && mergedMap.has(item.id)) {
            const existing = mergedMap.get(item.id);
            existing.sshToken = item.selectionToken;
            existing.sshKeyName = item.keyName || "id_ed25519";
          }
        }

        let activeHost = "";
        try {
          const tabs = await (globalThis.chrome || globalThis.browser)?.tabs?.query?.({active: true, currentWindow: true});
          if (tabs && tabs[0]?.url) {
            activeHost = new URL(tabs[0].url).hostname.replace(/^www\./, "").toLowerCase();
          }
        } catch (_) {}

        popupRenderItems = Array.from(mergedMap.values());
        if (activeHost && popupRenderItems.length > 0) {
          const hasHostMatch = popupRenderItems.some(s => {
            const site = (s.site || s.name || "").toLowerCase();
            return site === activeHost || activeHost.endsWith("." + site) || site.endsWith("." + activeHost);
          });
          if (hasHostMatch) {
            popupRenderItems.sort((a, b) => {
              const aMatch = (a.site && (a.site.toLowerCase() === activeHost || activeHost.endsWith("." + a.site.toLowerCase()))) ? 1 : 0;
              const bMatch = (b.site && (b.site.toLowerCase() === activeHost || activeHost.endsWith("." + b.site.toLowerCase()))) ? 1 : 0;
              return bMatch - aMatch;
            });
          }
        }
        currentSnapshot = postState;
        if (searchInput?.value?.trim() && typeof getFilteredServices === "function") {
          renderFullServiceList(getFilteredServices(popupRenderItems, searchInput.value.trim()), epoch, state);
        } else {
          renderFullServiceList(popupRenderItems, epoch, state);
        }

        const fullExpiresAt = postState.fullExpiresAt || state.fullExpiresAt;
        if (typeof fullExpiresAt === "number" && fullExpiresAt > 0) {
          const delay = Math.max(0, fullExpiresAt - Date.now());
          if (typeof setTimeout === "function") {
            registerTimer(setTimeout(async () => {
              if (epoch === renderEpoch) await requestOwnerView();
            }, delay + 50));
          }
          if (typeof setInterval === "function") {
            const intervalId = setInterval(async () => {
              if (Date.now() >= fullExpiresAt) {
                if (typeof clearInterval === "function") clearInterval(intervalId);
                if (epoch === renderEpoch) await requestOwnerView();
              }
            }, 1000);
            registerTimer(intervalId);
          }
        }

        if (addBtn) {
          addBtn.hidden = false;
          addBtn.disabled = false;
          addBtn.classList.remove("hidden");
        }
      } else {
        let activeHost = "";
        try {
          const tabs = await (globalThis.chrome || globalThis.browser)?.tabs?.query?.({active: true, currentWindow: true});
          if (tabs && tabs[0]?.url) {
            activeHost = new URL(tabs[0].url).hostname.replace(/^www\./, "").toLowerCase();
          }
        } catch (_) {}

        if (activeHost && boundedItems.length > 0) {
          boundedItems.sort((a, b) => {
            const aMatch = (a.site && (a.site.toLowerCase() === activeHost || activeHost.endsWith("." + a.site.toLowerCase()))) ? 1 : 0;
            const bMatch = (b.site && (b.site.toLowerCase() === activeHost || activeHost.endsWith("." + b.site.toLowerCase()))) ? 1 : 0;
            return bMatch - aMatch;
          });
        }
        renderItems(boundedItems, state);

        const metadataExpiresAt = state.metadataExpiresAt;
        if (typeof metadataExpiresAt === "number" && metadataExpiresAt > 0) {
          const delay = Math.max(0, metadataExpiresAt - Date.now());
          if (typeof setTimeout === "function") {
            registerTimer(setTimeout(async () => {
              if (epoch === renderEpoch) await requestOwnerView();
            }, delay + 50));
          }
          if (typeof setInterval === "function") {
            const intervalId = setInterval(async () => {
              if (Date.now() >= metadataExpiresAt) {
                if (typeof clearInterval === "function") clearInterval(intervalId);
                if (epoch === renderEpoch) await requestOwnerView();
              }
            }, 1000);
            registerTimer(intervalId);
          }
        }

        if (addBtn) {
          addBtn.hidden = false;
          addBtn.disabled = false;
          addBtn.classList.remove("hidden");
        }
      }
      showMainScreen();
    } catch (error) {
      if (epoch === renderEpoch) {
        renderItems([]);
        showLockScreen();
        showStatus(statusEl, safeFailureMessage(error));
      }
    } finally {
      requestInFlight = false;
    }
  }

  // Credentials are sent directly to the background script via runtime message
  async function unlockFromForm() {
    if (requestInFlight) return;
    const email = emailInput?.value || "";
    const secret = secretInput?.value || "";
    if (!email || !secret) return;
    requestInFlight = true;
    unlockBtn && (unlockBtn.disabled = true);
    try {
      const challengeResponse = await sendMsg({action: "issueUnlockChallenge", popupSessionId});
      if (!challengeResponse?.ok) {
        globalThis.KeygrainDiagnostics?.recordWorkerResponse(challengeResponse);
        const errMsg = challengeResponse?.message || "Unlock failed; try again.";
        showLockError(errMsg);
        showStatus(statusEl, errMsg);
        return;
      }
      const envelope = await KeygrainWorkerIngress.makeEnvelope(challengeResponse.challenge, email, secret, {crypto});
      const unlockResponse = await sendMsg({action: "unlockEncrypted", popupSessionId, envelope});
      const response = unlockResponse;
      if (emailInput) emailInput.value = "";
      if (secretInput) secretInput.value = "";
      if (response?.ok) {
        clearLockError();
        await requestOwnerView();
      } else {
        if (!response?.ok) {
          globalThis.KeygrainDiagnostics?.recordWorkerResponse(response);
          if (response?.code === "ACCOUNT_NOT_FOUND") {
            showLockError("", "No account found for this email address.<br><a href=\"#\" id=\"lock-switch-create\">Create a new account</a>");
          } else {
            showStatus(statusEl, response?.message || "Unlock failed; try again.");
            showLockError(response?.message || "Unlock failed; try again.");
          }
        }
      }
    } catch (_) {
      globalThis.KeygrainDiagnostics?.record("popup_message_transport_failure");
      showLockError("Unlock failed; try again.");
      showStatus(statusEl, "Unlock failed; try again.");
    } finally {
      if (emailInput) emailInput.value = "";
      if (secretInput) secretInput.value = "";
      requestInFlight = false;
      unlockBtn && (unlockBtn.disabled = false);
    }
  }

  async function failClosedLeaseExtension() {
    const response = await sendMsg({action: "extendSensitive"});
    if (response?.code === "KEYGRAIN_CONSUMER_MIGRATION_REQUIRED") showUpdateRequiredScreen();
    autolockWarning?.classList.add("hidden");
  }

  async function createAccountFromForm() {
    if (requestInFlight) return;
    const email = emailInput?.value?.trim() || "";
    const confirmEmail = confirmEmailInput?.value?.trim() || "";
    const secret = secretInput?.value || "";
    const confirmSecret = confirmSecretInput?.value || "";
    if (!email || !confirmEmail || !secret || !confirmSecret) {
      showLockError("Please fill in all fields.");
      showStatus(statusEl, "Please fill in all fields.");
      return;
    }
    if (email.toLowerCase() !== confirmEmail.toLowerCase()) {
      showLockError("Emails do not match.");
      showStatus(statusEl, "Emails do not match.");
      return;
    }
    if (secret !== confirmSecret) {
      showLockError("Master secrets do not match.");
      showStatus(statusEl, "Master secrets do not match.");
      return;
    }
    requestInFlight = true;
    if (createBtn) createBtn.disabled = true;
    try {
      const challengeResponse = await sendMsg({action: "issueUnlockChallenge", popupSessionId});
      if (!challengeResponse?.ok) {
        globalThis.KeygrainDiagnostics?.recordWorkerResponse(challengeResponse);
        const errMsg = challengeResponse?.message || "Account creation failed; try again.";
        showLockError(errMsg);
        showStatus(statusEl, errMsg);
        return;
      }
      const envelope = await KeygrainWorkerIngress.makeEnvelope(challengeResponse.challenge, email, secret, {crypto});
      const unlockResponse = await sendMsg({action: "unlockEncrypted", popupSessionId, envelope, isCreate: true});
      if (emailInput) emailInput.value = "";
      if (secretInput) secretInput.value = "";
      if (confirmEmailInput) confirmEmailInput.value = "";
      if (confirmSecretInput) confirmSecretInput.value = "";
      if (confirmEmailMatch) confirmEmailMatch.textContent = "";
      if (confirmSecretMatch) confirmSecretMatch.textContent = "";
      clearFingerprint();
      clearConfirmFingerprint();
      if (unlockResponse?.ok) {
        clearLockError();
        await requestOwnerView();
      } else {
        globalThis.KeygrainDiagnostics?.recordWorkerResponse(unlockResponse);
        if (unlockResponse?.code === "ACCOUNT_EXISTS") {
          showLockError("", "An account already exists for this email address.<br><a href=\"#\" id=\"lock-switch-unlock\">Switch to Unlock Account</a>");
        } else {
          const errMsg = unlockResponse?.message || "Account creation failed; try again.";
          showLockError(errMsg);
          showStatus(statusEl, errMsg);
        }
      }
    } catch (_) {
      globalThis.KeygrainDiagnostics?.record("popup_message_transport_failure");
      showLockError("Account creation failed; try again.");
      showStatus(statusEl, "Account creation failed; try again.");
    } finally {
      if (emailInput) emailInput.value = "";
      if (secretInput) secretInput.value = "";
      if (confirmEmailInput) confirmEmailInput.value = "";
      if (confirmSecretInput) confirmSecretInput.value = "";
      if (confirmEmailMatch) confirmEmailMatch.textContent = "";
      if (confirmSecretMatch) confirmSecretMatch.textContent = "";
      clearFingerprint();
      clearConfirmFingerprint();
      requestInFlight = false;
      if (createBtn) createBtn.disabled = false;
    }
  }

  let pendingReauthAction = null;

  async function unlockForReauth(email, secret) {
    if (!email || !secret) return false;
    try {
      const challengeResponse = await sendMsg({action: "issueUnlockChallenge", popupSessionId});
      if (!challengeResponse?.ok) return false;
      const envelope = await KeygrainWorkerIngress.makeEnvelope(challengeResponse.challenge, email, secret, {crypto});
      const unlockResponse = await sendMsg({action: "unlockEncrypted", popupSessionId, envelope});
      if (unlockResponse?.ok) {
        await requestOwnerView();
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function executePendingAction(intent) {
    if (!intent) return;
    if (typeof intent === "function") {
      try { intent(); } catch (_) {}
      return;
    }
    if (typeof intent.action === "function") {
      try { intent.action(); } catch (_) {}
      return;
    }
    if (intent.action === "add") {
      addBtn?.click();
      return;
    }
    if (intent.action === "addConfirm") {
      addConfirm?.click();
      return;
    }
    if (intent.action === "deleteConfirm") {
      deleteConfirm?.click();
      return;
    }
    if (intent.id && intent.action) {
      let row = serviceList?.querySelector(`[data-service-id="${CSS.escape(intent.id)}"]`);
      if (!row) {
        if (searchInput && searchInput.value) {
          searchInput.value = "";
          renderFullServiceList(popupRenderItems, renderEpoch, currentSnapshot);
          row = serviceList?.querySelector(`[data-service-id="${CSS.escape(intent.id)}"]`);
        }
      }
      if (!row) return;
      if (intent.action === "fillPassword") {
        row.querySelector(".fill-btn")?.click();
      } else if (intent.action === "copyPassword") {
        row.querySelector(".copy-btn")?.click();
      } else if (intent.action === "togglePassword") {
        row.querySelector(".toggle-btn")?.click();
      } else if (intent.action === "revealTotp") {
        row.querySelector(".totp-reveal-btn")?.click();
      } else if (intent.action === "copyTotp") {
        row.querySelector(".totp-copy-btn")?.click();
      } else if (intent.action === "fillTotp") {
        row.querySelector(".totp-fill-btn")?.click();
      } else if (intent.action === "copyPub") {
        row.querySelector(".ssh-copy-btn")?.click();
      } else if (intent.action === "edit") {
        row.querySelector(".edit-btn")?.click();
      } else if (intent.action === "delete") {
        row.querySelector(".delete-btn")?.click();
      }
    }
  }

  function promptReauth(onSuccess) {
    pendingReauthAction = onSuccess;
    if (reauthSecret) reauthSecret.value = "";
    if (reauthError) {
      reauthError.textContent = "";
      reauthError.classList.add("hidden");
    }
    clearReauthFingerprint();
    reauthDialog?.classList.remove("hidden");
    reauthSecret?.focus();
  }

  reauthSecret?.addEventListener("input", () => {
    if (reauthError) {
      reauthError.textContent = "";
      reauthError.classList.add("hidden");
    }
    scheduleReauthFingerprint();
  });
  reauthSecret?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      reauthConfirm?.click();
    }
  });

  reauthCancel?.addEventListener("click", () => {
    reauthDialog?.classList.add("hidden");
    if (reauthSecret) reauthSecret.value = "";
    if (reauthError) {
      reauthError.textContent = "";
      reauthError.classList.add("hidden");
    }
    clearReauthFingerprint();
    pendingReauthAction = null;
    const sessionStore = (globalThis.chrome || globalThis.browser)?.storage?.session;
    sessionStore?.remove?.("pendingAutofillIntent")?.catch?.(() => {});
  });

  reauthConfirm?.addEventListener("click", async () => {
    const secret = reauthSecret?.value || "";
    if (!secret) return;
    reauthConfirm.disabled = true;
    try {
      const unlockState = await sendMsg({action: "getUnlockState"});
      const email = unlockState?.email || unlockState?.result?.email || currentSnapshot?.email || "";
      if (!email) {
        showStatus(statusEl, "Account email not found; please unlock from start.");
        reauthDialog?.classList.add("hidden");
        clearReauthFingerprint();
        showLockScreen();
        return;
      }
      const ok = await unlockForReauth(email, secret);
      if (ok) {
        reauthDialog?.classList.add("hidden");
        if (reauthSecret) reauthSecret.value = "";
        if (reauthError) {
          reauthError.textContent = "";
          reauthError.classList.add("hidden");
        }
        clearReauthFingerprint();
        if (pendingReauthAction) {
          const actionToRun = pendingReauthAction;
          pendingReauthAction = null;
          const sessionStore = (globalThis.chrome || globalThis.browser)?.storage?.session;
          sessionStore?.remove?.("pendingAutofillIntent")?.catch?.(() => {});
          executePendingAction(actionToRun);
        }
      } else {
        if (reauthSecret) {
          reauthSecret.value = "";
          reauthSecret.focus();
        }
        clearReauthFingerprint();
        if (reauthError) {
          reauthError.textContent = "Master secret incorrect; try again.";
          reauthError.classList.remove("hidden");
        }
        showStatus(statusEl, "Master secret incorrect; try again.");
      }
    } finally {
      reauthConfirm.disabled = false;
    }
  });

  function disableUnimplementedControls() {
    for (const id of [
      "pin-unlock-btn", "pin-use-secret", "pin-skip-btn", "pin-save-btn", "pin-setup-banner", "export-btn",
    ]) {
      const element = document.getElementById(id);
      if (element) {
        element.disabled = true;
        element.hidden = true;
        if (typeof element.setAttribute === "function") element.setAttribute("aria-hidden", "true");
      }
    }
    if (resetConfirmBtn) resetConfirmBtn.disabled = true;
  }

  async function getCurrentShortcut() {
    try {
      if (chrome.commands && typeof chrome.commands.getAll === "function") {
        return typeof pickShortcut === "function" ? pickShortcut(await chrome.commands.getAll()) : "";
      }
      return "";
    } catch (_) {
      return "";
    }
  }

  async function renderShortcutSettings() {
    const shortcutStepsEl = document.getElementById("shortcut-customize-steps");
    const shortcutOpenBtn = document.getElementById("shortcut-open-btn");
    const shortcutCurrent = document.getElementById("shortcut-current");
    const shortcutCurrentNote = document.getElementById("shortcut-current-note");
    if (!shortcutStepsEl || typeof shortcutCustomizeInfo !== "function") return;
    const isFirefox = typeof browser !== "undefined" && !!browser?.runtime;
    const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");
    const info = shortcutCustomizeInfo(isFirefox);
    shortcutStepsEl.textContent = "";
    info.steps.forEach(step => {
      const li = document.createElement("li");
      li.textContent = step;
      shortcutStepsEl.appendChild(li);
    });
    if (shortcutOpenBtn) shortcutOpenBtn.classList.toggle("hidden", info.method !== "tabs");
    if (shortcutCurrent) shortcutCurrent.textContent = "Not set";
    const shortcut = await getCurrentShortcut();
    const hint = typeof shortcutHintText === "function" ? shortcutHintText({shortcut, isMac}) : {label: shortcut, isSet: !!shortcut};
    if (shortcutCurrent) shortcutCurrent.textContent = hint.isSet ? hint.label : "Not set";
    if (shortcutCurrentNote) shortcutCurrentNote.classList.toggle("hidden", hint.isSet);
  }

  function openShortcutCustomize() {
    if (typeof shortcutCustomizeInfo !== "function") return;
    const isFirefox = typeof browser !== "undefined" && !!browser?.runtime;
    const info = shortcutCustomizeInfo(isFirefox);
    if (info.method === "tabs") {
      try { chrome.tabs.create({url: info.url}); } catch (_) {}
    }
  }

  const shortcutOpenBtn = document.getElementById("shortcut-open-btn");
  const shortcutCopyBtn = document.getElementById("shortcut-copy-url");
  shortcutOpenBtn?.addEventListener("click", openShortcutCustomize);
  shortcutCopyBtn?.addEventListener("click", async () => {
    if (typeof shortcutCustomizeInfo !== "function") return;
    const isFirefox = typeof browser !== "undefined" && !!browser?.runtime;
    const info = shortcutCustomizeInfo(isFirefox);
    try {
      await navigator.clipboard.writeText(info.url);
      showStatus(statusEl, "URL copied to clipboard.");
    } catch (_) {
      showStatus(statusEl, "Failed to copy URL.");
    }
  });

  const shortcutTip = document.getElementById("shortcut-tip");
  const shortcutTipDismiss = document.getElementById("shortcut-tip-dismiss");
  const shortcutTipCustomize = document.getElementById("shortcut-tip-customize");
  shortcutTipDismiss?.addEventListener("click", () => {
    shortcutTip?.classList.add("hidden");
  });
  shortcutTipCustomize?.addEventListener("click", () => {
    settingsBtn?.click();
  });

  // --- Add / Edit Dialog Handlers ---
  addBtn?.addEventListener("click", async () => {
    const stRes = await sendMsg({action: FIXED_ACTIONS.state});
    if (stRes?.result?.state === "metadata") {
      promptReauth({action: "add"});
      return;
    }
    currentEditToken = null;
    currentEditId = null;
    if (addDialogTitle) addDialogTitle.textContent = "Add Service";
    if (addConfirm) addConfirm.textContent = "Add";
    if (addEditWarning) addEditWarning.classList.add("hidden");
    if (addName) addName.value = "";
    if (addSite) addSite.value = "";
    if (addEmail) addEmail.value = "";
    if (addLength) addLength.value = 20;
    if (addSymbols) addSymbols.value = "!@#$%&*-_=+?";
    if (addCounter) addCounter.value = 1;
    if (addTotpMode) addTotpMode.value = "";
    if (addTotpSeed) addTotpSeed.value = "";
    addTotpSeedGroup?.classList.add("hidden");
    if (addTotpSection) addTotpSection.open = false;
    if (addSshKeyname) addSshKeyname.value = "";
    if (addSshSection) addSshSection.open = false;
    rotateSection?.classList.add("hidden");
    addDialog?.classList.remove("hidden");
    addName?.focus();
  });

  addTotpMode?.addEventListener("change", () => {
    addTotpSeedGroup?.classList.toggle("hidden", addTotpMode.value !== "stored");
  });

  addCancel?.addEventListener("click", () => {
    addDialog?.classList.add("hidden");
    currentEditToken = null;
    currentEditId = null;
  });

  rotateBtn?.addEventListener("click", () => {
    if (addCounter) {
      const cur = parseInt(addCounter.value, 10) || 1;
      addCounter.value = cur + 1;
    }
  });

  addConfirm?.addEventListener("click", async () => {
    const site = addSite?.value.trim() || "";
    const name = addName?.value.trim() || null;
    const email = addEmail?.value.trim() || "";
    const length = parseInt(addLength?.value, 10) || 20;
    const symbols = addSymbols?.value || "!@#$%&*-_=+?";
    const counter = parseInt(addCounter?.value, 10) || 1;

    if (!site || !email) {
      showStatus(statusEl, "Site and email are required.");
      return;
    }

    addConfirm.disabled = true;
    try {
      let totp = undefined;
      const totpModeVal = addTotpMode?.value || "";
      if (totpModeVal === "derived") {
        totp = {mode: "derived", digits: 6, period: 30, algorithm: "SHA1"};
      } else if (totpModeVal === "stored") {
        const seedVal = addTotpSeed?.value.trim().toUpperCase() || "";
        if (!seedVal) {
          showStatus(statusEl, "Seed is required for stored TOTP.");
          addConfirm.disabled = false;
          return;
        }
        totp = {mode: "stored", seed: btoa(seedVal), digits: 6, period: 30, algorithm: "SHA1"};
      } else if (currentEditToken) {
        totp = null;
      }

      let ssh = undefined;
      const sshKeyNameVal = addSshKeyname?.value.trim() || "";
      if (sshKeyNameVal) {
        ssh = {key_name: sshKeyNameVal, counter: 1};
      } else if (currentEditToken) {
        ssh = null;
      }

      const patch = {
        site, name, email, length, symbols, counter,
        characterPolicyPresent: false, characterPolicy: null,
      };
      if (totp !== undefined) patch.totp = totp;
      if (ssh !== undefined) patch.ssh = ssh;

      let res;
      if (currentEditToken) {
        res = await sendMsg({action: FIXED_ACTIONS.edit, editToken: currentEditToken, patch});
      } else {
        res = await sendMsg({action: FIXED_ACTIONS.add, patch});
      }
      if (res?.code === "KEYGRAIN_STALE_OPERATION" && currentEditId) {
        const freshDetailToken = await acquireDetailToken(currentEditId);
        if (freshDetailToken) {
          const detailRes = await sendMsg({
            action: FIXED_ACTIONS.detail,
            detailSelectionToken: freshDetailToken,
          });
          if (detailRes?.ok && detailRes.result?.editToken) {
            currentEditToken = detailRes.result.editToken;
            res = await sendMsg({action: FIXED_ACTIONS.edit, editToken: currentEditToken, patch});
          }
        }
      }
      if (res?.ok) {
        addDialog?.classList.add("hidden");
        currentEditToken = null;
        currentEditId = null;
        await requestOwnerView();
        showStatus(statusEl, "Service saved.");
      } else if (res?.code === "KEYGRAIN_EXPIRED") {
        promptReauth({action: "addConfirm"});
      } else {
        showStatus(statusEl, safeFailureMessage(res));
      }
    } finally {
      addConfirm.disabled = false;
    }
  });

  // --- Delete Dialog Handlers ---
  deleteCancel?.addEventListener("click", () => {
    deleteDialog?.classList.add("hidden");
    deleteTotpWarning?.classList.add("hidden");
    deleteTargetId = null;
  });

  deleteConfirm?.addEventListener("click", async () => {
    if (!deleteTargetId) return;
    deleteConfirm.disabled = true;
    try {
      const res = await sendMsg({action: FIXED_ACTIONS.delete, id: deleteTargetId});
      if (res?.ok) {
        deleteDialog?.classList.add("hidden");
        deleteTotpWarning?.classList.add("hidden");
        deleteTargetId = null;
        await requestOwnerView();
        showStatus(statusEl, "Service deleted.");
      } else if (res?.code === "KEYGRAIN_EXPIRED") {
        promptReauth({action: "deleteConfirm"});
      } else {
        showStatus(statusEl, safeFailureMessage(res));
      }
    } finally {
      deleteConfirm.disabled = false;
    }
  });

  // --- In-page Autofill Settings & Permissions ---
  async function requestWebPermissions(permObj) {
    const perms = globalThis.browser?.permissions || globalThis.chrome?.permissions;
    if (!perms || typeof perms.request !== "function") return false;
    try {
      const res = perms.request(permObj);
      if (res && typeof res.then === "function") return !!(await res);
      return new Promise((resolve) => perms.request(permObj, (g) => resolve(!!g)));
    } catch (_) {
      return false;
    }
  }

  async function containsWebPermissions(permObj) {
    const perms = globalThis.browser?.permissions || globalThis.chrome?.permissions;
    if (!perms || typeof perms.contains !== "function") return false;
    try {
      const res = perms.contains(permObj);
      if (res && typeof res.then === "function") return !!(await res);
      return new Promise((resolve) => perms.contains(permObj, (has) => resolve(!!has)));
    } catch (_) {
      return false;
    }
  }

  async function removeWebPermissions(permObj) {
    const perms = globalThis.browser?.permissions || globalThis.chrome?.permissions;
    if (!perms || typeof perms.remove !== "function") return false;
    try {
      const res = perms.remove(permObj);
      if (res && typeof res.then === "function") return !!(await res);
      return new Promise((resolve) => perms.remove(permObj, (r) => resolve(!!r)));
    } catch (_) {
      return false;
    }
  }

  inlineAutofillToggle?.addEventListener("change", () => {
    if (inlineAutofillToggle.checked) {
      inlineConsentDialog?.classList.remove("hidden");
      inlineConsentCancel?.focus();
    } else {
      void onInlineToggleOff();
    }
  });

  inlineConsentCancel?.addEventListener("click", () => {
    if (inlineAutofillToggle) inlineAutofillToggle.checked = false;
    inlineConsentDialog?.classList.add("hidden");
  });

  inlineConsentConfirm?.addEventListener("click", async () => {
    try {
      const granted = await requestWebPermissions({origins: ["*://*/*"]});
      if (!granted) {
        if (inlineAutofillToggle) inlineAutofillToggle.checked = false;
        inlineConsentDialog?.classList.add("hidden");
        showStatus(statusEl, "No problem — you can turn this on later.");
        return;
      }
      await sendMsg({action: FIXED_ACTIONS.settings, patch: {inPageAutofill: true}});
    } catch (_) {}
    inlineConsentDialog?.classList.add("hidden");
    showStatus(statusEl, "In-page autofill turned on.");
  });

  async function onInlineToggleOff() {
    try {
      await removeWebPermissions({origins: ["*://*/*"]});
      await sendMsg({action: FIXED_ACTIONS.settings, patch: {inPageAutofill: false}});
    } catch (_) {}
    showStatus(statusEl, "In-page autofill turned off.");
  }

  // --- Settings Panel Handlers ---
  settingsBtn?.addEventListener("click", async () => {
    const response = await sendMsg({action: FIXED_ACTIONS.state});
    if (response?.ok && response.result?.state !== "locked") {
      try {
        const secretTimeoutGroup = document.getElementById("secret-timeout-group");
        if (secretTimeoutGroup) {
          secretTimeoutGroup.style.display = "";
        }
        const settingsRes = await sendMsg({action: FIXED_ACTIONS.settings, patch: {}});
        const currentSettings = settingsRes?.result?.settings;
        if (currentSettings) {
          const timeoutInput = document.getElementById("set-lock-timeout");
          const metaTimeoutInput = document.getElementById("set-metadata-timeout");
          const lengthInput = document.getElementById("set-length");
          const symbolsInput = document.getElementById("set-symbols");
          const serverUrlInput = document.getElementById("set-server-url");
          if (timeoutInput && currentSettings.fullLeaseSeconds !== undefined) {
            timeoutInput.value = String(currentSettings.fullLeaseSeconds);
          }
          if (metaTimeoutInput && currentSettings.metadataTailSeconds !== undefined) {
            metaTimeoutInput.value = String(currentSettings.metadataTailSeconds);
          }
          if (lengthInput && currentSettings.defaultLength) lengthInput.value = currentSettings.defaultLength;
          if (symbolsInput && currentSettings.defaultSymbols) symbolsInput.value = currentSettings.defaultSymbols;
          if (serverUrlInput && currentSettings.serverUrl) serverUrlInput.value = currentSettings.serverUrl;
          if (inlineAutofillToggle) {
            let hasPerm = false;
            try {
              hasPerm = await containsWebPermissions({origins: ["*://*/*"]});
            } catch (_) {}
            inlineAutofillToggle.checked = !!(currentSettings.inPageAutofill && hasPerm);
          }
        }
      } catch (_) {}
      await renderShortcutSettings();
      settingsPanel?.classList.remove("hidden");
    }
  });

  settingsCancel?.addEventListener("click", () => {
    settingsPanel?.classList.add("hidden");
  });

  settingsSave?.addEventListener("click", async () => {
    try {
      settingsSave.disabled = true;
      const timeout = document.getElementById("set-lock-timeout")?.value;
      const metaTimeout = document.getElementById("set-metadata-timeout")?.value;
      const length = document.getElementById("set-length")?.value;
      const symbols = document.getElementById("set-symbols")?.value;
      const serverUrl = document.getElementById("set-server-url")?.value;
      const patch = {
        defaultLength: parseInt(length, 10) || 20,
        defaultSymbols: symbols || "!@#$%&*-_=+?",
      };
      if (serverUrl) patch.serverUrl = serverUrl;
      if (timeout !== undefined && timeout !== "") {
        patch.fullLeaseSeconds = parseInt(timeout, 10);
      }
      if (metaTimeout !== undefined && metaTimeout !== "") {
        patch.metadataTailSeconds = parseInt(metaTimeout, 10);
      }
      const response = await sendMsg({action: FIXED_ACTIONS.settings, patch});
      if (response && response.ok) {
        settingsPanel?.classList.add("hidden");
        requestOwnerView();
        showStatus(statusEl, "Settings saved.");
      }
    } finally {
      settingsSave.disabled = false;
    }
  });

  async function triggerLeaseExtension() {
    try {
      const res = await sendMsg({action: FIXED_ACTIONS.extendLease});
      if (res?.ok) {
        await requestOwnerView();
      }
    } catch (_) {}
  }

  headerExtendBtn?.addEventListener("click", triggerLeaseExtension);

  // --- Menu Dropdown Handlers ---
  menuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!menuDropdown) return;
    const isHidden = menuDropdown.classList.contains("hidden");
    menuDropdown.classList.toggle("hidden", !isHidden);
    menuBtn?.setAttribute?.("aria-expanded", String(isHidden));
  });

  window.addEventListener("click", (e) => {
    if (menuDropdown && !menuDropdown.classList.contains("hidden") && !menuDropdown.contains(e.target) && e.target !== menuBtn) {
      menuDropdown.classList.add("hidden");
      menuBtn?.setAttribute?.("aria-expanded", "false");
    }
  });

  menuLockSecret?.addEventListener("click", async () => {
    menuDropdown?.classList.add("hidden");
    try {
      await sendMsg({action: FIXED_ACTIONS.lockSensitive});
    } catch (_) {}
    await requestOwnerView();
  });

  menuLockAll?.addEventListener("click", async () => {
    menuDropdown?.classList.add("hidden");
    try {
      await sendMsg({action: FIXED_ACTIONS.lockAll});
    } catch (_) {}
    showLockScreen();
  });

  lockBtn?.addEventListener("click", async () => {
    try {
      if (currentOwnerState === "full") {
        await sendMsg({action: FIXED_ACTIONS.lockSensitive});
        await requestOwnerView();
      } else {
        await sendMsg({action: FIXED_ACTIONS.lockAll});
        showLockScreen();
      }
    } catch (_) {
      showLockScreen();
    }
  });

  exportBtn?.addEventListener("click", () => {
    menuDropdown?.classList.add("hidden");
    showStatus(statusEl, "Export is not available in this version.");
  });

  importBtn?.addEventListener("click", () => {
    menuDropdown?.classList.add("hidden");
    chrome.tabs.create({url: chrome.runtime.getURL("import.html")});
  });

  migrateBtn?.addEventListener("click", () => {
    menuDropdown?.classList.add("hidden");
    chrome.tabs.create({url: chrome.runtime.getURL("migrate.html")});
  });

  walletBtn?.addEventListener("click", () => {
    menuDropdown?.classList.add("hidden");
    chrome.tabs.create({url: chrome.runtime.getURL("wallet-page.html")});
  });

  helpBtn?.addEventListener("click", () => {
    menuDropdown?.classList.add("hidden");
    chrome.tabs.create({url: "https://keygrain.com/faq"});
  });

  offlineBtn?.addEventListener("click", () => {
    menuDropdown?.classList.add("hidden");
    const currentChecked = offlineBtn?.getAttribute?.("aria-checked") === "true";
    const newOffline = !currentChecked;
    offlineBtn?.setAttribute?.("aria-checked", String(newOffline));
    showStatus(statusEl, newOffline ? "Offline mode on — sync paused." : "Offline mode off — syncing.");
  });

  switchAccountBtn?.addEventListener("click", () => {
    menuDropdown?.classList.add("hidden");
    switchAccountDialog?.classList.remove("hidden");
    switchAccountCancel?.focus();
  });

  switchAccountLock?.addEventListener("click", (e) => {
    e.preventDefault();
    switchAccountDialog?.classList.remove("hidden");
    switchAccountCancel?.focus();
  });

  switchAccountCancel?.addEventListener("click", () => {
    switchAccountDialog?.classList.add("hidden");
  });

  switchAccountConfirm?.addEventListener("click", async () => {
    switchAccountDialog?.classList.add("hidden");
    try {
      await sendMsg({action: FIXED_ACTIONS.switchAccount});
    } catch (_) {}
    showLockScreen();
    showStatus(statusEl, "Account switched. Enter a different email and master secret.");
  });

  deleteServerBtn?.addEventListener("click", () => {
    menuDropdown?.classList.add("hidden");
    deleteServerDialog?.classList.remove("hidden");
    deleteServerCancel?.focus();
  });

  deleteServerCancel?.addEventListener("click", () => {
    deleteServerDialog?.classList.add("hidden");
  });

  deleteServerConfirm?.addEventListener("click", async () => {
    deleteServerDialog?.classList.add("hidden");
    showStatus(statusEl, "Server data deletion requested.");
  });

  // --- Enter Key Event Handlers for All Forms & Dialogs ---
  emailInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (authMode === "create") {
        if (!createBtn?.disabled) createAccountFromForm();
        else confirmEmailInput?.focus();
      } else {
        if (!unlockBtn?.disabled) unlockFromForm();
        else secretInput?.focus();
      }
    }
  });
  confirmEmailInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (authMode === "create") {
        if (!createBtn?.disabled) createAccountFromForm();
        else secretInput?.focus();
      }
    }
  });
  secretInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (authMode === "create") {
        if (!createBtn?.disabled) createAccountFromForm();
        else confirmSecretInput?.focus();
      } else {
        if (!unlockBtn?.disabled) unlockFromForm();
      }
    }
  });
  confirmSecretInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!createBtn?.disabled) createAccountFromForm();
    }
  });
  const pinInput = document.getElementById("pin-input");
  pinInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); unlockFromPin(); }
  });
  [addName, addSite, addEmail, addLength, addSymbols, addCounter, addTotpSeed, addSshKeyname].forEach((input) => {
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addConfirm?.click(); }
    });
  });
  const setLockTimeoutInput = document.getElementById("set-lock-timeout");
  const setMetadataTimeoutInput = document.getElementById("set-metadata-timeout");
  const setLengthInput = document.getElementById("set-length");
  const setSymbolsInput = document.getElementById("set-symbols");
  const setServerUrlInput = document.getElementById("set-server-url");
  [setLockTimeoutInput, setMetadataTimeoutInput, setLengthInput, setSymbolsInput, setServerUrlInput].forEach((input) => {
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); settingsSave?.click(); }
    });
  });

  // --- Initialization ---
  const manifest = chrome.runtime.getManifest();
  if (versionDisplay && manifest) versionDisplay.textContent = manifest.name + " v" + manifest.version;
  disableUnimplementedControls();
  startCountdownTicker();
  startHeartbeat();

  authModeUnlock?.addEventListener("click", () => setAuthMode("unlock"));
  authModeCreate?.addEventListener("click", () => setAuthMode("create"));

  emailInput?.addEventListener("input", () => {
    clearLockError();
    if (authMode === "create") {
      updateCreateButtonState();
    } else {
      if (unlockBtn) unlockBtn.disabled = !emailInput.value || !secretInput?.value;
    }
  });
  confirmEmailInput?.addEventListener("input", () => {
    clearLockError();
    updateCreateButtonState();
  });
  secretInput?.addEventListener("input", () => {
    clearLockError();
    if (authMode === "create") {
      updateCreateButtonState();
    } else {
      if (unlockBtn) unlockBtn.disabled = !emailInput?.value || !secretInput.value;
    }
    scheduleFingerprint();
  });
  confirmSecretInput?.addEventListener("input", () => {
    clearLockError();
    updateCreateButtonState();
    scheduleConfirmFingerprint();
  });
  unlockBtn?.addEventListener("click", unlockFromForm);
  createBtn?.addEventListener("click", createAccountFromForm);

  searchInput?.addEventListener("input", () => {
    const query = searchInput.value.trim();
    if (query && typeof getFilteredServices === "function") {
      renderFullServiceList(getFilteredServices(popupRenderItems, query));
    } else {
      renderFullServiceList(popupRenderItems);
    }
  });

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const firstItem = serviceList?.querySelector(".service-item");
      if (firstItem) {
        const targetBtn = firstItem.querySelector(".fill-btn") || firstItem.querySelector(".copy-btn") || firstItem;
        targetBtn.focus();
      }
    } else if (e.key === "Enter") {
      const firstItem = serviceList?.querySelector(".service-item");
      if (firstItem) {
        e.preventDefault();
        const targetBtn = firstItem.querySelector(".fill-btn") || firstItem.querySelector(".copy-btn");
        if (targetBtn) targetBtn.click();
      }
    }
  });

  serviceList?.addEventListener("keydown", (e) => {
    const currentItem = e.target?.closest?.(".service-item");
    if (!currentItem) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      let next = currentItem.nextElementSibling;
      while (next && !next.classList.contains("service-item")) {
        next = next.nextElementSibling;
      }
      if (next) {
        const targetBtn = next.querySelector(".fill-btn") || next.querySelector(".copy-btn") || next;
        targetBtn.focus();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      let prev = currentItem.previousElementSibling;
      while (prev && !prev.classList.contains("service-item")) {
        prev = prev.previousElementSibling;
      }
      if (prev) {
        const targetBtn = prev.querySelector(".fill-btn") || prev.querySelector(".copy-btn") || prev;
        targetBtn.focus();
      } else if (searchInput) {
        searchInput.focus();
      }
    } else if (e.key === "Enter" && e.target === currentItem) {
      e.preventDefault();
      const targetBtn = currentItem.querySelector(".fill-btn") || currentItem.querySelector(".copy-btn");
      if (targetBtn) targetBtn.click();
    }
  });

  tryDemoLink?.addEventListener("click", event => { event.preventDefault(); showUpdateRequiredScreen(); });
  autolockExtend?.addEventListener("click", () => {
    autolockWarning?.classList.add("hidden");
    triggerLeaseExtension();
  });
  document.getElementById("autolock-warning")?.classList.add("hidden");

  window.addEventListener("pagehide", () => {
    renderEpoch++;
    popupRenderItems = [];
    clearAllTimers();
    stopLongLivedTimers();
    if (typeof clearFingerprint === "function") clearFingerprint();
    if (typeof clearConfirmFingerprint === "function") clearConfirmFingerprint();
    if (typeof clearReauthFingerprint === "function") clearReauthFingerprint();
  });

  await requestOwnerView();

  // Check and consume pending autofill intent from in-page fill icon / shortcut / context menu
  const sessionStore = (globalThis.chrome || globalThis.browser)?.storage?.session;
  if (sessionStore?.get) {
    try {
      const data = await sessionStore.get("pendingAutofillIntent");
      const intent = data?.pendingAutofillIntent;
      if (intent) {
        if (currentOwnerState === "metadata") {
          promptReauth(intent);
        } else if (currentOwnerState === "full") {
          await sessionStore.remove("pendingAutofillIntent");
          executePendingAction(intent);
        }
      }
    } catch (_) {}
  }
})();
