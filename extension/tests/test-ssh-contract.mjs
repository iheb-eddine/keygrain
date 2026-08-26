import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = resolve(__dirname, '..', 'shared');
const ownerSource = readFileSync(resolve(shared, 'browser-owner.js'), 'utf8');
const unlockSource = readFileSync(resolve(shared, 'unlock-state.js'), 'utf8');
const sshSource = readFileSync(resolve(shared, 'ssh.js'), 'utf8');

function validAuthorized(publicKey, comment) {
  const blob = new Uint8Array(51); const view = new DataView(blob.buffer);
  view.setUint32(0, 11); blob.set(new TextEncoder().encode('ssh-ed25519'), 4); view.setUint32(15, 32); blob.set(publicKey, 19);
  return `ssh-ed25519 ${btoa(String.fromCharCode(...blob))} ${comment}`;
}

function fixture({services, deriveResult, authorized = null, privateKey = null} = {}) {
  let now = 1000;
  const calls = {derive: [], authorized: [], private: []};
  const context = createContext({
    Array, ArrayBuffer, DataView, Date, Error, JSON, Map, Math, Number, Object, Promise, RegExp, Set, String,
    TextEncoder, TextDecoder, Uint8Array, URL, Reflect, console, crypto: webcrypto, atob, btoa,
  });
  context.now = now;
  runInContext('globalThis = this;', context);
  runInContext(unlockSource, context);
  context.normalizeSite = site => site.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].split('#')[0].replace(/\/$/, '').toLowerCase().replace(/^www\./, '');
  runInContext(ownerSource, context);
  context.deriveSshKeypair = async (...args) => {
    calls.derive.push(args);
    if (deriveResult) return deriveResult;
    return {seed: new context.Uint8Array(32).fill(7), publicKey: new context.Uint8Array(32).fill(8)};
  };
  context.formatAuthorizedKeys = (publicKey, comment) => {
    calls.authorized.push([publicKey, comment]);
    if (typeof authorized === 'function') return authorized(publicKey, comment);
    if (authorized !== null) return authorized;
    const blob = new context.Uint8Array(51); const view = new context.DataView(blob.buffer);
    view.setUint32(0, 11); blob.set(new TextEncoder().encode('ssh-ed25519'), 4); view.setUint32(15, 32); blob.set(publicKey, 19);
    return `ssh-ed25519 ${btoa(String.fromCharCode(...blob))} ${comment}`;
  };
  context.formatOpensshPrivateKey = async (seed, publicKey, comment) => {
    calls.private.push([seed, publicKey, comment]);
    if (privateKey !== null) return privateKey;
    const body = btoa('openssh-key-v1\0valid');
    return `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----\n`;
  };
  context.adapter = {browser: 'chrome', storage: {async get() { return {}; }, async set() {}, async remove() {}}};
  runInContext(`globalThis.owner = KeygrainBrowserOwner.createOwner({adapter, settings: {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400}, clock: () => now});`, context);
  function setNow(value) { now = value; context.now = value; }
  function unlock(data) {
    context.data = data;
    runInContext('owner.manager.unlockFull({fullData: data, records: []})', Object.assign(context, {data}));
  }
  const trusted = runInContext(`({id: 'ext', tab: null, url: 'chrome-extension://ext/popup.html'})`, context);
  async function invoke(request, sender = trusted) {
    context.request = request; context.sender = sender;
    const result = await runInContext('owner.dispatchPopupRequest(sender, "ext", request, "chrome", "chrome-extension://ext")', context);
    return JSON.parse(JSON.stringify(result));
  }
  return {context, calls, setNow, unlock, invoke, trusted};
}

const validServices = [
  {id: 'plain', site: 'https://Example.com/path', email: ' User@Example.COM ', name: null},
  {id: 'skip-null', site: 'null.example', email: 'null@example.com', ssh: null},
  {id: 'dup', site: 'one.example', email: 'one@example.com', name: 'One', ssh: {key_name: 'GitHub', counter: 2}},
  {id: 'dup', site: 'two.example', email: 'two@example.com', name: 'Two', ssh: {key_name: 'Deploy'}},
];

