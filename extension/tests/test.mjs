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
  for (const file of ['keygrain.js', 'bip39-wordlist.js', 'wallet.js', 'bip85.js', 'totp.js', 'ssh.js', 'sync.js', 'popup-crypto.js', 'popup-dialog.js', 'autofill.js', 'inline-autofill.js', 'migration-state.js', 'migrate.js']) {
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

// Helper to call KeygrainMigrate.* pure helpers (migrate.js) in the VM context.
function km(method, ...args) {
  ctx._kmArgs = args;
  return runInContext(`KeygrainMigrate.${method}(..._kmArgs)`, ctx);
}

// Helper to call KeygrainMigration.* pure helpers (migration-state.js) in the VM
// context. Results are round-tripped through JSON so assertions compare plain data
// rather than VM-realm objects.
function kmig(method, ...args) {
  ctx._kmigArgs = args;
  return runInContext(`JSON.parse(JSON.stringify(KeygrainMigration.${method}(..._kmigArgs) ?? null))`, ctx);
}

// --- Load test vectors ---
const totpVectors = JSON.parse(readFileSync(resolve(root, 'totp-vectors.json'), 'utf8'));
const sshVectors = JSON.parse(readFileSync(resolve(root, 'ssh-vectors.json'), 'utf8'));
const walletVectors = JSON.parse(readFileSync(resolve(root, 'wallet-vectors.json'), 'utf8'));
const coreVectors = JSON.parse(readFileSync(resolve(root, 'vectors.json'), 'utf8'));
const syncVectors = JSON.parse(readFileSync(resolve(root, 'sync-vectors.json'), 'utf8'));
const reconcileVectors = JSON.parse(readFileSync(resolve(root, 'sync-reconcile-vectors.json'), 'utf8'));

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
// SYNC RECONCILIATION TESTS (Sync v3 — deletion reconciliation)
// ============================================================
// Supersedes the v2 mergeServices tests: mergeServices was replaced by
// reconcileServices, which adds tombstones, the synced flag and the
// lastSuccessfulSyncAt barrier. See designs/sync-deletion-reconciliation.md.
console.log('\nSync Reconciliation Tests:');

// Helper: reconcileServices(local, tombstones, remoteServices, remoteMeta, lastSyncAt, remoteExists)
function reconcile(ctx, local, tombstones, remote, meta, lastSyncAt = 0, remoteExists = true) {
  ctx._local = local; ctx._tombs = tombstones; ctx._remote = remote; ctx._meta = meta;
  ctx._lastSync = lastSyncAt; ctx._exists = remoteExists;
  return runInContext(`reconcileServices(_local, _tombs, _remote, _meta, _lastSync, _exists)`, ctx);
}

// Cross-platform reconcile oracle (sync-reconcile-vectors.json) — the SAME table drives
// the Kotlin SyncReconcileTest. Normalizes reconcile output to a platform-neutral shape so
// any JS/Kotlin divergence is a test failure. See designs/sync-deletion-reconciliation.md.
function normReconcile(r) {
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    merged: r.merged.map(s => ({ id: s.id, synced: !!s.synced, updated_at: s.updated_at, site: s.site })).sort(byId),
    deletedIds: [...r.deletedIds].sort(),
    review: r.review.map(e => e.service.id).sort(),
    tombstones: r.tombstones.map(t => t.id).sort(),
    resurrected: [...r.resurrected].sort(),
  };
}
for (const v of reconcileVectors.vectors) {
  await test(`reconcile vector: ${v.name}`, async () => {
    const remoteContent = v.remote.map(({ id, updated_at, ...content }) => content);
    const meta = v.remote.map(r => ({ id: r.id, updated_at: r.updated_at }));
    const r = reconcile(ctx, v.local, v.tombstones, remoteContent, meta, v.lastSuccessfulSyncAt, v.remoteExists);
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const expected = {
      merged: v.expect.merged.map(m => ({ id: m.id, synced: m.synced, updated_at: m.updated_at, site: m.site })).sort(byId),
      deletedIds: [...v.expect.deletedIds].sort(),
      review: [...v.expect.review].sort(),
      tombstones: [...v.expect.tombstones].sort(),
      resurrected: [...v.expect.resurrected].sort(),
    };
    // JSON string compare: reconcile output objects live in the VM realm, so
    // deepStrictEqual fails on prototype identity. Structure equality is what matters.
    assert.equal(JSON.stringify(normReconcile(r)), JSON.stringify(expected));
  });
}

// Rule 3: both sides have it, local newer wins.
await test('reconcile rule 3: local newer wins', async () => {
  const r = reconcile(ctx,
    [{ id: 'a', site: 'local.com', updated_at: 200, synced: true }],
    [], [{ site: 'remote.com' }], [{ id: 'a', updated_at: 100 }]);
  assert.equal(r.merged.length, 1);
  assert.equal(r.merged[0].site, 'local.com');
  assert.equal(r.merged[0].synced, true);
});

// Rules 1+2: remote newer or equal wins (tie goes to remote).
await test('reconcile rules 1-2: remote wins ties', async () => {
  const r = reconcile(ctx,
    [{ id: 'a', site: 'local.com', updated_at: 100, synced: true }],
    [], [{ site: 'remote.com' }], [{ id: 'a', updated_at: 100 }]);
  assert.equal(r.merged[0].site, 'remote.com');
});

// Rule 5: remote-only with no tombstone is created locally.
await test('reconcile rule 5: remote-only creates locally', async () => {
  const r = reconcile(ctx, [], [], [{ site: 'new.com' }], [{ id: 'b', updated_at: 50 }]);
  assert.equal(r.merged.length, 1);
  assert.equal(r.merged[0].id, 'b');
  assert.equal(r.merged[0].synced, true);
});

// Rule 4: local-only and never synced is pushed, NEVER deleted.
await test('reconcile rule 4: unsynced local-only is pushed not deleted', async () => {
  const r = reconcile(ctx,
    [{ id: 'local-1', site: 'brand-new.com', updated_at: 300, synced: false }],
    [], [], []);
  assert.equal(r.merged.length, 1);
  assert.equal(r.merged[0].site, 'brand-new.com');
  assert.equal(r.review.length, 0);
});

// Rule 6: local-only but previously synced was deleted elsewhere.
await test('reconcile rule 6: synced local-only is deleted', async () => {
  const r = reconcile(ctx,
    [{ id: 'd', site: 'gone.com', updated_at: 100, synced: true }],
    [], [], [], 500);
  assert.equal(r.merged.length, 0);
});

// Frozen Req 7 negative: no unsynced change -> silent, nothing retained.
await test('reconcile: routine remote deletion retains nothing', async () => {
  const r = reconcile(ctx,
    [{ id: 'd', site: 'gone.com', updated_at: 100, synced: true }],
    [], [], [], 500);
  assert.equal(r.review.length, 0);
});

// Frozen Req 7: unsynced local change destroyed by a remote deletion -> retained.
await test('reconcile: remote deletion of locally-edited service is retained for review', async () => {
  const r = reconcile(ctx,
    [{ id: 'd', site: 'edited.com', updated_at: 900, synced: true }],
    [], [], [], 500);
  assert.equal(r.merged.length, 0);
  assert.equal(r.review.length, 1);
  assert.equal(r.review[0].service.id, 'd');
});

// Rule 7: a newer remote edit supersedes a pending local deletion.
await test('reconcile rule 7: newer remote edit resurrects over tombstone', async () => {
  const r = reconcile(ctx, [],
    [{ id: 'x', deleted_at: 100 }],
    [{ site: 'edited-elsewhere.com' }], [{ id: 'x', updated_at: 200 }]);
  assert.equal(r.merged.length, 1);
  assert.equal(r.merged[0].id, 'x');
  assert.equal(r.resurrected.length, 1);
  assert.equal(r.resurrected[0], 'x');
  assert.equal(r.tombstones.length, 0);
  assert.equal(r.deletedIds.length, 0);
});

// Rule 7 negative: deletion is newer than the remote record -> delete, declared.
await test('reconcile rule 7: older remote record stays deleted and is declared', async () => {
  const r = reconcile(ctx, [],
    [{ id: 'x', deleted_at: 300 }],
    [{ site: 'stale.com' }], [{ id: 'x', updated_at: 200 }]);
  assert.equal(r.merged.length, 0);
  assert.equal(r.deletedIds.length, 1);
  assert.equal(r.deletedIds[0], 'x');
  assert.equal(r.tombstones.length, 1);
});

// Frozen Req 5: a tombstone for an id the server no longer holds is cleared and does
// NOT force a PUT (it must not appear in deletedIds).
await test('reconcile: tombstone for already-absent id is cleared without a PUT', async () => {
  const r = reconcile(ctx, [], [{ id: 'x', deleted_at: 300 }], [], []);
  assert.equal(r.merged.length, 0);
  assert.equal(r.tombstones.length, 0);
  assert.equal(r.deletedIds.length, 0);
});

// Lost-response repair: the server holds the record under the SAME client-generated
// UUID, so it matches by id — no duplicate, and the flag flips to synced.
await test('reconcile: lost PUT response repairs by id without duplicating', async () => {
  const r = reconcile(ctx,
    [{ id: 'same', site: 'a.com', email: 'u@e.com', updated_at: 100, synced: false }],
    [], [{ site: 'a.com', email: 'u@e.com' }], [{ id: 'same', updated_at: 100 }]);
  assert.equal(r.merged.length, 1);
  assert.equal(r.merged[0].id, 'same');
  assert.equal(r.merged[0].synced, true);
});

// A deletion inside the lost-response window still propagates, because the tombstone
// is written regardless of `synced`.
await test('reconcile: deletion in the lost-response window still propagates', async () => {
  const r = reconcile(ctx, [], [{ id: 'inflight', deleted_at: 500 }],
    [{ site: 'a.com' }], [{ id: 'inflight', updated_at: 100 }]);
  assert.equal(r.merged.length, 0);
  assert.equal(r.deletedIds.length, 1);
  assert.equal(r.deletedIds[0], 'inflight');
});

// Frozen Req 11: a 404 must NEVER be read as deletions, or a lost server blob would
// wipe every device.
await test('reconcile: absent remote record never infers deletions', async () => {
  const r = reconcile(ctx,
    [{ id: 'a', site: 'x.com', updated_at: 100, synced: true },
     { id: 'b', site: 'y.com', updated_at: 200, synced: true }],
    [{ id: 'c', deleted_at: 50 }], [], [], 999, false);
  assert.equal(r.merged.length, 2);
  assert.equal(r.review.length, 0);
  assert.equal(r.tombstones.length, 0);
  assert.equal(r.deletedIds.length, 0);
  assert.equal(r.merged.every(s => s.synced === false), true);
});

// A 200 with zero services IS a legitimate delete-all (unlike a 404).
await test('reconcile: empty remote record deletes synced local records', async () => {
  const r = reconcile(ctx,
    [{ id: 'a', site: 'x.com', updated_at: 100, synced: true }],
    [], [], [], 500, true);
  assert.equal(r.merged.length, 0);
});

