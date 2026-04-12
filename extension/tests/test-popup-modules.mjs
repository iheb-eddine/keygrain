// extension/tests/test-popup-modules.mjs — Unit tests for popup modules
import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = resolve(__dirname, '..', 'shared');

// --- Test runner ---
let passed = 0, failed = 0;
function test(name, fn) { return fn().then(() => { passed++; console.log(`  ✓ ${name}`); }, e => { failed++; console.log(`  ✗ ${name}: ${e.message}`); }); }

// --- Strengthen mock ---
const STRENGTHEN_MAP = {
  'my-master-secret|test@gmail.com': 'd7b935b8298f476c6046cb71501fcb8c9a53327df3cc4e05c696fea7ef3d035a',
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
    ArrayBuffer, Promise, Object, RegExp, Date,
    setTimeout, clearTimeout,
    document: { createElement: () => { let t = ""; return { set textContent(v) { t = v; }, get innerHTML() { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }; } },
    hashwasm: {
      argon2id: async ({ password, salt }) => {
        const secretStr = new TextDecoder().decode(password);
        const saltStr = new TextDecoder().decode(salt);
        const emailMatch = saltStr.match(/^keygrain-strengthen:(.+)$/);
        if (!emailMatch) throw new Error('Mock: unexpected salt: ' + saltStr);
        const key = secretStr + '|' + emailMatch[1];
        const hex = STRENGTHEN_MAP[key];
        if (!hex) throw new Error('Mock: no strengthen vector for ' + key);
        return hexToBytes(hex);
      }
    },
  });

  // Load shared modules needed by popup modules
  for (const file of ['keygrain.js', 'sync.js']) {
    const src = readFileSync(resolve(shared, file), 'utf8');
    runInContext(src, ctx);
  }
  // Load popup modules
  for (const file of ['popup-search.js', 'popup-crypto.js', 'popup-dialog.js', 'popup-rules.js', 'popup-breach.js']) {
    const src = readFileSync(resolve(shared, file), 'utf8');
    runInContext(src, ctx);
  }
  return ctx;
}

const ctx = buildContext();

function call(fnName, ...args) {
  ctx._callArgs = args;
  return runInContext(`${fnName}(..._callArgs)`, ctx);
}

// ============================================================
// POPUP-SEARCH TESTS
// ============================================================
console.log('\nPopup Search Tests:');

await test('S1: Exact match scores > 0', async () => {
  assert(call('fuzzyScore', 'github', 'github') > 0);
});
await test('S2: No match returns 0', async () => {
  assert.equal(call('fuzzyScore', 'xyz', 'github'), 0);
});
await test('S3: Prefix bonus', async () => {
  assert(call('fuzzyScore', 'gi', 'github') > call('fuzzyScore', 'gi', 'agi'));
});
await test('S4: Consecutive bonus', async () => {
  assert(call('fuzzyScore', 'git', 'github') > call('fuzzyScore', 'git', 'gxixt'));
});
await test('S5: Word-boundary bonus', async () => {
  assert(call('fuzzyScore', 'p', 'my-pass') > call('fuzzyScore', 'p', 'aapaaa'));
});
await test('S6: Case insensitive', async () => {
  assert(call('fuzzyScore', 'GIT', 'github') > 0);
});
await test('S7: Partial match (not all chars found)', async () => {
  assert.equal(call('fuzzyScore', 'githubx', 'github'), 0);
});

await test('S8: Empty filter returns all sorted by frecency desc', async () => {
  const services = [{name:'a',email:'',frecency:5},{name:'b',email:'',frecency:10},{name:'c',email:'',frecency:1}];
  ctx._svcs = services;
  const result = runInContext(`getFilteredServices(_svcs, "")`, ctx);
  assert.deepEqual(result.map(s => s.frecency), [10, 5, 1]);
});
await test('S9: Filter matches by name', async () => {
  ctx._svcs = [{name:'github',email:'',site:'',frecency:0}];
  const result = runInContext(`getFilteredServices(_svcs, "git")`, ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'github');
});
await test('S10: Filter matches by email', async () => {
  ctx._svcs = [{name:'x',email:'alice@gmail.com',site:'',frecency:0}];
  const result = runInContext(`getFilteredServices(_svcs, "alice")`, ctx);
  assert.equal(result.length, 1);
});
await test('S11: Filter matches by site', async () => {
  ctx._svcs = [{name:'x',email:'y',site:'github.com',frecency:0}];
  const result = runInContext(`getFilteredServices(_svcs, "github")`, ctx);
  assert.equal(result.length, 1);
});
await test('S12: No match returns empty', async () => {
  ctx._svcs = [{name:'github',email:'',site:'',frecency:0}];
  const result = runInContext(`getFilteredServices(_svcs, "zzz")`, ctx);
  assert.deepEqual(result, []);
});
await test('S13: Score × frecency ordering', async () => {
  ctx._svcs = [{name:'github',email:'',site:'',frecency:1},{name:'git',email:'',site:'',frecency:10}];
  const result = runInContext(`getFilteredServices(_svcs, "git")`, ctx);
  assert.equal(result[0].name, 'git'); // exact match + higher frecency wins
});

