// keygrain.js — Deterministic password derivation (depends on hash-wasm-argon2.js)
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";

// Argon2id strengthen cache (single entry — one active session)
let _strengthenCache = null;

async function strengthenSecret(secret, email) {
  const emailLower = email.toLowerCase();
  if (_strengthenCache && _strengthenCache.secret === secret && _strengthenCache.email === emailLower) {
    return _strengthenCache.result;
  }
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
    const ext = await hmacSHA256(hmacKey, new Uint8Array([counter]));
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

  const chars = [
    UPPER[nextByte() % UPPER.length],
    LOWER[nextByte() % LOWER.length],
    DIGITS[nextByte() % DIGITS.length],
    symbols[nextByte() % symbols.length],
  ];
  for (let i = 0; i < length - 4; i++) {
    chars.push(fullCharset[nextByte() % fullCharset.length]);
  }
  for (let i = length - 1; i > 0; i--) {
    const j = nextByte() % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function derivePassword(secret, email, { site, length = 20, symbols = "!@#$%&*-_=+?", counter = 1 }) {
  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const message = enc.encode(site.toLowerCase() + ":" + email.toLowerCase() + ":" + length + ":" + counter);
  const stream = await buildStream(strengthened, message, length * 2);
  return buildPassword(stream, length, symbols);
}

async function deriveAuthPassword(secret, email) {
  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const message = enc.encode(email.toLowerCase() + ":32:keygrain-auth");
  const stream = await buildStream(strengthened, message, 64);
  return buildPassword(stream, 32, "!@#$%&*-_=+?");
}

const WONG_PALETTE = ["#000000","#E69F00","#56B4E9","#009E73","#F0E442","#0072B2","#D55E00","#CC79A7"];

function normalizeSite(site) {
  return site.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].split('#')[0].replace(/\/$/, '').toLowerCase().replace(/^www\./, '');
}

async function secretFingerprint(secret, email) {
  const strengthened = await strengthenSecret(secret, email);
  const enc = new TextEncoder();
  const hash = await hmacSHA256(strengthened, enc.encode("keygrain-fingerprint"));
  return Array.from(hash.slice(0, 4), b => b % 8);
}
