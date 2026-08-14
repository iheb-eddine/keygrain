// Generate/check the KG-29 v3 preservation contract fixture.
// Usage: node ci/gen-sync-v3-preservation-vectors.mjs [--check]
//
// This generator intentionally does not import a production serializer. The expected
// canonical strings below are contract literals; the local oracle only checks that the
// source cases agree with those literals before rendering the checked-in fixture.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const OUT = resolve(root, 'sync-v3-preservation-vectors.json');

const SPECIAL = 'quote " slash \\ backspace \b tab \t line\nfeed\f return\r U+2028 \u2028 U+2029 \u2029 😀 ' + String.fromCharCode(0xd800);
const LOOKUP_ID = '0123456789abcdef'.repeat(4);
const COMMITMENT = 'ab'.repeat(32);

function compareCodePoints(a, b) {
  const aa = Array.from(a, c => c.codePointAt(0));
  const bb = Array.from(b, c => c.codePointAt(0));
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return aa.length - bb.length;
}

function canonicalString(value) {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x08) out += '\\b';
    else if (code === 0x09) out += '\\t';
    else if (code === 0x0a) out += '\\n';
    else if (code === 0x0c) out += '\\f';
    else if (code === 0x0d) out += '\\r';
    else if (code === 0x22) out += '\\"';
    else if (code === 0x5c) out += '\\\\';
    else if (code <= 0x1f) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : -1;
      if (next >= 0xdc00 && next <= 0xdfff) out += value[i++] + value[i];
      else out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else out += value[i];
  }
  return out + '"';
}

function canonicalJSON(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return canonicalString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('non-safe integer in contract fixture');
    return String(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort(compareCodePoints)
      .map(key => canonicalString(key) + ':' + canonicalJSON(value[key])).join(',') + '}';
  }
  throw new Error('unsupported value in contract fixture');
}

function sortCasesPayload(payload) {
  const clone = {...payload};
  clone.services = [...payload.services].sort((a, b) => compareCodePoints(a.id ?? '', b.id ?? ''));
  clone.wallets = [...payload.wallets].sort((a, b) =>
    compareCodePoints((a.wallet_name ?? '').toLowerCase() + ':' + (a.chain ?? '').toLowerCase(),
      (b.wallet_name ?? '').toLowerCase() + ':' + (b.chain ?? '').toLowerCase()));
  clone.wallet_audit_log = [...payload.wallet_audit_log].sort((a, b) =>
    compareCodePoints(`${a.timestamp}\u0000${a.wallet_name}\u0000${a.chain}\u0000${a.action}`,
      `${b.timestamp}\u0000${b.wallet_name}\u0000${b.chain}\u0000${b.action}`));
  clone.sync_conflicts = [...payload.sync_conflicts].sort((a, b) => compareCodePoints(a.conflict_id, b.conflict_id));
  return clone;
}