// ============================================================
// POPUP-CRYPTO TESTS
// ============================================================
console.log('\nPopup Crypto Tests:');

await test('C1: base64 round-trip', async () => {
  const input = new Uint8Array([0, 1, 127, 128, 255]);
  ctx._input = input;
  const result = runInContext(`base64ToArrayBuffer(arrayBufferToBase64(_input))`, ctx);
  assert.deepEqual(new Uint8Array(result), input);
});
await test('C2: base64 round-trip empty', async () => {
  ctx._input = new Uint8Array([]);
  const result = runInContext(`base64ToArrayBuffer(arrayBufferToBase64(_input))`, ctx);
  assert.deepEqual(new Uint8Array(result), new Uint8Array([]));
});
await test('C3: base64 known vector', async () => {
  ctx._input = new Uint8Array([72, 101, 108, 108, 111]);
  const result = runInContext(`arrayBufferToBase64(_input)`, ctx);
  assert.equal(result, 'SGVsbG8=');
});

await test('C4: pinEncrypt/pinDecrypt round-trip', async () => {
  const encrypted = await runInContext(`pinEncryptSecret("1234", "my-master-secret")`, ctx);
  ctx._stored = encrypted;
  const decrypted = await runInContext(`pinDecryptSecret("1234", _stored)`, ctx);
  assert.equal(decrypted, 'my-master-secret');
});
await test('C5: Wrong pin fails decryption', async () => {
  const encrypted = await runInContext(`pinEncryptSecret("1234", "my-master-secret")`, ctx);
  ctx._stored = encrypted;
  await assert.rejects(() => runInContext(`pinDecryptSecret("9999", _stored)`, ctx));
});
await test('C6: pinEncryptSecret output structure', async () => {
  const result = await runInContext(`pinEncryptSecret("1234", "test")`, ctx);
  assert(result.encrypted && result.salt && result.iv);
  assert(result.encrypted.length > 0 && result.salt.length > 0 && result.iv.length > 0);
});

await test('C7: encryptServices/decryptServices round-trip', async () => {
  const storageKey = await runInContext(`deriveStorageKey("my-master-secret", "test@gmail.com")`, ctx);
  ctx._key = storageKey;
  const services = [{id:'1',name:'test',site:'test.com'}];
  const wallets = [{wallet_name:'w1'}];
  const auditLog = [{action:'create'}];
  ctx._s = services; ctx._w = wallets; ctx._a = auditLog;
  const encrypted = await runInContext(`encryptServices(_key, "test@gmail.com", _s, _w, _a)`, ctx);
  ctx._enc = encrypted;
  const decrypted = await runInContext(`decryptServices(_key, "test@gmail.com", _enc)`, ctx);
  assert.deepEqual(decrypted.services, services);
  assert.deepEqual(decrypted.wallets, wallets);
  assert.deepEqual(decrypted.walletAuditLog, auditLog);
});
await test('C8: Wrong email (AAD mismatch) fails', async () => {
  const storageKey = await runInContext(`deriveStorageKey("my-master-secret", "test@gmail.com")`, ctx);
  ctx._key = storageKey;
  ctx._s = []; ctx._w = []; ctx._a = [];
  const encrypted = await runInContext(`encryptServices(_key, "a@b.com", _s, _w, _a)`, ctx);
  ctx._enc = encrypted;
  await assert.rejects(() => runInContext(`decryptServices(_key, "x@y.com", _enc)`, ctx));
});
await test('C9: encryptServices output structure', async () => {
  const storageKey = await runInContext(`deriveStorageKey("my-master-secret", "test@gmail.com")`, ctx);
  ctx._key = storageKey;
  ctx._s = []; ctx._w = []; ctx._a = [];
  const result = await runInContext(`encryptServices(_key, "test@gmail.com", _s, _w, _a)`, ctx);
  assert.equal(result.version, 2);
  assert(result.iv && result.ciphertext);
});
await test('C10: decryptServices output structure', async () => {
  const storageKey = await runInContext(`deriveStorageKey("my-master-secret", "test@gmail.com")`, ctx);
  ctx._key = storageKey;
  ctx._s = [{id:'x'}]; ctx._w = [{w:1}]; ctx._a = [{a:1}];
  const encrypted = await runInContext(`encryptServices(_key, "test@gmail.com", _s, _w, _a)`, ctx);
  ctx._enc = encrypted;
  const result = await runInContext(`decryptServices(_key, "test@gmail.com", _enc)`, ctx);
  assert(Array.isArray(result.services));
  assert(Array.isArray(result.wallets));
  assert(Array.isArray(result.walletAuditLog));
});

