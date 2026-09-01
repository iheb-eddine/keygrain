import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = resolve(__dirname, '..', 'shared');
const ownerSource = readFileSync(resolve(shared, 'browser-owner.js'), 'utf8');
const context = createContext({
  Array, ArrayBuffer, Date, Error, JSON, Map, Math, Number, Object, Promise, RegExp, Set, String,
  TextEncoder, TextDecoder, Uint8Array, URL, Reflect, console, crypto: webcrypto, atob,
});
runInContext('globalThis = this;', context);
runInContext(readFileSync(resolve(shared, 'unlock-state.js'), 'utf8'), context);
context.normalizeSite = site => site.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].split('#')[0].replace(/\/$/, '').toLowerCase().replace(/^www\./, '');
runInContext(ownerSource, context);

let now = 1000;
let deriveCalls = [];
let generateCalls = [];
let deliveryArgs = [];
context.KeygrainAutofill = {isSafeMatchingSite: () => true};
context.now = () => now;
context.deriveTOTPSeed = async (...args) => { deriveCalls.push(args); return new Uint8Array([9]); };
context.generateTOTP = async (seed, time, options) => {
  generateCalls.push({seed: Array.from(seed), time, options});
  return String(seed[0]).padStart(options.digits, '0');
};
context.testAdapter = {
  browser: 'chrome',
  storage: {async get() { return {}; }, async set() {}, async remove() {}},
  async getActiveTotpContext() { return runInContext("({tabId: 7, frameId: 0, origin: 'https://example.com'})", context); },
  async proveTotpContext() { return true; },
  async deliverTotp(args) { deliveryArgs.push(args); return runInContext("Object.assign(Object.create(null), {codeFilled: true})", context); },
};
runInContext(`globalThis.owner = KeygrainBrowserOwner.createOwner({adapter: testAdapter,
  settings: {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400}, clock: now,
});`, context);
const trusted = runInContext(`({id: 'ext', tab: null, url: 'chrome-extension://ext/popup.html'})`, context);
async function invoke(request) {
  context.request = request;
  const result = await runInContext('owner.dispatchPopupRequest(trusted, "ext", request, "chrome", "chrome-extension://ext")', Object.assign(context, {trusted}));
  return JSON.parse(JSON.stringify(result));
}

