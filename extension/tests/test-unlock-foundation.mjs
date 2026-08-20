import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = resolve(__dirname, '..', 'shared');

function makeContext(argon2id) {
  const crypto = {
    subtle: {
      importKey: async () => ({}),
      sign: async () => new Uint8Array(32),
    },
  };
  const ctx = createContext({
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Promise,
    Math,
    Number,
    String,
    Object,
    Error,
    RangeError,
    crypto,
    globalThis: undefined,
    hashwasm: {argon2id},
  });
  runInContext('globalThis = this;', ctx);
  runInContext(readFileSync(resolve(shared, 'keygrain.js'), 'utf8'), ctx);
  runInContext(readFileSync(resolve(shared, 'unlock-state.js'), 'utf8'), ctx);
  return ctx;
}

// A rejected Argon2 operation must not poison the next operation.
{
  let calls = 0;
  const ctx = makeContext(async () => {
    calls++;
    if (calls === 1) throw new Error('planned Argon2 failure');
    return new Uint8Array(32).fill(7);
  });

  await assert.rejects(
    runInContext('strengthenSecret("secret", "user@example.com")', ctx),
    /planned Argon2 failure/
  );
  const result = await runInContext('strengthenSecret("secret", "user@example.com")', ctx);
  assert.equal(calls, 2);
  assert.equal(result.length, 32);
  assert.equal(result[0], 7);
}

// Clearing while Argon2 is in flight rejects the stale operation and prevents
// cache installation.
{
  let calls = 0;
  let resolveHash;
  const ctx = makeContext(() => {
    calls++;
    return new Promise(resolvePromise => { resolveHash = resolvePromise; });
  });

  const first = runInContext('strengthenSecret("secret", "user@example.com")', ctx);
  runInContext('clearStrengthenCache()', ctx);
  resolveHash(new Uint8Array(32).fill(9));
  await assert.rejects(first, /stale strengthen operation/);

  // The clear invalidated the in-flight result, so the next call must derive again.
  runInContext('clearStrengthenCache()', ctx);
  const second = runInContext('strengthenSecret("secret", "user@example.com")', ctx);
  assert.equal(calls, 2);
  resolveHash(new Uint8Array(32).fill(10));
  const secondResult = await second;
  assert.equal(secondResult[0], 10);
}

// Synchronous Argon2 initialization failures are rejected and still pass
// through the input-buffer cleanup finally block.
{
  const ctx = makeContext(() => {
    throw new Error('synchronous Argon2 failure');
  });
  await assert.rejects(
    runInContext('strengthenSecret("secret", "user@example.com")', ctx),
    /synchronous Argon2 failure/
  );
}

// Cached results are returned as copies so a caller cannot mutate the cache.
{
  let calls = 0;
  const ctx = makeContext(async () => {
    calls++;
    return new Uint8Array(32).fill(11);
  });
  const first = await runInContext('strengthenSecret("secret", "user@example.com")', ctx);
  first[0] = 0;
  const second = await runInContext('strengthenSecret("secret", "user@example.com")', ctx);
  assert.equal(calls, 1);
  assert.equal(second[0], 11);
}