// Duplicate collapse: the synced loser is tombstoned AND declared, so it is removed
// server-side rather than merely dropped locally. Both ids must be present remotely —
// a synced local record ABSENT remotely is a rule 6 deletion and never reaches dedup.
await test('reconcile: duplicate collapse tombstones and declares the synced loser', async () => {
  const r = reconcile(ctx, [], [],
    [{ site: 'example.com', email: 'a@b.com', counter: 1 },
     { site: 'example.com', email: 'a@b.com', counter: 2 }],
    [{ id: 'y1', updated_at: 100 }, { id: 'y2', updated_at: 200 }]);
  assert.equal(r.merged.length, 1);
  assert.equal(r.merged[0].id, 'y2');
  assert.equal(r.deletedIds.length, 1);
  assert.equal(r.deletedIds[0], 'y1');
  assert.equal(r.tombstones.some(t => t.id === 'y1'), true);
});

await test('reconcile: empty-normalizing sites use id as dedup key, no collision', async () => {
  const r = reconcile(ctx, [
    { id: 'x1', site: 'www.', email: 'a@b.com', updated_at: 100, synced: false },
    { id: 'x2', site: 'https://', email: 'a@b.com', updated_at: 200, synced: false }
  ], [], [], []);
  assert.equal(r.merged.length, 2);
});

await test('reconcile: same non-empty normalized site still deduplicates', async () => {
  const r = reconcile(ctx, [
    { id: 'y1', site: 'https://example.com/path', email: 'a@b.com', updated_at: 100, synced: false },
    { id: 'y2', site: 'http://www.example.com', email: 'a@b.com', updated_at: 200, synced: false }
  ], [], [], []);
  assert.equal(r.merged.length, 1);
  assert.equal(r.merged[0].id, 'y2');
});

// An unsynced duplicate loser must NOT be declared (the server never had it).
await test('reconcile: unsynced duplicate loser is not declared for deletion', async () => {
  const r = reconcile(ctx, [
    { id: 'z1', site: 'example.com', email: 'a@b.com', updated_at: 100, synced: false, counter: 1 },
    { id: 'z2', site: 'example.com', email: 'a@b.com', updated_at: 200, synced: false, counter: 2 }
  ], [], [], []);
  assert.equal(r.merged.length, 1);
  assert.equal(r.deletedIds.length, 0);
});

// Editing must NOT clear `synced` — otherwise rule 6 becomes unreachable for edited
// records and deleted services resurrect. Guards the invariant directly.
await test('reconcile: an edited synced record is still subject to remote deletion', async () => {
  const r = reconcile(ctx,
    [{ id: 'e', site: 'edited.com', updated_at: 900, synced: true }],
    [], [], [], 1000);
  assert.equal(r.merged.length, 0);
  assert.equal(r.review.length, 0);
});

// Legacy pre-UUID records must be given an id and pushed, never silently dropped.
// Kotlin already did this; the JS previously discarded them.
await test('reconcile: local service without an id is assigned one, not dropped', async () => {
  const r = reconcile(ctx, [{ site: 'legacy.com', email: 'a@b.com', updated_at: 100 }], [], [], []);
  assert.equal(r.merged.length, 1);
  assert.equal(typeof r.merged[0].id, 'string');
  assert.equal(r.merged[0].site, 'legacy.com');
  assert.equal(r.merged[0].synced, false);
});

await test('reconcile: id-less local service survives an absent remote record', async () => {
  const r = reconcile(ctx, [{ site: 'legacy.com', email: 'a@b.com', updated_at: 100 }], [], [], [], 0, false);
  assert.equal(r.merged.length, 1);
  assert.equal(typeof r.merged[0].id, 'string');
});

// ---- canonicalBlobPayload (no-op skip, Frozen Req 9) ----

await test('canonicalBlobPayload: order-independent for services', async () => {
  ctx._c1 = [{ site: 'a.com' }, { site: 'b.com' }];
  ctx._m1 = [{ id: 'i1', updated_at: 1 }, { id: 'i2', updated_at: 2 }];
  ctx._c2 = [{ site: 'b.com' }, { site: 'a.com' }];
  ctx._m2 = [{ id: 'i2', updated_at: 2 }, { id: 'i1', updated_at: 1 }];
  const a = runInContext(`canonicalBlobPayload(_c1, _m1, [], [], [])`, ctx);
  const b = runInContext(`canonicalBlobPayload(_c2, _m2, [], [], [])`, ctx);
  assert.equal(a, b);
});

await test('canonicalBlobPayload: differs when a field changes', async () => {
  ctx._c1 = [{ site: 'a.com', counter: 1 }];
  ctx._m1 = [{ id: 'i1', updated_at: 1 }];
  ctx._c2 = [{ site: 'a.com', counter: 2 }];
  const a = runInContext(`canonicalBlobPayload(_c1, _m1, [], [], [])`, ctx);
  const b = runInContext(`canonicalBlobPayload(_c2, _m1, [], [], [])`, ctx);
  assert.notEqual(a, b);
});

await test('canonicalBlobPayload: differs when wallets change (not just services)', async () => {
  ctx._c1 = [{ site: 'a.com' }];
  ctx._m1 = [{ id: 'i1', updated_at: 1 }];
  ctx._w1 = [{ wallet_name: 'main', chain: 'bitcoin' }];
  const a = runInContext(`canonicalBlobPayload(_c1, _m1, [], [], [])`, ctx);
  const b = runInContext(`canonicalBlobPayload(_c1, _m1, _w1, [], [])`, ctx);
  assert.notEqual(a, b);
});

// The canonical payload decides whether a PUT can be skipped, and SyncBlob.kt says it "MUST stay
// byte-identical" to this function. Nothing compares the two platforms mechanically, so both sides
// pin the SAME literal for the same input: if either drifts, its own suite fails. `migrating` is in
// it because it is remote state — the extension sets it and syncs it — and its absence from the
// Kotlin side made that client blind to a difference that lived only in this field, so it skipped
// pushes it should have made. Note the shape: `true` when set, `null` when absent, never `false`
// (applyMigrating deletes the property).
await test('canonicalBlobPayload: exact serialization, shared with SyncBlob.kt', async () => {
  ctx._c1 = [
    {name: 'A', site: 'a.com', email: 'e@x', length: 20, symbols: '!@', counter: 1, migrating: true},
    {name: 'B', site: 'b.com', email: 'e@x', length: 20, symbols: '!@', counter: 1}
  ];
  ctx._m1 = [{id: 'i1', updated_at: 1}, {id: 'i2', updated_at: 2}];
  assert.equal(runInContext(`canonicalBlobPayload(_c1, _m1, [], [], [])`, ctx),
    '{"services":[{"id":"i1","updated_at":1,"name":"A","site":"a.com","email":"e@x","length":20,' +
    '"symbols":"!@","counter":1,"migrating":true,"totp":null,"ssh":null},' +
    '{"id":"i2","updated_at":2,"name":"B","site":"b.com","email":"e@x","length":20,' +
    '"symbols":"!@","counter":1,"migrating":null,"totp":null,"ssh":null}],' +
    '"wallets":[],"wallet_audit_log":[],"sync_conflicts":[]}');
});

await test('canonicalBlobPayload: differs when only `migrating` differs', async () => {
  ctx._c1 = [{site: 'a.com', migrating: true}];
  ctx._c2 = [{site: 'a.com'}];
  ctx._m1 = [{id: 'i1', updated_at: 1}];
  assert.notEqual(runInContext(`canonicalBlobPayload(_c1, _m1, [], [], [])`, ctx),
    runInContext(`canonicalBlobPayload(_c2, _m1, [], [], [])`, ctx));
});

await test('canonicalBlobPayload: excludes local-only synced flag', async () => {
  ctx._c1 = [{ site: 'a.com' }];
  ctx._c2 = [{ site: 'a.com', synced: true }];
  ctx._m1 = [{ id: 'i1', updated_at: 1 }];
  const a = runInContext(`canonicalBlobPayload(_c1, _m1, [], [], [])`, ctx);
  const b = runInContext(`canonicalBlobPayload(_c2, _m1, [], [], [])`, ctx);
  assert.equal(a, b);
});

// ---- migrateLocalPayload (design §8) ----

await test('migrateLocalPayload: knownUUIDs become synced flags', async () => {
  ctx._p = { services: [{ id: 'k1' }, { id: 'k2' }] };
  ctx._k = ['k1'];
  const r = runInContext(`JSON.parse(JSON.stringify(migrateLocalPayload(_p, new Set(_k), 1000)))`, ctx);
  assert.equal(r.services.find(s => s.id === 'k1').synced, true);
  assert.equal(r.services.find(s => s.id === 'k2').synced, false);
  assert.equal(r.version, 2);
});

await test('migrateLocalPayload: known-but-absent ids become tombstones', async () => {
  ctx._p = { services: [{ id: 'k1' }] };
  ctx._k = ['k1', 'deleted-pending'];
  const r = runInContext(`JSON.parse(JSON.stringify(migrateLocalPayload(_p, new Set(_k), 1000)))`, ctx);
  assert.equal(r.tombstones.length, 1);
  assert.equal(r.tombstones[0].id, 'deleted-pending');
  assert.equal(r.tombstones[0].deleted_at, 1000);
});

