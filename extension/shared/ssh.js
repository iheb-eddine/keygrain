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

/**
 * Format an Ed25519 keypair as an OpenSSH PEM private key string.
 *
 * @param {Uint8Array} seed - 32-byte Ed25519 seed
 * @param {Uint8Array} publicKey - 32-byte Ed25519 public key
 * @param {string} comment - Key comment (e.g. "email:keyname")
 * @returns {Promise<string>} OpenSSH PEM-formatted private key
 */
async function formatOpensshPrivateKey(seed, publicKey, comment) {
  if (/[\x00-\x1f\x7f]/.test(comment)) throw new Error("comment must not contain control characters");
  const enc = new TextEncoder();

  // Deterministic check bytes: HMAC-SHA256(seed, "openssh-check")[0:4] as big-endian uint32
  const checkBytes = await hmacSHA256(seed, enc.encode("openssh-check"));
  const checkInt = new DataView(checkBytes.buffer).getUint32(0);

  // Public key blob: string "ssh-ed25519" + string public_key
  const keyType = enc.encode("ssh-ed25519");
  const pubBlob = new Uint8Array(4 + keyType.length + 4 + publicKey.length);
  const pubView = new DataView(pubBlob.buffer);
  let po = 0;
  pubView.setUint32(po, keyType.length); po += 4;
  pubBlob.set(keyType, po); po += keyType.length;
  pubView.setUint32(po, publicKey.length); po += 4;
  pubBlob.set(publicKey, po);

  // Private section: check_int x2 + string("ssh-ed25519") + string(pubkey) + string(seed||pubkey) + string(comment) + padding
  const commentBytes = enc.encode(comment);
  const privLen = 4 + 4 + (4 + keyType.length) + (4 + publicKey.length) + (4 + 64) + (4 + commentBytes.length);
  const padLen = (8 - privLen % 8) % 8;
  const privSection = new Uint8Array(privLen + padLen);
  const privView = new DataView(privSection.buffer);
  let ps = 0;
  privView.setUint32(ps, checkInt); ps += 4;
  privView.setUint32(ps, checkInt); ps += 4;
  privView.setUint32(ps, keyType.length); ps += 4;
  privSection.set(keyType, ps); ps += keyType.length;
  privView.setUint32(ps, publicKey.length); ps += 4;
  privSection.set(publicKey, ps); ps += publicKey.length;
  privView.setUint32(ps, 64); ps += 4;
  privSection.set(seed, ps); ps += seed.length;
  privSection.set(publicKey, ps); ps += publicKey.length;
  privView.setUint32(ps, commentBytes.length); ps += 4;
  privSection.set(commentBytes, ps); ps += commentBytes.length;
  // Padding: bytes 1, 2, 3, ..., N
  for (let i = 0; i < padLen; i++) privSection[ps + i] = i + 1;

  // Outer structure
  const authMagic = enc.encode("openssh-key-v1");
  const cipherName = enc.encode("none");
  const kdfName = enc.encode("none");
  const outerLen = authMagic.length + 1 + (4 + cipherName.length) + (4 + kdfName.length) + (4 + 0) + 4 + (4 + pubBlob.length) + (4 + privSection.length);
  const outer = new Uint8Array(outerLen);
  const outerView = new DataView(outer.buffer);
  let oo = 0;
  outer.set(authMagic, oo); oo += authMagic.length;
  outer[oo] = 0; oo += 1; // null terminator
  outerView.setUint32(oo, cipherName.length); oo += 4;
  outer.set(cipherName, oo); oo += cipherName.length;
  outerView.setUint32(oo, kdfName.length); oo += 4;
  outer.set(kdfName, oo); oo += kdfName.length;
  outerView.setUint32(oo, 0); oo += 4; // kdfoptions (empty string)
  outerView.setUint32(oo, 1); oo += 4; // number of keys
  outerView.setUint32(oo, pubBlob.length); oo += 4;
  outer.set(pubBlob, oo); oo += pubBlob.length;
  outerView.setUint32(oo, privSection.length); oo += 4;
  outer.set(privSection, oo);

  // Base64 encode, split into 70-char lines
  const b64 = btoa(String.fromCharCode(...outer));
  const lines = [];
  for (let i = 0; i < b64.length; i += 70) lines.push(b64.slice(i, i + 70));

  return "-----BEGIN OPENSSH PRIVATE KEY-----\n" + lines.join("\n") + "\n-----END OPENSSH PRIVATE KEY-----\n";
}
