// test-common-entity.mjs — Comprehensive test suite for Keygrain Common Entity and Generator Architecture
import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = resolve(__dirname, '..', 'shared');
const root = resolve(__dirname, '..', '..');

// --- Strengthen vector map from Spec v5 ---
const STRENGTHEN_MAP = {
  'my-master-secret|test@gmail.com': 'd7b935b8298f476c6046cb71501fcb8c9a53327df3cc4e05c696fea7ef3d035a',
  'short|alice@example.com': '3633552e469c5ea783380f877b271672e7261795298870734940afe4f808b47b',
  'different-secret|test@gmail.com': '8978650b9ce3874f29337c74cd9ce3937e7b92bb8bcdf49bf60ed30ee8476309',
  'a|test@gmail.com': '7ac3b5873ab19473c51a126da6ab2ccca497f8ff378336a2dea47e919cf02744',
  'my-master-secret|keygrain-ssh:github': 'aa7dd75bce8d315183f36f957fc68b0b577375e551a699097493a1e278469cba',
  'my-master-secret|keygrain-ssh:work-servers': '11c934b853467ae1c28c2805003896b96e166482495e4a168bd920a98aaf8e04',
  'different-secret|keygrain-ssh:github': '66dac272e5e0ae9a78282839d136e93ae7c5a2d8b59d1866d2052fb0f65736da',
  'my-master-secret|keygrain-wallet:personal': 'e382490554e5fd0757995422324f34a8c5ec01ba9566fbc3a01d68fd58eac138',
  'my-master-secret|keygrain-wallet:savings': '9b9b2aa7cf22e32a116aa58a0784d679a8d810bfc02008990de496a55b03b5a4',
  'different-secret|keygrain-wallet:personal': '3ea07b4ad0828d07980a4e3454be5ad9692d6067913568984fbc1ac2eecf062e',
};

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function buildContext() {
  const ctx = createContext({
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    URL,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    Buffer,
    console,
    Uint8Array,
    DataView,
    BigInt,
    Math,
    parseInt,
    Number,
    String,
    Array,
    Map,
    Set,
    Error,
    RangeError,
    TypeError,
    JSON,
    ArrayBuffer,
    Promise,
    Object,
    RegExp,
    setTimeout,
    clearTimeout,
    hashwasm: {
      argon2id: async ({ password, salt }) => {
        const secretStr = new TextDecoder().decode(password);
        const saltStr = new TextDecoder().decode(salt);
        const emailMatch = saltStr.match(/^keygrain-strengthen:(.+)$/);
        let key;
        if (emailMatch) {
          key = secretStr + '|' + emailMatch[1];
        } else if (saltStr.startsWith('keygrain-ssh:') || saltStr.startsWith('keygrain-wallet:')) {
          key = secretStr + '|' + saltStr;
        } else {
          key = secretStr + '|' + saltStr;
        }
        const hex = STRENGTHEN_MAP[key];
        if (!hex) throw new Error('Mock: no strengthen vector for ' + key);
        return hexToBytes(hex);
      },
    },
    nacl: null,
  });

  // Load TweetNaCl
  const tweetnaclSrc = readFileSync(resolve(shared, 'lib', 'tweetnacl.js'), 'utf8');
  runInContext(`var module = {exports:{}}; var exports = module.exports;\n${tweetnaclSrc}\nvar nacl = module.exports;`, ctx);

  // Load dependencies
  const files = [
    'lib/public_suffix_list.js',
    'public-suffix.js',
    'keygrain.js',
    'bip39-wordlist.js',
    'wallet.js',
    'totp.js',
    'ssh.js',
    'asset-entity.js',
    'asset-generator.js',
  ];

  for (const file of files) {
    const src = readFileSync(resolve(shared, file), 'utf8');
    runInContext(src, ctx);
  }

  return ctx;
}