await test('migrateLocalPayload: absent knownUUIDs defaults synced to false', async () => {
  ctx._p = { services: [{ id: 'k1' }] };
  const r = runInContext(`JSON.parse(JSON.stringify(migrateLocalPayload(_p, new Set(), 1000)))`, ctx);
  assert.equal(r.services[0].synced, false);
  assert.equal(r.tombstones.length, 0);
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
// DELETE SERVER DATA (sync.js: classifyDeleteStatus + deleteServerData)
// ============================================================
console.log('\nDelete Server Data Tests:');

// classifyDeleteStatus — pure status -> outcome mapping (Invariant #1: only
// 200/404 are a confirmed delete).
for (const [status, expected] of [
  [200, { ok: true, result: 'success' }],
  [404, { ok: true, result: 'success' }],
  [401, { ok: false, result: 'auth' }],
  [403, { ok: false, result: 'auth' }],
  [429, { ok: false, result: 'rate_limited' }],
  [500, { ok: false, result: 'server' }],
  [400, { ok: false, result: 'server' }],
  [418, { ok: false, result: 'server' }],
]) {
  await test(`classifyDeleteStatus: ${status} -> ${expected.result}`, async () => {
    const r = call('classifyDeleteStatus', status);
    assert.equal(r.ok, expected.ok);
    assert.equal(r.result, expected.result);
  });
}

// deleteServerData — integration with an injected fetch + chrome.storage stub.
// getSyncServer() reads chrome.storage.local.get; the stub returns {} so it
// falls back to DEFAULT_SYNC_SERVER (https://keygrain.com).
ctx.chrome = { storage: { local: { get: async () => ({}) } } };
runInContext(
  `globalThis.fetch = async (url, opts) => {
     _deleteCalls.push({ url, method: opts && opts.method, headers: opts && opts.headers });
     if (_throwFetch) throw new Error('net');
     return { status: _nextStatus };
   };`,
  ctx
);

for (const [status, ok, result] of [
  [200, true, 'success'],
  [404, true, 'success'],
  [401, false, 'auth'],
  [429, false, 'rate_limited'],
  [503, false, 'server'],
]) {
  await test(`deleteServerData: HTTP ${status} -> ok=${ok}, result=${result}`, async () => {
    ctx._throwFetch = false;
    ctx._nextStatus = status;
    ctx._deleteCalls = [];
    const r = await runInContext(`deleteServerData('a', 'test@gmail.com')`, ctx);
    assert.equal(r.ok, ok);
    assert.equal(r.result, result);
    assert.equal(ctx._deleteCalls.length, 1, 'exactly one request');
    assert.equal(ctx._deleteCalls[0].method, 'DELETE');
    assert.ok(ctx._deleteCalls[0].url.startsWith('https://keygrain.com/api/sync/'), 'targets the sync endpoint');
    assert.ok(/^Basic /.test(ctx._deleteCalls[0].headers.Authorization), 'sends HTTP Basic auth');
  });
}

await test('deleteServerData: network failure -> {ok:false, result:network}, no wipe signal', async () => {
  ctx._throwFetch = true;
  ctx._nextStatus = 0;
  ctx._deleteCalls = [];
  const r = await runInContext(`deleteServerData('a', 'test@gmail.com')`, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.result, 'network');
});

// Invariant #1 contract: across the whole HTTP status space, ONLY 200/404 may
// report ok:true (the popup's wipe / offline-flip branch is gated on result.ok,
// so no other status can trigger it).
await test('classifyDeleteStatus: only 200 and 404 are ok:true across 100-599', async () => {
  const okStatuses = [];
  for (let s = 100; s <= 599; s++) {
    if (call('classifyDeleteStatus', s).ok) okStatuses.push(s);
  }
  assert.deepEqual(okStatuses, [200, 404]);
});

// ============================================================
// migrate.js — extractDomain (bare-host bug fix, see migrate.js)
// ============================================================
// Managers like KeePassXC put a bare host (no scheme) in the URL column. Before
// the fix `new URL("github.com")` threw, host stayed "", and the fn fell back to
// the entry title lowercased ("github") — a DIFFERENT site than "github.com",
// producing a different derived password and breaking autofill matching.
await test('extractDomain: bare host resolves to the host', async () => {
  assert.equal(km('extractDomain', 'github.com', 'GitHub'), 'github.com');
});
await test('extractDomain: bare host with path resolves to the host', async () => {
  assert.equal(km('extractDomain', 'github.com/login', 'GitHub'), 'github.com');
});
await test('extractDomain: scheme-ful URL still resolves (regression)', async () => {
  assert.equal(km('extractDomain', 'https://github.com', 'GitHub'), 'github.com');
});
await test('extractDomain: STRIP_PREFIXES applies to a bare host', async () => {
  assert.equal(km('extractDomain', 'accounts.google.com', 'Google'), 'google.com');
});
await test('extractDomain: garbage URL falls back to the title', async () => {
  // Whitespace makes this invalid even with an https:// prefix, so BOTH parses
  // throw and the fn falls back to the title. (A dotless token WITHOUT invalid
  // chars, e.g. "foobar", instead resolves to itself — see the test below.)
  assert.equal(km('extractDomain', 'not a url', 'MyBank'), 'mybank');
});
await test('extractDomain: empty URL falls back to the title', async () => {
  assert.equal(km('extractDomain', '', 'MyBank'), 'mybank');
});
await test('extractDomain: IP address is preserved', async () => {
  assert.equal(km('extractDomain', '192.168.1.1', 'Router'), '192.168.1.1');
});
await test('extractDomain: www. is stripped from a bare host', async () => {
  assert.equal(km('extractDomain', 'www.example.com', 'Example'), 'example.com');
});
// A single dotless token in the URL column now resolves to that token as the
// host (rather than falling back to the title). Locked in intentionally: a bare
// label has no TLD, matches no real domain, and the URL column is authoritative.
await test('extractDomain: single dotless token resolves to that token', async () => {
  assert.equal(km('extractDomain', 'foobar', 'SomeTitle'), 'foobar');
});

// ============================================================
// migrate.js — resolveSiteFields (provenance classifier, see migrate.js)
// ============================================================
// resolveSiteFields returns { site, source } so the migration preview can show
// the user the ORIGINAL export address next to the guessed Site. `source` is one
// of "url" | "title" | "empty". extractDomain delegates to it (returns .site), so
// the byte-identity of the derived site is guarded by the extractDomain tests
// above PLUS the consistency test below.
await test('resolveSiteFields: scheme-ful URL classifies as url', async () => {
  const r = km('resolveSiteFields', 'https://github.com', 'GitHub');
  assert.equal(r.site, 'github.com'); assert.equal(r.source, 'url');
});
await test('resolveSiteFields: bare host with path classifies as url', async () => {
  const r = km('resolveSiteFields', 'github.com/login', 'GitHub');
  assert.equal(r.site, 'github.com'); assert.equal(r.source, 'url');
});
await test('resolveSiteFields: STRIP_PREFIXES host still classifies as url', async () => {
  const r = km('resolveSiteFields', 'accounts.google.com', 'Google');
  assert.equal(r.site, 'google.com'); assert.equal(r.source, 'url');
});
await test('resolveSiteFields: IP host classifies as url', async () => {
  const r = km('resolveSiteFields', '192.168.1.1', 'Router');
  assert.equal(r.site, '192.168.1.1'); assert.equal(r.source, 'url');
});
await test('resolveSiteFields: garbage url + title falls back to title', async () => {
  const r = km('resolveSiteFields', 'not a url', 'MyBank');
  assert.equal(r.site, 'mybank'); assert.equal(r.source, 'title');
});
await test('resolveSiteFields: empty url + title falls back to title', async () => {
  const r = km('resolveSiteFields', '', 'MyBank');
  assert.equal(r.site, 'mybank'); assert.equal(r.source, 'title');
});
await test('resolveSiteFields: empty url + empty title is empty', async () => {
  const r = km('resolveSiteFields', '', '');
  assert.equal(r.site, ''); assert.equal(r.source, 'empty');
});
await test('resolveSiteFields: garbage url + empty title is empty', async () => {
  const r = km('resolveSiteFields', 'not a url', '');
  assert.equal(r.site, ''); assert.equal(r.source, 'empty');
});
// Consistency: the delegation refactor must not let extractDomain drift from
// resolveSiteFields(...).site on ANY branch. Pinned inputs = every existing
// extractDomain test input PLUS an explicit STRIP_PREFIXES case and a
// MULTI_PART_TLDS case, so the prefix and multi-part-TLD branches are covered.
await test('resolveSiteFields: extractDomain === resolveSiteFields(...).site for pinned inputs', async () => {
  const inputs = [
    ['github.com', 'GitHub'],
    ['github.com/login', 'GitHub'],
    ['https://github.com', 'GitHub'],
    ['accounts.google.com', 'Google'],
    ['not a url', 'MyBank'],
    ['', 'MyBank'],
    ['192.168.1.1', 'Router'],
    ['www.example.com', 'Example'],
    ['foobar', 'SomeTitle'],
    ['login.github.com', 'GitHub'],          // STRIP_PREFIXES branch
    ['accounts.foo.co.uk', 'Foo'],           // MULTI_PART_TLDS branch
    ['', ''],                                // empty branch
  ];
  for (const [url, name] of inputs) {
    assert.equal(km('extractDomain', url, name), km('resolveSiteFields', url, name).site, `mismatch for [${url}, ${name}]`);
  }
});

// ============================================================
// migration-state.js — single source of truth for migration status
// ============================================================
// Migration progress used to live in two places at once: services[].migrating
// (synced) and migrationChecklist[].status (not synced). Nothing kept them in
// agreement and both directions drifted, so the checklist now stores MEMBERSHIP
// only and every status is DERIVED from the flag. These tests pin that property
// and each of the drift paths that motivated it.

const SVC = (id, over = {}) => ({
  id, name: id + '.com', site: id + '.com', email: 'a@b.c',
  length: 20, symbols: '!@#$%&*-_=+?', counter: 1,
  updated_at: 1000, synced: true, ...over
});
const CL2 = (...ids) => ({version: 2, createdAt: 'T0', items: ids.map(id => ({id}))});

await test('project: status is derived from services[].migrating', async () => {
  const services = [SVC('a', {migrating: true}), SVC('b')];
  const rows = kmig('project', CL2('a', 'b'), services);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[1].status, 'done');
});

// The bug behind "the menu still says migration in progress": rotating from the popup
// deletes svc.migrating but cannot touch the checklist, so a stored status stayed
// "pending" forever. The count now reads the flag and reports it as done.
await test('countPending: popup rotation (flag cleared) counts as done', async () => {
  assert.equal(kmig('countPending', [SVC('a')]), 0);
});

await test('countPending: counts exactly the flagged services', async () => {
  assert.equal(kmig('countPending', [SVC('a', {migrating: true}), SVC('b', {migrating: true}), SVC('c')]), 2);
  assert.equal(kmig('countPending', []), 0);
  assert.equal(kmig('countPending', null), 0);
});

// The count must not consult the checklist. It is local-only, while `migrating` is in
// the sync blob, so a device that received an import through sync has the flags and no
// checklist — consulting membership would show N badges and a count of zero.
await test('countPending: independent of the checklist', async () => {
  assert.equal(kmig('countPending', [SVC('a', {migrating: true})]), 1);
  assert.deepEqual(kmig('migratingIds', [SVC('a'), SVC('b', {migrating: true})]), ['b']);
});

// Same reason, from the render side: a flagged service the checklist forgot (renamed
// before the v1 upgrade could resolve it) must still be listed as pending, because the
// popup is still badging it and still warning on copy/fill.
await test('project: a flagged non-member is still listed as pending', async () => {
  const rows = kmig('project', CL2('a'), [SVC('a'), SVC('b', {migrating: true})]);
  assert.deepEqual(rows.map(r => [r.id, r.status]), [['a', 'done'], ['b', 'pending']]);
});

await test('project: flagged non-members are not duplicated', async () => {
  const rows = kmig('project', CL2('a', 'a'), [SVC('a', {migrating: true})]);
  assert.equal(rows.length, 1);
});

await test('project: members come first in checklist order, then flagged strangers', async () => {
  const services = [SVC('x', {migrating: true}), SVC('b'), SVC('a', {migrating: true})];
  assert.deepEqual(kmig('project', CL2('a', 'b'), services).map(r => r.id), ['a', 'b', 'x']);
});

// The other stuck-counter path: a service deleted in the popup left an item that
// nothing could ever mark done.
await test('project: items whose service no longer exists are dropped', async () => {
  const rows = kmig('project', CL2('a', 'gone'), [SVC('a', {migrating: true})]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'a');
});

await test('project: name and email come from the service, so renames show through', async () => {
  const rows = kmig('project', CL2('a'), [SVC('a', {name: 'Renamed', email: 'new@b.c', migrating: true})]);
  assert.equal(rows[0].name, 'Renamed');
  assert.equal(rows[0].email, 'new@b.c');
});

await test('project: no checklist and no flags yields no rows', async () => {
  assert.equal(kmig('project', null, [SVC('a')]).length, 0);
  assert.equal(kmig('project', CL2(), [SVC('a')]).length, 0);
  assert.equal(kmig('project', null, []).length, 0);
});

// Membership is only needed to remember DONE rows. A pending row needs nothing but
// the flag, so the checklist being absent must not hide it.
await test('project: a flag with no checklist at all still yields a pending row', async () => {
  const rows = kmig('project', null, [SVC('a', {migrating: true})]);
  assert.deepEqual(rows.map(r => [r.id, r.status]), [['a', 'pending']]);
});

await test('project: services without an id are not addressable', async () => {
  const legacy = {name: 'a.com', email: 'a@b.c', migrating: true};
  assert.equal(kmig('project', {version: 2, createdAt: 'T0', items: [{}]}, [legacy]).length, 0);
});

// ---- v1 -> v2 upgrade ----

await test('upgradeChecklist: v1 items resolve to service ids, case-insensitively', async () => {
  const services = [SVC('a', {name: 'GitHub', email: 'Me@B.C'}), SVC('b', {name: 'Google'})];
  const up = kmig('upgradeChecklist', {version: 1, createdAt: 'T0', items: [
    {name: 'github', email: 'me@b.c', status: 'done'},
    {name: 'Google', email: 'a@b.c', status: 'pending'}
  ]}, services);
  assert.equal(up.version, 2);
  assert.equal(up.createdAt, 'T0');
  assert.deepEqual(up.items, [{id: 'a'}, {id: 'b'}]);
});

await test('upgradeChecklist: unmatched v1 items are dropped', async () => {
  const up = kmig('upgradeChecklist', {version: 1, items: [{name: 'ghost', email: 'x@y.z'}]}, [SVC('a')]);
  assert.deepEqual(up.items, []);
});

await test('upgradeChecklist: two items with the same name map to distinct services', async () => {
  const services = [SVC('a', {name: 'dup'}), SVC('b', {name: 'dup'})];
  const up = kmig('upgradeChecklist', {version: 1, items: [
    {name: 'dup', email: 'a@b.c'}, {name: 'dup', email: 'a@b.c'}
  ]}, services);
  assert.deepEqual(up.items, [{id: 'a'}, {id: 'b'}]);
});

// A v1 "done" whose flag survived (rename defeated the old name match, or the sync
// tie-break restored it) must read as pending: the popup is still warning about it.
await test('upgradeChecklist: discards stored status, so a surviving flag reads pending', async () => {
  const services = [SVC('a', {migrating: true})];
  const v1 = {version: 1, items: [{name: 'a.com', email: 'a@b.c', status: 'done'}]};
  assert.equal(kmig('project', v1, services)[0].status, 'pending');
});

await test('upgradeChecklist: a null checklist upgrades to an empty v2 one', async () => {
  const up = kmig('upgradeChecklist', null, [SVC('a')]);
  assert.equal(up.version, 2);
  assert.equal(up.createdAt, null);
  assert.deepEqual(up.items, []);
});

await test('normalize: absent checklist stays null and is never invented', async () => {
  assert.equal(kmig('normalize', null, []).checklist, null);
  assert.equal(kmig('normalize', undefined, []).changed, false);
  assert.equal(kmig('normalize', {version: 1}, []).checklist, null); // no items array
});

await test('normalize: v2 is returned unchanged, v1 is flagged as changed', async () => {
  assert.equal(kmig('normalize', CL2('a'), [SVC('a')]).changed, false);
  const r = kmig('normalize', {version: 1, items: [{name: 'a.com', email: 'a@b.c'}]}, [SVC('a')]);
  assert.equal(r.changed, true);
  assert.equal(r.checklist.version, 2);
});

// ---- membership ----

await test('newChecklist: version 2, ids deduped, blanks dropped', async () => {
  const cl = kmig('newChecklist', ['a', 'b', 'a', null, ''], 'T1');
  assert.equal(cl.version, 2);
  assert.equal(cl.createdAt, 'T1');
  assert.deepEqual(cl.items, [{id: 'a'}, {id: 'b'}]);
});

await test('addIds: appends new ids and keeps the original createdAt', async () => {
  const cl = kmig('addIds', CL2('a'), ['b', 'a', 'c'], 'T9');
  assert.equal(cl.createdAt, 'T0');
  assert.deepEqual(cl.items, [{id: 'a'}, {id: 'b'}, {id: 'c'}]);
});

await test('addIds: a v1 or absent checklist is replaced by a fresh v2 one', async () => {
  assert.deepEqual(kmig('addIds', null, ['a'], 'T1').items, [{id: 'a'}]);
  const fromV1 = kmig('addIds', {version: 1, items: [{name: 'x'}]}, ['a'], 'T1');
  assert.equal(fromV1.version, 2);
  assert.deepEqual(fromV1.items, [{id: 'a'}]);
});

// ---- flag writes ----

// Without the updated_at bump the sync merge ("newer wins, remote wins ties" —
// sync.js mergeServices) resolved in favour of the server's still-flagged copy, so
// clearing the flag was silently undone on this device and never reached others.
await test('applyMigrating: clearing bumps updated_at', async () => {
  const r = kmig('applyMigrating', [SVC('a', {migrating: true})], ['a'], false, 5000);
  assert.equal(r.changed, 1);
  assert.equal(r.services[0].migrating, undefined);
  assert.equal(r.services[0].updated_at, 5000);
});

await test('applyMigrating: setting adds the flag and bumps updated_at', async () => {
  const r = kmig('applyMigrating', [SVC('a')], ['a'], true, 5000);
  assert.equal(r.changed, 1);
  assert.equal(r.services[0].migrating, true);
  assert.equal(r.services[0].updated_at, 5000);
});

// reconcileServices documents `synced === true` as a property of IDENTITY, not of
// content: "editing a service MUST NOT clear it, or rule 6 becomes unreachable for
// edited records and deleted services resurrect". Clearing it here would mean a
// service deleted on another device is re-created by rule 4 instead of being reported.
// The updated_at bump alone wins the tie-break, and `migrating` is part of
// canonicalBlobPayload so the PUT-skip cannot swallow the change.
await test('applyMigrating: leaves `synced` alone in both directions', async () => {
  assert.equal(kmig('applyMigrating', [SVC('a', {migrating: true, synced: true})], ['a'], false, 5000).services[0].synced, true);
  assert.equal(kmig('applyMigrating', [SVC('a', {synced: true})], ['a'], true, 5000).services[0].synced, true);
  assert.equal(kmig('applyMigrating', [SVC('a', {migrating: true, synced: false})], ['a'], false, 5000).services[0].synced, false);
});

await test('applyMigrating: null entries in the list are skipped, not thrown on', async () => {
  ctx._nullArgs = [[null, SVC('a', {migrating: true})]];
  const ok = runInContext(
    `(() => { const r = KeygrainMigration.applyMigrating(_nullArgs[0], ['a'], false, 5000);
       return r.changed === 1 && r.services[0] === null && r.services[1].migrating === undefined; })()`, ctx);
  assert.equal(ok, true);
});

await test('applyMigrating: untargeted services are left exactly as they were', async () => {
  const r = kmig('applyMigrating', [SVC('a', {migrating: true}), SVC('b', {migrating: true})], ['a'], false, 5000);
  assert.equal(r.changed, 1);
  assert.equal(r.services[1].migrating, true);
  assert.equal(r.services[1].updated_at, 1000);
  assert.equal(r.services[1].synced, true);
});

await test('applyMigrating: a no-op write reports no change and stamps nothing', async () => {
  const already = kmig('applyMigrating', [SVC('a')], ['a'], false, 5000);
  assert.equal(already.changed, 0);
  assert.equal(already.services[0].updated_at, 1000);
  assert.equal(kmig('applyMigrating', [SVC('a', {migrating: true})], ['a'], true, 5000).changed, 0);
});

await test('applyMigrating: unknown ids and an empty id list change nothing', async () => {
  assert.equal(kmig('applyMigrating', [SVC('a', {migrating: true})], ['nope'], false, 5000).changed, 0);
  assert.equal(kmig('applyMigrating', [SVC('a', {migrating: true})], [], false, 5000).changed, 0);
});

await test('applyMigrating: input list is not mutated', async () => {
  ctx._mutArgs = [[SVC('a', {migrating: true})]];
  const stillFlagged = runInContext(
    `(() => { const input = _mutArgs[0];
       KeygrainMigration.applyMigrating(input, ['a'], false, 5000);
       return input[0].migrating === true && input[0].updated_at === 1000; })()`, ctx);
  assert.equal(stillFlagged, true);
});

// ---- membership catch-up ----

await test('ensureMembership: records flagged services the checklist does not know', async () => {
  const r = kmig('ensureMembership', CL2('a'), [SVC('a'), SVC('b', {migrating: true})], 'T1');
  assert.equal(r.changed, true);
  assert.deepEqual(r.checklist.items, [{id: 'a'}, {id: 'b'}]);
  assert.equal(r.checklist.createdAt, 'T0');
});

// The second-device case: flags arrived through sync with no checklist alongside.
await test('ensureMembership: materialises a checklist from flags alone', async () => {
  const r = kmig('ensureMembership', null, [SVC('a', {migrating: true})], 'T1');
  assert.equal(r.changed, true);
  assert.equal(r.checklist.createdAt, 'T1');
  assert.deepEqual(r.checklist.items, [{id: 'a'}]);
});

await test('ensureMembership: no flags and no checklist stays null', async () => {
  const r = kmig('ensureMembership', null, [SVC('a')], 'T1');
  assert.equal(r.checklist, null);
  assert.equal(r.changed, false);
});

await test('ensureMembership: nothing to add reports no change', async () => {
  const r = kmig('ensureMembership', CL2('a', 'b'), [SVC('a', {migrating: true}), SVC('b')], 'T1');
  assert.equal(r.changed, false);
  assert.deepEqual(r.checklist.items, [{id: 'a'}, {id: 'b'}]);
});

await test('ensureMembership: a v1 checklist is upgraded and reported as changed', async () => {
  const v1 = {version: 1, createdAt: 'T0', items: [{name: 'a.com', email: 'a@b.c', status: 'pending'}]};
  const r = kmig('ensureMembership', v1, [SVC('a', {migrating: true})], 'T1');
  assert.equal(r.changed, true);
  assert.equal(r.checklist.version, 2);
  assert.deepEqual(r.checklist.items, [{id: 'a'}]);
});

// A rename defeats the v1 (name, email) match, so the item is dropped by the upgrade —
// but the service is still flagged, so membership must pick it up again rather than
// leaving it unreported.
await test('ensureMembership: a renamed v1 service is recovered via its flag', async () => {
  const v1 = {version: 1, createdAt: 'T0', items: [{name: 'old-name', email: 'a@b.c', status: 'pending'}]};
  const r = kmig('ensureMembership', v1, [SVC('a', {name: 'new-name', migrating: true})], 'T1');
  assert.deepEqual(r.checklist.items, [{id: 'a'}]);
  assert.equal(kmig('project', r.checklist, [SVC('a', {name: 'new-name', migrating: true})])[0].status, 'pending');
});

await test('ensureMembership: prunes ids whose service is gone', async () => {
  const r = kmig('ensureMembership', CL2('a', 'gone'), [SVC('a')], 'T1');
  assert.equal(r.changed, true);
  assert.deepEqual(r.checklist.items, [{id: 'a'}]);
});

// Without pruning, migrationChecklist grows for the life of the profile: every deleted
// service leaves an id behind forever.
await test('ensureMembership: pruning to empty deletes the checklist', async () => {
  const r = kmig('ensureMembership', CL2('gone'), [SVC('a')], 'T1');
  assert.equal(r.checklist, null);
  assert.equal(r.changed, true);
});

await test('ensureMembership: prune and add in one pass', async () => {
  const r = kmig('ensureMembership', CL2('gone', 'a'), [SVC('a'), SVC('b', {migrating: true})], 'T1');
  assert.deepEqual(r.checklist.items, [{id: 'a'}, {id: 'b'}]);
  assert.equal(r.changed, true);
});

await test('ensureMembership: an empty v2 checklist with no flags is deleted', async () => {
  const r = kmig('ensureMembership', CL2(), [SVC('a')], 'T1');
  assert.equal(r.checklist, null);
  assert.equal(r.changed, true);
});

// Removing the checklist alone is never enough: a surviving flag recreates membership on load.
// Correct Stop semantics remove the unrotated service itself and write a tombstone in the same
// state transition.
await test('ensureMembership: a leftover flag resurrects a removed checklist', async () => {
  const batch = [SVC('a', {migrating: true}), SVC('b', {migrating: true})];
  const resurrected = kmig('ensureMembership', null, batch, 'T1');
  assert.equal(resurrected.changed, true);
  assert.deepEqual(resurrected.checklist.items, [{id: 'a'}, {id: 'b'}]);
});

await test('removePendingServices: removes only confirmed services that are still migrating', async () => {
  const services = [SVC('rotated'), SVC('remove', {migrating: true}), SVC('later', {migrating: true})];
  const r = kmig('removePendingServices', services, [], ['rotated', 'remove'], 5000);
  assert.deepEqual(r.services.map(s => s.id), ['rotated', 'later']);
  assert.deepEqual(r.removedIds, ['remove']);
  assert.deepEqual(r.tombstones, [{id: 'remove', deleted_at: 5000}]);
});

await test('removePendingServices: preserves existing tombstones and gives each removal a timestamp', async () => {
  const services = [SVC('a', {migrating: true}), SVC('b', {migrating: true})];
  const before = [{id: 'old', deleted_at: 4000}];
  const r = kmig('removePendingServices', services, before, ['a', 'b'], 5000);
  assert.deepEqual(r.services, []);
  assert.deepEqual(r.tombstones, [
    {id: 'old', deleted_at: 4000},
    {id: 'a', deleted_at: 5000},
    {id: 'b', deleted_at: 5001}
  ]);
  assert.deepEqual(before, [{id: 'old', deleted_at: 4000}], 'input tombstones were mutated');
});

await test('removePendingServices: a service rotated while the dialog was open survives', async () => {
  const services = [SVC('a'), SVC('b', {migrating: true})];
  const r = kmig('removePendingServices', services, [], ['a'], 5000);
  assert.deepEqual(r.services.map(s => s.id), ['a', 'b']);
  assert.deepEqual(r.removedIds, []);
  assert.deepEqual(r.tombstones, []);
});

await test('removePendingServices: pending ids arriving after confirmation survive', async () => {
  const services = [SVC('confirmed', {migrating: true}), SVC('new', {migrating: true})];
  const r = kmig('removePendingServices', services, [], ['confirmed'], 5000);
  assert.deepEqual(r.services.map(s => s.id), ['new']);
  assert.deepEqual(kmig('pendingIds', r.services), ['new']);
  assert.deepEqual(kmig('ensureMembership', null, r.services, 'T1').checklist.items, [{id: 'new'}]);
});

await test('removePendingServices: unknown and duplicate ids do not create tombstones', async () => {
  const services = [SVC('a', {migrating: true})];
  const r = kmig('removePendingServices', services, [], ['gone', 'gone'], 5000);
  assert.deepEqual(r.services.map(s => s.id), ['a']);
  assert.deepEqual(r.removedIds, []);
  assert.deepEqual(r.tombstones, []);
});

await test('Stop transition: two imported, one rotated leaves exactly the rotated service', async () => {
  const services = [SVC('rotated'), SVC('pending', {migrating: true})];
  const ids = kmig('pendingIds', services);
  assert.deepEqual(ids, ['pending']);
  const r = kmig('removePendingServices', services, [], ids, 5000);
  assert.deepEqual(r.services.map(s => s.id), ['rotated']);
  assert.equal(kmig('countPending', r.services), 0);
  assert.equal(kmig('project', null, r.services).length, 0);
  assert.equal(kmig('ensureMembership', null, r.services, 'T1').checklist, null);
});

await test('Stop tombstone prevents an already-uploaded service from resurrecting', async () => {
  const services = [SVC('pending', {migrating: true, synced: false, updated_at: 1000})];
  const stopped = kmig('removePendingServices', services, [], ['pending'], 2000);
  const r = reconcile(ctx, stopped.services, stopped.tombstones,
    [{site: 'pending.com', migrating: true}], [{id: 'pending', updated_at: 1000}]);
  assert.equal(r.merged.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r.deletedIds)), ['pending']);
  assert.deepEqual(JSON.parse(JSON.stringify(r.tombstones)), [{id: 'pending', deleted_at: 2000}]);
});

