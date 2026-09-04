import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '..', 'shared', 'popup-crypto.js'), 'utf8');
const context = createContext({
  Array, ArrayBuffer, Error, JSON, Map, Math, Number, Object, Promise, RegExp, String,
  TextEncoder, TextDecoder, Uint8Array, console,
});
runInContext(source, context);

function validate(value) {
  context._value = value;
  return JSON.parse(runInContext('JSON.stringify(validateLocalPayload(_value))', context));
}
function rejects(value) {
  context._value = value;
  assert.throws(() => runInContext('validateLocalPayload(_value)', context), /invalid_local_payload/);
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('\nKeygrain Browser Owner / Local Payload Tests:');

await test('local v1 flat array is accepted without rewriting records', () => {
  const nested = {id: 'svc-1', unknown: {values: [1, true, null]}};
  const input = [nested];
  const result = validate(input);
  assert.deepEqual(result, {
    services: input,
    wallets: [], walletAuditLog: [], tombstones: [], deletionReview: [], pendingSync: null, payloadVersion: 1,
  });
  assert.equal(result.services[0].unknown.values[1], true);
});

await test('local v1 object accepts required fields and observed optional collections', () => {
  const input = {
    version: 1,
    services: [{id: 'svc-1'}],
    wallets: [{wallet_name: 'w', unknown: {x: 1}}],
    wallet_audit_log: [{event: 'create'}],
  };
  assert.deepEqual(validate(input), {
    services: input.services,
    wallets: input.wallets,
    walletAuditLog: input.wallet_audit_log,
    tombstones: [], deletionReview: [], pendingSync: null, payloadVersion: 1,
  });
  assert.deepEqual(validate({version: 1, services: []}), {
    services: [], wallets: [], walletAuditLog: [], tombstones: [], deletionReview: [], pendingSync: null, payloadVersion: 1,
  });
});

await test('local v2 object requires and preserves the complete current container', () => {
  const input = {
    version: 2,
    services: [{}],
    wallets: [{unknown: ['kept']}],
    wallet_audit_log: [{audit: {unknown: true}}],
    tombstones: [{id: 'deleted', deleted_at: 1}],
    deletion_review: [{service: {}, seen: false}],
  };
  const before = JSON.stringify(input);
  const result = validate(input);
  assert.deepEqual(result, {
    services: input.services,
    wallets: input.wallets,
    walletAuditLog: input.wallet_audit_log,
    tombstones: input.tombstones,
    deletionReview: input.deletion_review,
    pendingSync: null,
    payloadVersion: 2,
  });
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(result.services, input.services);
  assert.deepEqual(result.services[0], {});
});

await test('server sync object is not accepted as a local v2 plaintext container', () => {
  rejects({services: [], wallets: [], wallet_audit_log: [], sync_conflicts: []});
});

await test('null, primitive, unversioned, and unsupported version forms reject', () => {
  for (const value of [null, true, 7, 'payload', {}, {version: 3, services: []},
    {version: 1.5, services: []}, {version: '2', services: []}]) rejects(value);
});

await test('unknown top-level keys reject for both local versions', () => {
  rejects({version: 1, services: [], extra: 1});
  rejects({version: 1, services: [], tombstones: []});
  rejects({version: 2, services: [], wallets: [], wallet_audit_log: [], tombstones: [], deletion_review: [], extra: 1});
});

await test('missing, null, and wrong collection types reject', () => {
  rejects({version: 1});
  rejects({version: 1, services: null});
  rejects({version: 1, services: [], wallets: null});
  rejects({version: 1, services: [], wallet_audit_log: {}});
  rejects({version: 2, services: [], wallets: [], wallet_audit_log: [], tombstones: []});
  rejects({version: 2, services: [], wallets: [], wallet_audit_log: [], tombstones: null, deletion_review: []});
  rejects({version: 2, services: [], wallets: [], wallet_audit_log: [], tombstones: [], deletion_review: {}});
});

await test('primitive, null, nested-array, and non-plain collection entries reject', () => {
  for (const entry of [null, 1, 'record', [], [1], new Date()]) {
    rejects([entry]);
    rejects({version: 2, services: [entry], wallets: [], wallet_audit_log: [], tombstones: [], deletion_review: []});
  }
});

await test('plain-object candidates are structural only, including an empty record', () => {
  const result = validate({version: 2, services: [{}], wallets: [], wallet_audit_log: [], tombstones: [], deletion_review: []});
  assert.deepEqual(result.services, [{}]);
  assert.equal(Object.keys(result.services[0]).length, 0);
});

await test('normalized collection arrays are fresh and input remains unchanged', () => {
  const input = {version: 2, services: [{id: 'x'}], wallets: [], wallet_audit_log: [], tombstones: [], deletion_review: []};
  const before = JSON.stringify(input);
  const result = validate(input);
  assert.notEqual(result.services, input.services);
  assert.notEqual(result.wallets, input.wallets);
  assert.equal(JSON.stringify(input), before);
});

console.log(`  ${passed} browser-owner payload tests passed`);


function ownerSource(browserName) {
  return readFileSync(resolve(__dirname, '..', browserName, 'background.js'), 'utf8');
}

async function runOwnerPrepare(browserName, options = {}) {
  const log = [];
  const storageData = {
    services: options.stored,
    syncKnownUUIDs: options.knownUUIDs || [],
    lastSyncTime: options.lastSyncTime,
  };
  const storage = {
    async get() { log.push('read'); return {...storageData}; },
    async set(value) {
      log.push(Object.prototype.hasOwnProperty.call(value, 'services') ? 'set:services' : 'set:marker');
      if (options.failSet) throw new Error('storage_set_failed');
    },
    async remove(key) {
      log.push(`remove:${key}`);
      if (options.failRemove) throw new Error('storage_remove_failed');
    },
  };
  const api = browserName === 'chrome' ? {chrome: {storage: {local: storage}}} : {browser: {storage: {local: storage}}};
  const context = createContext({
    Array, ArrayBuffer, Date, Error, JSON, Map, Math, Number, Object, Promise, RegExp, Set, String,
    TextEncoder, TextDecoder, Uint8Array, console, ...api,
  });
  runInContext(readFileSync(resolve(__dirname, '..', 'shared', 'popup-crypto.js'), 'utf8'), context);
  context.deriveStorageKey = async () => { log.push('deriveStorageKey'); return {fill() { log.push('clearKey'); }}; };
  context.encryptServices = async () => { log.push('encryptServices'); return {version: 2, iv: 'iv', ciphertext: 'ciphertext'}; };
  context.syncWithServer = async (...args) => {
    log.push(`sync:${JSON.stringify(args.slice(2))}`);
    if (options.syncError) throw new Error('sync_failed');
    return options.syncResult;
  };
  context.decryptServices = async () => {
    log.push('decryptServices');
    if (options.decryptError) throw new Error('decrypt_failed');
    return options.decoded;
  };
  context.migrateLocalPayload = (payload) => {
    log.push('migrate');
    if (options.migrationResult) return options.migrationResult;
    return {
      version: 2,
      services: payload.services.map(record => ({...record, synced: false})),
      wallets: payload.wallets,
      wallet_audit_log: payload.wallet_audit_log,
      tombstones: [],
      deletion_review: payload.deletion_review,
    };
  };
  const source = ownerSource(browserName);
  const start = source.indexOf('function plainRecord');
  const end = source.indexOf('const ' + (browserName === 'chrome' ? 'chrome' : 'firefox') + 'Owner =');
  assert(start >= 0 && end > start, `${browserName} owner preparation source boundaries`);
  runInContext(source.slice(start, end), context);
  try {
    const prepared = await runInContext('readAndPrepare({email:"user@example.com",secret:"secret"})', context);
    return {prepared, log};
  } catch (error) {
    return {error, log};
  }
}

for (const browserName of ['chrome', 'firefox']) {
  await test(`${browserName}: clean bootstrap maps and persists only after validation`, async () => {
    const result = await runOwnerPrepare(browserName, {
      syncResult: {
        services: [{id: 'svc', unknown: {kept: true}}],
        wallets: [], wallet_audit_log: [], tombstones: [], review: [],
      },
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.prepared.fullData.services, [{id: 'svc', unknown: {kept: true}}]);
    assert.deepEqual(result.log, ['read', 'sync:[[],[],[],[]]', 'deriveStorageKey', 'encryptServices', 'set:services', 'clearKey']);
  });

  await test(`${browserName}: clean bootstrap rejects null sync collections without owner write`, async () => {
    const result = await runOwnerPrepare(browserName, {
      syncResult: {services: null, wallets: [], wallet_audit_log: [], tombstones: [], review: []},
    });
    assert(result.error);
    assert.deepEqual(result.log, ['read', 'sync:[[],[],[],[]]']);
  });

  await test(`${browserName}: explicit null local services is not clean bootstrap`, async () => {
    const result = await runOwnerPrepare(browserName, {stored: null, syncResult: {
      services: [], wallets: [], wallet_audit_log: [], tombstones: [], review: [],
    }});
    assert(result.error);
    assert.deepEqual(result.log, ['read']);
  });

  await test(`${browserName}: local v1 validates, migrates, persists, then cleans up`, async () => {
    const result = await runOwnerPrepare(browserName, {
      stored: {version: 1, services: [{id: 'legacy'}]}, knownUUIDs: [], lastSyncTime: 9,
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.log, ['read', 'migrate', 'deriveStorageKey', 'encryptServices', 'set:services', 'clearKey', 'remove:syncKnownUUIDs', 'set:marker']);
    assert.deepEqual(result.prepared.fullData.services, [{id: 'legacy', synced: false}]);
  });

  await test(`${browserName}: malformed local v1 rejects before migration or write`, async () => {
    const result = await runOwnerPrepare(browserName, {stored: {version: 1, services: [{}], tombstones: []}});
    assert(result.error);
    assert.deepEqual(result.log, ['read']);
  });

  await test(`${browserName}: decrypted v1 validates, migrates, then persists`, async () => {
    const result = await runOwnerPrepare(browserName, {
      stored: {version: 2, iv: 'iv', ciphertext: 'ciphertext'},
      decoded: {payloadVersion: 1, services: [{id: 'legacy'}], wallets: [], walletAuditLog: [], tombstones: [], deletionReview: [],
      },
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.log, ['read', 'deriveStorageKey', 'decryptServices', 'migrate', 'clearKey', 'deriveStorageKey', 'encryptServices', 'set:services', 'clearKey', 'remove:syncKnownUUIDs']);
  });

  await test(`${browserName}: current v2 decrypts and prepares without a persistence write`, async () => {
    const result = await runOwnerPrepare(browserName, {
      stored: {version: 2, iv: 'iv', ciphertext: 'ciphertext'},
      decoded: {payloadVersion: 2, services: [{id: 'current'}], wallets: [], walletAuditLog: [], tombstones: [], deletionReview: [],
      },
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.log, ['read', 'deriveStorageKey', 'decryptServices', 'clearKey']);
    assert.deepEqual(result.prepared.fullData.services, [{id: 'current'}]);
  });

  await test(`${browserName}: malformed migration output rejects before persistence`, async () => {
    const result = await runOwnerPrepare(browserName, {
      stored: {version: 1, services: [{id: 'legacy'}]},
      migrationResult: {version: 2, services: null, wallets: [], wallet_audit_log: [], tombstones: [], deletion_review: [],
      },
    });
    assert(result.error);
    assert.deepEqual(result.log, ['read', 'migrate']);
  });

  await test(`${browserName}: sync error and persistence failure do not run cleanup`, async () => {
    const syncFailure = await runOwnerPrepare(browserName, {syncError: true});
    assert(syncFailure.error);
    assert.deepEqual(syncFailure.log, ['read', 'sync:[[],[],[],[]]']);
    const writeFailure = await runOwnerPrepare(browserName, {
      stored: {version: 1, services: [{id: 'legacy'}]}, failSet: true,
    });
    assert(writeFailure.error);
    assert.deepEqual(writeFailure.log, ['read', 'migrate', 'deriveStorageKey', 'encryptServices', 'set:services', 'clearKey']);
  });

  await test(`${browserName}: owner source has no local truthy payload coercion`, async () => {
    const source = ownerSource(browserName);
    assert.doesNotMatch(source, /result\.(?:services|wallets|wallet_audit_log|tombstones|review)\s*\|\|/);
    assert.doesNotMatch(source, /data\.services\s*\|\|\s*data/);
  });
}


function makeConfirmationRuntime(browserName, options = {}) {
  let handler;
  let issueCount = 0;
  let clearCount = 0;
  let resolveSettings;
  const settingsResult = {
    keygrainSecurityLeaseSettings: {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400},
  };
  const settingsPromise = new Promise(resolve => { resolveSettings = resolve; });
  const storage = {
    async get(key) {
      if (key === 'keygrainSecurityLeaseSettings') {
        if (options.rejectSettings) throw Object.assign(new Error('settings unavailable'), {code: 'KEYGRAIN_SETTINGS_STORAGE_ERROR'});
        if (options.pendingSettings) return settingsPromise;
        return settingsResult;
      }
      if (key === 'settings') return {};
      return {};
    },
    async set() {},
    async remove() {},
  };
  const runtime = {
    id: 'extension-id',
    getURL() { return `${browserName === 'chrome' ? 'chrome' : 'moz'}-extension://extension-id/`; },
    onMessage: {addListener(fn) { handler = fn;}},
    onSuspend: {addListener() {}},
  };
  const api = {storage: {local: storage}, runtime};
  const contextValues = {
    Array, ArrayBuffer, Date, Error, JSON, Map, Math, Number, Object, Promise, RegExp, Set, String, URL,
    TextEncoder, TextDecoder, Uint8Array, console, KEYGRAIN_SETTINGS_KEY: 'keygrainSecurityLeaseSettings',
    normalizeSecuritySettings: value => value || {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400},
    KeygrainStateManager: function () {
      this.snapshot = () => ({state: 'locked'});
      this.applySettings = () => {};
      this.expire = () => ({state: 'locked'});
      this.invalidate = () => ({state: 'locked'});
    },
    confirmExceptionalFullLease: () => { issueCount++; return Object.freeze({}); },
    KeygrainWorkerIngress: {
      createIngress: async () => ({
        issueChallenge: async () => ({version: 1, challenge: 'fixture'}),
        admitUnlock: async () => ({ok: true}),
        revokeAll() {},
      }),
    },
    ...api,
    importScripts: () => {},
  };
  if (browserName === 'chrome') contextValues.chrome = api;
  else contextValues.browser = api;
  contextValues.importScripts = () => {};
  const context = createContext(contextValues);
  runInContext('globalThis = this;', context);
  runInContext(readFileSync(resolve(__dirname, '..', 'shared', 'browser-owner.js'), 'utf8'), context);
  runInContext(readFileSync(resolve(__dirname, '..', browserName, 'background.js'), 'utf8'), context);
  return {
    issueCount: () => issueCount,
    clearCount: () => clearCount,
    resolveSettings,
    handler,
    sender: {id: 'extension-id', tab: null, url: `${browserName === 'chrome' ? 'chrome' : 'moz'}-extension://extension-id/popup.html`},
    context,
    noteClear: () => { clearCount++; },
  };
}

{
  const validatorContext = createContext({Array, Error, JSON, Map, Math, Number, Object, Promise, RegExp, Set, String, URL, console});
  runInContext('globalThis = this;', validatorContext);
  runInContext(readFileSync(resolve(__dirname, '..', 'shared', 'browser-owner.js'), 'utf8'), validatorContext);
  const valid = runInContext('KeygrainBrowserOwner.validateConfirmationMessage({action:"requestExceptionalConfirmation",popupSessionId:"popup-1"}, "requestExceptionalConfirmation")', validatorContext);
  assert.deepEqual(JSON.parse(JSON.stringify(valid)), {action: 'requestExceptionalConfirmation', popupSessionId: 'popup-1'});
  for (const value of [null, 1, {}, {action: 'requestExceptionalConfirmation'},
    {action: 'requestExceptionalConfirmation', popupSessionId: ''},
    {action: 'cancelExceptionalConfirmation', popupSessionId: 'popup-1'},
    {action: 'requestExceptionalConfirmation', popupSessionId: 'popup-1', extra: true}]) {
    validatorContext._value = value;
    assert.throws(() => runInContext('KeygrainBrowserOwner.validateConfirmationMessage(_value, "requestExceptionalConfirmation")', validatorContext), /KEYGRAIN_AUTH_PROTOCOL_ERROR/);
  }
  const getter = {};
  Object.defineProperty(getter, 'action', {enumerable: true, get() { return 'requestExceptionalConfirmation'; }});
  Object.defineProperty(getter, 'popupSessionId', {enumerable: true, value: 'popup-1'});
  validatorContext._value = getter;
  assert.throws(() => runInContext('KeygrainBrowserOwner.validateConfirmationMessage(_value, "requestExceptionalConfirmation")', validatorContext), /KEYGRAIN_AUTH_PROTOCOL_ERROR/);
}

for (const browserName of ['chrome', 'firefox']) {
  await test(`${browserName}: exceptional confirmation waits for startup settings`, async () => {
    const runtime = makeConfirmationRuntime(browserName, {pendingSettings: true});
    const invoke = message => browserName === 'chrome'
      ? new Promise(resolve => runtime.handler(message, runtime.sender, resolve))
      : Promise.resolve(runtime.handler(message, runtime.sender));
    const responsePromise = invoke({
      action: 'requestExceptionalConfirmation', popupSessionId: 'popup-1',
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(runtime.issueCount(), 0);
    runtime.resolveSettings({keygrainSecurityLeaseSettings: {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400}});
    const response = await responsePromise;
    assert.equal(response.ok, true);
    assert.equal(runtime.issueCount(), 1);
  });

  await test(`${browserName}: settings failure blocks issue and cancellation`, async () => {
    const runtime = makeConfirmationRuntime(browserName, {rejectSettings: true});
    const invoke = message => browserName === 'chrome'
      ? new Promise(resolve => runtime.handler(message, runtime.sender, resolve))
      : Promise.resolve(runtime.handler(message, runtime.sender));
    const request = invoke({
      action: 'requestExceptionalConfirmation', popupSessionId: 'popup-1',
    });
    const cancel = invoke({
      action: 'cancelExceptionalConfirmation', popupSessionId: 'popup-1',
    });
    assert.equal((await request).code, 'KEYGRAIN_SETTINGS_STORAGE_ERROR');
    assert.equal((await cancel).code, 'KEYGRAIN_SETTINGS_STORAGE_ERROR');
    assert.equal(runtime.issueCount(), 0);
  });

  await test(`${browserName}: malformed confirmation never reaches startup/token state`, async () => {
    const runtime = makeConfirmationRuntime(browserName, {pendingSettings: true});
    const invoke = message => browserName === 'chrome'
      ? new Promise(resolve => runtime.handler(message, runtime.sender, resolve))
      : Promise.resolve(runtime.handler(message, runtime.sender));
    const response = await invoke({
      action: 'requestExceptionalConfirmation', popupSessionId: 'popup-1', extra: true,
    });
    assert.equal(response.code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR');
    assert.equal(runtime.issueCount(), 0);
  });

  await test(`${browserName}: source awaits startup before issue and clear`, async () => {
    const source = ownerSource(browserName);
    const startup = source.indexOf('const startupPromise');
    const startupLoad = source.indexOf('await ' + (browserName === 'chrome' ? 'chrome' : 'firefox') + 'Owner.loadSettings()', startup);
    const issueBlock = source.indexOf('if (action === "requestExceptionalConfirmation")');
    const cancelBlock = source.indexOf('if (action === "cancelExceptionalConfirmation")');
    assert(startup >= 0 && startupLoad > startup && issueBlock > startup && cancelBlock > issueBlock);
    const issueText = source.slice(issueBlock, cancelBlock);
    const cancelText = source.slice(cancelBlock, source.indexOf('if (action === "heartbeat"', cancelBlock));
    assert.match(issueText, /startupPromise\.then\(\(\) =>/);
    assert.match(cancelText, /startupPromise\.then\(\(\) =>/);
    assert.doesNotMatch(source.slice(startup, issueBlock), /catch \(\) => \{\}/);
  });
}

// Popup unlock regression: Firefox's sender URL uses an internal UUID, while
// runtime.id remains the manifest ID. Both listeners must pass the runtime-derived
// exact origin to the worker owner without changing the atomic five-field message.
async function runPopupUnlockListenerCase(browserName) {
  const source = readFileSync(resolve(__dirname, '..', browserName, 'background.js'), 'utf8');
  const runtimeId = browserName === 'chrome' ? 'extension-id' : 'extension@keygrain.com';
  const extensionOrigin = browserName === 'chrome'
    ? 'chrome-extension://extension-id'
    : 'moz-extension://9f2b7f8a-2d2e-4d9f-a7f3-4b7dd9a2d111';
  const runtime = {
    id: runtimeId,
    getURL() { return `${extensionOrigin}/`; },
    onMessage: {addListener(fn) { this.handler = fn; }},
    onSuspend: {addListener() {}},
  };
  const storage = {
    async get(key) { return key === 'settings' ? {settings: {}} : {}; },
    async set() {},
    async remove() {},
  };
  const tabs = {async query() { return []; }};
  const alarms = {async clear() {}, async create() {}};
  const action = {async setBadgeText() {}};
  const scripting = {
    async getRegisteredContentScripts() { return []; },
    async unregisterContentScripts() {},
  };
  const api = browserName === 'chrome'
    ? {storage: {local: storage}, runtime, tabs, alarms, action, scripting}
    : {storage: {local: storage}, runtime, tabs, alarms, action, scripting};
  const ctx = createContext({
    Array, ArrayBuffer, Date, Error, JSON, Map, Math, Number, Object, Promise, RegExp, Set,
    String, URL, Uint8Array, console,
    KeygrainWorkerIngress: {
      createIngress: async () => ({
        issueChallenge: async () => ({version: 1, challenge: 'fixture'}),
        admitUnlock: async () => ({ok: true}),
        revokeAll() {},
      }),
    },
    ...(browserName === 'chrome' ? {chrome: api, importScripts() {}}
      : {browser: api, importScripts() {}}),
  });
  runInContext('globalThis = this;', ctx);
  runInContext(readFileSync(resolve(__dirname, '..', 'shared', 'browser-owner.js'), 'utf8'), ctx);
  const realOwnerApi = ctx.KeygrainBrowserOwner;
  const unlockCalls = [];
  const popupDispatchCalls = [];
  const fakeOwner = {
    async loadSettings() {},
    reconcile() {},
    whenReconciled() { return Promise.resolve(); },
    shutdown() {},
    unlock(sender, id, message, browser, origin) {
      if (!realOwnerApi.isTrustedExtensionPage(sender, id, message.action, browser, origin)) {
        return Promise.resolve(realOwnerApi.safeFailure(realOwnerApi.CONTEXT_ERROR));
      }
      unlockCalls.push({sender, id, message, browser, origin});
      return Promise.resolve({ok: true});
    },
    dispatchPopupRequest(sender, id, message, browser, origin) {
      popupDispatchCalls.push({sender, id, message, browser, origin});
      return Promise.resolve(realOwnerApi.safeFailure(realOwnerApi.AUTH_PROTOCOL_ERROR));
    },
    dispatchLegacyOrPhaseB() { return realOwnerApi.safeFailure(realOwnerApi.CONTEXT_ERROR); },
    issueConfirmation() { return 'confirmation'; },
    clearConfirmationSession() {},
  };
  ctx.KeygrainBrowserOwner = Object.freeze({...realOwnerApi, createOwner: () => fakeOwner});
  runInContext(source, ctx);
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));

  const popupSender = {
    id: runtimeId,
    url: `${extensionOrigin}/popup.html`,
    origin: extensionOrigin,
    frameId: 0,
    documentId: 'popup-document-1',
  };
  assert.match(source, /issueUnlockChallenge/);
  assert.match(source, /unlockEncrypted/);
  assert.match(source, /KeygrainWorkerIngress\.createIngress/);
  assert.doesNotMatch(source, /keygrain(?:Chrome|Firefox)Owner\.unlock\(sender,.*message/);
  const popupMessage = {
    action: 'unlock', email: 'user@example.test', secret: 'fixture-secret',
    popupSessionId: 'popup-session-1', confirmationId: null,
  };
  const invoke = (message, sender) => browserName === 'chrome'
    ? new Promise((resolvePromise, rejectPromise) => {
      const result = runtime.onMessage.handler(message, sender, resolvePromise);
      if (result && typeof result.then === 'function') result.then(resolvePromise, rejectPromise);
    })
    : Promise.resolve(runtime.onMessage.handler(message, sender));
  const plaintextRejected = await invoke(popupMessage, popupSender);
  assert.equal(plaintextRejected.code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR', `${browserName}: internal unlock is not an external runtime route`);
  assert.equal(unlockCalls.length, 0, `${browserName}: internal unlock never reaches owner`);
  const fixedDispatch = await invoke({action: 'keygrain.popup.state'}, popupSender);
  assert.equal(fixedDispatch.code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR', `${browserName}: fixed action reaches the owner dispatcher fixture`);
  assert.equal(popupDispatchCalls.length, 2, `${browserName}: only non-core messages use popup dispatch`);
  assert.equal(popupDispatchCalls[1].message.action, 'keygrain.popup.state');
  let getterProbed = false;
  const getterMessage = {};
  Object.defineProperty(getterMessage, 'action', {enumerable: true, get() { getterProbed = true; return 'heartbeat'; }});
  const getterRejected = await invoke(getterMessage, popupSender);
  assert.equal(getterRejected.code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR', `${browserName}: trusted getter is malformed`);
  assert.equal(getterProbed, false, `${browserName}: trusted getter was not invoked by listener peek`);
  const unknownRejected = await invoke({action: 'futureAction'}, popupSender);
  assert.equal(unknownRejected.code, 'KEYGRAIN_AUTH_PROTOCOL_ERROR', `${browserName}: trusted unknown is protocol-invalid`);
  assert.equal(popupDispatchCalls.length, 4, `${browserName}: malformed/unknown requests use shared dispatch`);

  for (const [label, sender] of [
    ['wrong id', {...popupSender, id: 'other-extension'}],
    ['wrong origin', {...popupSender, url: `${browserName === 'chrome' ? 'chrome' : 'moz'}-extension://other-origin/popup.html`, origin: 'other-origin'}],
    ['wrong scheme', {...popupSender, url: `https://example.test/popup.html`, origin: 'https://example.test'}],
    ['tab sender', {...popupSender, tab: {id: 7}}],
  ]) {
    const rejected = await invoke({action: 'issueUnlockChallenge', popupSessionId: 'popup-session-1'}, sender);
    assert.equal(rejected.code, 'KEYGRAIN_CONTEXT_ERROR', `${browserName}: ${label} challenge rejected`);
  }
  assert.equal(unlockCalls.length, 0, `${browserName}: rejected senders never reach owner`);
}

for (const browserName of ['chrome', 'firefox']) {
  await runPopupUnlockListenerCase(browserName);
}

// Indicator reconciliation uses only the frozen manager handle projection and
// suppresses stale adapter completion before it can affect a newer state.
{
  const ctx = createContext({Array, ArrayBuffer, Date, Error, JSON, Map, Math, Number, Object, Promise,
    RegExp, Set, String, URL, Uint8Array, console});
  runInContext('globalThis = this;', ctx);
  runInContext(readFileSync(resolve(__dirname, '..', 'shared', 'unlock-state.js'), 'utf8'), ctx);
  runInContext('globalThis.KeygrainInline = {computeMatchPatterns: records => records.map(r => "*://" + r.site + "/*")};', ctx);
  runInContext(readFileSync(resolve(__dirname, '..', 'shared', 'browser-owner.js'), 'utf8'), ctx);
  const calls = [];
  let releaseFirst;
  const storage = {async get() { return {keygrainSecurityLeaseSettings: {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400}}; }, async set() {}, async remove() {}};
  ctx._adapter = {
    browser: 'chrome', storage,
    async reconcileIndicators(payload) {
      calls.push(payload);
      assert.equal(Object.prototype.hasOwnProperty.call(payload.projection || {}, 'secret'), false);
      if (calls.length === 1) {
        await new Promise(resolvePromise => { releaseFirst = resolvePromise; });
        payload.check();
      }
    },
  };
  runInContext('globalThis.owner = KeygrainBrowserOwner.createOwner({adapter:_adapter, settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>1000})', ctx);
  runInContext('owner.manager.unlockFull({fullData:{secret:"must-not-cross",email:"user@example.com",services:[{id:"svc",site:"example.com",name:"Work",email:"user@example.com",password:"secret"}]},records:[{id:"svc",site:"example.com",name:"Work",email:"user@example.com"}]}); owner.reconcile("unlock")', ctx);
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  assert.equal(calls.length, 1);
  runInContext('owner.manager.lockEverything(); owner.reconcile("lock")', ctx);
  releaseFirst();
  await runInContext('owner.whenReconciled()', ctx);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].after.state, 'locked');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].projection.matches)), ['*://example.com/*']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].projection.accounts)), [{token: 'svc', email: 'user@example.com', name: 'Work'}]);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].projection, 'services'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].projection, 'secret'), false);
}

