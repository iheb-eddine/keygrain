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

  async function sendMsg(msg) {
    try { return await chrome.runtime.sendMessage(msg); }
    catch { await new Promise(r => setTimeout(r, 100)); return chrome.runtime.sendMessage(msg); }
  }

  let email = null;
  let isFullUnlocked = false;
  let sessionSecret = null;

  try {
    const stateResp = await sendMsg({action: "getUnlockState"});
    if ((stateResp?.ok && stateResp.result?.isUnlocked) || stateResp?.isUnlocked || stateResp?.unlocked) {
      email = stateResp?.result?.email || (await sendMsg({action: "getEmail"}))?.result?.email || null;
      isFullUnlocked = true;
    } else {
      const state2 = await sendMsg({action: "state"});
      if (state2?.ok && state2.state === "full") {
        email = state2.accountEmail || (await sendMsg({action: "getEmail"}))?.result?.email || null;
        isFullUnlocked = true;
      } else if (state2?.ok && state2.state === "metadata") {
        email = state2.accountEmail || (await sendMsg({action: "getEmail"}))?.result?.email || null;
        isFullUnlocked = false;
      }
    }
  } catch (_) {}

  if (isFullUnlocked) {
    try {
      const secResp = await sendMsg({action: "getSecret"});
      if (secResp?.secret) {
        sessionSecret = secResp.secret;
      }
    } catch (_) {}
  }

  const walletUI = document.getElementById("wallet-ui");
  if (walletUI) walletUI.classList.remove("hidden");

  // Pre-fill email
  const emailInput = document.getElementById("wallet-email");
  if (email && emailInput) emailInput.value = email;

  const secretGroup = document.getElementById("secret-group");
  const sessionUnlockedBadge = document.getElementById("session-unlocked-badge");
  const unlockedEmailBadge = document.getElementById("unlocked-email-badge");
  const secretInput = document.getElementById("wallet-secret");
  const fingerprintEl = document.getElementById("wallet-fingerprint");

  if (isFullUnlocked && sessionSecret) {
    if (secretGroup) secretGroup.classList.add("hidden");
    if (sessionUnlockedBadge) sessionUnlockedBadge.classList.remove("hidden");
    if (unlockedEmailBadge && email) unlockedEmailBadge.textContent = email;
  } else {
    if (secretGroup) secretGroup.classList.remove("hidden");
    if (sessionUnlockedBadge) sessionUnlockedBadge.classList.add("hidden");
  }

  async function updateFingerprint() {
    const val = secretInput ? secretInput.value : "";
    if (!val || !fingerprintEl) {
      if (fingerprintEl) fingerprintEl.textContent = "";
      return;
    }
    try {
      const colors = await secretFingerprint(val);
      fingerprintEl.textContent = "";
      for (const idx of colors) {
        const seg = document.createElement("div");
        seg.style.flex = "1";
        seg.style.backgroundColor = WONG_PALETTE[idx];
        fingerprintEl.appendChild(seg);
      }
    } catch (_) {
      fingerprintEl.textContent = "";
    }
  }

  secretInput?.addEventListener("input", updateFingerprint);

  // Load and display saved wallets
  async function loadWalletList() {
    const listBody = document.getElementById("wallet-list-body");
    const listTable = document.getElementById("wallet-list-table");
    const listEmpty = document.getElementById("wallet-list-empty");
    try {
      const resp = await sendMsg({action: "getSavedWallets"});
      const walletsList = resp?.result?.wallets || resp?.wallets || [];
      if (walletsList.length > 0) {
        listEmpty?.classList.add("hidden");
        listTable?.classList.remove("hidden");
        if (listBody) {
          listBody.innerHTML = "";
          walletsList.forEach(w => {
            const tr = document.createElement("tr");
            tr.title = "Click to load parameters";
            const td1 = document.createElement("td"); td1.textContent = w.wallet_name || "";
            const td2 = document.createElement("td"); td2.textContent = w.chain || "";
            const td3 = document.createElement("td"); td3.textContent = w.counter || 1;
            const td4 = document.createElement("td"); td4.textContent = w.created_at ? new Date(w.created_at).toLocaleDateString() : "\u2014";
            tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
            tr.addEventListener("click", () => {
              if (nameInput) nameInput.value = w.wallet_name || "";
              if (chainSelect) chainSelect.value = w.chain || "bitcoin";
              if (counterInput) counterInput.value = w.counter || 1;
              if (w.email && emailInput) emailInput.value = w.email;
              window.scrollTo({ top: 0, behavior: "smooth" });
            });
            listBody.appendChild(tr);
          });
        }
      } else {
        listTable?.classList.add("hidden");
        listEmpty?.classList.remove("hidden");
      }
    } catch { /* ignore load errors */ }
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
  confirmCheck?.addEventListener("change", () => {
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

  deriveBtn?.addEventListener("click", async () => {
    errorMsg.classList.add("hidden");
    let secret = secretInput ? secretInput.value : "";
    if (!secret && isFullUnlocked && sessionSecret) {
      secret = sessionSecret;
    }
    const walletName = nameInput.value.trim().toLowerCase();
    const chain = chainSelect.value;
    const counter = parseInt(counterInput.value, 10);
    const em = emailInput.value.trim();

    if (!em) {
      errorMsg.textContent = "Email is required.";
      errorMsg.classList.remove("hidden");
      return;
    }
    if (!secret) {
      errorMsg.textContent = "Master secret is required.";
      errorMsg.classList.remove("hidden");
      return;
    }
    if (!walletName || !/^[a-z0-9\-]+$/.test(walletName)) {
      errorMsg.textContent = "Wallet name must match [a-z0-9-]+";
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
      const mnemonic = await deriveWalletMnemonic(secret, em, { walletName, chain, counter });
      mnemonicValue = mnemonic;

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

      // Persist derived wallet to encrypted container
      try {
        await sendMsg({
          action: "saveWallet",
          walletName,
          chain,
          counter,
          email: em,
        });
        await loadWalletList();
      } catch (_) {}
    } catch (e) {
      errorMsg.textContent = e.message || "Derivation failed.";
      errorMsg.classList.remove("hidden");
    } finally {
      deriveBtn.textContent = "Derive Mnemonic";
      deriveBtn.disabled = !confirmCheck.checked;
    }
  });

  function clearMnemonic() {
    mnemonicValue = null;
    mnemonicGrid.innerHTML = "";
    resultDiv.classList.add("hidden");
    clearBtn.classList.add("hidden");
    if (secretInput) secretInput.value = "";
    if (fingerprintEl) fingerprintEl.textContent = "";
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

  clearBtn?.addEventListener("click", clearMnemonic);

  window.addEventListener("pagehide", clearMnemonic);
})();
