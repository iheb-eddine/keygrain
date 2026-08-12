import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = resolve(__dirname, '..', 'shared');
const ctx = createContext({
  Date,
  Math,
  Number,
  String,
  Object,
  Array,
  Uint8Array,
  Error,
  TypeError,
  RangeError,
  Map,
  Set,
  Promise,
  globalThis: undefined,
});
runInContext('globalThis = this;', ctx);
runInContext(readFileSync(resolve(shared, 'unlock-state.js'), 'utf8'), ctx);
runInContext('globalThis.nowValue = 1000; globalThis.manager = new KGUnlockStateManager({clock: () => nowValue});', ctx);

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

await test('initial state is Locked with no capabilities', () => {
  assert.equal(runInContext('manager.state', ctx), 'locked');
  assert.equal(runInContext('manager.snapshot().hasMetadata', ctx), false);
  assert.equal(runInContext('manager.snapshot().hasSecrets', ctx), false);
});

await test('metadata is copied to the exact allowlist', () => {
  runInContext('manager.setMetadata([{id:"a",site:"example.com",name:"Work",email:"a@example.com",frecency:2,updated_at:3,hasTotp:true,secret:"x"}], 60000)', ctx);
  const metadata = JSON.parse(runInContext('JSON.stringify(manager.getMetadata())', ctx));
  assert.deepEqual(metadata, [{id: 'a', site: 'example.com', name: 'Work', email: 'a@example.com', frecency: 2, updated_at: 3, hasTotp: true}]);
  assert.equal(runInContext('manager.state', ctx), 'sites_available');
});

await test('secrets transition to Secrets available and invalidate general generation', () => {
  runInContext('globalThis.beforeGeneration = manager.generation; manager.setSecrets({secret:"s", email:"a@example.com"}, 5000);', ctx);
  assert.equal(runInContext('manager.state', ctx), 'secrets_available');
  assert.equal(runInContext('manager.generation > beforeGeneration', ctx), true);
});

await test('TOTP cache returns only the selected current counter and binding', () => {
  runInContext('manager.setTotpContinuation({serviceId:"a",tabId:7,origin:"https://example.com",period:30,createdAt:1000,expiresAt:121000,entries:[{counter:0,code:"111111",validFrom:0,validUntil:30000},{counter:1,code:"222222",validFrom:30000,validUntil:60000},{counter:2,code:"333333",validFrom:60000,validUntil:90000},{counter:3,code:"444444",validFrom:90000,validUntil:120000}]})', ctx);
  assert.equal(runInContext('manager.getTotpContinuation({serviceId:"a",tabId:7,origin:"https://example.com"}).code', ctx), '111111');
  assert.equal(runInContext('manager.getTotpContinuation({serviceId:"b",tabId:7,origin:"https://example.com"})', ctx), null);
  assert.equal(runInContext('manager.getTotpContinuation({serviceId:"a",tabId:8,origin:"https://example.com"})', ctx), null);
  assert.equal(runInContext('manager.getTotpContinuation({serviceId:"a",tabId:7,origin:"https://other.example"})', ctx), null);
});

await test('automatic sensitive expiry clears secrets but retains TOTP continuation', () => {
  runInContext('nowValue = 6000; manager.expire();', ctx);
  assert.equal(runInContext('manager.hasSecrets', ctx), false);
  assert.equal(runInContext('manager.hasTotpContinuation', ctx), true);
  assert.equal(runInContext('manager.state', ctx), 'sites_available');
});

await test('TOTP exact-counter check rejects future entries', () => {
  runInContext('manager.setTotpContinuation({serviceId:"a",period:30,createdAt:1000,expiresAt:121000,entries:[{counter:1,code:"222222",validFrom:30000,validUntil:60000}]})', ctx);
  assert.equal(runInContext('manager.getTotpContinuation({serviceId:"a"})', ctx), null);
});

await test('TOTP expiry clears the continuation independently', () => {
  runInContext('nowValue = 121000; manager.expire();', ctx);
  assert.equal(runInContext('manager.hasTotpContinuation', ctx), false);
});

