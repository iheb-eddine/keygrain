import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = JSON.parse(readFileSync(resolve(root, 'sync-v3-preservation-vectors.json'), 'utf8'));
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  process.stdout.write(`✓ ${name}\n`);
}

function compareCodePoints(a, b) {
  const aa = Array.from(a, c => c.codePointAt(0));
  const bb = Array.from(b, c => c.codePointAt(0));
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return aa.length - bb.length;
}
function canonicalString(value) {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 8) out += '\\b'; else if (code === 9) out += '\\t';
    else if (code === 10) out += '\\n'; else if (code === 12) out += '\\f';
    else if (code === 13) out += '\\r'; else if (code === 34) out += '\\"';
    else if (code === 92) out += '\\\\'; else if (code <= 31) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : -1;
      if (next >= 0xdc00 && next <= 0xdfff) out += value[i++] + value[i];
      else out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else if (code >= 0xdc00 && code <= 0xdfff) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += value[i];
  }
  return out + '"';
}
function canonicalJSON(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return canonicalString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') { assert.ok(Number.isSafeInteger(value)); return String(value); }
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  assert.equal(typeof value, 'object');
  return '{' + Object.keys(value).sort(compareCodePoints).map(k => canonicalString(k) + ':' + canonicalJSON(value[k])).join(',') + '}';
}
function canonicalPayload(payload) {
  const copy = {...payload};
  copy.services = [...payload.services].sort((a, b) => compareCodePoints(a.id ?? '', b.id ?? ''));
  copy.wallets = [...payload.wallets].sort((a, b) => compareCodePoints(
    `${(a.wallet_name ?? '').toLowerCase()}:${(a.chain ?? '').toLowerCase()}`,
    `${(b.wallet_name ?? '').toLowerCase()}:${(b.chain ?? '').toLowerCase()}`));
  copy.wallet_audit_log = [...payload.wallet_audit_log].sort((a, b) => compareCodePoints(
    `${a.timestamp}\u0000${a.wallet_name}\u0000${a.chain}\u0000${a.action}`,
    `${b.timestamp}\u0000${b.wallet_name}\u0000${b.chain}\u0000${b.action}`));
  copy.sync_conflicts = [...payload.sync_conflicts].sort((a, b) => compareCodePoints(a.conflict_id, b.conflict_id));
  return canonicalJSON(copy);
}
function allKeys(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach(v => allKeys(v, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => { out.add(k); allKeys(v, out); });
  return out;
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function aadHex(envelope) {
  return Buffer.from(`keygrain-sync-v3\0${envelope.lookup_id}\0${envelope.defaults_state}\0${envelope.defaults_commitment ?? ''}`, 'utf8').toString('hex');
}
function etag(envelope) {
  const state = {UNSEALED: 0, ABSENT: 1, PRESENT: 2}[envelope.defaults_state];
  const commitment = Buffer.from(envelope.defaults_commitment ?? '', 'ascii');
  const blob = Buffer.from(envelope.blob_hex, 'hex');
  const result = Buffer.concat([Buffer.from('keygrain-sync-v3-etag\0'), Buffer.from([0, 0, 0, 3]),
    (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(envelope.generation)); return b; })(), Buffer.from([state]),
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(commitment.length); return b; })(), commitment,
    (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(blob.length)); return b; })(), blob]);
  return sha256(result).slice(0, 32);
}