{
  const f = fixture();
  f.unlock({secret: 'hidden-secret', services: validServices});
  const options = await f.invoke({action: 'keygrain.ssh.options'});
  assert.deepEqual(options.result.items.map(item => [item.id, item.site, item.email, item.keyName, item.counter]), [
    ['dup', 'one.example', 'one@example.com', 'github', 2], ['dup', 'two.example', 'two@example.com', 'deploy', 1],
  ]);
  assert.deepEqual(Object.keys(options.result.items[0]), ['selectionToken', 'id', 'site', 'name', 'email', 'keyName', 'counter']);
  assert.equal(JSON.stringify(options).includes('hidden-secret'), false);
  const generated = await f.invoke({action: 'keygrain.ssh.generate', selectionToken: options.result.items[0].selectionToken});
  assert.deepEqual(Object.keys(generated.result), ['authorizedKeys', 'privateKeyPem']);
  assert.equal(f.calls.derive.length, 1);
  assert.equal(f.calls.derive[0][1], 'one@example.com');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.derive[0][2])), {keyName: 'github', counter: 2});
  assert.equal(JSON.stringify(generated).includes('hidden-secret'), false);
  assert.equal(JSON.stringify(generated).includes('seed'), false);
  assert.equal((await f.invoke({action: 'keygrain.ssh.generate', selectionToken: options.result.items[0].selectionToken})).code, 'KEYGRAIN_STALE_OPERATION');
  console.log('  ✓ SSH owner options, normalization, duplicates, exact output, and replay');
}

