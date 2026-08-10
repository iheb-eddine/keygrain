#!/usr/bin/env node
// Compare every shared derivation family against the independent Python helper.
// This uses the actual extension JS and vendored crypto libraries; it does not
// consume fixture expected-output fields.
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const shared = resolve(root, 'extension', 'shared');
const readJson = name => JSON.parse(readFileSync(resolve(root, name), 'utf8'));

const ctx = createContext({
  crypto: webcrypto,
  TextEncoder, TextDecoder,
  console,
  Uint8Array, DataView, BigInt, Math, parseInt, Number, String, Array, Object,
  Error, ArrayBuffer, Promise, Date, Map, Set, JSON, RegExp,
  btoa: value => Buffer.from(value, 'binary').toString('base64'),
  atob: value => Buffer.from(value, 'base64').toString('binary'),
  globalThis: undefined,
});
runInContext('globalThis = this; self = this;', ctx);
for (const file of [
  'lib/hash-wasm-argon2.js', 'lib/tweetnacl.js', 'keygrain.js',
  'bip39-wordlist.js', 'wallet.js', 'totp.js', 'ssh.js', 'sync.js',
]) {
  runInContext(readFileSync(resolve(shared, file), 'utf8'), ctx);
}

ctx._fixtures = {
  totp: readJson('totp-vectors.json'),
  ssh: readJson('ssh-vectors.json'),
  wallet: readJson('wallet-vectors.json'),
  sync: readJson('sync-vectors.json'),
};

const result = await runInContext(`(async () => {
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const out = {totp_rfc: [], totp_derived: [], ssh: [], wallet: [], sync: {}};
  const f = _fixtures;

  for (const [index, v] of f.totp.rfc6238_vectors.vectors.entries()) {
    const seed = new Uint8Array((f.totp.rfc6238_vectors.seeds[v.algorithm].match(/../g) || [])
      .map(x => parseInt(x, 16)));
    const code = await generateTOTP(seed, v.time, {digits: 8, period: 30, algorithm: v.algorithm});
    out.totp_rfc.push({index, code});
  }
  for (const [index, v] of f.totp.derivation_vectors.vectors.entries()) {
    clearStrengthenCache();
    const seed = await deriveTOTPSeed(v.secret_utf8, v.email, v.site);
    out.totp_derived.push({index, seed_hex: hex(seed)});
  }

  for (const [index, v] of f.ssh.derivation_vectors.vectors.entries()) {
    clearStrengthenCache();
    const pair = await deriveSshKeypair(v.secret_utf8, v.email, {
      keyName: v.key_name, counter: v.counter,
    });
    const comment = v.email.toLowerCase() + ':' + v.key_name.toLowerCase();
    out.ssh.push({
      index,
      seed_hex: hex(pair.seed),
      public_key_hex: hex(pair.publicKey),
      authorized_keys: formatAuthorizedKeys(pair.publicKey, comment),
    });
  }

  for (const v of f.wallet.derivation_vectors) {
    clearStrengthenCache();
    const entropy = await deriveWalletEntropy(v.secret, v.email, {
      walletName: v.wallet_name, chain: v.chain, counter: v.counter,
    });
    out.wallet.push({
      id: v.id,
      entropy_hex: hex(entropy),
      mnemonic: await entropyToMnemonic(entropy),
    });
  }

  out.sync.lookup_id = await deriveLookupId(f.sync.secret, f.sync.email);
  out.sync.auth_password = await deriveAuthPassword(f.sync.secret, f.sync.email);
  out.sync.encryption_key_hex = hex(await deriveEncryptionKey(f.sync.secret, f.sync.email));
  out.sync.services = [];
  for (const [index, s] of f.sync.services.entries()) {
    const item = {index};
    if (s.length !== undefined) {
      clearStrengthenCache();
      item.password = await derivePassword(f.sync.secret, s.email, {
        site: s.site, length: s.length, symbols: s.symbols, counter: s.counter,
      });
    } else if (s.totp !== undefined) {
      clearStrengthenCache();
      item.totp_seed_hex = hex(await deriveTOTPSeed(f.sync.secret, s.email, s.site));
    } else if (s.ssh !== undefined) {
      clearStrengthenCache();
      const pair = await deriveSshKeypair(f.sync.secret, s.email, {
        keyName: s.ssh.key_name, counter: s.ssh.counter,
      });
      item.ssh_authorized_keys = formatAuthorizedKeys(
        pair.publicKey, s.email.toLowerCase() + ':' + s.ssh.key_name.toLowerCase()
      );
    } else {
      throw new Error('Unsupported sync service shape at index ' + index);
    }
    out.sync.services.push(item);
  }
  return out;
})()`, ctx);

process.stdout.write(JSON.stringify(result) + '\n');