// ============================================================
// POPUP-DIALOG TESTS
// ============================================================
console.log('\nPopup Dialog Tests:');

await test('D1: esc escapes < and >', async () => {
  const result = call('esc', '<script>alert(1)</script>');
  assert(result.includes('&lt;') && result.includes('&gt;'));
  assert(!result.includes('<script>'));
});
await test('D2: esc escapes &', async () => {
  assert(call('esc', 'a & b').includes('&amp;'));
});
await test('D3: esc passes safe string unchanged', async () => {
  assert.equal(call('esc', 'hello world'), 'hello world');
});

await test('D4: nextTimestamp returns > max updated_at', async () => {
  const future = Date.now() + 100000;
  ctx._svcs = [{updated_at: future}];
  const result = runInContext(`nextTimestamp(_svcs)`, ctx);
  assert(result > future, `expected > ${future}, got ${result}`);
});
await test('D5: nextTimestamp returns >= Date.now()', async () => {
  ctx._svcs = [{updated_at: 1}];
  const now = Date.now();
  const result = runInContext(`nextTimestamp(_svcs)`, ctx);
  assert(result >= now, `expected >= ${now}, got ${result}`);
});
await test('D6: nextTimestamp empty array', async () => {
  const now = Date.now();
  ctx._svcs = [];
  const result = runInContext(`nextTimestamp(_svcs)`, ctx);
  assert(result >= now, `expected >= ${now}, got ${result}`);
});

await test('D7: formatRelativeTime null/0 returns empty', async () => {
  assert.equal(call('formatRelativeTime', 0), '');
});
await test('D8: formatRelativeTime recent (< 60s)', async () => {
  assert.equal(call('formatRelativeTime', Date.now() - 30000), 'just now');
});
await test('D9: formatRelativeTime minutes ago', async () => {
  assert.equal(call('formatRelativeTime', Date.now() - 300000), '5m ago');
});
await test('D10: formatRelativeTime hours ago', async () => {
  assert.equal(call('formatRelativeTime', Date.now() - 7200000), '2h ago');
});

await test('D11: computeSyncStatus syncing in progress', async () => {
  const result = call('computeSyncStatus', true, null, null, null);
  assert.equal(JSON.stringify(result), JSON.stringify({visible: true, text: 'Syncing...', errorHtml: null}));
});
await test('D12: computeSyncStatus network error with retry countdown', async () => {
  const result = call('computeSyncStatus', false, {type:'network',message:'fail'}, null, {nextRetryAt: Date.now()+5000});
  assert(result.visible);
  assert(result.errorHtml.includes('Connection error'));
  assert(result.errorHtml.includes('Retrying in'));
});
await test('D13: computeSyncStatus network error retries exhausted', async () => {
  const result = call('computeSyncStatus', false, {type:'network',message:'fail'}, null, {attempt:3});
  assert(result.errorHtml.includes('Sync unavailable'));
});
await test('D14: computeSyncStatus auth error', async () => {
  const result = call('computeSyncStatus', false, {type:'auth'}, null, null);
  assert(result.errorHtml.includes('Authentication failed'));
});
await test('D15: computeSyncStatus generic error', async () => {
  const result = call('computeSyncStatus', false, {type:'other',message:'boom'}, null, null);
  assert(result.errorHtml.includes('boom'));
});
await test('D16: computeSyncStatus string error (legacy)', async () => {
  const result = call('computeSyncStatus', false, 'something broke', null, null);
  assert(result.errorHtml.includes('something broke'));
});
await test('D17: computeSyncStatus last sync time shown', async () => {
  const result = call('computeSyncStatus', false, null, Date.now()-60000, null);
  assert(result.visible);
  assert(result.text.includes('1m ago'));
  assert.equal(result.errorHtml, null);
});
await test('D18: computeSyncStatus no state', async () => {
  const result = call('computeSyncStatus', false, null, null, null);
  assert.equal(JSON.stringify(result), JSON.stringify({visible: false, text: '', errorHtml: null}));
});

