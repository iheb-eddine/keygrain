(async function() {
  const BIP44_PATHS = {
    "bitcoin": "m/84'/0'/0'/0/0",
    "ethereum": "m/44'/60'/0'/0/0",
    "solana": "m/44'/501'/0'/0'",
    "litecoin": "m/84'/2'/0'/0/0",
    "dogecoin": "m/44'/3'/0'/0/0",
    "bitcoin-testnet": "m/84'/1'/0'/0/0",
    "polkadot": "(substrate derivation — no BIP-44 path)",
    "cosmos": "m/44'/118'/0'/0/0",
    "avalanche": "m/44'/60'/0'/0/0"
  };

  // Retrieve secret from background
  let secret = null;
  let email = null;

  async function sendMsg(msg) {
    try { return await chrome.runtime.sendMessage(msg); }
    catch { await new Promise(r => setTimeout(r, 100)); return chrome.runtime.sendMessage(msg); }
  }

  try {
    const resp = await sendMsg({action: "getSecret"});
    secret = resp?.secret || null;
    const emailResp = await sendMsg({action: "getEmail"});
    email = emailResp?.email || null;
  } catch { secret = null; }

  const lockedMsg = document.getElementById("locked-msg");
  const walletUI = document.getElementById("wallet-ui");

  if (!secret) {
    lockedMsg.classList.remove("hidden");
    return;
  }
  walletUI.classList.remove("hidden");

  // Pre-fill email
  const emailInput = document.getElementById("wallet-email");
  if (email) emailInput.value = email;

  // Load and display saved wallets
  async function loadWalletList() {
    const listBody = document.getElementById("wallet-list-body");
    const listTable = document.getElementById("wallet-list-table");
    const listEmpty = document.getElementById("wallet-list-empty");
    if (!email) return;
    try {
      const key = await deriveStorageKey(secret, email);
      const data = await chrome.storage.local.get("services");
      const stored = data.services;
      if (stored && stored.version === 2) {
        const iv = base64ToArrayBuffer(stored.iv);
        const ciphertext = base64ToArrayBuffer(stored.ciphertext);
        const aad = new TextEncoder().encode(email.toLowerCase());
        const cryptoKey = await crypto.subtle.importKey("raw", key, {name: "AES-GCM"}, false, ["decrypt"]);
        const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
        const parsed = JSON.parse(new TextDecoder().decode(decrypted));
        const walletsList = parsed.wallets || [];
        if (walletsList.length > 0) {
          listEmpty.classList.add("hidden");
          listTable.classList.remove("hidden");
          listBody.innerHTML = "";
          walletsList.forEach(w => {
            const tr = document.createElement("tr");
            const td1 = document.createElement("td"); td1.textContent = w.wallet_name || "";
            const td2 = document.createElement("td"); td2.textContent = w.chain || "";
            const td3 = document.createElement("td"); td3.textContent = w.counter || 1;
            const td4 = document.createElement("td"); td4.textContent = w.created_at ? new Date(w.created_at).toLocaleDateString() : "\u2014";
            tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
            listBody.appendChild(tr);
          });
        }
      }
    } catch { /* ignore decryption errors */ }
  }
  loadWalletList();

  const nameInput = document.getElementById("wallet-name");
  const chainSelect = document.getElementById("wallet-chain");
  const counterInput = document.getElementById("wallet-counter");
  const confirmCheck = document.getElementById("wallet-confirm");
  const deriveBtn = document.getElementById("derive-btn");
  const clearBtn = document.getElementById("clear-btn");
  const resultDiv = document.getElementById("result");
  const pathDisplay = document.getElementById("path-display");
  const mnemonicGrid = document.getElementById("mnemonic-grid");
  const errorMsg = document.getElementById("error-msg");
  const countdownMsg = document.getElementById("countdown-msg");
  const clearCountdown = document.getElementById("clear-countdown");

  let activateTimer = null;
  let autoClearTimer = null;
  let countdownInterval = null;
  let mnemonicValue = null;

  // 5-second delay after checkbox
  confirmCheck.addEventListener("change", () => {
    if (confirmCheck.checked) {
      deriveBtn.disabled = true;
      let remaining = 5;
      countdownMsg.textContent = "Derive button activates in " + remaining + "s...";
      countdownMsg.classList.remove("hidden");
      activateTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(activateTimer);
          activateTimer = null;
          deriveBtn.disabled = false;
          countdownMsg.classList.add("hidden");
        } else {
          countdownMsg.textContent = "Derive button activates in " + remaining + "s...";
        }
      }, 1000);
    } else {
      if (activateTimer) { clearInterval(activateTimer); activateTimer = null; }
      deriveBtn.disabled = true;
      countdownMsg.classList.add("hidden");
    }
  });

    deriveBtn.addEventListener("click", async () => {
    errorMsg.classList.add("hidden");
    const walletName = nameInput.value.trim().toLowerCase();
    const chain = chainSelect.value;
    const counter = parseInt(counterInput.value, 10);

    if (!walletName || !/^[a-z0-9\-]+$/.test(walletName)) {
      errorMsg.textContent = "Wallet name must match [a-z0-9-]+";
      errorMsg.classList.remove("hidden");
      return;
    }
    if (!emailInput.value.trim()) {
      errorMsg.textContent = "Email is required.";
      errorMsg.classList.remove("hidden");
      return;
    }
    if (counter < 1) {
      errorMsg.textContent = "Counter must be >= 1.";
      errorMsg.classList.remove("hidden");
      return;
    }

    deriveBtn.disabled = true;
    deriveBtn.textContent = "Deriving...";
    try {
      mnemonicValue = await deriveWalletMnemonic(secret, emailInput.value.trim(), {
        walletName, chain, counter
      });
      // SECURITY NOTE: Mnemonic is displayed as plaintext DOM nodes for up to 60 seconds.
      // JS strings are immutable and cannot be zeroed; DOM text persists until GC.
      // Mitigations: auto-clear timer, pagehide/beforeunload clear, extension-only context
      // (no web page content scripts can access extension pages).
      const words = mnemonicValue.split(" ");
      mnemonicGrid.innerHTML = "";
      words.forEach((w, i) => {
        const div = document.createElement("div");
        div.className = "word";
        const numSpan = document.createElement("span");
        numSpan.className = "word-num";
        numSpan.textContent = (i + 1) + ".";
        div.appendChild(numSpan);
        div.append(" " + w);
        mnemonicGrid.appendChild(div);
      });
      pathDisplay.textContent = "BIP-44 Path: " + (BIP44_PATHS[chain] || "");
      resultDiv.classList.remove("hidden");
      clearBtn.classList.remove("hidden");
      startAutoClear();

      // Persist wallet entry and audit log
      await saveWalletDerivation(secret, emailInput.value.trim(), walletName, chain, counter);
    } catch (e) {
      errorMsg.textContent = e.message;
      errorMsg.classList.remove("hidden");
    }
    deriveBtn.textContent = "Derive Mnemonic";
    deriveBtn.disabled = !confirmCheck.checked;
  });

  function clearMnemonic() {
    mnemonicValue = null;
    mnemonicGrid.innerHTML = "";
    resultDiv.classList.add("hidden");
    clearBtn.classList.add("hidden");
    if (autoClearTimer) { clearTimeout(autoClearTimer); autoClearTimer = null; }
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  }

  function startAutoClear() {
    if (autoClearTimer) clearTimeout(autoClearTimer);
    if (countdownInterval) clearInterval(countdownInterval);
    let remaining = 60;
    clearCountdown.textContent = remaining;
    countdownInterval = setInterval(() => {
      remaining--;
      clearCountdown.textContent = remaining;
      if (remaining <= 0) clearMnemonic();
    }, 1000);
    autoClearTimer = setTimeout(clearMnemonic, 60000);
  }

  clearBtn.addEventListener("click", clearMnemonic);

  // Clear on page hide/close
  document.addEventListener("pagehide", clearMnemonic);
  window.addEventListener("beforeunload", clearMnemonic);

  async function deriveStorageKey(sec, em) {
    const enc = new TextEncoder();
    const strengthened = await strengthenSecret(sec, em);
    const message = enc.encode(em.toLowerCase() + ":keygrain-local-storage");
    return hmacSHA256(strengthened, message);
  }

  async function saveWalletDerivation(sec, em, walletName, chain, counter) {
    const key = await deriveStorageKey(sec, em);
    try {
      const data = await chrome.storage.local.get("services");
      const stored = data.services;
      let services = [], walletsList = [], auditLog = [];

      if (stored && stored.version === 2) {
        const iv = base64ToArrayBuffer(stored.iv);
        const ciphertext = base64ToArrayBuffer(stored.ciphertext);
        const aad = new TextEncoder().encode(em.toLowerCase());
        const cryptoKey = await crypto.subtle.importKey("raw", key, {name: "AES-GCM"}, false, ["decrypt"]);
        const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
        const parsed = JSON.parse(new TextDecoder().decode(decrypted));
        services = parsed.services || parsed || [];
        walletsList = parsed.wallets || [];
        auditLog = parsed.wallet_audit_log || [];
      }

      // Add/update wallet entry
      const wKey = walletName.toLowerCase() + ":" + chain.toLowerCase();
      const idx = walletsList.findIndex(w => (w.wallet_name.toLowerCase() + ":" + w.chain.toLowerCase()) === wKey);
      if (idx >= 0) {
        const existing = walletsList[idx];
        if (existing.counter !== counter || existing.email !== em) {
          walletsList[idx] = {...existing, counter, email: em, updated_at: new Date().toISOString()};
        }
      } else {
        walletsList.push({wallet_name: walletName, chain, counter, email: em, mode: "keygrain", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), notes: ""});
      }

      // Append audit log
      auditLog.push({action: "derive", wallet_name: walletName, chain, counter, timestamp: new Date().toISOString(), verification: "passed"});

      // Re-encrypt and save
      const iv2 = crypto.getRandomValues(new Uint8Array(12));
      const aad2 = new TextEncoder().encode(em.toLowerCase());
      const plaintext = new TextEncoder().encode(JSON.stringify({version: 1, services, wallets: walletsList, wallet_audit_log: auditLog}));
      const cryptoKey2 = await crypto.subtle.importKey("raw", key, {name: "AES-GCM"}, false, ["encrypt"]);
      const ciphertext2 = await crypto.subtle.encrypt({name: "AES-GCM", iv: iv2, additionalData: aad2}, cryptoKey2, plaintext);
      await chrome.storage.local.set({services: {version: 2, iv: arrayBufferToBase64(iv2), ciphertext: arrayBufferToBase64(ciphertext2)}});
    } finally {
      key.fill(0);
    }
  }
})();
