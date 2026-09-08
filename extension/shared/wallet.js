// wallet.js — HD wallet derivation (depends on keygrain.js, bip39-wordlist.js)

let _bip39WordlistVerified = false;
const _bip39VerifyPromise = verifyBip39Wordlist().then(() => { _bip39WordlistVerified = true; });

const SUPPORTED_CHAINS = new Set([
  "bitcoin", "ethereum", "solana", "litecoin", "dogecoin",
  "bitcoin-testnet", "polkadot", "cosmos", "avalanche",
]);

const _WALLET_NAME_RE = /^[a-z0-9\-]+$/;

async function deriveWalletEntropy(secret, { walletId, words = 24, counter = 1 }) {
  if (!secret) throw new Error("secret must not be empty");
  if (!walletId) throw new Error("walletId must not be empty");
  const cleanId = walletId.toLowerCase();
  if (!_WALLET_NAME_RE.test(cleanId)) {
    throw new Error("walletId must match [a-z0-9\\-]+, got: " + JSON.stringify(walletId));
  }
  if (words !== 12 && words !== 24) {
    throw new Error("words must be 12 or 24, got " + words);
  }
  if (counter < 1) throw new Error("counter must be >= 1");

  const enc = new TextEncoder();
  const strengthenGeneration = getStrengthenGeneration();
  const strengthened = await strengthenWithSalt(secret, "keygrain-wallet:" + cleanId);
  assertStrengthenGeneration(strengthenGeneration);
  const message = enc.encode(
    cleanId + ":" + words + ":" + counter + ":keygrain-wallet"
  );
  const hmacKey = await hmacSHA256(strengthened, message);
  assertStrengthenGeneration(strengthenGeneration);
  return words === 12 ? hmacKey.slice(0, 16) : hmacKey;
}

async function entropyToMnemonic(entropy) {
  if (!_bip39WordlistVerified) await _bip39VerifyPromise;
  if (!(entropy instanceof Uint8Array) || (entropy.length !== 16 && entropy.length !== 32)) {
    throw new Error("entropy must be 16 or 32 bytes");
  }
  const nbytes = entropy.length;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", entropy));
  const csBits = nbytes / 4; // 4 bits for 16 bytes, 8 bits for 32 bytes
  const checksum = hash[0] >> (8 - csBits);

  let bits = 0n;
  for (let i = 0; i < nbytes; i++) bits = (bits << 8n) | BigInt(entropy[i]);
  bits = (bits << BigInt(csBits)) | BigInt(checksum);

  const numWords = (nbytes * 8 + csBits) / 11; // 12 or 24
  const words = [];
  for (let i = numWords - 1; i >= 0; i--) {
    words.push(BIP39_WORDLIST[Number((bits >> BigInt(i * 11)) & 0x7FFn)]);
  }
  return words.join(" ");
}

async function mnemonicToSeed(mnemonic, passphrase = "") {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(mnemonic), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode("mnemonic" + passphrase), iterations: 2048, hash: "SHA-512" },
    key, 512
  );
  return new Uint8Array(bits);
}

async function deriveWalletMnemonic(secret, { walletId, words = 24, counter = 1 }) {
  const entropy1 = await deriveWalletEntropy(secret, { walletId, words, counter });
  const entropy2 = await deriveWalletEntropy(secret, { walletId, words, counter });
  if (entropy1.length !== entropy2.length) {
    throw new Error("CRITICAL: Double-derivation mismatch in the wallet expansion step.");
  }
  for (let i = 0; i < entropy1.length; i++) {
    if (entropy1[i] !== entropy2[i]) {
      throw new Error("CRITICAL: Double-derivation mismatch in the wallet expansion step.");
    }
  }
  return await entropyToMnemonic(entropy1);
}
