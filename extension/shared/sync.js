// sync.js — Backup/restore/export/import (depends on keygrain.js)
const SYNC_SERVER = "https://keygrain.secbytech.com";

async function deriveLookupId(secret, email) {
  const enc = new TextEncoder();
  const message = enc.encode(email.toLowerCase() + ":keygrain-id");
  const hash = await hmacSHA256(enc.encode(secret), message);
  return Array.from(hash, b => b.toString(16).padStart(2, "0")).join("");
}

async function deriveAuthPassword(secret, email) {
  return derivePassword(secret, email, 32, "!@#$%&*-_=+?", "keygrain-auth");
}

async function deriveEncryptionKey(secret, email) {
  const enc = new TextEncoder();
  const message = enc.encode(email.toLowerCase() + ":keygrain-encryption");
  return hmacSHA256(enc.encode(secret), message);
}

async function encryptBlob(keyBytes, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, {name: "AES-GCM"}, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv}, cryptoKey, plaintext);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv);
  result.set(new Uint8Array(ciphertext), 12);
  return result;
}

async function decryptBlob(keyBytes, blob) {
  const iv = blob.slice(0, 12);
  const ciphertext = blob.slice(12);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, {name: "AES-GCM"}, false, ["decrypt"]);
  return crypto.subtle.decrypt({name: "AES-GCM", iv}, cryptoKey, ciphertext);
}

async function backupToServer(secret, email, servicesJson, storedEtag) {
  const lookupId = await deriveLookupId(secret, email);
  const authPassword = await deriveAuthPassword(secret, email);
  const encKey = await deriveEncryptionKey(secret, email);
  try {
    const encrypted = await encryptBlob(encKey, new TextEncoder().encode(servicesJson));
    const headers = {
      "Authorization": "Basic " + btoa(lookupId + ":" + authPassword),
      "Content-Type": "application/octet-stream",
    };
    if (storedEtag) headers["If-Match"] = storedEtag;
    const resp = await fetch(SYNC_SERVER + "/api/backup/" + lookupId, {
      method: "PUT", headers, body: encrypted,
    });
    if (resp.status === 412) throw new Error("conflict");
    if (resp.status === 401) throw new Error("auth_failed");
    if (!resp.ok) throw new Error("server_error");
    const etag = resp.headers.get("ETag") || null;
    return {ok: true, etag};
  } finally {
    encKey.fill(0);
  }
}

async function restoreFromServer(secret, email) {
  const lookupId = await deriveLookupId(secret, email);
  const authPassword = await deriveAuthPassword(secret, email);
  const encKey = await deriveEncryptionKey(secret, email);
  try {
    const resp = await fetch(SYNC_SERVER + "/api/backup/" + lookupId, {
      method: "GET",
      headers: {"Authorization": "Basic " + btoa(lookupId + ":" + authPassword)},
    });
    if (resp.status === 404) throw new Error("not_found");
    if (resp.status === 401) throw new Error("auth_failed");
    if (!resp.ok) throw new Error("server_error");
    const blob = new Uint8Array(await resp.arrayBuffer());
    const decrypted = await decryptBlob(encKey, blob);
    const services = JSON.parse(new TextDecoder().decode(decrypted));
    const etag = resp.headers.get("ETag") || null;
    return {services, etag};
  } finally {
    encKey.fill(0);
  }
}

function exportToFile(encryptedBlob, filename) {
  const blob = new Blob([encryptedBlob], {type: "application/octet-stream"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "keygrain-backup.keygrain";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
