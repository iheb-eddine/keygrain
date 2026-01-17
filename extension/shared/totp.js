// totp.js — TOTP generation, parsing, and derivation (depends on keygrain.js)

const _B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const _HEX_FORCING = new Set("0189abcdef".split(""));

function base32Decode(input) {
  const cleaned = input.replace(/[\s\-=]/g, "").toUpperCase();
  if (!cleaned) throw new Error("Empty base32 input");
  for (const c of cleaned) {
    if (!_B32_ALPHABET.includes(c)) throw new Error("Invalid base32 character: " + c);
  }
  let bits = "";
  for (const c of cleaned) bits += _B32_ALPHABET.indexOf(c).toString(2).padStart(5, "0");
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return bytes;
}

function seedToBase32(seed) {
  let bits = "";
  for (const b of seed) bits += b.toString(2).padStart(8, "0");
  let result = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    result += _B32_ALPHABET[parseInt(chunk, 2)];
  }
  return result;
}

function parseTOTPInput(input) {
  input = input.trim();
  if (!input) throw new Error("Empty input");

  // Priority 1: otpauth:// URI
  if (input.startsWith("otpauth://")) return _parseOtpauth(input);

  // Priority 2: Hex
  if (input.length >= 20 && /^[0-9a-fA-F]+$/.test(input) && input.length % 2 === 0) {
    let hasForcing = false;
    for (const c of input) { if (_HEX_FORCING.has(c)) { hasForcing = true; break; } }
    if (hasForcing) {
      const seed = new Uint8Array(input.length / 2);
      for (let i = 0; i < seed.length; i++) seed[i] = parseInt(input.slice(i * 2, i * 2 + 2), 16);
      return {seed, digits: 6, period: 30, algorithm: "SHA1", issuer: null, label: null};
    }
  }

  // Priority 3: Base32
  const cleaned = input.replace(/[\s\-=]/g, "").toUpperCase();
  if (cleaned && [...cleaned].every(c => _B32_ALPHABET.includes(c))) {
    const seed = base32Decode(input);
    if (seed.length < 1) throw new Error("Seed too short");
    return {seed, digits: 6, period: 30, algorithm: "SHA1", issuer: null, label: null};
  }

  throw new Error("Cannot parse TOTP input: " + input);
}

function _parseOtpauth(uri) {
  const url = new URL(uri);
  if (url.protocol !== "otpauth:") throw new Error("Not an otpauth URI");
  if (url.hostname !== "totp") throw new Error("Only TOTP is supported (not HOTP)");

  const params = url.searchParams;
  const secretParam = params.get("secret");
  if (!secretParam) throw new Error("Missing secret parameter");

  const seed = base32Decode(secretParam);

  const algo = (params.get("algorithm") || "SHA1").toUpperCase();
  if (!["SHA1", "SHA256", "SHA512"].includes(algo)) throw new Error("Unsupported algorithm: " + algo);

  const digits = parseInt(params.get("digits") || "6", 10);
  if (digits !== 6 && digits !== 8) throw new Error("digits must be 6 or 8, got " + digits);

  const period = parseInt(params.get("period") || "30", 10);
  if (period < 1 || period > 300) throw new Error("period must be 1-300, got " + period);

  const issuer = params.get("issuer") || null;
  const label = url.pathname ? decodeURIComponent(url.pathname.replace(/^\//, "")) : null;

  return {seed, digits, period, algorithm: algo, issuer, label};
}

async function generateTOTP(seed, time, {digits = 6, period = 30, algorithm = "SHA1"} = {}) {
  const algoMap = {SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512"};
  const hashName = algoMap[algorithm.toUpperCase()];
  if (!hashName) throw new Error("Unsupported algorithm: " + algorithm);
  if (digits !== 6 && digits !== 8) throw new Error("digits must be 6 or 8");
  if (period < 1) throw new Error("period must be >= 1");

  const t = Math.floor(time / period);
  const tBytes = new Uint8Array(8);
  const view = new DataView(tBytes.buffer);
  view.setUint32(0, Math.floor(t / 0x100000000));
  view.setUint32(4, t >>> 0);

  const key = await crypto.subtle.importKey("raw", seed, {name: "HMAC", hash: hashName}, false, ["sign"]);
  const hmacResult = new Uint8Array(await crypto.subtle.sign("HMAC", key, tBytes));

  const offset = hmacResult[hmacResult.length - 1] & 0x0F;
  const code = (
    (hmacResult[offset] & 0x7F) << 24 |
    (hmacResult[offset + 1] & 0xFF) << 16 |
    (hmacResult[offset + 2] & 0xFF) << 8 |
    (hmacResult[offset + 3] & 0xFF)
  ) >>> 0;

  const otp = code % (10 ** digits);
  return otp.toString().padStart(digits, "0");
}

async function deriveTOTPSeed(secret, email, site) {
  const enc = new TextEncoder();
  const strengthened = await strengthenSecret(secret, email);
  const message = enc.encode(site.toLowerCase() + ":" + email.toLowerCase() + ":keygrain-totp");
  return hmacSHA256(strengthened, message);
}

async function getTOTPCode(service, secret, email) {
  const totp = service.totp;
  if (!totp) throw new Error("Service has no TOTP configuration");

  let seed;
  if (totp.mode === "stored") {
    const binary = atob(totp.seed);
    seed = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) seed[i] = binary.charCodeAt(i);
  } else if (totp.mode === "derived") {
    seed = await deriveTOTPSeed(secret, email, service.site);
  } else {
    throw new Error("Unknown TOTP mode: " + totp.mode);
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const code = await generateTOTP(seed, now, {
      digits: totp.digits || 6,
      period: totp.period || 30,
      algorithm: totp.algorithm || "SHA1"
    });
    const remaining = (totp.period || 30) - (now % (totp.period || 30));
    return {code, remaining};
  } finally {
    seed.fill(0);
  }
}
