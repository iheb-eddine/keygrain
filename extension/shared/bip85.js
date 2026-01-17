// bip85.js — BIP-85 deterministic entropy from BIP-32 keychains
// Depends on: wallet.js (mnemonicToSeed), bip39-wordlist.js (BIP39_WORDLIST)

const SECP256K1_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

async function _hmacSHA512(key, message) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, message);
  return new Uint8Array(sig);
}

function _ckdPriv(keyInt, chainCode, index) {
  // Returns Promise<[BigInt, Uint8Array]>
  const data = new Uint8Array(37);
  data[0] = 0x00;
  const keyBytes = _bigIntToBytes(keyInt, 32);
  data.set(keyBytes, 1);
  const idx = (index | 0x80000000) >>> 0;
  data[33] = (idx >> 24) & 0xff;
  data[34] = (idx >> 16) & 0xff;
  data[35] = (idx >> 8) & 0xff;
  data[36] = idx & 0xff;

  return _hmacSHA512(chainCode, data).then(I => {
    const IL = I.slice(0, 32);
    const IR = I.slice(32);
    const ILint = _bytesToBigInt(IL);
    if (ILint >= SECP256K1_ORDER) throw new Error("Invalid child key (IL >= n)");
    const childKey = (ILint + keyInt) % SECP256K1_ORDER;
    if (childKey === 0n) throw new Error("Invalid child key (zero)");
    return [childKey, IR];
  });
}

function _bigIntToBytes(n, len) {
  const bytes = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) {
    bytes[i] = Number(n & 0xFFn);
    n >>= 8n;
  }
  return bytes;
}

function _bytesToBigInt(bytes) {
  let n = 0n;
  for (let i = 0; i < bytes.length; i++) {
    n = (n << 8n) | BigInt(bytes[i]);
  }
  return n;
}

function _entropyToMnemonicGeneral(entropy) {
  // Handles 16 bytes (12 words) or 32 bytes (24 words)
  const nbytes = entropy.length;
  if (nbytes !== 16 && nbytes !== 32) throw new Error("entropy must be 16 or 32 bytes");
  if (!_bip39WordlistVerified) throw new Error("BIP-39 wordlist not verified");

  const csBits = nbytes / 4; // 4 for 16 bytes, 8 for 32 bytes
  return crypto.subtle.digest("SHA-256", entropy).then(hashBuf => {
    const checksumByte = new Uint8Array(hashBuf)[0];
    const checksum = checksumByte >> (8 - csBits);

    let bits = _bytesToBigInt(entropy);
    bits = (bits << BigInt(csBits)) | BigInt(checksum);

    const numWords = (nbytes * 8 + csBits) / 11;
    const words = [];
    for (let i = numWords - 1; i >= 0; i--) {
      words.push(BIP39_WORDLIST[Number((bits >> BigInt(i * 11)) & 0x7FFn)]);
    }
    return words.join(" ");
  });
}

/**
 * Derive a child mnemonic from a master mnemonic using BIP-85.
 * @param {string} masterMnemonic - 12 or 24-word BIP-39 mnemonic
 * @param {{index?: number, words?: number, passphrase?: string}} options
 * @returns {Promise<string>} Child mnemonic
 */
async function bip85DeriveMnemonic(masterMnemonic, { index = 0, words = 24, passphrase = "" } = {}) {
  if (words !== 12 && words !== 24) throw new Error("words must be 12 or 24");
  if (index < 0) throw new Error("index must be >= 0");

  // Step 1: Master mnemonic → BIP-32 seed
  const seed = await mnemonicToSeed(masterMnemonic, passphrase);

  // Step 2: BIP-32 master key
  const enc = new TextEncoder();
  const I = await _hmacSHA512(enc.encode("Bitcoin seed"), seed);
  let key = _bytesToBigInt(I.slice(0, 32));
  let chainCode = I.slice(32);

  if (key === 0n || key >= SECP256K1_ORDER) throw new Error("Invalid master key");

  // Step 3: Derive path m/83696968'/39'/0'/words'/index'
  for (const childIndex of [83696968, 39, 0, words, index]) {
    [key, chainCode] = await _ckdPriv(key, chainCode, childIndex);
  }

  // Step 4: BIP-85 entropy
  const entropyRaw = await _hmacSHA512(enc.encode("bip-entropy-from-k"), _bigIntToBytes(key, 32));

  // Step 5: Truncate
  const entropyBytes = words === 12 ? 16 : 32;
  const entropy = entropyRaw.slice(0, entropyBytes);

  // Step 6: Convert to mnemonic
  return _entropyToMnemonicGeneral(entropy);
}