await test('explicit Lock Secrets clears secrets and TOTP but retains metadata', () => {
  runInContext('manager.setMetadata([{id:"a",site:"example.com",name:"Work",email:"a@example.com",hasTotp:true}], 999999); manager.setSecrets({secret:"s"}, 999999); manager.setTotpContinuation({serviceId:"a",period:30,createdAt:1000,expiresAt:121000,entries:[{counter:0,code:"111111",validFrom:0,validUntil:30000}]}); manager.lockSecrets();', ctx);
  assert.equal(runInContext('manager.state', ctx), 'sites_available');
  assert.equal(runInContext('manager.hasTotpContinuation', ctx), false);
  assert.equal(runInContext('manager.hasMetadata', ctx), true);
});

await test('Lock Everything clears metadata as well', () => {
  runInContext('manager.setEmail("a@example.com"); manager.lockEverything()', ctx);
  assert.equal(runInContext('manager.state', ctx), 'locked');
  assert.equal(runInContext('manager.hasMetadata', ctx), false);
  assert.equal(runInContext('manager.hasSecrets', ctx), false);
  assert.equal(runInContext('manager.email', ctx), null);
});

await test('stale general generations are rejected', () => {
  runInContext('globalThis.g = manager.capture(); manager.invalidate("lock");', ctx);
  assert.equal(runInContext('manager.isCurrent(g)', ctx), false);
});

await test('automatic sensitive expiry hides account email when metadata is absent', () => {
  runInContext('globalThis.expiryNow = 1000; globalThis.expiryManager = new KGUnlockStateManager({clock: () => expiryNow}); expiryManager.setSecrets({secret:"s"}, 2000); expiryManager.setEmail("a@example.com");', ctx);
  assert.equal(runInContext('expiryManager.email', ctx), 'a@example.com');
  runInContext('expiryNow = 2000; expiryManager.expire();', ctx);
  assert.equal(runInContext('expiryManager.email', ctx), null);
});


await test('lease settings use approved defaults and reject invalid sensitive retention', () => {
  const defaults = runInContext('kgNormalizeSecuritySettings()', ctx);
  assert.equal(defaults.metadata.mode, 'duration');
  assert.equal(defaults.metadata.durationMinutes, 30);
  assert.equal(defaults.sensitive.mode, 'ask_every_time');
  assert.equal(defaults.sensitive.durationMinutes, null);
  assert.equal(defaults.totpContinuationEnabled, true);
  assert.throws(() => runInContext('kgNormalizeSecuritySettings({sensitive:{mode:"duration",durationMinutes:31}})', ctx), /maximum/);
  assert.throws(() => runInContext('kgNormalizeSecuritySettings({sensitive:{mode:"duration",durationMinutes:0}})', ctx), /positive/);
  assert.equal(runInContext('kgNormalizeSecuritySettings({metadata:{mode:"duration",durationMinutes:1}}).metadata.durationMinutes', ctx), 1);
});

await test('lease primitive creates fixed deadlines and represents Ask Every Time without an expiry', () => {
  const lease = runInContext('kgCreateSensitiveLease(1000, {mode:"duration",durationMinutes:5})', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(lease)), {mode: 'duration', durationMinutes: 5, startedAt: 1000, expiresAt: 301000});
  const ask = runInContext('kgCreateSensitiveLease(1000, {mode:"ask_every_time"})', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ask)), {mode: 'ask_every_time', startedAt: 1000, expiresAt: null});
  assert.equal(runInContext('typeof kgCreateLease', ctx), 'undefined');
  assert.throws(() => runInContext('kgCreateSensitiveLease(1000, {mode:"duration",durationMinutes:0})', ctx), /positive/);
});