// Storage can be corrupt. Every services[] path is null-guarded, so the checklist paths
// must be too: one null item used to throw out of the init path and leave a blank page.
await test('itemIds: malformed items are ignored rather than thrown on', async () => {
  assert.deepEqual(kmig('itemIds', {version: 2, items: [null, {id: 'a'}, {}, {id: 'b'}]}), ['a', 'b']);
  assert.deepEqual(kmig('itemIds', {version: 2}), []);
  assert.deepEqual(kmig('itemIds', null), []);
});

await test('project, addIds and ensureMembership survive a null item', async () => {
  const cl = {version: 2, createdAt: 'T0', items: [null, {id: 'a'}]};
  assert.deepEqual(kmig('project', cl, [SVC('a', {migrating: true})]).map(r => r.id), ['a']);
  assert.deepEqual(kmig('addIds', cl, ['b'], 'T1').items, [{id: 'a'}, {id: 'b'}]);
  assert.deepEqual(kmig('ensureMembership', cl, [SVC('a', {migrating: true})], 'T1').checklist.items, [{id: 'a'}]);
});

await test('upgradeChecklist survives a null item', async () => {
  const v1 = {version: 1, items: [null, {name: 'a.com', email: 'a@b.c'}]};
  assert.deepEqual(kmig('upgradeChecklist', v1, [SVC('a')]).items, [{id: 'a'}]);
});

