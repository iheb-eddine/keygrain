#!/usr/bin/env node
// gen-sync-vectors.mjs — Generate a cross-platform sync fixture using the ACTUAL
// extension JavaScript (extension/shared/{keygrain,sync,totp,ssh}.js) as an
// INDEPENDENT oracle. The Python CLI sync->cache->get path is then verified
// against this fixture end-to-end (see python/tests/test_sync_vectors.py).
//
// Same vm.runInContext pattern as ci/cross-platform-derive.mjs: the vendored
// Argon2id WASM + tweetnacl run in Node; no reimplementation of any crypto.
//
// The fixture is a PUBLIC, throwaway test account (secret "my-master-secret",
// as used in vectors.json). Publishing these values in the clear is intentional.
//
// Usage:  node ci/gen-sync-vectors.mjs [--check]
//   (no flag)  write python/tests/sync-vectors.json
//   --check    regenerate deterministic derivations and diff against the
//              committed fixture (the AES-GCM blob uses a random IV, so only the
//              deterministic fields are diffed).

import { createContext, runInContext } from 'node:vm';
import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const shared = resolve(root, 'extension', 'shared');
const OUT = resolve(root, 'python', 'tests', 'sync-vectors.json');

// --- Public throwaway test account + service set -----------------------------
const SECRET = 'my-master-secret';
const EMAIL = 'test-cli@keygrain.example';
const SYMBOLS = '!@#$%&*-_=+?'; // extension DEFAULT_SYMBOLS
// updated_at values are arbitrary but fixed; ids are real UUID-shaped strings.
const SERVICE_DEFS = [
  { id: '11111111-1111-4111-8111-111111111111', updated_at: 1000,
    kind: 'password', name: 'GitHub', site: 'github.com', email: EMAIL,
    length: 20, symbols: SYMBOLS, counter: 1 },
  // Two services sharing one site, different service-emails (--service-email).
  { id: '22222222-2222-4222-8222-222222222222', updated_at: 1001,
    kind: 'password', name: 'Shared A', site: 'shared.example',
    email: 'alice@keygrain.example', length: 24, symbols: SYMBOLS, counter: 1 },
  { id: '33333333-3333-4333-8333-333333333333', updated_at: 1002,
    kind: 'password', name: 'Shared B', site: 'shared.example',
    email: 'bob@keygrain.example', length: 16, symbols: SYMBOLS, counter: 2 },
  { id: '44444444-4444-4444-8444-444444444444', updated_at: 1003,
    kind: 'totp', name: 'TOTP Service', site: 'totp.example', email: EMAIL,
    totp: { mode: 'derived', digits: 6, period: 30, algorithm: 'SHA1' } },
  { id: '55555555-5555-4555-8555-555555555555', updated_at: 1004,
    kind: 'ssh', name: 'SSH Service', site: 'ssh.example', email: EMAIL,
    ssh: { key_name: 'github', counter: 1 } },
];

// --- Build the extension JS context (vendored libs, no reimplementation) -----
const ctx = createContext({
  crypto: webcrypto,
  TextEncoder, TextDecoder,
  console,
  Uint8Array, DataView, BigInt, Math, parseInt, Number, String, Array, Object, Error,
  ArrayBuffer, Promise, Date, setTimeout, clearTimeout,
  btoa, atob,
  globalThis: undefined,
});
// hashwasm attaches to globalThis; tweetnacl attaches nacl to self.
runInContext('globalThis = this; self = this;', ctx);
runInContext(readFileSync(resolve(shared, 'lib', 'hash-wasm-argon2.js'), 'utf8'), ctx);
runInContext(readFileSync(resolve(shared, 'lib', 'tweetnacl.js'), 'utf8'), ctx);
runInContext(readFileSync(resolve(shared, 'keygrain.js'), 'utf8'), ctx);
runInContext(readFileSync(resolve(shared, 'sync.js'), 'utf8'), ctx);
runInContext(readFileSync(resolve(shared, 'totp.js'), 'utf8'), ctx);
runInContext(readFileSync(resolve(shared, 'ssh.js'), 'utf8'), ctx);