const source = ownerSource;
assert.match(source, /const b2Registry = Object\.freeze\(\{/);
for (const action of ['keygrain.totp.options', 'keygrain.totp.generate', 'keygrain.totp.fill']) {
  assert.equal(source.includes(`\"${action}\"`), true, `${action} must be a fixed literal`);
}
assert.match(source, /const tuple = Object\.freeze\(\{serviceId: id, site, email, name, mode: config\.mode, algorithm: config\.algorithm,/);
assert.match(source, /return Object\.freeze\(\{recordIndex, tuple, seedText: config\.seedText\}\)/);
const canonicalTupleStart = source.indexOf('const tuple = Object.freeze({');
const canonicalTupleEnd = source.indexOf('});', canonicalTupleStart);
assert(canonicalTupleStart >= 0 && canonicalTupleEnd > canonicalTupleStart);
assert.equal(source.slice(canonicalTupleStart, canonicalTupleEnd).includes('seedText'), false);
const capabilityStart = source.indexOf('b2Capabilities.set(');
const capabilityEnd = source.indexOf('));', capabilityStart);
assert(capabilityStart >= 0 && capabilityEnd > capabilityStart);
assert.equal(source.slice(capabilityStart, capabilityEnd).includes('seedText'), false);
assert.match(source, /recordIndex: candidate\.recordIndex, tuple: b2CapabilityTuple\(tuple\)/);
assert.doesNotMatch(source, /recordIndex: tuple\.recordIndex, tuple\}\)\);/);
assert.doesNotMatch(source, /getTOTPCode/);

runInContext(`owner.manager.unlockFull({fullData: {secret: 'hidden-secret', services: [
  {id: 'dup', site: 'example.com', name: 'One', email: 'one@example.com', totp: {mode: 'stored', seed: 'AQ=='}},
  {id: 'dup', site: 'example.com', name: 'Two', email: 'one@example.com', totp: {mode: 'stored', seed: 'Ag=='}},
  {id: 'none', site: 'none.example', email: 'none@example.com', totp: null},
  {id: 'password-only', site: 'password.example', email: 'p@example.com'}
]}, records: []})`, context);
// The manager receives records separately for metadata; B2 reads fullData.services.
const options = await invoke({action: 'keygrain.totp.options'});
assert.equal(options.ok, true);
assert.equal(options.result.items.length, 2);
assert.deepEqual(options.result.items.map(item => [item.id, item.name]), [['dup', 'One'], ['dup', 'Two']]);
assert.equal(JSON.stringify(options).includes('AQ=='), false);
assert.equal(JSON.stringify(options).includes('Ag=='), false);
assert.equal(JSON.stringify(options).includes('hidden-secret'), false);

const first = await invoke({action: 'keygrain.totp.generate', selectionToken: options.result.items[0].selectionToken});
assert.deepEqual(first, {ok: true, result: {code: '000001'}});
const second = await invoke({action: 'keygrain.totp.generate', selectionToken: options.result.items[1].selectionToken});
assert.deepEqual(second, {ok: true, result: {code: '000002'}});
assert.deepEqual(generateCalls.map(call => call.seed), [[1], [2]], 'duplicate records bind to source-order record identity');
assert.deepEqual(generateCalls.map(call => call.time), [1, 1], 'generation uses one owner-captured Unix-second value');
assert.deepEqual(Object.keys(first.result), ['code']);
assert.equal('remaining' in first.result, false);
const replay = await invoke({action: 'keygrain.totp.generate', selectionToken: options.result.items[0].selectionToken});
assert.equal(replay.code, 'KEYGRAIN_STALE_OPERATION');
const fillOptions = await invoke({action: 'keygrain.totp.options'});
assert.equal(fillOptions.ok, true);
const pendingFill = await invoke({action: 'keygrain.totp.fill', selectionToken: fillOptions.result.items[0].selectionToken});
assert.deepEqual(pendingFill, {ok: true, result: {codeFilled: true}});
assert.equal(deliveryArgs.length, 1);
assert.deepEqual(Object.keys(deliveryArgs[0]), ['context', 'deliveryNonce', 'code', 'site']);
assert.equal('seed' in deliveryArgs[0], false);
assert.equal('secret' in deliveryArgs[0], false);
const pendingFillReplay = await invoke({action: 'keygrain.totp.fill', selectionToken: fillOptions.result.items[0].selectionToken});
assert.equal(pendingFillReplay.code, 'KEYGRAIN_STALE_OPERATION');

runInContext(`owner.manager.lockEverything(); owner.manager.unlockFull({fullData: {services: [
  {id: 'valid', site: 'valid.example', email: 'v@example.com', totp: {mode: 'stored', seed: 'AQ=='}},
  {id: 'bad', site: 'bad.example', email: 'b@example.com', totp: {mode: 'stored', seed: 'AQ==', unknown: true}}
]}, records: []})`, context);
const malformed = await invoke({action: 'keygrain.totp.options'});
assert.equal(malformed.code, 'KEYGRAIN_TOTP_ERROR');
assert.equal(JSON.stringify(malformed).includes('AQ=='), false);

runInContext(`owner.manager.lockEverything(); owner.manager.unlockFull({fullData: {services: [
  {id: 'clock', site: 'clock.example', email: 'c@example.com', totp: {mode: 'stored', seed: 'AQ=='}}
]}, records: []})`, context);
const clockOptions = await invoke({action: 'keygrain.totp.options'});
assert.equal(clockOptions.ok, true);
now = 999;
const rollback = await invoke({action: 'keygrain.totp.generate', selectionToken: clockOptions.result.items[0].selectionToken});
assert.equal(rollback.code, 'KEYGRAIN_STALE_OPERATION');

for (const request of [
  {action: 'keygrain.totp.options', extra: true},
  {action: 'keygrain.totp.generate'},
  {action: 'keygrain.totp.generate', selectionToken: 'x', extra: true},
]) assert.equal((await invoke(request)).code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR');
assert.equal((await invoke({action: 'heartbeat'})).code, 'KEYGRAIN_CONSUMER_MIGRATION_REQUIRED');
assert.equal((await invoke({action: 'keygrain.totp.fill', selectionToken: 'x'})).code, 'KEYGRAIN_STALE_OPERATION');
assert.equal(deriveCalls.length, 0, 'stored tests never invoke derived primitive');

console.log('  ✓ B2 owner registry, bounded options, duplicate binding, replay, malformed records, and rollback');


function contentCase(browserName, {hasOtp = true, pick = true, disabled = false, readOnly = false, visible = true, throwSetter = false, protocol = 'https:'} = {}) {
  let handler;
  let timer;
  const runtimeId = browserName === 'chrome' ? 'content-ext' : 'content@example.test';
  const workerUrl = browserName === 'chrome' ? 'chrome-extension://content-ext/' : 'moz-extension://content-uuid/background.js';
  const pageOrigin = 'https://example.com';
  class Input {
    constructor() { this.type = 'text'; this.name = 'otp'; this.id = ''; this.autocomplete = ''; this._value = ''; this.events = []; this.offsetParent = visible ? {} : null; this.offsetWidth = visible ? 100 : 0; this.disabled = disabled; this.readOnly = readOnly; }
    dispatchEvent(event) { this.events.push(event.type); }
  }
  Object.defineProperty(Input.prototype, 'value', {
    get() { return this._value || ''; },
    set(value) { if (throwSetter) throw new Error('setter'); this._value = value; },
  });
  const input = new Input();
  const contentRuntime = {
    id: runtimeId,
    getURL(path = '') { return workerUrl; },
    onMessage: {addListener(fn) { handler = fn; }},
    sendMessage() { return Promise.resolve(); },
  };
  const document = {querySelectorAll() { return [input]; }, activeElement: input};
  const window = {__keygrain_injected: false, addEventListener() {}};
  const keygrainAutofill = {
    describeField() { return {type: 'text', name: 'otp', id: '', autocomplete: '', visible, disabled, readOnly, value: input._value || '', inputmode: 'numeric', maxlength: 6, pattern: '[0-9]*'}; },
    isOtpDescriptor() { return hasOtp; },
    pickOtpField() { return hasOtp && pick ? 0 : null; },
    otpCodeFitsField() { return true; },
  };
  const ctx = createContext({window, document, location: {protocol, origin: pageOrigin}, HTMLInputElement: Input,
    Event: class Event {constructor(type) { this.type = type; }}, KeygrainAutofill: keygrainAutofill,
    TextEncoder, Uint8Array, Promise, Object, Array, Reflect, String, Number, Boolean, setTimeout(fn) { timer = fn; return 1; }, clearTimeout() {},
    crypto: {getRandomValues(bytes) { bytes.fill(3); return bytes; }},
    ...(browserName === 'chrome' ? {chrome: {runtime: contentRuntime}} : {browser: {runtime: contentRuntime}}),
  });
  ctx.globalThis = ctx;
  runInContext(readFileSync(resolve(shared, 'content.js'), 'utf8'), ctx);
  const workerSender = {id: runtimeId, tab: {id: 7}, frameId: 0, url: workerUrl};
  if (browserName === 'chrome') workerSender.documentId = 'doc-1';
  return {handler, input, workerSender, fireTimer() { timer?.(); }};
}

for (const browserName of ['chrome', 'firefox']) {
  const content = contentCase(browserName);
  let proof;
  const probe = content.handler({action: 'keygrain.totp.contextProbe', challenge: 'challenge', deliveryNonce: 'delivery'}, content.workerSender, value => { proof = value; });
  assert.equal(probe, true, `${browserName}: TOTP probe handled`);
  assert.deepEqual(JSON.parse(JSON.stringify(proof)), {action: 'keygrain.totp.contextProof', challenge: 'challenge', nonce: proof.nonce, hasOtpField: true}, `${browserName}: exact true proof`);
  let ack;
  const delivery = content.handler({action: 'keygrain.totp.fillResult', deliveryNonce: 'delivery', code: '123456'}, content.workerSender, value => { ack = value; });
  assert.equal(delivery, true);
  assert.deepEqual(JSON.parse(JSON.stringify(ack)), {ok: true, result: {codeFilled: true}}, `${browserName}: bounded fill ack`);
  assert.equal(content.input.value, '123456', `${browserName}: native OTP setter`);
  assert.deepEqual(content.input.events, ['input', 'change'], `${browserName}: input/change only`);
  let replay;
  content.handler({action: 'keygrain.totp.fillResult', deliveryNonce: 'delivery', code: '654321'}, content.workerSender, value => { replay = value; });
  assert.equal(replay.code, 'KEYGRAIN_CONTEXT_ERROR', `${browserName}: one-use replay rejected`);
  const malformed = contentCase(browserName);
  malformed.handler({action: 'keygrain.totp.contextProbe', challenge: 'challenge', deliveryNonce: 'delivery'}, malformed.workerSender, () => {});
  let malformedResult;
  malformed.handler({action: 'keygrain.totp.fillResult', deliveryNonce: 'delivery'}, malformed.workerSender, value => { malformedResult = value; });
  assert.equal(malformedResult.code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR', `${browserName}: malformed delivery safe`);
  const wrong = contentCase(browserName);
  let wrongProof;
  wrong.handler({action: 'keygrain.totp.contextProbe', challenge: 'challenge', deliveryNonce: 'delivery'}, {...wrong.workerSender, id: 'wrong'}, value => { wrongProof = value; });
  assert.equal(wrongProof, undefined, `${browserName}: wrong worker cannot prove`);
  const noField = contentCase(browserName, {hasOtp: false});
  let noFieldProof;
  assert.equal(noField.handler({action: 'keygrain.totp.contextProbe', challenge: 'challenge', deliveryNonce: 'delivery'}, noField.workerSender, value => { noFieldProof = value; }), false);
  assert.equal(noFieldProof, undefined, `${browserName}: unsupported field emits no proof`);
  for (const options of [{pick: false}, {disabled: true}, {readOnly: true}, {visible: false}]) {
    const unusable = contentCase(browserName, options);
    let unusableProof;
    assert.equal(unusable.handler({action: 'keygrain.totp.contextProbe', challenge: 'challenge', deliveryNonce: 'delivery'}, unusable.workerSender, value => { unusableProof = value; }), false);
    assert.equal(unusableProof, undefined, `${browserName}: unusable OTP target emits no proof`);
  }
  const throwing = contentCase(browserName, {throwSetter: true});
  throwing.handler({action: 'keygrain.totp.contextProbe', challenge: 'challenge', deliveryNonce: 'delivery'}, throwing.workerSender, () => {});
  let setterFailure;
  throwing.handler({action: 'keygrain.totp.fillResult', deliveryNonce: 'delivery', code: '123456'}, throwing.workerSender, value => { setterFailure = value; });
  assert.equal(setterFailure.code, 'KEYGRAIN_TOTP_DELIVERY_ERROR', `${browserName}: setter failure safe`);
  const overbound = contentCase(browserName);
  overbound.handler({action: 'keygrain.totp.contextProbe', challenge: 'challenge', deliveryNonce: 'delivery'}, overbound.workerSender, () => {});
  let overboundResult;
  overbound.handler({action: 'keygrain.totp.fillResult', deliveryNonce: 'delivery', code: '123456789'}, overbound.workerSender, value => { overboundResult = value; });
  assert.equal(overboundResult.code, 'KEYGRAIN_TOTP_DELIVERY_ERROR', `${browserName}: overbound code safe`);
}

console.log('  ✓ B2 content proof, bounded delivery, replay, sender, field, and setter cases');


function popupCase({badOptions = false} = {}) {
  class Element {
    constructor(id = '') { this.id = id; this.children = []; this.handlers = {}; this._textContent = ''; this.disabled = false; this.value = ''; this.className = ''; this.dataset = {}; this.classList = {add() {}, remove() {}, toggle() {}}; }
    set textContent(value) { this._textContent = String(value); if (value === '') this.children = []; }
    get textContent() { return this._textContent; }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
    focus() {}
  }
  const ids = ['loading-screen', 'lock-screen', 'update-required-screen', 'main-screen', 'pin-screen', 'email', 'secret', 'auth-mode-unlock', 'auth-mode-create', 'create-confirm-group', 'confirm-secret', 'confirm-fingerprint', 'confirm-secret-match', 'unlock-btn', 'create-btn', 'status', 'service-list', 'search', 'sync-error', 'autolock-warning', 'autolock-extend', 'version-display', 'try-demo'];
  const elements = new Map(ids.map(id => [id, new Element(id)]));
  const messages = [];
  const runtime = {
    getManifest() { return {name: 'Keygrain Keygrain DEV', version: '1'}; },
    async sendMessage(message) {
      messages.push(message);
      if (message.action === 'keygrain.popup.state') return {ok: true, result: {state: 'full', stateGeneration: 1, authorizationGeneration: 1, fullExpiresAt: 60000, metadataExpiresAt: null, fullWarningAt: 30000, metadataWarningAt: null, metadataAvailable: false, hasFullData: true}};
      if (message.action === 'keygrain.popup.serviceList') return {ok: true, result: {items: [{id: 'svc', site: 'example.com', name: null, email: 'user@example.com'}]}};
      if (message.action === 'keygrain.popup.selectionOptions') {
        return {ok: true, result: {items: [{detailSelectionToken: 'detail-token', id: 'svc', site: 'example.com', name: null, email: 'user@example.com'}]}};
      }
      if (message.action === 'keygrain.password.options') return {ok: true, result: {items: [{selectionToken: 'password-token', id: 'svc', site: 'example.com', name: null, email: 'user@example.com'}]}};
      if (message.action === 'keygrain.totp.options') return badOptions ? {ok: true, result: {items: [{selectionToken: 'totp-token', id: null, site: 'example.com', name: null, email: 'user@example.com'}]}} : {ok: true, result: {items: [{selectionToken: 'totp-token', id: 'svc', site: 'example.com', name: null, email: 'user@example.com'}]}};
      if (message.action === 'keygrain.totp.generate') return {ok: true, result: {code: '123456'}};
      if (message.action === 'keygrain.totp.fill') return {ok: true, result: {codeFilled: true}};
      return {ok: false, code: 'KEYGRAIN_AUTH_PROTOCOL_ERROR', message: 'Invalid authentication request.'};
    },
  };
  let unload;
  const document = {getElementById(id) { return elements.get(id) || null; }, createElement() { return new Element(); }};
  const window = {addEventListener(type, fn) { if (type === 'unload' || type === 'pagehide') unload = fn; }};
  const ctx = createContext({document, window, chrome: {runtime}, console, TextEncoder, TextDecoder, URL,
    crypto: {randomUUID() { return 'popup-id'; }, getRandomValues(bytes) { bytes.fill(1); return bytes; }},
    KeygrainDiagnostics: {recordWorkerResponse() {}, record() {}}, KeygrainWorkerIngress: {makeEnvelope: async () => ({})},
    Object, Array, Map, Set, Promise, Number, String, Error, JSON, Math, RegExp, Uint8Array, Date, setTimeout, clearTimeout,
  });
  ctx.globalThis = ctx;
  runInContext(readFileSync(resolve(shared, 'popup.js'), 'utf8'), ctx);
  return {elements, messages, unload: () => unload?.()};
}

{
  const popup = popupCase();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  const list = popup.elements.get('service-list');
  assert.equal(list.children.length, 1, 'popup renders service items during full owner view');
  const row = list.children[0];
  const totpRow = row.children.find(child => child.className === 'totp-row');
  assert(totpRow, 'service item with TOTP options includes inline TOTP row');
  const codeSpan = totpRow.children.find(child => child.className === 'totp-code');
  const revealBtn = totpRow.children.find(child => child.className === 'totp-reveal-btn');
  const fillBtn = totpRow.children.find(child => child.className === 'totp-fill-btn');
  assert(revealBtn && fillBtn, 'TOTP row has reveal and fill buttons');
  await revealBtn.handlers.click();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  const request = popup.messages.find(message => message.action === 'keygrain.totp.generate');
  assert.deepEqual(JSON.parse(JSON.stringify(request)), {action: 'keygrain.totp.generate', selectionToken: 'totp-token'});
  assert.equal(codeSpan.textContent, '123456', 'generated code is transiently rendered in code span');
  const beforeFill = popup.messages.length;
  await fillBtn.handlers.click();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  const fillRequest = popup.messages.find(message => message.action === 'keygrain.totp.fill');
  assert(fillRequest, 'clicking Fill after Reveal acquires fresh token and sends fill message');
  assert.equal(fillRequest.selectionToken, 'totp-token', 'fill message uses fresh token');
  assert(popup.messages.length > beforeFill, 'token re-acquired and consumed for fill');
  popup.unload();
}

  const malformedPopup = popupCase({badOptions: true});
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  const malformedList = malformedPopup.elements.get('service-list');
  assert.equal(malformedList.children.length, 1, 'service item renders');
  const malformedRow = malformedList.children[0];
  assert.equal(malformedRow.children.some(child => child.className === 'totp-row'), false, 'malformed TOTP options does not render inline TOTP row');
  malformedPopup.unload();

console.log('  ✓ B2 popup inline TOTP row, exact envelope, transient output, and replay');


function totpRuntimeCase(browserName, options = {}) {
  let handler;
  const runtimeId = browserName === 'chrome' ? 'totp-extension' : 'totp@example.test';
  const extensionOrigin = browserName === 'chrome' ? 'chrome-extension://totp-extension' : 'moz-extension://totp-uuid';
  const pageOrigin = 'https://example.test';
  const events = [];
  const storage = {async get() { return {}; }, async set() {}, async remove() {}};
  const api = {
    id: runtimeId,
    getURL(path = '') { return `${extensionOrigin}/${path}`; },
    onMessage: {addListener(fn) { handler = fn; }}, onSuspend: {addListener() {}},
  };
  const sender = () => {
    const value = {id: runtimeId, tab: {id: 7}, frameId: 0, url: `${pageOrigin}/login`};
    if (browserName === 'chrome') value.documentId = options.missingDocumentId ? undefined : 'totp-document-1';
    return value;
  };
  const tabs = {
    async query() { return [{id: 7, windowId: 3, active: true, url: `${pageOrigin}/login`}]; },
    async sendMessage(tabId, message) {
      assert.equal(tabId, 7);
      if (message.action === 'keygrain.totp.contextProbe') {
        events.push({kind: 'probe', message});
        const proof = {action: 'keygrain.totp.contextProof', challenge: message.challenge, nonce: 'totp-document-nonce', hasOtpField: true};
        const proofSender = sender();
        if (options.missingDocumentId) delete proofSender.documentId;
        const direct = handler(proof, proofSender);
        if (direct && typeof direct.then === 'function') await direct;
        return proof;
      }
      if (message.action === 'keygrain.totp.fillResult') {
        events.push({kind: 'delivery', message});
        const ack = {ok: true, result: {codeFilled: true}};
        const direct = handler(ack, sender());
        if (direct && typeof direct.then === 'function') await direct;
        return ack;
      }
      throw new Error('unexpected message');
    },
  };
  const scripting = {
    async getRegisteredContentScripts() { return []; }, async unregisterContentScripts() {}, async registerContentScripts() {},
    async executeScript(details) {
      events.push({kind: 'inject', files: [...details.files], target: details.target});
      if (options.injectError || (options.injectErrorAt && details.files?.includes(options.injectErrorAt))) throw new Error('restricted');
    },
  };
  const apiRoot = {runtime: api, storage: {local: storage}, tabs, windows: {async getCurrent() { return {id: 3}; }},
    alarms: {async clear() {}, async create() {}, onAlarm: {addListener() {}}}, action: {async setBadgeText() {}}, scripting};
  const fakeOwner = {
    async loadSettings() {}, reconcile() {}, whenReconciled() { return Promise.resolve(); }, shutdown() {},
    unlock() { return Promise.resolve({ok: true}); }, dispatchLegacyOrPhaseB() { return {ok: false, code: 'KEYGRAIN_CONTEXT_ERROR'}; },
    dispatchPopupRequest() { return Promise.resolve({ok: false, code: 'KEYGRAIN_AUTH_PROTOCOL_ERROR'}); },
    issueConfirmation() { return 'confirmation'; }, clearConfirmationSession() {},
  };
  const ctx = createContext({Array, ArrayBuffer, Date, Error, JSON, Map, Math, Number, Object, Promise, RegExp, Set, String, URL,
    TextEncoder, TextDecoder, Uint8Array, console, setTimeout, clearTimeout,
    crypto: {getRandomValues(bytes) { bytes.fill(7); return bytes; }},
    KeygrainWorkerIngress: {createIngress: async () => ({issueChallenge: async () => ({version: 1, challenge: 'c'}), admitUnlock: async () => ({ok: true}), revokeAll() {}})},
    KeygrainStateManager: function () {}, KEYGRAIN_SETTINGS_KEY: 'keygrainSecurityLeaseSettings',
    normalizeSecuritySettings: value => value || {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400}, KeygrainBrowserOwner: null,
    importScripts() {}, ...(browserName === 'chrome' ? {chrome: apiRoot} : {browser: apiRoot}),
  });
  runInContext('globalThis = this;', ctx);
  runInContext(readFileSync(resolve(shared, 'unlock-state.js'), 'utf8'), ctx);
  runInContext(readFileSync(resolve(shared, 'browser-owner.js'), 'utf8'), ctx);
  const ownerApi = ctx.KeygrainBrowserOwner;
  ctx.KeygrainBrowserOwner = Object.freeze({...ownerApi, createOwner: () => fakeOwner});
  runInContext(`${readFileSync(resolve(shared, '..', browserName, 'background.js'), 'utf8')}\nglobalThis.__adapter = ${browserName === 'chrome' ? 'chromeOwnerAdapter' : 'firefoxOwnerAdapter'};`, ctx);
  return {adapter: ctx.__adapter, events, options};
}

for (const browserName of ['chrome', 'firefox']) {
  const runtime = totpRuntimeCase(browserName);
  const context = await runtime.adapter.getActiveTotpContext();
  const deliveryNonce = `${browserName}-totp-delivery`;
  const proof = await Promise.race([
    runtime.adapter.proveTotpContext({context, deliveryNonce}),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${browserName}_proof_hung`)), 100)),
  ]);
  assert.equal(proof, true, `${browserName}: TOTP proof prompt settles after injected bridge responds`);
  const injections = runtime.events.filter(event => event.kind === 'inject');
  assert.deepEqual(injections.map(event => event.files), browserName === 'chrome'
    ? [['lib/public_suffix_list.js', 'public-suffix.js', 'autofill.js', 'content.js']] : [['lib/public_suffix_list.js'], ['public-suffix.js'], ['autofill.js'], ['content.js']],
    `${browserName}: TOTP bridge injection is minimal and ordered`);
  assert.equal(runtime.events.findIndex(event => event.kind === 'inject') < runtime.events.findIndex(event => event.kind === 'probe'), true,
    `${browserName}: TOTP bridge injection precedes context probe`);
  const ack = await Promise.race([
    runtime.adapter.deliverTotp({context, deliveryNonce, code: '123456'}),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${browserName}_delivery_hung`)), 100)),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(ack)), {codeFilled: true}, `${browserName}: TOTP proof binding preserves delivery acknowledgement`);
  assert.equal(runtime.events.filter(event => event.kind === 'delivery').length, 1, `${browserName}: TOTP delivery is sent once`);
}

