(async function () {
  const fileInput = document.getElementById("file-input");
  const confirmSection = document.getElementById("confirm-section");
  const confirmMsg = document.getElementById("confirm-msg");
  const confirmBtn = document.getElementById("confirm-btn");
  const statusEl = document.getElementById("status");

  let parsedServices = null;
  let parsedWallets = null;
  let parsedAuditLog = null;

  function showStatus(msg, cls) {
    statusEl.textContent = msg;
    statusEl.className = cls || "";
  }

  async function sendMsg(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch {
      await new Promise(r => setTimeout(r, 100));
      return chrome.runtime.sendMessage(msg);
    }
  }

  // Get secret and email from background
  const secretResp = await sendMsg({action: "getSecret"});
  const emailResp = await sendMsg({action: "getEmail"});
  const secret = secretResp?.secret;
  const email = emailResp?.email;

  if (!secret || !email) {
    showStatus("Missing secret or email. Please start import from the popup.", "error");
    return;
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    const encKey = await deriveEncryptionKey(secret, email);
    try {
      const blob = new Uint8Array(await file.arrayBuffer());
      const decrypted = await decryptBlob(encKey, blob);
      const data = JSON.parse(new TextDecoder().decode(decrypted));
      parsedServices = data.services || data;
      parsedServices = parsedServices.map(s => ({...s, site: normalizeSite(s.site || s.name), id: s.id || crypto.randomUUID(), updated_at: s.updated_at || Date.now()}));
      parsedWallets = data.wallets || null;
      parsedAuditLog = data.wallet_audit_log || null;
      confirmMsg.textContent = "Replace local services with " + parsedServices.length + " from file?";
      confirmSection.style.display = "block";
      showStatus("");
    } catch {
      showStatus("Decryption failed. Wrong email or corrupted file.", "error");
      parsedServices = null;
      confirmSection.style.display = "none";
    } finally {
      encKey.fill(0);
    }
  });

  confirmBtn.addEventListener("click", async () => {
    if (!parsedServices) return;
    // Encrypt with local storage key before saving
    const enc = new TextEncoder();
    const strengthened = await strengthenSecret(secret, email);
    const storageKey = await hmacSHA256(strengthened, enc.encode(email.toLowerCase() + ":keygrain-local-storage"));
    try {
      // Read existing wallets/audit_log from storage to preserve them
      let existingWallets = [];
      let existingAuditLog = [];
      const stored = await chrome.storage.local.get("services");
      if (stored.services && stored.services.version === 2) {
        try {
          const oldIv = base64ToArrayBuffer(stored.services.iv);
          const oldCt = base64ToArrayBuffer(stored.services.ciphertext);
          const aadOld = enc.encode(email.toLowerCase());
          const oldKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
          const oldPlain = await crypto.subtle.decrypt({name: "AES-GCM", iv: oldIv, additionalData: aadOld}, oldKey, oldCt);
          const oldData = JSON.parse(new TextDecoder().decode(oldPlain));
          existingWallets = oldData.wallets || [];
          existingAuditLog = oldData.wallet_audit_log || [];
        } catch { /* can't decrypt existing — use empty */ }
      }
      // Use imported wallets if present, otherwise preserve existing
      const finalWallets = parsedWallets || existingWallets;
      const finalAuditLog = parsedAuditLog || existingAuditLog;

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const aad = enc.encode(email.toLowerCase());
      const plaintext = enc.encode(JSON.stringify({version: 1, services: parsedServices, wallets: finalWallets, wallet_audit_log: finalAuditLog}));
      const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["encrypt"]);
      const ciphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, plaintext);
      const bytes = new Uint8Array(ciphertext);
      let ivB64 = "";
      for (let i = 0; i < iv.length; i++) ivB64 += String.fromCharCode(iv[i]);
      ivB64 = btoa(ivB64);
      let ctB64 = "";
      for (let i = 0; i < bytes.length; i++) ctB64 += String.fromCharCode(bytes[i]);
      ctB64 = btoa(ctB64);
      await chrome.storage.local.set({services: {version: 2, iv: ivB64, ciphertext: ctB64}});
    } finally {
      storageKey.fill(0);
    }
    showStatus("Import complete! " + parsedServices.length + " services imported.", "success");
    confirmSection.style.display = "none";
    setTimeout(() => window.close(), 2000);
  });
})();
