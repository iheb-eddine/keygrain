// keygrain.js — Deterministic password derivation (depends on hash-wasm-argon2.js)
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";

// Argon2id strengthen cache (single entry — one active session)
let _strengthenCache = null;
let _lastStrengthenTime = 0;
let _strengthenQueue = null;

async function strengthenSecret(secret, email) {
  const emailLower = email.toLowerCase();
  if (_strengthenCache && _strengthenCache.secret === secret && _strengthenCache.email === emailLower) {
    return _strengthenCache.result;
  }
  // Throttle: max 1 call per 2 seconds
  const now = Date.now();
  const elapsed = now - _lastStrengthenTime;
  if (elapsed < 2000 && _lastStrengthenTime > 0) {
    if (_strengthenQueue) return _strengthenQueue;
    _strengthenQueue = new Promise(resolve => setTimeout(() => {
      _strengthenQueue = null;
      resolve(strengthenSecret(secret, email));
    }, 2000 - elapsed));
    return _strengthenQueue;
  }
  _lastStrengthenTime = Date.now();
  const enc = new TextEncoder();
  const salt = enc.encode("keygrain-strengthen:" + emailLower);
  const secretBytes = enc.encode(secret);
  const hash = await hashwasm.argon2id({
    password: secretBytes,
    salt: salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: "binary",
  });
  const result = new Uint8Array(hash);
  _strengthenCache = { secret, email: emailLower, result };
  return result;
}

function clearStrengthenCache() {
  if (_strengthenCache) {
    _strengthenCache.result.fill(0);
  }
  _strengthenCache = null;
}

async function hmacSHA256(key, message) {
  const k = await crypto.subtle.importKey("raw", key, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, message);
  return new Uint8Array(sig);
}

async function buildStream(key, message, needed) {
  const hmacKey = await hmacSHA256(key, message);
  let stream = new Uint8Array(hmacKey);
  let counter = 1;
  while (stream.length < needed) {
    const ctrBuf = new Uint8Array(4);
    new DataView(ctrBuf.buffer).setUint32(0, counter);
    const ext = await hmacSHA256(hmacKey, ctrBuf);
    const combined = new Uint8Array(stream.length + ext.length);
    combined.set(stream);
    combined.set(ext, stream.length);
    stream = combined;
    counter++;
  }
  return stream;
}

function buildPassword(stream, length, symbols) {
  const fullCharset = UPPER + LOWER + DIGITS + symbols;
  let pos = 0;
  const nextByte = () => stream[pos++];

  function unbiasedIndex(n) {
    const limit = Math.floor(256 / n) * n;
    while (true) {
      const b = nextByte();
      if (b < limit) return b % n;
    }
  }

  const chars = [
    UPPER[unbiasedIndex(UPPER.length)],
    LOWER[unbiasedIndex(LOWER.length)],
    DIGITS[unbiasedIndex(DIGITS.length)],
    symbols[unbiasedIndex(symbols.length)],
  ];
  for (let i = 0; i < length - 4; i++) {
    chars.push(fullCharset[unbiasedIndex(fullCharset.length)]);
  }
  for (let i = length - 1; i > 0; i--) {
    const j = unbiasedIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  if (pos > stream.length) throw new Error("stream exhausted");
  return chars.join("");
}

async function derivePassword(secret, email, { site, length = 20, symbols = "!@#$%&*-_=+?", counter = 1 }) {
  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const message = enc.encode(site.toLowerCase() + ":" + email.toLowerCase() + ":" + length + ":" + counter);
  const stream = await buildStream(strengthened, message, length * 4);
  return buildPassword(stream, length, symbols);
}

async function deriveAuthPassword(secret, email) {
  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const message = enc.encode(email.toLowerCase() + ":32:keygrain-auth");
  const stream = await buildStream(strengthened, message, 128);
  return buildPassword(stream, 32, "!@#$%&*-_=+?");
}

const WONG_PALETTE = ["#000000","#E69F00","#56B4E9","#009E73","#F0E442","#0072B2","#D55E00","#CC79A7"];

function normalizeSite(site) {
  return site.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].split('#')[0].replace(/\/$/, '').toLowerCase().replace(/^www\./, '');
}

function estimateEntropy(secret) {
  if (!secret) return 0;
  let charsetSize = 0;
  if (/[a-z]/.test(secret)) charsetSize += 26;
  if (/[A-Z]/.test(secret)) charsetSize += 26;
  if (/[0-9]/.test(secret)) charsetSize += 10;
  if (/[^a-zA-Z0-9]/.test(secret)) charsetSize += 32;
  return charsetSize > 0 ? secret.length * Math.log2(charsetSize) : 0;
}

function entropyLabel(bits) {
  if (bits >= 80) return { label: "Strong", cls: "strength-strong" };
  if (bits >= 60) return { label: "Good", cls: "strength-good" };
  if (bits >= 40) return { label: "Fair", cls: "strength-fair" };
  return { label: "Weak", cls: "strength-weak" };
}

async function secretFingerprint(secret, email) {
  const strengthened = await strengthenSecret(secret, email);
  const enc = new TextEncoder();
  const hash = await hmacSHA256(strengthened, enc.encode("keygrain-fingerprint"));
  return Array.from(hash.slice(0, 4), b => b % 8);
}
