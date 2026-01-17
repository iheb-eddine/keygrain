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

      results.push({ name: name.trim(), url: url.trim(), email: email.trim(), oldPassword });
    }
    return results;
  }

  // === Domain Extraction + Deduplication ===

  const MULTI_PART_TLDS = ["co.uk", "com.au", "co.jp", "com.br", "co.nz", "org.uk"];
  const STRIP_PREFIXES = ["accounts.", "login.", "auth.", "signin.", "sso.", "id.", "my."];

  function isIP(host) {
    return /^[\d.]+$/.test(host) || host.includes(":");
  }

  function extractDomain(url, name) {
    let host = "";
    if (url) {
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch { /* invalid URL */ }
    }
    if (!host) return name ? name.toLowerCase().trim() : "";
    host = host.replace(/^www\./, "");
    if (isIP(host)) return host;
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
    return host;
  }

  function deduplicateEntries(entries) {
    const seen = new Set();
    return entries.map(e => {
      const normName = e.serviceName.toLowerCase().trim().replace(/^www\./, "");
      const normEmail = e.email.toLowerCase().trim();
      const key = normName + "\0" + normEmail;
      const isDuplicate = seen.has(key);
      seen.add(key);
      return { ...e, isDuplicate, hasEmptyEmail: !e.email.trim() };
    });
  }

  // === Wizard UI + Storage Integration ===

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
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");
  const checklistEl = document.getElementById("checklist");
  const allDone = document.getElementById("all-done");

  // State
  let parsedEntries = null;
  let secret = null;
  let email = null;
  let settings = { defaultLength: 20, defaultSymbols: "!@#$%&*-_=+?" };
  let currentFilter = "all";

  async function sendMsg(msg) {
    try { return await chrome.runtime.sendMessage(msg); } catch { await new Promise(r => setTimeout(r, 100)); return chrome.runtime.sendMessage(msg); }
  }

  function showStep(n) {
    errorScreen.classList.add("hidden");
    steps.forEach((s, i) => s.classList.toggle("hidden", i !== n - 1));
  }

  // === Init ===
  const secretResp = await sendMsg({ action: "getSecret" });
  const emailResp = await sendMsg({ action: "getEmail" });
  secret = secretResp?.secret;
  email = emailResp?.email;

  const settingsData = await chrome.storage.local.get("settings");
  if (settingsData.settings) Object.assign(settings, settingsData.settings);

  if (!secret || !email) {
    steps.forEach(s => s.classList.add("hidden"));
    errorScreen.classList.remove("hidden");
    // Checklist is still viewable when locked (read-only progress)
    if (location.hash === "#checklist") {
      const cl = (await chrome.storage.local.get("migrationChecklist")).migrationChecklist;
      if (cl) { errorScreen.classList.add("hidden"); showStep(4); renderChecklist(cl); }
    }
    // Early return only if no checklist to show
    if (errorScreen.classList.contains("hidden")) { /* checklist shown */ } else return;
  } else if (location.hash === "#checklist") {
    const cl = (await chrome.storage.local.get("migrationChecklist")).migrationChecklist;
    if (cl) { showStep(4); renderChecklist(cl); } else showStep(1);
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

    // Apply domain extraction
    const entries = fields.map(f => ({
      serviceName: extractDomain(f.url, f.name) || f.name || "unknown",
      email: f.email,
      oldPassword: f.oldPassword
    }));

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
      if (entry.isDuplicate) tr.className = "row-duplicate";
      else if (entry.hasEmptyEmail) tr.className = "row-empty-email";

      // Checkbox
      const tdCb = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !entry.isDuplicate;
      cb.setAttribute("aria-label", "Include " + entry.serviceName);
      cb.dataset.index = i;
      tdCb.appendChild(cb);
      tr.appendChild(tdCb);

      // Service name (editable)
      const tdName = document.createElement("td");
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = entry.serviceName;
      nameInput.className = "svc-name";
      nameInput.setAttribute("aria-label", "Service name");
      nameInput.addEventListener("change", () => { entry.serviceName = nameInput.value.trim(); });
      tdName.appendChild(nameInput);
      tr.appendChild(tdName);

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
  let existingServices = [];
  let skipCount = 0;
  let selectedEntries = [];

  async function prepareConfirm() {
    // Load existing services
    const data = await chrome.storage.local.get("services");
    existingServices = [];
    if (data.services && data.services.version === 2) {
      const enc = new TextEncoder();
      const strengthened = await strengthenSecret(secret, email);
      const storageKey = await hmacSHA256(strengthened, enc.encode(email.toLowerCase() + ":keygrain-local-storage"));
      try {
        const iv = base64ToArrayBuffer(data.services.iv);
        const ct = base64ToArrayBuffer(data.services.ciphertext);
        const aad = enc.encode(email.toLowerCase());
        const cryptoKey = await crypto.subtle.importKey("raw", storageKey, { name: "AES-GCM" }, false, ["decrypt"]);
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, cryptoKey, ct);
        const parsed = JSON.parse(new TextDecoder().decode(decrypted));
        existingServices = parsed.services || parsed;
      } catch { existingServices = []; } finally { storageKey.fill(0); }
    }

    // Get selected entries
    const checkboxes = previewBody.querySelectorAll("input[type=checkbox]");
    selectedEntries = [];
    checkboxes.forEach((cb, i) => { if (cb.checked) selectedEntries.push(parsedEntries[i]); });

    // Count skips
    skipCount = 0;
    selectedEntries.forEach(e => {
      const exists = existingServices.some(s => s.name.toLowerCase() === e.serviceName.toLowerCase() && s.email.toLowerCase() === e.email.toLowerCase());
      if (exists) skipCount++;
    });

    confirmSummary.textContent = "Import " + (selectedEntries.length - skipCount) + " services into Keygrain?";
    if (skipCount > 0) {
      confirmSkip.textContent = skipCount + " services already exist and will be skipped.";
      confirmSkip.classList.remove("hidden");
    } else {
      confirmSkip.classList.add("hidden");
    }
  }

  function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  document.getElementById("back-to-2").addEventListener("click", () => showStep(2));
  document.getElementById("import-btn").addEventListener("click", async () => {
    // Merge: add new services that don't already exist
    const newServices = [];
    selectedEntries.forEach(e => {
      const exists = existingServices.some(s => s.name.toLowerCase() === e.serviceName.toLowerCase() && s.email.toLowerCase() === e.email.toLowerCase());
      if (!exists) {
        newServices.push({ name: e.serviceName, email: e.email, length: settings.defaultLength, symbols: settings.defaultSymbols, migrating: true });
      }
    });
    const merged = existingServices.concat(newServices);

    // Encrypt and save
    const enc = new TextEncoder();
    const strengthened = await strengthenSecret(secret, email);
    const storageKey = await hmacSHA256(strengthened, enc.encode(email.toLowerCase() + ":keygrain-local-storage"));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = enc.encode(email.toLowerCase());
    const plaintext = enc.encode(JSON.stringify({ version: 1, services: merged }));
    const cryptoKey = await crypto.subtle.importKey("raw", storageKey, { name: "AES-GCM" }, false, ["encrypt"]);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, cryptoKey, plaintext);
    storageKey.fill(0);
    await chrome.storage.local.set({ services: { version: 2, iv: arrayBufferToBase64(iv), ciphertext: arrayBufferToBase64(ciphertext) } });

    // Create/append migration checklist
    const clData = await chrome.storage.local.get("migrationChecklist");
    let checklist = clData.migrationChecklist || { version: 1, createdAt: new Date().toISOString(), items: [] };
    newServices.forEach(svc => {
      const exists = checklist.items.some(item => item.name.toLowerCase() === svc.name.toLowerCase() && item.email.toLowerCase() === svc.email.toLowerCase());
      if (!exists) checklist.items.push({ name: svc.name, email: svc.email, status: "pending" });
    });
    await chrome.storage.local.set({ migrationChecklist: checklist });

    // Null old passwords — security requirement
    parsedEntries = null;
    selectedEntries = [];

    showStep(4);
    renderChecklist(checklist);
  });

  // === Step 4: Checklist ===
  async function clearMigratingFlag(name, svcEmail) {
    if (!secret || !email) return;
    const data = await chrome.storage.local.get("services");
    if (!data.services || data.services.version !== 2) return;
    const enc = new TextEncoder();
    const strengthened = await strengthenSecret(secret, email);
    const storageKey = await hmacSHA256(strengthened, enc.encode(email.toLowerCase() + ":keygrain-local-storage"));
    try {
      const iv = base64ToArrayBuffer(data.services.iv);
      const ct = base64ToArrayBuffer(data.services.ciphertext);
      const aad = enc.encode(email.toLowerCase());
      const cryptoKey = await crypto.subtle.importKey("raw", storageKey, { name: "AES-GCM" }, false, ["decrypt"]);
      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, cryptoKey, ct);
      const parsed = JSON.parse(new TextDecoder().decode(decrypted));
      const svcs = parsed.services || parsed;
      const match = svcs.find(s => s.name.toLowerCase() === name.toLowerCase() && s.email.toLowerCase() === svcEmail.toLowerCase());
      if (match && match.migrating) {
        delete match.migrating;
        const newIv = crypto.getRandomValues(new Uint8Array(12));
        const plaintext = enc.encode(JSON.stringify({ version: 1, services: svcs }));
        const encKey = await crypto.subtle.importKey("raw", storageKey, { name: "AES-GCM" }, false, ["encrypt"]);
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: newIv, additionalData: aad }, encKey, plaintext);
        await chrome.storage.local.set({ services: { version: 2, iv: arrayBufferToBase64(newIv), ciphertext: arrayBufferToBase64(ciphertext) } });
      }
    } finally { storageKey.fill(0); }
  }

  function renderChecklist(checklist) {
    const items = checklist.items;
    const doneCount = items.filter(i => i.status === "done").length;
    const total = items.length;
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    progressBar.style.width = pct + "%";
    progressText.textContent = doneCount + " of " + total + " services rotated";

    checklistEl.textContent = "";
    const filtered = currentFilter === "all" ? items : items.filter(i => i.status === currentFilter);
    filtered.forEach((item, idx) => {
      const realIdx = items.indexOf(item);
      const div = document.createElement("div");
      div.className = "checklist-item" + (item.status === "done" ? " done" : "");
      div.setAttribute("role", "listitem");

      const info = document.createElement("div");
      info.className = "svc-info";
      const nameEl = document.createElement("div");
      nameEl.className = "svc-name";
      nameEl.textContent = item.name;
      const emailEl = document.createElement("div");
      emailEl.className = "svc-email";
      emailEl.textContent = item.email;
      info.appendChild(nameEl);
      info.appendChild(emailEl);

      const actions = document.createElement("div");
      actions.className = "svc-actions";

      if (item.status === "pending") {
        const markBtn = document.createElement("button");
        markBtn.className = "btn-primary";
        markBtn.textContent = "Mark as rotated";
        markBtn.addEventListener("click", async () => {
          item.status = "done";
          item.doneAt = new Date().toISOString();
          await chrome.storage.local.set({ migrationChecklist: checklist });
          await clearMigratingFlag(item.name, item.email);
          renderChecklist(checklist);
        });
        actions.appendChild(markBtn);
      } else {
        const undoBtn = document.createElement("button");
        undoBtn.className = "btn-secondary";
        undoBtn.textContent = "Undo";
        undoBtn.addEventListener("click", async () => {
          item.status = "pending";
          delete item.doneAt;
          await chrome.storage.local.set({ migrationChecklist: checklist });
          renderChecklist(checklist);
        });
        actions.appendChild(undoBtn);
      }

      const copyBtn = document.createElement("button");
      copyBtn.className = "btn-secondary";
      copyBtn.textContent = "Copy new password";
      if (!secret) {
        copyBtn.disabled = true;
        copyBtn.title = "Unlock Keygrain first";
      } else {
        copyBtn.addEventListener("click", async () => {
          // Look up actual service params from storage
          let svcLength = settings.defaultLength;
          let svcSymbols = settings.defaultSymbols;
          let svcSite = item.name;
          let svcCounter = 1;
          try {
            const data = await chrome.storage.local.get("services");
            if (data.services && data.services.version === 2) {
              const enc = new TextEncoder();
              const strengthened = await strengthenSecret(secret, email);
              const storageKey = await hmacSHA256(strengthened, enc.encode(email.toLowerCase() + ":keygrain-local-storage"));
              try {
                const iv = base64ToArrayBuffer(data.services.iv);
                const ct = base64ToArrayBuffer(data.services.ciphertext);
                const aad = enc.encode(email.toLowerCase());
                const cryptoKey = await crypto.subtle.importKey("raw", storageKey, { name: "AES-GCM" }, false, ["decrypt"]);
                const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, cryptoKey, ct);
                const parsed = JSON.parse(new TextDecoder().decode(decrypted));
                const svcs = parsed.services || parsed;
                const match = svcs.find(s => s.name.toLowerCase() === item.name.toLowerCase() && s.email.toLowerCase() === item.email.toLowerCase());
                if (match) { svcLength = match.length || svcLength; svcSymbols = match.symbols || svcSymbols; svcSite = match.site || match.name; svcCounter = match.counter || 1; }
              } finally { storageKey.fill(0); }
            }
          } catch { /* use defaults */ }
          const pw = await derivePassword(secret, item.email, {site: svcSite, length: svcLength, symbols: svcSymbols, counter: svcCounter});
          await navigator.clipboard.writeText(pw);
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy new password"; }, 2000);
        });
      }
      actions.appendChild(copyBtn);

      div.appendChild(info);
      div.appendChild(actions);
      checklistEl.appendChild(div);
    });

    if (doneCount === total && total > 0) {
      allDone.classList.remove("hidden");
    } else {
      allDone.classList.add("hidden");
    }
  }

  // Filter buttons
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      const cl = (await chrome.storage.local.get("migrationChecklist")).migrationChecklist;
      if (cl) renderChecklist(cl);
    });
  });

  // Dismiss checklist
  document.getElementById("dismiss-btn").addEventListener("click", async () => {
    await chrome.storage.local.remove("migrationChecklist");
    allDone.classList.add("hidden");
    checklistEl.textContent = "";
    progressText.textContent = "Checklist dismissed.";
    progressBar.style.width = "0%";
  });
})();