await test('project: two services sharing one id yield a single row', async () => {
  const rows = kmig('project', CL2('a'), [SVC('a', {migrating: true}), SVC('a', {name: 'shadow'})]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'a.com');
});

await test('newChecklist: an absent createdAt is preserved as undefined, not invented', async () => {
  assert.equal(kmig('newChecklist', ['a']).createdAt, undefined);
});

await test('addIds: a malformed v2 checklist is replaced rather than thrown on', async () => {
  assert.deepEqual(kmig('addIds', {version: 2}, ['a'], 'T1').items, [{id: 'a'}]);
});

// ============================================================
// Local encrypted payload — what the migrate page must preserve
// ============================================================
// The migrate page writes the whole blob. Its own inlined crypto used to emit
// `version: 1` with no `tombstones` and no `deletion_review`, so every import and every
// "Mark as rotated" discarded pending deletions — resurrecting deleted services from
// the server — and dropped the deletion-review queue. It now uses these shared helpers.

const BLOB_SECRET = 'my-master-secret';
const BLOB_EMAIL = 'test@gmail.com';

async function roundTripBlob(services, wallets, auditLog, tombstones, review) {
  ctx._blobArgs = [BLOB_SECRET, BLOB_EMAIL, services, wallets, auditLog, tombstones, review];
  return runInContext(`(async () => {
    const [sec, em, svcs, w, log, tomb, rev] = _blobArgs;
    const key = await deriveStorageKey(sec, em);
    const stored = await encryptServices(key, em, svcs, w, log, tomb, rev);
    const key2 = await deriveStorageKey(sec, em);
    const out = await decryptServices(key2, em, stored);
    return JSON.parse(JSON.stringify({stored: {version: stored.version}, out}));
  })()`, ctx);
}

await test('blob round-trip: tombstones and deletion_review survive a write', async () => {
  const r = await roundTripBlob(
    [{id: 'a', name: 'a.com', email: 'a@b.c', updated_at: 1, synced: true}],
    [{wallet_name: 'w', chain: 'btc'}],
    [{timestamp: 1, wallet_name: 'w', chain: 'btc', action: 'derive'}],
    [{id: 'dead', deleted_at: 42}],
    [{service: {id: 'gone'}, deleted_at: 43, seen: false}]
  );
  assert.equal(r.out.payloadVersion, 2);
  assert.deepEqual(r.out.tombstones, [{id: 'dead', deleted_at: 42}]);
  assert.equal(r.out.deletionReview.length, 1);
  assert.equal(r.out.deletionReview[0].deleted_at, 43);
  assert.equal(r.out.wallets.length, 1);
  assert.equal(r.out.walletAuditLog.length, 1);
});

await test('blob round-trip: the migrating flag survives a write', async () => {
  const r = await roundTripBlob(
    [{id: 'a', name: 'a.com', email: 'a@b.c', updated_at: 1, migrating: true}], [], [], [], []);
  assert.equal(r.out.services[0].migrating, true);
});

// Why the migrate page refuses to write a pre-v2 payload rather than upgrading it: the
// tombstones it would need are not in there, and only the popup has syncKnownUUIDs.
await test('decryptServices: a v1 payload reports payloadVersion 1 and no tombstones', async () => {
  ctx._v1Args = [BLOB_SECRET, BLOB_EMAIL];
  const out = await runInContext(`(async () => {
    const [sec, em] = _v1Args;
    const key = await deriveStorageKey(sec, em);
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = enc.encode(em.toLowerCase());
    const pt = enc.encode(JSON.stringify({version: 1, services: [{id: 'a', updated_at: 1}], wallets: [], wallet_audit_log: []}));
    const ck = await crypto.subtle.importKey("raw", key, {name: "AES-GCM"}, false, ["encrypt"]);
    const ct = await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData: aad}, ck, pt);
    const stored = {version: 2, iv: arrayBufferToBase64(iv), ciphertext: arrayBufferToBase64(ct)};
    const key2 = await deriveStorageKey(sec, em);
    const r = await decryptServices(key2, em, stored);
    return JSON.parse(JSON.stringify(r));
  })()`, ctx);
  assert.equal(out.payloadVersion, 1);
  assert.deepEqual(out.tombstones, []);
  assert.deepEqual(out.deletionReview, []);
});

