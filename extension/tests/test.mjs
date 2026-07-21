// extension/tests/test.mjs — Node.js tests for extension JS logic
import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = resolve(__dirname, '..', 'shared');
const root = resolve(__dirname, '..', '..');

// --- Test runner ---
let passed = 0, failed = 0;
function test(name, fn) { return fn().then(() => { passed++; console.log(`  ✓ ${name}`); }, e => { failed++; console.log(`  ✗ ${name}: ${e.message}`); }); }

// --- Strengthen mock data ---
const STRENGTHEN_MAP = {
  'my-master-secret|test@gmail.com': 'd7b935b8298f476c6046cb71501fcb8c9a53327df3cc4e05c696fea7ef3d035a',
  'short|alice@example.com': '3633552e469c5ea783380f877b271672e7261795298870734940afe4f808b47b',
  'different-secret|test@gmail.com': '8978650b9ce3874f29337c74cd9ce3937e7b92bb8bcdf49bf60ed30ee8476309',
  'a|test@gmail.com': '7ac3b5873ab19473c51a126da6ab2ccca497f8ff378336a2dea47e919cf02744',
  // sync-vectors.json fixture emails (secret "my-master-secret"). These are the
  // REAL Argon2id outputs, computed with the vendored WASM (the same oracle that
  // generated sync-vectors.json). They are self-validating: a wrong value here
  // cannot reproduce the pinned lookup_id AND auth_password AND encryption_key.
  'my-master-secret|test-cli@keygrain.example': '927f0fe3426a108d3be189103047f463c93ea2d57a2051c96ce557669693ecb0',
  'my-master-secret|alice@keygrain.example': '53b6d3f6261ac9232e4db4be8d6938e7729d8c818c8a849f14111033e96edf9e',
  'my-master-secret|bob@keygrain.example': '47a750540e44112f99b0bcc726c18a5d9f55a81aac5840210e5ec8761d069735',
};

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// --- Build VM context ---
function buildContext() {
  const ctx = createContext({
    crypto: webcrypto,
    TextEncoder, TextDecoder, URL,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    console,
    Uint8Array, DataView, BigInt, Math, parseInt, Number, String, Array, Map, Set, Error, JSON,
    ArrayBuffer, Promise, Object, RegExp,
    setTimeout, clearTimeout,
    hashwasm: {
      argon2id: async ({ password, salt, parallelism, iterations, memorySize, hashLength, outputType }) => {
        const secretStr = new TextDecoder().decode(password);
        const saltStr = new TextDecoder().decode(salt);
        const emailMatch = saltStr.match(/^keygrain-strengthen:(.+)$/);
        if (!emailMatch) throw new Error('Mock: unexpected salt: ' + saltStr);
        const email = emailMatch[1];
        const key = secretStr + '|' + email;
        const hex = STRENGTHEN_MAP[key];
        if (!hex) throw new Error('Mock: no strengthen vector for ' + key);
        return hexToBytes(hex);
      }
    },
    nacl: null, // will be loaded from tweetnacl.js
  });

  // Load tweetnacl
  const tweetnaclSrc = readFileSync(resolve(shared, 'lib', 'tweetnacl.js'), 'utf8');
  runInContext(`var module = {exports:{}}; var exports = module.exports;\n${tweetnaclSrc}\nvar nacl = module.exports;`, ctx);

  // Load source files in order
  for (const file of ['keygrain.js', 'bip39-wordlist.js', 'wallet.js', 'bip85.js', 'totp.js', 'ssh.js', 'sync.js', 'autofill.js', 'inline-autofill.js']) {
    const src = readFileSync(resolve(shared, file), 'utf8');
    runInContext(src, ctx);
  }
  return ctx;
}

const ctx = buildContext();

// Helper to call functions in the VM context
function call(fnName, ...args) {
  // Serialize args that need to cross the boundary
  ctx._callArgs = args;
  return runInContext(`${fnName}(..._callArgs)`, ctx);
}

// Helper to call KeygrainAutofill.* pure helpers (autofill.js) in the VM context.
function ka(method, ...args) {
  ctx._kaArgs = args;
  return runInContext(`KeygrainAutofill.${method}(..._kaArgs)`, ctx);
}

// Helper to call KeygrainInline.* pure helpers (inline-autofill.js) in the VM context.
function ki(method, ...args) {
  ctx._kiArgs = args;
  return runInContext(`KeygrainInline.${method}(..._kiArgs)`, ctx);
}

// --- Load test vectors ---
const totpVectors = JSON.parse(readFileSync(resolve(root, 'totp-vectors.json'), 'utf8'));
const sshVectors = JSON.parse(readFileSync(resolve(root, 'ssh-vectors.json'), 'utf8'));
const walletVectors = JSON.parse(readFileSync(resolve(root, 'wallet-vectors.json'), 'utf8'));
const coreVectors = JSON.parse(readFileSync(resolve(root, 'vectors.json'), 'utf8'));
const syncVectors = JSON.parse(readFileSync(resolve(root, 'sync-vectors.json'), 'utf8'));

// ============================================================
// TOTP TESTS
// ============================================================
console.log('\nTOTP Tests:');

// base32Decode
await test('base32Decode: JBSWY3DPEHPK3PXP → correct bytes', async () => {
  const result = call('base32Decode', 'JBSWY3DPEHPK3PXP');
  assert.equal(Buffer.from(result).toString('hex'), '48656c6c6f21deadbeef');
});

await test('base32Decode: handles lowercase and padding', async () => {
  const result = call('base32Decode', 'jbswy3dpehpk3pxp===');
  assert.equal(Buffer.from(result).toString('hex'), '48656c6c6f21deadbeef');
});

await test('base32Decode: throws on invalid chars', async () => {
  assert.throws(() => call('base32Decode', 'INVALID!@#'), /Invalid base32/);
});

// parseTOTPInput
for (const v of totpVectors.parse_vectors.vectors) {
  await test(`parseTOTPInput: ${v.input.slice(0, 40)}...`, async () => {
    const result = call('parseTOTPInput', v.input);
    assert.equal(Buffer.from(result.seed).toString('hex'), v.expected_seed_hex);
    assert.equal(result.digits, v.expected_digits);
    assert.equal(result.period, v.expected_period);
    assert.equal(result.algorithm, v.expected_algorithm);
  });
}

await test('parseTOTPInput: otpauth with algorithm and digits', async () => {
  const result = call('parseTOTPInput', 'otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60');
  assert.equal(result.algorithm, 'SHA256');
  assert.equal(result.digits, 8);
  assert.equal(result.period, 60);
});

await test('parseTOTPInput: throws on empty', async () => {
  assert.throws(() => call('parseTOTPInput', ''), /Empty input/);
});

// generateTOTP — RFC 6238 vectors
for (const v of totpVectors.rfc6238_vectors.vectors) {
  await test(`generateTOTP: RFC6238 time=${v.time} algo=${v.algorithm}`, async () => {
    const seedHex = totpVectors.rfc6238_vectors.seeds[v.algorithm];
    const seed = hexToBytes(seedHex);
    ctx._seed = seed;
    const result = await runInContext(`generateTOTP(_seed, ${v.time}, {digits: 8, period: 30, algorithm: "${v.algorithm}"})`, ctx);
    assert.equal(result, v.expected);
  });
}

// deriveTOTPSeed (mocked strengthen)
for (const v of totpVectors.derivation_vectors.vectors.filter(v => v.secret_utf8 === 'my-master-secret' || v.secret_utf8 === 'different-secret')) {
  await test(`deriveTOTPSeed: ${v._note}`, async () => {
    const result = await call('deriveTOTPSeed', v.secret_utf8, v.email, v.site);
    assert.equal(Buffer.from(result).toString('hex'), v.expected_seed_hex);
  });
}

// ============================================================
// CORE DERIVATION TESTS
// ============================================================
console.log('\nCore Derivation Tests:');

for (const v of coreVectors.vectors) {
  await test(`derivePassword: ${v._note}`, async () => {
    const result = await call('derivePassword', v.secret_utf8, v.email, {
      site: v.site, length: v.length, symbols: v.symbols, counter: v.counter
    });
    assert.equal(result, v.expected);
  });
}

await test('derivePassword: rejects length > 128', async () => {
  await assert.rejects(() => call('derivePassword', 'secret', 'a@b.com', { site: 'x.com', length: 129 }), /length must be between 8 and 128/);
});

// buildPassword: rejection sampling boundary
await test('buildPassword: rejects bytes >= limit (rejection sampling boundary)', async () => {
  // For charset 67, limit = floor(256/67)*67 = 201. Byte 255 must be skipped.
  const valid = new Uint8Array([
    10, 5, 3, 7,           // mandatory chars (upper, lower, digit, symbol)
    20, 30, 40, 50,        // fill chars
    3, 2, 1, 6, 5, 4, 0   // shuffle indices (for i=7..1)
  ]);
  const rejected = new Uint8Array([255, ...valid]);
  const pw1 = runInContext(`buildPassword(new Uint8Array([${valid.join(',')}]), 8, "!@#$%&*-_=+?")`, ctx);
  const pw2 = runInContext(`buildPassword(new Uint8Array([${rejected.join(',')}]), 8, "!@#$%&*-_=+?")`, ctx);
  assert.equal(pw1, pw2);
});

// secretFingerprint
for (const v of coreVectors.fingerprint_vectors) {
  await test(`secretFingerprint: ${v._note}`, async () => {
    const result = await call('secretFingerprint', v.secret_utf8);
    assert.deepEqual(Array.from(result), v.expected_color_indices);
  });
}

// ============================================================
// SSH TESTS
// ============================================================
console.log('\nSSH Tests:');

for (const v of sshVectors.derivation_vectors.vectors) {
  await test(`deriveSshKeypair: ${v._note}`, async () => {
    const result = await call('deriveSshKeypair', v.secret_utf8, v.email, { keyName: v.key_name, counter: v.counter });
    assert.equal(Buffer.from(result.seed).toString('hex'), v.seed_hex);
    assert.equal(Buffer.from(result.publicKey).toString('hex'), v.public_key_hex);
  });

  await test(`formatAuthorizedKeys: ${v._note}`, async () => {
    const pubKey = hexToBytes(v.public_key_hex);
    ctx._pubKey = pubKey;
    const comment = v.email.toLowerCase() + ':' + v.key_name.toLowerCase();
    ctx._comment = comment;
    const result = runInContext(`formatAuthorizedKeys(_pubKey, _comment)`, ctx);
    assert.equal(result, v.authorized_keys);
  });
}

// formatOpensshPrivateKey tests
await test('formatOpensshPrivateKey: matches vector PEM exactly', async () => {
  const v = sshVectors.derivation_vectors.vectors[0];
  const seed = hexToBytes(v.seed_hex);
  const pubKey = hexToBytes(v.public_key_hex);
  const comment = v.email.toLowerCase() + ':' + v.key_name.toLowerCase();
  ctx._seed = seed; ctx._pubKey = pubKey; ctx._comment = comment;
  const result = await runInContext(`formatOpensshPrivateKey(_seed, _pubKey, _comment)`, ctx);
  assert.equal(result, v.private_key_pem);
});

