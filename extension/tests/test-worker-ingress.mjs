
import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '..', 'shared', 'worker-ingress.js');
const source = readFileSync(sourcePath, 'utf8');
const context = createContext({
  Array,
  ArrayBuffer,
  DataView,
  Error,
  JSON,
  Map,
  Math,
  Number,
  Object,
  Promise,
  RangeError,
  RegExp,
  String,
  TextDecoder,
  TextEncoder,
  Uint8Array,
  Buffer,
  crypto: webcrypto,
  globalThis: undefined,
});
runInContext('globalThis = this;', context);
runInContext(source, context);
const KG = context.KeygrainWorkerIngress;
assert.ok(KG, 'foundation must expose KeygrainWorkerIngress');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function cloneEnvelope(envelope) {
  return JSON.parse(envelope.envelopeText);
}

function wrapperFromObject(object) {
  return {type: 'ENCRYPTED_UNLOCK', envelopeText: JSON.stringify(object)};
}

function makeRuntime(trustedContext) {
  return {
    issue({runtimeContext}) {
      return runtimeContext === trustedContext;
    },
    admit({runtimeContext}) {
      return runtimeContext === trustedContext;
    },
  };
}

async function makeSession(now = 0, sink = () => true) {
  const trusted = Symbol('trusted-extension-popup');
  const diagnostics = [];
  const ingress = await KG.createIngress({
    crypto: webcrypto,
    clock: () => now,
    runtimeAdmission: makeRuntime(trusted),
    onAuthenticatedUnlock: sink,
    onDiagnostic: code => diagnostics.push(code),
  });
  return {trusted, diagnostics, ingress};
}

async function makeMetadataSession(nowRef = {value: 0}, sink = () => ({ok: true, result: {password: 'bounded-password'}}), crypto = webcrypto) {
  const trusted = Symbol('trusted-metadata-extension-popup');
  const calls = [];
  const ingress = await KG.createMetadataPasswordIngress({
    crypto,
    clock: () => nowRef.value,
    runtimeAdmission: {
      issue({runtimeContext}) { return runtimeContext === trusted; },
      admit({runtimeContext}) { return runtimeContext === trusted; },
    },
    onMetadataSecret: input => { calls.push(input); return sink(input); },
  });
  return {trusted, calls, ingress, nowRef};
}
function delayedDecryptCrypto(releaseState) {
  const subtle = {
    generateKey: (...args) => webcrypto.subtle.generateKey(...args),
    exportKey: (...args) => webcrypto.subtle.exportKey(...args),
    digest: (...args) => webcrypto.subtle.digest(...args),
    importKey: (...args) => webcrypto.subtle.importKey(...args),
    encrypt: (...args) => webcrypto.subtle.encrypt(...args),
    decrypt: (...args) => {
      if (!releaseState.started) {
        releaseState.started = true;
        return new Promise((resolve, reject) => {
          releaseState.resolve = () => webcrypto.subtle.decrypt(...args).then(resolve, reject);
        });
      }
      return webcrypto.subtle.decrypt(...args);
    },
  };
  return {getRandomValues: value => webcrypto.getRandomValues(value), subtle};
}
function failingExportCrypto(state) {
  const subtle = {
    generateKey: (...args) => webcrypto.subtle.generateKey(...args),
    exportKey: (...args) => state.fail ? Promise.reject(new Error('injected export failure')) : webcrypto.subtle.exportKey(...args),
    digest: (...args) => webcrypto.subtle.digest(...args),
    importKey: (...args) => webcrypto.subtle.importKey(...args),
    encrypt: (...args) => webcrypto.subtle.encrypt(...args),
    decrypt: (...args) => webcrypto.subtle.decrypt(...args),
  };
  return {getRandomValues: value => webcrypto.getRandomValues(value), subtle};
}


