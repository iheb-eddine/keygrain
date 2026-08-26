import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = resolve(__dirname, '..', 'shared');
const popupHtml = readFileSync(resolve(shared, 'popup.html'), 'utf8');
const popupScriptInventory = [...popupHtml.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
assert.deepEqual(popupScriptInventory, [
  'compat.js', 'lib/hash-wasm-argon2.js', 'lib/tweetnacl.js', 'keygrain.js', 'totp.js', 'ssh.js',
  'autofill.js', 'popup-crypto.js', 'worker-ingress.js', 'popup-dialog.js', 'popup-search.js',
  'diagnostics.js', 'migration-state.js', 'popup.js',
], 'popup loads the exact owner-consumer script inventory');
assert.equal(popupScriptInventory.at(-1), 'popup.js', 'popup.js is the final application script');
assert(popupScriptInventory.indexOf('worker-ingress.js') < popupScriptInventory.indexOf('popup.js'),
  'worker ingress loads before popup.js');
assert(popupScriptInventory.indexOf('diagnostics.js') < popupScriptInventory.indexOf('popup.js'),
  'diagnostics loads before popup.js');
for (const forbiddenModule of ['sync.js', 'popup-rules.js', 'popup-breach.js']) {
  assert.equal(popupScriptInventory.includes(forbiddenModule), false,
    `${forbiddenModule} is not evaluated in the popup`);
}
for (const id of ['menu-btn', 'settings-btn', 'lock-btn', 'export-btn', 'import-btn', 'migrate-btn', 'help-btn', 'offline-btn', 'switch-account-btn']) {
  assert.match(popupHtml, new RegExp(`id="${id}"`), `popup HTML retains the unsupported control boundary for ${id}`);
}

const directNetworkApi = /(?:fetch|XMLHttpRequest|WebSocket)\s*\(/;
for (const script of popupScriptInventory) {
  const source = readFileSync(resolve(shared, script), 'utf8');
  assert.doesNotMatch(source, directNetworkApi,
    `${script} has no direct network API path in the popup bundle`);
}

const context = createContext({
  TextEncoder, TextDecoder, URL, console, crypto: webcrypto, normalizeSite: value => String(value).toLowerCase(),
});
runInContext('globalThis = this;', context);
runInContext('globalThis.importScripts = () => {};', context);
runInContext('globalThis.importScripts = () => {};', context);
runInContext(readFileSync(resolve(shared, 'unlock-state.js'), 'utf8'), context);
runInContext(readFileSync(resolve(shared, 'browser-owner.js'), 'utf8'), context);
runInContext(`globalThis.owner = KeygrainBrowserOwner.createOwner({
  adapter: {browser: 'chrome', storage: {async get() { return {}; }, async set() {}, async remove() {}}, async commitKeygrainPopupServiceEdit() { return {ok: true}; }, async commitKeygrainPopupServiceAdd() { return {ok: true}; }, async commitKeygrainPopupServiceDelete() { return {ok: true}; }},
  settings: {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400},
  clock: () => 1000,
});`, context);

const trusted = runInContext(`({id: 'ext', tab: null, url: 'chrome-extension://ext/popup.html'})`, context);
const trustedBackground = runInContext(`({id: 'ext', tab: null, url: 'chrome-extension://ext/background.js'})`, context);
const untrusted = runInContext(`({id: 'other', tab: null, url: 'chrome-extension://other/popup.html'})`, context);
const invoke = async (sender, request) => {
  context._sender = sender;
  context._request = request;
  const result = await runInContext('owner.dispatchPopupRequest(_sender, "ext", _request, "chrome", "chrome-extension://ext")', context);
  return JSON.parse(JSON.stringify(result));
};
const invokeAction = async (sender, action) => {
  context._sender = sender;
  context._action = action;
  const result = await runInContext('owner.dispatchPopupRequest(_sender, "ext", {action: _action}, "chrome", "chrome-extension://ext")', context);
  return JSON.parse(JSON.stringify(result));
};

const expectedReserved = [
  'heartbeat', 'extendSensitive', 'setSecret', 'setEmail', 'setSecrets', 'clearEmail',
  'getSecret', 'getEmail', 'getFullData', 'getRecords', 'decryptServices',
  'derivePassword', 'deriveTOTP', 'fillInline', 'fillInlineOtp', 'fill_credentials',
  'sync', 'syncAlarm', 'syncRetry', 'reregisterInlineAutofill',
  'inlineAutofillEnabledChanged', 'import', 'wallet', 'migrate', 'password', 'totp',
  'ssh', 'export', 'add', 'edit', 'delete', 'rotate', 'offline', 'switchAccount',
  'deleteServerData', 'pinUnlock', 'pinSetup', 'lockSensitive', 'lockEverything',
  'ownerOperation', 'getOwnerState', 'saveSecuritySettings', 'extendFull', 'extendMetadata',
];

assert.deepEqual([...context.KeygrainBrowserOwner.POPUP_RESERVED_ACTIONS].sort(), [...expectedReserved].sort(),
  'reserved inventory is the complete design inventory');

const beforeGeneration = runInContext('owner.manager.snapshot().authorizationGeneration', context);
for (const action of expectedReserved) {
  const result = await invokeAction(trusted, action);
  assert.deepEqual(result, {
    ok: false,
    code: 'KEYGRAIN_CONSUMER_MIGRATION_REQUIRED',
    message: 'Update Keygrain to continue.',
  }, `trusted reserved action ${action} is migration-required`);
}
assert.equal(runInContext('owner.manager.snapshot().authorizationGeneration', context), beforeGeneration,
  'reserved actions do not mutate manager authorization');

for (const action of ['futureAction', 'unlock', 'keygrain.popup.unknown']) {
  const result = await invokeAction(trusted, action);
  assert.deepEqual(result, {
    ok: false,
    code: 'KEYGRAIN_AUTH_PROTOCOL_ERROR',
    message: 'Invalid authentication request.',
  }, `trusted unknown action ${action} is protocol-invalid`);
}

for (const action of ['heartbeat', 'futureAction']) {
  const result = await invokeAction(untrusted, action);
  assert.deepEqual(result, {
    ok: false,
    code: 'KEYGRAIN_CONTEXT_ERROR',
    message: 'This action is not available from this context.',
  }, `untrusted action ${action} is context-invalid before action probing`);
}

runInContext(`globalThis.probed = false;
globalThis.getterRequest = {};
Object.defineProperty(getterRequest, 'action', {enumerable: true, get() { probed = true; throw new Error('probe'); }});`, context);
const getterResult = await invoke(untrusted, runInContext('getterRequest', context));
assert.equal(getterResult.code, 'KEYGRAIN_CONTEXT_ERROR');
assert.equal(runInContext('probed', context), false, 'untrusted sender is rejected before getter/action probing');
const trustedGetterResult = await invoke(trusted, runInContext('getterRequest', context));
assert.equal(trustedGetterResult.code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR');
assert.equal(runInContext('probed', context), false, 'accessor is inspected as a descriptor, never invoked');

const malformed = [
  runInContext('null', context),
  runInContext('[]', context),
  runInContext('({action: 7})', context),
  runInContext('({action: "heartbeat", extra: true})', context),
];
for (const request of malformed) {
  const result = await invoke(trusted, request);
  assert.equal(result.code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR', 'malformed trusted request is protocol-invalid');
}
assert.equal((await invoke(trustedBackground, runInContext('null', context))).code, 'KEYGRAIN_CONTEXT_ERROR',
  'background sender is rejected before popup schema probing');
assert.equal((await invoke(untrusted, runInContext('null', context))).code, 'KEYGRAIN_CONTEXT_ERROR',
  'untrusted malformed request is still context-invalid');

for (const sender of [trustedBackground,
  runInContext(`({id: 'ext', tab: null, url: 'chrome-extension://ext/popup.html?x=1'})`, context),
  runInContext(`({id: 'ext', tab: {id: 1}, url: 'chrome-extension://ext/popup.html'})`, context)]) {
  assert.equal((await invokeAction(sender, 'heartbeat')).code, 'KEYGRAIN_CONTEXT_ERROR',
    'non-popup-path/query/tab sender is rejected safely');
}

const state = await invokeAction(trusted, 'keygrain.popup.state');
assert.equal(state.ok, true);
assert.deepEqual(Object.keys(state), ['ok', 'result']);
assert.deepEqual(Object.keys(state.result), [
  'state', 'stateGeneration', 'authorizationGeneration',
  'fullExpiresAt', 'metadataExpiresAt', 'fullWarningAt', 'metadataWarningAt',
  'metadataAvailable', 'hasFullData', 'email',
]);
assert.equal(state.result.state, 'locked');
assert.equal((await invokeAction(trusted, 'keygrain.popup.metadata')).code, 'KEYGRAIN_METADATA_ERROR');
assert.equal((await invokeAction(trusted, 'keygrain.popup.serviceList')).code, 'KEYGRAIN_EXPIRED');

runInContext(`owner.manager.unlockFull({
  fullData: {
    secret: 'must-not-cross',
    email: 'owner@example.com',
    services: [
      {id: 'duplicate', site: 'one.example', name: 'One', email: 'one@example.com', password: 'secret', totp: {seed: 'hidden'}, ssh: {private: 'hidden'}, updated_at: 1},
      {id: 'duplicate', site: 'two.example', name: 'Two', wallet: {mnemonic: 'hidden'}, token: 'hidden', matches: ['hidden']},
    ],
    wallets: [], walletAuditLog: [], tombstones: [], deletionReview: [],
  },
  records: [
    {id: 'duplicate', site: 'one.example', name: 'One', email: 'one@example.com'},
    {id: 'duplicate', site: 'two.example', name: 'Two'},
  ],
})`, context);
const fullList = await invokeAction(trusted, 'keygrain.popup.serviceList');
assert.equal(fullList.ok, true, 'full service-list succeeds with full records');
assert.deepEqual(fullList, {
  ok: true,
  result: {items: [
    {id: 'duplicate', site: 'one.example', name: 'One', email: 'one@example.com'},
    {id: 'duplicate', site: 'two.example', name: 'Two', email: null},
  ]},
}, 'full service-list returns only the bounded four-field projection in source order');
assert.deepEqual(Object.keys(fullList.result.items[0]), ['id', 'site', 'name', 'email']);

runInContext(`owner.manager.lockEverything(); owner.manager.unlockFull({
  fullData: {services: [{id: null, site: 'bad.example', name: 'Bad', email: 'bad@example.com'}]},
  records: [{site: 'bad.example', name: 'Bad', email: 'bad@example.com'}],
})`, context);
const malformedPresentNull = await invokeAction(trusted, 'keygrain.popup.serviceList');
assert.equal(malformedPresentNull.code, 'KEYGRAIN_OPERATION_ERROR', 'present null manager field is malformed');
runInContext(`owner.manager.unlockFull({
  fullData: {services: [{id: 'finalize', site: 'finalize.example', name: 'Finalize', email: 'f@example.com'}]},
  records: [{id: 'finalize', site: 'finalize.example', name: 'Finalize', email: 'f@example.com'}],
})`, context);
runInContext(`globalThis.finalizerCalls = [];
globalThis.originalComplete = owner.manager.completeSensitiveOperation;
owner.manager.completeSensitiveOperation = function (...args) { finalizerCalls.push('complete'); return originalComplete.apply(this, args); };`, context);
const completedList = await invokeAction(trusted, 'keygrain.popup.serviceList');
assert.equal(completedList.ok, true);
assert.deepEqual(JSON.parse(runInContext('JSON.stringify(finalizerCalls)', context)), ['complete'], 'success has exactly one completion finalizer');

runInContext(`owner.manager.completeSensitiveOperation = function () { finalizerCalls.push('complete-throw'); throw new Error('finalizer'); };`, context);
const finalizerFailure = await invokeAction(trusted, 'keygrain.popup.serviceList');
assert.equal(finalizerFailure.code, 'KEYGRAIN_OPERATION_ERROR', 'completion finalizer failure is safe');
assert.deepEqual(JSON.parse(runInContext('JSON.stringify(finalizerCalls)', context)), ['complete', 'complete-throw'], 'finalizer failure is not retried with another terminal method');
runInContext('owner.manager.completeSensitiveOperation = originalComplete; owner.manager.lockEverything()', context);

runInContext(`owner.manager.unlockFull({
  fullData: {services: [{id: 'stale', site: 'stale.example', name: 'Stale', email: 'stale@example.com'}]},
  records: [{id: 'stale', site: 'stale.example', name: 'Stale', email: 'stale@example.com'}],
})`, context);
runInContext(`globalThis.originalInput = owner.manager.getSensitiveOperationInput;
owner.manager.getSensitiveOperationInput = function (handle) { const input = originalInput.call(this, handle); this.lockEverything(); return input; };`, context);
const staleList = await invokeAction(trusted, 'keygrain.popup.serviceList');
assert.equal(staleList.code, 'KEYGRAIN_OPERATION_ERROR', 'generation change before delivery fails closed');
runInContext('owner.manager.getSensitiveOperationInput = originalInput', context);

const ownerApiKeys = JSON.parse(runInContext('JSON.stringify(Object.keys(owner))', context));
for (const forbiddenApi of ['withSensitiveOperation', 'getFullData', 'getRecords', 'getSecret', 'getEmail', 'setSecret', 'setEmail', 'setSecrets']) {
  assert.equal(ownerApiKeys.includes(forbiddenApi), false, `owner does not expose ${forbiddenApi}`);
}
assert.doesNotMatch(readFileSync(resolve(shared, 'browser-owner.js'), 'utf8'), /withSensitiveOperation\s*\(/);
assert.doesNotMatch(readFileSync(resolve(shared, 'browser-owner.js'), 'utf8'), /\{kind,\s*capture,\s*context,\s*work,\s*deliver\}/);

const popupSource = readFileSync(resolve(shared, 'popup.js'), 'utf8');
assert.match(popupSource, /popupRenderItems/);
assert.match(popupSource, /epoch !== renderEpoch/);
for (const forbidden of [
  'currentSecret', 'currentEmail', 'chrome.storage.local', 'decryptServices', 'derivePassword',
  'deriveTOTP', 'deriveSshKeypair', 'syncWithServer', 'saveServices', 'getTOTPCode',
  'getFullData', 'getRecords', 'fullData', 'walletAuditLog', 'tombstones', 'deletionReview',
]) assert.doesNotMatch(popupSource, new RegExp(forbidden), `popup has no ${forbidden} authority/path`);
assert.doesNotMatch(popupSource, /action:\s*["']unlock["']/);
assert.match(popupSource, /FIXED_ACTIONS/);
assert.match(popupSource, /secretFingerprint/);
assert.match(popupSource, /WONG_PALETTE/);
assert.match(popupSource, /fingerprintGeneration/);
assert.match(popupSource, /clearFingerprint\(\)/);
assert.match(popupSource, /KeygrainWorkerIngress\.makeEnvelope/);
assert.match(popupSource, /const deliveryStateResponse = await sendMsg\(\{action: FIXED_ACTIONS\.state\}\)/);
assert.match(popupSource, /if \(!stateResponse\?\.ok\) \{\s*renderItems\(\[\]\);/);

assert.match(popupSource, /deliveryState\.stateGeneration !== state\.stateGeneration/);
assert.match(popupSource, /deliveryState\.authorizationGeneration !== state\.authorizationGeneration/);
assert.match(popupSource, /const unlockResponse = await sendMsg\(\{action: "unlockEncrypted", popupSessionId, envelope\}\);[\s\S]*emailInput\) emailInput\.value = "";[\s\S]*secretInput\) secretInput\.value = "";[\s\S]*requestOwnerView/);
assert.match(popupSource, /scheduleConfirmFingerprint/);
assert.match(popupSource, /clearConfirmFingerprint/);
assert.match(popupSource, /setAuthMode/);
assert.match(popupSource, /createAccountFromForm/);
assert.match(popupSource, /leaseStatus\.classList\.remove\("hidden"\)/);

assert.match(popupSource, /sshOptions: "keygrain\.ssh\.options"/);
assert.match(popupSource, /sshGenerate: "keygrain\.ssh\.generate"/);
assert.match(popupSource, /function showUpdateRequiredScreen\(\) \{\s*renderEpoch\+\+/);
assert.match(popupSource, /addEventListener\("pagehide"/);
for (const forbidden of ['document.cookie']) {
  assert.doesNotMatch(popupSource, new RegExp(forbidden), `popup has no ${forbidden} sink`);
}
assert.match(popupSource, /downloadTextFile/);

function sshPopupHarness(options = {}) {
  class Element {
    constructor(id = '') { this.id = id; this.children = []; this.handlers = {}; this.attributes = {}; this._textContent = ''; this.disabled = false; this.value = ''; this.className = ''; this.dataset = {}; this.style = {}; this.classList = {add() {}, remove() {}, toggle() {}}; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    set textContent(value) { this._textContent = String(value); if (value === '') this.children = []; }
    get textContent() { return this._textContent; }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
    focus() {}
  }
  const ids = ['loading-screen', 'lock-screen', 'update-required-screen', 'main-screen', 'pin-screen', 'email', 'secret', 'fingerprint', 'auth-mode-unlock', 'auth-mode-create', 'create-confirm-group', 'confirm-secret', 'confirm-fingerprint', 'confirm-secret-match', 'unlock-btn', 'create-btn', 'status', 'service-list', 'search', 'sync-error', 'autolock-warning', 'autolock-extend', 'version-display', 'try-demo'];
  const elements = new Map(ids.map(id => [id, new Element(id)]));
  const messages = [];
  const runtime = {
    getManifest() { return {name: 'Keygrain Keygrain DEV', version: '1'}; },
    async sendMessage(message) {
      messages.push(message);
      if (message.action === 'keygrain.popup.state') return {ok: true, result: {state: 'full', stateGeneration: 1, authorizationGeneration: 1, fullExpiresAt: 60000, metadataExpiresAt: null, fullWarningAt: 30000, metadataWarningAt: null, metadataAvailable: false, hasFullData: true}};
      if (message.action === 'keygrain.popup.serviceList') return {ok: true, result: {items: options.serviceItems || [{id: 'svc', site: 'example.com', name: null, email: 'user@example.com'}]}};
      if (message.action === 'keygrain.popup.selectionOptions') {
        const items = options.serviceItems || [{id: 'svc', site: 'example.com', name: null, email: 'user@example.com'}];
        return {ok: true, result: {items: items.map((item, index) => ({detailSelectionToken: `detail-token-${index}`, id: item.id, site: item.site, name: item.name, email: item.email}))}};
      }
      if (message.action === 'keygrain.password.options') {
        const items = options.serviceItems || [{id: 'svc', site: 'example.com', name: null, email: 'user@example.com'}];
        return {ok: true, result: {items: items.map((item, index) => ({selectionToken: `password-token-${index}`, id: item.id, site: item.site, name: item.name, email: item.email}))}};
      }
      if (message.action === 'keygrain.ssh.options') return {ok: true, result: {items: [{selectionToken: 'ssh-token', id: 'svc', site: 'example.com', name: null, email: 'user@example.com', keyName: 'github', counter: 1}]}};
      if (message.action === 'keygrain.ssh.generate') return {ok: true, result: {authorizedKeys: 'ssh-ed25519 AAAA user@example.com:github', privateKeyPem: '-----BEGIN OPENSSH PRIVATE KEY-----\nYWJj\n-----END OPENSSH PRIVATE KEY-----\n'}};
      if (message.action === 'keygrain.wallet.options') return {ok: true, result: {items: [{selectionToken: 'wallet-token', walletName: 'personal', chain: 'bitcoin', email: 'user@example.com'}]}};
      if (message.action === 'keygrain.wallet.generate') return {ok: true, result: {mnemonic: Array.from({length: 24}, () => 'word').join(' ')}};
      return {ok: false, code: 'KEYGRAIN_AUTH_PROTOCOL_ERROR', message: 'Invalid authentication request.'};
    },
  };
  let unload;
  let pagehide;
  const document = {getElementById(id) { return elements.get(id) || null; }, createElement() { return new Element(); }};
  const window = {addEventListener(type, fn) { if (type === 'unload') unload = fn; if (type === 'pagehide') { pagehide = fn; unload = fn; } }};
  const ctx = createContext({document, window, chrome: {runtime}, console, TextEncoder, TextDecoder, URL,
    crypto: {randomUUID() { return 'popup-id'; }, getRandomValues(bytes) { bytes.fill(1); return bytes; }},
    secretFingerprint: options.secretFingerprint || (async () => [0, 1, 2, 3]),
    WONG_PALETTE: ['#000000', '#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7'],
    KeygrainDiagnostics: {recordWorkerResponse() {}, record() {}}, KeygrainWorkerIngress: {makeEnvelope: async () => ({})},
    Object, Array, Map, Set, Promise, Number, String, Error, JSON, Math, RegExp, Uint8Array, Date, setTimeout, clearTimeout, setInterval, clearInterval,
  });
  ctx.globalThis = ctx;
  runInContext(popupSource, ctx);
  return {elements, messages, unload: () => unload?.(), pagehide: () => pagehide?.()};
}

{
  const popup = sshPopupHarness();
  const secret = popup.elements.get('secret');
  const fingerprint = popup.elements.get('fingerprint');
  secret.value = 'first-secret';
  secret.handlers.input();
  assert.equal(fingerprint.textContent, '⏳', 'fingerprint shows a bounded loading state');
  await new Promise(resolvePromise => setTimeout(resolvePromise, 550));
  assert.equal(fingerprint.children.length, 4, 'fingerprint renders four dots');
  assert.deepEqual(fingerprint.children.map(child => child.style.background), ['#000000', '#E69F00', '#56B4E9', '#009E73']);
  secret.value = '';
  secret.handlers.input();
  assert.equal(fingerprint.children.length, 0, 'clearing the secret clears fingerprint dots');
}

{
  let resolveOld;
  const popup = sshPopupHarness({secretFingerprint: async secret => {
    if (secret === 'old-secret') return await new Promise(resolvePromise => { resolveOld = resolvePromise; });
    if (secret === 'bad-secret') throw new Error('fingerprint failure');
    if (secret === 'malformed-secret') return [0, 1, 2, 8];
    return [4, 5, 6, 7];
  }});
  const secret = popup.elements.get('secret');
  const fingerprint = popup.elements.get('fingerprint');
  secret.value = 'old-secret';
  secret.handlers.input();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 550));
  secret.value = 'new-secret';
  secret.handlers.input();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 550));
  assert.equal(fingerprint.children[0].style.background, '#F0E442', 'new fingerprint renders before stale result resolves');
  resolveOld([0, 0, 0, 0]);
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  assert.equal(fingerprint.children[0].style.background, '#F0E442', 'stale fingerprint cannot overwrite newer result');
  secret.value = 'bad-secret';
  secret.handlers.input();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 550));
  assert.equal(fingerprint.children.length, 0, 'invalid fingerprint result fails closed');
  secret.value = 'malformed-secret';
  secret.handlers.input();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 550));
  assert.equal(fingerprint.children.length, 0, 'malformed palette indices fail closed');
  popup.unload();
  assert.equal(fingerprint.children.length, 0, 'unload clears fingerprint output');
  popup.pagehide();
  assert.equal(fingerprint.children.length, 0, 'pagehide clears fingerprint output');
  console.log('  ✓ fingerprint rendering is bounded, stale-safe, fail-closed, and transient');
}

{
  const popup = sshPopupHarness({serviceItems: [
    {id: 'first', site: 'first.example', name: '<img>', email: 'first@example.com'},
    {id: 'second', site: 'second.example', name: null, email: null},
  ]});
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  const rows = popup.elements.get('service-list').children;
  assert.match(popupHtml, /<div id="service-list" role="listbox"><\/div>/, 'service list has a listbox parent');
  assert.equal(rows.length, 2, 'all bounded service projections render in source order');
  assert.equal(rows[0].className, 'service-item');
  assert.equal(rows[0].id, 'service-item-0');
  assert.equal(rows[0].getAttribute('role'), 'option');
  assert.equal(rows[0].getAttribute('tabindex'), '-1');
  assert.equal(rows[0].getAttribute('aria-selected'), 'false');
  assert.equal(rows[0].children[0].className, 'service-info');
  assert.equal(rows[0].children[0].children[0].className, 'service-name');
  assert.equal(rows[0].children[0].children[0].textContent, '<img>');
  assert.equal(rows[0].children[0].children[1].className, 'service-site');
  assert.equal(rows[0].children[0].children[1].textContent, 'first.example');
  assert.equal(rows[1].id, 'service-item-1');
  assert.equal(rows[1].children[0].children[0].textContent, 'second.example');
  assert.equal(rows[1].children[0].children[2].textContent, '');
  console.log('  ✓ service rows are accessible, ordered, null-safe, and text-only');
}

{
  const popup = sshPopupHarness();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  const row = popup.elements.get('service-list').children[0];
  const sshRow = row.children.find(child => child.className === 'ssh-row');
  assert(sshRow, 'service item includes inline SSH row');
  const copyPubBtn = sshRow.children.find(child => child.className === 'ssh-copy-btn');
  assert(copyPubBtn, 'SSH row includes copy pubkey button');
  await copyPubBtn.handlers.click();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(popup.messages.find(message => message.action === 'keygrain.ssh.generate'))), {action: 'keygrain.ssh.generate', selectionToken: 'ssh-token'});
  console.log('  ✓ popup SSH row is compact, explicit, token-only, transient, and cleared on unload');
}


