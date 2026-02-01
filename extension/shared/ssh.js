// ssh.js — Deterministic Ed25519 SSH key derivation (depends on keygrain.js, tweetnacl.js)

async function deriveSshKeypair(secret, email, { keyName, counter = 1 }) {
  if (!keyName) throw new Error("keyName must not be empty");
  if (/\s/.test(keyName)) throw new Error("keyName must not contain whitespace");
  if (counter < 1) throw new Error("counter must be >= 1");
  if (/[\x00-\x1f\x7f]/.test(email)) throw new Error("email must not contain control characters");

  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const message = enc.encode(email.toLowerCase() + ":" + keyName.toLowerCase() + ":" + counter + ":keygrain-ssh");
  const seed = await hmacSHA256(strengthened, message);

  // tweetnacl: nacl.sign.keyPair.fromSeed(seed) returns {publicKey, secretKey}
  const keypair = nacl.sign.keyPair.fromSeed(seed);
  return { seed: seed, publicKey: keypair.publicKey };
}

function formatAuthorizedKeys(publicKey, comment) {
  if (/[\x00-\x1f\x7f]/.test(comment)) throw new Error("comment must not contain control characters");
  // Public key blob: string "ssh-ed25519" + string public_key_raw
  const keyType = new TextEncoder().encode("ssh-ed25519");
  const blob = new Uint8Array(4 + keyType.length + 4 + publicKey.length);
  const view = new DataView(blob.buffer);
  let offset = 0;
  view.setUint32(offset, keyType.length); offset += 4;
  blob.set(keyType, offset); offset += keyType.length;
  view.setUint32(offset, publicKey.length); offset += 4;
  blob.set(publicKey, offset);

  const b64 = btoa(String.fromCharCode(...blob));
  return "ssh-ed25519 " + b64 + " " + comment;
}
