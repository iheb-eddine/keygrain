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
}// Generation tokens reject stale work and remain monotonic.
{
  const ctx = makeContext(async () => new Uint8Array(32));
  runInContext('globalThis.token = new KGUnlockGeneration()', ctx);
  assert.equal(runInContext('token.value', ctx), 0);
  runInContext('globalThis.captured = token.capture()', ctx);
  assert.equal(runInContext('token.isCurrent(captured)', ctx), true);
  assert.equal(runInContext('token.invalidate()', ctx), 1);
  assert.equal(runInContext('token.isCurrent(captured)', ctx), false);
  assert.equal(runInContext('token.isCurrent(token.capture())', ctx), true);
  assert.throws(() => runInContext('token.assertCurrent(captured)', ctx), /stale unlock operation/);
}

{
  const chromeBackground = readFileSync(resolve(__dirname, '..', 'chrome', 'background.js'), 'utf8');
  const firefoxBackground = readFileSync(resolve(__dirname, '..', 'firefox', 'background.js'), 'utf8');
  const popup = readFileSync(resolve(shared, 'popup.js'), 'utf8');
  for (const source of [chromeBackground, firefoxBackground]) {
    const match = source.match(/if \(msg\.action === "heartbeat"\) \{([\s\S]*?)\n\s*\}/);
    assert.ok(match, 'heartbeat handler missing');
    assert.doesNotMatch(match[1], /resetAutoLock/);
    assert.match(source, /msg\.action === "extendSensitive"/);
  }
  assert.doesNotMatch(chromeBackground, /chrome\.storage\.session/);
  assert.doesNotMatch(popup, /document\.addEventListener\("click", \(\) => sendMsg\(\{action: "heartbeat"\}\)\)/);
  assert.doesNotMatch(popup, /document\.addEventListener\("keydown", \(\) => sendMsg\(\{action: "heartbeat"\}\)\)/);
  assert.match(popup, /sendMsg\(\{action: "extendSensitive"\}\)/);
}

{
  const chromeBackground = readFileSync(resolve(__dirname, '..', 'chrome', 'background.js'), 'utf8');
  const firefoxBackground = readFileSync(resolve(__dirname, '..', 'firefox', 'background.js'), 'utf8');
  for (const source of [chromeBackground, firefoxBackground]) {
    const start = source.indexOf('async function updateBadge');
    const end = source.indexOf('\n}\n\n', start);
    assert.ok(start >= 0 && end > start, 'updateBadge body missing');
    const body = source.slice(start, end);
    assert.match(body, /const auth = getAuthorizedCredentials\(\)/);
    assert.match(body, /generation/);
    assert.match(body, /const assertGeneration = \(\) => unlockState\.assertCurrent\(generation\)/);
    assert.ok((body.match(/assertGeneration\(\)/g) || []).length >= 6, 'badge path lacks await-boundary generation checks');
    assert.match(body, /try \{ assertGeneration\(\); \} catch \{ return; \}/);
  }
}
console.log('8 tests: 8 passed, 0 failed');