async function makeAadMismatchEnvelope(challenge, field) {
  const ids = {
    challengeId: KG.fromBase64Url(challenge.challengeId, 32, 'CHALLENGE_ID'),
    requestId: KG.fromBase64Url(challenge.requestId, 32, 'REQUEST_ID'),
    popupSessionNonce: KG.fromBase64Url(challenge.popupSessionNonce, 32, 'SESSION_NONCE'),
    workerIncarnation: KG.fromBase64Url(challenge.workerIncarnation, 32, 'WORKER_INCARNATION'),
  };
  ids[field][0] ^= 1;
  const keyBytes = Uint8Array.from({length: 32}, (_, index) => index);
  const iv = Uint8Array.from({length: 12}, (_, index) => index);
  const aad = KG.buildAAD({...ids, publicKeySha256: challenge.publicKeySha256});
  const plaintext = KG.buildPlaintext('u@example.com', 'secret');
  const aesKey = await webcrypto.subtle.importKey('raw', keyBytes, {name: 'AES-GCM', length: 256}, false, ['encrypt']);
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad, tagLength: 128}, aesKey, plaintext));
  const publicKey = await webcrypto.subtle.importKey('spki', KG.fromBase64Url(challenge.publicKeySpki), {name: 'RSA-OAEP', hash: 'SHA-256'}, false, ['encrypt']);
  const wrappedKey = new Uint8Array(await webcrypto.subtle.encrypt({name: 'RSA-OAEP', label: new TextEncoder().encode(KG.OAEP_LABEL_TEXT)}, publicKey, keyBytes));
  return wrapperFromObject({
    protocol: KG.PROTOCOL,
    challengeId: challenge.challengeId,
    requestId: challenge.requestId,
    popupSessionNonce: challenge.popupSessionNonce,
    workerIncarnation: challenge.workerIncarnation,
    publicKeySha256: challenge.publicKeySha256,
    iv: KG.toBase64Url(iv),
    wrappedKey: KG.toBase64Url(wrappedKey),
    ciphertext: KG.toBase64Url(ciphertext),
  });
}
await test('§3.10 plaintext and AAD bytes are exact', () => {
  const plaintext = KG.buildPlaintext('u@example.com', 'correct horse');
  assert.equal(KG.toHex(plaintext), '010000000d75406578616d706c652e636f6d0000000d636f727265637420686f727365');
  const ids = [1, 2, 3, 4].map(value => new Uint8Array(32).fill(value));
  const aad = KG.buildAAD({
    challengeId: ids[0], requestId: ids[1], popupSessionNonce: ids[2], workerIncarnation: ids[3],
    publicKeyHash: new Uint8Array(32).fill(5),
  });
  assert.equal(KG.toHex(aad), '4b4559475241494e2d494e47524553532d4141442d76310001200101010101010101010101010101010101010101010101010101010101010101200202020202020202020202020202020202020202020202020202020202020202200303030303030303030303030303030303030303030303030303030303030303200404040404040404040404040404040404040404040404040404040404040404200505050505050505050505050505050505050505050505050505050505050505');
  const parsed = KG.parsePlaintext(plaintext);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.email, 'u@example.com');
  assert.equal(parsed.secret, 'correct horse');
});

await test('§3.10 AES-GCM fixture is exact', async () => {
  const keyBytes = Uint8Array.from({length: 32}, (_, index) => index);
  const iv = Uint8Array.from({length: 12}, (_, index) => index);
  const aad = KG.buildAAD({
    challengeId: new Uint8Array(32).fill(1), requestId: new Uint8Array(32).fill(2),
    popupSessionNonce: new Uint8Array(32).fill(3), workerIncarnation: new Uint8Array(32).fill(4),
    publicKeyHash: new Uint8Array(32).fill(5),
  });
  const plaintext = KG.buildPlaintext('u@example.com', 'correct horse');
  const key = await webcrypto.subtle.importKey('raw', keyBytes, {name: 'AES-GCM', length: 256}, false, ['encrypt']);
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad, tagLength: 128}, key, plaintext));
  assert.equal(KG.toHex(ciphertext), '4602d61bc890827ef520fafbdd8c560eecbb8734f0763c134a1580e6694968dd7363cbc8c3f9514716a5f26034494fd20d47a0');
  assert.equal(KG.toBase64Url(ciphertext), 'RgLWG8iQgn71IPr73YxWDuy7hzTwdjwTShWA5mlJaN1zY8vIw_lRRxal8mA0SU_SDUeg');
});