await test('formatOpensshPrivateKey: PEM header and footer', async () => {
  const v = sshVectors.derivation_vectors.vectors[0];
  const seed = hexToBytes(v.seed_hex);
  const pubKey = hexToBytes(v.public_key_hex);
  ctx._seed = seed; ctx._pubKey = pubKey; ctx._comment = 'test';
  const result = await runInContext(`formatOpensshPrivateKey(_seed, _pubKey, _comment)`, ctx);
  assert.ok(result.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----\n'));
  assert.ok(result.endsWith('\n-----END OPENSSH PRIVATE KEY-----\n'));
});

await test('formatOpensshPrivateKey: 70-char line limit', async () => {
  const v = sshVectors.derivation_vectors.vectors[0];
  const seed = hexToBytes(v.seed_hex);
  const pubKey = hexToBytes(v.public_key_hex);
  ctx._seed = seed; ctx._pubKey = pubKey; ctx._comment = 'test';
  const result = await runInContext(`formatOpensshPrivateKey(_seed, _pubKey, _comment)`, ctx);
  const lines = result.split('\n').slice(1, -2); // skip header and footer
  for (const line of lines) assert.ok(line.length <= 70, `Line exceeds 70 chars: ${line.length}`);
});

await test('formatOpensshPrivateKey: deterministic (same inputs = same output)', async () => {
  const v = sshVectors.derivation_vectors.vectors[0];
  const seed = hexToBytes(v.seed_hex);
  const pubKey = hexToBytes(v.public_key_hex);
  const comment = v.email.toLowerCase() + ':' + v.key_name.toLowerCase();
  ctx._seed = seed; ctx._pubKey = pubKey; ctx._comment = comment;
  const r1 = await runInContext(`formatOpensshPrivateKey(_seed, _pubKey, _comment)`, ctx);
  const r2 = await runInContext(`formatOpensshPrivateKey(_seed, _pubKey, _comment)`, ctx);
  assert.equal(r1, r2);
});

await test('formatOpensshPrivateKey: rejects control chars in comment', async () => {
  const seed = hexToBytes(sshVectors.derivation_vectors.vectors[0].seed_hex);
  const pubKey = hexToBytes(sshVectors.derivation_vectors.vectors[0].public_key_hex);
  ctx._seed = seed; ctx._pubKey = pubKey;
  await assert.rejects(() => runInContext(`formatOpensshPrivateKey(_seed, _pubKey, "bad\\x01comment")`, ctx), /control characters/);
});

// ============================================================
// WALLET TESTS
// ============================================================
console.log('\nWallet Tests:');

// entropyToMnemonic — BIP-39 vectors
for (const v of walletVectors.bip39_vectors) {
  await test(`entropyToMnemonic: ${v.description}`, async () => {
    const entropy = hexToBytes(v.entropy_hex);
    ctx._entropy = entropy;
    const result = await runInContext(`entropyToMnemonic(_entropy)`, ctx);
    assert.equal(result, v.mnemonic);
  });
}

// deriveWalletEntropy (mocked strengthen)
for (const v of walletVectors.derivation_vectors.filter(v => STRENGTHEN_MAP[v.secret + '|' + v.email.toLowerCase()])) {
  await test(`deriveWalletEntropy: vector ${v.id} — ${v.note || v.wallet_name + '/' + v.chain}`, async () => {
    const result = await call('deriveWalletEntropy', v.secret, v.email, {
      walletName: v.wallet_name, chain: v.chain, counter: v.counter
    });
    assert.equal(Buffer.from(result).toString('hex'), v.entropy_hex);
  });
}

// Full mnemonic derivation
for (const v of walletVectors.derivation_vectors.filter(v => STRENGTHEN_MAP[v.secret + '|' + v.email.toLowerCase()])) {
  await test(`deriveWalletMnemonic: vector ${v.id}`, async () => {
    const result = await call('deriveWalletMnemonic', v.secret, v.email, {
      walletName: v.wallet_name, chain: v.chain, counter: v.counter
    });
    assert.equal(result, v.mnemonic);
  });
}

// mnemonicToSeed — PBKDF2 vector
for (const v of walletVectors.pbkdf2_vectors) {
  await test(`mnemonicToSeed: ${v.description}`, async () => {
    const result = await call('mnemonicToSeed', v.mnemonic, v.passphrase);
    assert.equal(Buffer.from(result).toString('hex'), v.seed_hex);
  });
}

// bip85DeriveMnemonic
await test('bip85DeriveMnemonic: 12-word index 0', async () => {
  const master = 'install scatter logic circle pencil average fall shoe quantum disease suspect usage';
  const result = await call('bip85DeriveMnemonic', master, { index: 0, words: 12 });
  assert.equal(result, 'girl mad pet galaxy egg matter matrix prison refuse sense ordinary nose');
});

// ============================================================
// SYNC MERGE TESTS
// ============================================================
console.log('\nSync Merge Tests:');

await test('mergeServices: both have same service, local newer wins', async () => {
  const local = [{ id: 'a', site: 'local.com', updated_at: 200 }];
  const remote = [{ site: 'remote.com' }];
  const meta = [{ id: 'a', updated_at: 100 }];
  ctx._local = local; ctx._remote = remote; ctx._meta = meta; ctx._known = new Set();
  const result = runInContext(`mergeServices(_local, _remote, _meta, _known)`, ctx);
  assert.equal(result.merged.length, 1);
  assert.equal(result.merged[0].site, 'local.com');
});

await test('mergeServices: both have same service, remote newer wins (tie goes to remote)', async () => {
  const local = [{ id: 'a', site: 'local.com', updated_at: 100 }];
  const remote = [{ site: 'remote.com' }];
  const meta = [{ id: 'a', updated_at: 100 }];
  ctx._local = local; ctx._remote = remote; ctx._meta = meta; ctx._known = new Set();
  const result = runInContext(`mergeServices(_local, _remote, _meta, _known)`, ctx);
  assert.equal(result.merged[0].site, 'remote.com');
});

await test('mergeServices: remote-only new service added', async () => {
  const local = [];
  const remote = [{ site: 'new.com' }];
  const meta = [{ id: 'b', updated_at: 50 }];
  ctx._local = local; ctx._remote = remote; ctx._meta = meta; ctx._known = new Set();
  const result = runInContext(`mergeServices(_local, _remote, _meta, _known)`, ctx);
  assert.equal(result.merged.length, 1);
  assert.equal(result.merged[0].id, 'b');
});

await test('mergeServices: remote-only known UUID = deleted locally, not included', async () => {
  const local = [];
  const remote = [{ site: 'deleted.com' }];
  const meta = [{ id: 'c', updated_at: 50 }];
  ctx._local = local; ctx._remote = remote; ctx._meta = meta; ctx._known = new Set(['c']);
  const result = runInContext(`mergeServices(_local, _remote, _meta, _known)`, ctx);
  assert.equal(result.merged.length, 0);
});

await test('mergeServices: local-only with UUID in knownUUIDs = deleted remotely', async () => {
  const local = [{ id: 'd', site: 'gone.com', updated_at: 100 }];
  const remote = [];
  const meta = [];
  ctx._local = local; ctx._remote = remote; ctx._meta = meta; ctx._known = new Set(['d']);
  const result = runInContext(`mergeServices(_local, _remote, _meta, _known)`, ctx);
  assert.equal(result.merged.length, 0);
});

await test('mergeServices: local new (with UUID, not in remote) preserved', async () => {
  const local = [{ id: 'local-uuid-1', site: 'brand-new.com', updated_at: 300 }];
  const remote = [];
  const meta = [];
  ctx._local = local; ctx._remote = remote; ctx._meta = meta; ctx._known = new Set();
  const result = runInContext(`mergeServices(_local, _remote, _meta, _known)`, ctx);
  assert.equal(result.merged.length, 1);
  assert.equal(result.merged[0].site, 'brand-new.com');
});

await test('mergeWallets: both have same key, newer created_at wins', async () => {
  const local = [{ wallet_name: 'main', chain: 'bitcoin', created_at: 200 }];
  const remote = [{ wallet_name: 'main', chain: 'bitcoin', created_at: 100 }];
  ctx._local = local; ctx._remote = remote; ctx._known = new Set();
  const result = runInContext(`mergeWallets(_local, _remote, _known)`, ctx);
  assert.equal(result.merged.length, 1);
  assert.equal(result.merged[0].created_at, 200);
});

await test('mergeWallets: remote-only new wallet added', async () => {
  const local = [];
  const remote = [{ wallet_name: 'savings', chain: 'ethereum', created_at: 50 }];
  ctx._local = local; ctx._remote = remote; ctx._known = new Set();
  const result = runInContext(`mergeWallets(_local, _remote, _known)`, ctx);
  assert.equal(result.merged.length, 1);
});

await test('mergeWallets: remote-only known key = deleted locally', async () => {
  const local = [];
  const remote = [{ wallet_name: 'old', chain: 'bitcoin', created_at: 50 }];
  ctx._local = local; ctx._remote = remote; ctx._known = new Set(['old:bitcoin']);
  const result = runInContext(`mergeWallets(_local, _remote, _known)`, ctx);
  assert.equal(result.merged.length, 0);
});

await test('mergeWallets: local-only known key = deleted remotely', async () => {
  const local = [{ wallet_name: 'gone', chain: 'bitcoin', created_at: 50 }];
  const remote = [];
  ctx._local = local; ctx._remote = remote; ctx._known = new Set(['gone:bitcoin']);
  const result = runInContext(`mergeWallets(_local, _remote, _known)`, ctx);
  assert.equal(result.merged.length, 0);
});

await test('mergeAuditLog: deduplicates by key', async () => {
  const local = [{ timestamp: 100, wallet_name: 'a', chain: 'bitcoin', action: 'create' }];
  const remote = [{ timestamp: 100, wallet_name: 'a', chain: 'bitcoin', action: 'create' }];
  ctx._local = local; ctx._remote = remote;
  const result = runInContext(`mergeAuditLog(_local, _remote)`, ctx);
  assert.equal(result.length, 1);
});

await test('mergeAuditLog: unions distinct entries', async () => {
  const local = [{ timestamp: 100, wallet_name: 'a', chain: 'bitcoin', action: 'create' }];
  const remote = [{ timestamp: 200, wallet_name: 'b', chain: 'ethereum', action: 'reveal' }];
  ctx._local = local; ctx._remote = remote;
  const result = runInContext(`mergeAuditLog(_local, _remote)`, ctx);
  assert.equal(result.length, 2);
});

await test('parseBlobContent: legacy flat array', async () => {
  const result = runInContext(`JSON.parse(JSON.stringify(parseBlobContent([{site:"a.com"}])))`, ctx);
  assert.deepEqual(result.services, [{ site: 'a.com' }]);
  assert.deepEqual(result.wallets, []);
  assert.deepEqual(result.wallet_audit_log, []);
});

await test('parseBlobContent: new format', async () => {
  const result = runInContext(`JSON.parse(JSON.stringify(parseBlobContent({services:[{site:"b.com"}],wallets:[{wallet_name:"x"}],wallet_audit_log:[{action:"y"}]})))`, ctx);
  assert.deepEqual(result.services, [{ site: 'b.com' }]);
  assert.deepEqual(result.wallets, [{ wallet_name: 'x' }]);
});

await test('mergeServices: empty-normalizing sites use id as dedup key, no collision', async () => {
  const local = [
    { id: 'x1', site: 'www.', email: 'a@b.com', updated_at: 100 },
    { id: 'x2', site: 'https://', email: 'a@b.com', updated_at: 200 }
  ];
  const remote = [];
  const meta = [];
  ctx._local = local; ctx._remote = remote; ctx._meta = meta; ctx._known = new Set();
  const result = runInContext(`mergeServices(_local, _remote, _meta, _known)`, ctx);
  assert.equal(result.merged.length, 2);
});

await test('mergeServices: same non-empty normalized site still deduplicates', async () => {
  const local = [
    { id: 'y1', site: 'https://example.com/path', email: 'a@b.com', updated_at: 100 },
    { id: 'y2', site: 'http://www.example.com', email: 'a@b.com', updated_at: 200 }
  ];
  const remote = [];
  const meta = [];
  ctx._local = local; ctx._remote = remote; ctx._meta = meta; ctx._known = new Set();
  const result = runInContext(`mergeServices(_local, _remote, _meta, _known)`, ctx);
  assert.equal(result.merged.length, 1);
  assert.equal(result.merged[0].id, 'y2');
});

// ============================================================
// SYNC VECTOR TESTS (cross-platform fixture: sync-vectors.json)
// ============================================================
// REGRESSION PIN — NOT an independent cross-check.
// sync-vectors.json was GENERATED by this very extension JS (via
// ci/gen-sync-vectors.mjs, using the vendored Argon2id WASM + tweetnacl as an
// oracle). These tests re-derive the pinned auth values and end-to-end decrypt
// the fixture blob with the extension's REAL sync.js/keygrain.js code, guarding
// the published reference from SILENT DRIFT. The genuinely independent checks
// live in the Python and Kotlin suites (they run real Argon2id but did NOT
// produce the fixture). Note: test.mjs mocks strengthenSecret (STRENGTHEN_MAP),
// so the mock entries for the fixture emails are the real WASM outputs — a wrong
// entry cannot reproduce the pinned lookup_id/auth_password/encryption_key.
console.log('\nSync Vector Tests (regression pin):');

await test('deriveLookupId matches sync-vectors fixture', async () => {
  const result = await call('deriveLookupId', syncVectors.secret, syncVectors.email);
  assert.equal(result, syncVectors.lookup_id);
});

await test('deriveAuthPassword matches sync-vectors fixture', async () => {
  const result = await call('deriveAuthPassword', syncVectors.secret, syncVectors.email);
  assert.equal(result, syncVectors.auth_password);
});

await test('deriveEncryptionKey matches sync-vectors fixture', async () => {
  const result = await call('deriveEncryptionKey', syncVectors.secret, syncVectors.email);
  assert.equal(Buffer.from(result).toString('hex'), syncVectors.encryption_key_hex);
});

// End-to-end: decrypt the pinned blob with the REAL sync.js path (base64 ->
// decryptBlob(encKey, blob, AAD=lookup_id)) and assert the recovered service
// content matches the fixture.
await test('decryptBlob recovers fixture services (AAD=lookup_id)', async () => {
  ctx._secret = syncVectors.secret;
  ctx._email = syncVectors.email;
  ctx._blobB64 = syncVectors.server_response.encrypted_blob;
  const decrypted = await runInContext(`(async () => {
    const encKey = await deriveEncryptionKey(_secret, _email);
    const lookupId = await deriveLookupId(_secret, _email);
    const blob = base64ToArrayBuffer(_blobB64);
    const aad = new TextEncoder().encode(lookupId);
    const pt = await decryptBlob(encKey, blob, aad);
    return new TextDecoder().decode(pt);
  })()`, ctx);
  const content = JSON.parse(decrypted);
  // Match each fixture service's content by (site,email) into the decrypted blob.
  const bySiteEmail = new Map(content.services.map(s => [s.site + '\n' + s.email, s]));
  for (const fsvc of syncVectors.services) {
    const got = bySiteEmail.get(fsvc.site + '\n' + fsvc.email);
    assert.ok(got, `missing service ${fsvc.site}/${fsvc.email}`);
    assert.equal(got.name, fsvc.name);
    if (fsvc.length !== undefined) {
      assert.equal(got.length, fsvc.length);
      assert.equal(got.symbols, fsvc.symbols);
      assert.equal(got.counter, fsvc.counter);
    }
    if (fsvc.totp) assert.deepEqual(got.totp, fsvc.totp);
    if (fsvc.ssh) assert.deepEqual(got.ssh, fsvc.ssh);
  }
});

// Derive each password service through the REAL keygrain.js derivePassword and
// assert it equals the pinned expected value.
for (const fsvc of syncVectors.services.filter(s => s.expected && s.expected.password)) {
  await test(`derivePassword matches fixture: ${fsvc.name} (${fsvc.site})`, async () => {
    const pw = await call('derivePassword', syncVectors.secret, fsvc.email, {
      site: fsvc.site, length: fsvc.length, symbols: fsvc.symbols, counter: fsvc.counter,
    });
    assert.equal(pw, fsvc.expected.password);
  });
}

// ============================================================
// AUTOFILL PURE-HELPER TESTS (autofill.js — called via KeygrainAutofill.*)
// ============================================================
// All pure over element-like / service-like plain objects. No DOM stub needed.
// `key` on field-descriptor stubs mirrors the opaque handle content.js stamps.
console.log('\nAutofill Pure-Helper Tests:');

// --- rankServices (4) ---
await test('rankServices: frecency desc', async () => {
  const out = ka('rankServices', [
    { site: 'a', email: 'a', frecency: 1 },
    { site: 'b', email: 'b', frecency: 5 },
    { site: 'c', email: 'c', frecency: 3 },
  ]);
  assert.deepEqual(Array.from(out, s => s.email), ['b', 'c', 'a']);
});

await test('rankServices: tie -> updated_at desc', async () => {
  const out = ka('rankServices', [
    { site: 'a', email: 'a', frecency: 2, updated_at: 100 },
    { site: 'b', email: 'b', frecency: 2, updated_at: 300 },
    { site: 'c', email: 'c', frecency: 2, updated_at: 200 },
  ]);
  assert.deepEqual(Array.from(out, s => s.email), ['b', 'c', 'a']);
});

await test('rankServices: tie -> site+email asc', async () => {
  const out = ka('rankServices', [
    { site: 'b', email: 'z', frecency: 1, updated_at: 1 },
    { site: 'a', email: 'y', frecency: 1, updated_at: 1 },
    { site: 'a', email: 'x', frecency: 1, updated_at: 1 },
  ]);
  assert.deepEqual(Array.from(out, s => s.email), ['x', 'y', 'z']);
});

await test('rankServices: missing fields treated as 0 (no throw, stable)', async () => {
  const out = ka('rankServices', [
    { site: 'a', email: 'a' },
    { site: 'b', email: 'b', frecency: 1 },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].email, 'b');
});

// --- looksLikeEmail (5) ---
await test('looksLikeEmail: a@b.com -> true', async () => { assert.equal(ka('looksLikeEmail', 'a@b.com'), true); });
await test('looksLikeEmail: nope -> false', async () => { assert.equal(ka('looksLikeEmail', 'nope'), false); });
await test('looksLikeEmail: a@bcom -> false (no dot after @)', async () => { assert.equal(ka('looksLikeEmail', 'a@bcom'), false); });
await test('looksLikeEmail: "a b@c.com" -> false (whitespace)', async () => { assert.equal(ka('looksLikeEmail', 'a b@c.com'), false); });
await test('looksLikeEmail: @b.com -> false (@ at index 0)', async () => { assert.equal(ka('looksLikeEmail', '@b.com'), false); });

// --- selectServiceForFill (10) ---
await test('selectServiceForFill: 0 matches -> none', async () => {
  const r = ka('selectServiceForFill', [], { pageEmail: null });
  assert.equal(r.decision, 'none');
});

await test('selectServiceForFill: 1 + no identity -> fill', async () => {
  const r = ka('selectServiceForFill', [{ email: 'a@b.com' }], { pageEmail: null });
  assert.equal(r.decision, 'fill');
  assert.equal(r.service.email, 'a@b.com');
});

await test('selectServiceForFill: >1 + no identity -> ambiguous (ranked)', async () => {
  const r = ka('selectServiceForFill', [
    { email: 'a@b.com', frecency: 1 },
    { email: 'c@d.com', frecency: 5 },
  ], { pageEmail: null });
  assert.equal(r.decision, 'ambiguous');
  assert.equal(r.candidates[0].email, 'c@d.com');
});

await test('selectServiceForFill: identity matches one -> fill', async () => {
  const r = ka('selectServiceForFill', [
    { email: 'a@b.com' },
    { email: 'c@d.com' },
  ], { pageEmail: 'c@d.com' });
  assert.equal(r.decision, 'fill');
  assert.equal(r.service.email, 'c@d.com');
});

await test('selectServiceForFill: identity matches none -> ambiguous (never contradicting)', async () => {
  const r = ka('selectServiceForFill', [
    { email: 'a@b.com' },
    { email: 'c@d.com' },
  ], { pageEmail: 'x@y.com' });
  assert.equal(r.decision, 'ambiguous');
  assert.equal(r.service, undefined);
});

await test('selectServiceForFill: identity matches >1 -> ambiguous (ranked exact subset)', async () => {
  const r = ka('selectServiceForFill', [
    { email: 'a@b.com', site: 's1', frecency: 1 },
    { email: 'a@b.com', site: 's2', frecency: 9 },
  ], { pageEmail: 'a@b.com' });
  assert.equal(r.decision, 'ambiguous');
  assert.equal(r.candidates.length, 2);
  assert.equal(r.candidates[0].site, 's2');
});

await test('selectServiceForFill: case-insensitive identity match -> fill', async () => {
  const r = ka('selectServiceForFill', [
    { email: 'ALICE@b.com' },
    { email: 'bob@b.com' },
  ], { pageEmail: 'alice@b.com' });
  assert.equal(r.decision, 'fill');
  assert.equal(r.service.email, 'ALICE@b.com');
});

await test('selectServiceForFill: whitespace/upper identity normalized -> fill', async () => {
  const r = ka('selectServiceForFill', [
    { email: 'a@b.com' },
    { email: 'c@d.com' },
  ], { pageEmail: '  A@B.com ' });
  assert.equal(r.decision, 'fill');
  assert.equal(r.service.email, 'a@b.com');
});

await test('selectServiceForFill: 1 host match but identity differs -> ambiguous', async () => {
  const r = ka('selectServiceForFill', [{ email: 'a@b.com' }], { pageEmail: 'c@d.com' });
  assert.equal(r.decision, 'ambiguous');
  assert.equal(r.service, undefined);
});

await test('selectServiceForFill: ambiguous candidates are rank-ordered', async () => {
  const r = ka('selectServiceForFill', [
    { email: 'a@b.com', frecency: 1 },
    { email: 'b@b.com', frecency: 2 },
    { email: 'c@b.com', frecency: 3 },
  ], { pageEmail: null });
  assert.equal(r.decision, 'ambiguous');
  assert.deepEqual(Array.from(r.candidates, s => s.email), ['c@b.com', 'b@b.com', 'a@b.com']);
});

// --- filterMostSpecific (14) ---
// Narrows the domainMatches set to the deepest matching tier (most-specific-match
// wins). Every case also documents the SUBSET/never-broaden security property.
await test('filterMostSpecific: subdomain host + TLD & subdomain saved -> subdomain only (most specific wins)', async () => {
  const out = ka('filterMostSpecific', [
    { site: 'example.com', email: 'a@b.com' },
    { site: 'app.example.com', email: 'a@b.com' },
  ], 'app.example.com');
  assert.deepEqual(Array.from(out, s => s.site), ['app.example.com']);
});

await test('filterMostSpecific: subdomain host + only TLD saved -> TLD (PRESERVE: still fills)', async () => {
  const out = ka('filterMostSpecific', [{ site: 'example.com', email: 'a@b.com' }], 'app.example.com');
  assert.deepEqual(Array.from(out, s => s.site), ['example.com']);
});

await test('filterMostSpecific: TLD host + TLD & subdomain saved -> TLD only', async () => {
  const out = ka('filterMostSpecific', [
    { site: 'example.com', email: 'a@b.com' },
    { site: 'app.example.com', email: 'a@b.com' },
  ], 'example.com');
  assert.deepEqual(Array.from(out, s => s.site), ['example.com']);
});

await test('filterMostSpecific: TLD host + only subdomain saved -> [] (subdomain never matches an ancestor host)', async () => {
  const out = ka('filterMostSpecific', [{ site: 'app.example.com', email: 'a@b.com' }], 'example.com');
  assert.equal(out.length, 0);
});

await test('filterMostSpecific: 3-level chain -> deepest only', async () => {
  const out = ka('filterMostSpecific', [
    { site: 'example.com', email: 'a@b.com' },
    { site: 'b.example.com', email: 'a@b.com' },
    { site: 'a.b.example.com', email: 'a@b.com' },
  ], 'a.b.example.com');
  assert.deepEqual(Array.from(out, s => s.site), ['a.b.example.com']);
});

await test('filterMostSpecific: genuine tie (two accounts same exact site) -> both, input order preserved', async () => {
  const out = ka('filterMostSpecific', [
    { site: 'app.example.com', email: 'first@b.com' },
    { site: 'app.example.com', email: 'second@b.com' },
  ], 'app.example.com');
  assert.deepEqual(Array.from(out, s => s.email), ['first@b.com', 'second@b.com']);
});

await test('filterMostSpecific: no host match -> []', async () => {
  const out = ka('filterMostSpecific', [
    { site: 'other.com', email: 'a@b.com' },
    { site: 'app.example.org', email: 'a@b.com' },
  ], 'app.example.com');
  assert.equal(out.length, 0);
});

await test('filterMostSpecific: hostile/missing site does not throw; name-fallback + only valid match returned', async () => {
  const out = ka('filterMostSpecific', [
    null,
    { site: 12345, email: 'n@b.com' },
    { site: {}, email: 'o@b.com' },
    {},
    { name: 'example.com', email: 'v@b.com' },
  ], 'example.com');
  assert.deepEqual(Array.from(out, s => s.email), ['v@b.com']);
});

await test('filterMostSpecific: multi-label public suffix (no PSL) -> deepest saved', async () => {
  const out = ka('filterMostSpecific', [
    { site: 'example.co.uk', email: 'a@b.com' },
    { site: 'app.example.co.uk', email: 'a@b.com' },
  ], 'app.example.co.uk');
  assert.deepEqual(Array.from(out, s => s.site), ['app.example.co.uk']);
});

await test('filterMostSpecific: "." anchor rejects substring (notexample.com vs example.com) -> []', async () => {
  const out = ka('filterMostSpecific', [{ site: 'example.com', email: 'a@b.com' }], 'notexample.com');
  assert.equal(out.length, 0);
});

await test('filterMostSpecific: "." anchor rejects partial label (xample.com vs app.example.com) -> []', async () => {
  const out = ka('filterMostSpecific', [{ site: 'xample.com', email: 'a@b.com' }], 'app.example.com');
  assert.equal(out.length, 0);
});

await test('filterMostSpecific: case-insensitive site match', async () => {
  const out = ka('filterMostSpecific', [{ site: 'APP.Example.COM', email: 'a@b.com' }], 'app.example.com');
  assert.deepEqual(Array.from(out, s => s.email), ['a@b.com']);
});

await test('filterMostSpecific + selectServiceForFill: subdomain+both -> {decision:"fill"} (was ambiguous)', async () => {
  ctx._kaArgs = [[
    { site: 'example.com', email: 'a@b.com' },
    { site: 'app.example.com', email: 'a@b.com' },
  ], 'app.example.com'];
  const r = runInContext('KeygrainAutofill.selectServiceForFill(KeygrainAutofill.filterMostSpecific(_kaArgs[0], _kaArgs[1]), { pageEmail: null })', ctx);
  assert.equal(r.decision, 'fill');
  assert.equal(r.service.site, 'app.example.com');
});

await test('filterMostSpecific + selectServiceForFill: genuine tie -> {decision:"ambiguous"} (defer)', async () => {
  ctx._kaArgs = [[
    { site: 'app.example.com', email: 'a@b.com' },
    { site: 'app.example.com', email: 'c@d.com' },
  ], 'app.example.com'];
  const r = runInContext('KeygrainAutofill.selectServiceForFill(KeygrainAutofill.filterMostSpecific(_kaArgs[0], _kaArgs[1]), { pageEmail: null })', ctx);
  assert.equal(r.decision, 'ambiguous');
  assert.equal(r.candidates.length, 2);
});

// --- isPasswordDescriptor (3) ---
await test('isPasswordDescriptor: type=password -> true', async () => {
  assert.equal(ka('isPasswordDescriptor', { type: 'password' }), true);
});
await test('isPasswordDescriptor: name contains pass -> true', async () => {
  assert.equal(ka('isPasswordDescriptor', { type: 'text', name: 'passwd' }), true);
});
await test('isPasswordDescriptor: plain text -> false', async () => {
  assert.equal(ka('isPasswordDescriptor', { type: 'text', name: 'firstname', id: 'fn' }), false);
});

// --- isFillableUsernameDescriptor (4) ---
await test('isFillableUsernameDescriptor: visible type=email -> true', async () => {
  assert.equal(ka('isFillableUsernameDescriptor', { type: 'email', visible: true, disabled: false, readOnly: false }), true);
});
await test('isFillableUsernameDescriptor: visible autocomplete=username -> true', async () => {
  assert.equal(ka('isFillableUsernameDescriptor', { type: 'text', autocomplete: 'username', visible: true }), true);
});
await test('isFillableUsernameDescriptor: readonly username -> false', async () => {
  assert.equal(ka('isFillableUsernameDescriptor', { type: 'text', autocomplete: 'username', visible: true, readOnly: true }), false);
});
await test('isFillableUsernameDescriptor: password field -> false', async () => {
  assert.equal(ka('isFillableUsernameDescriptor', { type: 'password', visible: true }), false);
});

// --- extractPageEmail (7) ---
await test('extractPageEmail: focused wins over others', async () => {
  const r = ka('extractPageEmail', [
    { type: 'email', visible: true, value: 'visible@x.com' },
    { type: 'email', focused: true, visible: false, value: 'FOCUSED@x.com' },
  ]);
  assert.equal(r, 'focused@x.com');
});
await test('extractPageEmail: visible filled email', async () => {
  const r = ka('extractPageEmail', [{ type: 'email', visible: true, disabled: false, readOnly: false, value: 'v@x.com' }]);
  assert.equal(r, 'v@x.com');
});
await test('extractPageEmail: readonly email (Google password step)', async () => {
  const r = ka('extractPageEmail', [{ type: 'email', visible: true, readOnly: true, value: 'ro@x.com' }]);
  assert.equal(r, 'ro@x.com');
});
await test('extractPageEmail: hidden identifier w/ email-shaped value', async () => {
  const r = ka('extractPageEmail', [{ type: 'hidden', name: 'identifier', value: 'h@x.com' }]);
  assert.equal(r, 'h@x.com');
});
await test('extractPageEmail: hidden w/ non-email value -> ignored -> null', async () => {
  const r = ka('extractPageEmail', [{ type: 'hidden', name: 'identifier', value: 'notanemail' }]);
  assert.equal(r, null);
});
await test('extractPageEmail: no identity fields -> null', async () => {
  const r = ka('extractPageEmail', [{ type: 'password', visible: true, value: 'x' }]);
  assert.equal(r, null);
});
await test('extractPageEmail: value normalized (trim+lowercase)', async () => {
  const r = ka('extractPageEmail', [{ type: 'email', visible: true, value: '  Mixed@Case.COM  ' }]);
  assert.equal(r, 'mixed@case.com');
});

// --- describeField (5) ---
function elStub(props) {
  return {
    tagName: props.tagName || 'INPUT',
    type: props.type || 'text',
    name: props.name || '',
    id: props.id || '',
    getAttribute: (n) => (props.attrs && props.attrs[n] != null ? props.attrs[n] : null),
    offsetParent: 'offsetParent' in props ? props.offsetParent : {},
    offsetWidth: 'offsetWidth' in props ? props.offsetWidth : 100,
    disabled: !!props.disabled,
    readOnly: !!props.readOnly,
    value: props.value == null ? '' : props.value,
  };
}

await test('describeField: maps type/name/id/autocomplete', async () => {
  const el = elStub({ type: 'email', name: 'user', id: 'u1', attrs: { autocomplete: 'username' } });
  const d = ka('describeField', el, null);
  assert.equal(d.tag, 'input');
  assert.equal(d.type, 'email');
  assert.equal(d.name, 'user');
  assert.equal(d.id, 'u1');
  assert.equal(d.autocomplete, 'username');
});
await test('describeField: visible=false when offsetParent null', async () => {
  const el = elStub({ offsetParent: null, offsetWidth: 10 });
  assert.equal(ka('describeField', el, null).visible, false);
});
await test('describeField: visible=false when offsetWidth 0', async () => {
  const el = elStub({ offsetParent: {}, offsetWidth: 0 });
  assert.equal(ka('describeField', el, null).visible, false);
});
await test('describeField: disabled/readOnly mapped', async () => {
  const el = elStub({ disabled: true, readOnly: true });
  const d = ka('describeField', el, null);
  assert.equal(d.disabled, true);
  assert.equal(d.readOnly, true);
});
await test('describeField: focused=true when el===activeElement', async () => {
  const el = elStub({ type: 'email' });
  assert.equal(ka('describeField', el, el).focused, true);
});

// --- pickPasswordField (3) ---
await test('pickPasswordField: focused password preferred', async () => {
  const r = ka('pickPasswordField', [
    { type: 'password', visible: true, key: 'p1' },
    { type: 'password', focused: true, visible: true, key: 'p2' },
  ]);
  assert.equal(r, 'p2');
});
await test('pickPasswordField: first visible password when none focused', async () => {
  const r = ka('pickPasswordField', [
    { type: 'password', visible: true, key: 'p1' },
    { type: 'password', visible: true, key: 'p2' },
  ]);
  assert.equal(r, 'p1');
});
await test('pickPasswordField: none -> null', async () => {
  const r = ka('pickPasswordField', [{ type: 'text', visible: true, key: 't1' }]);
  assert.equal(r, null);
});

// --- pickUsernameField (3) ---
await test('pickUsernameField: visible username by precedence (autocomplete username first)', async () => {
  const r = ka('pickUsernameField', [
    { type: 'email', visible: true, key: 'e1' },
    { type: 'text', autocomplete: 'username', visible: true, key: 'u1' },
  ]);
  assert.equal(r, 'u1');
});
await test('pickUsernameField: skips readonly/disabled', async () => {
  const r = ka('pickUsernameField', [
    { type: 'text', autocomplete: 'username', visible: true, readOnly: true, key: 'u1' },
    { type: 'email', visible: true, key: 'e1' },
  ]);
  assert.equal(r, 'e1');
});
await test('pickUsernameField: none -> null', async () => {
  const r = ka('pickUsernameField', [{ type: 'password', visible: true, key: 'p1' }]);
  assert.equal(r, null);
});

// ============================================================
// TYPE-GATE REGRESSION (PyPI `type=checkbox id=show-password` bug)
// ============================================================
// Non-enterable controls (checkbox/radio/submit/hidden/...) whose name/id merely
// CONTAINS 'pass'/'user' must NOT be classified as a fillable password/username
// target. The pure classifiers now mirror the inline cheapTagTypeGate accepted
// set ({password,email,text,tel,''}). Regression: PyPI's show-password checkbox
// is visible and sits BEFORE the real password input, so the buggy
// pickPasswordField returned the checkbox and the real field stayed empty.
console.log('\nType-Gate Regression Tests (autofill.js):');

// isPasswordDescriptor — non-enterable types excluded (even with 'pass' in name/id)
await test('isPasswordDescriptor: checkbox id=show-password -> false (PyPI bug)', async () => {
  assert.equal(ka('isPasswordDescriptor', { type: 'checkbox', id: 'show-password' }), false);
});
await test('isPasswordDescriptor: radio name=passcode -> false', async () => {
  assert.equal(ka('isPasswordDescriptor', { type: 'radio', name: 'passcode' }), false);
});
await test('isPasswordDescriptor: submit id=submit-pass -> false', async () => {
  assert.equal(ka('isPasswordDescriptor', { type: 'submit', id: 'submit-pass' }), false);
});
await test('isPasswordDescriptor: hidden name=password -> false', async () => {
  assert.equal(ka('isPasswordDescriptor', { type: 'hidden', name: 'password' }), false);
});
// PRESERVE: enterable-type heuristics still classify real password fields.
await test('isPasswordDescriptor: text name=password (toggled show-password) -> true', async () => {
  assert.equal(ka('isPasswordDescriptor', { type: 'text', name: 'password' }), true);
});
await test('isPasswordDescriptor: text autocomplete=current-password -> true', async () => {
  assert.equal(ka('isPasswordDescriptor', { type: 'text', autocomplete: 'current-password' }), true);
});

// isFillableUsernameDescriptor — non-enterable types excluded (even visible + 'user')
await test('isFillableUsernameDescriptor: checkbox id=show-username (visible) -> false', async () => {
  assert.equal(ka('isFillableUsernameDescriptor', { type: 'checkbox', id: 'show-username', visible: true }), false);
});
await test('isFillableUsernameDescriptor: radio name=user (visible) -> false', async () => {
  assert.equal(ka('isFillableUsernameDescriptor', { type: 'radio', name: 'user', visible: true }), false);
});
await test('isFillableUsernameDescriptor: submit id=user-submit (visible) -> false', async () => {
  assert.equal(ka('isFillableUsernameDescriptor', { type: 'submit', id: 'user-submit', visible: true }), false);
});
// Preserved-behavior lock: a plain search box (type=text name=q) is NOT a
// fillable username. Guards against a future isUsernameLike change making
// 'q'/'search' identity-like. (Independent of the type gate — 'q' fails the
// isUsernameLike name/id regex — but the user listed it as a preserved item.)
await test('isFillableUsernameDescriptor: text name=q search box (visible) -> false', async () => {
  assert.equal(ka('isFillableUsernameDescriptor', { type: 'text', name: 'q', visible: true }), false);
});

// Full PyPI descriptor set in exact DOM order. The show-password checkbox is
// visible:true and precedes the real type=password input — this is what makes it
// a true regression test (fails on the unfixed pickers, passes only after the gate).
const PYPI_LOGIN_FIELDS = [
  { tag: 'input', type: 'text',     name: 'q',          id: 'search',        visible: true,  key: 'k_search' },
  { tag: 'input', type: 'text',     name: 'q',          id: 'mobile-search', visible: true,  key: 'k_msearch' },
  { tag: 'input', type: 'hidden',   name: 'csrf_token', id: '',              visible: false, key: 'k_csrf' },
  { tag: 'input', type: 'text',     name: 'username',   id: 'username',      autocomplete: 'username', visible: true, key: 'k_user' },
  { tag: 'input', type: 'checkbox', name: '',           id: 'show-password', visible: true,  key: 'k_showpw' },
  { tag: 'input', type: 'password', name: 'password',   id: 'password',      autocomplete: 'current-password', visible: true, key: 'k_pw' },
];
await test('PyPI regression: pickPasswordField -> real password field, NOT the show-password checkbox', async () => {
  assert.equal(ka('pickPasswordField', PYPI_LOGIN_FIELDS), 'k_pw');
});
await test('PyPI regression: pickUsernameField -> the username field (search boxes/checkbox ignored)', async () => {
  assert.equal(ka('pickUsernameField', PYPI_LOGIN_FIELDS), 'k_user');
});

// ============================================================
// OTP FIELD CLASSIFIER TESTS (autofill.js — KeygrainAutofill.*)
// ============================================================
// Pure over plain descriptor objects (no DOM), mirroring the isPasswordDescriptor
// style. Covers the exact ordered rule (Frozen Req 3), pickOtpField precedence
// (Req 4), and the over-length guard (Req 10). describeField new attrs use elStub.
console.log('\nOTP Field Classifier Tests:');

// --- isOtpDescriptor positives ---
await test('isOtpDescriptor: autocomplete=one-time-code -> true (definitive)', async () => {
  assert.equal(ka('isOtpDescriptor', { autocomplete: 'one-time-code' }), true);
});
await test('isOtpDescriptor: one-time-code + name=passcode -> true (definitive beats password-reject)', async () => {
  assert.equal(ka('isOtpDescriptor', { autocomplete: 'one-time-code', name: 'passcode' }), true);
});
await test('isOtpDescriptor: type=number autocomplete=one-time-code -> true', async () => {
  assert.equal(ka('isOtpDescriptor', { type: 'number', autocomplete: 'one-time-code' }), true);
});
await test('isOtpDescriptor: STRONG name=otp -> true', async () => {
  assert.equal(ka('isOtpDescriptor', { name: 'otp' }), true);
});
await test('isOtpDescriptor: STRONG id=totp -> true', async () => {
  assert.equal(ka('isOtpDescriptor', { id: 'totp' }), true);
});
await test('isOtpDescriptor: STRONG name=2fa -> true', async () => {
  assert.equal(ka('isOtpDescriptor', { name: '2fa' }), true);
});
await test('isOtpDescriptor: STRONG name=mfa -> true', async () => {
  assert.equal(ka('isOtpDescriptor', { name: 'mfa' }), true);
});
await test('isOtpDescriptor: STRONG name=one-time-code -> true', async () => {
  assert.equal(ka('isOtpDescriptor', { name: 'one-time-code' }), true);
});
await test('isOtpDescriptor: type=tel name=otp -> true', async () => {
  assert.equal(ka('isOtpDescriptor', { type: 'tel', name: 'otp' }), true);
});
await test('isOtpDescriptor: WEAK name=verification + inputmode=numeric -> true', async () => {
  assert.equal(ka('isOtpDescriptor', { name: 'verification', inputmode: 'numeric' }), true);
});
await test('isOtpDescriptor: WEAK name=auth_code + maxlength=6 -> true', async () => {
  assert.equal(ka('isOtpDescriptor', { name: 'auth_code', maxlength: 6 }), true);
});
await test('isOtpDescriptor: no-name inputmode=numeric + maxlength=6 -> true (2 signals)', async () => {
  assert.equal(ka('isOtpDescriptor', { inputmode: 'numeric', maxlength: 6 }), true);
});
await test('isOtpDescriptor: no-name maxlength=6 + pattern=[0-9]* -> true (2 signals)', async () => {
  assert.equal(ka('isOtpDescriptor', { maxlength: 6, pattern: '[0-9]*' }), true);
});

// --- isOtpDescriptor negatives ---
await test('isOtpDescriptor: type=password -> false (gate)', async () => {
  assert.equal(ka('isOtpDescriptor', { type: 'password' }), false);
});
await test('isOtpDescriptor: type=text name=password -> false (password reject)', async () => {
  assert.equal(ka('isOtpDescriptor', { type: 'text', name: 'password' }), false);
});
await test('isOtpDescriptor: type=search -> false (gate)', async () => {
  assert.equal(ka('isOtpDescriptor', { type: 'search' }), false);
});
await test('isOtpDescriptor: type=text name=q -> false', async () => {
  assert.equal(ka('isOtpDescriptor', { type: 'text', name: 'q' }), false);
});
await test('isOtpDescriptor: type=checkbox id=otp -> false (gate before name)', async () => {
  assert.equal(ka('isOtpDescriptor', { type: 'checkbox', id: 'otp' }), false);
});
await test('isOtpDescriptor: type=number quantity (inputmode=numeric only, 1 signal) -> false', async () => {
  assert.equal(ka('isOtpDescriptor', { type: 'number', inputmode: 'numeric' }), false);
});
await test('isOtpDescriptor: maxlength=1 split box -> false (too-small)', async () => {
  assert.equal(ka('isOtpDescriptor', { maxlength: 1 }), false);
});
await test('isOtpDescriptor: maxlength=5 -> false (too-small)', async () => {
  assert.equal(ka('isOtpDescriptor', { maxlength: 5 }), false);
});
await test('isOtpDescriptor: WEAK name=api_token maxlength=64 -> false (0 corroboration — security case)', async () => {
  assert.equal(ka('isOtpDescriptor', { name: 'api_token', maxlength: 64 }), false);
});
await test('isOtpDescriptor: WEAK name=verify alone -> false (no corroboration)', async () => {
  assert.equal(ka('isOtpDescriptor', { name: 'verify' }), false);
});
await test('isOtpDescriptor: type=email -> false (gate)', async () => {
  assert.equal(ka('isOtpDescriptor', { type: 'email' }), false);
});
// REQUIRED (observer): step 2 (maxlength<6) precedes step 3 (definitive one-time-code).
// A split-box OTP widget is 6x autocomplete=one-time-code maxlength=1 inputs; each
// MUST be rejected (Frozen Req 3.2 / 7, v1). Guards against a future reorder of steps 2/3.
await test('isOtpDescriptor: one-time-code + maxlength=1 -> false (step 2 before step 3)', async () => {
  assert.equal(ka('isOtpDescriptor', { autocomplete: 'one-time-code', maxlength: 1 }), false);
});
await test('isOtpDescriptor: one-time-code + maxlength=5 -> false (step 2 before step 3)', async () => {
  assert.equal(ka('isOtpDescriptor', { autocomplete: 'one-time-code', maxlength: 5 }), false);
});
// SUGGESTED (observer): isolate patternIsDigits rejecting a non-digit pattern (1 signal only).
await test('isOtpDescriptor: inputmode=numeric + pattern=[a-z]+ -> false (non-digit pattern, 1 signal)', async () => {
  assert.equal(ka('isOtpDescriptor', { inputmode: 'numeric', pattern: '[a-z]+' }), false);
});

// --- pickOtpField (Frozen Req 4) ---
await test('pickOtpField: focused OTP > first visible OTP > first OTP', async () => {
  const r = ka('pickOtpField', [
    { autocomplete: 'one-time-code', visible: true, key: 'o1' },
    { autocomplete: 'one-time-code', focused: true, visible: true, key: 'o2' },
  ]);
  assert.equal(r, 'o2');
});
await test('pickOtpField: none -> null', async () => {
  assert.equal(ka('pickOtpField', [{ type: 'text', name: 'firstname', key: 't1' }]), null);
});
await test('pickOtpField: skips a maxlength=1 box, returns the real OTP field', async () => {
  const r = ka('pickOtpField', [
    { autocomplete: 'one-time-code', maxlength: 1, visible: true, key: 'box' },
    { autocomplete: 'one-time-code', maxlength: 6, visible: true, key: 'real' },
  ]);
  assert.equal(r, 'real');
});
await test('pickOtpField: mixed page picks the OTP field, not the password', async () => {
  const r = ka('pickOtpField', [
    { type: 'password', visible: true, key: 'pw' },
    { name: 'otp', visible: true, key: 'otp' },
  ]);
  assert.equal(r, 'otp');
});

// --- otpCodeFitsField (Frozen Req 10 over-length guard) ---
await test('otpCodeFitsField: (6,6)=true', async () => { assert.equal(ka('otpCodeFitsField', 6, 6), true); });
await test('otpCodeFitsField: (8,6)=false', async () => { assert.equal(ka('otpCodeFitsField', 8, 6), false); });
await test('otpCodeFitsField: (7,6)=false', async () => { assert.equal(ka('otpCodeFitsField', 7, 6), false); });
await test('otpCodeFitsField: (6,null)=true (unset attribute)', async () => { assert.equal(ka('otpCodeFitsField', 6, null), true); });
await test('otpCodeFitsField: (8,-1)=true (DOM .maxLength unset sentinel)', async () => { assert.equal(ka('otpCodeFitsField', 8, -1), true); });
await test('otpCodeFitsField: (6,8)=true', async () => { assert.equal(ka('otpCodeFitsField', 6, 8), true); });
await test('otpCodeFitsField: (8,8)=true', async () => { assert.equal(ka('otpCodeFitsField', 8, 8), true); });
await test('otpCodeFitsField: (6,NaN)=true (hostile -> no constraint)', async () => { assert.equal(ka('otpCodeFitsField', 6, NaN), true); });
await test('otpCodeFitsField: (8,"abc")=true (hostile string -> no constraint)', async () => { assert.equal(ka('otpCodeFitsField', 8, 'abc'), true); });

// --- describeField new attrs (additive; via elStub) ---
await test('describeField: maps inputmode/maxlength/pattern from attributes', async () => {
  const el = elStub({ attrs: { inputmode: 'numeric', maxlength: '6', pattern: '[0-9]*' } });
  const d = ka('describeField', el, null);
  assert.equal(d.inputmode, 'numeric');
  assert.equal(d.maxlength, 6);
  assert.equal(d.pattern, '[0-9]*');
});
await test('describeField: absent inputmode/maxlength/pattern -> ""/null/""', async () => {
  const d = ka('describeField', elStub({}), null);
  assert.equal(d.inputmode, '');
  assert.equal(d.maxlength, null);
  assert.equal(d.pattern, '');
});
await test('describeField: maxlength="abc" -> null', async () => {
  const d = ka('describeField', elStub({ attrs: { maxlength: 'abc' } }), null);
  assert.equal(d.maxlength, null);
});

// ============================================================
// INLINE-AUTOFILL PURE-HELPER TESTS (inline-autofill.js — KeygrainInline.*)
// ============================================================
// Increment A pure helpers for native in-field autofill plumbing. Pure over
// plain service/account objects — no DOM. computeMatchPatterns bounds persistent
// registration (drop malformed hosts so one bad site can't poison the whole
// batch); sanitizeAccountForContent is the security whitelist for what crosses
// into the content world.
console.log('\nInline-Autofill Pure-Helper Tests:');

// --- computeMatchPatterns (13) ---
await test('computeMatchPatterns: multi-label -> exact + subdomain wildcard', async () => {
  const out = ki('computeMatchPatterns', [{ id: '1', site: 'example.com' }]);
  assert.deepEqual(out, ['*://*.example.com/*', '*://example.com/*']);
});
await test('computeMatchPatterns: bare TLD com -> exact only (no wildcard)', async () => {
  const out = ki('computeMatchPatterns', [{ id: '1', site: 'com' }]);
  assert.deepEqual(out, ['*://com/*']);
});
await test('computeMatchPatterns: single-label localhost -> exact only', async () => {
  const out = ki('computeMatchPatterns', [{ id: '1', site: 'localhost' }]);
  assert.deepEqual(out, ['*://localhost/*']);
});
await test('computeMatchPatterns: IPv4 -> exact only (no wildcard)', async () => {
  const out = ki('computeMatchPatterns', [{ id: '1', site: '192.168.1.1' }]);
  assert.deepEqual(out, ['*://192.168.1.1/*']);
});
await test('computeMatchPatterns: IPv6 [::1] -> dropped (no pattern, no throw)', async () => {
  const out = ki('computeMatchPatterns', [{ id: '1', site: '[::1]' }]);
  assert.deepEqual(out, []);
});
await test('computeMatchPatterns: empty/garbage site -> dropped', async () => {
  const out = ki('computeMatchPatterns', [
    { id: '1', site: '' },
    { id: '2', site: 'has space' },
    { id: '3', site: 'a/b' },
  ]);
  assert.deepEqual(out, []);
});
await test('computeMatchPatterns: port example.com:8443 -> dropped', async () => {
  const out = ki('computeMatchPatterns', [{ id: '1', site: 'example.com:8443' }]);
  assert.deepEqual(out, []);
});
await test('computeMatchPatterns: trailing dot example.com. -> dropped', async () => {
  const out = ki('computeMatchPatterns', [{ id: '1', site: 'example.com.' }]);
  assert.deepEqual(out, []);
});
await test('computeMatchPatterns: userinfo u@h -> dropped', async () => {
  const out = ki('computeMatchPatterns', [{ id: '1', site: 'u@h' }]);
  assert.deepEqual(out, []);
});
await test('computeMatchPatterns: two services same host -> deduped', async () => {
  const out = ki('computeMatchPatterns', [
    { id: '1', site: 'example.com', email: 'a@x.com' },
    { id: '2', site: 'example.com', email: 'b@x.com' },
  ]);
  assert.deepEqual(out, ['*://*.example.com/*', '*://example.com/*']);
});
await test('computeMatchPatterns: two services different hosts -> both', async () => {
  const out = ki('computeMatchPatterns', [
    { id: '1', site: 'a.com' },
    { id: '2', site: 'b.org' },
  ]);
  assert.deepEqual(out, ['*://*.a.com/*', '*://*.b.org/*', '*://a.com/*', '*://b.org/*']);
});
await test('computeMatchPatterns: site missing -> falls back to name', async () => {
  const out = ki('computeMatchPatterns', [{ id: '1', name: 'fallback.com' }]);
  assert.deepEqual(out, ['*://*.fallback.com/*', '*://fallback.com/*']);
});
await test('computeMatchPatterns: output deterministic (sorted, stable)', async () => {
  const a = ki('computeMatchPatterns', [{ id: '1', site: 'zeta.com' }, { id: '2', site: 'alpha.com' }]);
  const b = ki('computeMatchPatterns', [{ id: '2', site: 'alpha.com' }, { id: '1', site: 'zeta.com' }]);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['*://*.alpha.com/*', '*://*.zeta.com/*', '*://alpha.com/*', '*://zeta.com/*']);
});