// nextTimestamp is what makes a cleared `migrating` flag win the merge tie-break in
// reconcileServices, where equal timestamps resolve to the REMOTE copy.
await test('nextTimestamp: strictly exceeds every local updated_at', async () => {
  assert.equal(call('nextTimestamp', [{updated_at: 1}, {updated_at: 2}]) > 2, true);
  const future = Date.now() + 600000;
  assert.equal(call('nextTimestamp', [{updated_at: future}]), future + 1);
});

// ============================================================
// Cross-context storage change classification
// ============================================================
// chrome.storage.onChanged fires in every extension context, INCLUDING the one that
// wrote. The popup persists its whole in-memory service list, so a reload triggered by
// its own write can land inside its own read-modify-write cycle; the migrate tab would
// re-render and re-decrypt for nothing. Both pages therefore record a marker per write
// and ignore events that still carry it.

const MARKER_ABSENT = runInContext('STORAGE_MARKER_ABSENT', ctx);

function ext(changes, area, watched, selfMarkers) {
  ctx._extArgs = [changes, area, watched, selfMarkers];
  return runInContext(`JSON.parse(JSON.stringify(externalChanges(..._extArgs)))`, ctx);
}

const BLOB_A = {version: 2, iv: 'aXYx', ciphertext: 'Y3Rf9WFhYQ=='};
const BLOB_B = {version: 2, iv: 'aXYy', ciphertext: 'Y3Rf9WJiYg=='};

await test('storageMarker: a blob is identified by its ciphertext alone', async () => {
  assert.equal(call('storageMarker', BLOB_A), BLOB_A.ciphertext);
  // Same content re-encrypted draws a fresh IV, so the marker differs — which is exactly
  // what makes it safe to treat "marker matches" as "this write was mine".
  assert.notEqual(call('storageMarker', BLOB_A), call('storageMarker', BLOB_B));
});

await test('storageMarker: absent values get a marker distinct from every real one', async () => {
  assert.equal(call('storageMarker', undefined), MARKER_ABSENT);
  assert.equal(call('storageMarker', null), MARKER_ABSENT);
  assert.notEqual(MARKER_ABSENT, call('storageMarker', BLOB_A));
  assert.notEqual(MARKER_ABSENT, call('storageMarker', {}));
});

await test('storageMarker: non-blob values are compared by JSON form', async () => {
  const cl = {version: 2, createdAt: 'x', items: [{id: 'a'}]};
  assert.equal(call('storageMarker', cl), JSON.stringify(cl));
  assert.notEqual(call('storageMarker', cl), call('storageMarker', {version: 2, createdAt: 'x', items: []}));
});

await test('storageMarker: an unstringifiable value does not throw', async () => {
  const marker = runInContext(`(() => { const o = {}; o.self = o; return storageMarker(o); })()`, ctx);
  assert.equal(marker, MARKER_ABSENT);
});

await test('externalChanges: another context writing the blob is external', async () => {
  assert.deepEqual(ext({services: {newValue: BLOB_B}}, 'local', ['services'], {services: BLOB_A.ciphertext}), ['services']);
});

await test('externalChanges: our own write is filtered out', async () => {
  assert.deepEqual(ext({services: {newValue: BLOB_A}}, 'local', ['services'], {services: BLOB_A.ciphertext}), []);
});

await test('externalChanges: a key we have never written is always external', async () => {
  // `undefined` self-marker must not accidentally match anything, including a removal.
  assert.deepEqual(ext({services: {newValue: BLOB_A}}, 'local', ['services'], {}), ['services']);
  assert.deepEqual(ext({migrationChecklist: {oldValue: {}}}, 'local', ['migrationChecklist'], {}), ['migrationChecklist']);
});

await test('externalChanges: a removal by another context is external', async () => {
  assert.deepEqual(
    ext({migrationChecklist: {oldValue: {version: 2, items: []}}}, 'local', ['migrationChecklist'], {migrationChecklist: '{"version":2,"items":[]}'}),
    ['migrationChecklist']);
});

await test('externalChanges: a removal we performed ourselves is filtered out', async () => {
  assert.deepEqual(
    ext({migrationChecklist: {oldValue: {version: 2, items: []}}}, 'local', ['migrationChecklist'], {migrationChecklist: MARKER_ABSENT}),
    []);
});

await test('externalChanges: only the local area counts', async () => {
  assert.deepEqual(ext({services: {newValue: BLOB_B}}, 'sync', ['services'], {}), []);
  assert.deepEqual(ext({services: {newValue: BLOB_B}}, 'managed', ['services'], {}), []);
});

await test('externalChanges: unwatched keys are ignored', async () => {
  // Every write of `lastSyncTime`, `breachFeed`, `popupActiveUntil` and the rest must not
  // trigger a blob decrypt.
  assert.deepEqual(ext({lastSyncTime: {newValue: 5}, popupActiveUntil: {newValue: 9}}, 'local', ['services'], {}), []);
});

await test('externalChanges: reports every external watched key, in watched order', async () => {
  const changes = {migrationChecklist: {newValue: {version: 2, items: []}}, services: {newValue: BLOB_B}};
  assert.deepEqual(ext(changes, 'local', ['services', 'migrationChecklist'], {}), ['services', 'migrationChecklist']);
});

await test('externalChanges: mixed event — our blob write plus their checklist write', async () => {
  const changes = {services: {newValue: BLOB_A}, migrationChecklist: {newValue: {version: 2, items: [{id: 'x'}]}}};
  assert.deepEqual(ext(changes, 'local', ['services', 'migrationChecklist'], {services: BLOB_A.ciphertext}), ['migrationChecklist']);
});

await test('externalChanges: tolerates a missing changes object and empty watch list', async () => {
  assert.deepEqual(ext(null, 'local', ['services'], {}), []);
  assert.deepEqual(ext({services: {newValue: BLOB_A}}, 'local', [], {}), []);
  assert.deepEqual(ext({services: {newValue: BLOB_A}}, 'local', ['services'], null), ['services']);
});

// ============================================================
// Page wiring the unit tests cannot exercise
// ============================================================
// There is no chrome.storage mock and no DOM for popup.js/migrate.js in this harness, so the
// listeners cannot be driven end to end here — that is what the manual browser checklist in
// HANDOVER-migration-bugs.md §4 is for. These are source-level guards: each one pins a
// specific way the cross-context refresh silently stops working. They assert on the BODY of
// the function concerned, so they cannot be satisfied by similar code elsewhere in the file.

function sourceOf(file) { return readFileSync(resolve(shared, file), 'utf8'); }

// The source of one function or listener, delimited by its closing brace at `indent`.
function bodyOf(file, opening, indent) {
  const src = sourceOf(file);
  const start = src.indexOf(opening);
  assert.ok(start > 0, 'not found in ' + file + ': ' + opening);
  const close = '\n' + ' '.repeat(indent) + '}';
  const end = src.indexOf(close, start);
  assert.ok(end > start, 'could not delimit ' + opening + ' in ' + file);
  return src.slice(start, end);
}

await test('popup.js reacts to migration changes through the services blob', async () => {
  const body = bodyOf('popup.js', 'chrome.storage.onChanged.addListener', 2);
  assert.match(body, /if \(!externalChanges\(changes, area, \["services"\], selfWrites\)\.length\) return;/,
    'the listener does not use services as its only migration source');
  assert.match(body, /refreshFromStorage\(\)/, 'a services change does not refresh the popup');
  assert.doesNotMatch(body, /migrationStopped/, 'the popup still watches obsolete abandonment state');
});

await test('popup.js migration label and click route use the same pending count', async () => {
  const label = bodyOf('popup.js', 'function updateMigrateBtn()', 2);
  const click = bodyOf('popup.js', 'document.getElementById("migrate-btn").addEventListener', 2);
  assert.match(label, /KeygrainMigration\.countPending\(services\)/,
    'the menu label does not count the encrypted service list');
  assert.match(click, /KeygrainMigration\.countPending\(services\)/,
    'the click route disagrees with the label');
  assert.doesNotMatch(label + click, /migrationStopped|storedStoppedIds|\bstopped\b/,
    'obsolete abandonment state still affects the popup');
});

await test('popup.js keeps the legacy migrationStopped key account-scoped for cleanup', async () => {
  const scoped = /const ACCOUNT_SCOPED_KEYS = \[([\s\S]*?)\];/.exec(sourceOf('popup.js'));
  assert.ok(scoped, 'ACCOUNT_SCOPED_KEYS not found');
  assert.ok(scoped[1].includes('"migrationStopped"'),
    'an account wipe would leave the legacy key behind');
});

await test('popup.js refresh reloads AND re-renders everything it invalidates', async () => {
  const body = bodyOf('popup.js', 'async function refreshFromStorage()', 2);
  assert.match(body, /await loadServices\(\)/, 'does not reload the blob');
  // Reload without re-render leaves rows indexed into a replaced array; the menu count and the
  // deletion-review banner both read state loadServices reassigns.
  assert.match(body, /renderServiceList\(\)/, 'does not re-render the service list');
  assert.match(body, /updateMigrateBtn\(\)/, 'does not refresh the migrate button count');
  assert.match(body, /renderDeletionReview\(\)/, 'does not refresh the deletion-review banner');
  // The generation check must not be able to skip the re-render: bailing out after
  // loadServices has installed new arrays is what points Delete at the wrong service.
  assert.match(body, /renderServiceList\(\)[\s\S]*?if \(gen !== blobWrites\) deferredRefresh = true;/,
    'the generation check returns before re-rendering');
  // Re-checked after the awaits, or a wipe that lands during the decrypt is re-installed.
  assert.match(body, /await loadServices\(\)[\s\S]{0,400}?if \(accountWiped \|\| !currentSecret \|\| mainScreen\.classList\.contains\("hidden"\)\) return;/,
    'does not re-verify the account after its awaits');
});