await test('strict binary TLV rejects trailing bytes, invalid UTF-8, and bounds violations', () => {
  const valid = KG.buildPlaintext('u@example.com', 'secret');
  const trailing = new Uint8Array(valid.length + 1);
  trailing.set(valid);
  trailing[trailing.length - 1] = 1;
  assert.throws(() => KG.parsePlaintext(trailing), /TRAILING/);
  const invalidUtf8 = valid.slice();
  invalidUtf8[5] = 0xc3;
  invalidUtf8[6] = 0x28;
  assert.throws(() => KG.parsePlaintext(invalidUtf8), /UTF8/);
  assert.throws(() => KG.buildPlaintext('u@example.com', ''), /SECRET_LENGTH/);
  assert.throws(() => KG.buildPlaintext('a'.repeat(255), 'x'), /EMAIL_TOO_LONG/);
});

await test('strict base64url, hash, and schema parsers reject bad alphabets, padding, lengths, and types', async () => {
  assert.throws(() => KG.fromBase64Url('AQ==', 1, 'ID'), /INVALID/);
  assert.throws(() => KG.fromBase64Url('A+', undefined, 'ID'), /INVALID/);
  assert.throws(() => KG.fromBase64Url('A', undefined, 'ID'), /INVALID/);
  assert.throws(() => KG.fromHex64('AA'.repeat(31)), /INVALID/);
  const session = await makeSession();
  const challenge = await session.ingress.issueChallenge(session.trusted);
  const envelope = await KG.makeEnvelope(challenge, 'u@example.com', 'secret', {crypto: webcrypto});
  const object = cloneEnvelope(envelope);
  object.iv = 7;
  assert.throws(() => KG.parseOuterWrapper(wrapperFromObject(object)), /INVALID/);
  object.iv = cloneEnvelope(envelope).iv + '=';
  assert.throws(() => KG.parseOuterWrapper(wrapperFromObject(object)), /INVALID/);
  const extra = cloneEnvelope(envelope);
  extra.extra = 1;
  assert.throws(() => KG.parseOuterWrapper(wrapperFromObject(extra)), /SCHEMA|CANONICAL/);
  const reordered = cloneEnvelope(envelope);
  const reorderedText = JSON.stringify({requestId: reordered.requestId, ...reordered});
  assert.throws(() => KG.parseOuterWrapper({type: 'ENCRYPTED_UNLOCK', envelopeText: reorderedText}), /SCHEMA|CANONICAL/);
  const duplicate = envelope.envelopeText.replace(`,"requestId":"${object.requestId}"`, `,"requestId":"${object.requestId}","requestId":"${object.requestId}"`);
  assert.throws(() => KG.parseOuterWrapper({type: 'ENCRYPTED_UNLOCK', envelopeText: duplicate}), /CANONICAL/);
  assert.throws(() => KG.parseOuterWrapper({envelopeText: envelope.envelopeText, type: 'ENCRYPTED_UNLOCK'}), /SCHEMA/);
  assert.throws(() => KG.parseOuterWrapper({type: 'ENCRYPTED_UNLOCK', envelopeText: envelope.envelopeText, extra: 1}), /SCHEMA/);
});