// Everything runs inside the context so the loaded extension functions are used.
const script = `(async () => {
  const secret = ${JSON.stringify(SECRET)};
  const email = ${JSON.stringify(EMAIL)};
  const defs = ${JSON.stringify(SERVICE_DEFS)};
  const hex = (u8) => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');

  const lookupId = await deriveLookupId(secret, email);
  const authPassword = await deriveAuthPassword(secret, email);
  const encKey = await deriveEncryptionKey(secret, email); // Uint8Array

  // Per-service expected outputs (extension-computed reference).
  const services = [];
  for (const d of defs) {
    const svc = { id: d.id, updated_at: d.updated_at, name: d.name, site: d.site, email: d.email };
    const expected = {};
    if (d.kind === 'password') {
      svc.length = d.length; svc.symbols = d.symbols; svc.counter = d.counter;
      expected.password = await derivePassword(secret, d.email,
        { site: d.site, length: d.length, symbols: d.symbols, counter: d.counter });
    } else if (d.kind === 'totp') {
      svc.totp = d.totp;
      const seed = await deriveTOTPSeed(secret, d.email, d.site); // Uint8Array
      expected.totp_seed_hex = hex(seed);
    } else if (d.kind === 'ssh') {
      svc.ssh = d.ssh;
      const { publicKey } = await deriveSshKeypair(secret, d.email,
        { keyName: d.ssh.key_name, counter: d.ssh.counter });
      const comment = d.email.toLowerCase() + ':' + d.ssh.key_name.toLowerCase();
      expected.ssh_authorized_keys = formatAuthorizedKeys(publicKey, comment);
    }
    svc.expected = expected;
    services.push(svc);
  }

  // Server blob: content services carry NO id/updated_at/expected (matches server).
  const blobServices = services.map(({ id, updated_at, expected, ...content }) => content);
  const blobContent = { services: blobServices, wallets: [], wallet_audit_log: [], sync_conflicts: [] };
  const plaintext = new TextEncoder().encode(JSON.stringify(blobContent));
  const aad = new TextEncoder().encode(lookupId);
  const encrypted = await encryptBlob(encKey, plaintext, aad); // iv||ct||tag
  const encryptedB64 = arrayBufferToBase64(encrypted);
  const checksum = await sha256Hex(encrypted);

  // Top-level metadata (unauthenticated, id + updated_at only) — like the server.
  const metadata = services.map(s => ({ id: s.id, updated_at: s.updated_at }));

  return {
    secret, email,
    lookup_id: lookupId,
    auth_password: authPassword,
    encryption_key_hex: hex(encKey),
    server_response: { version: 1, services: metadata, encrypted_blob: encryptedB64, checksum },
    services,
  };
})()`;

const result = await runInContext(script, ctx);

const fixture = {
  _comment: 'PUBLIC throwaway cross-platform test account. Generated by ci/gen-sync-vectors.mjs '
    + 'using the extension JS as an independent oracle. Do NOT reuse this secret for real data.',
  ...result,
};

const check = process.argv.includes('--check');
if (check) {
  const committed = JSON.parse(readFileSync(OUT, 'utf8'));
  const det = (f) => ({
    secret: f.secret, email: f.email, lookup_id: f.lookup_id,
    auth_password: f.auth_password, encryption_key_hex: f.encryption_key_hex,
    services: f.services,
  });
  const a = JSON.stringify(det(fixture));
  const b = JSON.stringify(det(committed));
  if (a !== b) {
    process.stderr.write('DRIFT: regenerated deterministic derivations differ from committed fixture.\n');
    process.exit(1);
  }
  process.stderr.write('\u2713 sync-vectors deterministic derivations match committed fixture\n');
} else {
  writeFileSync(OUT, JSON.stringify(fixture, null, 2) + '\n');
  process.stderr.write('\u2713 wrote ' + OUT + '\n');
}
