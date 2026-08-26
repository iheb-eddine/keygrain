import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = resolve(__dirname, '..', 'shared');
const wordlist = Array.from({length: 2048}, () => 'word');
let now = 1000;
const deriveCalls = [];
const context = createContext({
  Array, ArrayBuffer, Date, Error, JSON, Map, Math, Number, Object, Promise, RegExp, Set, String,
  TextEncoder, TextDecoder, URL, Reflect, Uint8Array, structuredClone, console,
  BIP39_WORDLIST: wordlist,
  now: 1000,
  randomCounter: 0,
  crypto: {getRandomValues(bytes) { for (let i = 0; i < bytes.length; i++) bytes[i] = (i + 1) & 0xff; return bytes; }},
});
runInContext('globalThis = this;', context);
runInContext(readFileSync(resolve(shared, 'unlock-state.js'), 'utf8'), context);
context.crypto = {getRandomValues(bytes) {
  const seed = context.randomCounter++;
  for (let i = 0; i < bytes.length; i++) bytes[i] = (seed + i + 1) & 0xff;
  return bytes;
}};
runInContext(readFileSync(resolve(shared, 'browser-owner.js'), 'utf8'), context);
context.deriveWalletMnemonic = async (...args) => {
  deriveCalls.push(args);
  return Array.from({length: 24}, () => 'word').join(' ');
};
runInContext(`globalThis.owner = KeygrainBrowserOwner.createOwner({
  adapter: {browser: 'chrome', storage: {async get() { return {}; }, async set() {}, async remove() {}}},
  settings: {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400},
  clock: () => now,
});`, context);

const trusted = runInContext(`({id: 'ext', tab: null, url: 'chrome-extension://ext/popup.html'})`, context);
const wrongPath = runInContext(`({id: 'ext', tab: null, url: 'chrome-extension://ext/wallet-page.html'})`, context);
const invoke = async (sender, request) => {
  context._sender = sender;
  context._request = request;
  const result = await runInContext('owner.dispatchPopupRequest(_sender, "ext", _request, "chrome", "chrome-extension://ext")', context);
  return JSON.parse(JSON.stringify(result));
};
function unlock(wallets) {
  context._wallets = wallets;
  runInContext(`owner.manager.lockEverything(); owner.manager.unlockFull({
    fullData: {secret: 'owner-secret', services: [], wallets: _wallets, walletAuditLog: [], tombstones: [], deletionReview: []},
    records: [],
  })`, context);
}
function validWallet(overrides = {}) {
  return {wallet_name: 'Personal', chain: 'BITCOIN', counter: 1, email: ' User@Example.COM ', ...overrides};
}
function unlockFullData(fullData) {
  context._fullDataFixture = fullData;
  runInContext(`owner.manager.lockEverything(); owner.manager.unlockFull({fullData: _fullDataFixture, records: []})`, context);
}

assert.equal(createHash('sha256').update(readFileSync(resolve(shared, 'bip39-wordlist.js'))).digest('hex'),
  '3800c5daa7b1d801b93f4660aaa3a2ae441132014256481d7c12b7873dcb210c');
assert.doesNotMatch(readFileSync(resolve(shared, 'browser-owner.js'), 'utf8'), /mnemonicToSeed|bip85DeriveMnemonic/);

function resetDerive() { deriveCalls.length = 0; }

function validDerive() {
  context.deriveWalletMnemonic = async (...args) => {
    deriveCalls.push(args);
    return Array.from({length: 24}, () => 'word').join(' ');
  };
}
async function ownerRejectsFixture(fullData) {
  unlock([validWallet()]);
  context._fixture = fullData;
  runInContext(`
    globalThis._fixtureInvalid = false;
    globalThis._originalWalletBegin = owner.manager.beginSensitiveOperation;
    owner.manager.beginSensitiveOperation = function (options) {
      const captured = options.capture(_fixture);
      _fixtureInvalid = captured && captured.invalid === true;
      return _originalWalletBegin.call(this, {capture: () => ({invalid: true})});
    };
  `, context);
  const result = await invoke(trusted, {action: 'keygrain.wallet.options'});
  runInContext('owner.manager.beginSensitiveOperation = _originalWalletBegin;', context);
  assert.equal(runInContext('_fixtureInvalid', context), true);
  assert.equal(result.code, 'KEYGRAIN_WALLET_ERROR');
}

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }

console.log('\nKeygrain B3 Wallet Contract Tests:');