await test('RSA-OAEP/AES-GCM round trip uses test-only generated keys and no private key escapes', async () => {
  let unlocked = [];
  const session = await makeSession(0, (email, secret) => {
    unlocked.push({email, secret});
    return true;
  });
  const challenge = await session.ingress.issueChallenge(session.trusted);
  assert.equal(challenge.publicKeySpki.length > 300, true);
  assert.equal(challenge.publicKeySha256.length, 64);
  assert.equal(Object.keys(challenge).includes('privateKey'), false);
  const envelope = await KG.makeEnvelope(challenge, 'u@example.com', 'correct horse', {crypto: webcrypto});
  assert.doesNotMatch(envelope.envelopeText, /u@example\.com|correct horse/);
  const result = await session.ingress.admitUnlock(session.trusted, envelope);
  assert.equal(result.ok, true);
  assert.deepEqual(unlocked, [{email: 'u@example.com', secret: 'correct horse'}]);
  assert.equal(Object.keys(result).includes('secret'), false);
  assert.equal(Object.keys(result).includes('privateKey'), false);
  assert.doesNotMatch(source, /-----BEGIN (?:RSA )?PRIVATE KEY-----|MII[A-Za-z0-9+/]{20,}/);
});

await test('AAD request/session flips fail authentication and consume the bound attempt', async () => {
  for (const field of ['requestId', 'popupSessionNonce']) {
    const session = await makeSession();
    const challenge = await session.ingress.issueChallenge(session.trusted);
    const envelope = await makeAadMismatchEnvelope(challenge, field);
    const result = await session.ingress.admitUnlock(session.trusted, envelope);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'UNLOCK_FAILED');
    assert.equal(session.diagnostics.filter(code => code === 'CHALLENGE_CONSUMED').length, 1);
    const failed = await session.ingress.admitUnlock(session.trusted, envelope);
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'UNLOCK_FAILED');
  }
});

await test('wrong runtime does not consume a structurally valid envelope', async () => {
  const session = await makeSession();
  const challenge = await session.ingress.issueChallenge(session.trusted);
  const envelope = await KG.makeEnvelope(challenge, 'u@example.com', 'secret', {crypto: webcrypto});
  const forgedResult = await session.ingress.admitUnlock({extensionId: 'known', origin: 'moz-extension://known', documentId: 'doc'}, envelope);
  assert.equal(forgedResult.ok, false);
  assert.equal(forgedResult.code, 'UNLOCK_FAILED');
  assert.equal(session.diagnostics.includes('RUNTIME_REJECTED'), true);
  assert.equal(session.diagnostics.includes('CHALLENGE_CONSUMED'), false);
  const acceptedAfterForged = await session.ingress.admitUnlock(session.trusted, envelope);
  assert.equal(acceptedAfterForged.ok, true);
});

await test('replay is rejected after successful consumption', async () => {
  const session = await makeSession();
  const challenge = await session.ingress.issueChallenge(session.trusted);
  const envelope = await KG.makeEnvelope(challenge, 'u@example.com', 'secret', {crypto: webcrypto});
  const firstResult = await session.ingress.admitUnlock(session.trusted, envelope);
  assert.equal(firstResult.ok, true);
  const replayResult = await session.ingress.admitUnlock(session.trusted, envelope);
  assert.equal(replayResult.ok, false);
  assert.equal(replayResult.code, 'UNLOCK_FAILED');
  assert.equal(session.diagnostics.filter(code => code === 'CHALLENGE_CONSUMED').length, 1);
});

await test('expiry at the exact private deadline rejects without consumption', async () => {
  let now = 0;
  const trusted = Symbol('trusted');
  const diagnostics = [];
  const ingress = await KG.createIngress({
    crypto: webcrypto, clock: () => now, runtimeAdmission: makeRuntime(trusted),
    onAuthenticatedUnlock: () => true, onDiagnostic: code => diagnostics.push(code),
  });
  const challenge = await ingress.issueChallenge(trusted);
  const envelope = await KG.makeEnvelope(challenge, 'u@example.com', 'secret', {crypto: webcrypto});
  now = 30000;
  const expiredResult = await ingress.admitUnlock(trusted, envelope);
  assert.equal(expiredResult.ok, false);
  assert.equal(expiredResult.code, 'UNLOCK_FAILED');
  assert.equal(diagnostics.includes('EXPIRED_REJECTED'), true);
  assert.equal(diagnostics.includes('CHALLENGE_CONSUMED'), false);
});