// ============================================================
// POPUP-RULES TESTS
// ============================================================
console.log('\nPopup Rules Tests:');

await test('R1: canonicalJSON sorts keys', async () => {
  assert.equal(call('canonicalJSON', {b:1, a:2}), '{"a":2,"b":1}');
});
await test('R2: canonicalJSON nested objects sorted', async () => {
  assert.equal(call('canonicalJSON', {z:{b:1,a:2}, a:3}), '{"a":3,"z":{"a":2,"b":1}}');
});
await test('R3: canonicalJSON arrays preserve order', async () => {
  assert.equal(call('canonicalJSON', [3,1,2]), '[3,1,2]');
});
await test('R4: canonicalJSON null', async () => {
  assert.equal(call('canonicalJSON', null), 'null');
});
await test('R5: canonicalJSON primitives', async () => {
  assert.equal(call('canonicalJSON', 'hello'), '"hello"');
  assert.equal(call('canonicalJSON', 42), '42');
  assert.equal(call('canonicalJSON', true), 'true');
});

await test('R6: lookupRule exact domain match', async () => {
  const rules = [{domain:'example.com', exact:true, length:20}];
  ctx._rules = rules;
  const result = runInContext(`lookupRule("example.com", _rules)`, ctx);
  assert.deepEqual(result, rules[0]);
});
await test('R7: lookupRule subdomain match (non-exact)', async () => {
  const rules = [{domain:'example.com', length:20}];
  ctx._rules = rules;
  const result = runInContext(`lookupRule("sub.example.com", _rules)`, ctx);
  assert.deepEqual(result, rules[0]);
});
await test('R8: lookupRule subdomain rejected for exact rule', async () => {
  const rules = [{domain:'example.com', exact:true}];
  ctx._rules = rules;
  const result = runInContext(`lookupRule("sub.example.com", _rules)`, ctx);
  assert.equal(result, null);
});
await test('R9: lookupRule www prefix stripped', async () => {
  const rules = [{domain:'example.com', exact:true}];
  ctx._rules = rules;
  const result = runInContext(`lookupRule("www.example.com", _rules)`, ctx);
  assert.deepEqual(result, rules[0]);
});
await test('R10: lookupRule no match', async () => {
  const rules = [{domain:'example.com'}];
  ctx._rules = rules;
  const result = runInContext(`lookupRule("other.com", _rules)`, ctx);
  assert.equal(result, null);
});
await test('R11: lookupRule null rules', async () => {
  assert.equal(call('lookupRule', 'x.com', null), null);
});
await test('R12: lookupRule null hostname', async () => {
  assert.equal(call('lookupRule', null, [{domain:'x.com'}]), null);
});

