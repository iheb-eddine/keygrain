// arrayBufferToBase64 and base64ToArrayBuffer provided by sync.js (loaded before this file)

async function pinDeriveKey(pin, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256"},
    keyMaterial, {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]
  );
}

async function pinEncryptSecret(pin, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pinDeriveKey(pin, salt);
  const ciphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, new TextEncoder().encode(secret));
  return {encrypted: arrayBufferToBase64(ciphertext), salt: arrayBufferToBase64(salt), iv: arrayBufferToBase64(iv)};
}

async function pinDecryptSecret(pin, stored) {
  const salt = base64ToArrayBuffer(stored.salt);
  const iv = base64ToArrayBuffer(stored.iv);
  const key = await pinDeriveKey(pin, salt);
  const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv}, key, base64ToArrayBuffer(stored.encrypted));
  return new TextDecoder().decode(decrypted);
}

async function deriveStorageKey(secret, email) {
  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const message = enc.encode(email.toLowerCase() + ":keygrain-local-storage");
  return hmacSHA256(strengthened, message);
}

async function encryptServices(storageKey, email, services, wallets, walletAuditLog) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(email.toLowerCase());
  const plaintext = new TextEncoder().encode(JSON.stringify({version: 1, services, wallets, wallet_audit_log: walletAuditLog}));
  const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, plaintext);
  return {
    version: 2,
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertext)
  };
}

async function decryptServices(storageKey, email, stored) {
  const iv = base64ToArrayBuffer(stored.iv);
  const ciphertext = base64ToArrayBuffer(stored.ciphertext);
  const aad = new TextEncoder().encode(email.toLowerCase());
  const cryptoKey = await crypto.subtle.importKey("raw", storageKey, {name: "AES-GCM"}, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad}, cryptoKey, ciphertext);
  const data = JSON.parse(new TextDecoder().decode(decrypted));
  return {
    services: data.services || data,
    wallets: data.wallets || [],
    walletAuditLog: data.wallet_audit_log || []
  };
}