await test('revocation and a fresh ingress instance invalidate old challenges', async () => {
  const first = await makeSession();
  const challenge = await first.ingress.issueChallenge(first.trusted);
  const envelope = await KG.makeEnvelope(challenge, 'u@example.com', 'secret', {crypto: webcrypto});
  first.ingress.revokeAll();
  const revokedResult = await first.ingress.admitUnlock(first.trusted, envelope);
  assert.equal(revokedResult.ok, false);
  assert.equal(revokedResult.code, 'UNLOCK_FAILED');
  const second = await makeSession();
  const restartedResult = await second.ingress.admitUnlock(second.trusted, envelope);
  assert.equal(restartedResult.ok, false);
  assert.equal(restartedResult.code, 'UNLOCK_FAILED');
});

await test('revocation blocks a delayed in-flight decrypt and private sink', async () => {
  const releaseState = {started: false, resolve: null};
  const trusted = Symbol('trusted');
  let sinkCount = 0;
  const ingress = await KG.createIngress({
    crypto: delayedDecryptCrypto(releaseState),
    clock: () => 0,
    runtimeAdmission: makeRuntime(trusted),
    onAuthenticatedUnlock: () => { sinkCount++; return true; },
  });
  const challenge = await ingress.issueChallenge(trusted);
  const envelope = await KG.makeEnvelope(challenge, 'u@example.com', 'secret', {crypto: webcrypto});
  const pending = ingress.admitUnlock(trusted, envelope);
  for (let i = 0; i < 20 && !releaseState.started; i++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(releaseState.started, true);
  ingress.revokeAll();
  releaseState.resolve();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNLOCK_FAILED');
  assert.equal(sinkCount, 0);
});

await test('non-finite and rollback clock readings revoke and fail closed', async () => {
  for (const fault of ['nan', 'rollback']) {
    let now = 100;
    const trusted = Symbol(fault);
    const diagnostics = [];
    const ingress = await KG.createIngress({
      crypto: webcrypto, clock: () => now, runtimeAdmission: makeRuntime(trusted),
      onAuthenticatedUnlock: () => true, onDiagnostic: code => diagnostics.push(code),
    });
    const challenge = await ingress.issueChallenge(trusted);
    const envelope = await KG.makeEnvelope(challenge, 'u@example.com', 'secret', {crypto: webcrypto});
    now = fault === 'nan' ? Number.NaN : 99;
    const result = await ingress.admitUnlock(trusted, envelope);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'UNLOCK_FAILED');
    assert.equal(diagnostics.includes('CLOCK_INVALID'), true);
    assert.equal(diagnostics.includes('CHALLENGE_CONSUMED'), false);
  }
});

await test('failed decrypt consumes before decrypt and concurrent duplicates admit at most one', async () => {
  let callbackCount = 0;
  const session = await makeSession(0, () => { callbackCount++; return true; });
  const challenge = await session.ingress.issueChallenge(session.trusted);
  const valid = await KG.makeEnvelope(challenge, 'u@example.com', 'secret', {crypto: webcrypto});
  const badObject = cloneEnvelope(valid);
  const ciphertext = KG.fromBase64Url(badObject.ciphertext);
  ciphertext[0] ^= 1;
  badObject.ciphertext = KG.toBase64Url(ciphertext);
  const failedDecrypt = await session.ingress.admitUnlock(session.trusted, wrapperFromObject(badObject));
  assert.equal(failedDecrypt.ok, false);
  assert.equal(failedDecrypt.code, 'UNLOCK_FAILED');
  const failedReplay = await session.ingress.admitUnlock(session.trusted, wrapperFromObject(badObject));
  assert.equal(failedReplay.ok, false);
  assert.equal(failedReplay.code, 'UNLOCK_FAILED');
  assert.equal(session.diagnostics.filter(code => code === 'CHALLENGE_CONSUMED').length, 1);
  assert.equal(callbackCount, 0);

  const concurrent = await makeSession(0, () => { callbackCount++; return true; });
  const concurrentChallenge = await concurrent.ingress.issueChallenge(concurrent.trusted);
  const concurrentEnvelope = await KG.makeEnvelope(concurrentChallenge, 'u@example.com', 'secret', {crypto: webcrypto});
  const results = await Promise.all([
    concurrent.ingress.admitUnlock(concurrent.trusted, concurrentEnvelope),
    concurrent.ingress.admitUnlock(concurrent.trusted, concurrentEnvelope),
  ]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => !result.ok).length, 1);
  assert.equal(concurrent.diagnostics.filter(code => code === 'CHALLENGE_ADMITTED').length, 1);
});