// Generic adapter failures are non-authorizing and do not prevent a newer
// generation from reconciling; stale cleanup remains owned by the adapter.
{
  const ctx = createContext({Array, ArrayBuffer, Date, Error, JSON, Map, Math, Number, Object, Promise,
    RegExp, Set, String, URL, Uint8Array, console});
  runInContext('globalThis = this;', ctx);
  runInContext(readFileSync(resolve(__dirname, '..', 'shared', 'unlock-state.js'), 'utf8'), ctx);
  runInContext('globalThis.KeygrainInline = {computeMatchPatterns: () => []};', ctx);
  runInContext(readFileSync(resolve(__dirname, '..', 'shared', 'browser-owner.js'), 'utf8'), ctx);
  const states = [];
  const storage = {async get() { return {keygrainSecurityLeaseSettings: {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400}}; }, async set() {}, async remove() {}};
  let failFirst = true;
  ctx._adapter = {
    browser: 'firefox', storage,
    async reconcileIndicators({after}) {
      states.push(after.state);
      if (failFirst) { failFirst = false; throw new Error('register rejected'); }
    },
  };
  runInContext('globalThis.owner = KeygrainBrowserOwner.createOwner({adapter:_adapter, settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>1000}); owner.manager.unlockFull({fullData:{secret:"s",services:[]},records:[]}); owner.reconcile("unlock")', ctx);
  await runInContext('owner.whenReconciled()', ctx);
  runInContext('owner.manager.lockEverything(); owner.reconcile("lock")', ctx);
  await runInContext('owner.whenReconciled()', ctx);
  assert.deepEqual(states, ['full', 'locked']);
}

