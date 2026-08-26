import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, '..');

function runtimeCase(browserName, options = {}) {
  let handler;
  let updated;
  const runtimeId = browserName === 'chrome' ? 'b1-extension' : 'b1@example.test';
  const extensionOrigin = browserName === 'chrome'
    ? 'chrome-extension://b1-extension' : 'moz-extension://b1-uuid';
  const pageOrigin = 'https://example.test';
  const storage = {
    async get(key) { if (key === 'keygrainSecurityLeaseSettings') return {keygrainSecurityLeaseSettings: {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400}}; if (key === 'settings') return {}; return {}; },
    async set() {}, async remove() {},
  };
  const api = {
    id: runtimeId,
    getURL(path = '') { return `${extensionOrigin}/${path}`; },
    onMessage: {addListener(fn) { handler = fn; }}, onSuspend: {addListener() {}},
  };
  const events = [];
  const tabs = {
    async query(query) { return [{id: 7, windowId: 3, active: true, url: `${pageOrigin}/login`}]; },
    async sendMessage(tabId, message) {
      assert.equal(tabId, 7);
      if (message.action === 'keygrain.password.contextProbe') events.push({kind: 'probe', message});
      if (message.action === 'keygrain.password.fillResult') events.push({kind: 'delivery', message});
      if (options.contentHandler) {
        const workerURL = browserName === 'chrome' ? `${extensionOrigin}/` : `${extensionOrigin}/background.js`;
        return await new Promise(resolvePromise => options.contentHandler(message,
          {id: runtimeId, tab: {id: 7}, frameId: 0, url: workerURL}, resolvePromise));
      }
      if (message.action === 'keygrain.password.contextProbe') {
        const proof = {action: 'keygrain.password.contextProof', challenge: message.challenge, nonce: 'document-nonce', hasPasswordField: true, hasUsernameField: true};
        const sender = {id: runtimeId, tab: {id: 7}, frameId: 0, url: `${pageOrigin}/login`};
        if (browserName === 'chrome') sender.documentId = options.missingDocumentId ? undefined : 'document-1';
        const direct = handler(proof, sender);
        if (direct && typeof direct.then === 'function') await direct;
        return proof;
      }
      if (message.action === 'keygrain.password.fillResult') {
        const ack = {ok: true, result: {passwordFilled: true, emailFilled: message.email !== null}};
        const sender = {id: runtimeId, tab: {id: 7}, frameId: 0, url: `${pageOrigin}/login`};
        if (browserName === 'chrome') sender.documentId = 'document-1';
        const direct = handler(ack, sender);
        if (direct && typeof direct.then === 'function') await direct;
        return ack;
      }
      throw new Error('unexpected message');
    },
    onActivated: {addListener() {}}, onUpdated: {addListener(fn) { updated = fn; }},
    onReplaced: {addListener() {}}, onRemoved: {addListener() {}},
  };
  const windows = {async getCurrent() { return {id: 3}; }};
  const scripting = {
    async getRegisteredContentScripts() { return []; }, async unregisterContentScripts() {}, async registerContentScripts() {},
    async executeScript(details) {
      events.push({kind: 'inject', files: [...details.files], target: details.target});
      if (options.injectError || (options.injectErrorAt && details.files?.includes(options.injectErrorAt))) throw new Error('restricted');
    },
  };
  const apiRoot = {runtime: api, storage: {local: storage}, tabs, windows,
    alarms: {async clear() {}, async create() {}, onAlarm: {addListener() {}}},
    action: {async setBadgeText() {}}, scripting,
  };
  const fakeOwner = {
    async loadSettings() {}, reconcile() {}, whenReconciled() { return Promise.resolve(); }, shutdown() {},
    unlock() { return Promise.resolve({ok: true}); }, dispatchLegacyOrPhaseB() { return {ok: false, code: 'KEYGRAIN_CONTEXT_ERROR'}; },
    dispatchPopupRequest() { return Promise.resolve({ok: false, code: 'KEYGRAIN_AUTH_PROTOCOL_ERROR'}); },
    issueConfirmation() { return 'confirmation'; }, clearConfirmationSession() {},
  };
  const ctx = createContext({Array, ArrayBuffer, Date, Error, JSON, Map, Math, Number, Object, Promise, RegExp, Set, String, URL,
    TextEncoder, TextDecoder, Uint8Array, console, setTimeout, clearTimeout, crypto: {getRandomValues(bytes) { bytes.fill(7); return bytes; }},
    KeygrainWorkerIngress: {createIngress: async () => ({issueChallenge: async () => ({version: 1, challenge: 'c'}), admitUnlock: async () => ({ok: true}), revokeAll() {}})},
    KeygrainStateManager: function () {}, KEYGRAIN_SETTINGS_KEY: 'keygrainSecurityLeaseSettings',
    normalizeSecuritySettings: value => value || {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400},
    KeygrainBrowserOwner: null,
    ...(browserName === 'chrome' ? {chrome: apiRoot, importScripts() {}} : {browser: apiRoot, importScripts() {}}),
  });
  runInContext('globalThis = this;', ctx);
  runInContext(readFileSync(resolve(extensionRoot, 'shared/unlock-state.js'), 'utf8'), ctx);
  runInContext(readFileSync(resolve(extensionRoot, 'shared/browser-owner.js'), 'utf8'), ctx);
  const ownerApi = ctx.KeygrainBrowserOwner;
  ctx.KeygrainBrowserOwner = Object.freeze({...ownerApi, createOwner: () => fakeOwner});
  const source = readFileSync(resolve(extensionRoot, `${browserName}/background.js`), 'utf8');
  runInContext(`${source}\nglobalThis.__adapter = ${browserName === 'chrome' ? 'chromeOwnerAdapter' : 'firefoxOwnerAdapter'};`, ctx);

function attachContentImpl(runtime, browserName, options = {}) {
  class Input {
    constructor(type, name) { this.type = type; this.name = name; this.id = ''; this.autocomplete = ''; this.value = ''; this.events = []; this.disabled = false; this.readOnly = false; }
    dispatchEvent(event) { this.events.push(event.type); }
  }
  const username = new Input('text', 'username');
  const password = new Input('password', 'password');
  const inputs = [username, password];
  const contentRuntime = {
    id: runtime.runtimeId,
    getURL(path = '') { return browserName === 'chrome' ? `chrome-extension://${runtime.runtimeId}/` : 'moz-extension://b1-uuid/background.js'; },
    onMessage: {addListener(fn) { contentRuntime.handler = fn; }},
    sendMessage(message) {
      const sender = {id: runtime.runtimeId, tab: {id: 7}, frameId: 0, url: 'https://example.test/login'};
      if (browserName === 'chrome') sender.documentId = 'document-1';
      return Promise.resolve(runtime.handler(message, sender));
    },
  };
  const document = {
    querySelectorAll() { return inputs; }, activeElement: null,
  };
  const window = {__keygrain_injected: false, addEventListener() {}};
  const keygrainAutofill = {
    describeField(el) { return {type: el.type, name: el.name, id: el.id, autocomplete: el.autocomplete, visible: true, disabled: false, readOnly: false, value: el.value}; },
    isPasswordDescriptor(d) { return d.type === 'password'; },
    isFillableUsernameDescriptor(d) { return d.name === 'username'; },
    pickPasswordField(ds) { const i = ds.findIndex(d => d.type === 'password'); return i < 0 ? null : i; },
    pickUsernameField(ds) { const i = ds.findIndex(d => d.name === 'username'); return i < 0 ? null : i; },
  };
  const InputProto = Input.prototype;
  Object.defineProperty(InputProto, 'value', {get() { return this._value || ''; }, set(value) { if (options.throwSetter) throw new Error('setter'); this._value = value; }});
  delete username.value;
  delete password.value;
  let timerCallback = null;
  const fakeSetTimeout = callback => { timerCallback = callback; return 1; };
  const fakeClearTimeout = () => {};
  const contentContext = createContext({window, document, location: {protocol: 'https:', origin: 'https://example.test'},
    HTMLInputElement: Input, Event: class Event {constructor(type) { this.type = type; }},
    KeygrainAutofill: keygrainAutofill, TextEncoder, Uint8Array, crypto: {getRandomValues(bytes) { bytes.fill(9); return bytes; }},
    browser: browserName === 'firefox' ? {runtime: contentRuntime} : undefined,
    chrome: browserName === 'chrome' ? {runtime: contentRuntime} : undefined,
    globalThis: null, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, Promise, Object, Array, Reflect, String, Number, Boolean,
  });
  contentContext.globalThis = contentContext;
  runInContext(readFileSync(resolve(extensionRoot, 'shared/content.js'), 'utf8'), contentContext);
  return {handler: contentRuntime.handler, username, password, contentRuntime, window, document, fireTimer() { timerCallback?.(); }};
}
  return {ctx, handler, adapter: ctx.__adapter, events, sender: {id: runtimeId, tab: null, url: `${extensionOrigin}/popup.html`}, updated, runtimeId, pageOrigin, options, attachContent: attachContentImpl};
}