await test('public objects and diagnostics contain no plaintext secret, key, payload, or reusable capability', async () => {
  const secret = 'correct horse';
  const session = await makeSession(0, () => true);
  const challenge = await session.ingress.issueChallenge(session.trusted);
  const envelope = await KG.makeEnvelope(challenge, 'u@example.com', secret, {crypto: webcrypto});
  const result = await session.ingress.admitUnlock(session.trusted, envelope);
  const publicJson = JSON.stringify({challenge, envelope, result});
  const diagnosticJson = JSON.stringify(session.diagnostics);
  assert.doesNotMatch(publicJson, /correct horse|u@example\.com/);
  assert.doesNotMatch(diagnosticJson, /correct horse|u@example\.com/);
  assert.doesNotMatch(publicJson, /privateKey|aesKey|fullPayload|capability/);
  assert.deepEqual(Object.keys(result).sort(), ['ok']);
});

await test('metadata plaintext is secret-only and the factory is separate from full unlock', () => {
  assert.equal(KG.toHex(KG.metadataPlaintext('secret')), '0100000006736563726574');
  assert.equal(KG.metadataParsePlaintext(KG.metadataPlaintext('secret')), 'secret');
  const metadataStart = source.indexOf('const METADATA_GENERATE_PROTOCOL');
  const fullStart = source.indexOf('const PROTOCOL');
  const metadataSource = source.slice(metadataStart, fullStart);
  assert.match(metadataSource, /createMetadataPasswordIngress/);
  assert.doesNotMatch(metadataSource, /onAuthenticatedUnlock|ENCRYPTED_UNLOCK|keygrain-unlock-ingress-v1/);
  assert.throws(() => KG.metadataPlaintext(''), /AUTH_PROTOCOL/);
});

await test('metadata issuance failure cleans temporary key material and permits a later challenge', async () => {
  const failure = {fail: true};
  const crypto = failingExportCrypto(failure);
  const session = await makeMetadataSession({value: 0}, undefined, crypto);
  await assert.rejects(session.ingress.issueChallenge({runtimeContext: session.trusted, purpose: KG.METADATA_GENERATE_PROTOCOL, selectionBinding: {ordinal: 0}, fillEmail: false}), /injected export failure/);
  failure.fail = false;
  const challenge = await session.ingress.issueChallenge({runtimeContext: session.trusted, purpose: KG.METADATA_GENERATE_PROTOCOL, selectionBinding: {ordinal: 1}, fillEmail: false});
  const envelope = await KG.makeMetadataEnvelope(challenge, 'secret', {crypto: webcrypto});
  const result = await session.ingress.admitMetadataPassword({runtimeContext: session.trusted, envelope});
  assert.deepEqual(plain(result), {ok: true, result: {password: 'bounded-password'}});
});