function canonicalPayload(payload) {
  const ordered = sortCasesPayload(payload);
  return canonicalJSON(ordered);
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function aadHex(envelope) {
  const commitment = envelope.defaults_commitment ?? '';
  return Buffer.from(`keygrain-sync-v3\0${envelope.lookup_id}\0${envelope.defaults_state}\0${commitment}`, 'utf8').toString('hex');
}

function etag(envelope) {
  const state = {UNSEALED: 0, ABSENT: 1, PRESENT: 2}[envelope.defaults_state];
  const commitment = Buffer.from(envelope.defaults_commitment ?? '', 'ascii');
  const blob = Buffer.from(envelope.blob_hex, 'hex');
  const parts = [
    Buffer.from('keygrain-sync-v3-etag\0', 'utf8'),
    Buffer.alloc(4), Buffer.alloc(8), Buffer.from([state]), Buffer.alloc(4),
    commitment, Buffer.alloc(8), blob
  ];
  parts[1].writeUInt32BE(3);
  parts[2].writeBigUInt64BE(BigInt(envelope.generation));
  parts[4].writeUInt32BE(commitment.length);
  parts[6].writeBigUInt64BE(BigInt(blob.length));
  return sha256Hex(Buffer.concat(parts)).slice(0, 32);
}

const PRESENT_PAYLOAD = {
  version: 3,
  sync_conflicts: [{
    status: 'unresolved',
    remote: {policy: 'ascii-printable-v1', schema: 1, symbols: '!@#$%&*-_=+?', length: 24},
    detected_at: 123,
    kind: 'account_defaults',
    conflict_id: '0000000000000000000000000000000000000000000000000000000000000001',
    base: {schema: 1, length: 20, symbols: '!@#$%&*-_=+?', policy: 'ascii-printable-v1'},
    local: {schema: 1, length: 22, symbols: '!@#$%&*-_=+?', policy: 'ascii-printable-v1'},
    resolution: null,
    resolved: null
  }],
  wallet_audit_log: [
    {action: 'rotate', wallet_name: 'Main', chain: 'ethereum', counter: 2, timestamp: 20, verification: 'ok'},
    {action: 'create', wallet_name: 'main', chain: 'Bitcoin', counter: 1, timestamp: 10, verification: SPECIAL}
  ],
  wallets: [
    {notes: SPECIAL, updated_at: 4, wallet_name: 'Zed', chain: 'bitcoin', counter: 1, email: 'wallet@example.test', mode: 'keygrain', created_at: 3},
    {notes: '', updated_at: 2, wallet_name: 'main', chain: 'Ethereum', counter: 2, email: '', mode: 'keygrain', created_at: 1}
  ],
  services: [
    {ssh: null, name: 'B', site: 'b.example', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'b@example.test', length: 24, symbols: '!@#$%', counter: 2, updated_at: 20, defaults_mode: 'snapshot', defaults_revision: 4, migrating: true, totp: {z: [true, null, 7], nested: {z: 'last', a: 'first'}, a: SPECIAL}},
    {ssh: null, name: 'A', site: 'a.example', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'a@example.test', length: 20, symbols: '!@#$%', counter: 1, updated_at: 19, defaults_mode: 'explicit', defaults_revision: null, migrating: null, totp: null}
  ],
  account_defaults: {policy: 'ascii-printable-v1', symbols: '!@#$%&*-_=+?', length: 20, schema: 1}
};

const ABSENT_PAYLOAD = {
  wallets: [],
  version: 3,
  account_defaults: null,
  services: [{id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', updated_at: 1, name: 'No defaults', site: 'absent.example', email: 'absent@example.test', length: 20, symbols: '!@', counter: 1, defaults_mode: 'explicit', defaults_revision: null, migrating: null, totp: null, ssh: null}],
  wallet_audit_log: [],
  sync_conflicts: []
};

// These are deliberately literal contract expectations, not generated by a production serializer.
const CASES = [
  {
    name: 'present-defaults-with-conflict-and-escaping',
    payload: PRESENT_PAYLOAD,
    expected_canonical_utf8: String.raw`{"account_defaults":{"length":20,"policy":"ascii-printable-v1","schema":1,"symbols":"!@#$%&*-_=+?"},"services":[{"counter":1,"defaults_mode":"explicit","defaults_revision":null,"email":"a@example.test","id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","length":20,"migrating":null,"name":"A","site":"a.example","ssh":null,"symbols":"!@#$%","totp":null,"updated_at":19},{"counter":2,"defaults_mode":"snapshot","defaults_revision":4,"email":"b@example.test","id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","length":24,"migrating":true,"name":"B","site":"b.example","ssh":null,"symbols":"!@#$%","totp":{"a":"quote \" slash \\ backspace \b tab \t line\nfeed\f return\r U+2028   U+2029   😀 \ud800","nested":{"a":"first","z":"last"},"z":[true,null,7]},"updated_at":20}],"sync_conflicts":[{"base":{"length":20,"policy":"ascii-printable-v1","schema":1,"symbols":"!@#$%&*-_=+?"},"conflict_id":"0000000000000000000000000000000000000000000000000000000000000001","detected_at":123,"kind":"account_defaults","local":{"length":22,"policy":"ascii-printable-v1","schema":1,"symbols":"!@#$%&*-_=+?"},"remote":{"length":24,"policy":"ascii-printable-v1","schema":1,"symbols":"!@#$%&*-_=+?"},"resolution":null,"resolved":null,"status":"unresolved"}],"version":3,"wallet_audit_log":[{"action":"create","chain":"Bitcoin","counter":1,"timestamp":10,"verification":"quote \" slash \\ backspace \b tab \t line\nfeed\f return\r U+2028   U+2029   😀 \ud800","wallet_name":"main"},{"action":"rotate","chain":"ethereum","counter":2,"timestamp":20,"verification":"ok","wallet_name":"Main"}],"wallets":[{"chain":"Ethereum","counter":2,"created_at":1,"email":"","mode":"keygrain","notes":"","updated_at":2,"wallet_name":"main"},{"chain":"bitcoin","counter":1,"created_at":3,"email":"wallet@example.test","mode":"keygrain","notes":"quote \" slash \\ backspace \b tab \t line\nfeed\f return\r U+2028   U+2029   😀 \ud800","updated_at":4,"wallet_name":"Zed"}]}`,

    envelope: {payload_version: 3, writer_protocol: 3, min_writer_protocol: 3, capabilities: ['account_defaults_immutable_v1'], defaults_state: 'PRESENT', defaults_commitment: COMMITMENT, generation: 7, lookup_id: LOOKUP_ID, blob_hex: '00010203040506070809', checksum: '__GENERATE__'},
    local_only: {tombstones: [{id: 'local-only'}], deletion_review: [{id: 'review-only', deleted_at: 99}], security_settings: {version: 1, fullLeaseSeconds: 60}}
  },
  {
    name: 'absent-defaults-is-explicit-null',
    payload: ABSENT_PAYLOAD,
    expected_canonical_utf8: String.raw`{"account_defaults":null,"services":[{"counter":1,"defaults_mode":"explicit","defaults_revision":null,"email":"absent@example.test","id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","length":20,"migrating":null,"name":"No defaults","site":"absent.example","ssh":null,"symbols":"!@","totp":null,"updated_at":1}],"sync_conflicts":[],"version":3,"wallet_audit_log":[],"wallets":[]}`,

    envelope: {payload_version: 3, writer_protocol: 3, min_writer_protocol: 3, capabilities: ['account_defaults_immutable_v1'], defaults_state: 'ABSENT', defaults_commitment: null, generation: 8, lookup_id: LOOKUP_ID, blob_hex: 'f0e1d2c3b4a59687', checksum: '__GENERATE__'},
    local_only: {tombstones: [], deletion_review: [], security_settings: {version: 1, metadataTailSeconds: 14400}}
  }
];

function materializeCase(input) {
  const canonical = canonicalPayload(input.payload);
  if (input.expected_canonical_utf8.startsWith('__GENERATE')) {
    process.stderr.write(`EXPECTED ${input.name}: ${JSON.stringify(canonical)}\n`);
    return {name: input.name, expected_canonical_utf8: canonical};
  }
  if (canonical !== input.expected_canonical_utf8) throw new Error(`canonical literal mismatch: ${input.name}`);
  const canonicalBytes = Buffer.from(canonical, 'utf8');
  const envelope = {...input.envelope};
  envelope.aad_hex = aadHex(envelope);
  envelope.checksum = sha256Hex(Buffer.from(envelope.blob_hex, 'hex'));
  envelope.etag = etag(envelope);
  return {
    name: input.name,
    encrypted_plaintext_source: input.payload,
    server_envelope: envelope,
    local_only: input.local_only,
    expected_canonical_utf8: canonical,
    expected_canonical_hex: canonicalBytes.toString('hex')
  };
}

const fixture = {
  fixture: 'keygrain-sync-v3-preservation-contract',
  fixture_version: 1,
  status: 'frozen_public_contract_not_runtime_support_claim',
  runtime_support: false,
  scope: 'future v3 encrypted plaintext, strict envelope lock metadata, and local-only separation',
  partitions: {
    encrypted_plaintext: ['version', 'services', 'wallets', 'wallet_audit_log', 'account_defaults', 'sync_conflicts'],
    envelope_only: ['payload_version', 'writer_protocol', 'min_writer_protocol', 'capabilities', 'defaults_state', 'defaults_commitment', 'generation', 'lookup_id', 'blob_hex', 'checksum', 'aad_hex', 'etag'],
    local_only: ['tombstones', 'deletion_review', 'security_settings']
  },
  canonical_rules: {
    encoding: 'UTF-8',
    objects: 'keys sorted by Unicode code point recursively',
    whitespace: 'none',
    numbers: 'finite safe integers in decimal',
    arrays: 'services by id (null as empty); wallets by lowercase wallet_name:chain; audit by timestamp, wallet_name, chain, action; conflicts by conflict_id',
    absent_defaults: 'account_defaults is required in the payload and is JSON null for ABSENT; omission is not equivalent'
  },
  cases: CASES.map(materializeCase)
};

const rendered = JSON.stringify(fixture, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(OUT, 'utf8') !== rendered) {
    process.stderr.write('DRIFT: sync-v3-preservation-vectors.json differs from deterministic generator.\n');
    process.exit(1);
  }
  process.stderr.write('✓ sync-v3-preservation-vectors.json matches deterministic generator\n');
} else {
  writeFileSync(OUT, rendered);
  process.stderr.write(`✓ wrote ${OUT} (${sha256Hex(Buffer.from(rendered, 'utf8'))})\n`);
}