for (const browserName of ['chrome', 'firefox']) {
  const runtime = runtimeCase(browserName);
  const content = runtime.attachContent(runtime, browserName);
  runtime.options.contentHandler = content.handler;
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  const context = await runtime.adapter.getActivePasswordContext();
  assert.equal(context.tabId, 7, `${browserName}: active context tab`);
  assert.equal(context.frameId, 0, `${browserName}: active context frame`);
  assert.equal(context.origin, 'https://example.test', `${browserName}: active context origin`);
  const deliveryNonce = `${browserName}-delivery`;
  assert.equal(await runtime.adapter.provePasswordContext({context, deliveryNonce}), true, `${browserName}: actual listener proof succeeds`);
  const injections = runtime.events.filter(event => event.kind === 'inject');
  assert.equal(injections.length, browserName === 'chrome' ? 1 : 4, `${browserName}: password proof injects the minimal bridge`);
  assert.deepEqual(injections.map(event => event.files), browserName === 'chrome'
    ? [['lib/public_suffix_list.js', 'public-suffix.js', 'autofill.js', 'content.js']]
    : [['lib/public_suffix_list.js'], ['public-suffix.js'], ['autofill.js'], ['content.js']], `${browserName}: bridge files are minimal and ordered`);
  assert.equal(runtime.events.findIndex(event => event.kind === 'inject') < runtime.events.findIndex(event => event.kind === 'probe'), true,
    `${browserName}: bridge injection precedes proof probe`);
  let wrongResponse;
  const wrongReturn = content.handler({action: 'keygrain.password.contextProbe', challenge: 'wrong', deliveryNonce: 'wrong'},
    {id: runtime.runtimeId, tab: {id: 7}, frameId: 0, url: 'chrome-extension://wrong/'}, value => { wrongResponse = value; });
  assert.equal(wrongReturn, false, `${browserName}: wrong worker sender path rejected`);
  assert.equal(wrongResponse, undefined, `${browserName}: wrong sender emits no proof`);
  const ack = await runtime.adapter.deliverPassword({context, deliveryNonce, password: 'Abcdef2!', email: null});
  assert.equal(ack.passwordFilled, true, `${browserName}: actual listener password ack`);
  assert.equal(ack.emailFilled, false, `${browserName}: actual listener email ack`);
  assert.equal(content.password.value, 'Abcdef2!', `${browserName}: actual native password setter ran`);
  assert(content.password.events.includes('input') && content.password.events.includes('change'), `${browserName}: input/change events dispatched`);
  const replay = await new Promise(resolvePromise => content.handler({action: 'keygrain.password.fillResult', deliveryNonce, password: 'Replay22!', email: null},
    {id: runtime.runtimeId, tab: {id: 7}, frameId: 0, url: browserName === 'chrome' ? `chrome-extension://${runtime.runtimeId}/` : 'moz-extension://b1-uuid/background.js'}, resolvePromise));
  await assert.rejects(() => runtime.adapter.deliverPassword({context, deliveryNonce, password: 'Abcdef2!', email: null}), /delivery/,
    `${browserName}: worker delivery binding is single use`);
  assert.equal(replay.code, 'KEYGRAIN_CONTEXT_ERROR', `${browserName}: replay is rejected after atomic slot clear`);
  const legacy = await new Promise(resolvePromise => content.handler({action: 'fill', password: 'Caller22!', email: 'attacker@example.test'},
    {id: runtime.runtimeId, tab: {id: 7}, frameId: 0, url: browserName === 'chrome' ? `chrome-extension://${runtime.runtimeId}/` : 'moz-extension://b1-uuid/background.js'}, resolvePromise));
  assert.equal(legacy.code, 'KEYGRAIN_CONSUMER_MIGRATION_REQUIRED', `${browserName}: legacy caller credential sink is disabled`);
  const ttlContent = runtime.attachContent(runtime, browserName);
  const mismatchContent = runtime.attachContent(runtime, browserName);
  const workerSenderForTest = {id: runtime.runtimeId, tab: {id: 7}, frameId: 0, url: browserName === 'chrome' ? `chrome-extension://${runtime.runtimeId}/` : 'moz-extension://b1-uuid/background.js'};
  let mismatchProof;
  mismatchContent.handler({action: 'keygrain.password.contextProbe', challenge: 'mismatch-challenge', deliveryNonce: 'mismatch-delivery'}, workerSenderForTest, value => { mismatchProof = value; });
  let mismatchResult;
  mismatchContent.handler({action: 'keygrain.password.fillResult', deliveryNonce: 'mismatch-delivery', password: 'Abcdef2!', email: null},
    {...workerSenderForTest, tab: {id: 8}}, value => { mismatchResult = value; });
  assert.equal(mismatchProof.action, 'keygrain.password.contextProof', `${browserName}: mismatch fixture was proven`);
  assert.equal(mismatchResult.code, 'KEYGRAIN_CONTEXT_ERROR', `${browserName}: sender tab mismatch fails closed`);
  assert.equal(mismatchContent.password.value, '', `${browserName}: sender mismatch does not mutate DOM`);
  const throwingContent = runtime.attachContent(runtime, browserName, {throwSetter: true});
  let throwingProof;
  throwingContent.handler({action: 'keygrain.password.contextProbe', challenge: 'throw-challenge', deliveryNonce: 'throw-delivery'}, workerSenderForTest, value => { throwingProof = value; });
  let throwingResult;
  throwingContent.handler({action: 'keygrain.password.fillResult', deliveryNonce: 'throw-delivery', password: 'Abcdef2!', email: null}, workerSenderForTest, value => { throwingResult = value; });
  assert.equal(throwingProof.action, 'keygrain.password.contextProof', `${browserName}: throwing fixture was proven`);
  assert.equal(throwingResult.code, 'KEYGRAIN_FILL_DELIVERY_ERROR', `${browserName}: DOM failure is safe`);
  let ttlProbe;
  const invalidContent = runtime.attachContent(runtime, browserName);
  let invalidProof;
  invalidContent.handler({action: 'keygrain.password.contextProbe', challenge: 'invalid-challenge', deliveryNonce: 'invalid-delivery'}, workerSenderForTest, value => { invalidProof = value; });
  let invalidResult;
  invalidContent.handler({action: 'keygrain.password.fillResult', deliveryNonce: 'invalid-delivery', password: 'x', email: null}, workerSenderForTest, value => { invalidResult = value; });
  assert.equal(invalidProof.action, 'keygrain.password.contextProof', `${browserName}: invalid fixture was proven`);
  assert.equal(invalidResult.code, 'KEYGRAIN_FILL_DELIVERY_ERROR', `${browserName}: bounded credential rejection is delivery-safe`);
  const malformedContent = runtime.attachContent(runtime, browserName);
  malformedContent.handler({action: 'keygrain.password.contextProbe', challenge: 'malformed-challenge', deliveryNonce: 'malformed-delivery'}, workerSenderForTest, () => {});
  let malformedResult;
  malformedContent.handler({action: 'keygrain.password.fillResult', deliveryNonce: 'malformed-delivery', password: 'Abcdef2!'}, workerSenderForTest, value => { malformedResult = value; });
  assert.equal(malformedResult.code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR', `${browserName}: malformed delivery is protocol-safe`);
  const workerSender = {id: runtime.runtimeId, tab: {id: 7}, frameId: 0, url: browserName === 'chrome' ? `chrome-extension://${runtime.runtimeId}/` : 'moz-extension://b1-uuid/background.js'};
  ttlContent.handler({action: 'keygrain.password.contextProbe', challenge: 'ttl-challenge', deliveryNonce: 'ttl-delivery'}, workerSender, value => { ttlProbe = value; });
  assert.equal(ttlProbe.action, 'keygrain.password.contextProof', `${browserName}: probe returns exact proof`);
  ttlContent.fireTimer();
  let ttlDelivery;
  ttlContent.handler({action: 'keygrain.password.fillResult', deliveryNonce: 'ttl-delivery', password: 'Abcdef2!', email: null}, workerSender, value => { ttlDelivery = value; });
  assert.equal(ttlDelivery.code, 'KEYGRAIN_CONTEXT_ERROR', `${browserName}: content five-second slot expiry clears proof`);

}

for (const browserName of ['chrome', 'firefox']) {
  const restricted = runtimeCase(browserName, {injectErrorAt: 'content.js'});
  const restrictedContext = await restricted.adapter.getActivePasswordContext();
  const rejection = restricted.adapter.provePasswordContext({context: restrictedContext, deliveryNonce: `${browserName}-restricted`});
  await assert.rejects(
    Promise.race([rejection, new Promise((_, reject) => setTimeout(() => reject(new Error('proof_hung')), 100))]),
    error => error?.code === 'KEYGRAIN_CONTEXT_ERROR',
    `${browserName}: partial bridge injection fails promptly and safely`,
  );
  assert.equal(restricted.events.some(event => event.kind === 'probe'), false,
    `${browserName}: failed bridge injection never probes an unbridged page`);
  if (browserName === 'firefox') {
    assert.deepEqual(restricted.events.filter(event => event.kind === 'inject').map(event => event.files),
      [['lib/public_suffix_list.js'], ['public-suffix.js'], ['autofill.js'], ['content.js']], 'firefox: second bridge file failure is observable after the first file');
  } else {
    assert.deepEqual(restricted.events.filter(event => event.kind === 'inject').map(event => event.files),
      [['lib/public_suffix_list.js', 'public-suffix.js', 'autofill.js', 'content.js']], 'chrome: ordered bridge injection is one minimal call');
  }
}

const chromeMissing = runtimeCase('chrome', {missingDocumentId: true});
await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
const missingContext = await chromeMissing.adapter.getActivePasswordContext();
await assert.rejects(() => chromeMissing.adapter.provePasswordContext({context: missingContext, deliveryNonce: 'missing-doc'}), error => error?.code === 'KEYGRAIN_CONTEXT_ERROR',
  'Chrome missing documentId fails closed');

console.log('Keygrain B1 adapter proof tests passed');

function ownerB1Fixture({forbiddenOutput = false} = {}) {
  let now = 1000;
  let random = 0;
  const derivations = [];
  const deliveries = [];
  const adapter = {
    browser: 'chrome',
    storage: {async get() { return {}; }, async set() {}, async remove() {}},
    async reconcileIndicators() {},
    async getActivePasswordContext() { deliveries.push({phase: 'context'}); return {tabId: 9, frameId: 0, origin: 'https://example.com'}; },
    async provePasswordContext() { deliveries.push({phase: 'proof'}); return true; },
    async deliverPassword(payload) { deliveries.push(payload); return {passwordFilled: true, emailFilled: payload.email !== null}; },
  };
  const context = createContext({Array, ArrayBuffer, Date, Error, JSON, Map, Math, Number, Object, Promise, RegExp, Set, String, URL,
    TextEncoder, TextDecoder, Uint8Array, console,
    crypto: {getRandomValues(bytes) { random++; bytes.fill(random); return bytes; }},
    KeygrainAutofill: {isSafeMatchingSite() { return true; }},
  });
  runInContext('globalThis = this;', context);
  runInContext(readFileSync(resolve(extensionRoot, 'shared/unlock-state.js'), 'utf8'), context);
  context.normalizeSite = value => value.replace(/^https:\/\//i, '').replace(/^http:\/\//i, '').split('/')[0].toLowerCase();
  context.derivePassword = async (secret, email, params) => { derivations.push({secret, email, params}); return forbiddenOutput ? 'Abcdefghjkmnpqrst2~Q' : 'Abcdefghjkmnpqrst2!Q'; };
  runInContext(readFileSync(resolve(extensionRoot, 'shared/browser-owner.js'), 'utf8'), context);
  context.adapterFixture = adapter;
  context.now = now;
  runInContext(`globalThis.owner = KeygrainBrowserOwner.createOwner({adapter: adapterFixture, settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>now});`, context);
  runInContext(`owner.manager.unlockFull({fullData:{secret:'master-secret',email:'owner@example.com',services:[{id:'svc-1',site:'https://example.com/login',name:'Example',email:'login@example.com'},{id:'svc-2',site:'example.com',email:'second@example.com'}]},records:[{id:'svc-1',site:'https://example.com/login',name:'Example',email:'login@example.com'},{id:'svc-2',site:'example.com',email:'second@example.com'}]})`, context);
  const sender = {id: 'ext', tab: null, url: 'chrome-extension://ext/popup.html'};
  const invoke = async request => {
    context.request = request;
    const result = await runInContext('owner.dispatchPopupRequest(_sender, "ext", request, "chrome", "chrome-extension://ext")', context);
    return JSON.parse(JSON.stringify(result));
  };
  context._sender = sender;
  return {context, invoke, derivations, deliveries, manager: () => context.owner.manager};
}

{
  const fixture = ownerB1Fixture();
  const options = await fixture.invoke({action: 'keygrain.password.options'});
  assert.equal(options.ok, true, 'owner options succeeds in full state');
  assert.deepEqual(options.result.items.map(item => Object.keys(item)), [['selectionToken', 'id', 'site', 'name', 'email'], ['selectionToken', 'id', 'site', 'name', 'email']], 'option key order is exact');
  assert.equal(Object.prototype.hasOwnProperty.call(options, 'secret'), false, 'options response has no secret');
  const first = options.result.items[0];
  const generate = await fixture.invoke({action: 'keygrain.password.generate', selectionToken: first.selectionToken, length: 20, symbols: '!@#$%&*-_=+?', counter: 1, policy: 'ascii-printable-v1'});
  assert.deepEqual(generate, {ok: true, result: {password: 'Abcdefghjkmnpqrst2!Q'}}, 'generation response is exact and bounded');
  assert.equal(fixture.derivations[0].secret, 'master-secret', 'derive receives worker secret only');
  assert.equal(fixture.derivations[0].email, 'login@example.com', 'derive receives bound service email');
  assert.equal(fixture.derivations[0].params.site, 'example.com', 'derive receives normalized bound site');
  assert.equal(Object.prototype.hasOwnProperty.call(generate.result, 'email'), false, 'generation does not return email');
  const replay = await fixture.invoke({action: 'keygrain.password.generate', selectionToken: first.selectionToken, length: 20, symbols: '!@#$%&*-_=+?', counter: 1, policy: 'ascii-printable-v1'});
  assert.equal(replay.code, 'KEYGRAIN_STALE_OPERATION', 'capability is single-use');
  const fresh = await fixture.invoke({action: 'keygrain.password.options'});
  const fill = await fixture.invoke({action: 'keygrain.password.fill', selectionToken: fresh.result.items[0].selectionToken, length: 20, symbols: '!@#$%&*-_=+?', counter: 1, policy: 'ascii-printable-v1', fillEmail: true});
  assert.equal(fill.ok, true, 'fill response is ok');
  assert.equal(fill.result.passwordFilled, true, 'fill response password');
  assert.equal(fill.result.emailFilled, true, 'fill response email');
  assert.equal(fixture.deliveries.find(item => item.password)?.password, 'Abcdefghjkmnpqrst2!Q', 'only derived password reaches adapter delivery');
  assert.equal(fixture.deliveries.find(item => item.password)?.email, 'login@example.com', 'only bound email reaches adapter delivery');
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.deliveries.find(item => item.password), 'secret'), false, 'secret never reaches page adapter');
  const bounded = await fixture.invoke({action: 'keygrain.password.options'});
  const invalid = await fixture.invoke({action: 'keygrain.password.generate', selectionToken: bounded.result.items[0].selectionToken, length: 7, symbols: '!@#$%&*-_=+?', counter: 1, policy: 'ascii-printable-v1'});
  assert.equal(invalid.code, 'KEYGRAIN_DERIVATION_ERROR', 'range error is derivation-safe');
  const malformed = await fixture.invoke({action: 'keygrain.password.generate', selectionToken: 'x', length: 20, symbols: '!@#$%&*-_=+?', counter: 1});
  assert.equal(malformed.code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR', 'missing policy is protocol-safe');
  assert.equal((await fixture.invoke({action: 'derivePassword'})).code, 'KEYGRAIN_CONSUMER_MIGRATION_REQUIRED', 'legacy derivation remains migration-required');
  const mutated = await fixture.invoke({action: 'keygrain.password.options'});
  fixture.manager().lockEverything();
  fixture.manager().unlockFull({fullData:{secret:'master-secret',email:'owner@example.com',services:[{id:'svc-1',site:'other.example',email:'login@example.com'}]},records:[{id:'svc-1',site:'other.example',email:'login@example.com'}]});
  const staleMutation = await fixture.invoke({action: 'keygrain.password.generate', selectionToken: mutated.result.items[0].selectionToken, length: 20, symbols: '!@#$%&*-_=+?', counter: 1, policy: 'ascii-printable-v1'});
  assert.equal(staleMutation.code, 'KEYGRAIN_STALE_OPERATION', 'lock/generation mutation invalidates capability');
}


function popupHarness({staleOptions = false, staleAction = false} = {}) {
  class Element {
    constructor(id = '') { this.id = id; this.children = []; this.handlers = {}; this._textContent = ''; Object.defineProperty(this, 'textContent', {get: () => this._textContent, set: value => { this._textContent = value; if (value === '') this.children = []; }}); this.value = ''; this.disabled = false; this.dataset = {}; this.classList = {add() {}, remove() {}, toggle() {}}; }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
    focus() {}
  }
  const ids = ['loading-screen', 'lock-screen', 'update-required-screen', 'main-screen', 'pin-screen', 'email', 'secret', 'auth-mode-unlock', 'auth-mode-create', 'create-confirm-group', 'confirm-secret', 'confirm-fingerprint', 'confirm-secret-match', 'unlock-btn', 'create-btn', 'status', 'service-list', 'search', 'sync-error', 'autolock-warning', 'autolock-extend', 'version-display', 'try-demo',
    'export-btn', 'import-btn', 'migrate-btn', 'help-btn', 'offline-btn', 'switch-account-btn', 'delete-server-btn'];
  const elements = new Map(ids.map(id => [id, new Element(id)]));
  const messages = [];
  let unload;
  let optionsCount = 0;
  const runtime = {
    getManifest() { return {name: 'Keygrain Keygrain DEV', version: '1'}; },
    async sendMessage(message) {
      messages.push(message);
      if (message.action === 'keygrain.popup.state') return (staleOptions && optionsCount > 0) || (staleAction && messages.some(item => item.action === 'keygrain.password.generate' || item.action === 'keygrain.password.fill')) ? {ok: true, result: {state: 'locked', stateGeneration: 2, authorizationGeneration: 2, fullExpiresAt: null, metadataExpiresAt: null, fullWarningAt: null, metadataWarningAt: null, metadataAvailable: false, hasFullData: false}} : {ok: true, result: {state: 'full', stateGeneration: 1, authorizationGeneration: 1, fullExpiresAt: 60000, metadataExpiresAt: null, fullWarningAt: 30000, metadataWarningAt: null, metadataAvailable: false, hasFullData: true}};
      if (message.action === 'keygrain.popup.serviceList') return {ok: true, result: {items: [{id: 'svc', site: 'example.com', name: null, email: 'user@example.com'}]}};
      if (message.action === 'keygrain.password.options') {
        optionsCount++;
        return {ok: true, result: {items: [{selectionToken: `token-${optionsCount}`, id: 'svc', site: 'example.com', name: null, email: 'user@example.com'}]}};
      }
      if (message.action === 'keygrain.password.generate') return {ok: true, result: {password: 'Abcdefghjkmnpqrst2!Q'}};
      if (message.action === 'keygrain.password.fill') return {ok: true, result: {passwordFilled: true, emailFilled: true}};
      return {ok: false, code: 'KEYGRAIN_AUTH_PROTOCOL_ERROR', message: 'Invalid authentication request.'};
    },
  };
  const document = {getElementById(id) { return elements.get(id) || null; }, createElement() { return new Element(); }};
  const window = {addEventListener(type, fn) { if (type === 'unload' || type === 'pagehide') unload = fn; }};
  const context = createContext({document, window, chrome: {runtime}, console, TextEncoder, TextDecoder, URL, crypto,
    KeygrainDiagnostics: {recordWorkerResponse() {}}, KeygrainWorkerIngress: {makeEnvelope: async () => ({})},
    Object, Array, Map, Set, Promise, Number, String, Error, JSON, Math, RegExp, Uint8Array, Date, setTimeout, clearTimeout,
  });
  runInContext(readFileSync(resolve(extensionRoot, 'shared/popup.js'), 'utf8'), context);
  return {elements, messages, unload: () => unload?.()};
}

{

{
  const forbiddenFixture = ownerB1Fixture({forbiddenOutput: true});
  const options = await forbiddenFixture.invoke({action: 'keygrain.password.options'});
  const forbidden = await forbiddenFixture.invoke({action: 'keygrain.password.generate', selectionToken: options.result.items[0].selectionToken, length: 20, symbols: '!@#$%&*-_=+?', counter: 1, policy: 'ascii-printable-v1'});
  assert.equal(forbidden.code, 'KEYGRAIN_DERIVATION_ERROR', 'worker rejects same-length forbidden output characters');
}

  const popup = popupHarness();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  const list = popup.elements.get('service-list');
  assert.equal(list.children.length, 1, 'popup renders compact password service rows during full owner view');
  assert.equal(popup.messages.filter(message => message.action === 'keygrain.password.options').length, 1, 'popup requests bounded password options during full render');
  assert.equal(popup.elements.get('main-screen').children.some(child => child.textContent === 'Password actions'), false,
    'popup does not render the broad password launcher');
  const row = list.children[0];
  assert.equal(row.className, 'service-item', 'password row reuses compact service hierarchy');
  assert.equal(row.children[0].className, 'service-info', 'password row has compact service info');
  assert.equal(row.children[1].className, 'service-actions', 'password row has compact action row');
  assert.equal(row.children[0].children[0].textContent, 'example.com', 'popup handles null name without raw record');
  const actions = row.children[1];
  const generateButton = actions.children[0];
  await generateButton.handlers.click();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  const generateRequest = popup.messages.find(message => message.action === 'keygrain.password.generate');
  assert.deepEqual(Object.keys(generateRequest), ['action', 'selectionToken', 'length', 'symbols', 'counter', 'policy'], 'popup generation envelope order is exact');
  assert.equal(generateRequest.selectionToken, 'token-1', 'popup sends only opaque selection token');
  assert.equal(popup.messages.some(message => Object.prototype.hasOwnProperty.call(message, 'site') || Object.prototype.hasOwnProperty.call(message, 'email')), false, 'popup sends no raw site/email');
  const beforeReplay = popup.messages.length;
  await actions.children[1].handlers.click();
  assert.equal(popup.messages.length, beforeReplay, 'sibling action cannot replay consumed token');
  await generateButton.handlers.click();
  assert.equal(popup.messages.length, beforeReplay, 'clicked token closure cannot replay');
  popup.unload();
  await generateButton.handlers.click();
  assert.equal(popup.messages.length, beforeReplay, 'unloaded popup old button cannot dispatch stale token');
  assert.equal(popup.elements.get('service-list').children.some(child => child.className === 'keygrain-password-result'), false, 'popup unload clears generated output');
}


{
  const stalePopup = popupHarness({staleOptions: true});
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  assert.equal(stalePopup.elements.get('service-list').children.length, 0, 'stale options response cannot repopulate popup');
  assert.equal(stalePopup.messages.filter(message => message.action === 'keygrain.password.options').length, 1, 'stale test issued one options request');
}


{
  const staleActionPopup = popupHarness({staleAction: true});
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  const row = staleActionPopup.elements.get('service-list').children[0];
  await row.children[1].children[0].handlers.click();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  assert.equal(staleActionPopup.elements.get('service-list').children.length, 0, 'stale generation response cannot repopulate password output');
}