await test('metadata Generate challenge and envelope have exact bounded public schemas', async () => {
  const session = await makeMetadataSession();
  const binding = Object.freeze({accountGeneration: 1, accountDataRevision: 2, sourceOrdinal: 0, ownerRecord: {id: 'svc'}});
  const challenge = await session.ingress.issueChallenge({runtimeContext: session.trusted, purpose: KG.METADATA_GENERATE_PROTOCOL, selectionBinding: binding, fillEmail: false});
  assert.deepEqual(Object.keys(challenge), ['protocol', 'challengeId', 'requestId', 'popupSessionNonce', 'workerIncarnation', 'publicKeySpki', 'publicKeySha256']);
  assert.equal(challenge.protocol, KG.METADATA_GENERATE_PROTOCOL);
  assert.equal(challenge.challengeId.length, 43);
  assert.equal(challenge.publicKeySha256.length, 64);
  assert.equal(Object.prototype.hasOwnProperty.call(challenge, 'privateKey'), false);
  const envelope = await KG.makeMetadataEnvelope(challenge, 'correct horse', {crypto: webcrypto, iv: new Uint8Array(12), aesKey: new Uint8Array(32).fill(7)});
  assert.deepEqual(Object.keys(envelope), ['type', 'envelopeText']);
  assert.equal(envelope.type, 'METADATA_PASSWORD');
  assert.doesNotMatch(envelope.envelopeText, /correct horse|svc|accountGeneration/);
  assert.deepEqual(Object.keys(JSON.parse(envelope.envelopeText)), ['protocol', 'challengeId', 'requestId', 'popupSessionNonce', 'workerIncarnation', 'publicKeySha256', 'iv', 'wrappedKey', 'ciphertext']);
  assert.equal(new TextEncoder().encode(envelope.envelopeText).byteLength <= 65536, true);
});

await test('metadata Generate admits only the bound runtime/purpose and consumes exactly once', async () => {
  const session = await makeMetadataSession();
  const binding = {recordIdentity: {}, tuple: {id: 'svc'}};
  const challenge = await session.ingress.issueChallenge({runtimeContext: session.trusted, purpose: KG.METADATA_GENERATE_PROTOCOL, selectionBinding: binding, fillEmail: false});
  binding.tuple.id = 'attacker-selected';
  const envelope = await KG.makeMetadataEnvelope(challenge, 'secret', {crypto: webcrypto});
  const wrongRuntime = await session.ingress.admitMetadataPassword({runtimeContext: Symbol('wrong'), envelope});
  assert.deepEqual(plain(wrongRuntime), {ok: false, code: 'KEYGRAIN_CONTEXT_ERROR'});
  assert.equal(session.calls.length, 0);
  const accepted = await session.ingress.admitMetadataPassword({runtimeContext: session.trusted, envelope});
  assert.deepEqual(plain(accepted), {ok: true, result: {password: 'bounded-password'}});
  assert.equal(session.calls.length, 1);
  assert.equal(session.calls[0].secret, 'secret');
  assert.equal(session.calls[0].purpose, KG.METADATA_GENERATE_PROTOCOL);
  assert.equal(session.calls[0].fillEmail, false);
  assert.notEqual(session.calls[0].selectionBinding, binding);
  assert.equal(session.calls[0].selectionBinding.tuple.id, 'svc');
  assert.equal(Object.isFrozen(session.calls[0].selectionBinding), true);
  assert.equal(Object.isFrozen(session.calls[0].selectionBinding.tuple), true);
  const replay = await session.ingress.admitMetadataPassword({runtimeContext: session.trusted, envelope});
  assert.deepEqual(plain(replay), {ok: false, code: 'KEYGRAIN_STALE_OPERATION'});
});

await test('metadata Fill has a distinct protocol and authenticated fillEmail binding', async () => {
  const session = await makeMetadataSession({value: 0}, input => ({ok: true, result: {passwordFilled: true, emailFilled: input.fillEmail}}));
  const challenge = await session.ingress.issueChallenge({runtimeContext: session.trusted, purpose: KG.METADATA_FILL_PROTOCOL, selectionBinding: Object.freeze({ordinal: 1}), fillEmail: true});
  assert.equal(challenge.protocol, KG.METADATA_FILL_PROTOCOL);
  const envelope = await KG.makeMetadataEnvelope(challenge, 'secret', {crypto: webcrypto});
  const result = await session.ingress.admitMetadataPassword({runtimeContext: session.trusted, envelope});
  assert.deepEqual(plain(result), {ok: true, result: {passwordFilled: true, emailFilled: true}});
  assert.equal(session.calls[0].fillEmail, true);
  assert.equal(session.calls[0].purpose, KG.METADATA_FILL_PROTOCOL);
});

