(async function () {
  // === CSV Parsing + Format Detection ===

  function stripBOM(text) {
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  }

  function parseCSV(text) {
    const rows = [];
    let i = 0;
    while (i < text.length) {
      const row = [];
      while (i < text.length) {
        if (text[i] === '"') {
          i++;
          let field = "";
          while (i < text.length) {
            if (text[i] === '"') {
              if (i + 1 < text.length && text[i + 1] === '"') {
                field += '"';
                i += 2;
              } else {
                i++;
                break;
              }
            } else {
              field += text[i];
              i++;
            }
          }
          row.push(field);
        } else {
          let field = "";
          while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
            field += text[i];
            i++;
          }
          row.push(field);
        }
        if (i < text.length && text[i] === ',') { i++; continue; }
        break;
      }
      if (i < text.length && text[i] === '\r') i++;
      if (i < text.length && text[i] === '\n') i++;
      if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
    }
    return rows;
  }

  function detectFormat(headers) {
    const h = headers.map(s => s.toLowerCase().trim());
    if (h.includes("login_uri")) return "bitwarden";
    if (h.includes("grouping") && h.includes("fav")) return "lastpass";
    if (h.includes("httprealm") || h.includes("formactionorigin")) return "firefox";
    if (h.includes("group") && h.includes("title") && h.includes("username")) return "keepassxc";
    const fiveCol = ["name", "url", "username", "password", "notes"];
    const fourCol = ["name", "url", "username", "password"];
    if (h.length === 5 && fiveCol.every((c, i) => h[i] === c)) return "1password";
    if (h.length === 4 && fourCol.every((c, i) => h[i] === c)) return "chrome";
    return null;
  }

  function extractFields(rows, format) {
    const results = [];
    const headers = rows[0].map(s => s.toLowerCase().trim());
    const col = (name) => headers.indexOf(name);

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      let name = "", url = "", email = "", oldPassword = "";

      if (format === "1password") {
        name = r[col("name")] || "";
        url = r[col("url")] || "";
        email = r[col("username")] || "";
        oldPassword = r[col("password")] || "";
      } else if (format === "bitwarden") {
        if ((r[col("type")] || "").trim() !== "1") continue;
        name = r[col("name")] || "";
        url = r[col("login_uri")] || "";
        email = r[col("login_username")] || "";
        oldPassword = r[col("login_password")] || "";
      } else if (format === "lastpass") {
        name = r[col("name")] || "";
        url = r[col("url")] || "";
        email = r[col("username")] || "";
        oldPassword = r[col("password")] || "";
      } else if (format === "chrome") {
        name = r[col("name")] || "";
        url = r[col("url")] || "";
        email = r[col("username")] || "";
        oldPassword = r[col("password")] || "";
      } else if (format === "firefox") {
        url = r[col("url")] || "";
        email = r[col("username")] || "";
        oldPassword = r[col("password")] || "";
      } else if (format === "keepassxc") {
        name = r[col("title")] || "";
        url = r[col("url")] || "";
        email = r[col("username")] || "";
        oldPassword = r[col("password")] || "";
      }

      results.push({ name: name.trim().slice(0, 200), url: url.trim().slice(0, 500), email: email.trim().slice(0, 200), oldPassword });
    }
    return results;
  }

  // === Domain Extraction + Deduplication ===

  const MULTI_PART_TLDS = ["co.uk", "com.au", "co.jp", "com.br", "co.nz", "org.uk"];
  const STRIP_PREFIXES = ["accounts.", "login.", "auth.", "signin.", "sso.", "id.", "my."];

  function isIP(host) {
    return /^[\d.]+$/.test(host) || host.includes(":");
  }

  // Resolve both the derived site and its provenance from a CSV export row.
  // `source` records WHERE the site came from so the preview can show the user
  // the original address next to the guess (see migrate wizard step 2):
  //   "url"   -> a host was parsed from the url field; site is the processed host
  //   "title" -> no host; site is the entry title, lowercased/trimmed
  //   "empty" -> no host and no title; site is ""
  // This is pure code-motion of the former extractDomain body (same statement
  // order: url parse -> www strip -> isIP -> STRIP_PREFIXES) so extractDomain's
  // output is byte-identical to before.
  function resolveSiteFields(url, name) {
    let host = "";
    if (url) {
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch { /* invalid URL */ }
      // Some managers (e.g. KeePassXC) store a bare host with no scheme, which
      // new URL() rejects. Retry with an https:// prefix so those still resolve.
      if (!host && !url.includes("://")) {
        try {
          host = new URL("https://" + url).hostname.toLowerCase();
        } catch { /* still invalid */ }
      }
    }
    if (!host) {
      return name ? { site: name.toLowerCase().trim(), source: "title" } : { site: "", source: "empty" };
    }
    host = host.replace(/^www\./, "");
    if (isIP(host)) return { site: host, source: "url" };
    for (const prefix of STRIP_PREFIXES) {
      if (host.startsWith(prefix)) {
        const rest = host.slice(prefix.length);
        const parts = rest.split(".");
        const isTwoPartDomain = parts.length === 2;
        const isThreePartWithKnownTLD = parts.length === 3 && MULTI_PART_TLDS.includes(parts.slice(1).join("."));
        if (isTwoPartDomain || isThreePartWithKnownTLD) {
          host = rest;
        }
        break;
      }
    }
    return { site: host, source: "url" };
  }

  function extractDomain(url, name) {
    return resolveSiteFields(url, name).site;
  }

  function deduplicateEntries(entries) {
    const seen = new Set();
    return entries.map(e => {
      const normName = normalizeSite(e.serviceName.trim());
      const normEmail = e.email.toLowerCase().trim();
      const key = normName + "\0" + normEmail;
      const isDuplicate = seen.has(key);
      seen.add(key);
      return { ...e, isDuplicate, hasEmptyEmail: !e.email.trim() };
    });
  }

  // === Wizard UI + Storage Integration ===

  // Test hook: expose the pure domain helper to the Node VM. No-op in the browser
  // (document is defined there, so this block is skipped and init proceeds).
  if (typeof document === "undefined") { globalThis.KeygrainMigrate = { extractDomain, resolveSiteFields }; return; }

  // DOM refs
  const errorScreen = document.getElementById("error-screen");
  const steps = [document.getElementById("step-1"), document.getElementById("step-2"), document.getElementById("step-3"), document.getElementById("step-4")];
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const parseError = document.getElementById("parse-error");
  const previewHeader = document.getElementById("preview-header");
  const previewBody = document.getElementById("preview-body");
  const previewFooter = document.getElementById("preview-footer");
  const toggleAll = document.getElementById("toggle-all");
  const confirmSummary = document.getElementById("confirm-summary");
  const confirmSkip = document.getElementById("confirm-skip");
  const importBtn = document.getElementById("import-btn");
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");
  const checklistEl = document.getElementById("checklist");
  const allDone = document.getElementById("all-done");
  const stopRow = document.getElementById("stop-row");
  const stopBtn = document.getElementById("stop-btn");
  const stopDialog = document.getElementById("stop-dialog");
  const stopDialogCount = document.getElementById("stop-dialog-count");
  const stopDialogTotpWarning = document.getElementById("stop-dialog-totp-warning");
  const stopCancel = document.getElementById("stop-cancel");
  const stopConfirm = document.getElementById("stop-confirm");

  // State
  let parsedEntries = null;
  let secret = null;
  let email = null;
  let settings = { defaultLength: 20, defaultSymbols: "!@#$%&*-_=+?" };
  let currentFilter = "all";

  // Rendering state, replaced only once an operation has finished. `allServices` is the
  // decrypted service list and is the single source of truth for rotation status —
  // every checklist row's status is derived from its service's `migrating` flag (see
  // migration-state.js). `checklist` holds batch membership only.
  let allServices = [];
  let checklist = null;

  // Markers for the values this page last wrote, so the storage listener at the bottom of
  // this file can tell its own writes apart from the popup's. See storageMarker in
  // popup-dialog.js.
  const selfWrites = {};

  // Set once the blob is removed from under this tab; readBlob then refuses every read.
  let blobGone = false;

  async function sendMsg(msg) {
    try { return await chrome.runtime.sendMessage(msg); } catch { await new Promise(r => setTimeout(r, 100)); return chrome.runtime.sendMessage(msg); }
  }

  function showStep(n) {
    errorScreen.classList.add("hidden");
    steps.forEach((s, i) => s.classList.toggle("hidden", i !== n - 1));
  }

  // Shown whenever the blob cannot be read. Opening the popup is the actionable step,
  // not unlocking: a pre-v2 payload is upgraded by the popup's own load path, which
  // runs on unlock and is the only place that can do it.
  const BLOB_READ_FAILED = "Could not read your Keygrain data. Open the Keygrain popup once, then reload this page. If it still fails, unlock again with your master secret.";

  // === Encrypted services blob ===
  //
  // Reads and writes go through the same popup-crypto.js helpers the popup uses.
  // This file used to inline its own copy which wrote `version: 1` payloads and
  // omitted `tombstones` / `deletion_review`, so every import and every "Mark as
  // rotated" silently discarded pending deletions — resurrecting deleted services
  // from the server on the next sync — dropped the deletion-review queue, and
  // downgraded the payload so the popup re-ran its one-time v1->v2 upgrade.
  //
  // readBlob returns a self-contained object and writeBlob takes one. Neither reads
  // module state, so a read that lands in the middle of another operation's
  // read-modify-write cannot change what that operation is about to persist. The
  // rendering state below is only ever replaced once an operation has finished.

  // Returns the decrypted blob, or null meaning DO NOT WRITE — either it could not be
  // decrypted or it predates local payload v2. Callers must respect null: the old code
  // treated a decryption failure as "no existing services" and the import then
  // overwrote the blob with only the imported rows, destroying everything.
  async function readBlob() {
    // Set when another context removes the blob (Switch account, Reset Keygrain, the
    // delete-local branch of Delete server data). `secret` and `email` in this tab are then
    // stale, so every read is refused rather than allowed to report an empty store — which
    // is what an absent key looks like below, and which would let an import write a fresh
    // blob under a secret that no longer belongs to this profile.
    if (blobGone) return null;
    const stored = (await chrome.storage.local.get("services")).services;
    if (!stored) return { services: [], wallets: [], auditLog: [], tombstones: [], deletionReview: [] };
    if (stored.version !== 2) return null;
    const key = await deriveStorageKey(secret, email);
    try {
      const r = await decryptServices(key, email, stored);
      // A pre-v2 payload means the popup has not run its one-time v1->v2 upgrade yet;
      // only it can, because only it has syncKnownUUIDs. Writing from here would
      // destroy that chance, so refuse.
      if (r.payloadVersion < 2) return null;
      return {
        services: r.services,
        wallets: r.wallets,
        auditLog: r.walletAuditLog,
        tombstones: r.tombstones,
        deletionReview: r.deletionReview
      };
    } catch {
      return null;
    } finally {
      key.fill(0);
    }
  }

  // Returns false, having written nothing, once the blob is gone. Guarding readBlob alone is
  // not enough: every path here is read-modify-write, so a wipe landing after the read would
  // still let the write re-create the blob under a secret that no longer belongs to this
  // profile. Callers already treat a failed read as "abort", so they treat this the same way.
  async function writeBlob(blob) {
    if (blobGone) return false;
    const key = await deriveStorageKey(secret, email);
    try {
      const encrypted = await encryptServices(key, email, blob.services, blob.wallets, blob.auditLog, blob.tombstones, blob.deletionReview);
      // Armed BEFORE the write: the onChanged event may be dispatched before set()
      // resolves, and a marker recorded afterwards would be too late to recognise our own
      // event.
      selfWrites.services = storageMarker(encrypted);
      await chrome.storage.local.set({ services: encrypted });
    } finally {
      key.fill(0);
    }
    return true;
  }

  // Serialises every operation that reads or writes the blob. Without it, two quick
  // clicks on different rows interleave their read-modify-write cycles and the second
  // write discards the first row's change — reproducing the very bug this file exists
  // to fix. Per-button `disabled` only guards repeat clicks on the same button, so
  // EVERY handler that touches the blob must go through here, including the ones that
  // only read (a re-render mid-write would otherwise show a stale row set).
  let writeChain = Promise.resolve();
  function serialize(fn) {
    const done = writeChain.then(fn, fn);
    writeChain = done.catch(() => {});
    return done;
  }

  // Read and reconcile the local checklist. `migrationStopped` was written by an unshipped
  // implementation whose Stop semantics retained unrotated services. Ignore and remove that
  // legacy key; the still-flagged services become pending again so the user can explicitly Stop
  // them under the corrected deletion wording.
  async function loadChecklist(services) {
    const data = await chrome.storage.local.get(["migrationChecklist", "migrationStopped"]);
    if (data.migrationStopped !== undefined) await chrome.storage.local.remove("migrationStopped");
    const { checklist: next, changed } = KeygrainMigration.ensureMembership(
      data.migrationChecklist, services, new Date().toISOString());
    checklist = next;
    if (changed) {
      if (checklist) {
        selfWrites.migrationChecklist = storageMarker(checklist);
        await chrome.storage.local.set({ migrationChecklist: checklist });
      } else {
        selfWrites.migrationChecklist = STORAGE_MARKER_ABSENT;
        await chrome.storage.local.remove("migrationChecklist");
      }
    }
    return checklist;
  }

  // Flip `migrating` on the given service ids and persist. `updated_at` is bumped by
  // applyMigrating, without which the sync merge ("newer wins, remote wins ties")
  // reverts the change from the server's still-flagged copy. Returns false if the blob
  // could not be read, in which case nothing was written.
  async function setMigrating(ids, value) {
    if (!secret || !email) return false;
    const blob = await readBlob();
    if (!blob) return false;
    const r = KeygrainMigration.applyMigrating(blob.services, ids, value, nextTimestamp(blob.services));
    if (r.changed) {
      blob.services = r.services;
      if (!await writeBlob(blob)) return false;
      // Push the change out reasonably promptly rather than waiting for the next
      // periodic alarm, so other devices stop warning about a rotated service. Chrome
      // clamps short alarm delays, so this is prompt-ish rather than immediate.
      chrome.alarms.create("syncAlarm", { delayInMinutes: 0.1 });
    }
    allServices = blob.services;
    return true;
  }

  // === Init ===
  const secretResp = await sendMsg({ action: "getSecret" });
  const emailResp = await sendMsg({ action: "getEmail" });
  secret = secretResp?.secret;
  email = emailResp?.email;

  const settingsData = await chrome.storage.local.get("settings");
  if (settingsData.settings) Object.assign(settings, settingsData.settings);

  // Both bail-outs below tell the user to go to the popup and come back, and neither can act
  // on the return: this page reads the secret once, at load. Reload when the blob changes so
  // at least the case that produces a write — the popup's one-time pre-v2 payload upgrade,
  // which runs on unlock and is what the read-failure message is about — brings the page back
  // by itself. A plain unlock writes nothing, so that still needs a manual reload.
  //
  // Safe to reload from here: neither screen holds user input.
  function recoverOnBlobChange() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (externalChanges(changes, area, ["services"], selfWrites).length) location.reload();
    });
  }

  if (!secret || !email) {
    // Rotation status is DERIVED from the encrypted services blob, so it cannot be
    // shown while locked. A stored per-item status used to make a read-only view
    // possible here, but that stored status is precisely what drifted out of agreement
    // with the flag, so it is gone and the honest answer is "unlock".
    steps.forEach(s => s.classList.add("hidden"));
    errorScreen.classList.remove("hidden");
    recoverOnBlobChange();
    return;
  }

  const initialBlob = await readBlob();
  if (!initialBlob) {
    // Never fall through to the wizard on a failed read: the import writes the whole
    // blob, so continuing with an empty in-memory list would erase every existing
    // service and wallet.
    steps.forEach(s => s.classList.add("hidden"));
    errorScreen.textContent = BLOB_READ_FAILED;
    errorScreen.classList.remove("hidden");
    recoverOnBlobChange();
    return;
  }
  allServices = initialBlob.services;
  await loadChecklist(allServices);

  if (location.hash === "#checklist" && checklist) {
    showStep(4);
    renderChecklist();
  } else {
    showStep(1);
  }

  // === Step 1: File Picker ===
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", e => { e.preventDefault(); dropZone.classList.remove("dragover"); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

  async function handleFile(file) {
    parseError.classList.add("hidden");
    const buf = await file.arrayBuffer();
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder("windows-1252").decode(buf);
    }
    text = stripBOM(text);
    fileInput.value = "";

    if (!text.trim()) { showParseError("File is empty."); return; }

    const rows = parseCSV(text);
    if (rows.length < 2) { showParseError("No services found in file."); return; }

    const format = detectFormat(rows[0]);
    if (!format) { showParseError("Could not detect format. Is this a CSV export from a supported manager?"); return; }

    const fields = extractFields(rows, format);
    if (fields.length === 0) { showParseError("No services found in file."); return; }

    // Apply domain extraction. resolveSiteFields returns both the derived site
    // and its provenance so the preview can show the original export address
    // read-only next to the editable Site. `source`/`sourceText` are in-memory
    // preview-only fields — they are never persisted (dropped at import when
    // parsedEntries is nulled). serviceName is byte-identical to the previous
    // `extractDomain(f.url, f.name) || f.name || "unknown"`.
    const entries = fields.map(f => {
      const { site, source } = resolveSiteFields(f.url, f.name);
      // sourceText = the raw original value this row's Site was derived from,
      // shown verbatim in the read-only cell. For "title" it is the ORIGINAL-CASE
      // title (distinct from the lowercased Site). For "empty" it is "" and the
      // cell renders a static literal instead.
      const sourceText = source === "url" ? f.url : (source === "title" ? f.name : "");
      return {
        serviceName: site || f.name || "unknown",
        source,
        sourceText,
        email: f.email,
        oldPassword: f.oldPassword
      };
    });

    parsedEntries = deduplicateEntries(entries);
    previewHeader.textContent = "Found " + parsedEntries.length + " services in " + format + " export";
    renderPreview();
    showStep(2);
  }

  function showParseError(msg) {
    parseError.textContent = msg;
    parseError.classList.remove("hidden");
  }

  // === Step 2: Preview ===
  function renderPreview() {
    previewBody.textContent = "";
    parsedEntries.forEach((entry, i) => {
      const tr = document.createElement("tr");
      const rowClasses = [];
      if (entry.isDuplicate) rowClasses.push("row-duplicate");
      else if (entry.hasEmptyEmail) rowClasses.push("row-empty-email");
      // Flag rows whose Site was NOT parsed from a real url (title/empty
      // provenance) — the rows the user most needs to verify. Layered under
      // duplicate/empty: the CSS defines .row-unverified BEFORE those, so
      // duplicate/empty background wins when a row is both.
      if (entry.source !== "url") rowClasses.push("row-unverified");
      if (rowClasses.length) tr.className = rowClasses.join(" ");

      // Checkbox
      const tdCb = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !entry.isDuplicate;
      cb.setAttribute("aria-label", "Include " + entry.serviceName);
      cb.dataset.index = i;
      tdCb.appendChild(cb);
      tr.appendChild(tdCb);

      // Site (editable — this value drives password derivation)
      const tdName = document.createElement("td");
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = entry.serviceName;
      nameInput.className = "svc-name";
      nameInput.setAttribute("aria-label", "Site (used to derive your password)");
      nameInput.addEventListener("change", () => { entry.serviceName = nameInput.value.trim(); });
      tdName.appendChild(nameInput);
      tr.appendChild(tdName);

      // "From your export" — READ-ONLY provenance cell.
      // SECURITY (FR-5): populated ONLY via textContent / text nodes. Never
      // innerHTML, never an <a>/href, no tabindex, no event/attribute that can
      // execute. A crafted CSV url such as `javascript:alert(1)` or
      // `<img src=x onerror=alert(1)>` therefore renders as INERT text — it is
      // the first place raw f.url reaches the DOM, so this is load-bearing.
      // It is a plain <td> (no <input>/contenteditable/tabindex) so assistive
      // tech does not announce it as editable and it is not in the tab order.
      const tdSource = document.createElement("td");
      tdSource.className = "source-cell";
      if (entry.source === "empty") {
        // Static literal, never entry.sourceText (which is "" here). No badge.
        tdSource.textContent = "no address in your export";
      } else {
        // The full value stays in the DOM text node (truncation is CSS-only),
        // so the cell's accessible name is the full value (FR-8, §9); title
        // surfaces it on hover for sighted users.
        const textSpan = document.createElement("span");
        textSpan.className = "source-text";
        textSpan.textContent = entry.sourceText;
        textSpan.title = entry.sourceText;
        tdSource.appendChild(textSpan);
        if (entry.source === "title") {
          // Provenance badge — meaning is in the visible text, not colour-only.
          tdSource.appendChild(document.createTextNode(" "));
          const badge = document.createElement("span");
          badge.className = "prov-badge";
          badge.textContent = "guessed from title";
          tdSource.appendChild(badge);
        }
      }
      tr.appendChild(tdSource);

      // Email (editable)
      const tdEmail = document.createElement("td");
      const emailInput = document.createElement("input");
      emailInput.type = "text";
      emailInput.value = entry.email;
      emailInput.setAttribute("aria-label", "Email or username");
      emailInput.addEventListener("change", () => { entry.email = emailInput.value.trim(); });
      tdEmail.appendChild(emailInput);
      tr.appendChild(tdEmail);

      // Old password (masked)
      const tdPw = document.createElement("td");
      const pwSpan = document.createElement("span");
      pwSpan.textContent = "••••••••";
      tdPw.appendChild(pwSpan);
      const toggleBtn = document.createElement("button");
      toggleBtn.className = "pw-toggle";
      toggleBtn.textContent = "👁";
      toggleBtn.setAttribute("aria-label", "Toggle password visibility");
      toggleBtn.addEventListener("click", () => {
        if (pwSpan.textContent === "••••••••") { pwSpan.textContent = entry.oldPassword; toggleBtn.textContent = "🙈"; }
        else { pwSpan.textContent = "••••••••"; toggleBtn.textContent = "👁"; }
      });
      tdPw.appendChild(toggleBtn);
      tr.appendChild(tdPw);

      // Status
      const tdStatus = document.createElement("td");
      if (entry.isDuplicate) tdStatus.textContent = "Duplicate";
      else if (entry.hasEmptyEmail) tdStatus.textContent = "Missing email";
      tr.appendChild(tdStatus);

      previewBody.appendChild(tr);
    });
    updateFooter();
  }

  function updateFooter() {
    const checkboxes = previewBody.querySelectorAll("input[type=checkbox]");
    let selected = 0, dupes = 0;
    checkboxes.forEach(cb => { if (cb.checked) selected++; });
    parsedEntries.forEach(e => { if (e.isDuplicate) dupes++; });
    previewFooter.textContent = selected + " services selected, " + dupes + " duplicates skipped";
  }

  previewBody.addEventListener("change", e => { if (e.target.type === "checkbox") updateFooter(); });

  document.getElementById("select-all-btn").addEventListener("click", () => {
    previewBody.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = true; });
    toggleAll.checked = true;
    updateFooter();
  });
  document.getElementById("deselect-all-btn").addEventListener("click", () => {
    previewBody.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = false; });
    toggleAll.checked = false;
    updateFooter();
  });
  toggleAll.addEventListener("change", () => {
    previewBody.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = toggleAll.checked; });
    updateFooter();
  });

  document.getElementById("back-to-1").addEventListener("click", () => showStep(1));
  document.getElementById("continue-to-3").addEventListener("click", () => {
    showStep(3);
    prepareConfirm();
  });

  // === Step 3: Confirm ===
  let skipCount = 0;
  let selectedEntries = [];

  // Preview-only: mirrors the check the import performs against its own working list.
  function alreadyExists(entry) {
    return allServices.some(s => normalizeSite(s.site) === normalizeSite(entry.serviceName) && s.email.toLowerCase() === entry.email.toLowerCase());
  }

  async function prepareConfirm() {
    // Re-read: the popup may have added or removed services since this page loaded. A
    // failed read must NOT be treated as "no existing services" — see readBlob.
    const blob = await readBlob();
    if (!blob) {
      confirmSummary.textContent = BLOB_READ_FAILED;
      confirmSkip.classList.add("hidden");
      importBtn.disabled = true;
      return;
    }
    allServices = blob.services;
    importBtn.disabled = false;

    // Get selected entries
    const checkboxes = previewBody.querySelectorAll("input[type=checkbox]");
    selectedEntries = [];
    checkboxes.forEach((cb, i) => { if (cb.checked) selectedEntries.push(parsedEntries[i]); });

    // Count skips
    skipCount = 0;
    selectedEntries.forEach(e => { if (alreadyExists(e)) skipCount++; });

    confirmSummary.textContent = "Import " + (selectedEntries.length - skipCount) + " services into Keygrain?";
    if (skipCount > 0) {
      confirmSkip.textContent = skipCount + " services already exist and will be skipped.";
      confirmSkip.classList.remove("hidden");
    } else {
      confirmSkip.classList.add("hidden");
    }
  }

  document.getElementById("back-to-2").addEventListener("click", () => showStep(2));
  importBtn.addEventListener("click", () => {
    // Disabled for the whole operation and serialised like every other blob write, so a
    // double click cannot import the same CSV twice under two sets of UUIDs.
    importBtn.disabled = true;
    serialize(async () => {
      // Re-read immediately before writing so a concurrent popup edit is not clobbered.
      const blob = await readBlob();
      if (!blob) {
        confirmSummary.textContent = "Nothing was imported. " + BLOB_READ_FAILED;
        return;
      }

      // Add the services that don't already exist. Each gets its own timestamp: one
      // shared value would make an id-order tie-break certain rather than merely
      // possible where two rows collapse to the same (site, email). Newly added rows go
      // into the working list as we go, so the existence check dedupes within the batch
      // as well — normalizeSite is idempotent, so comparing an already-normalised
      // stored site against a freshly normalised one is sound.
      let now = nextTimestamp(blob.services);
      const exists = (entry) => blob.services.some(s => normalizeSite(s.site) === normalizeSite(entry.serviceName) && s.email.toLowerCase() === entry.email.toLowerCase());
      selectedEntries.forEach(e => {
        if (exists(e)) return;
        blob.services.push({ name: e.serviceName, site: normalizeSite(e.serviceName), email: e.email, length: settings.defaultLength, symbols: settings.defaultSymbols, counter: 1, migrating: true, id: crypto.randomUUID(), updated_at: now++, synced: false });
      });
      // Same handling as a failed read above: say nothing was imported and leave the button
      // disabled, because the only way forward is reopening the popup.
      if (!await writeBlob(blob)) {
        confirmSummary.textContent = "Nothing was imported. " + BLOB_READ_FAILED;
        return;
      }
      allServices = blob.services;

      // Record the imported services as this migration batch. Membership only — each
      // row's status is derived from its service's `migrating` flag at render time.
      // loadChecklist re-reads the stored checklist and records every flagged service,
      // so this both picks up the rows just imported and avoids overwriting a batch that
      // a second migrate tab may have created since this one loaded.
      await loadChecklist(allServices);

      // Null old passwords — security requirement
      parsedEntries = null;
      selectedEntries = [];

      // Trigger near-immediate background sync so imported services reach the server
      chrome.alarms.create("syncAlarm", {delayInMinutes: 0.1});

      showStep(4);
      renderChecklist();
    });
  });

  // === Step 4: Checklist ===

  // Re-read both stores and re-render. Callers must wrap this in serialize(): a
  // re-render landing in the middle of a write would show a stale row set.
  async function refreshChecklist() {
    const blob = await readBlob();
    if (!blob) {
      // Re-render from what is already in hand so the row buttons come back enabled,
      // and say what happened rather than leaving a dead, greyed-out list.
      renderChecklist();
      progressText.textContent = BLOB_READ_FAILED;
      return false;
    }
    allServices = blob.services;
    await loadChecklist(allServices);
    renderChecklist();
    return true;
  }

  function renderChecklist() {
    // Rows are projected from the live service list: pending status comes from each
    // service's `migrating` flag alone, names come from the service (so a rename in the
    // popup shows through), items whose service was deleted disappear, and a flagged
    // service the checklist does not know about is still listed. Progress is computed over the
    // full row set before filtering, so switching filters cannot
    // distort it.
    const rows = KeygrainMigration.project(checklist, allServices);
    const doneCount = rows.filter(r => r.status === "done").length;
    const total = rows.length;
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    progressBar.style.width = pct + "%";
    progressText.textContent = doneCount + " of " + total + " services rotated";

    checklistEl.textContent = "";
    const filtered = currentFilter === "all" ? rows : rows.filter(r => r.status === currentFilter);
    filtered.forEach((row) => {
      const div = document.createElement("div");
      div.className = "checklist-item" + (row.status === "done" ? " done" : "");
      div.setAttribute("role", "listitem");

      const info = document.createElement("div");
      info.className = "svc-info";
      const nameEl = document.createElement("div");
      nameEl.className = "svc-name";
      nameEl.textContent = row.name;
      const emailEl = document.createElement("div");
      emailEl.className = "svc-email";
      emailEl.textContent = row.email;
      info.appendChild(nameEl);
      info.appendChild(emailEl);

      const actions = document.createElement("div");
      actions.className = "svc-actions";

      if (row.status === "pending") {
        const markBtn = document.createElement("button");
        markBtn.className = "btn-primary";
        markBtn.textContent = "Mark as rotated";
        markBtn.addEventListener("click", () => {
          markBtn.disabled = true;
          serialize(async () => {
            await setMigrating([row.id], false);
            await refreshChecklist();
          });
        });
        actions.appendChild(markBtn);
      } else {
        const undoBtn = document.createElement("button");
        undoBtn.className = "btn-secondary";
        undoBtn.textContent = "Undo";
        undoBtn.addEventListener("click", () => {
          undoBtn.disabled = true;
          // Undo now restores the service's `migrating` flag, so the popup badge and
          // the copy/fill warning come back too. Previously it only rewrote the
          // checklist's own status, leaving the two disagreeing.
          serialize(async () => {
            await setMigrating([row.id], true);
            await refreshChecklist();
          });
        });
        actions.appendChild(undoBtn);
      }

      const copyBtn = document.createElement("button");
      copyBtn.className = "btn-secondary";
      copyBtn.textContent = "Copy new password";
      copyBtn.addEventListener("click", async () => {
        // Derived from the service's own parameters, which the projection already
        // carries — no second decrypt of the blob per click.
        const svc = row.service;
        try {
          const pw = await derivePassword(secret, svc.email, {
            site: svc.site || svc.name,
            length: svc.length || settings.defaultLength,
            symbols: svc.symbols || settings.defaultSymbols,
            counter: svc.counter || 1
          });
          await navigator.clipboard.writeText(pw);
          copyBtn.textContent = "Copied!";
        } catch {
          // Argon2id can fail on a memory-starved tab, and clipboard writes fail
          // when the document is not focused. Say so rather than failing silently.
          copyBtn.textContent = "Copy failed";
        }
        setTimeout(() => { copyBtn.textContent = "Copy new password"; }, 2000);
      });
      actions.appendChild(copyBtn);

      div.appendChild(info);
      div.appendChild(actions);
      checklistEl.appendChild(div);
    });

    allDone.classList.toggle("hidden", !(doneCount === total && total > 0));

    // Stop is reachable whenever there is a batch to end, pending rows or not. The literal
    // bug 3 was that the only control lived inside #all-done, which is unhidden only when
    // every row is done, so a migration could not be abandoned part-way through.
    //
    // `total === 0` means there is no batch: no membership and no flags. Rows, not `checklist`,
    // decide it — a flagged service with no checklist alongside (an import that reached this
    // device through sync) still projects a pending row, and that is a batch the user must be
    // able to stop.
    const pendingCount = total - doneCount;
    stopRow.classList.toggle("hidden", total === 0);
    // With nothing pending there is nothing to forget, so this is the plain dismiss it
    // replaces — same label, and the handler skips the confirm.
    stopBtn.textContent = pendingCount > 0 ? "Stop migration" : "Dismiss checklist";
  }

  // Filter buttons
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      serialize(refreshChecklist);
    });
  });

  // === Stop migration ===
  //
  // Imported entries are added to the encrypted service list before rotation begins. Therefore
  // "forget the remaining ones" means deleting the confirmed services that are still migrating,
  // not merely clearing their flag or hiding them from one UI. Import also schedules sync
  // immediately, and a lost response can leave `synced:false` after the server accepted a record,
  // so every removal gets a tombstone regardless of its local synced flag. Removal and tombstones
  // are persisted in one encrypted write; the checklist is removed only after that succeeds.
  //
  // The ids are captured when the dialog opens. The fresh blob is checked again before deletion:
  // ids that arrived later are untouched, and an id rotated in another context while the dialog
  // was open is preserved because removePendingServices requires `migrating` to still be true.

  let stopDialogState = null;

  function closeStopDialog() {
    if (!stopDialogState) return;
    closeDialog(stopDialog, stopDialogState);
    stopDialogState = null;
  }

  function stopMigration(ids) {
    serialize(async () => {
      let removedCount = 0;
      if (ids.length) {
        const blob = await readBlob();
        if (!blob) {
          progressText.textContent = "Migration was not stopped. " + BLOB_READ_FAILED;
          return;
        }
        const result = KeygrainMigration.removePendingServices(
          blob.services, blob.tombstones, ids, nextTimestamp(blob.services));
        removedCount = result.removedIds.length;
        if (removedCount) {
          blob.services = result.services;
          blob.tombstones = result.tombstones;
          try {
            if (!await writeBlob(blob)) {
              progressText.textContent = "Migration was not stopped because Keygrain data was removed on this device. Reopen the popup, then reload this page.";
              return;
            }
          } catch (_) {
            progressText.textContent = "Migration was not stopped because the updated data could not be saved. Reload and try again.";
            return;
          }
          chrome.alarms.create("syncAlarm", {delayInMinutes: 0.1});
        }
        allServices = blob.services;
      }

      // Remove the obsolete local key too. It may exist in a profile used to test the earlier,
      // unshipped Stop semantics. Its services were deliberately made pending again by
      // loadChecklist, so nothing is silently deleted during upgrade.
      selfWrites.migrationChecklist = STORAGE_MARKER_ABSENT;
      try {
        await chrome.storage.local.remove(["migrationChecklist", "migrationStopped"]);
      } catch (_) {
        progressText.textContent = removedCount
          ? "The unrotated services were removed, but the checklist could not be dismissed. Reload this page to retry cleanup."
          : "The checklist could not be dismissed. Reload this page and try again.";
        return;
      }
      checklist = null;
      await refreshChecklist();
      if (!KeygrainMigration.countPending(allServices)) {
        progressText.textContent = ids.length
          ? "Migration stopped. " + removedCount + (removedCount === 1 ? " unrotated service was" : " unrotated services were") + " removed from Keygrain."
          : "Checklist dismissed.";
      }
    });
  }

  stopBtn.addEventListener("click", () => {
    if (stopDialogState) return;
    const ids = KeygrainMigration.pendingIds(allServices);
    // Nothing pending means this is the old non-destructive Dismiss action.
    if (!ids.length) { stopMigration(ids); return; }
    stopDialogCount.textContent = "The " + ids.length + (ids.length === 1 ? " service" : " services") +
      " you have not rotated will be removed from Keygrain.";
    const hasStoredTotp = ids.some(id => {
      const svc = allServices.find(service => service && service.id === id);
      return svc && svc.totp && svc.totp.mode === "stored";
    });
    stopDialogTotpWarning.classList.toggle("hidden", !hasStoredTotp);
    stopDialogState = Object.assign(openDialog(stopDialog, stopBtn), {ids});
    stopCancel.focus();
  });

  stopCancel.addEventListener("click", closeStopDialog);
  stopConfirm.addEventListener("click", () => {
    if (!stopDialogState) return;
    const ids = stopDialogState.ids;
    closeStopDialog();
    stopMigration(ids);
  });

  // === Cross-context refresh ===
  //
  // The popup, the wallet page and the background sync alarm all write the services blob,
  // and the popup can clear the checklist key (Switch account, Delete server data). Without
  // this listener the tab went on showing rows the popup had already rotated, renamed or
  // deleted until it was reloaded by hand — the half of "the browser full window is not
  // synced with the migration" that the shared state model alone does not fix.
  //
  // The refresh is serialised like every other access to the blob, so it cannot land inside
  // a read-modify-write and show a stale row set. Our own writes are filtered by marker:
  // they could not corrupt anything here — every handler re-reads — but re-rendering on
  // each of our own writes would reset row button labels and decrypt the blob for nothing.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!externalChanges(changes, area, ["services", "migrationChecklist"], selfWrites).length) return;
    // The blob being REMOVED by another context means the account was wiped on this device.
    // Stop the page rather than re-render: this tab still holds the old secret in memory, and
    // an absent key reads as an empty store, so it would otherwise show a clean, inviting
    // checklist and accept an import under a dead key.
    if (changes.services && changes.services.newValue === undefined) {
      blobGone = true;
      // A Stop confirm left open would otherwise sit on top of the error screen — it is not
      // one of `steps`, so hiding those does not reach it — and confirming it would run a
      // write path that is now refused.
      closeStopDialog();
      steps.forEach(s => s.classList.add("hidden"));
      errorScreen.textContent = "Keygrain data was removed on this device. Open the Keygrain popup, unlock, then reload this page.";
      errorScreen.classList.remove("hidden");
      return;
    }
    // Only the checklist step renders from these. During wizard steps 1-3 the blob is re-read
    // by each step that needs it (prepareConfirm, and the import itself immediately before
    // writing), so refreshing here would rewrite a hidden step-4 DOM for nothing — and would
    // replace `allServices` under the preview the user is editing.
    if (steps[3].classList.contains("hidden")) return;
    serialize(refreshChecklist);
  });
})();
