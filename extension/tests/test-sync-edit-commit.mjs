import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '..', 'shared', 'popup-crypto.js');
const ctx = createContext({
  Array, ArrayBuffer, Error, JSON, Map, Math, Number, Object, Promise, RegExp, String,
  TextEncoder, TextDecoder, Uint8Array, crypto: webcrypto, btoa, atob,
});
runInContext(`
  function arrayBufferToBase64(buffer) {
    let binary = "";
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  function base64ToArrayBuffer(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
`, ctx);
runInContext(readFileSync(sourcePath, 'utf8'), ctx);
runInContext(readFileSync(resolve(__dirname, '..', 'shared', 'sync.js'), 'utf8'), ctx);

function validate(value) {
  ctx.value = value;
  return runInContext('validateLocalPayload(value)', ctx);
}
function rejects(value) {
  ctx.value = value;
  assert.throws(() => runInContext('validateLocalPayload(value)', ctx), /invalid_local_payload/);
}
function v3(marker = null) {
  return {
    version: 3,
    services: [{id: 'svc', site: 'example.com', unknown: {z: 1, a: 2}}],
    wallets: [], wallet_audit_log: [], tombstones: [], deletion_review: [], pending_sync: marker,
  };
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }

await test('legacy payloads normalize pendingSync to null without adding a write shape', () => {
  assert.equal(validate({version: 1, services: []}).pendingSync, null);
  assert.equal(validate({version: 2, services: [], wallets: [], wallet_audit_log: [], tombstones: [], deletion_review: []}).pendingSync, null);
});

await test('v3 marker requires exact ordered keys and safe updateVersion', () => {
  const mutationId = runInContext('createLocalMutationId()', ctx);
  const payload = v3({version: 1, mutationId, updateVersion: 123});
  const result = validate(payload);
  assert.deepEqual(JSON.parse(JSON.stringify(result.pendingSync)), {version: 1, mutationId, updateVersion: 123});
  assert.deepEqual(Object.keys(result.pendingSync), ['version', 'mutationId', 'updateVersion']);
  for (const marker of [
    {version: 1, mutationId},
    {version: 1, mutationId, updateVersion: -1},
    {version: 1, mutationId, updateVersion: 1.5},
    {version: 1, mutationId, updateVersion: Number.MAX_SAFE_INTEGER + 1},
    {version: 1, mutationId, updateVersion: '123'},
    {version: 1, updateVersion: 123, mutationId},
  ]) rejects(v3(marker));
});

await test('v3 encryption retains the existing outer envelope and round-trips the marker', async () => {
  const key = new Uint8Array(32);
  const mutationId = runInContext('createLocalMutationId()', ctx);
  ctx.payload = v3({version: 1, mutationId, updateVersion: 9001});
  ctx.key = key;
  const encrypted = await runInContext('encryptServicesV3(key, "account@example.com", payload)', ctx);
  assert.deepEqual(Object.keys(encrypted), ['version', 'iv', 'ciphertext']);
  assert.equal(encrypted.version, 2);
  ctx.encrypted = encrypted;
  const decoded = await runInContext('decryptServices(key, "account@example.com", encrypted)', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(decoded.pendingSync)), {version: 1, mutationId, updateVersion: 9001});
});

await test('canonical fingerprints preserve nested unknown fields and include marker meaning', async () => {
  const mutationId = runInContext('createLocalMutationId()', ctx);
  const first = v3({version: 1, mutationId, updateVersion: 10});
  const reordered = v3({version: 1, mutationId, updateVersion: 10});
  reordered.services = [{unknown: {a: 2, z: 1}, site: 'example.com', id: 'svc'}];
  ctx.first = first; ctx.reordered = reordered;
  const firstJson = runInContext('canonicalLocalPayloadJson(first)', ctx);
  const reorderedJson = runInContext('canonicalLocalPayloadJson(reordered)', ctx);
  assert.equal(firstJson, reorderedJson);
  const firstFingerprint = await runInContext('fingerprintLocalPayload(first)', ctx);
  reordered.pending_sync.updateVersion = 11;
  ctx.reordered = reordered;
  const changedFingerprint = await runInContext('fingerprintLocalPayload(reordered)', ctx);
  assert.notEqual(firstFingerprint, changedFingerprint);
  assert.doesNotMatch(firstJson, /"secret"|account@example\.com/);
});

await test('canonicalization fails closed for accessors, symbols, cycles, and unsafe numbers', () => {
  const base = v3(null);
  const accessor = v3(null);
  Object.defineProperty(accessor, 'services', {enumerable: true, get() { return []; }});
  const symbol = v3(null); symbol.services[0][Symbol('secret')] = 1;
  const cycle = v3(null); cycle.services[0].cycle = cycle;
  const unsafe = v3(null); unsafe.services[0].value = Number.MAX_SAFE_INTEGER + 1;
  for (const value of [base, accessor, symbol, cycle, unsafe]) {
    ctx.value = value;
    if (value === base) continue;
    assert.throws(() => runInContext('canonicalLocalPayloadJson(value)', ctx), /invalid_local_payload/);
  }
});

await test('pending_sync is excluded from sync plaintext source and parser output', () => {
  const syncSource = readFileSync(resolve(__dirname, '..', 'shared', 'sync.js'), 'utf8');
  assert.doesNotMatch(syncSource, /pending_sync/);
  ctx.syncValue = {services: [], wallets: [], wallet_audit_log: [], pending_sync: {version: 1}};
  const parsed = runInContext('parseBlobContent(syncValue)', ctx);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'pending_sync'), false);
});

console.log(`${passed} tests: ${passed} passed, 0 failed`);
