// test-strengthen-slow.mjs — Real Argon2id slow-path test (no mocks)
import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = resolve(__dirname, '..', 'shared');
const root = resolve(__dirname, '..', '..');

// Build VM context with real WebAssembly (no mock hashwasm)
const ctx = createContext({
  crypto: webcrypto,
  TextEncoder, TextDecoder,
  console,
  Uint8Array, DataView, BigInt, Math, parseInt, Number, String, Array, Object, Error,
  ArrayBuffer, Promise, Date, setTimeout, clearTimeout,
  globalThis: undefined, // will be set to the sandbox itself
});
// Set globalThis to the sandbox so UMD assigns hashwasm there
runInContext('globalThis = this;', ctx);

// Load hash-wasm-argon2.js (UMD assigns to globalThis.hashwasm)
const hashwasmSrc = readFileSync(resolve(shared, 'lib', 'hash-wasm-argon2.js'), 'utf8');
runInContext(hashwasmSrc, ctx);

// Load keygrain.js (references hashwasm.argon2id)
const keygrainSrc = readFileSync(resolve(shared, 'keygrain.js'), 'utf8');
runInContext(keygrainSrc, ctx);

// Load vector
const vectors = JSON.parse(readFileSync(resolve(root, 'vectors.json'), 'utf8'));
const v = vectors.strengthen_vectors[0];

// Run test
console.log(`Testing strengthenSecret("${v.secret_utf8}", "${v.email}")...`);
const result = await runInContext(
  `strengthenSecret(${JSON.stringify(v.secret_utf8)}, ${JSON.stringify(v.email)})`,
  ctx
);
const hex = Buffer.from(result).toString('hex');
assert.equal(hex, v.expected_hex, `Expected ${v.expected_hex}, got ${hex}`);
console.log(`  ✓ strengthen vector matches: ${hex}`);
