// keygrain.js — Deterministic password derivation (no dependencies)
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";

async function hmacSHA256(key, message) {
  const k = await crypto.subtle.importKey("raw", key, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, message);
  return new Uint8Array(sig);
}

async function buildStream(secret, email, length, salt) {
  const enc = new TextEncoder();
  const message = enc.encode(email + ":" + length + ":" + salt);
  const key = await hmacSHA256(enc.encode(secret), message);
  let stream = new Uint8Array(key);
  let counter = 1;
  while (stream.length < length * 2) {
    const ext = await hmacSHA256(key, new Uint8Array([counter]));
    const combined = new Uint8Array(stream.length + ext.length);
    combined.set(stream);
    combined.set(ext, stream.length);
    stream = combined;
    counter++;
  }
  return stream;
}

async function derivePassword(secret, email, length, symbols, salt) {
  email = email.toLowerCase();
  const fullCharset = UPPER + LOWER + DIGITS + symbols;
  const stream = await buildStream(secret, email, length, salt);
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

const WONG_PALETTE = ["#000000","#E69F00","#56B4E9","#009E73","#F0E442","#0072B2","#D55E00","#CC79A7"];

async function secretFingerprint(secret) {
  const enc = new TextEncoder();
  const hash = await hmacSHA256(enc.encode(secret), enc.encode("keygrain-fingerprint"));
  return Array.from(hash.slice(0, 4), b => b % 8);
}
