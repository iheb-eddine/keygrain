(async function () {
  const fileInput = document.getElementById("file-input");
  const confirmSection = document.getElementById("confirm-section");
  const confirmMsg = document.getElementById("confirm-msg");
  const confirmBtn = document.getElementById("confirm-btn");
  const statusEl = document.getElementById("status");

  let parsedServices = null;

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
    const storageKey = await hmacSHA256(enc.encode(secret), enc.encode(email.toLowerCase() + ":keygrain-local-storage"));
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const aad = enc.encode(email.toLowerCase());
      const plaintext = enc.encode(JSON.stringify({version: 1, services: parsedServices}));
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