// --- inlineIconState (7) ---
await test('inlineIconState: !enabled -> hidden', async () => {
  assert.equal(ki('inlineIconState', { enabled: false, unlocked: true, hasLoginField: true, hasMatches: true }), 'hidden');
});
await test('inlineIconState: !hasLoginField -> hidden', async () => {
  assert.equal(ki('inlineIconState', { enabled: true, unlocked: true, hasLoginField: false, hasMatches: true }), 'hidden');
});
await test('inlineIconState: enabled + !unlocked + hasLoginField -> locked', async () => {
  assert.equal(ki('inlineIconState', { enabled: true, unlocked: false, hasLoginField: true, hasMatches: false }), 'locked');
});
await test('inlineIconState: enabled + unlocked + hasLoginField + hasMatches -> active', async () => {
  assert.equal(ki('inlineIconState', { enabled: true, unlocked: true, hasLoginField: true, hasMatches: true }), 'active');
});
await test('inlineIconState: enabled + unlocked + hasLoginField + !hasMatches -> hidden', async () => {
  assert.equal(ki('inlineIconState', { enabled: true, unlocked: true, hasLoginField: true, hasMatches: false }), 'hidden');
});
await test('inlineIconState: locked precedence when both !unlocked and !hasMatches', async () => {
  assert.equal(ki('inlineIconState', { enabled: true, unlocked: false, hasLoginField: true, hasMatches: false }), 'locked');
});
await test('inlineIconState: never throws on missing keys', async () => {
  assert.equal(ki('inlineIconState', {}), 'hidden');
  assert.equal(ki('inlineIconState'), 'hidden');
});