await test('manager owns independent fixed leases and does not renew on reads', () => {
  runInContext('globalThis.leaseNow = 1000; globalThis.leaseManager = new KGUnlockStateManager({clock: () => leaseNow}); leaseManager.setMetadata([{id:"a",site:"example.com"}], {mode:"duration",durationMinutes:30,startedAt:1000,expiresAt:1801000}); leaseManager.setSecrets({secret:"s"}, kgCreateSensitiveLease(1000,{mode:"duration",durationMinutes:5}));', ctx);
  assert.equal(runInContext('leaseManager.metadataLease.expiresAt', ctx), 1801000);
  assert.equal(runInContext('leaseManager.sensitiveLease.expiresAt', ctx), 301000);
  runInContext('leaseNow = 100000; leaseManager.getMetadata(); leaseManager.getSecrets();', ctx);
  assert.equal(runInContext('leaseManager.metadataLease.expiresAt', ctx), 1801000);
  assert.equal(runInContext('leaseManager.sensitiveLease.expiresAt', ctx), 301000);
  runInContext('leaseNow = 301000; leaseManager.expire();', ctx);
  assert.equal(runInContext('leaseManager.hasSecrets', ctx), false);
  assert.equal(runInContext('leaseManager.hasMetadata', ctx), true);
});

await test('only explicit lease renewal changes the current deadline and invalidates old work', () => {
  runInContext('globalThis.renewNow = 1000; globalThis.renewalManager = new KGUnlockStateManager({clock: () => renewNow}); renewalManager.setSecrets({secret:"s"}, kgCreateSensitiveLease(1000,{mode:"duration",durationMinutes:5})); globalThis.oldLeaseGeneration = renewalManager.capture(); renewNow = 2000; globalThis.renewedLease = renewalManager.renewSensitiveLease({mode:"duration",durationMinutes:2});', ctx);
  assert.equal(runInContext('renewedLease.expiresAt', ctx), 122000);
  assert.equal(runInContext('renewalManager.sensitiveLease.expiresAt', ctx), 122000);
  assert.equal(runInContext('renewalManager.isCurrent(oldLeaseGeneration)', ctx), false);
  runInContext('renewNow = 122000; renewalManager.expire();', ctx);
  assert.equal(runInContext('renewalManager.hasSecrets', ctx), false);
  assert.equal(runInContext('renewalManager.renewSensitiveLease({mode:"duration",durationMinutes:2})', ctx), null);
});

await test('lease objects are validated and never expose secret payloads', () => {
  assert.throws(() => runInContext('leaseManager.setSecrets({secret:"s"}, {mode:"duration",durationMinutes:31,startedAt:1000,expiresAt:1861000})', ctx), /invalid fixed lease/);
  assert.throws(() => runInContext('leaseManager.setSecrets({secret:"s"}, {mode:"duration",durationMinutes:5,startedAt:1000,expiresAt:999999})', ctx), /invalid fixed lease/);
  const snapshot = runInContext('leaseManager.snapshot()', ctx);
  assert.equal('secret' in snapshot, false);
});

await test('legacy missing sensitive leases remain safe until browser integration replaces them', () => {
  runInContext('globalThis.legacyManager = new KGUnlockStateManager({clock: () => 1000}); legacyManager.setSecrets({secret:"s"}, null);', ctx);
  assert.equal(runInContext('legacyManager.state', ctx), 'secrets_available');
  assert.equal(runInContext('legacyManager.getSecrets().secret', ctx), 's');
  assert.equal(runInContext('legacyManager.snapshot().sensitiveLease', ctx), null);
});

await test('independent metadata lease expiry is preserved while sensitive state remains', () => {
  runInContext('globalThis.independentNow = 1000; globalThis.independentManager = new KGUnlockStateManager({clock: () => independentNow}); independentManager.setMetadata([{id:"a",site:"example.com"}], {mode:"duration",durationMinutes:1,startedAt:1000,expiresAt:61000}); independentManager.setSecrets({secret:"s"}, kgCreateSensitiveLease(1000,{mode:"duration",durationMinutes:5}));', ctx);
  runInContext('independentNow = 61000; independentManager.expire();', ctx);
  assert.equal(runInContext('independentManager.hasMetadata', ctx), false);
  assert.equal(runInContext('independentManager.hasSecrets', ctx), true);
});

console.log(`${passed} tests: ${passed} passed, 0 failed`);
