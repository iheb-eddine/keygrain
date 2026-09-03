// keygrain.js — Deterministic password derivation (depends on hash-wasm-argon2.js)
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";
const DEFAULT_SYMBOLS = "!@#$%&*-_=+?";
const DEFAULT_SYMBOL_POLICY = "ascii-printable-v1";

function validateSymbols(symbols, policy = DEFAULT_SYMBOL_POLICY) {
  if (policy !== DEFAULT_SYMBOL_POLICY) throw new RangeError("unknown symbol policy");
  if (typeof symbols !== "string" || symbols.length === 0) throw new RangeError("symbols must be a non-empty graphic printable ASCII string");
  for (let i = 0; i < symbols.length; i++) {
    const code = symbols.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) throw new RangeError("symbols must contain only graphic printable ASCII characters");
  }
  return symbols;
}

// Argon2id strengthen cache (single entry — one active session)
let _strengthenCache = null;
let _strengthenQueue = null;
let _strengthenGeneration = 0;

async function strengthenSecret(secret, email) {
  const emailLower = (email || "").toLowerCase();
  if (_strengthenCache && _strengthenCache.secret === secret && _strengthenCache.email === emailLower) {
    return new Uint8Array(_strengthenCache.result);
  }
  // Serialize concurrent calls: if a computation is in-flight, wait then re-check cache.
  // A rejected queue must propagate to current waiters but must not poison later calls.
  if (_strengthenQueue) {
    const pending = _strengthenQueue;
    await pending;
    if (_strengthenCache && _strengthenCache.secret === secret && _strengthenCache.email === emailLower) {
      return new Uint8Array(_strengthenCache.result);
    }
  }
  const enc = new TextEncoder();
  const salt = enc.encode("keygrain-strengthen:" + emailLower);
  const secretBytes = enc.encode(secret);
  const operationGeneration = _strengthenGeneration;
  let pending;
  try {
    pending = Promise.resolve(hashwasm.argon2id({
      password: secretBytes,
      salt: salt,
      parallelism: 1,
      iterations: 3,
      memorySize: 65536,
      hashLength: 32,
      outputType: "binary",
    }));
    _strengthenQueue = pending;
    const hash = await pending;
    const result = new Uint8Array(hash);
    if (operationGeneration !== _strengthenGeneration) {
      result.fill(0);
      throw new Error("stale strengthen operation");
    }
    const output = new Uint8Array(result);
    _strengthenCache = { secret, email: emailLower, result };
    return output;
  } finally {
    secretBytes.fill(0);
    salt.fill(0);
    if (_strengthenQueue === pending) _strengthenQueue = null;
  }
}

function clearStrengthenCache() {
  _strengthenGeneration++;
  if (_strengthenCache) {
    _strengthenCache.result.fill(0);
  }
  _strengthenCache = null;
}

function getStrengthenGeneration() {
  return _strengthenGeneration;
}

function assertStrengthenGeneration(generation) {
  if (generation !== _strengthenGeneration) {
    throw new Error("stale strengthen operation");
  }
  return true;
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
  const nextByte = () => {
    if (pos >= stream.length) throw new Error("stream exhausted");
    return stream[pos++];
  };

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
  return chars.join("");
}

async function derivePassword(secret, email, { site, length = 20, symbols = DEFAULT_SYMBOLS, counter = 1, policy = DEFAULT_SYMBOL_POLICY }) {
  if (!secret) throw new RangeError("secret must not be empty");
  if (!email || !email.trim()) throw new RangeError("email must not be empty");
  if (length < 8 || length > 128) throw new RangeError("length must be between 8 and 128");
  validateSymbols(symbols, policy);
  if (counter < 1) throw new RangeError("counter must be at least 1");
  if (UPPER.length + LOWER.length + DIGITS.length + symbols.length > 256) throw new RangeError("symbols too long (full charset exceeds 256 characters)");
  const enc = new TextEncoder();
  const strengthenGeneration = getStrengthenGeneration();
  const strengthened = await strengthenSecret(secret, email);
  assertStrengthenGeneration(strengthenGeneration);
  const normalized = normalizeSite(site);
  if (!normalized) throw new RangeError("site must not be empty");
  const message = enc.encode(normalized + ":" + email.toLowerCase() + ":" + length + ":" + counter);
  const stream = await buildStream(strengthened, message, length * 8);
  assertStrengthenGeneration(strengthenGeneration);
  return buildPassword(stream, length, symbols);
}

async function deriveAuthPassword(secret, email) {
  const enc = new TextEncoder();
  const strengthenGeneration = getStrengthenGeneration();
  const strengthened = await strengthenSecret(secret, email);
  assertStrengthenGeneration(strengthenGeneration);
  const message = enc.encode(email.toLowerCase() + ":32:keygrain-auth");
  const stream = await buildStream(strengthened, message, 256);
  assertStrengthenGeneration(strengthenGeneration);
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

async function secretFingerprint(secret) {
  const enc = new TextEncoder();
  const hash = await hmacSHA256(enc.encode(secret), enc.encode("keygrain-fingerprint"));
  return Array.from(hash.slice(0, 4), b => b % 8);
}
