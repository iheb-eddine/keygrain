// Generate the shared KG-22 canonical JSON fixture from the actual extension serializer.
// Usage: node ci/gen-sync-canonical-vectors.mjs [--check]

import { createContext, runInContext } from 'node:vm';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const OUT = resolve(root, 'sync-canonical-vectors.json');
const shared = resolve(root, 'extension', 'shared');

const ctx = createContext({
  Array, Boolean, Error, JSON, Map, Math, Number, Object, Promise, RegExp, String,
  Uint8Array, console
});
runInContext(readFileSync(resolve(shared, 'sync.js'), 'utf8'), ctx);

// Keep the source values in this generator rather than hand-writing expected strings. The
// expected field is produced by the real extension implementation and then checked into the
// one shared fixture consumed by both runtimes.
const loneSurrogate = String.fromCharCode(0xd800);
const special = 'punctuation \u2000\u2028\u2029 </ " \\ \b \t \n \f \r 😀 ' + loneSurrogate;

const CASES = [
  {
    name: 'service-wallet-audit-conflict-edge-values',
    services: [
      {
        metadata: {id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', updated_at: 200},
        content: {
          name: special,
          site: 'b.example',
          email: 'b@example.test',
          length: 24,
          symbols: '!@#$%',
          counter: 2,
          // Deliberately non-canonical key order and nested arrays/objects.
          totp: {z: [true, null, 7], nested: {z: 'last', a: 'first'}, a: special},
          migrating: true
        }
      },
      {
        metadata: {id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', updated_at: 199},
        content: {
          name: 'Defaults',
          site: 'a.example',
          email: 'a@example.test',
          length: 20,
          symbols: '!@#$%',
          counter: 1
          // Absent totp/ssh/migrating become canonical null values where applicable.
        }
      }
    ],
    wallets: [
      {
        wallet_name: 'Z' + loneSurrogate,
        chain: 'bitcoin',
        counter: 1,
        email: 'wallet@example.test',
        mode: 'keygrain',
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-03T00:00:00Z',
        notes: special
      },
      {
        wallet_name: 'a',
        chain: 'ethereum',
        counter: 3,
        email: '',
        mode: 'keygrain',
        created_at: '',
        updated_at: '',
        notes: ''
      }
    ],
    audit_log: [
      {
        action: 'create', wallet_name: 'Z', chain: 'bitcoin', counter: 1,
        timestamp: '2026-01-03T00:00:00Z', verification: special
      },
      {
        action: 'rotate', wallet_name: 'a', chain: 'ethereum', counter: 3,
        timestamp: '2026-01-02T00:00:00Z', verification: 'ok'
      }
    ],
    sync_conflicts: [
      {
        winner_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        loser: {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: special,
          extra: {z: [3, 2, 1], a: true}
        },
        detected_at: '2026-01-04T00:00:00Z'
      }
    ]
  }
];

function canonicalCase(testCase) {
  ctx._services = testCase.services.map(s => s.content);
  ctx._metadata = testCase.services.map(s => s.metadata);
  ctx._wallets = testCase.wallets;
  ctx._audit = testCase.audit_log;
  ctx._conflicts = testCase.sync_conflicts;
  return runInContext(
    'canonicalBlobPayload(_services, _metadata, _wallets, _audit, _conflicts)', ctx
  );
}

const fixture = {
  schema_version: 1,
  _comment: 'KG-22 shared canonical JSON fixture. Generated from extension/shared/sync.js; do not hand-edit.',
  cases: CASES.map(testCase => ({
    name: testCase.name,
    services: testCase.services,
    wallets: testCase.wallets,
    audit_log: testCase.audit_log,
    sync_conflicts: testCase.sync_conflicts,
    expected: canonicalCase(testCase)
  }))
};

const rendered = JSON.stringify(fixture, null, 2) + '\n';
if (process.argv.includes('--check')) {
  const committed = readFileSync(OUT, 'utf8');
  if (committed !== rendered) {
    process.stderr.write('DRIFT: regenerated sync-canonical-vectors.json differs from committed fixture.\n');
    process.exit(1);
  }
  process.stderr.write('✓ sync-canonical-vectors.json matches deterministic generator\n');
} else {
  writeFileSync(OUT, rendered);
  const digest = createHash('sha256').update(rendered).digest('hex');
  process.stderr.write(`✓ wrote ${OUT} (${digest})\n`);
}