await test('popup.js defers a blocked refresh instead of dropping it', async () => {
  const body = bodyOf('popup.js', 'async function refreshFromStorage()', 2);
  // Each guard covers a distinct hazard: an index-bound dialog would be retargeted, a revealed
  // secret would be destroyed, an in-flight save would race the reload, and a sync in progress
  // is about to overwrite whatever was rendered.
  assert.match(body, /if \(indexBoundDialogOpen\(\) \|\| revealedOnScreen\(\) \|\| savesInFlight > 0 \|\| syncInProgress\) \{\s*\n\s*deferredRefresh = true;\s*\n\s*return;/,
    'a blocked refresh is dropped rather than deferred');
  assert.match(body, /if \(refreshInFlight\) \{ deferredRefresh = true; return; \}/,
    'concurrent refreshes are not serialised, or the second one is dropped');
  assert.match(body, /if \(isDemoMode \|\| accountWiped \|\| !currentSecret \|\| !currentEmail\) return;/,
    'the entry guard changed');
  assert.match(body, /const gen = blobWrites;/, 'does not record the write generation before reading');
  // The two DOM guards must actually consult the DOM — stubbing either to false is invisible
  // to every other assertion here.
  assert.match(bodyOf('popup.js', 'function indexBoundDialogOpen()', 2),
    /!addDialog\.classList\.contains\("hidden"\) \|\| !deleteDialog\.classList\.contains\("hidden"\)/,
    'indexBoundDialogOpen no longer reads the dialogs');
  assert.match(bodyOf('popup.js', 'function revealedOnScreen()', 2),
    /serviceList\.querySelector\(["'].password-display["']\)[\s\S]*?totp-revealed/,
    'revealedOnScreen no longer reads the DOM, or ignores a revealed TOTP code');
});

await test('popup.js flushes a deferred refresh from every blocker', async () => {
  const src = sourceOf('popup.js');
  // A deferral with no flush pins the popup stale until it is reopened. One flush per blocker,
  // asserted at its own site rather than only by count, so a flush cannot be moved somewhere
  // unreachable while the total stays right.
  assert.equal([...src.matchAll(/if \(deferredRefresh[^)]*\) refreshFromStorage\(\);/g)].length, 6,
    'the number of flush points changed — check every blocker still has one');
  assert.match(bodyOf('popup.js', 'async function refreshFromStorage()', 2),
    /refreshInFlight = false;\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(deferredRefresh\) refreshFromStorage\(\);/,
    'a refresh that blocked another one does not flush it');
  assert.match(bodyOf('popup.js', 'async function saveServices()', 2),
    /savesInFlight--;\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(deferredRefresh && savesInFlight === 0\) refreshFromStorage\(\);/,
    'a settled save does not flush the deferral it caused');
  assert.match(bodyOf('popup.js', 'async function performAutoSync()', 2),
    /syncInProgress = false;[\s\S]{0,400}?if \(deferredRefresh\) refreshFromStorage\(\);/,
    'a failed sync does not flush the deferral it caused');
  assert.match(bodyOf('popup.js', 'function closeIndexBoundDialog(dialog, state)', 2),
    /closeDialog\(dialog, state\);\s*\n\s*if \(deferredRefresh\) refreshFromStorage\(\);/,
    'closing an index-bound dialog does not flush');
  // Both hide paths for a revealed secret: password and TOTP code.
  assert.equal([...src.matchAll(/"Show (?:password|TOTP code) for " \+ svc\.name\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(deferredRefresh\) refreshFromStorage\(\);/g)].length, 2,
    'hiding a revealed password or TOTP code does not flush the deferral it caused');
});

await test('popup.js encrypts from a snapshot taken before its first await', async () => {
  const body = bodyOf('popup.js', 'async function saveServices()', 2);
  // Encrypting from the globals loses the caller's mutation — and a deletion's tombstone, which
  // is local-only and does not come back — whenever a refresh completes mid-save.
  assert.match(body, /encryptServices\(key, currentEmail, snap\.services, snap\.wallets, snap\.walletAuditLog, snap\.tombstones, snap\.deletionReview\)/,
    'saveServices encrypts from the globals rather than the snapshot');
  // Contiguous, with no await between: the snapshot and both counters must be in the same
  // synchronous run as the caller's mutation.
  assert.match(body, /const snap = \{services, wallets, walletAuditLog, tombstones, deletionReview\};\s*\n(?:\s*\/\/[^\n]*\n)*\s*savesInFlight\+\+;\s*\n\s*blobWrites\+\+;\s*\n\s*try \{\s*\n\s*const key = await deriveStorageKey/,
    'the snapshot and the counters must be contiguous and precede the first await');
  // Released in a finally, or one throwing write pins every later refresh forever.
  assert.match(body, /\} finally \{\s*\n\s*savesInFlight--;/, 'savesInFlight is not released in a finally');
});

await test('popup.js arms a self-write marker and a generation bump on every blob write', async () => {
  const src = sourceOf('popup.js');
  // An unarmed write makes the popup reload in response to itself; an unbumped generation makes
  // an in-flight refresh blind to it. Removals count: ACCOUNT_SCOPED_KEYS includes "services",
  // and clear() takes everything. Whitespace-tolerant, so a second writer cannot hide behind
  // different formatting.
  const writes = [...src.matchAll(/chrome\.storage\.local\.set\(\{\s*services/g)].length
    + [...src.matchAll(/chrome\.storage\.local\.remove\(ACCOUNT_SCOPED_KEYS\)/g)].length
    + [...src.matchAll(/chrome\.storage\.local\.clear\(\)/g)].length;
  assert.equal(writes, 3, 'the set of writes touching the blob changed — re-check each is armed');
  assert.equal([...src.matchAll(/selfWrites\.services = /g)].length, writes, 'a write is not marked');
  assert.equal([...src.matchAll(/blobWrites\+\+;/g)].length, writes, 'a write does not bump the generation');
  // Both wipes must also stop an in-flight refresh from re-installing the old account.
  assert.equal([...src.matchAll(/accountWiped = true;/g)].length, 2, 'an account wipe is not flagged');
});

await test('popup.js persists the blob from exactly one place', async () => {
  // The refresh reasoning depends on it: savesInFlight and blobWrites are what keep a reload
  // out of a read-modify-write cycle, and only saveServices maintains them.
  assert.equal([...sourceOf('popup.js').matchAll(/chrome\.storage\.local\.set\(\{\s*services/g)].length, 1);
});

await test('popup.js closes the index-bound dialogs through the refresh flush', async () => {
  const src = sourceOf('popup.js');
  // addDialog and deleteDialog carry an index into `services` (editIndex, deleteTarget), so a
  // refresh is deferred while either is open. A close that bypasses the wrapper drops that
  // deferred refresh and the popup stays stale until it is reopened.
  assert.equal([...src.matchAll(/closeDialog\((?:addDialog|deleteDialog)/g)].length, 0,
    'an add/delete dialog close bypasses closeIndexBoundDialog');
  assert.equal([...src.matchAll(/closeIndexBoundDialog\((?:addDialog|deleteDialog)/g)].length, 7,
    'the number of add/delete close paths changed — check the new one flushes the deferral');
  // The wrapper is only reachable if nothing hides those dialogs directly.
  assert.equal([...src.matchAll(/(?:addDialog|deleteDialog)\.classList\.add\("hidden"\)/g)].length, 0,
    'a dialog is hidden without going through closeDialog, so the flush is skipped');
});

await test('migrate.js reacts to external services and checklist writes', async () => {
  const body = bodyOf('migrate.js', 'chrome.storage.onChanged.addListener((changes, area) => {\n    if (!externalChanges', 2);
  assert.match(body, /"services", "migrationChecklist"/, 'listener does not watch both keys');
  assert.match(body, /selfWrites/, 'listener does not filter its own writes');
  // Serialised with every other blob access, or a refresh can interleave with a write and
  // render a stale row set — the concurrency defect cycle 1 fixed.
  assert.match(body, /serialize\(refreshChecklist\)/, 'the refresh is not serialised');
  // A removal means the account was wiped under this tab; it must stop, not re-render — and it
  // must be checked BEFORE the step-4 early return, or a tab sitting on the wizard keeps its
  // stale secret and can still import under a dead key.
  assert.match(body, /newValue === undefined/, 'listener does not detect the blob being removed');
  assert.match(body, /blobGone = true/, 'listener does not stop the page when the blob is gone');
  // A Stop confirm left open would sit on top of the error screen — it is not one of `steps`, so
  // hiding those does not reach it — and confirming it would run a write path that is refused.
  assert.match(body, /blobGone = true;[\s\S]{0,400}?closeStopDialog\(\);/,
    'an open stop dialog survives the account being wiped under the tab');
  assert.ok(body.indexOf('newValue === undefined') < body.indexOf('steps[3]'),
    'the blob-removed branch runs after the step-4 early return, so a wizard tab keeps a dead secret');
});

await test('migrate.js refresh re-reads both stores and re-renders', async () => {
  const body = bodyOf('migrate.js', 'async function refreshChecklist()', 2);
  assert.match(body, /await readBlob\(\)/, 'does not re-read the blob');
  assert.match(body, /await loadChecklist\(allServices\)/, 'does not reconcile membership');
  assert.match(body, /renderChecklist\(\)/, 'does not re-render the checklist');
});

await test('migrate.js refuses every blob read and write once the blob is gone', async () => {
  // Read: an absent key otherwise reads as an empty store (readBlob's own default), which would
  // show a clean, inviting checklist. Write: every path here is read-modify-write, so a wipe
  // landing after the read would let the write re-create the blob under a dead secret.
  assert.match(bodyOf('migrate.js', 'async function readBlob()', 2), /if \(blobGone\) return null;/,
    'readBlob does not check blobGone');
  assert.match(bodyOf('migrate.js', 'async function writeBlob(blob)', 2), /if \(blobGone\) return false;/,
    'writeBlob does not check blobGone');
  // And the callers must act on that refusal rather than reporting success.
  const src = sourceOf('migrate.js');
  assert.equal([...src.matchAll(/await writeBlob\(blob\)/g)].length,
    [...src.matchAll(/if \(!await writeBlob\(blob\)\)/g)].length, 'a writeBlob result is ignored');
});

await test('migrate.js arms a self-write marker before every watched write it makes', async () => {
  const src = sourceOf('migrate.js');
  assert.equal([...src.matchAll(/chrome\.storage\.local\.set\(\{ services/g)].length,
    [...src.matchAll(/selfWrites\.services = storageMarker\(/g)].length, 'unarmed blob write');
  assert.equal([...src.matchAll(/chrome\.storage\.local\.set\(\{ migrationChecklist/g)].length,
    [...src.matchAll(/selfWrites\.migrationChecklist = storageMarker\(/g)].length, 'unarmed checklist write');
  const checklistRemovals = [...src.matchAll(/chrome\.storage\.local\.remove\("migrationChecklist"\)/g)].length
    + [...src.matchAll(/chrome\.storage\.local\.remove\(\["migrationChecklist", "migrationStopped"\]\)/g)].length;
  assert.equal(checklistRemovals,
    [...src.matchAll(/selfWrites\.migrationChecklist = STORAGE_MARKER_ABSENT/g)].length,
    'an armed checklist removal is missing, or a marker has no removal');
  assert.doesNotMatch(src, /storage\.local\.set\(\{ migrationStopped/,
    'obsolete abandonment state is still written');
});

await test('migrate.js recovers a tab parked on either bail-out screen', async () => {
  const src = sourceOf('migrate.js');
  assert.equal([...src.matchAll(/recoverOnBlobChange\(\);/g)].length, 2,
    'a bail-out screen has no recovery listener');
  assert.match(bodyOf('migrate.js', 'function recoverOnBlobChange()', 2), /location\.reload\(\)/,
    'the recovery listener does not reload');
});

await test('migrate.js Stop persists removal and tombstones before dismissing the checklist', async () => {
  const body = bodyOf('migrate.js', 'function stopMigration(ids)', 2);
  assert.match(body, /const blob = await readBlob\(\)/, 'Stop does not re-read the fresh blob');
  assert.match(body, /KeygrainMigration\.removePendingServices\(\s*\n?\s*blob\.services, blob\.tombstones, ids, nextTimestamp\(blob\.services\)\)/,
    'Stop does not remove confirmed pending services with monotonic tombstones');
  assert.match(body, /blob\.services = result\.services;\s*\n\s*blob\.tombstones = result\.tombstones;/,
    'removal and tombstones are not installed together');
  const write = body.indexOf('await writeBlob(blob)');
  const dismiss = body.indexOf('chrome.storage.local.remove(["migrationChecklist", "migrationStopped"])');
  assert.ok(write >= 0 && dismiss > write, 'the checklist is dismissed before the encrypted deletion succeeds');
  assert.match(body, /if \(!await writeBlob\(blob\)\) \{[\s\S]*?return;/,
    'a refused blob write still falls through to checklist dismissal');
  assert.match(body, /catch \(_\) \{[\s\S]*?return;/,
    'a thrown blob write still falls through to checklist dismissal');
  assert.match(body, /chrome\.alarms\.create\("syncAlarm"/, 'the tombstones are not scheduled for sync');
});

await test('migrate.js Stop deletes exactly the confirmed ids that remain pending', async () => {
  const body = bodyOf('migrate.js', 'stopBtn.addEventListener("click"', 2);
  assert.match(body, /const ids = KeygrainMigration\.pendingIds\(allServices\);/,
    'the pending id set is not captured when the dialog opens');
  assert.match(body, /stopDialogCount\.textContent = "The " \+ ids\.length/,
    'the message count is not taken from the captured id set');
  assert.match(body, /stopDialogState = Object\.assign\(openDialog\(stopDialog, stopBtn\), \{ids\}\)/,
    'the confirmed id set is not carried on the dialog state');
  assert.match(sourceOf('migrate.js'),
    /stopConfirm\.addEventListener\("click", \(\) => \{[\s\S]{0,200}?const ids = stopDialogState\.ids;[\s\S]{0,120}?stopMigration\(ids\);/,
    'confirm does not pass the captured id set to Stop');
  assert.match(body, /if \(!ids\.length\) \{ stopMigration\(ids\); return; \}/,
    'the all-done Dismiss path no longer skips destructive confirmation');
  assert.match(body, /totp\.mode === "stored"/, 'stored TOTP deletion is not surfaced in the dialog');
});

await test('migrate.js cleans legacy abandonment state without silently deleting it', async () => {
  const body = bodyOf('migrate.js', 'async function loadChecklist(services)', 2);
  assert.match(body, /if \(data\.migrationStopped !== undefined\) await chrome\.storage\.local\.remove\("migrationStopped"\)/,
    'legacy local state is not cleaned');
  assert.match(body, /KeygrainMigration\.ensureMembership\(\s*\n?\s*data\.migrationChecklist, services, new Date\(\)\.toISOString\(\)\)/,
    'still-flagged legacy services do not become explicitly pending again');
  assert.doesNotMatch(body, /removePendingServices|writeBlob/,
    'loading an old profile silently deletes services');
});

await test('migrate.js Stop opens a usable modal, and cancel only closes', async () => {
  const body = bodyOf('migrate.js', 'stopBtn.addEventListener("click"', 2);
  // A real dialog, not window.confirm: openDialog gives the focus trap and focus restore.
  assert.match(body, /openDialog\(stopDialog, stopBtn\)/, 'Stop does not open the confirm dialog');
  assert.doesNotMatch(sourceOf('migrate.js'), /window\.confirm\(/, 'Stop uses window.confirm');
  // openDialog does not move focus. Left on stopBtn, focus sits behind the overlay, the Tab trap
  // (bound to the dialog, not an ancestor of stopBtn) never fires, and the dialog is never
  // announced. Cancel takes it, not the destructive button.
  assert.match(body, /stopCancel\.focus\(\)/, 'focus is never moved into the dialog');
  // Re-entrancy: a second open would bind a second trap listener to the same element and orphan
  // the first, and would overwrite the confirmed id set.
  assert.match(body, /if \(stopDialogState\) return;/, 'the dialog can be opened twice over itself');
  // Cancel must do nothing but close.
  const cancel = bodyOf('migrate.js', 'function closeStopDialog()', 2);
  assert.match(cancel, /closeDialog\(stopDialog, stopDialogState\)/, 'cancel does not close the dialog');
  assert.match(cancel, /stopDialogState = null;/, 'the dialog state is not cleared, so the confirmed set outlives the dialog');
  assert.doesNotMatch(cancel, /removePendingServices|storage\.local/, 'cancel touches storage');
  assert.match(sourceOf('migrate.js'), /stopCancel\.addEventListener\("click", closeStopDialog\);/,
    'cancel is not wired to a close-only handler');
});

await test('migrate.js shows Stop independently of the all-done panel', async () => {
  const src = sourceOf('migrate.js');
  const body = bodyOf('migrate.js', 'function renderChecklist()', 2);
  assert.match(body, /KeygrainMigration\.project\(checklist, allServices\)/,
    'the checklist is not projected from the post-deletion service list');
  // The literal bug 3: the only control lived inside #all-done, which is unhidden only when
  // doneCount === total, so a migration could not be abandoned part-way through. Anything other
  // than "no rows at all" as the hide condition reintroduces that.
  assert.match(body, /stopRow\.classList\.toggle\("hidden", total === 0\)/,
    'the Stop row is hidden by something other than "there is no batch"');
  // Exactly one place decides it, file-wide. A second `stopRow.classList` call anywhere — even
  // after this one — can re-hide the row while the assertion above still passes.
  assert.equal([...src.matchAll(/stopRow\.classList/g)].length, 1,
    'the Stop row visibility is decided in more than one place');
  assert.match(body, /stopBtn\.textContent = pendingCount > 0 \? "Stop migration" : "Dismiss checklist"/,
    'the Stop label no longer adapts to whether anything is pending');
});

// ============================================================
// Page script manifests
// ============================================================
// A missing <script> tag is invisible to unit tests but breaks the page at runtime:
// KeygrainMigration is a top-level const, so a document that calls it without loading
// migration-state.js throws on first use. These assertions pin the dependency.

function scriptsOf(htmlFile) {
  const html = readFileSync(resolve(shared, htmlFile), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
}

await test('popup.html loads migration-state.js before popup.js', async () => {
  const scripts = scriptsOf('popup.html');
  assert.ok(scripts.includes('migration-state.js'), 'migration-state.js missing');
  assert.ok(scripts.indexOf('migration-state.js') < scripts.indexOf('popup.js'), 'wrong order');
});

await test('migrate.html loads every module migrate.js depends on, in order', async () => {
  const scripts = scriptsOf('migrate.html');
  // sync.js provides the base64 helpers popup-crypto.js needs; popup-crypto.js provides
  // deriveStorageKey/encryptServices/decryptServices; popup-dialog.js provides
  // nextTimestamp; migration-state.js provides KeygrainMigration.
  for (const dep of ['sync.js', 'popup-crypto.js', 'popup-dialog.js', 'migration-state.js']) {
    assert.ok(scripts.includes(dep), dep + ' missing from migrate.html');
    assert.ok(scripts.indexOf(dep) < scripts.indexOf('migrate.js'), dep + ' loaded after migrate.js');
  }
  assert.ok(scripts.indexOf('sync.js') < scripts.indexOf('popup-crypto.js'), 'popup-crypto.js needs sync.js first');
});

await test('migrate.html puts the Stop control outside #all-done and gives it a modal confirm', async () => {
  const html = sourceOf('migrate.html');
  // #all-done is unhidden only when every service is rotated, so a control inside it cannot be
  // used to abandon a migration — that was bug 3.
  assert.ok(!html.includes('id="dismiss-btn"'),
    '#dismiss-btn is back, and it is unreachable while rows are pending');
  const stopBtnAt = html.indexOf('id="stop-btn"');
  assert.ok(stopBtnAt > 0, '#stop-btn is missing');
  // Walk the div depth from #all-done to find where it actually closes. Taking the first
  // </div> instead would be fooled by any wrapper inside the panel.
  const allDoneAt = html.indexOf('<div id="all-done"');
  assert.ok(allDoneAt > 0, '#all-done is missing');
  let depth = 0, allDoneEnd = -1;
  for (const m of html.slice(allDoneAt).matchAll(/<div\b|<\/div>/g)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) { allDoneEnd = allDoneAt + m.index; break; }
  }
  assert.ok(allDoneEnd > 0, '#all-done is never closed');
  assert.ok(stopBtnAt > allDoneEnd, '#stop-btn is nested inside #all-done');
  // openDialog only toggles .hidden and traps Tab, so the modal semantics must be in the markup.
  assert.match(html, /id="stop-dialog" class="dialog hidden" role="dialog" aria-modal="true" aria-labelledby="stop-dialog-title"/,
    'the stop dialog is missing its modal attributes');
  assert.ok(html.includes('id="stop-dialog-title"'), 'aria-labelledby points at no element');
  assert.ok(html.includes('id="stop-dialog-count"'), 'the dialog cannot state how many services are affected');
  assert.match(html, /will forget those services/, 'the dialog does not explain that services are deleted');
  assert.ok(html.includes('id="stop-dialog-totp-warning"'), 'stored TOTP deletion has no warning');
  // Cancel first, destructive action last — the order popup.html's #delete-dialog uses.
  assert.match(html, /id="stop-cancel"[\s\S]*?id="stop-confirm"/, 'the destructive button comes first');
  assert.match(html, /id="stop-confirm" class="btn-danger"/, 'the destructive button is not marked as such');
});

await test('migrate.css styles the dialog it now owns, and can still hide it', async () => {
  const css = sourceOf('migrate.css');
  // migrate.html does not load popup.css, so none of these can be inherited from it.
  for (const rule of ['.dialog {', '.dialog-box {', '.dialog-actions {', '.btn-danger {']) {
    assert.ok(css.includes(rule), rule + ' missing from migrate.css');
  }
  // .hidden (0,1,0) and .dialog (0,1,0) have equal specificity and .dialog sets display later in
  // the file, so without this rule the confirm dialog is permanently on screen.
  assert.match(css, /\.dialog\.hidden \{ display: none; \}/, '.dialog.hidden is missing');
  // The same trap through an id selector, which beats .dialog.hidden (1,0,0 vs 0,2,0) whatever
  // the order: no id rule for a hideable element may declare display. Covers #stop-row too, so
  // both directions of the trap are pinned by one check.
  for (const m of css.matchAll(/#(stop-row|stop-dialog|all-done)[^{]*\{([^}]*)\}/g)) {
    assert.ok(!m[2].includes('display'), '#' + m[1] + ' declares display, which defeats .hidden');
  }
  assert.ok(/#stop-row \{/.test(css), 'the #stop-row rule is missing');
});

// ============================================================
// SUMMARY
// ============================================================
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