// --- sanitizeAccountForContent (6) ---
const sacFull = {
  id: 'svc-1', email: 'a@b.com', name: 'My Acct', site: 'b.com',
  password: 'SECRET', counter: 3, length: 32, symbols: '!@#',
  totp: { seed: 'x' }, ssh: { key: 'y' }, frecency: 9, updated_at: 123,
};
await test('sanitizeAccountForContent: output has exactly {token,email,name}', async () => {
  const out = ki('sanitizeAccountForContent', sacFull);
  assert.deepEqual(Object.keys(out).sort(), ['email', 'name', 'token']);
});
await test('sanitizeAccountForContent: password stripped', async () => {
  assert.equal('password' in ki('sanitizeAccountForContent', sacFull), false);
});
await test('sanitizeAccountForContent: counter/length/symbols stripped', async () => {
  const out = ki('sanitizeAccountForContent', sacFull);
  assert.equal('counter' in out, false);
  assert.equal('length' in out, false);
  assert.equal('symbols' in out, false);
});
await test('sanitizeAccountForContent: totp/ssh stripped', async () => {
  const out = ki('sanitizeAccountForContent', sacFull);
  assert.equal('totp' in out, false);
  assert.equal('ssh' in out, false);
});
await test('sanitizeAccountForContent: site/frecency/updated_at stripped', async () => {
  const out = ki('sanitizeAccountForContent', sacFull);
  assert.equal('site' in out, false);
  assert.equal('frecency' in out, false);
  assert.equal('updated_at' in out, false);
});
await test('sanitizeAccountForContent: token equals service.id', async () => {
  const out = ki('sanitizeAccountForContent', sacFull);
  assert.equal(out.token, 'svc-1');
  assert.equal(out.email, 'a@b.com');
  assert.equal(out.name, 'My Acct');
});

