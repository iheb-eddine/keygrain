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
  for (const file of ['keygrain.js', 'bip39-wordlist.js', 'wallet.js', 'bip85.js', 'totp.js', 'ssh.js', 'sync.js']) {
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

// --- Load test vectors ---
const totpVectors = JSON.parse(readFileSync(resolve(root, 'totp-vectors.json'), 'utf8'));
const sshVectors = JSON.parse(readFileSync(resolve(root, 'ssh-vectors.json'), 'utf8'));
const walletVectors = JSON.parse(readFileSync(resolve(root, 'wallet-vectors.json'), 'utf8'));
const coreVectors = JSON.parse(readFileSync(resolve(root, 'vectors.json'), 'utf8'));

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
    const result = await call('secretFingerprint', v.secret_utf8, v.email);
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

await test('mergeServices: local-only with UUID not in remote = deleted remotely', async () => {
  const local = [{ id: 'd', site: 'gone.com', updated_at: 100 }];
  const remote = [];
  const meta = [];
  ctx._local = local; ctx._remote = remote; ctx._meta = meta; ctx._known = new Set();
  const result = runInContext(`mergeServices(_local, _remote, _meta, _known)`, ctx);
  assert.equal(result.merged.length, 0);
});

await test('mergeServices: local new (no UUID) preserved', async () => {
  const local = [{ site: 'brand-new.com', updated_at: 300 }];
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

// ============================================================
// SUMMARY
// ============================================================
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