await test('fixed wallet actions and exact options projection preserve source order and duplicates', async () => {
  unlock([validWallet(), validWallet({wallet_name: 'SECOND', chain: 'Ethereum', counter: 2, email: 'second@example.com', mode: 'keygrain', notes: 'not emitted'}), validWallet()]);
  const result = await invoke(trusted, {action: 'keygrain.wallet.options'});
  assert.deepEqual(Object.keys(result), ['ok', 'result']);
  assert.deepEqual(Object.keys(result.result), ['items']);
  assert.equal(result.result.items.length, 3);
  for (const item of result.result.items) assert.deepEqual(Object.keys(item), ['selectionToken', 'walletName', 'chain', 'email']);
  assert.deepEqual(result.result.items.map(({walletName, chain, email}) => ({walletName, chain, email})), [
    {walletName: 'personal', chain: 'bitcoin', email: 'user@example.com'},
    {walletName: 'second', chain: 'ethereum', email: 'second@example.com'},
    {walletName: 'personal', chain: 'bitcoin', email: 'user@example.com'},
  ]);
  assert.notEqual(result.result.items[0].selectionToken, result.result.items[2].selectionToken);
  assert.equal(JSON.stringify(result).includes('notes'), false);
});

await test('generate consumes one token and calls unchanged deriveWalletMnemonic exactly once', async () => {
  resetDerive();
  unlock([validWallet({wallet_name: 'Vault', chain: 'Solana', counter: 7})]);
  const options = await invoke(trusted, {action: 'keygrain.wallet.options'});
  const token = options.result.items[0].selectionToken;
  const result = await invoke(trusted, {action: 'keygrain.wallet.generate', selectionToken: token});
  assert.deepEqual(Object.keys(result), ['ok', 'result']);
  assert.deepEqual(Object.keys(result.result), ['mnemonic']);
  assert.equal(result.result.mnemonic.split(' ').length, 24);
  assert.equal(deriveCalls.length, 1);
  assert.equal(deriveCalls[0][1], 'user@example.com');
  assert.deepEqual(JSON.parse(JSON.stringify(deriveCalls[0][2])), {walletName: 'vault', chain: 'solana', counter: 7});
  const replay = await invoke(trusted, {action: 'keygrain.wallet.generate', selectionToken: token});
  assert.equal(replay.code, 'KEYGRAIN_STALE_OPERATION');
});

await test('malformed later entry is all-or-nothing and does not leak a valid prefix', async () => {
  unlock([validWallet(), {...validWallet(), mode: 'raw'}]);
  const malformed = await invoke(trusted, {action: 'keygrain.wallet.options'});
  assert.deepEqual(malformed, {ok: false, code: 'KEYGRAIN_WALLET_ERROR', message: 'The wallet mnemonic could not be generated.'});
  unlock([validWallet()]);
  const valid = await invoke(trusted, {action: 'keygrain.wallet.options'});
  assert.equal(valid.ok, true);
});

await test('proxied collection and proxied entry are rejected at the owner operation boundary', async () => {
  async function assertProxyFailure(kind) {
    unlock([validWallet()]);
    context._proxyKind = kind;
    runInContext(`
      globalThis._proxyObserved = false;
      globalThis._originalWalletBegin = owner.manager.beginSensitiveOperation;
      owner.manager.beginSensitiveOperation = function (options) {
        const entry = {wallet_name: 'Personal', chain: 'BITCOIN', counter: 1, email: 'user@example.com'};
        const wallets = _proxyKind === 'collection' ? new Proxy([entry], {}) : [new Proxy(entry, {})];
        const captured = options.capture({wallets});
        _proxyObserved = captured && captured.invalid === true;
        return _originalWalletBegin.call(this, {capture: () => ({invalid: true})});


      };
    `, context);
    const result = await invoke(trusted, {action: 'keygrain.wallet.options'});
    runInContext('owner.manager.beginSensitiveOperation = _originalWalletBegin;', context);
    assert.equal(runInContext('_proxyObserved', context), true);
    assert.deepEqual(result, {ok: false, code: 'KEYGRAIN_WALLET_ERROR', message: 'The wallet mnemonic could not be generated.'});
    const valid = await invoke(trusted, {action: 'keygrain.wallet.options'});
    assert.equal(valid.ok, true, 'proxy failure left no staged capability or broken owner operation');
  }
  await assertProxyFailure('collection');
  await assertProxyFailure('entry');
});