await test('metadata AAD/protocol tampering, wrong outer type, and exact TTL fail closed', async () => {
  const nowRef = {value: 0};
  const session = await makeMetadataSession(nowRef);
  const challenge = await session.ingress.issueChallenge({runtimeContext: session.trusted, purpose: KG.METADATA_GENERATE_PROTOCOL, selectionBinding: Object.freeze({ordinal: 0}), fillEmail: false});
  const envelope = await KG.makeMetadataEnvelope(challenge, 'secret', {crypto: webcrypto});
  const object = JSON.parse(envelope.envelopeText);
  object.requestId = object.challengeId;
  const tampered = {type: 'METADATA_PASSWORD', envelopeText: JSON.stringify(object)};
  const stale = await session.ingress.admitMetadataPassword({runtimeContext: session.trusted, envelope: tampered});
  assert.deepEqual(plain(stale), {ok: false, code: 'KEYGRAIN_STALE_OPERATION'});
  assert.equal(session.calls.length, 0);
  const replay = await session.ingress.admitMetadataPassword({runtimeContext: session.trusted, envelope});
  assert.deepEqual(plain(replay), {ok: false, code: 'KEYGRAIN_STALE_OPERATION'});

  const expiredNow = {value: 0};
  const expiredSession = await makeMetadataSession(expiredNow);
  const expiredChallenge = await expiredSession.ingress.issueChallenge({runtimeContext: expiredSession.trusted, purpose: KG.METADATA_GENERATE_PROTOCOL, selectionBinding: Object.freeze({}), fillEmail: false});
  const expiredEnvelope = await KG.makeMetadataEnvelope(expiredChallenge, 'secret', {crypto: webcrypto});
  expiredNow.value = 30000;
  const expired = await expiredSession.ingress.admitMetadataPassword({runtimeContext: expiredSession.trusted, envelope: expiredEnvelope});
  assert.deepEqual(plain(expired), {ok: false, code: 'KEYGRAIN_STALE_OPERATION'});
  const wrongType = await expiredSession.ingress.admitMetadataPassword({runtimeContext: expiredSession.trusted, envelope: {type: 'ENCRYPTED_UNLOCK', envelopeText: expiredEnvelope.envelopeText}});
  assert.deepEqual(plain(wrongType), {ok: false, code: 'KEYGRAIN_AUTH_PROTOCOL_ERROR'});
});

await test('metadata challenge is consumed before delayed decrypt and revoke blocks the callback', async () => {
  const releaseState = {started: false, resolve: null};
  const delayed = delayedDecryptCrypto(releaseState);
  const session = await makeMetadataSession({value: 0}, () => { throw new Error('callback must not run'); }, delayed);
  const challenge = await session.ingress.issueChallenge({runtimeContext: session.trusted, purpose: KG.METADATA_GENERATE_PROTOCOL, selectionBinding: Object.freeze({}), fillEmail: false});
  const envelope = await KG.makeMetadataEnvelope(challenge, 'secret', {crypto: webcrypto});
  const pending = session.ingress.admitMetadataPassword({runtimeContext: session.trusted, envelope});
  for (let index = 0; index < 20 && !releaseState.started; index++) await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  assert.equal(releaseState.started, true);
  session.ingress.revokeAll();
  releaseState.resolve();
  assert.deepEqual(plain(await pending), {ok: false, code: 'KEYGRAIN_STALE_OPERATION'});
  const replay = await session.ingress.admitMetadataPassword({runtimeContext: session.trusted, envelope});
  assert.deepEqual(plain(replay), {ok: false, code: 'KEYGRAIN_STALE_OPERATION'});
  assert.equal(session.calls.length, 0);
});

console.log(`${passed} tests: ${passed} passed, 0 failed`);