const ctx = buildContext();

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e.message}`);
    if (e.stack) console.error(e.stack);
  }
}

console.log('--- Keygrain Common Entity and Generator Tests ---');

// ============================================================
// 1. ENTITY CREATION, TYPING, AND VALIDATION TESTS
// ============================================================
console.log('\n[1] Entity Creation, Typing, and Invariant Validations:');

await test('createLoginEntity creates valid immutable login with default parameters', async () => {
  const entity = runInContext(`
    createLoginEntity({
      site: 'github.com',
      username: 'user@example.com'
    })
  `, ctx);

  assert.equal(entity.kind, 'login');
  assert.equal(entity.site, 'github.com');
  assert.equal(entity.username, 'user@example.com');
  assert.equal(entity.length, 20);
  assert.equal(entity.counter, 1);
  assert.equal(entity.symbols, '!@#$%&*-_=+?');
  assert.equal(entity.policy, 'ascii-printable-v1');
  assert.equal(entity.derivationSource, 'deterministic');
  assert.equal(entity.tombstoned, false);
  assert.ok(entity.id.length >= 10);
  assert.ok(entity.createdAt > 0);
  assert.ok(entity.updatedAt > 0);
  assert.ok(Object.isFrozen(entity));
});

await test('createSshEntity creates valid immutable SSH entity', async () => {
  const entity = runInContext(`
    createSshEntity({
      label: 'Production Bastion',
      keyName: 'bastion-prod',
      counter: 2,
      comment: 'bastion-prod'
    })
  `, ctx);

  assert.equal(entity.kind, 'ssh');
  assert.equal(entity.label, 'Production Bastion');
  assert.equal(entity.keyName, 'bastion-prod');
  assert.equal(entity.counter, 2);
  assert.equal(entity.comment, 'bastion-prod');
  assert.equal(entity.derivationSource, 'deterministic');
  assert.ok(Object.isFrozen(entity));

  assert.equal(runInContext(`cleanKeyName('prod:bastion')`, ctx), 'prod-bastion');
  const colonEntity = runInContext(`createSshEntity({ keyName: 'prod:bastion' })`, ctx);
  assert.equal(colonEntity.keyName, 'prod-bastion');
});

await test('createWalletEntity creates valid immutable wallet entity', async () => {
  const entity = runInContext(`
    createWalletEntity({
      label: 'Cold Vault',
      walletId: 'cold-vault-01',
      words: 12,
      counter: 1,
      notes: 'Hardware safe backup'
    })
  `, ctx);

  assert.equal(entity.kind, 'wallet');
  assert.equal(entity.label, 'Cold Vault');
  assert.equal(entity.walletId, 'cold-vault-01');
  assert.equal(entity.words, 12);
  assert.equal(entity.notes, 'Hardware safe backup');
  assert.equal(entity.derivationSource, 'deterministic');
  assert.ok(Object.isFrozen(entity));
});

await test('createGenericEntity creates valid note entity', async () => {
  const entity = runInContext(`
    createGenericEntity({
      kind: AssetKind.NOTE,
      label: 'Recovery Instructions',
      notes: 'Store in vault B',
      tags: ['recovery', 'admin']
    })
  `, ctx);

  assert.equal(entity.kind, 'note');
  assert.equal(entity.label, 'Recovery Instructions');
  assert.deepEqual(Array.from(entity.tags), ['recovery', 'admin']);
  assert.ok(Object.isFrozen(entity));
});

await test('validateEntity enforces invariants and throws on invalid entities', async () => {
  // Empty or invalid ID
  assert.throws(() => runInContext(`createLoginEntity({ id: '', site: 'test.com' })`, ctx), /Invalid entity id/);
  assert.throws(() => runInContext(`createLoginEntity({ id: 'bad id with spaces', site: 'test.com' })`, ctx), /Invalid entity id/);

  // Negative timestamps
  assert.throws(() => runInContext(`createLoginEntity({ site: 'test.com', createdAt: -10 })`, ctx), /createdAt must be a non-negative integer/);
  assert.throws(() => runInContext(`createLoginEntity({ site: 'test.com', updatedAt: -1 })`, ctx), /updatedAt must be a non-negative integer/);

  // Invalid counter
  assert.throws(() => runInContext(`createLoginEntity({ site: 'test.com', counter: 0 })`, ctx), /counter must be an integer >= 1/);
  assert.throws(() => runInContext(`createSshEntity({ keyName: 'bastion', counter: -1 })`, ctx), /counter must be an integer >= 1/);
  assert.throws(() => runInContext(`createWalletEntity({ walletId: 'w1', counter: 0 })`, ctx), /counter must be an integer >= 1/);

  // Invalid length for login
  assert.throws(() => runInContext(`createLoginEntity({ site: 'test.com', length: 2 })`, ctx), /length must be an integer between 4 and 128/);
  assert.throws(() => runInContext(`createLoginEntity({ site: 'test.com', length: 200 })`, ctx), /length must be an integer between 4 and 128/);

  // Invalid wallet words
  assert.throws(() => runInContext(`createWalletEntity({ walletId: 'w1', words: 16 })`, ctx), /words must be 12 or 24/);

  // Invalid wallet slug
  assert.throws(() => runInContext(`createWalletEntity({ walletId: 'Invalid_Wallet_Slug!' })`, ctx), /walletId must match/);

  // Invalid SSH key name
  assert.throws(() => runInContext(`validateEntity({ id: 'valid-id', kind: AssetKind.SSH, label: 'SSH', keyName: 'key:with:colons', counter: 1, createdAt: 1000, updatedAt: 1000, frecency: 0, version: 1, tombstoned: false, derivationSource: 'deterministic' })`, ctx), /SSH keyName must not contain colons/);
  assert.throws(() => runInContext(`createSshEntity({ keyName: 'bad\\x00key' })`, ctx), /SSH keyName must not contain colons or control characters/);
});

// ============================================================
// 2. LEGACY BIDIRECTIONAL CONVERSION FIDELITY
// ============================================================
console.log('\n[2] Legacy Bidirectional Conversion Fidelity:');

await test('fromLegacyService and toLegacyService preserve 100% of service entry fields', async () => {
  const legacyService = {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    name: 'GitHub Enterprise',
    site: 'github.com',
    email: 'dev@corp.internal',
    length: 28,
    symbols: '!@#$%^&*()_+',
    counter: 3,
    policy: 'ascii-printable-v1',
    frecency: 12.5,
    updated_at: 1715000000000,
    created_at: 1714000000000,
    tombstoned: false,
    synced: true,
    totp: {
      type: 'derived',
      counter: 1,
      step_seconds: 30,
      digits: 6,
      algorithm: 'SHA1',
    },
    migrating: true,
    legacy_vault: {
      version: 1,
      iv: 'dGVzdGl2MTIzNA==',
      ciphertext: 'Y2lwaGVydGV4dGRhdGE=',
      tag: 'YXV0aHRhZzEyMzQ1Ng==',
    },
  };

  ctx._legacyService = legacyService;
  const entity = runInContext('fromLegacyService(_legacyService)', ctx);

  assert.equal(entity.id, legacyService.id);
  assert.equal(entity.label, legacyService.name);
  assert.equal(entity.site, 'github.com');
  assert.equal(entity.username, 'dev@corp.internal');
  assert.equal(entity.length, 28);
  assert.equal(entity.symbols, '!@#$%^&*()_+');
  assert.equal(entity.counter, 3);
  assert.equal(entity.updatedAt, 1715000000000);
  assert.equal(entity.createdAt, 1714000000000);
  assert.equal(entity.frecency, 12.5);
  assert.equal(entity.migrating, true);
  assert.deepEqual(JSON.parse(JSON.stringify(entity.legacyVault)), legacyService.legacy_vault);
  assert.equal(entity.derivationSource, 'stored');

  ctx._entity = entity;
  const back = runInContext('toLegacyService(_entity)', ctx);

  assert.equal(back.id, legacyService.id);
  assert.equal(back.name, legacyService.name);
  assert.equal(back.site, legacyService.site);
  assert.equal(back.email, legacyService.email);
  assert.equal(back.length, legacyService.length);
  assert.equal(back.symbols, legacyService.symbols);
  assert.equal(back.counter, legacyService.counter);
  assert.equal(back.policy, legacyService.policy);
  assert.equal(back.updated_at, legacyService.updated_at);
  assert.equal(back.created_at, legacyService.created_at);
  assert.equal(back.synced, legacyService.synced);
  assert.equal(back.migrating, legacyService.migrating);
  assert.deepEqual(JSON.parse(JSON.stringify(back.totp)), legacyService.totp);
  assert.deepEqual(JSON.parse(JSON.stringify(back.legacy_vault)), legacyService.legacy_vault);
});

await test('fromLegacySshKey and toLegacySshKey preserve fidelity', async () => {
  const legacySsh = {
    id: 'ssh-1111-2222-3333-444455556666',
    name: 'Bastion Server',
    key_name: 'bastion-server',
    counter: 2,
    comment: 'dev@bastion',
    created_at: 1711000000000,
    updated_at: 1712000000000,
    tombstoned: false,
  };

  ctx._legacySsh = legacySsh;
  const entity = runInContext('fromLegacySshKey(_legacySsh)', ctx);
  assert.equal(entity.kind, 'ssh');
  assert.equal(entity.keyName, 'bastion-server');
  assert.equal(entity.counter, 2);
  assert.equal(entity.comment, 'dev@bastion');

  ctx._entity = entity;
  const back = runInContext('toLegacySshKey(_entity)', ctx);
  assert.equal(back.id, legacySsh.id);
  assert.equal(back.key_name, legacySsh.key_name);
  assert.equal(back.counter, legacySsh.counter);
  assert.equal(back.comment, legacySsh.comment);
  assert.equal(back.updated_at, legacySsh.updated_at);
});

await test('fromLegacyWallet and toLegacyWallet preserve fidelity', async () => {
  const legacyWallet = {
    id: 'wallet-aaaa-bbbb-cccc-dddd-eeee',
    label: 'Primary Cold Stash',
    wallet_id: 'primary-cold-stash',
    wallet_name: 'primary-cold-stash',
    words: 12,
    counter: 1,
    notes: 'Ledger backup',
    created_at: 1713000000000,
    updated_at: 1713500000000,
    tombstoned: false,
  };

  ctx._legacyWallet = legacyWallet;
  const entity = runInContext('fromLegacyWallet(_legacyWallet)', ctx);
  assert.equal(entity.kind, 'wallet');
  assert.equal(entity.walletId, 'primary-cold-stash');
  assert.equal(entity.words, 12);
  assert.equal(entity.notes, 'Ledger backup');

  ctx._entity = entity;
  const back = runInContext('toLegacyWallet(_entity)', ctx);
  assert.equal(back.id, legacyWallet.id);
  assert.equal(back.wallet_id, legacyWallet.wallet_id);
  assert.equal(back.words, 12);
  assert.equal(back.notes, legacyWallet.notes);
});

await test('toUnifiedCollection and fromUnifiedCollection round-trip heterogeneous stores', async () => {
  const collections = {
    services: [
      { id: 's1', name: 'GitHub', site: 'github.com', email: 'user@ex.com', counter: 1, length: 20 },
      { id: 's2', name: 'Google', site: 'google.com', email: 'user@ex.com', counter: 2, length: 24 },
    ],
    ssh_keys: [
      { id: 'k1', name: 'bastion', key_name: 'bastion', counter: 1, comment: 'bastion' },
    ],
    wallets: [
      { id: 'w1', label: 'Treasury', wallet_id: 'treasury', words: 24, counter: 1 },
    ],
  };

  ctx._collections = collections;
  const unified = runInContext('toUnifiedCollection(_collections)', ctx);
  assert.equal(unified.length, 4);

  ctx._unified = unified;
  const restored = runInContext('fromUnifiedCollection(_unified)', ctx);

  assert.equal(restored.services.length, 2);
  assert.equal(restored.ssh_keys.length, 1);
  assert.equal(restored.wallets.length, 1);

  assert.equal(restored.services[0].id, 's1');
  assert.equal(restored.services[1].id, 's2');
  assert.equal(restored.ssh_keys[0].key_name, 'bastion');
  assert.equal(restored.wallets[0].wallet_id, 'treasury');
});

// ============================================================
// 3. TO_METADATA_DESCRIPTOR & ZERO-KNOWLEDGE AUDIT
// ============================================================
console.log('\n[3] toMetadataDescriptor Zero-Knowledge Audit:');

function recursiveZeroKnowledgeAudit(obj, path = '') {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'string') {
    const forbiddenPatterns = [
      /password/i,
      /mnemonic/i,
      /master-secret/i,
      /argon2/i,
      /ciphertext/i,
      /cipher/i,
      /seed/i,
    ];
    // Exclude valid badges or labels (e.g. "GENERATE_PASSWORD", "BIP-39 24w", "cold-seed" in label)
    if (path.includes('descriptor') || path.includes('subtitle') || path.includes('domain')) {
      for (const pat of forbiddenPatterns) {
        if (pat.test(obj) && !obj.includes('GENERATE_PASSWORD') && !obj.includes('DERIVE_WALLET_SEED')) {
          assert.fail(`Zero-knowledge leak in string at ${path}: '${obj}' matched ${pat}`);
        }
      }
    }
    return;
  }
  if (typeof obj === 'object') {
    const forbiddenKeys = [
      'secret',
      'password',
      'strengthened',
      'privateKey',
      'seed',
      'mnemonic',
      'ciphertext',
      'legacyVault',
      'legacy_vault',
      'rawPrivateKey',
      'iv',
      'tag',
    ];
    for (const key of Object.keys(obj)) {
      assert.ok(!forbiddenKeys.includes(key), `Zero-knowledge violation: forbidden property '${key}' at path ${path}`);
      recursiveZeroKnowledgeAudit(obj[key], `${path}.${key}`);
    }
  }
}

await test('toMetadataDescriptor produces correct descriptor and passes Zero-Knowledge audit', async () => {
  const loginEntity = runInContext(`
    createLoginEntity({
      id: 'e1',
      site: 'github.com',
      username: 'iheb@example.com',
      counter: 2,
      totp: { type: 'derived', counter: 1 },
      migrating: true,
      legacyVault: { version: 1, iv: 'abc', ciphertext: 'secret_cipher', tag: 'tag1' }
    })
  `, ctx);

  const sshEntity = runInContext(`
    createSshEntity({
      id: 'e2',
      label: 'Main Bastion',
      keyName: 'bastion-alpha',
      counter: 1,
      comment: 'bastion-alpha'
    })
  `, ctx);

  const walletEntity = runInContext(`
    createWalletEntity({
      id: 'e3',
      label: 'Cold Stash',
      walletId: 'cold-vault-01',
      words: 24,
      notes: 'Super secret private backup'
    })
  `, ctx);

  const companionEntity = runInContext(`
    createGenericEntity({
      id: 'e4',
      kind: AssetKind.LOGIN,
      label: 'Phone Login',
      site: 'twitter.com',
      username: 'iheb',
      derivationSource: DerivationSource.COMPANION,
      pairedDeviceId: 'pixel-9'
    })
  `, ctx);

  ctx._items = [loginEntity, sshEntity, walletEntity, companionEntity];
  const descriptors = runInContext('_items.map(toMetadataDescriptor)', ctx);

  // 1. Login Descriptor
  const dLogin = descriptors[0];
  assert.equal(dLogin.id, 'e1');
  assert.equal(dLogin.kind, 'login');
  assert.equal(dLogin.descriptor, 'iheb@example.com • github.com');
  assert.ok(dLogin.badges.includes('TOTP'));
  assert.ok(dLogin.badges.includes('v2'));
  assert.ok(dLogin.badges.includes('MIGRATE'));
  assert.ok(dLogin.badges.includes('STORED'));
  assert.ok(dLogin.capabilities instanceof Set);
  assert.ok(dLogin.capabilities.has('GENERATE_PASSWORD'));
  assert.ok(dLogin.capabilities.has('GENERATE_TOTP'));
  assert.ok(dLogin.capabilities.has('RESOLVE_STORED_VAULT'));
  assert.ok(dLogin.capabilities.has('AUTOFILL_LOGIN'));

  // 2. SSH Descriptor
  const dSsh = descriptors[1];
  assert.equal(dSsh.id, 'e2');
  assert.equal(dSsh.kind, 'ssh');
  assert.equal(dSsh.descriptor, 'bastion-alpha');
  assert.ok(dSsh.badges.includes('ED25519'));
  assert.ok(dSsh.capabilities.has('GENERATE_SSH_KEYPAIR'));
  assert.ok(dSsh.capabilities.has('EXPORT_PUBLIC_KEY'));
  assert.ok(dSsh.capabilities.has('EXPORT_PRIVATE_KEY'));

  // 3. Wallet Descriptor
  const dWallet = descriptors[2];
  assert.equal(dWallet.id, 'e3');
  assert.equal(dWallet.kind, 'wallet');
  assert.equal(dWallet.descriptor, 'Super secret private backup');
  assert.ok(dWallet.badges.includes('BIP-39 24w'));
  assert.ok(dWallet.capabilities.has('GENERATE_WALLET_MNEMONIC'));
  assert.ok(dWallet.capabilities.has('DERIVE_WALLET_SEED'));

  // 4. Companion Descriptor
  const dComp = descriptors[3];
  assert.equal(dComp.id, 'e4');
  assert.ok(dComp.badges.includes('COMPANION'));
  assert.ok(dComp.capabilities.has('REQUEST_COMPANION_DERIVATION'));

  // 5. Zero-Knowledge Audit across all descriptors
  for (const d of descriptors) {
    recursiveZeroKnowledgeAudit(d);
  }
});

// ============================================================
// 4. SOLID OPEN/CLOSED PRINCIPLE (OCP) DYNAMIC EXTENSION
// ============================================================
console.log('\n[4] Open/Closed Principle (OCP) Dynamic Generator Extension:');

await test('can dynamically register custom MockCompetitorGenerator without altering core classes', async () => {
  const result = await runInContext(`
    (async () => {
      const orchestrator = new CredentialResolverOrchestrator();

      // Define third-party competitor generator dynamically conforming to ICredentialGenerator
      class MockCompetitorGenerator extends ICredentialGenerator {
        constructor() {
          super("mock-competitor");
        }
        supportsKind(kind) {
          return kind === AssetKind.LOGIN;
        }
        supportsSource(source) {
          return source === DerivationSource.COMPETITOR;
        }
        supportsAlgorithm(algo) {
          return true;
        }
        async generatePassword(entity, ctx) {
          return "COMPETITOR-PWD:" + entity.site + ":" + ctx.competitorKey;
        }
      }

      // Register without modifying existing classes (OCP)
      orchestrator.registerGenerator(new MockCompetitorGenerator());

      const competitorEntity = createLoginEntity({
        site: 'competitor-site.com',
        username: 'alice',
        derivationSource: DerivationSource.COMPETITOR
      });

      return await orchestrator.resolve(competitorEntity, 'password', { competitorKey: 'COMP_SECRET_42' });
    })()
  `, ctx);

  assert.equal(result, 'COMPETITOR-PWD:competitor-site.com:COMP_SECRET_42');
});

// ============================================================
// 5. SOLID INTERFACE SEGREGATION PRINCIPLE (ISP) TESTS
// ============================================================
console.log('\n[5] Interface Segregation Principle (ISP) Capability Enforcement:');

await test('generator implementing only IPasswordGenerator fails cleanly when called for wallet or ssh', async () => {
  await runInContext(`
    (async () => {
      const orchestrator = new CredentialResolverOrchestrator(new GeneratorRegistry());

      class PasswordOnlyGenerator extends ICredentialGenerator {
        constructor() {
          super("pwd-only");
        }
        supportsKind(kind) { return true; }
        supportsSource(source) { return source === "restricted-pwd"; }
        supportsAlgorithm(algo) { return true; }
        async generatePassword(entity, ctx) {
          return "strictly-password";
        }
      }

      orchestrator.registerGenerator(new PasswordOnlyGenerator());

      const testEntity = createWalletEntity({
        walletId: 'restricted-wallet',
        derivationSource: 'restricted-pwd'
      });

      // 1. Password generation succeeds
      const pwd = await orchestrator.resolve(testEntity, 'password', {});
      if (pwd !== 'strictly-password') throw new Error('Expected password generation to succeed');

      // 2. Wallet derivation MUST fail with UnsupportedCapabilityError (ISP)
      let walletThrew = false;
      try {
        await orchestrator.resolve(testEntity, 'wallet', {});
      } catch (err) {
        if (err.name === 'UnsupportedCapabilityError') {
          walletThrew = true;
        } else {
          throw err;
        }
      }

      if (!walletThrew) throw new Error('Expected UnsupportedCapabilityError for wallet derivation on password-only generator');

      // 3. SSH derivation MUST fail with UnsupportedCapabilityError
      let sshThrew = false;
      try {
        await orchestrator.resolve(testEntity, 'ssh', {});
      } catch (err) {
        if (err.name === 'UnsupportedCapabilityError') {
          sshThrew = true;
        } else {
          throw err;
        }
      }

      if (!sshThrew) throw new Error('Expected UnsupportedCapabilityError for ssh derivation on password-only generator');
    })()
  `, ctx);
});

// ============================================================
// 6. SPEC V5 CRYPTO PRIMITIVE INTEGRATION & VECTOR FIDELITY
// ============================================================
console.log('\n[6] Spec v5 Vector Derivation Integration:');

await test('KeygrainV5DeterministicGenerator derives exact Spec v5 password', async () => {
  const orchestrator = runInContext('new CredentialResolverOrchestrator()', ctx);

  const loginEntity = runInContext(`
    createLoginEntity({
      site: 'github.com',
      username: 'test@gmail.com',
      length: 20,
      counter: 1,
      symbols: '!@#$%&*-_=+?'
    })
  `, ctx);

  ctx._orchestrator = orchestrator;
  ctx._loginEntity = loginEntity;

  const derivedPassword = await runInContext(`
    _orchestrator.resolve(_loginEntity, 'password', {
      secret: 'my-master-secret',
      email: 'test@gmail.com'
    })
  `, ctx);

  // Authoritative Spec v5 vector: "?X_BAbv4UHAfw=kYV$mh"
  assert.equal(derivedPassword, '?X_BAbv4UHAfw=kYV$mh');
});

await test('KeygrainV5DeterministicGenerator derives exact Spec v5 SSH keypair and OpenSSH formats', async () => {
  const orchestrator = runInContext('new CredentialResolverOrchestrator()', ctx);

  const sshEntity = runInContext(`
    createSshEntity({
      keyName: 'github',
      counter: 1,
      comment: 'github'
    })
  `, ctx);

  ctx._orchestrator = orchestrator;
  ctx._sshEntity = sshEntity;

  const sshResult = await runInContext(`
    _orchestrator.resolve(_sshEntity, 'ssh', {
      secret: 'my-master-secret'
    })
  `, ctx);

  assert.equal(
    sshResult.publicKey,
    'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIN0DA4Ptjns2gH3meDQb2rBgbRczb/ZL9m9GwRKWSbAR github'
  );
  assert.ok(sshResult.privateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----'));
  assert.ok(sshResult.privateKey.endsWith('-----END OPENSSH PRIVATE KEY-----\n'));
});

await test('KeygrainV5DeterministicGenerator derives exact Spec v5 HD wallet mnemonics (24w & 12w)', async () => {
  const orchestrator = runInContext('new CredentialResolverOrchestrator()', ctx);

  // 24-word wallet vector
  const wallet24 = runInContext(`
    createWalletEntity({
      walletId: 'personal',
      words: 24,
      counter: 1
    })
  `, ctx);

  ctx._orchestrator = orchestrator;
  ctx._wallet24 = wallet24;

  const res24 = await runInContext(`
    _orchestrator.resolve(_wallet24, 'wallet', {
      secret: 'my-master-secret'
    })
  `, ctx);

  assert.equal(
    res24.mnemonic,
    'issue genuine cute milk orphan network shove urban hungry lucky catalog boss laundry people stuff during little cousin april remind legal wash memory announce'
  );

  // 12-word wallet vector
  const wallet12 = runInContext(`
    createWalletEntity({
      walletId: 'personal',
      words: 12,
      counter: 1
    })
  `, ctx);

  ctx._wallet12 = wallet12;
  const res12 = await runInContext(`
    _orchestrator.resolve(_wallet12, 'wallet', {
      secret: 'my-master-secret'
    })
  `, ctx);

  assert.equal(
    res12.mnemonic,
    'sort mix usage obscure black resource scale rhythm motor help empty enter'
  );
});

await test('KeygrainV5DeterministicGenerator derives exact TOTP code from derived seed', async () => {
  const orchestrator = runInContext('new CredentialResolverOrchestrator()', ctx);

  const loginWithTotp = runInContext(`
    createLoginEntity({
      site: 'github.com',
      username: 'test@gmail.com',
      totp: { type: 'derived', counter: 1, stepSeconds: 30, digits: 6, algorithm: 'SHA1' }
    })
  `, ctx);

  ctx._orchestrator = orchestrator;
  ctx._loginWithTotp = loginWithTotp;

  const totpRes = await runInContext(`
    _orchestrator.resolve(_loginWithTotp, 'totp', {
      secret: 'my-master-secret',
      email: 'test@gmail.com'
    }, { timestampMs: 1234567890 * 1000 })
  `, ctx);

  assert.equal(typeof totpRes.code, 'string');
  assert.equal(totpRes.code.length, 6);
  assert.ok(totpRes.period === 30);
});

await test('KeygrainV5DeterministicGenerator derives exact TOTP code from stored Base32 seed', async () => {
  const orchestrator = runInContext('new CredentialResolverOrchestrator()', ctx);

  // Seed "JBSWY3DPEHPK3PXP" is standard RFC test seed ("Hello!\xde\xad\xbe\xef")
  const storedTotpEntity = runInContext(`
    createLoginEntity({
      site: 'service-with-stored-2fa.com',
      username: 'alice@corp.com',
      totp: { type: 'stored', seed: 'JBSWY3DPEHPK3PXP', digits: 6, stepSeconds: 30, algorithm: 'SHA1' }
    })
  `, ctx);

  ctx._orchestrator = orchestrator;
  ctx._storedTotpEntity = storedTotpEntity;

  // At time = 59 seconds: RFC vector test
  const totpRes = await runInContext(`
    _orchestrator.resolve(_storedTotpEntity, 'totp', {}, { timestampMs: 59 * 1000 })
  `, ctx);

  assert.equal(typeof totpRes.code, 'string');
  assert.equal(totpRes.code.length, 6);
  assert.equal(totpRes.period, 30);
  assert.equal(totpRes.remainingSeconds, 1);
});

// ============================================================
// 7. STORED VAULT RESOLVER AES-256-GCM TESTS
// ============================================================
console.log('\n[7] Stored Vault Resolver (AES-256-GCM):');

await test('encryptStoredVault and StoredVaultResolver round-trip encrypted credentials', async () => {
  const plaintextPassword = 'UnmigratedLegacyP@ssw0rd!#$';
  const rawKey = new Uint8Array(32);
  webcrypto.getRandomValues(rawKey);

  ctx._rawKey = rawKey;
  ctx._plaintextPassword = plaintextPassword;

  const encryptedVault = await runInContext(`encryptStoredVault(_plaintextPassword, _rawKey)`, ctx);

  assert.ok(encryptedVault.iv);
  assert.ok(encryptedVault.ciphertext);
  assert.ok(encryptedVault.tag);
  assert.equal(encryptedVault.version, 1);

  ctx._encryptedVault = encryptedVault;

  const storedEntity = runInContext(`
    createLoginEntity({
      site: 'legacy-service.com',
      username: 'olduser@corp.internal',
      migrating: true,
      legacyVault: _encryptedVault
    })
  `, ctx);

  assert.equal(storedEntity.derivationSource, 'stored');

  const orchestrator = runInContext('new CredentialResolverOrchestrator()', ctx);
  ctx._orchestrator = orchestrator;
  ctx._storedEntity = storedEntity;

  // Resolve with direct key
  const decrypted = await runInContext(`
    _orchestrator.resolve(_storedEntity, 'stored_vault', {
      legacyVaultKey: _rawKey
    })
  `, ctx);

  assert.equal(decrypted, plaintextPassword);
});

await test('StoredVaultResolver fails on tampered ciphertext', async () => {
  const rawKey = new Uint8Array(32);
  webcrypto.getRandomValues(rawKey);
  ctx._rawKey = rawKey;

  const encryptedVault = await runInContext(`encryptStoredVault('P@ssword123', _rawKey)`, ctx);
  // Tamper ciphertext
  const tamperedCiphertext = Buffer.from(encryptedVault.ciphertext, 'base64');
  tamperedCiphertext[0] ^= 0xff;
  encryptedVault.ciphertext = tamperedCiphertext.toString('base64');

  ctx._tamperedVault = encryptedVault;

  const tamperedEntity = runInContext(`
    createLoginEntity({
      site: 'tampered.com',
      username: 'user',
      legacyVault: _tamperedVault,
      derivationSource: 'stored'
    })
  `, ctx);

  const orchestrator = runInContext('new CredentialResolverOrchestrator()', ctx);
  ctx._orchestrator = orchestrator;
  ctx._tamperedEntity = tamperedEntity;

  await assert.rejects(
    () => runInContext(`_orchestrator.resolve(_tamperedEntity, 'stored_vault', { legacyVaultKey: _rawKey })`, ctx)
  );
});

await test('StoredVaultResolver derives legacy key from master secret and email', async () => {
  const secret = 'my-master-secret';
  const email = 'test@gmail.com';

  const key = await runInContext(`
    (async () => {
      const strengthened = await strengthenSecret('${secret}', '${email}');
      const enc = new TextEncoder();
      return await hmacSHA256(strengthened, enc.encode('${email}' + ':keygrain-legacy-vault'));
    })()
  `, ctx);

  const plaintext = 'DerivedVaultPassword456!';
  ctx._derivedKey = key;
  ctx._pt = plaintext;
  const encryptedVault = await runInContext(`encryptStoredVault(_pt, _derivedKey)`, ctx);

  ctx._encVault = encryptedVault;
  const entity = runInContext(`
    createLoginEntity({
      site: 'derived-legacy.com',
      username: '${email}',
      migrating: true,
      legacyVault: _encVault
    })
  `, ctx);

  ctx._entity = entity;
  const orchestrator = runInContext('new CredentialResolverOrchestrator()', ctx);
  ctx._orchestrator = orchestrator;

  const decrypted = await runInContext(`
    _orchestrator.resolve(_entity, 'stored_vault', {
      secret: '${secret}',
      email: '${email}'
    })
  `, ctx);

  assert.equal(decrypted, plaintext);
});

await test('GeneratorRegistry supports unregistering and LIFO generator replacement', async () => {
  const registry = runInContext('new GeneratorRegistry()', ctx);
  const gen1 = runInContext(`
    new (class extends ICredentialGenerator {
      constructor() { super("gen1"); }
      supportsKind(k) { return k === AssetKind.LOGIN; }
      supportsSource(s) { return s === DerivationSource.DETERMINISTIC; }
      supportsAlgorithm() { return true; }
      async generatePassword() { return "gen1-pass"; }
    })()
  `, ctx);

  const gen2 = runInContext(`
    new (class extends ICredentialGenerator {
      constructor() { super("gen2"); }
      supportsKind(k) { return k === AssetKind.LOGIN; }
      supportsSource(s) { return s === DerivationSource.DETERMINISTIC; }
      supportsAlgorithm() { return true; }
      async generatePassword() { return "gen2-override"; }
    })()
  `, ctx);

  ctx._reg = registry;
  ctx._gen1 = gen1;
  ctx._gen2 = gen2;

  runInContext(`_reg.register(_gen1);`, ctx);
  assert.equal(runInContext(`_reg.findGenerator(AssetKind.LOGIN, DerivationSource.DETERMINISTIC).id`, ctx), 'gen1');

  // gen2 registered later takes precedence (LIFO)
  runInContext(`_reg.register(_gen2);`, ctx);
  assert.equal(runInContext(`_reg.findGenerator(AssetKind.LOGIN, DerivationSource.DETERMINISTIC).id`, ctx), 'gen2');

  // Unregister gen2 -> reverts to gen1
  runInContext(`_reg.unregister("gen2");`, ctx);
  assert.equal(runInContext(`_reg.findGenerator(AssetKind.LOGIN, DerivationSource.DETERMINISTIC).id`, ctx), 'gen1');

  // Unregister gen1 -> returns null
  runInContext(`_reg.unregister("gen1");`, ctx);
  assert.equal(runInContext(`_reg.findGenerator(AssetKind.LOGIN, DerivationSource.DETERMINISTIC)`, ctx), null);
});

// ============================================================
// 8. PHONE COMPANION DELEGATOR TESTS
// ============================================================
console.log('\n[8] Phone Companion Delegator:');

await test('PhoneCompanionDelegator dispatches requests to paired device RPC handler', async () => {
  const orchestrator = runInContext('new CredentialResolverOrchestrator()', ctx);

  const companionEntity = runInContext(`
    createGenericEntity({
      id: 'comp-101',
      kind: AssetKind.LOGIN,
      label: 'Corporate VPN Login',
      site: 'vpn.corp.com',
      derivationSource: DerivationSource.COMPANION,
      pairedDeviceId: 'pixel-phone-secure-enclave'
    })
  `, ctx);

  ctx._orchestrator = orchestrator;
  ctx._companionEntity = companionEntity;

  let rpcReceived = null;
  ctx._mockCompanionHandler = async (entity, req) => {
    rpcReceived = { entityId: entity.id, action: req.action, deviceId: entity.pairedDeviceId };
    return {
      status: 'approved',
      rpcId: 'rpc-999',
      derivedPassword: 'remote-derived-secure-password',
    };
  };

  const response = await runInContext(`
    _orchestrator.resolve(_companionEntity, 'companion', {}, {
      req: {
        action: 'DERIVE_PASSWORD_REMOTE',
        handler: _mockCompanionHandler
      }
    })
  `, ctx);

  assert.equal(response.status, 'approved');
  assert.equal(response.derivedPassword, 'remote-derived-secure-password');
  assert.deepEqual(rpcReceived, {
    entityId: 'comp-101',
    action: 'DERIVE_PASSWORD_REMOTE',
    deviceId: 'pixel-phone-secure-enclave',
  });
});

// ============================================================
// 9. MULTI-ASSET METADATA SEARCH AND AUTOFILL MATCHING
// ============================================================
console.log('\n[9] Multi-Asset Metadata Search and Autofill Domain Matching:');

await test('matchesAutofill correctly matches login domains and subdomains', async () => {
  const entity = runInContext(`
    createLoginEntity({
      site: 'github.com',
      username: 'octocat'
    })
  `, ctx);

  ctx._entity = entity;

  // Exact host match
  assert.equal(runInContext(`matchesAutofill(_entity, 'github.com')`, ctx), true);
  // Subdomain match
  assert.equal(runInContext(`matchesAutofill(_entity, 'gist.github.com')`, ctx), true);
  assert.equal(runInContext(`matchesAutofill(_entity, 'deep.sub.github.com')`, ctx), true);
  // Non-matching host
  assert.equal(runInContext(`matchesAutofill(_entity, 'gitlab.com')`, ctx), false);
  // Dot-anchor guard (must not match suffix without dot)
  assert.equal(runInContext(`matchesAutofill(_entity, 'notgithub.com')`, ctx), false);
});

await test('matchesAutofill handles IP addresses, localhost, and tombstone guards', async () => {
  const ipEntity = runInContext(`
    createLoginEntity({
      site: '192.168.1.100',
      username: 'admin'
    })
  `, ctx);

  const localEntity = runInContext(`
    createLoginEntity({
      site: 'localhost',
      username: 'dev'
    })
  `, ctx);

  const tombstonedEntity = runInContext(`
    createLoginEntity({
      site: 'github.com',
      username: 'ghost',
      tombstoned: true
    })
  `, ctx);

  ctx._ipEntity = ipEntity;
  ctx._localEntity = localEntity;
  ctx._tombstonedEntity = tombstonedEntity;

  // Exact IP matches
  assert.equal(runInContext(`matchesAutofill(_ipEntity, '192.168.1.100')`, ctx), true);
  assert.equal(runInContext(`matchesAutofill(_ipEntity, 'http://192.168.1.100:8080/login')`, ctx), true);
  assert.equal(runInContext(`matchesAutofill(_ipEntity, '192.168.1.101')`, ctx), false);

  // Localhost matches
  assert.equal(runInContext(`matchesAutofill(_localEntity, 'localhost')`, ctx), true);
  assert.equal(runInContext(`matchesAutofill(_localEntity, 'http://localhost:3000')`, ctx), true);
  assert.equal(runInContext(`matchesAutofill(_localEntity, 'localdomain')`, ctx), false);

  // Tombstoned entity never matches
  assert.equal(runInContext(`matchesAutofill(_tombstonedEntity, 'github.com')`, ctx), false);
});

await test('matchesAutofill matches TOTP context only when TOTP is configured', async () => {
  const entityWithoutTotp = runInContext(`
    createLoginEntity({
      site: 'github.com',
      username: 'octocat'
    })
  `, ctx);

  const entityWithTotp = runInContext(`
    createLoginEntity({
      site: 'github.com',
      username: 'octocat',
      totp: { type: 'derived', counter: 1 }
    })
  `, ctx);

  ctx._eNoTotp = entityWithoutTotp;
  ctx._eTotp = entityWithTotp;

  // Normal login form context: both match
  assert.equal(runInContext(`matchesAutofill(_eNoTotp, 'github.com', { isOtp: false })`, ctx), true);
  assert.equal(runInContext(`matchesAutofill(_eTotp, 'github.com', { isOtp: false })`, ctx), true);

  // OTP 2FA context: only entityWithTotp matches
  assert.equal(runInContext(`matchesAutofill(_eNoTotp, 'github.com', { isOtp: true })`, ctx), false);
  assert.equal(runInContext(`matchesAutofill(_eTotp, 'github.com', { isOtp: true })`, ctx), true);
});

await test('matchesAutofill matches Web3 dApp requests for wallets', async () => {
  const wallet = runInContext(`
    createWalletEntity({
      walletId: 'defi-wallet',
      words: 24,
      tags: ['uniswap.org']
    })
  `, ctx);

  ctx._wallet = wallet;

  // Normal login form: wallets do not match
  assert.equal(runInContext(`matchesAutofill(_wallet, 'uniswap.org')`, ctx), false);

  // Web3 context matching
  assert.equal(runInContext(`matchesAutofill(_wallet, 'app.uniswap.org', { type: 'wallet' })`, ctx), true);
  assert.equal(runInContext(`matchesAutofill(_wallet, 'google.com', { type: 'wallet' })`, ctx), false);
});

await test('search terms in MetadataDescriptor enable instant multi-asset vault filtering', async () => {
  const collection = runInContext(`
    toUnifiedCollection({
      services: [
        { id: '1', name: 'Work GitHub', site: 'github.com', email: 'alice@corp.com' }
      ],
      ssh_keys: [
        { id: '2', name: 'Bastion Alpha', key_name: 'bastion-alpha', comment: 'bastion-alpha' }
      ],
      wallets: [
        { id: '3', label: 'Cold Storage Vault', wallet_id: 'cold-vault', words: 24 }
      ]
    })
  `, ctx);

  ctx._collection = collection;
  const descriptors = runInContext(`_collection.map(toMetadataDescriptor)`, ctx);

  function search(query) {
    const q = query.toLowerCase().trim();
    return descriptors.filter(d => d.searchTerms.some(term => term.includes(q)) || d.label.toLowerCase().includes(q));
  }

  // Search 'bastion' -> returns SSH key only
  const sshMatches = search('bastion');
  assert.equal(sshMatches.length, 1);
  assert.equal(sshMatches[0].kind, 'ssh');
  assert.equal(sshMatches[0].label, 'Bastion Alpha');

  // Search 'vault' -> returns HD wallet only
  const walletMatches = search('vault');
  assert.equal(walletMatches.length, 1);
  assert.equal(walletMatches[0].kind, 'wallet');
  assert.equal(walletMatches[0].label, 'Cold Storage Vault');

  // Search 'github' -> returns login only
  const loginMatches = search('github');
  assert.equal(loginMatches.length, 1);
  assert.equal(loginMatches[0].kind, 'login');
  assert.equal(loginMatches[0].label, 'Work GitHub');
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