await test('strict wallet schema rejects malformed collections, descriptors, fields, and bounds', async () => {
  const malformed = [
    null, {}, [],
    {...validWallet(), unknown: true},
    {chain: 'bitcoin', counter: 1, email: 'user@example.com'},
    {...validWallet(), wallet_name: ' Personal'},
    {...validWallet(), wallet_name: 'bad_name'},
    {...validWallet(), wallet_name: 'a'.repeat(65)},
    {...validWallet(), chain: 'unsupported'},
    {...validWallet(), counter: 0}, {...validWallet(), counter: 1.5}, {...validWallet(), counter: 0x80000000},
    {...validWallet(), email: 'user:evil@example.com'}, {...validWallet(), email: 'user\u0000@example.com'},
    {...validWallet(), mode: null}, {...validWallet(), mode: 'raw'}, {...validWallet(), notes: null},
  ];
  for (const entry of malformed) await ownerRejectsFixture({secret: 'owner-secret', services: [], wallets: [entry]});
  const inherited = Object.create({notes: 'inherited'}); Object.assign(inherited, validWallet());
  await ownerRejectsFixture({secret: 'owner-secret', services: [], wallets: [inherited]});
  const accessor = validWallet(); Object.defineProperty(accessor, 'notes', {enumerable: true, get() { return 'secret'; }});
  await ownerRejectsFixture({secret: 'owner-secret', services: [], wallets: [accessor]});
  const hidden = validWallet(); Object.defineProperty(hidden, 'notes', {enumerable: false, value: 'hidden'});
  await ownerRejectsFixture({secret: 'owner-secret', services: [], wallets: [hidden]});
  const symbol = validWallet(); symbol[Symbol('unknown')] = true;
  await ownerRejectsFixture({secret: 'owner-secret', services: [], wallets: [symbol]});
  const wrongOrder = {chain: 'bitcoin', wallet_name: 'personal', counter: 1, email: 'user@example.com'};
  await ownerRejectsFixture({secret: 'owner-secret', services: [], wallets: [wrongOrder]});
  await ownerRejectsFixture({secret: 'owner-secret', services: [], wallets: null});
  await ownerRejectsFixture({secret: 'owner-secret', services: [], wallets: {0: validWallet(), length: 1}});
  await ownerRejectsFixture({secret: 'owner-secret', services: [], wallets: Array.from({length: 257}, () => validWallet())});
});

await test('all supported chains and valid empty collection succeed', async () => {
  const chains = ['bitcoin', 'ethereum', 'solana', 'litecoin', 'dogecoin', 'bitcoin-testnet', 'polkadot', 'cosmos', 'avalanche'];
  unlock(chains.map((chain, index) => validWallet({wallet_name: `wallet-${index}`, chain, counter: index + 1})));
  const result = await invoke(trusted, {action: 'keygrain.wallet.options'});
  assert.equal(result.ok, true);
  assert.deepEqual(result.result.items.map(item => item.chain), chains);
  unlock([]);
  assert.deepEqual((await invoke(trusted, {action: 'keygrain.wallet.options'})).result, {items: []});
});