// --- buildDropdownModel (12) — host-aware secondary dedupe ---
// Signature: buildDropdownModel(accounts, host) -> [{token, primary, secondary}].
// primary = email. secondary = name ONLY when it adds info: non-empty AND its
// trimmed/lowercased form differs from BOTH host AND email. PURE + MUST NOT throw.
await test('buildDropdownModel: maps token/email->primary, distinct name->secondary (host given)', async () => {
  const out = ki('buildDropdownModel', [{ token: 't1', email: 'a@b.com', name: 'Acct' }], 'b.com');
  assert.equal(out[0].token, 't1');
  assert.equal(out[0].primary, 'a@b.com');
  assert.equal(out[0].secondary, 'Acct');
});
await test('buildDropdownModel: order preserved (host given)', async () => {
  const out = ki('buildDropdownModel', [
    { token: 't1', email: 'a@b.com', name: 'Work' },
    { token: 't2', email: 'c@d.com', name: 'Home' },
  ], 'b.com');
  assert.deepEqual(Array.from(out, m => m.token), ['t1', 't2']);
});
await test('buildDropdownModel: empty input -> []', async () => {
  assert.deepEqual(ki('buildDropdownModel', [], 'b.com'), []);
});
await test('buildDropdownModel: missing name (undefined) -> secondary ""', async () => {
  const out = ki('buildDropdownModel', [{ token: 't1', email: 'a@b.com' }], 'b.com');
  assert.equal(out[0].secondary, '');
});
await test('buildDropdownModel: empty-string name -> secondary ""', async () => {
  const out = ki('buildDropdownModel', [{ token: 't1', email: 'a@b.com', name: '' }], 'b.com');
  assert.equal(out[0].secondary, '');
});
await test('buildDropdownModel: no extra fields leak into the model', async () => {
  const out = ki('buildDropdownModel', [{ token: 't1', email: 'a@b.com', name: 'Work', password: 'x', site: 's' }], 'b.com');
  assert.deepEqual(Object.keys(out[0]).sort(), ['primary', 'secondary', 'token']);
});
await test('buildDropdownModel: name === host (exact) -> secondary ""', async () => {
  const out = ki('buildDropdownModel', [{ token: 't1', email: 'u@github.com', name: 'github.com' }], 'github.com');
  assert.equal(out[0].secondary, '');
});
await test('buildDropdownModel: name === host (case/whitespace-insensitive) -> secondary ""', async () => {
  const out = ki('buildDropdownModel', [{ token: 't1', email: 'u@x.com', name: '  GitHub.COM  ' }], 'github.com');
  assert.equal(out[0].secondary, '');
});
await test('buildDropdownModel: name === email -> secondary ""', async () => {
  const out = ki('buildDropdownModel', [{ token: 't1', email: 'a@b.com', name: 'a@b.com' }], 'x.com');
  assert.equal(out[0].secondary, '');
});
await test('buildDropdownModel: distinct name "Work" -> secondary "Work"', async () => {
  const out = ki('buildDropdownModel', [{ token: 't1', email: 'a@b.com', name: 'Work' }], 'b.com');
  assert.equal(out[0].secondary, 'Work');
});
await test('buildDropdownModel: missing host arg -> treated as "" (name shows if != email; hidden when == email)', async () => {
  const shows = ki('buildDropdownModel', [{ token: 't1', email: 'a@b.com', name: 'Work' }]);
  assert.equal(shows[0].secondary, 'Work');
  const hidden = ki('buildDropdownModel', [{ token: 't2', email: 'a@b.com', name: 'a@b.com' }]);
  assert.equal(hidden[0].secondary, '');
});
await test('buildDropdownModel: non-string name does not throw, coerces (hostile sync data)', async () => {
  let out;
  assert.doesNotThrow(() => { out = ki('buildDropdownModel', [{ token: 't1', email: 'a@b.com', name: 12345 }], 'b.com'); });
  assert.equal(out[0].secondary, '12345');
  assert.equal(typeof out[0].secondary, 'string');
});

