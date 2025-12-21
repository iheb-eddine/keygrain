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
  const emailResp = await sendMsg({action: "getImportEmail"});
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
    await chrome.storage.local.set({services: {version: 1, services: parsedServices}});
    showStatus("Import complete! " + parsedServices.length + " services imported.", "success");
    confirmSection.style.display = "none";
    setTimeout(() => window.close(), 2000);
  });
})();
