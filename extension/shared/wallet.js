// wallet.js — HD wallet derivation (depends on keygrain.js, bip39-wordlist.js)

let _bip39WordlistVerified = false;
const _bip39VerifyPromise = verifyBip39Wordlist().then(() => { _bip39WordlistVerified = true; });

const SUPPORTED_CHAINS = new Set([
  "bitcoin", "ethereum", "solana", "litecoin", "dogecoin",
  "bitcoin-testnet", "polkadot", "cosmos", "avalanche",
]);

const _WALLET_NAME_RE = /^[a-z0-9\-]+$/;

async function deriveWalletEntropy(secret, email, { walletName, chain, counter = 1 }) {
  if (!secret) throw new Error("secret must not be empty");
  if (!email) throw new Error("email must not be empty");
  walletName = walletName.toLowerCase();
  if (!walletName || !_WALLET_NAME_RE.test(walletName)) {
    throw new Error("walletName must match [a-z0-9\\-]+, got: " + JSON.stringify(walletName));
  }
  chain = chain.toLowerCase();
  if (!SUPPORTED_CHAINS.has(chain)) {
    throw new Error("Unsupported chain: " + chain);
  }
  if (counter < 1) throw new Error("counter must be >= 1");

  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const message = enc.encode(
    email.toLowerCase() + ":" + walletName + ":" + chain + ":" + counter + ":keygrain-wallet"
  );
  return await hmacSHA256(strengthened, message);
}

async function entropyToMnemonic(entropy) {
  if (!_bip39WordlistVerified) await _bip39VerifyPromise;
  if (!(entropy instanceof Uint8Array) || entropy.length !== 32) {
    throw new Error("entropy must be 32 bytes");
  }
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", entropy));
  const checksumByte = hash[0];

  // 264 bits: 256 entropy + 8 checksum
  let bits = 0n;
  for (let i = 0; i < 32; i++) bits = (bits << 8n) | BigInt(entropy[i]);
  bits = (bits << 8n) | BigInt(checksumByte);

  const words = [];
  for (let i = 23; i >= 0; i--) {
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

async function deriveWalletMnemonic(secret, email, { walletName, chain, counter = 1 }) {
  const entropy1 = await deriveWalletEntropy(secret, email, { walletName, chain, counter });
  const entropy2 = await deriveWalletEntropy(secret, email, { walletName, chain, counter });
  for (let i = 0; i < 32; i++) {
    if (entropy1[i] !== entropy2[i]) {
      throw new Error("CRITICAL: Double-derivation mismatch. Possible implementation bug or hardware fault.");
    }
  }
  return await entropyToMnemonic(entropy1);
}