// A consumer that has already received strengthened bytes must still reject
// after invalidation during a later asynchronous HMAC/stream step.
{
  const ctx = makeContext(async () => new Uint8Array(32).fill(12));
  let firstSign = true;
  let resolveSign;
  ctx.crypto.subtle.sign = () => {
    if (firstSign) {
      firstSign = false;
      return new Promise(resolvePromise => { resolveSign = resolvePromise; });
    }
    return Promise.resolve(new Uint8Array(32));
  };
  const operation = runInContext(
    'derivePassword("secret", "user@example.com", {site: "example.com"})',
    ctx
  );
  for (let i = 0; i < 10 && typeof resolveSign !== "function"; i++) {
    await new Promise(resolvePromise => setTimeout(resolvePromise, 0));
  }
  assert.equal(typeof resolveSign, "function");
  runInContext('clearStrengthenCache()', ctx);
  resolveSign(new Uint8Array(32));
  await assert.rejects(operation, /stale strengthen operation/);
}
// Keygrain manager loading, exact exports, and generation/operation foundation.
{
  const ctx = makeContext(async () => new Uint8Array(32));
  runInContext('globalThis.nowValue=1000; globalThis.manager=new KeygrainStateManager({clock:()=>nowValue,settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}})', ctx);
  assert.equal(runInContext('manager.snapshot().state', ctx), 'locked');
  const exports = JSON.parse(runInContext('JSON.stringify(Object.keys(globalThis).filter(key => key.startsWith("KEYGRAIN") || key.startsWith("Keygrain") || ["confirmExceptionalFullLease", "migrateSecuritySettings", "normalizeSecuritySettings", "projectMetadataState"].includes(key)).sort())', ctx));
  assert.deepEqual(exports, [
    'KeygrainStateManager', 'KEYGRAIN_COMPLETION_GRACE_SECONDS', 'KEYGRAIN_FULL_DEFAULT_SECONDS',
    'KEYGRAIN_FULL_EXCEPTIONAL_MAX_SECONDS', 'KEYGRAIN_FULL_MIN_SECONDS', 'KEYGRAIN_FULL_NORMAL_MAX_SECONDS',
    'KEYGRAIN_FULL_WARNING_LEAD_SECONDS', 'KEYGRAIN_METADATA_DEFAULT_SECONDS', 'KEYGRAIN_METADATA_MAX_SECONDS',
    'KEYGRAIN_METADATA_MIN_SECONDS', 'KEYGRAIN_METADATA_WARNING_LEAD_SECONDS', 'KEYGRAIN_SETTINGS_KEY',
    'KEYGRAIN_SETTINGS_VERSION', 'KEYGRAIN_STATE', 'confirmExceptionalFullLease',
    'migrateSecuritySettings', 'normalizeSecuritySettings', 'projectMetadataState',
  ].sort());
  for (const forbidden of ['KGUnlockStateManager','KG_UNLOCK_STATES','getFullData','getSecrets','setSecrets','setSecret','setEmail','getSecret','getEmail','autoLockMinutes']) {
    assert.equal(runInContext(`typeof globalThis[${JSON.stringify(forbidden)}]`, ctx), 'undefined', forbidden);
  }
  runInContext('manager.unlockFull({fullData:{secret:"s"},records:[]}); globalThis.handle=manager.beginSensitiveOperation({capture:()=>({x:1})}); globalThis.before=manager.snapshot().authorizationGeneration', ctx);
  assert.equal(runInContext('manager.checkSensitiveOperation(handle)', ctx), true);
  runInContext('manager.lockEverything()', ctx);
  assert.equal(runInContext('manager.snapshot().authorizationGeneration', ctx), 2);
  assert.throws(() => runInContext('manager.checkSensitiveOperation(handle)', ctx), error => error.code === 'KEYGRAIN_STALE_OPERATION');
}