// Execute the browser-specific adapter callbacks against fake WebExtension APIs.
async function runAdapterCase(browserName, scenario) {
  const source = readFileSync(resolve(__dirname, '..', browserName, 'background.js'), 'utf8');
  const start = source.indexOf('const KEYGRAIN_DEFAULT_SETTINGS');
  const end = source.indexOf('function plainRecord', start);
  const calls = [];
  const flags = {unregisterReject: false, registerReject: false, badgeReject: false};
  const storage = {
    async get(key) {
      calls.push(`storage.get:${String(key)}`);
      if (key === 'inlineAutofillEnabled') return {inlineAutofillEnabled: true};
      return {};
    },
  };
  const tabs = {async query() { calls.push('tabs.query'); return [{id: 1, url: 'https://www.example.com/login'}]; }};
  const alarms = {async clear(name) { calls.push(`alarms.clear:${name}`); }, async create(name) { calls.push(`alarms.create:${name}`); }};
  const action = {async setBadgeText(value) { calls.push(`badge:${value.text}`); if (flags.badgeReject) throw new Error('badge'); }};
  const scripting = {
    async getRegisteredContentScripts() { calls.push('getRegistered'); return scenario.registered ? [{id: 'keygrain-inline'}] : []; },
    async unregisterContentScripts() { calls.push('unregister'); if (flags.unregisterReject) throw new Error('unregister'); scenario.registered = false; },
    async registerContentScripts() { calls.push('register'); if (flags.registerReject) throw new Error('register'); scenario.registered = true; },
    async executeScript() { calls.push('execute'); },
  };
  const api = browserName === 'chrome'
    ? {storage: {local: storage}, tabs, alarms, action, scripting, runtime: {id: 'ext'}}
    : {storage: {local: storage}, tabs, alarms, action, scripting, runtime: {id: 'ext'}};
  const ctx = createContext({Array, ArrayBuffer, Date, Error, JSON, Map, Math, Number, Object, Promise,
    RegExp, Set, String, URL, Uint8Array, console, KeygrainAutofill: {isSafeMatchingSite: () => true},
    ...(browserName === 'chrome' ? {chrome: api} : {browser: api})});
  runInContext('globalThis = this;', ctx);
  runInContext(source.slice(start, end), ctx);
  const fn = browserName === 'chrome' ? 'chromeReconcileIndicators' : 'firefoxReconcileIndicators';
  const shutdown = browserName === 'chrome' ? 'chromeShutdown' : 'firefoxShutdown';
  const payload = {after: {state: 'full', stateGeneration: 1, authorizationGeneration: 1, fullExpiresAt: 2000, metadataExpiresAt: null}, projection: {matches: ['*://example.com/*'], badgeSites: ['example.com'], accounts: []}, check: () => true};
  ctx._payload = payload;
  await runInContext(`${fn}(_payload)`, ctx);
  assert(calls.includes('register'), `${browserName}: adapter registered`);
  const writesBefore = calls.filter(value => value.startsWith('badge:')).length;

  flags.unregisterReject = true;
  ctx._payload = {...payload, after: {...payload.after, state: 'locked', stateGeneration: 2}};
  await runInContext(`${fn}(_payload)`, ctx);
  assert.equal(calls.filter(value => value === 'register').length, 1, `${browserName}: unregister rejection blocks replacement`);
  flags.unregisterReject = false;

  scenario.registered = false;
  flags.registerReject = true;
  ctx._payload = payload;
  await runInContext(`${fn}(_payload)`, ctx);
  assert.equal(calls.filter(value => value === 'register').length, 2, `${browserName}: register rejection attempted once`);
  flags.registerReject = false;

  flags.badgeReject = true;
  await runInContext(`${fn}(_payload)`, ctx);
  const writesAfterFailure = calls.filter(value => value.startsWith('badge:')).length;
  assert(writesAfterFailure >= writesBefore, `${browserName}: badge failure reached the write path`);
  flags.badgeReject = false;
  await runInContext(`${fn}(_payload)`, ctx);
  assert.equal(calls.filter(value => value.startsWith('badge:')).length, writesAfterFailure,
    `${browserName}: unknown indicator blocks later writes`);

  if (browserName === 'chrome') scenario.registered = true;
  await runInContext(`${shutdown}()`, ctx);
  assert(calls.includes('unregister'), `${browserName}: startup/shutdown teardown`);
}

