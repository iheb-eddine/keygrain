function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function nextTimestamp(services) {
  let max = 0;
  for (const s of services) if (s.updated_at > max) max = s.updated_at;
  return Math.max(Date.now(), max + 1);
}

function formatRelativeTime(ts) {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  const m = Math.floor(diff / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  return h + "h ago";
}

function computeSyncStatus(syncInProgress, lastSyncError, lastSyncTime, retryState) {
  if (syncInProgress) return {visible: true, text: "Syncing...", errorHtml: null};
  if (lastSyncError) {
    const errObj = typeof lastSyncError === "object" ? lastSyncError : {type: "other", message: lastSyncError};
    let msg;
    if ((errObj.type === "network" || errObj.type === "server") && retryState && retryState.nextRetryAt && retryState.nextRetryAt > Date.now()) {
      const secs = Math.ceil((retryState.nextRetryAt - Date.now()) / 1000);
      msg = (errObj.type === "network" ? "Connection error" : "Server error") + ". Retrying in " + secs + "s...";
    } else if (errObj.type === "network" || errObj.type === "server") {
      msg = retryState && retryState.attempt >= 3 ? "Sync unavailable. Will retry on next change." : errObj.message;
    } else if (errObj.type === "auth") {
      msg = "Authentication failed";
    } else {
      msg = errObj.message || "Sync failed";
    }
    return {visible: true, text: "", errorHtml: '<svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8.56 1.69a.63.63 0 0 0-1.12 0L.34 14.03A.63.63 0 0 0 .9 15h14.2a.63.63 0 0 0 .56-.97L8.56 1.69zM8 12.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM7.25 6h1.5v4h-1.5V6z"/></svg> ' + esc(msg), errorText: msg};
  }
  if (lastSyncTime) return {visible: true, text: "Last synced: " + formatRelativeTime(lastSyncTime), errorHtml: null};
  return {visible: false, text: "", errorHtml: null};
}

function openDialog(dialog, trigger) {
  const focusTrigger = trigger || document.activeElement;
  const handler = (e) => {
    if (e.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll('input:not([disabled]),button:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  dialog.classList.remove("hidden");
  dialog.addEventListener("keydown", handler);
  return {trapHandler: handler, trigger: focusTrigger};
}

function closeDialog(dialog, state) {
  dialog.classList.add("hidden");
  if (state && state.trapHandler) { dialog.removeEventListener("keydown", state.trapHandler); }
  if (state && state.trigger) { state.trigger.focus(); }
}

function showStatus(statusEl, msg, timerState, duration) {
  if (duration === undefined) duration = 3000;
  statusEl.textContent = msg;
  if (timerState.id) clearTimeout(timerState.id);
  timerState.id = setTimeout(() => { statusEl.textContent = ""; }, duration);
}

// === Shortcut discoverability helpers (pure: no DOM/chrome/navigator access) ===

// shortcutHintText({shortcut, isMac}) -> {label, isSet}
// A present live value (from chrome.commands.getAll) is shown verbatim; the
// fallback label is used only when no shortcut is bound. Never returns empty.
function shortcutHintText(opts) {
  const raw = opts && typeof opts.shortcut === "string" ? opts.shortcut : "";
  const isMac = !!(opts && opts.isMac);
  const trimmed = raw.trim();
  if (trimmed) return { label: trimmed, isSet: true };
  return { label: isMac ? "Cmd+Shift+K" : "Ctrl+Shift+K", isSet: false };
}

// shortcutCustomizeInfo(isFirefox) -> {method, url, steps}
// steps + url are ALWAYS non-empty for both engines (instructions are always
// available); `method` only decides whether an auto-open button is offered
// ("tabs" = Chromium) or not ("instructions" = Firefox privileged about: URL).
function shortcutCustomizeInfo(isFirefox) {
  if (isFirefox) {
    return {
      method: "instructions",
      url: "about:addons",
      steps: [
        "Open about:addons",
        "Click the gear icon",
        "Choose \"Manage Extension Shortcuts\"",
        "Set \"Fill credentials for current site\""
      ]
    };
  }
  return {
    method: "tabs",
    url: "chrome://extensions/shortcuts",
    steps: [
      "Open your browser's shortcuts page: chrome://extensions/shortcuts (Edge: edge://extensions/shortcuts)",
      "Find Keygrain",
      "Set \"Fill credentials for current site\""
    ]
  };
}

// pickShortcut(commandsArray) -> string
// Returns the fill_credentials command's shortcut, or "" if the entry is
// missing, the array is empty/absent, or the shortcut field is absent.
function pickShortcut(commandsArray) {
  if (!Array.isArray(commandsArray)) return "";
  const entry = commandsArray.find(c => c && c.name === "fill_credentials");
  return entry && typeof entry.shortcut === "string" ? entry.shortcut : "";
}
