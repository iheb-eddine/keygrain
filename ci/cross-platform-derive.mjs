#!/usr/bin/env node
// Derive passwords for specified vector indices. Prints passwords to stdout, status to stderr.
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const shared = resolve(root, 'extension', 'shared');

const ctx = createContext({
  crypto: webcrypto,
  TextEncoder, TextDecoder,
  console,
  Uint8Array, DataView, BigInt, Math, parseInt, Number, String, Array, Object, Error,
  ArrayBuffer, Promise, Date, setTimeout, clearTimeout,
  globalThis: undefined,
});
runInContext('globalThis = this;', ctx);
runInContext(readFileSync(resolve(shared, 'lib', 'hash-wasm-argon2.js'), 'utf8'), ctx);
runInContext(readFileSync(resolve(shared, 'keygrain.js'), 'utf8'), ctx);

const vectors = JSON.parse(readFileSync(resolve(root, 'vectors.json'), 'utf8')).vectors;
const indices = process.argv.slice(2).map(Number);

for (const idx of indices) {
  const v = vectors[idx];
  const pw = await runInContext(
    `derivePassword(${JSON.stringify(v.secret_utf8)}, ${JSON.stringify(v.email)}, ${JSON.stringify({ site: v.site, length: v.length, symbols: v.symbols, counter: v.counter })})`,
    ctx
  );
  if (pw !== v.expected) {
    process.stderr.write(`✗ [js] vectors[${idx}] mismatch: got ${JSON.stringify(pw)}, expected ${JSON.stringify(v.expected)}\n`);
    process.exit(1);
  }
  process.stderr.write(`✓ [js] vectors[${idx}] ${v.site} len=${v.length}: ${pw}\n`);
  process.stdout.write(pw + '\n');
}