{
  const f = fixture();
  f.unlock({secret: 'secret', services: [{id: 'valid', site: 'valid.example', email: 'v@example.com', ssh: {key_name: 'ok'}},
    {id: 'bad', site: 'bad.example', email: 'b@example.com', ssh: {key_name: 'ok', unknown: true}}]});
  const badResult = await f.invoke({action: 'keygrain.ssh.options'});
  assert.equal(badResult.code, 'KEYGRAIN_SSH_ERROR');
  assert.equal(f.calls.derive.length, 0);
  for (const path of ['/wallet-page.html', '/help.html', '/import.html', '/migrate.html']) {
    const sender = {...f.trusted, url: `chrome-extension://ext${path}`};
    assert.equal((await f.invoke({action: 'keygrain.ssh.options'}, sender)).code, 'KEYGRAIN_CONTEXT_ERROR', path);
  }
  const untrusted = {id: 'other', tab: null, url: 'chrome-extension://other/popup.html'};
  const hostile = new Proxy({}, {get() { throw new Error('schema touched'); }, ownKeys() { throw new Error('schema touched'); }});
  assert.equal((await f.invoke(hostile, untrusted)).code, 'KEYGRAIN_CONTEXT_ERROR');
  const trustedWalletPage = {...f.trusted, url: 'chrome-extension://ext/wallet-page.html'};
  assert.equal((await f.invoke(hostile, trustedWalletPage)).code, 'KEYGRAIN_CONTEXT_ERROR');
  for (const request of [
    {action: 'keygrain.ssh.options', extra: true},
    {selectionToken: 'x', action: 'keygrain.ssh.generate'},
    {action: 'keygrain.ssh.generate', selectionToken: 'x', extra: true},
    {action: 'keygrain.ssh.generate', selectionToken: ''},
  ]) assert.equal((await f.invoke(request)).code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR');
  assert.equal((await f.invoke({action: 'wallet'})).code, 'KEYGRAIN_CONSUMER_MIGRATION_REQUIRED');
  console.log('  ✓ exact popup boundary, context precedence, malformed records, envelopes, and wallet fail-closed');
}

{
  const f = fixture({authorized: 'bad'});
  f.unlock({secret: 'secret', services: [{id: 'svc', site: 'svc.example', email: 's@example.com', ssh: {key_name: 'key'}}]});
  const options = await f.invoke({action: 'keygrain.ssh.options'});
  assert.equal((await f.invoke({action: 'keygrain.ssh.generate', selectionToken: options.result.items[0].selectionToken})).code, 'KEYGRAIN_SSH_ERROR');
  assert.equal(f.calls.derive.length, 1);
  const wrongComment = fixture({authorized: (publicKey, comment) => validAuthorized(publicKey, 'other@example.com:key')});
  wrongComment.unlock({secret: 'secret', services: [{id: 'svc', site: 'svc.example', email: 's@example.com', ssh: {key_name: 'key'}}]});
  const wrongCommentOptions = await wrongComment.invoke({action: 'keygrain.ssh.options'});
  assert.equal((await wrongComment.invoke({action: 'keygrain.ssh.generate', selectionToken: wrongCommentOptions.result.items[0].selectionToken})).code, 'KEYGRAIN_SSH_ERROR');
  const emptyPem = fixture({privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\n-----END OPENSSH PRIVATE KEY-----\n'});
  emptyPem.unlock({secret: 'secret', services: [{id: 'svc', site: 'svc.example', email: 's@example.com', ssh: {key_name: 'key'}}]});
  const emptyPemOptions = await emptyPem.invoke({action: 'keygrain.ssh.options'});
  assert.equal((await emptyPem.invoke({action: 'keygrain.ssh.generate', selectionToken: emptyPemOptions.result.items[0].selectionToken})).code, 'KEYGRAIN_SSH_ERROR');
  const ttl = fixture();
  ttl.unlock({secret: 'secret', services: [{id: 'svc', site: 'svc.example', email: 's@example.com', ssh: {key_name: 'key'}}]});
  const staged = await ttl.invoke({action: 'keygrain.ssh.options'});
  ttl.setNow(31000);
  assert.equal((await ttl.invoke({action: 'keygrain.ssh.generate', selectionToken: staged.result.items[0].selectionToken})).code, 'KEYGRAIN_STALE_OPERATION');
  assert.equal(ttl.calls.derive.length, 0);
  console.log('  ✓ formatter failure, exact TTL boundary, consume-before-derive, and no partial output');
}

{
  const context = createContext({Array, ArrayBuffer, DataView, Error, Object, Uint8Array, TextEncoder, btoa, console});
  runInContext('globalThis = this; hmacSHA256 = async () => new Uint8Array([0, 0, 0, 1]);', context);
  runInContext(sshSource, context);
  const publicKey = new Uint8Array(32).fill(8);
  const seed = new Uint8Array(32).fill(7);
  const authorized = runInContext('formatAuthorizedKeys(publicKey, "user@example.com:github")', Object.assign(context, {publicKey}));
  const pem = await runInContext('formatOpensshPrivateKey(seed, publicKey, "user@example.com:github")', Object.assign(context, {seed, publicKey}));
  assert.match(authorized, /^ssh-ed25519 [A-Za-z0-9+/]+=* user@example\.com:github$/);
  assert.match(pem, /^-----BEGIN OPENSSH PRIVATE KEY-----\n[\s\S]+-----END OPENSSH PRIVATE KEY-----\n$/);
  assert.equal(authorized, runInContext('formatAuthorizedKeys(publicKey, "user@example.com:github")', context));
  console.log('  ✓ unchanged SSH formatter deterministic shape and bounds');
}

{
  const chromeBackground = readFileSync(resolve(__dirname, '..', 'chrome', 'background.js'), 'utf8');
  const firefoxManifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'firefox', 'manifest.json'), 'utf8'));
  const chromeLoader = chromeBackground.match(/^importScripts\((.*)\);/m)?.[1] || '';
  const chromeEntries = [...chromeLoader.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const firefoxEntries = firefoxManifest.background.scripts;
  for (const loader of [chromeEntries, firefoxEntries]) {
    assert.equal(loader.filter(entry => entry === 'lib/tweetnacl.js').length, 1);
    assert.equal(loader.filter(entry => entry === 'ssh.js').length, 1);
    assert(loader.indexOf('lib/tweetnacl.js') < loader.indexOf('ssh.js'));
    assert(loader.indexOf('ssh.js') < loader.indexOf('browser-owner.js'));
  }
  assert.equal(firefoxManifest.manifest_version, 3);
  assert.equal(createHash('sha256').update(readFileSync(resolve(shared, 'ssh.js'))).digest('hex'), 'b77487148efc24ca0a375d8d0191e376ae497bd7e8ce18edebf8ebf2308f2228');
  assert.equal(createHash('sha256').update(readFileSync(resolve(shared, 'lib/tweetnacl.js'))).digest('hex'), '3ec535c004aeeb225785d8e93fb33bf99f52e399bd7dfc01969b5629baea5131');
  console.log('  ✓ Chrome/Firefox MV3 loader order, no duplication, MV3 marker, and primitive hashes');
}

console.log('B3 SSH contract tests passed');