// ============================================================
// INLINE-AUTOFILL-UI BEHAVIORAL TESTS (shared/inline-autofill-ui.js — F1 fix)
// ============================================================
// The UI file is a self-executing DOM IIFE with NO exports, so these tests load
// it into a vm context under a HAND-ROLLED DOM/chrome mock (jsdom is banned by the
// no-npm-deps rule) and drive it through its real event handlers. They verify the
// F1 clickjacking-fix CONTROL FLOW that remains after the confirmed-non-functional
// IO-v2 occlusion gate was dropped (the Chrome contingency): layer A (the
// activeIndex=-1 no-op) and layer B (the pointerdown+click arm/consume). They do
// NOT — and cannot — verify real-browser occlusion, which needs a layout engine
// Node lacks; the opaque pointer-events:none paint-over residual (now Chrome+Firefox
// parity) is an accepted, documented limitation, with the toolbar popup + Ctrl/Cmd+
// Shift+K as the unspoofable fallback. A green run here is a REVERT-GUARD (e.g. it
// catches a future activeIndex=0 or unarmed-activation regression), not proof
// against a real paint-over.
console.log('\nInline-Autofill-UI Behavioral Tests (F1 clickjacking fix — control flow only):');

function loadInlineUI({ accounts = [
  { token: 't1', email: 'a@example.com', name: 'Alice' },
  { token: 't2', email: 'b@example.com', name: 'Bob' },
], otp = false } = {}) {
  const handlers = new WeakMap(); // el -> { type -> [fn] }
  function on(el, type, fn) { let m = handlers.get(el); if (!m) { m = {}; handlers.set(el, m); } (m[type] = m[type] || []).push(fn); }
  function off(el, type, fn) { const m = handlers.get(el); if (m && m[type]) m[type] = m[type].filter(x => x !== fn); }
  function fire(el, type, ev) { const m = handlers.get(el); if (!m || !m[type]) return; for (const fn of m[type].slice()) fn(ev); }

  function makeEl(tag) {
    return {
      tagName: (tag || 'div').toUpperCase(),
      type: '', name: '', id: '', className: '', tabIndex: 0, innerHTML: '', textContent: '',
      style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; } },
      children: [], parentNode: null, _attrs: {},
      setAttribute(k, v) { this._attrs[k] = String(v); },
      getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
      removeAttribute(k) { delete this._attrs[k]; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
      addEventListener(t, fn) { on(this, t, fn); },
      removeEventListener(t, fn) { off(this, t, fn); },
      getBoundingClientRect() { return { top: 100, left: 100, right: 200, bottom: 130, width: 100, height: 30 }; },
      focus() {}, scrollIntoView() {}, contains() { return true; },
    };
  }

  const state = { host: null, root: null, sent: [] };

  // A visible, enabled, editable field. Default: a password field -> classifies as login.
  // otp:true -> a text field with autocomplete=one-time-code -> classifies as OTP (§D4 step 1).
  const input = makeEl('input');
  if (otp) { input.type = 'text'; input.setAttribute('autocomplete', 'one-time-code'); }
  else { input.type = 'password'; }
  input.offsetParent = {}; input.offsetWidth = 20; input.disabled = false; input.readOnly = false;

  function ElementCtor() {}
  ElementCtor.prototype.attachShadow = function () { const root = makeEl('#shadow'); state.host = this; state.root = root; return root; };

  const documentEl = makeEl('html'); documentEl.contains = () => true;
  const body = makeEl('body');
  const doc = {
    documentElement: documentEl, body, activeElement: null,
    createElement: (tag) => makeEl(tag),
    querySelectorAll: (sel) => (sel === 'input' ? [input] : []),
    addEventListener() {}, removeEventListener() {}, contains() { return true; },
    elementFromPoint: () => state.host, // simulate: pointer hits our host (topmost)
  };
  const win = { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (msg, cb) => { state.sent.push(msg); if (msg && (msg.action === 'getInlineMatches' || msg.action === 'getInlineOtpMatches')) { cb && cb({ enabled: true, locked: false, accounts }); return; } cb && cb(undefined); },
      onMessage: { addListener() {}, removeListener() {} },
    },
  };
  // Firefox-style promise API. The new sendMsg() PREFERS browser.runtime.sendMessage(msg)
  // (returns a promise), matching the real Firefox MV2 background that answers by
  // RETURNING A PROMISE from its inline onMessage listener. This makes the behavioral
  // tests exercise the exact code path the Firefox fix relies on, and pushes to
  // state.sent EXACTLY ONCE per call (the callback fallback below is never reached).
  const browser = {
    runtime: {
      lastError: undefined,
      sendMessage: (msg) => { state.sent.push(msg); return Promise.resolve(msg && (msg.action === 'getInlineMatches' || msg.action === 'getInlineOtpMatches') ? { enabled: true, locked: false, accounts } : undefined); },
      onMessage: { addListener() {}, removeListener() {} },
    },
  };

  const g = {
    window: win, document: doc, chrome, browser, Element: ElementCtor,
    location: { hostname: 'example.com' }, // content-script global; toggleDropdown reads location.hostname for the host-aware model
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {},
    console, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Date,
    Set, Map, WeakMap, WeakSet, Promise, parseInt, parseFloat, isNaN, isFinite,
  };
  const c = createContext(g);
  runInContext(readFileSync(resolve(shared, 'autofill.js'), 'utf8'), c);
  runInContext(readFileSync(resolve(shared, 'inline-autofill.js'), 'utf8'), c);
  // Intentionally NO `window.Keygrain*` bridge here: the harness `window` (win) is a distinct object from the context globalThis (g), faithfully modeling Firefox (this===globalThis!==window). Helpers are exposed on globalThis by autofill.js/inline-autofill.js, which is exactly where inline-autofill-ui.js reads them. Re-adding a bridge would MASK a window.* regression in the UI reads.
  runInContext(readFileSync(resolve(shared, 'inline-autofill-ui.js'), 'utf8'), c);

  return {
    state, fire,
    getIcon: () => (state.root ? state.root.children.find(e => e.className === 'kg-icon') : null),
    getDropdown: () => (state.root ? state.root.children.find(e => e.className === 'kg-dd') : null),
    rows: (dd) => dd.children.filter(e => e.className === 'kg-opt'),
    filled: () => state.sent.filter(m => m && m.action === 'fillInline'),
    ev: (over) => Object.assign({ isTrusted: true, clientX: 150, clientY: 115, preventDefault() {} }, over),
  };
}