{
  const chromeBackground = readFileSync(resolve(__dirname, '..', 'chrome', 'background.js'), 'utf8');
  const firefoxBackground = readFileSync(resolve(__dirname, '..', 'firefox', 'background.js'), 'utf8');
  const popup = readFileSync(resolve(shared, 'popup.js'), 'utf8');
  for (const [browser, source] of [['chrome', chromeBackground], ['firefox', firefoxBackground]]) {
    assert.match(source, /KeygrainBrowserOwner\.createOwner/, `${browser}: owner is not authoritative`);
    assert.match(source, /action === "heartbeat"/);
    assert.match(source, /action === "extendSensitive"/);
    assert.match(source, /action === "sync"/);
    assert.match(source, /dispatchLegacyOrPhaseB\(sender, (?:chrome|browser)\.runtime\.id, message/,
      `${browser}: heartbeat/Phase-B actions bypass the owner dispatcher`);
    assert.doesNotMatch(source, /resetAutoLock|extendFull|extendMetadata/,
      `${browser}: background contains a direct activity/lease extension path`);

    const isolated = createContext({
      URL, Set, Map, Object, Array, String, Number, RegExp, Math, JSON, Error, Date, console,
      Promise, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder,
    });
    runInContext('globalThis = this;', isolated);
    for (const dependency of ['unlock-state.js', 'browser-owner.js']) {
      runInContext(readFileSync(resolve(shared, dependency), 'utf8'), isolated);
    }
    runInContext(`
      globalThis.storageCalls = {get: 0, set: 0, remove: 0};
      globalThis.ownerStorage = {
        get: async () => { storageCalls.get++; return {}; },
        set: async () => { storageCalls.set++; },
        remove: async () => { storageCalls.remove++; },
      };
      globalThis.owner = KeygrainBrowserOwner.createOwner({
        adapter: {browser: ${JSON.stringify(browser)}, storage: ownerStorage},
        settings: {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400},
        clock: () => 1000,
      });
    `, isolated);
    const beforeSnapshot = JSON.parse(runInContext('JSON.stringify(owner.snapshot())', isolated));
    const beforeGeneration = runInContext('owner.generation', isolated);
    const sender = browser === 'chrome'
      ? '{tab:{id:13},frameId:0,documentId:"doc-heartbeat",url:"https://example.com/login"}'
      : '{tab:{id:13},frameId:0,url:"https://example.com/login"}';
    const expected = {ok: false, code: 'KEYGRAIN_CONTEXT_ERROR', message: 'This action is not available from this context.'};
    for (const action of ['heartbeat', 'extendSensitive', 'sync']) {
      const result = JSON.parse(runInContext(
        `JSON.stringify(owner.dispatchLegacyOrPhaseB(${sender}, "extension-id", {action: ${JSON.stringify(action)}}, ${JSON.stringify(browser)}))`,
        isolated
      ));
      assert.deepEqual(result, expected, `${browser}: ${action} must remain fail-closed`);
      assert.equal(Object.prototype.hasOwnProperty.call(result, 'secret'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(result, 'records'), false);
      assert.deepEqual(JSON.parse(runInContext('JSON.stringify(owner.snapshot())', isolated)), beforeSnapshot,
        `${browser}: ${action} changed authorization/lease state`);
      assert.equal(runInContext('owner.generation', isolated), beforeGeneration,
        `${browser}: ${action} renewed owner activity generation`);
      assert.deepEqual(JSON.parse(runInContext('JSON.stringify(storageCalls)', isolated)), {get: 0, set: 0, remove: 0},
        `${browser}: ${action} touched storage`);
    }
  }
  assert.doesNotMatch(chromeBackground, /chrome\.storage\.session/);
  assert.doesNotMatch(popup, /document\.addEventListener\("click", \(\) => sendMsg\(\{action: "heartbeat"\}\)\)/);
  assert.doesNotMatch(popup, /document\.addEventListener\("keydown", \(\) => sendMsg\(\{action: "heartbeat"\}\)\)/);
  assert.match(popup, /sendMsg\(\{action: "extendSensitive"\}\)/);
}

{
  const ownerSource = readFileSync(resolve(__dirname, '..', 'shared', 'browser-owner.js'), 'utf8');
  const chromeBackground = readFileSync(resolve(__dirname, '..', 'chrome', 'background.js'), 'utf8');
  const firefoxBackground = readFileSync(resolve(__dirname, '..', 'firefox', 'background.js'), 'utf8');
  assert.match(ownerSource, /captureIndicatorProjection/);
  assert.match(ownerSource, /scheduleIndicatorReconcile/);
  assert.match(ownerSource, /manager\.beginSensitiveOperation\(\{capture: captureIndicatorProjection\}\)/);
  assert.match(ownerSource, /manager\.checkSensitiveOperation\(handle\)/);
  assert.match(ownerSource, /token !== reconciliationToken/);
  assert.match(chromeBackground, /chrome\.scripting\.registerContentScripts/);
  assert.match(chromeBackground, /chrome\.action\.setBadgeText/);
  assert.match(firefoxBackground, /browser\.scripting\.registerContentScripts/);
  assert.match(firefoxBackground, /browser\.action\.setBadgeText/);
  assert.match(firefoxBackground, /browser\.scripting\.registerContentScripts/);
  assert.doesNotMatch(firefoxBackground, /browser\.browserAction|browser\.tabs\.executeScript|browser\.contentScripts\.register/);
  assert.doesNotMatch(ownerSource, /getAuthorizedCredentials|unlockState\.assertCurrent/);
  assert.doesNotMatch(chromeBackground, /getAuthorizedCredentials|unlockState|currentSecret|currentEmail/);
  assert.doesNotMatch(firefoxBackground, /getAuthorizedCredentials|unlockState|sessionSecret|sessionEmail/);
  assert.match(chromeBackground, /chromeShutdown\(\)/);
  assert.match(firefoxBackground, /firefoxShutdown\(\)/);
  assert.match(chromeBackground, /chromeIndicatorUnknown/);
  assert.match(firefoxBackground, /firefoxIndicatorUnknown/);
  assert.match(chromeBackground, /if \(chromeRegistrationUnknown \|\| chromeIndicatorUnknown\) return/);
  assert.match(firefoxBackground, /if \(firefoxRegistrationUnknown \|\| firefoxIndicatorUnknown\) return/);
  assert.match(chromeBackground, /throw chromeAdapterError\(\)/);
  assert.match(firefoxBackground, /throw firefoxAdapterError\(\)/);
  for (const source of [chromeBackground, firefoxBackground]) {
    assert.match(source, /reconcileIndicators/);
    assert.match(source, /KEYGRAIN_STALE_OPERATION/);
    assert.match(source, /keygrain-state-wake/);
  }
}
console.log('8 tests: 8 passed, 0 failed');