await test('R13: verifyRulesSignature valid signature', async () => {
  const keyPair = await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const rules = [{domain:'example.com'}];
  const version = 1;
  const payload = JSON.stringify({rules, version}); // canonicalJSON would sort, but keys already sorted
  const payloadCanonical = call('canonicalJSON', {rules, version});
  const sig = await webcrypto.subtle.sign('Ed25519', keyPair.privateKey, new TextEncoder().encode(payloadCanonical));
  const pubKeyRaw = await webcrypto.subtle.exportKey('raw', keyPair.publicKey);
  const sigB64 = Buffer.from(sig).toString('base64');
  const pubB64 = Buffer.from(pubKeyRaw).toString('base64');
  const json = {rules, version, signature: sigB64};
  ctx._json = json; ctx._pub = pubB64;
  const result = await runInContext(`verifyRulesSignature(_json, _pub)`, ctx);
  assert.equal(result, true);
});
await test('R14: verifyRulesSignature tampered payload fails', async () => {
  const keyPair = await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const rules = [{domain:'example.com'}];
  const version = 1;
  const payloadCanonical = call('canonicalJSON', {rules, version});
  const sig = await webcrypto.subtle.sign('Ed25519', keyPair.privateKey, new TextEncoder().encode(payloadCanonical));
  const pubKeyRaw = await webcrypto.subtle.exportKey('raw', keyPair.publicKey);
  const sigB64 = Buffer.from(sig).toString('base64');
  const pubB64 = Buffer.from(pubKeyRaw).toString('base64');
  const json = {rules: [{domain:'evil.com'}], version, signature: sigB64};
  ctx._json = json; ctx._pub = pubB64;
  const result = await runInContext(`verifyRulesSignature(_json, _pub)`, ctx);
  assert.equal(result, false);
});
await test('R15: verifyRulesSignature wrong key fails', async () => {
  const keyA = await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const keyB = await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const rules = [{domain:'example.com'}];
  const version = 1;
  const payloadCanonical = call('canonicalJSON', {rules, version});
  const sig = await webcrypto.subtle.sign('Ed25519', keyA.privateKey, new TextEncoder().encode(payloadCanonical));
  const pubKeyRaw = await webcrypto.subtle.exportKey('raw', keyB.publicKey);
  const sigB64 = Buffer.from(sig).toString('base64');
  const pubB64 = Buffer.from(pubKeyRaw).toString('base64');
  const json = {rules, version, signature: sigB64};
  ctx._json = json; ctx._pub = pubB64;
  const result = await runInContext(`verifyRulesSignature(_json, _pub)`, ctx);
  assert.equal(result, false);
});

// ============================================================
// POPUP-BREACH TESTS
// ============================================================
console.log('\nPopup Breach Tests:');

await test('B1: Matching breach returned', async () => {
  ctx._b = [{id:'b1',domain:'github.com'}];
  ctx._s = [{site:'github.com',name:'github'}];
  ctx._d = [];
  const result = runInContext(`checkBreaches(_b, _s, _d)`, ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'b1');
});
await test('B2: Dismissed breach excluded', async () => {
  ctx._b = [{id:'b1',domain:'github.com'}];
  ctx._s = [{site:'github.com',name:'github'}];
  ctx._d = ['b1'];
  const result = runInContext(`checkBreaches(_b, _s, _d)`, ctx);
  assert.deepEqual(result, []);
});
await test('B3: Subdomain match', async () => {
  ctx._b = [{id:'b2',domain:'github.com'}];
  ctx._s = [{site:'sub.github.com',name:'x'}];
  ctx._d = [];
  const result = runInContext(`checkBreaches(_b, _s, _d)`, ctx);
  assert.equal(result.length, 1);
});
await test('B4: www stripped from service', async () => {
  ctx._b = [{id:'b3',domain:'github.com'}];
  ctx._s = [{site:'www.github.com',name:'x'}];
  ctx._d = [];
  const result = runInContext(`checkBreaches(_b, _s, _d)`, ctx);
  assert.equal(result.length, 1);
});
await test('B5: No matching service', async () => {
  ctx._b = [{id:'b4',domain:'other.com'}];
  ctx._s = [{site:'github.com',name:'github'}];
  ctx._d = [];
  const result = runInContext(`checkBreaches(_b, _s, _d)`, ctx);
  assert.deepEqual(result, []);
});
await test('B6: Uses name as fallback when site is empty', async () => {
  ctx._b = [{id:'b5',domain:'github.com'}];
  ctx._s = [{name:'github.com',site:''}];
  ctx._d = [];
  const result = runInContext(`checkBreaches(_b, _s, _d)`, ctx);
  assert.equal(result.length, 1);
});
await test('B7: Multiple breaches partial match', async () => {
  ctx._b = [{id:'b1',domain:'github.com'},{id:'b2',domain:'other.com'},{id:'b3',domain:'gitlab.com'}];
  ctx._s = [{site:'github.com',name:'gh'}];
  ctx._d = [];
  const result = runInContext(`checkBreaches(_b, _s, _d)`, ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'b1');
});

// ============================================================
// SUMMARY
// ============================================================
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