// engage() is async (awaits the getInlineMatches round-trip); drain microtasks so the icon renders.
const flushUI = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise(r => setImmediate(r)); };

async function openDropdownViaIcon(h) {
  await flushUI();
  const icon = h.getIcon();
  assert.ok(icon, 'icon should render after engage');
  h.fire(icon, 'pointerdown', h.ev({ currentTarget: icon })); // arm
  h.fire(icon, 'click', h.ev({ currentTarget: icon }));       // consume -> activateIcon -> openDropdown
  const dd = h.getDropdown();
  assert.ok(dd, 'dropdown should open on a trusted (armed+consumed) icon activation');
  return dd;
}

// (1) Unit A revert-guard — NON-NEGOTIABLE. activeIndex=-1 is the ONLY reason no
// fill happens; if activeIndex reverts to 0, this test fails (a stray Enter would
// fill option 0).
await test('F1/A: stray Enter with activeIndex=-1 sends NO fillInline', async () => {
  const h = loadInlineUI();
  const dd = await openDropdownViaIcon(h);
  h.fire(dd, 'keydown', h.ev({ key: 'Enter' })); // nothing highlighted (activeIndex=-1)
  assert.equal(h.filled().length, 0);
});

// (2) Deliberate keyboard selection still fills.
await test('F1/A: ArrowDown then Enter on a row sends fillInline', async () => {
  const h = loadInlineUI();
  const dd = await openDropdownViaIcon(h);
  h.fire(dd, 'keydown', h.ev({ key: 'ArrowDown' })); // -1 -> 0
  h.fire(dd, 'keydown', h.ev({ key: 'Enter' }));
  assert.equal(h.filled().length, 1);
  assert.equal(h.filled()[0].token, 't1');
});