await test('exact context and envelope precedence remains fail closed', async () => {
  unlock([validWallet()]);
  const wrongContext = await invoke(wrongPath, {get action() { throw new Error('must not probe'); }});
  assert.equal(wrongContext.code, 'KEYGRAIN_CONTEXT_ERROR');
  assert.equal((await invoke(trusted, {action: 'keygrain.wallet.options', extra: true})).code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR');
  assert.equal((await invoke(trusted, {action: 'keygrain.wallet.generate', selectionToken: ''})).code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR');
  assert.equal((await invoke(trusted, {action: 'wallet'})).code, 'KEYGRAIN_CONSUMER_MIGRATION_REQUIRED');
});

await test('owner-clock TTL boundary consumes and rejects capability', async () => {
  unlock([validWallet()]);
  const options = await invoke(trusted, {action: 'keygrain.wallet.options'});
  context.now = 31000;
  const result = await invoke(trusted, {action: 'keygrain.wallet.generate', selectionToken: options.result.items[0].selectionToken});
  assert.equal(result.code, 'KEYGRAIN_STALE_OPERATION');
  assert.equal(deriveCalls.length, 1, 'previous test only; expired capability did not derive');
});

await test('invalid mnemonic output maps to wallet error without leaking result', async () => {
  context.now = 32000;
  context.deriveWalletMnemonic = async () => 'not-a-bip39-mnemonic';
  unlock([validWallet()]);
  const options = await invoke(trusted, {action: 'keygrain.wallet.options'});
  const result = await invoke(trusted, {action: 'keygrain.wallet.generate', selectionToken: options.result.items[0].selectionToken});
  assert.deepEqual(result, {ok: false, code: 'KEYGRAIN_WALLET_ERROR', message: 'The wallet mnemonic could not be generated.'});
});

console.log(`  ${passed} B3-wallet contract tests passed`);
await test('just-before TTL succeeds while tuple mutation, lock, and rollback invalidate before derive', async () => {
  validDerive();
  context.now = 33000;
  unlock([validWallet({wallet_name: 'BeforeBoundary'})]);
  const before = await invoke(trusted, {action: 'keygrain.wallet.options'});
  context.now = 62999;
  const accepted = await invoke(trusted, {action: 'keygrain.wallet.generate', selectionToken: before.result.items[0].selectionToken});
  assert.equal(accepted.ok, true);

  context.now = 63000;
  unlock([validWallet({wallet_name: 'Mutable'})]);
  const changed = await invoke(trusted, {action: 'keygrain.wallet.options'});
  runInContext("owner.manager._fullData.wallets[0].chain = 'ethereum'", context);
  const changedResult = await invoke(trusted, {action: 'keygrain.wallet.generate', selectionToken: changed.result.items[0].selectionToken});
  assert.equal(changedResult.code, 'KEYGRAIN_STALE_OPERATION');

  context.now = 64000;
  unlock([validWallet({wallet_name: 'Locked'})]);
  const locked = await invoke(trusted, {action: 'keygrain.wallet.options'});
  runInContext('owner.manager.lockEverything()', context);
  assert.equal((await invoke(trusted, {action: 'keygrain.wallet.generate', selectionToken: locked.result.items[0].selectionToken})).code, 'KEYGRAIN_EXPIRED');

  context.now = 65000;
  unlock([validWallet({wallet_name: 'Rollback'})]);
  const rollback = await invoke(trusted, {action: 'keygrain.wallet.options'});
  context.now = 64999;
  assert.equal((await invoke(trusted, {action: 'keygrain.wallet.generate', selectionToken: rollback.result.items[0].selectionToken})).code, 'KEYGRAIN_STALE_OPERATION');
  context.now = 65000;
});

await test('exactly one finalizer runs and derivation exceptions are safe', async () => {
  validDerive();
  context.now = 66000;
  unlock([validWallet()]);
  const options = await invoke(trusted, {action: 'keygrain.wallet.options'});
  runInContext('globalThis.finalizerCalls = []; globalThis.originalWalletComplete = owner.manager.completeSensitiveOperation; owner.manager.completeSensitiveOperation = function (...args) { finalizerCalls.push("complete"); return originalWalletComplete.apply(this, args); };', context);
  const success = await invoke(trusted, {action: 'keygrain.wallet.generate', selectionToken: options.result.items[0].selectionToken});
  assert.equal(success.ok, true);
  assert.deepEqual(JSON.parse(runInContext('JSON.stringify(finalizerCalls)', context)), ['complete']);
  runInContext('owner.manager.completeSensitiveOperation = originalWalletComplete;', context);

  context.now = 67000;
  context.deriveWalletMnemonic = async () => { throw new Error('secret must not cross'); };
  unlock([validWallet()]);
  const failedOptions = await invoke(trusted, {action: 'keygrain.wallet.options'});
  const failed = await invoke(trusted, {action: 'keygrain.wallet.generate', selectionToken: failedOptions.result.items[0].selectionToken});
  assert.deepEqual(failed, {ok: false, code: 'KEYGRAIN_WALLET_ERROR', message: 'The wallet mnemonic could not be generated.'});
  runInContext('owner.manager.completeSensitiveOperation = originalWalletComplete;', context);
});

await test('malformed mnemonic shapes never reach the popup result', async () => {
  const invalidOutputs = [
    'word  word',
    Array.from({length: 25}, () => 'word').join(' '),
    Array.from({length: 24}, (_, index) => index === 23 ? 'not-in-wordlist' : 'word').join(' '),
    'word '.repeat(24),
  ];
  for (const output of invalidOutputs) {
    context.now += 1000;
    context.deriveWalletMnemonic = async () => output;
    unlock([validWallet()]);
    const options = await invoke(trusted, {action: 'keygrain.wallet.options'});
    const result = await invoke(trusted, {action: 'keygrain.wallet.generate', selectionToken: options.result.items[0].selectionToken});
    assert.equal(result.code, 'KEYGRAIN_WALLET_ERROR');
    assert.equal(JSON.stringify(result).includes(output), false);
  }
});