for (const browserName of ['chrome', 'firefox']) {
  await runAdapterCase(browserName, {registered: false});
}


// B2 MV3 adapter contract: browser-specific proof differs only by Chrome
// documentId versus Firefox per-document nonce; envelopes remain fixed.
const chromeBackgroundSource = readFileSync(resolve(__dirname, '..', 'chrome', 'background.js'), 'utf8');
const firefoxBackgroundSource = readFileSync(resolve(__dirname, '..', 'firefox', 'background.js'), 'utf8');
for (const background of [chromeBackgroundSource, firefoxBackgroundSource]) {
  assert.match(background, /keygrain\.totp\.contextProbe/);
  assert.match(background, /keygrain\.totp\.contextProof/);
  assert.match(background, /keygrain\.totp\.fillResult/);
  assert.match(background, /getActiveTotpContext/);
  assert.match(background, /proveTotpContext/);
  assert.match(background, /deliverTotp/);
  assert.match(background, /KEYGRAIN_TOTP_DELIVERY_TTL_MS/);
}
const chromeTotpBlock = chromeBackgroundSource.slice(chromeBackgroundSource.indexOf('const chromeTotpBindings'), chromeBackgroundSource.indexOf('const chromeOwnerAdapter'));
const firefoxTotpBlock = firefoxBackgroundSource.slice(firefoxBackgroundSource.indexOf('const firefoxTotpBindings'), firefoxBackgroundSource.indexOf('const firefoxOwnerAdapter'));
assert.match(chromeTotpBlock, /sender\.documentId/);
assert.match(chromeTotpBlock, /documentId: sender\.documentId/);
assert.doesNotMatch(firefoxTotpBlock, /documentId/);
assert.match(chromeTotpBlock, /\["action", "challenge", "nonce", "hasOtpField"\]/);
assert.match(firefoxTotpBlock, /\["action", "challenge", "nonce", "hasOtpField"\]/);
assert.match(chromeTotpBlock, /\["ok", "result"\]/);
assert.match(firefoxTotpBlock, /\["ok", "result"\]/);
assert.doesNotMatch(firefoxTotpBlock, /browserAction|tabs\.executeScript|contentScripts\.register|chrome\./);
assert.match(chromeTotpBlock, /message\.hasOtpField !== true/);
assert.match(firefoxTotpBlock, /message\.hasOtpField !== true/);
assert.match(chromeTotpBlock, /TotpBounded\(message\.challenge\)/);
assert.match(firefoxTotpBlock, /TotpBounded\(message\.challenge\)/);
assert.match(chromeTotpBlock, /proof\.reject\?\.\(/);
assert.match(chromeTotpBlock, /pending\.reject\?\.\(/);
assert.match(firefoxTotpBlock, /proof\.reject\?\.\(/);
assert.match(firefoxTotpBlock, /pending\.reject\?\.\(/);
console.log('indicator reconciliation tests passed');
