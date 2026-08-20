import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '..', 'shared', 'worker-update-version.js');
const ctx = createContext({Math, Number, Object, Array, Error, Reflect, Set, globalThis: undefined});
runInContext('globalThis = this;', ctx);
runInContext(readFileSync(sourcePath, 'utf8'), ctx);

let now = 1000;
function helper() {
  return runInContext('KeygrainWorkerUpdateVersion.createWorkerUpdateVersion({nowMs: () => nowValue})', ctx);
}
function setNow(value) { ctx.nowValue = value; }
function codeOf(fn) {
  try { fn(); return null; } catch (error) { return error?.code; }
}
function next(instance, values) {
  return instance.next({targetVersion: values[0], localKnownVersion: values[1], remoteKnownVersion: values[2]});
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }

setNow(now);
test('exports only the worker update-version constructor', () => {
  assert.deepEqual(Object.keys(runInContext('KeygrainWorkerUpdateVersion', ctx)).sort(), ['createWorkerUpdateVersion']);
  assert.equal(typeof runInContext('KeygrainWorkerUpdateVersion.createWorkerUpdateVersion', ctx), 'function');
});

test('assigns clock-ahead and floor-plus-one versions', () => {
  const value = helper();
  setNow(5000);
  assert.equal(next(value, [0, 0, 0]), 5000);
  assert.equal(next(value, [5000, 6000, 0]), 6001);
  setNow(7000);
  assert.equal(next(value, [0, 0, 9000]), 9001);
});

test('repeated and backward clock readings remain strictly monotonic', () => {
  const value = helper();
  setNow(1000); assert.equal(next(value, [0, 0, 0]), 1000);
  setNow(1000); assert.equal(next(value, [0, 0, 0]), 1001);
  setNow(999); assert.equal(next(value, [0, 0, 0]), 1002);
  setNow(0); assert.equal(next(value, [3000, 0, 0]), 3001);
});

test('accepts fractional injected clock readings only by flooring them', () => {
  const value = helper();
  setNow(12.75);
  assert.equal(next(value, [0, 0, 0]), 12);
  setNow(12.1);
  assert.equal(next(value, [0, 0, 0]), 13);
});

test('rejects invalid clock and floor values without advancing state', () => {
  const value = helper();
  setNow(100);
  assert.equal(next(value, [0, 0, 0]), 100);
  for (const reading of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1, '101', true]) {
    setNow(reading);
    assert.equal(codeOf(() => next(value, [0, 0, 0])), 'KEYGRAIN_OPERATION_ERROR');
  }
  setNow(100);
  assert.equal(next(value, [0, 0, 0]), 101);
  for (const floor of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', false, null]) {
    assert.equal(codeOf(() => next(value, [floor, 0, 0])), 'KEYGRAIN_OPERATION_ERROR');
  }
  assert.equal(codeOf(() => next(value, [undefined, undefined, 0])), 'KEYGRAIN_OPERATION_ERROR');
  assert.equal(codeOf(() => next(value, [undefined, 0, undefined])), 'KEYGRAIN_OPERATION_ERROR');
  setNow(100);
  assert.equal(next(value, [0, 0, 0]), 102);
});

test('rejects malformed envelopes, reordered keys, accessors, and prototypes', () => {
  const value = helper();
  assert.equal(codeOf(() => value.next({localKnownVersion: 0, targetVersion: 0, remoteKnownVersion: 0})), 'KEYGRAIN_OPERATION_ERROR');
  assert.equal(codeOf(() => value.next({targetVersion: 0, localKnownVersion: 0, remoteKnownVersion: 0, extra: 0})), 'KEYGRAIN_OPERATION_ERROR');
  const inherited = Object.create({remoteKnownVersion: 0});
  inherited.targetVersion = 0; inherited.localKnownVersion = 0;
  assert.equal(codeOf(() => value.next(inherited)), 'KEYGRAIN_OPERATION_ERROR');
  const accessor = {targetVersion: 0, localKnownVersion: 0, remoteKnownVersion: 0};
  Object.defineProperty(accessor, 'remoteKnownVersion', {enumerable: true, get() { throw new Error('floor-secret'); }});
  assert.equal(codeOf(() => value.next(accessor)), 'KEYGRAIN_OPERATION_ERROR');
});

test('fails before assignment at safe-integer overflow and can still issue prior value', () => {
  const value = helper();
  setNow(1);
  assert.equal(codeOf(() => next(value, [Number.MAX_SAFE_INTEGER, 0, 0])), 'KEYGRAIN_OPERATION_ERROR');
  setNow(1);
  assert.equal(next(value, [Number.MAX_SAFE_INTEGER - 1, 0, 0]), Number.MAX_SAFE_INTEGER);
  setNow(1);
  assert.equal(codeOf(() => next(value, [0, 0, 0])), 'KEYGRAIN_OPERATION_ERROR');
});

test('a failed clock read does not mutate the last-issued floor', () => {
  const value = helper();
  setNow(50); assert.equal(next(value, [0, 0, 0]), 50);
  setNow(-1); assert.equal(codeOf(() => next(value, [0, 0, 0])), 'KEYGRAIN_OPERATION_ERROR');
  setNow(50); assert.equal(next(value, [0, 0, 0]), 51);
});

console.log(`${passed} tests: ${passed} passed, 0 failed`);