for (const browserName of ['chrome', 'firefox']) {
  const restricted = totpRuntimeCase(browserName, {injectErrorAt: 'content.js'});
  const context = await restricted.adapter.getActiveTotpContext();
  const deliveryNonce = `${browserName}-totp-restricted`;
  await assert.rejects(
    Promise.race([
      restricted.adapter.proveTotpContext({context, deliveryNonce}),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${browserName}_restricted_hung`)), 100)),
    ]),
    error => error?.code === 'KEYGRAIN_CONTEXT_ERROR',
    `${browserName}: restricted/partial TOTP bridge injection fails promptly`,
  );
  assert.equal(restricted.events.some(event => event.kind === 'probe'), false,
    `${browserName}: TOTP injection failure never probes an unbridged page`);
  assert.deepEqual(restricted.events.filter(event => event.kind === 'inject').map(event => event.files), browserName === 'chrome'
    ? [['lib/public_suffix_list.js', 'public-suffix.js', 'autofill.js', 'content.js']] : [['lib/public_suffix_list.js'], ['public-suffix.js'], ['autofill.js'], ['content.js']],
    `${browserName}: partial TOTP injection attempt remains exact and ordered`);
  restricted.options.injectErrorAt = null;
  assert.equal(await restricted.adapter.proveTotpContext({context, deliveryNonce}), true,
    `${browserName}: rejected TOTP proof clears pending state for retry`);
}

console.log('  ✓ B2 Chrome/Firefox TOTP adapter bridge injection, prompt settlement, failure cleanup, and delivery');