// (3) Unit B — pointerdown+pointerup arm/consume.
await test('F1/B: option click WITHOUT an armed pointerdown is rejected', async () => {
  const h = loadInlineUI();
  const dd = await openDropdownViaIcon(h);
  const row = h.rows(dd)[0];
  h.fire(row, 'click', h.ev({ currentTarget: row })); // no prior pointerdown -> not armed
  assert.equal(h.filled().length, 0);
});
await test('F1/B: option click ARMED + trusted sends fillInline', async () => {
  const h = loadInlineUI();
  const dd = await openDropdownViaIcon(h);
  const row = h.rows(dd)[0];
  h.fire(row, 'pointerdown', h.ev({ currentTarget: row })); // arm
  h.fire(row, 'click', h.ev({ currentTarget: row }));       // consume -> fill
  assert.equal(h.filled().length, 1);
  assert.equal(h.filled()[0].token, 't1');
});

// (10) Icon arm/consume revert-guard — an unarmed icon click must NOT open.
await test('F1/B: icon click WITHOUT an armed pointerdown does not open the dropdown', async () => {
  const h = loadInlineUI();
  await flushUI();
  const icon = h.getIcon();
  assert.ok(icon, 'icon should render');
  h.fire(icon, 'click', h.ev({ currentTarget: icon })); // no prior pointerdown -> not armed
  assert.ok(!h.getDropdown(), 'unarmed icon click must not open the dropdown');
});

// (11) Unit B — the icon renders the real logo as a data: URI <img>.
await test('Unit B: icon renders an <img> whose src is the PNG data: URI', async () => {
  const h = loadInlineUI();
  await flushUI();
  const icon = h.getIcon();
  assert.ok(icon, 'icon should render');
  const img = icon.children.find(e => e.tagName === 'IMG');
  assert.ok(img, 'icon button should contain an <img>');
  assert.ok(img.src.startsWith('data:image/png;base64,'), 'img src should be a PNG data: URI');
  assert.equal(img.getAttribute('aria-hidden'), 'true');
});

// (12) Unit B — CSP fallback: an img 'error' swaps in the inline SVG so a
// clickable icon ALWAYS appears (the 'robust' requirement).
await test('Unit B: img error swaps in the inline ICON_SVG fallback', async () => {
  const h = loadInlineUI();
  await flushUI();
  const icon = h.getIcon();
  const img = icon.children.find(e => e.tagName === 'IMG');
  assert.ok(img, 'img should exist before the error');
  h.fire(img, 'error', {}); // simulate the page CSP blocking the data: image
  assert.ok(/<svg/.test(icon.innerHTML), 'on img error the button content should become the inline SVG');
  assert.ok(/currentColor/.test(icon.innerHTML), 'fallback should be the real ICON_SVG');
});

// (13) Part 2 — XSS-safe avatar revert-guard. The leading avatar shows the email
// INITIAL via textContent (NOT innerHTML) and is aria-hidden (decorative), so the
// option's announced text is unchanged and hostile account data cannot inject
// markup through the avatar. Mirrors the Unit B img guards.
await test('Part 2: row avatar uses textContent initial (not innerHTML) + aria-hidden', async () => {
  const h = loadInlineUI();
  const dd = await openDropdownViaIcon(h);
  const row = h.rows(dd)[0];
  const avatar = row.children.find(e => e.className === 'kg-opt-avatar');
  assert.ok(avatar, 'row should render a .kg-opt-avatar');
  assert.equal(avatar.textContent, 'A');   // 'a@example.com' -> first char uppercased
  assert.equal(avatar.innerHTML, '');       // textContent path only — no innerHTML with account data
  assert.equal(avatar.getAttribute('aria-hidden'), 'true');
});

// (14) Part 2 — C5 regression guard: the avatar String-coerces the RAW email
// before .trim(), so a hostile/corrupt non-string email must NOT throw and wedge
// the fill path; the dropdown must still open and the initial is the coerced char.
await test('Part 2: non-string email does not throw; dropdown still opens (C5 guard)', async () => {
  const h = loadInlineUI({ accounts: [{ token: 't1', email: 12345, name: 'x' }] });
  await flushUI();
  const icon = h.getIcon();
  assert.ok(icon, 'icon should render');
  h.fire(icon, 'pointerdown', h.ev({ currentTarget: icon }));                       // arm
  assert.doesNotThrow(() => h.fire(icon, 'click', h.ev({ currentTarget: icon })));  // consume -> openDropdown must not throw
  const dd = h.getDropdown();
  assert.ok(dd, 'dropdown must open even when email is a non-string');
  const avatar = h.rows(dd)[0].children.find(e => e.className === 'kg-opt-avatar');
  assert.equal(avatar.textContent, '1'); // String(12345).trim().charAt(0) -> '1'
});

// ============================================================
// U5 OTP INLINE-UI CONTROL-FLOW TESTS (inline-autofill-ui.js — classify + route)
// ============================================================
// Same hand-rolled DOM/chrome mock as the F1 tests, with loadInlineUI({otp:true})
// configuring the engaged field as autocomplete=one-time-code (classifies OTP, §D4).
// Verifies the OTP path routes to getInlineOtpMatches + fillInlineOtp, plus a
// revert-guard that a login field STILL routes to getInlineMatches + fillInline (so a
// future classifyEngageField regression that diverts login -> OTP is caught).
console.log('\nU5 OTP Inline-UI Control-Flow Tests:');

await test('U5/OTP: an OTP-classified field routes to getInlineOtpMatches + renders the icon (NOT getInlineMatches)', async () => {
  const h = loadInlineUI({ otp: true });
  await flushUI();
  assert.ok(h.getIcon(), 'icon should render for an OTP field');
  assert.equal(h.state.sent.some(m => m && m.action === 'getInlineOtpMatches'), true, 'sends the OTP query');
  assert.equal(h.state.sent.some(m => m && m.action === 'getInlineMatches'), false, 'must NOT send the login query for an OTP field');
});

await test('U5/OTP: a trusted armed selection sends {action:"fillInlineOtp",token} (NOT fillInline)', async () => {
  const h = loadInlineUI({ otp: true });
  const dd = await openDropdownViaIcon(h);
  const row = h.rows(dd)[0];
  h.fire(row, 'pointerdown', h.ev({ currentTarget: row })); // arm
  h.fire(row, 'click', h.ev({ currentTarget: row }));       // consume -> selectToken
  const otpFills = h.state.sent.filter(m => m && m.action === 'fillInlineOtp');
  assert.equal(otpFills.length, 1, 'exactly one fillInlineOtp');
  assert.equal(otpFills[0].token, 't1');
  assert.equal(h.state.sent.some(m => m && m.action === 'fillInline'), false, 'must NOT send fillInline on the OTP path');
});

await test('U5/login revert-guard: a login field still routes to getInlineMatches + fillInline (NOT the OTP actions)', async () => {
  const h = loadInlineUI(); // default: password field -> login
  const dd = await openDropdownViaIcon(h);
  const row = h.rows(dd)[0];
  h.fire(row, 'pointerdown', h.ev({ currentTarget: row }));
  h.fire(row, 'click', h.ev({ currentTarget: row }));
  assert.equal(h.state.sent.some(m => m && m.action === 'getInlineMatches'), true, 'login uses getInlineMatches');
  assert.equal(h.state.sent.some(m => m && m.action === 'getInlineOtpMatches'), false, 'login must NOT use the OTP query');
  assert.equal(h.state.sent.filter(m => m && m.action === 'fillInline').length, 1, 'login selection sends fillInline');
  assert.equal(h.state.sent.some(m => m && m.action === 'fillInlineOtp'), false, 'login must NOT send fillInlineOtp');
});

// ============================================================
// SUMMARY
// ============================================================
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