await test('fixture declares future contract rather than runtime support', () => {
  assert.equal(fixture.fixture, 'keygrain-sync-v3-preservation-contract');
  assert.equal(fixture.fixture_version, 1);
  assert.equal(fixture.status, 'frozen_public_contract_not_runtime_support_claim');
  assert.equal(fixture.runtime_support, false);
  assert.equal(fixture.cases.length, 2);
});
await test('partitions are exact and disjoint', () => {
  const p = fixture.partitions;
  assert.deepEqual(p.encrypted_plaintext, ['version', 'services', 'wallets', 'wallet_audit_log', 'account_defaults', 'sync_conflicts']);
  assert.equal(new Set([...p.encrypted_plaintext, ...p.envelope_only, ...p.local_only]).size,
    p.encrypted_plaintext.length + p.envelope_only.length + p.local_only.length);
});
await test('payload keys and version are explicit', () => {
  const expected = new Set(fixture.partitions.encrypted_plaintext);
  for (const c of fixture.cases) {
    assert.deepEqual(new Set(Object.keys(c.encrypted_plaintext_source)), expected);
    assert.equal(c.encrypted_plaintext_source.version, 3);
    assert.equal(Object.prototype.hasOwnProperty.call(c.encrypted_plaintext_source, 'account_defaults'), true);
    for (const service of c.encrypted_plaintext_source.services) {
      assert.ok(['explicit', 'snapshot'].includes(service.defaults_mode));
      assert.ok(service.defaults_revision === null || Number.isSafeInteger(service.defaults_revision));
    }
  }
});
await test('independent canonical bytes match literal UTF-8 and hex', () => {
  for (const c of fixture.cases) {
    const actual = canonicalPayload(c.encrypted_plaintext_source);
    assert.equal(actual, c.expected_canonical_utf8, c.name);
    assert.equal(Buffer.from(actual, 'utf8').toString('hex'), c.expected_canonical_hex, c.name);
    assert.equal(/[\u0000-\u001f]/.test(actual), false, c.name);
  }
});
await test('PRESENT retains exactly four semantic defaults fields', () => {
  const c = fixture.cases[0];
  assert.deepEqual(Object.keys(c.encrypted_plaintext_source.account_defaults).sort(), ['length', 'policy', 'schema', 'symbols']);
  assert.equal(c.server_envelope.defaults_state, 'PRESENT');
  assert.match(c.server_envelope.defaults_commitment, /^[0-9a-f]{64}$/);
  const semanticKeys = ['length', 'policy', 'schema', 'symbols'];
  const conflict = c.encrypted_plaintext_source.sync_conflicts[0];
  for (const side of ['base', 'local', 'remote']) assert.deepEqual(Object.keys(conflict[side]).sort(), semanticKeys);
});
await test('ABSENT retains explicit null rather than omitting defaults', () => {
  const c = fixture.cases[1];
  assert.equal(c.encrypted_plaintext_source.account_defaults, null);
  assert.equal(c.server_envelope.defaults_state, 'ABSENT');
  assert.equal(c.server_envelope.defaults_commitment, null);
  assert.match(c.expected_canonical_utf8, /"account_defaults":null/);
});
await test('independent envelope AAD checksum and ETag match literals', () => {
  for (const c of fixture.cases) {
    const e = c.server_envelope;
    assert.equal(e.payload_version, 3);
    assert.equal(e.writer_protocol, 3);
    assert.equal(e.min_writer_protocol, 3);
    assert.deepEqual(e.capabilities, ['account_defaults_immutable_v1']);
    assert.equal(e.aad_hex, aadHex(e), c.name);
    assert.equal(e.checksum, sha256(Buffer.from(e.blob_hex, 'hex')), c.name);
    assert.equal(e.etag, etag(e), c.name);
  }
});
await test('envelope and local-only fields are absent from payload keys', () => {
  const forbidden = new Set([...fixture.partitions.envelope_only, ...fixture.partitions.local_only]);
  for (const c of fixture.cases) {
    for (const key of allKeys(c.encrypted_plaintext_source)) assert.equal(forbidden.has(key), false, `${c.name}: ${key}`);
  }
});
await test('escaping edge includes controls, U+2028/U+2029, supplementary Unicode, and lone surrogate', () => {
  const expected = fixture.cases[0].expected_canonical_utf8;
  for (const token of ['\\b', '\\t', '\\n', '\\f', '\\r', '\u2028', '\u2029', '😀', '\\ud800']) assert.ok(expected.includes(token), token);
});

process.stdout.write(`${passed} passed\n`);