async function runBackgroundParityCase(browserName) {
  const source = readFileSync(resolve(__dirname, '..', browserName, 'background.js'), 'utf8');
  const scheme = browserName === 'chrome' ? 'chrome-extension' : 'moz-extension';
  const runtimeId = 'parity-extension';
  const extensionOrigin = `${scheme}://${browserName === 'chrome' ? runtimeId : 'parity-uuid'}`;
  let handler;
  const storage = {
    async get(key) {
      if (key === 'keygrainSecurityLeaseSettings') return {keygrainSecurityLeaseSettings: {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400}};
      if (key === 'settings') return {};
      return {};
    },
    async set() {},
    async remove() {},
  };
  const runtime = {
    id: runtimeId,
    getURL() { return `${extensionOrigin}/`; },
    onMessage: {addListener(fn) { handler = fn;}},
    onSuspend: {addListener() {}},

  };
  const api = {
    storage: {local: storage}, runtime,
    tabs: {query: async () => [], onActivated: {addListener() {}}, onUpdated: {addListener() {}}},
    alarms: {clear: async () => {}, create: async () => {}, onAlarm: {addListener() {}}},
    action: {setBadgeText: async () => {}},
    scripting: {
      getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => {},
      registerContentScripts: async () => {}, executeScript: async () => {},
    },
  };
  const context = createContext({TextEncoder, TextDecoder, URL, console, importScripts() {},
    ...(browserName === 'chrome' ? {chrome: api} : {browser: api})});
  runInContext('globalThis = this;', context);
runInContext('globalThis.importScripts = () => {};', context);
  runInContext(readFileSync(resolve(shared, 'unlock-state.js'), 'utf8'), context);
  runInContext(readFileSync(resolve(shared, 'browser-owner.js'), 'utf8'), context);
  context.ownerStorage = storage;
  runInContext('globalThis.now = 1000;', context);
  runInContext(`globalThis.realOwner = KeygrainBrowserOwner.createOwner({
    adapter: {browser: ${JSON.stringify(browserName)}, storage: ownerStorage, async reconcileIndicators() {}, shutdown() {}},
    settings: {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400}, clock: () => now,
  });`, context);
  context.KeygrainBrowserOwner = Object.freeze({...context.KeygrainBrowserOwner, createOwner: () => context.realOwner});
  context.KeygrainWorkerIngress = {
    createIngress: async () => ({issueChallenge: async () => ({}), admitUnlock: async () => ({ok: true}), revokeAll() {}}),
  };
  runInContext(source, context);
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  const sender = runInContext(`({id:${JSON.stringify(runtimeId)}, tab:null, url:${JSON.stringify(`${extensionOrigin}/popup.html`)}})`, context);
  const invoke = async request => {
    context.request = request;
    const result = browserName === 'chrome'
      ? await new Promise((resolvePromise, rejectPromise) => {
        try {
          const returned = handler(request, sender, resolvePromise);
          if (returned && typeof returned.then === 'function') returned.then(resolvePromise, rejectPromise);
        } catch (error) { rejectPromise(error); }
      })
      : await handler(request, sender);
    return JSON.parse(JSON.stringify(result));
  };
  const fixedState = await invoke(runInContext('({action:"keygrain.popup.state"})', context));
  assert.equal(fixedState.ok, true, `${browserName}: fixed state reaches actual listener`);
  assert.deepEqual(Object.keys(fixedState.result), [
    'state', 'stateGeneration', 'authorizationGeneration', 'fullExpiresAt', 'metadataExpiresAt',
    'fullWarningAt', 'metadataWarningAt', 'metadataAvailable', 'hasFullData', 'email',
  ]);
  assert.equal((await invoke(runInContext('({action:"keygrain.popup.metadata"})', context))).code, 'KEYGRAIN_METADATA_ERROR');
  assert.equal((await invoke(runInContext('({action:"keygrain.popup.serviceList"})', context))).code, 'KEYGRAIN_EXPIRED');
  assert.equal((await invoke(runInContext('({action:"heartbeat"})', context))).code, 'KEYGRAIN_CONSUMER_MIGRATION_REQUIRED');
  assert.equal((await invoke(runInContext('({action:"futureAction"})', context))).code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR');

  runInContext(`realOwner.manager.unlockFull({fullData:{services:[
    {id:'p',site:'parity.example',name:'Parity',email:'p@example.com',password:'hidden',totp:{seed:'hidden'}}
  ]},records:[{id:'p',site:'parity.example',name:'Parity',email:'p@example.com'}]})`, context);
  const list = await invoke(runInContext('({action:"keygrain.popup.serviceList"})', context));
  assert.deepEqual(list.result.items, [{id: 'p', site: 'parity.example', name: 'Parity', email: 'p@example.com'}],
    `${browserName}: full projection parity`);

  runInContext('now = 62000', context);
  const metadata = await invoke(runInContext('({action:"keygrain.popup.metadata"})', context));
  assert.deepEqual(metadata.result.items, [{id: 'p', site: 'parity.example', name: 'Parity', email: 'p@example.com'}],
    `${browserName}: metadata fixed action parity`);

  runInContext(`realOwner.manager.lockEverything(); globalThis.probed = false; globalThis.getter = {}; Object.defineProperty(getter, 'action', {enumerable:true, get(){probed=true; throw new Error('probe');}});`, context);
  const untrusted = runInContext(`({id:'other',tab:null,url:${JSON.stringify(`${extensionOrigin}/popup.html`)}})`, context);
  context.sender = untrusted;
  const getterResult = browserName === 'chrome'
    ? await new Promise(resolvePromise => handler(context.getter, untrusted, resolvePromise))
    : await handler(context.getter, untrusted);
  assert.equal(getterResult.code, 'KEYGRAIN_CONTEXT_ERROR', `${browserName}: untrusted getter context mapping`);
  assert.equal(runInContext('probed', context), false, `${browserName}: untrusted getter not probed`);
}

for (const browserName of ['chrome', 'firefox']) await runBackgroundParityCase(browserName);


// Keygrain corrected LIST -> DETAIL worker contract: exact projections, opaque
// one-use capabilities, full-only gates, and no password precomputation.
runInContext(`globalThis.deriveCalls = 0; globalThis.derivePassword = async () => { deriveCalls++; return "should-not-run"; };\nowner.manager.lockEverything(); owner.manager.unlockFull({fullData:{services:[
  {id:null,site:'null.example',name:null,email:null,length:20,symbols:'!@',counter:1,totp:null,ssh:null},
  {id:'dup',site:'one.example',name:'One',email:'one@example.com',length:21,symbols:'!@#',counter:2,character_policy:'ascii-printable-v1',totp:{mode:'derived'},ssh:{key_name:'github',counter:1}},
  {id:'dup',site:'two.example',name:'Two',email:'two@example.com'},
]} ,records:[
  {site:'null.example'},
  {id:'dup',site:'one.example',name:'One',email:'one@example.com'},
  {id:'dup',site:'two.example',name:'Two',email:'two@example.com'},
]})`, context);
const selection = await invoke(trusted, {action: 'keygrain.popup.selectionOptions'});
assert.equal(selection.ok, true, 'selection options succeeds in full');
assert.deepEqual(Object.keys(selection.result.items[0]), ['detailSelectionToken', 'id', 'site', 'name', 'email']);
assert.deepEqual(selection.result.items.map(item => ({id:item.id,site:item.site,name:item.name,email:item.email})), [
  {id:null,site:'null.example',name:null,email:null},
  {id:'dup',site:'one.example',name:'One',email:'one@example.com'},
  {id:'dup',site:'two.example',name:'Two',email:'two@example.com'},
]);
assert.equal(JSON.stringify(selection).includes('password'), false, 'selection projection contains no password');
const firstSelectionToken = selection.result.items[1].detailSelectionToken;
const replacementSelection = await invoke(trusted, {action: 'keygrain.popup.selectionOptions'});
assert.equal((await invoke(trusted, {action:'keygrain.popup.detail', detailSelectionToken:firstSelectionToken})).code, 'KEYGRAIN_STALE_OPERATION', 'new selection set invalidates older selection capabilities');
const detail = await invoke(trusted, {action: 'keygrain.popup.detail', detailSelectionToken: replacementSelection.result.items[1].detailSelectionToken});
assert.equal(detail.ok, true, 'detail consumes an owner selection capability');
assert.deepEqual(Object.keys(detail.result.item), ['id','site','name','email','length','symbols','counter','characterPolicyPresent','characterPolicy','hasTotp','sshKeyName','totp','ssh']);
assert.deepEqual(detail.result.item, {
  id:'dup', site:'one.example', name:'One', email:'one@example.com', length:21, symbols:'!@#', counter:2,
  characterPolicyPresent:true, characterPolicy:'ascii-printable-v1', hasTotp:true, sshKeyName:'github',
  totp: { mode: 'derived', algorithm: 'SHA1', digits: 6, period: 30, seed: null },
  ssh: { key_name: 'github', counter: 1 },
});
assert.equal((await invoke(trusted, {action:'keygrain.popup.detail', detailSelectionToken: replacementSelection.result.items[1].detailSelectionToken})).code, 'KEYGRAIN_STALE_OPERATION', 'detail token replay is rejected');
assert.equal((await invoke(trusted, {action:'keygrain.popup.selectionOptions', rawId:'dup'})).code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR', 'raw selector is rejected');
const editPatch = {name:'One',site:'one.example',email:'one@example.com',length:21,symbols:'!@#',counter:2,characterPolicyPresent:true,characterPolicy:'ascii-printable-v1'};
const editSuccess = await invoke(trusted, {action:'keygrain.popup.edit', editToken:detail.result.editToken, patch:editPatch});
assert.equal(editSuccess.ok, true, 'edit succeeds with mocked persistence seam');
assert.equal(runInContext('deriveCalls', context), 0, 'list/detail/edit do not derive passwords');
const replacementForStale = await invoke(trusted, {action:'keygrain.popup.selectionOptions'});
runInContext('owner.manager.lockEverything(); owner.manager.unlockFull({fullData:{services:[{id:null,site:"null.example",name:null,email:null},{id:"dup",site:"one.example",name:"One",email:"one@example.com"},{id:"dup",site:"two.example",name:"Two",email:"two@example.com"}]},records:[{site:"null.example"},{id:"dup",site:"one.example",name:"One",email:"one@example.com"},{id:"dup",site:"two.example",name:"Two",email:"two@example.com"}]})', context);
assert.equal((await invoke(trusted, {action:'keygrain.popup.detail', detailSelectionToken:replacementForStale.result.items[2].detailSelectionToken})).code, 'KEYGRAIN_STALE_OPERATION', 'owner payload replacement invalidates same-ordinal capabilities');
const equivalentPayload = {services:[
  {id:null,site:'null.example',name:null,email:null,length:20,symbols:'!@',counter:1,totp:null,ssh:null},
  {id:'dup',site:'one.example',name:'One',email:'one@example.com',length:21,symbols:'!@#',counter:2,character_policy:'ascii-printable-v1',totp:{mode:'derived'},ssh:{key_name:'github',counter:1}},
  {id:'dup',site:'two.example',name:'Two',email:'two@example.com'},
]};
const equivalentRecords = [{site:'null.example'},{id:'dup',site:'one.example',name:'One',email:'one@example.com'},{id:'dup',site:'two.example',name:'Two',email:'two@example.com'}];
const equivalentSelection = await invoke(trusted, {action:'keygrain.popup.selectionOptions'});
runInContext(`owner.manager.unlockFull({fullData:${JSON.stringify(equivalentPayload)},records:${JSON.stringify(equivalentRecords)}})`, context);
assert.equal((await invoke(trusted, {action:'keygrain.popup.detail', detailSelectionToken:equivalentSelection.result.items[2].detailSelectionToken})).code, 'KEYGRAIN_STALE_OPERATION', 'equivalent owner payload replacement is stale without test-hook reliance');
assert.equal((await invoke(trusted, {action:'keygrain.popup.lockSensitive'})).ok, true, 'fixed sensitive lock succeeds');
assert.equal((await invoke(trusted, {action:'keygrain.popup.selectionOptions'})).code, 'KEYGRAIN_EXPIRED', 'selection is full-only');
assert.equal((await invoke(trusted, {action:'keygrain.popup.lockEverything'})).ok, true, 'fixed lock-everything succeeds');
const afterEverythingMetadata = await invokeAction(trusted, 'keygrain.popup.metadata'); assert.equal(afterEverythingMetadata.code, 'KEYGRAIN_METADATA_ERROR', 'lock-everything clears metadata');
console.log('  ✓ corrected worker list/detail projections, capability lifecycle, gates, and no-precompute guard');

const lifecycleSource = readFileSync(resolve(shared, 'browser-owner.js'), 'utf8');
assert.match(lifecycleSource, /let accountDataRevision = 0/);
assert.match(lifecycleSource, /let accountIdentityGeneration = 0/);
assert.match(lifecycleSource, /let authenticatedAccountEmail = null/);
assert.doesNotMatch(lifecycleSource, /return[^\n]*authenticatedAccountEmail/);
assert.doesNotMatch(lifecycleSource, /success\(\{[^\n]*(?:accountDataRevision|accountIdentityGeneration|authenticatedAccountEmail)/);
runInContext(`owner.manager.lockEverything(); owner.manager.unlockFull({fullData:{services:[{id:'identity',site:'identity.example',name:'Identity',email:'identity@example.com'}]},records:[{id:'identity',site:'identity.example',name:'Identity',email:'identity@example.com'}]})`, context);
const lifecycleSelection = await invoke(trusted, {action:'keygrain.popup.selectionOptions'});
assert.equal(lifecycleSelection.ok, true, 'full state issues a bounded selection after replacement install');
runInContext('owner.manager.lockSensitive()', context);
const metadataTail = await invokeAction(trusted, 'keygrain.popup.metadata');
assert.equal(metadataTail.ok, true, 'full-to-metadata retains the safe metadata tail');
assert.equal(JSON.stringify(metadataTail).includes('accountDataRevision'), false);
assert.equal(JSON.stringify(metadataTail).includes('authenticatedAccountEmail'), false);
runInContext('owner.manager.lockEverything(); owner.reconcile("lock_everything")', context);
assert.equal((await invokeAction(trusted, 'keygrain.popup.metadata')).code, 'KEYGRAIN_METADATA_ERROR', 'lock-everything clears metadata authority');
assert.equal((await invoke(trusted, {action:'keygrain.popup.detail', detailSelectionToken:lifecycleSelection.result.items[0].detailSelectionToken})).code, 'KEYGRAIN_STALE_OPERATION', 'locked transition invalidates old selection capabilities');

const identityStoreMap = new Map([['keygrain.settings', {version:1, fullLeaseSeconds:60, metadataTailSeconds:14400}]]);
const identityStorage = {
  async get(key) {
    if (typeof key === 'string') return {[key]: identityStoreMap.get(key)};
    const res = {};
    for (const [k, v] of identityStoreMap.entries()) res[k] = v;
    return res;
  },
  async set(obj) {
    for (const [k, v] of Object.entries(obj)) identityStoreMap.set(k, v);
  },
  async remove(key) { identityStoreMap.delete(key); },
};
context.identityStorage = identityStorage;
runInContext(`globalThis.authNow=1000; globalThis.authOwner=KeygrainBrowserOwner.createOwner({
  adapter:{browser:'chrome',storage:identityStorage,async reconcileIndicators(){},shutdown(){}},
  settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>authNow,
  authenticateAndPrepare:async ({email,secret})=>({fullData:{secret,email,services:[{id:'auth-service',site:'auth.example',name:'Auth',email:'service@example.com'}],wallets:[],walletAuditLog:[],tombstones:[],deletionReview:[]},records:[{id:'auth-service',site:'auth.example',name:'Auth',email:'service@example.com'}]}),
}); globalThis.authSender={id:'ext',tab:null,url:'chrome-extension://ext/popup.html'}`, context);
const authResultRaw = await runInContext(`authOwner.unlock(authSender,'ext',{action:'unlock',email:'  Account@Example.COM ',secret:'auth-secret',popupSessionId:'auth-popup',confirmationId:null},'chrome','chrome-extension://ext')`, context);
const authResult = JSON.parse(JSON.stringify(authResultRaw));
assert.equal(authResult.ok, true, 'real owner.unlock installs authenticated identity only after manager commit');
assert.equal(JSON.stringify(authResult).includes('auth-secret'), false);
const authStateRaw = await runInContext(`authOwner.dispatchPopupRequest(authSender,'ext',{action:'keygrain.popup.state'},'chrome','chrome-extension://ext')`, context);
const authState = JSON.parse(JSON.stringify(authStateRaw));
assert.equal(authState.result.state, 'full');
runInContext('authNow=61000; authOwner.reconcile("full_expiry")', context);
const authMetadataRaw = await runInContext(`authOwner.dispatchPopupRequest(authSender,'ext',{action:'keygrain.popup.metadata'},'chrome','chrome-extension://ext')`, context);
const authMetadata = JSON.parse(JSON.stringify(authMetadataRaw));
assert.equal(authMetadata.ok, true, 'authenticated identity survives full-to-metadata transition');
runInContext('authNow=14461000; authOwner.reconcile("metadata_expiry")', context);
const expiredMetadataRaw = await runInContext(`authOwner.dispatchPopupRequest(authSender,'ext',{action:'keygrain.popup.metadata'},'chrome','chrome-extension://ext')`, context);
const expiredMetadata = JSON.parse(JSON.stringify(expiredMetadataRaw));
assert.equal(expiredMetadata.code, 'KEYGRAIN_METADATA_ERROR', 'metadata expiry clears the identity authority');
runInContext('authNow=14462000', context);
const authAgainRaw = await runInContext(`authOwner.unlock(authSender,'ext',{action:'unlock',email:'Account@Example.COM',secret:'auth-secret',popupSessionId:'auth-popup-2',confirmationId:null},'chrome','chrome-extension://ext')`, context);
const authAgain = JSON.parse(JSON.stringify(authAgainRaw));
assert.equal(authAgain.ok, true);
const lockEverythingRaw = await runInContext(`authOwner.dispatchPopupRequest(authSender,'ext',{action:'keygrain.popup.lockEverything'},'chrome','chrome-extension://ext')`, context);
const lockEverything = JSON.parse(JSON.stringify(lockEverythingRaw));
assert.equal(lockEverything.result.state, 'locked', 'lock-everything clears the authenticated identity authority');
runInContext(`globalThis.failOwner=KeygrainBrowserOwner.createOwner({adapter:{browser:'chrome',storage:identityStorage},settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400},clock:()=>1000,authenticateAndPrepare:async()=>{throw new Error('bad-auth')}})`, context);
const failedAuthRaw = await runInContext(`failOwner.unlock(authSender,'ext',{action:'unlock',email:'Account@Example.COM',secret:'wrong',popupSessionId:'failed-popup',confirmationId:null},'chrome','chrome-extension://ext')`, context);
const failedAuth = JSON.parse(JSON.stringify(failedAuthRaw));
assert.equal(failedAuth.code, 'KEYGRAIN_UNLOCK_FAILED', 'failed authentication never installs identity');
assert.equal(JSON.parse(runInContext(`JSON.stringify(failOwner.snapshot())`, context)).state, 'locked');
assert.equal(runInContext(`Object.prototype.hasOwnProperty.call(authOwner,'authenticatedAccountEmail')`, context), false);
assert.doesNotMatch(lifecycleSource, /notifyKeygrainPopupDataReplacement/);

// Verify settings can be read and written in metadata mode
await runInContext('authNow=14463000; authOwner.unlock(authSender,"ext",{action:"unlock",email:"Account@Example.COM",secret:"auth-secret",popupSessionId:"auth-popup-3",confirmationId:null},"chrome","chrome-extension://ext")', context);
runInContext('authNow=14524000; authOwner.reconcile("full_expiry")', context);
assert.equal(JSON.parse(runInContext('JSON.stringify(authOwner.snapshot())', context)).state, 'metadata');
const metaSettingsRes = JSON.parse(JSON.stringify(await runInContext('authOwner.dispatchPopupRequest(authSender,"ext",{action:"keygrain.popup.settings",patch:{defaultLength:24}},"chrome","chrome-extension://ext")', context)));
assert.equal(metaSettingsRes.ok, true, 'settings patch succeeds in metadata mode');
assert.equal(metaSettingsRes.result.settings.defaultLength, 24, 'metadata mode settings patch persists value');

// Verify 1800s exceptional lease settings update in full mode and extend
await runInContext('authNow=14525000; authOwner.unlock(authSender,"ext",{action:"unlock",email:"Account@Example.COM",secret:"auth-secret",popupSessionId:"auth-popup-4",confirmationId:null},"chrome","chrome-extension://ext")', context);
const full30mSettingsRes = JSON.parse(JSON.stringify(await runInContext('authOwner.dispatchPopupRequest(authSender,"ext",{action:"keygrain.popup.settings",patch:{fullLeaseSeconds:1800}},"chrome","chrome-extension://ext")', context)));
assert.equal(full30mSettingsRes.ok, true, 'settings patch with 1800s fullLeaseSeconds succeeds');
assert.equal(full30mSettingsRes.result.settings.fullLeaseSeconds, 1800);
const snapAfter30mSetting = JSON.parse(runInContext('JSON.stringify(authOwner.snapshot())', context));
assert.equal(snapAfter30mSetting.fullExpiresAt, 14525000 + 1800000, '30m setting immediately extends active full lease');

// Verify extend operation with 1800s
runInContext('authNow=14526000', context);
const extend30mRes = JSON.parse(JSON.stringify(await runInContext('authOwner.dispatchPopupRequest(authSender,"ext",{action:"keygrain.popup.extend"},"chrome","chrome-extension://ext")', context)));
assert.equal(extend30mRes.ok, true, 'extend with 1800s fullLeaseSeconds succeeds');
const snapAfterExtend = JSON.parse(runInContext('JSON.stringify(authOwner.snapshot())', context));
assert.equal(snapAfterExtend.fullExpiresAt, 14526000 + 1800000, 'extend successfully extends 30m lease');

// Verify re-auth in metadata mode with 1800s setting using confirmation
runInContext('authNow=14526000 + 1801000; authOwner.reconcile("full_expiry")', context);
assert.equal(JSON.parse(runInContext('JSON.stringify(authOwner.snapshot())', context)).state, 'metadata');

// Unlocking without confirmation when 1800s must fail closed
const failReauthNoConf = JSON.parse(JSON.stringify(await runInContext('authOwner.unlock(authSender,"ext",{action:"unlock",email:"Account@Example.COM",secret:"auth-secret",popupSessionId:"auth-popup-5",confirmationId:null},"chrome","chrome-extension://ext")', context)));
assert.equal(failReauthNoConf.ok, false, 'unlock without confirmation fails when 1800s');

// Unlocking with issued confirmation succeeds
runInContext('globalThis.confId = authOwner.issueConfirmation("auth-popup-5", authSender.url);', context);
const succeedReauthWithConf = JSON.parse(JSON.stringify(await runInContext('authOwner.unlock(authSender,"ext",{action:"unlock",email:"Account@Example.COM",secret:"auth-secret",popupSessionId:"auth-popup-5",confirmationId:globalThis.confId},"chrome","chrome-extension://ext")', context)));
assert.equal(succeedReauthWithConf.ok, true, 'unlock with issued confirmation succeeds when 1800s');
assert.equal(JSON.parse(runInContext('JSON.stringify(authOwner.snapshot())', context)).state, 'full');

assert.match(popupHtml, /id="reauth-error"/, 'reauth-error element is present in popup.html');
assert.match(popupHtml, /id="add-edit-warning"[^>]*background:\s*var\(--warning-bg\)/, 'add-edit-warning styled as warning banner');

const popupJsSource = readFileSync(resolve(shared, 'popup.js'), 'utf8');
assert.doesNotMatch(popupJsSource, /searchInput\.value\s*=\s*activeHost;/, 'popup.js does not prefill searchInput with activeHost so all services remain visible');
assert.match(popupJsSource, /function executePendingAction/, 'executePendingAction is defined');
assert.match(popupJsSource, /renderFullServiceList\(popupRenderItems,\s*renderEpoch,\s*currentSnapshot\)/, 'executePendingAction can restore full list if search filter obscured target row');

console.log('  ✓ owner identity/revision lifecycle remains private, metadata-tail safe, and fail-closed');
console.log('popup owner operation registry tests passed');
