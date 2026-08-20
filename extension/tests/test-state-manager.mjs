import { strict as assert } from 'node:assert';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '..', 'shared', 'unlock-state.js');

function makeContext() {
  const ctx = createContext({
    Date, Math, Number, String, Object, Array, Uint8Array, Error, TypeError, RangeError,
    Set, Map, Promise, globalThis: undefined,
  });
  runInContext('globalThis = this;', ctx);
  runInContext(readFileSync(sourcePath, 'utf8'), ctx);
  return ctx;
}

const ctx = makeContext();
const defaultSettings = {version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400};
const settings = defaultSettings;

function createManager({now = 1000, configured = settings} = {}) {
  runInContext(`globalThis.nowValue = ${now}; globalThis.manager = new KeygrainStateManager({clock: () => nowValue, settings: ${JSON.stringify(configured)}});`, ctx);
}
function setNow(value) { runInContext(`nowValue = ${value};`, ctx); }
function snapshot() { return JSON.parse(runInContext('JSON.stringify(manager.snapshot())', ctx)); }
function codeOf(fn) { try { fn(); return null; } catch (error) { return error?.code; } }
function unlock(expression = '[]') {
  runInContext(`manager.unlockFull({fullData:{secret:"full-secret",nested:{n:1}},records:${expression}})`, ctx);
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }

test('exports exactly the frozen constants, helpers, and manager', () => {
  const allowed = [
    'KEYGRAIN_STATE', 'KEYGRAIN_SETTINGS_KEY', 'KEYGRAIN_SETTINGS_VERSION', 'KEYGRAIN_FULL_MIN_SECONDS',
    'KEYGRAIN_FULL_DEFAULT_SECONDS', 'KEYGRAIN_FULL_NORMAL_MAX_SECONDS', 'KEYGRAIN_FULL_EXCEPTIONAL_MAX_SECONDS',
    'KEYGRAIN_METADATA_MIN_SECONDS', 'KEYGRAIN_METADATA_DEFAULT_SECONDS', 'KEYGRAIN_METADATA_MAX_SECONDS',
    'KEYGRAIN_FULL_WARNING_LEAD_SECONDS', 'KEYGRAIN_METADATA_WARNING_LEAD_SECONDS',
    'KEYGRAIN_COMPLETION_GRACE_SECONDS', 'KeygrainStateManager', 'normalizeSecuritySettings',
    'migrateSecuritySettings', 'confirmExceptionalFullLease', 'projectMetadataState',
  ];
  assert.deepEqual(JSON.parse(runInContext('JSON.stringify(Object.keys(globalThis).filter(key => key.startsWith("KEYGRAIN") || key.startsWith("Keygrain") || ["confirmExceptionalFullLease", "migrateSecuritySettings", "normalizeSecuritySettings", "projectMetadataState"].includes(key)).sort())', ctx)), allowed.sort());
  assert.deepEqual(JSON.parse(runInContext('JSON.stringify(KEYGRAIN_STATE)', ctx)), {LOCKED: 'locked', FULL: 'full', METADATA: 'metadata'});
  for (const forbidden of ['KGUnlockStateManager', 'KG_UNLOCK_STATES', 'sites_available', 'secrets_available', 'getFullData', 'getSecrets', 'setSecrets', 'setSecret', 'setEmail', 'getSecret', 'getEmail', 'clearEmail', 'autoLockMinutes']) {
    assert.equal(runInContext(`typeof globalThis[${JSON.stringify(forbidden)}]`, ctx), 'undefined', forbidden);
  }
});

test('settings migration supplies exact defaults and strict normalization', () => {
  assert.deepEqual(JSON.parse(runInContext('JSON.stringify(migrateSecuritySettings(undefined))', ctx)), {normalized: defaultSettings, needsWrite: true});
  assert.deepEqual(JSON.parse(runInContext('JSON.stringify(migrateSecuritySettings({version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}))', ctx)), {normalized: defaultSettings, needsWrite: false});
  assert.deepEqual(JSON.parse(runInContext('JSON.stringify(migrateSecuritySettings({version:1,fullLeaseSeconds:900,metadataTailSeconds:14400}))', ctx)), {normalized: {version: 1, fullLeaseSeconds: 900, metadataTailSeconds: 14400}, needsWrite: false});
  for (const value of [29, 901, 0, -1, 60.5, '60']) assert.equal(codeOf(() => runInContext(`normalizeSecuritySettings({version:1,fullLeaseSeconds:${JSON.stringify(value)},metadataTailSeconds:14400})`, ctx)), 'KEYGRAIN_SETTINGS_ERROR');
  for (const value of [-1, 86401, 1.5, '0']) assert.equal(codeOf(() => runInContext(`normalizeSecuritySettings({version:1,fullLeaseSeconds:60,metadataTailSeconds:${JSON.stringify(value)}})`, ctx)), 'KEYGRAIN_SETTINGS_ERROR');
  assert.equal(runInContext('normalizeSecuritySettings({version:1,fullLeaseSeconds:30,metadataTailSeconds:0}).fullLeaseSeconds', ctx), 30);
  assert.equal(runInContext('normalizeSecuritySettings({version:1,fullLeaseSeconds:900,metadataTailSeconds:86400}).metadataTailSeconds', ctx), 86400);
  assert.equal(runInContext('normalizeSecuritySettings({version:1,fullLeaseSeconds:1800,metadataTailSeconds:0}).fullLeaseSeconds', ctx), 1800);
  assert.equal(codeOf(() => runInContext('normalizeSecuritySettings({version:1,fullLeaseSeconds:60,metadataTailSeconds:0,autoLockMinutes:5})', ctx)), 'KEYGRAIN_SETTINGS_ERROR');
  assert.equal(codeOf(() => runInContext('normalizeSecuritySettings(Object.defineProperties({}, {version:{enumerable:true,get(){throw new Error("settings-secret")}},fullLeaseSeconds:{enumerable:true,value:60},metadataTailSeconds:{enumerable:true,value:14400}}))', ctx)), 'KEYGRAIN_SETTINGS_ERROR');
});

test('exceptional preference requires a fresh manager confirmation for each lease', () => {
  const exceptional = {version: 1, fullLeaseSeconds: 1800, metadataTailSeconds: 0};
  createManager({configured: exceptional});
  assert.equal(codeOf(() => unlock()), 'KEYGRAIN_CONFIRMATION_ERROR');
  runInContext('globalThis.confirmation = confirmExceptionalFullLease(manager);', ctx);
  runInContext('manager.unlockFull({fullData:{secret:"full-secret"},records:[],exceptionalConfirmation:confirmation})', ctx);
  assert.equal(codeOf(() => runInContext('manager.extendFull({exceptionalConfirmation:confirmation})', ctx)), 'KEYGRAIN_CONFIRMATION_ERROR');
  setNow(2000);
  assert.equal(codeOf(() => runInContext('manager.unlockFull({fullData:{secret:"new"},records:[],exceptionalConfirmation:confirmation})', ctx)), 'KEYGRAIN_CONFIRMATION_ERROR');
  runInContext('globalThis.confirmation2 = confirmExceptionalFullLease(manager); globalThis.beforeFailedExceptional = manager.snapshot();', ctx);
  assert.equal(codeOf(() => runInContext('manager.unlockFull({fullData:{secret:"new"},records:[{id:"bad",site:7}],exceptionalConfirmation:confirmation2})', ctx)), 'KEYGRAIN_METADATA_ERROR');
  assert.deepEqual(snapshot(), JSON.parse(runInContext('JSON.stringify(beforeFailedExceptional)', ctx)));
  assert.equal(codeOf(() => runInContext('manager.unlockFull({fullData:{secret:"new"},records:[{id:"bad"}],exceptionalConfirmation:confirmation2})', ctx)), null);
  assert.equal(snapshot().state, 'full');
});

test('applySettings changes only future leases and persists no runtime data', () => {
  createManager(); unlock(); const before = snapshot();
  runInContext('manager.applySettings({version:1,fullLeaseSeconds:30,metadataTailSeconds:0})', ctx);
  assert.equal(snapshot().fullExpiresAt, before.fullExpiresAt);
  setNow(61000); assert.equal(snapshot().state, 'metadata');
  runInContext('manager.lockEverything(); manager.unlockFull({fullData:{x:1},records:[]})', ctx);
  assert.equal(snapshot().fullExpiresAt, 91000);
  runInContext('manager.applySettings({version:1,fullLeaseSeconds:1800,metadataTailSeconds:0})', ctx);
  assert.equal(snapshot().fullExpiresAt, 91000);
});

test('metadata projection has exact keys, null semantics, and fresh copies', () => {
  createManager();
  unlock('[{id:"a",site:"example.com",name:"Work",email:"a@example.com",password:"p",frecency:1},{id:"b",email:"b@example.com",unknown:{x:1}},{unknown:"only"}]');
  setNow(61000);
  assert.deepEqual(JSON.parse(runInContext('JSON.stringify(manager.getMetadata())', ctx)), [
    {id: 'a', site: 'example.com', name: 'Work', email: 'a@example.com'},
    {id: 'b', site: null, name: null, email: 'b@example.com'},
    {id: null, site: null, name: null, email: null},
  ]);
  const returned = runInContext('manager.getMetadata()', ctx); returned[0].site = 'changed';
  assert.equal(runInContext('manager.getMetadata()[0].site', ctx), 'example.com');
  assert.equal(runInContext('Object.keys(manager.getMetadata()[0]).join(",")', ctx), 'id,site,name,email');
});

test('metadata and full-data validation failures are atomic and safe', () => {
  createManager(); unlock(); const before = snapshot();
  assert.equal(codeOf(() => unlock('[{id:"a",site:7,name:"Work",email:"a@example.com"}]')), 'KEYGRAIN_METADATA_ERROR');
  assert.deepEqual(snapshot(), before);
  assert.equal(codeOf(() => unlock('[Object.defineProperty({},"id",{enumerable:true,get(){throw new Error("metadata-secret")}})]')), 'KEYGRAIN_METADATA_ERROR');
  assert.deepEqual(snapshot(), before);
  assert.equal(codeOf(() => runInContext('manager.unlockFull({fullData:Object.defineProperty({},"secret",{enumerable:true,get(){throw new Error("full-secret")}}),records:[]})', ctx)), 'KEYGRAIN_STALE_OPERATION');
  assert.deepEqual(snapshot(), before);
});

test('unlock is full-only and metadata is hidden until exact full expiry', () => {
  createManager(); unlock('[{id:"a",site:"example.com",name:"Work",email:"a@example.com"}]');
  assert.equal(snapshot().state, 'full'); assert.equal(runInContext('manager.getMetadata()', ctx), null);
  setNow(60999); assert.equal(snapshot().state, 'full');
  setNow(61000); assert.equal(snapshot().state, 'metadata'); assert.equal(snapshot().hasFullData, false);
  assert.equal(runInContext('manager.getMetadata() !== null', ctx), true);
});

test('ordinary expiry anchors metadata to original full expiry after delayed wake', () => {
  createManager(); unlock('[{id:"a",site:"example.com"}]'); setNow(91000); runInContext('manager.expire()', ctx);
  assert.equal(snapshot().state, 'metadata'); assert.equal(snapshot().metadataExpiresAt, 14461000);
  setNow(14461000); assert.equal(snapshot().state, 'locked'); assert.equal(runInContext('manager.getMetadata()', ctx), null);
});

test('zero metadata tail transitions directly to locked', () => {
  createManager({configured: {version:1,fullLeaseSeconds:60,metadataTailSeconds:0}}); unlock('[{id:"a"}]'); setNow(61000);
  assert.equal(snapshot().state, 'locked'); assert.equal(runInContext('manager.getMetadata()', ctx), null); assert.equal(runInContext('manager.warningStatus().metadataDue', ctx), false);
});

test('warnings use exact boundaries and never renew leases', () => {
  createManager(); unlock(); setNow(30999); assert.equal(runInContext('manager.warningStatus().fullDue', ctx), false);
  const deadline = snapshot().fullExpiresAt; setNow(31000); assert.equal(runInContext('manager.warningStatus().fullDue', ctx), true); assert.equal(snapshot().fullExpiresAt, deadline);
  setNow(61000); assert.equal(snapshot().state, 'metadata'); setNow(13560999); assert.equal(runInContext('manager.warningStatus().metadataDue', ctx), false);
  setNow(13561000); assert.equal(runInContext('manager.warningStatus().metadataDue', ctx), true); assert.equal(runInContext('manager.warningStatus().fullRemainingMs', ctx), null);
  createManager({configured:{version:1,fullLeaseSeconds:60,metadataTailSeconds:600}}); unlock(); setNow(61000); assert.equal(snapshot().state, 'metadata'); assert.equal(runInContext('manager.warningStatus().metadataDue', ctx), true); assert.equal(runInContext('manager.warningStatus().metadataRemainingMs', ctx), 600000);
});

test('Full Extend reanchors the tail using newly applied future settings', () => {
  createManager(); unlock(); setNow(2000); runInContext('manager.applySettings({version:1,fullLeaseSeconds:60,metadataTailSeconds:0}); manager.extendFull()', ctx); setNow(62000);
  assert.equal(snapshot().state, 'locked');
  createManager({configured:{version:1,fullLeaseSeconds:60,metadataTailSeconds:0}}); unlock(); setNow(2000); runInContext('manager.applySettings({version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}); manager.extendFull()', ctx); setNow(62000);
  assert.equal(snapshot().state, 'metadata'); assert.equal(snapshot().metadataExpiresAt, 14462000);
});

test('explicit full and metadata extension operations are bounded and non-concurrent', () => {
  createManager(); unlock(); setNow(2000);
  runInContext('globalThis.oldHandle = manager.beginSensitiveOperation({capture: data => ({value:data.nested.n})})', ctx);
  runInContext('manager.extendFull()', ctx); assert.equal(snapshot().fullExpiresAt, 62000);
  assert.equal(codeOf(() => runInContext('manager.checkSensitiveOperation(oldHandle)', ctx)), 'KEYGRAIN_STALE_OPERATION');
  setNow(62000); assert.equal(snapshot().state, 'metadata'); const first = runInContext('manager.extendMetadata()', ctx); assert.equal(first.expiresAt, 14462000);
  setNow(14461999); assert.equal(snapshot().state, 'metadata'); setNow(14462000); assert.equal(snapshot().state, 'locked');
});

test('lockSensitive starts a click-anchored metadata tail and lockEverything clears all', () => {
  createManager(); unlock('[{id:"a"}]'); setNow(5000); const locked = JSON.parse(runInContext('JSON.stringify(manager.lockSensitive())', ctx));
  assert.equal(locked.state, 'metadata'); assert.equal(locked.metadataExpiresAt, 14405000); assert.equal(locked.hasFullData, false);
  runInContext('manager.lockEverything()', ctx); assert.equal(snapshot().state, 'locked'); assert.equal(runInContext('manager.getMetadata()', ctx), null);
  assert.equal(runInContext('manager.extendMetadata()', ctx), null);
});

test('forward jumps honor deadlines and rollback fails closed', () => {
  createManager(); unlock(); setNow(999999); assert.equal(snapshot().state, 'metadata');
  createManager(); unlock(); setNow(5000); runInContext('globalThis.rollbackHandle=manager.beginSensitiveOperation({capture:()=>({x:1})})', ctx); setNow(4000); assert.equal(codeOf(() => snapshot()), 'KEYGRAIN_CLOCK_ROLLBACK'); setNow(5000); assert.equal(runInContext('manager.snapshot().state', ctx), 'locked'); assert.equal(codeOf(() => runInContext('manager.checkSensitiveOperation(rollbackHandle)', ctx)), 'KEYGRAIN_STALE_OPERATION');
});

test('restart constructs locked with no restored runtime state', () => {
  createManager(); unlock(); runInContext('globalThis.restarted = new KeygrainStateManager({clock:()=>nowValue,settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}})', ctx);
  assert.equal(runInContext('restarted.snapshot().state', ctx), 'locked'); assert.equal(runInContext('restarted.getMetadata()', ctx), null);
});

test('snapshot contains authority metadata only', () => {
  createManager(); unlock(); const value = snapshot();
  assert.deepEqual(Object.keys(value).sort(), ['authorizationGeneration','fullExpiresAt','fullWarningAt','hasFullData','metadataAvailable','metadataExpiresAt','metadataWarningAt','state','stateGeneration'].sort());
  for (const forbidden of ['secret','password','records','metadata','operationInput','result','key']) assert.equal(Object.prototype.hasOwnProperty.call(value, forbidden), false, forbidden);
});

test('operation capture is synchronous, minimal, and defensive', () => {
  createManager(); unlock();
  runInContext('globalThis.captureCalls=0; globalThis.handle=manager.beginSensitiveOperation({capture:data=>{captureCalls++;data.nested.n=99;return {nested:{n:data.nested.n},bytes:new Uint8Array([1,2])}}})', ctx);
  assert.equal(runInContext('captureCalls', ctx), 1); assert.equal(runInContext('manager.getSensitiveOperationInput(handle).nested.n', ctx), 99);
  const copy = runInContext('manager.getSensitiveOperationInput(handle)', ctx); copy.nested.n = 7; copy.bytes[0] = 9;
  assert.equal(runInContext('manager.getSensitiveOperationInput(handle).nested.n', ctx), 99); assert.equal(runInContext('manager.getSensitiveOperationInput(handle).bytes[0]', ctx), 1);
  runInContext('globalThis.handle2=manager.beginSensitiveOperation({capture:data=>({n:data.nested.n})})', ctx);
  assert.equal(runInContext('manager.getSensitiveOperationInput(handle2).n', ctx), 1);
  runInContext('manager.completeSensitiveOperation(handle); manager.completeSensitiveOperation(handle2)', ctx);
  assert.equal(runInContext('manager.snapshot().hasFullData', ctx), true);
});

test('operation rejects thenables, class instances, and invalid capture without installing a handle', () => {
  createManager(); unlock();
  assert.equal(codeOf(() => runInContext('manager.beginSensitiveOperation({capture:()=>Promise.resolve({x:1})})', ctx)), 'KEYGRAIN_STALE_OPERATION');
  assert.equal(codeOf(() => runInContext('manager.beginSensitiveOperation({capture:()=>new Date()})', ctx)), 'KEYGRAIN_STALE_OPERATION');
  assert.equal(codeOf(() => runInContext('manager.beginSensitiveOperation({capture:()=>undefined})', ctx)), 'KEYGRAIN_STALE_OPERATION');
  runInContext('globalThis.validHandle=manager.beginSensitiveOperation({capture:()=>({x:1})}); globalThis.forgedHandle={...validHandle}; Object.defineProperty(forgedHandle,"operationId",{enumerable:true,get(){throw new Error("handle-secret")}})', ctx);
  assert.equal(codeOf(() => runInContext('manager.checkSensitiveOperation(forgedHandle)', ctx)), 'KEYGRAIN_STALE_OPERATION');
});

test('operation grace uses exact min(full expiry plus five seconds, accepted plus five seconds)', () => {
  createManager(); unlock(); setNow(58000);
  runInContext('globalThis.graceHandle=manager.beginSensitiveOperation({capture:()=>({value:"minimum"})})', ctx);
  assert.deepEqual(JSON.parse(runInContext('JSON.stringify(graceHandle)', ctx)), {operationId:1,authorizationGeneration:1,acceptedAt:58000,fullExpiresAt:61000,effectiveDeadline:63000});
  setNow(61000); assert.equal(snapshot().state, 'metadata'); assert.equal(runInContext('manager.checkSensitiveOperation(graceHandle)', ctx), true);
  setNow(62999); assert.equal(runInContext('manager.checkSensitiveOperation(graceHandle)', ctx), true); setNow(63000);
  assert.equal(codeOf(() => runInContext('manager.checkSensitiveOperation(graceHandle)', ctx)), 'KEYGRAIN_EXPIRED');
  assert.equal(codeOf(() => runInContext('manager.getSensitiveOperationInput(graceHandle)', ctx)), 'KEYGRAIN_STALE_OPERATION');
});

test('operations cannot begin at full expiry and expiry preserves authorization generation for grace', () => {
  createManager(); unlock(); setNow(58000); runInContext('globalThis.expiringHandle=manager.beginSensitiveOperation({capture:()=>({x:1})})', ctx); setNow(61000);
  assert.equal(codeOf(() => runInContext('manager.beginSensitiveOperation({capture:()=>({x:2})})', ctx)), 'KEYGRAIN_EXPIRED'); assert.equal(snapshot().authorizationGeneration, 1);
  assert.equal(runInContext('manager.checkSensitiveOperation(expiringHandle)', ctx), true); assert.equal(snapshot().stateGeneration, 2);
});

test('complete, fail, cancel, expiry sweep, and explicit revocation consume handles', () => {
  createManager(); unlock();
  runInContext('globalThis.h1=manager.beginSensitiveOperation({capture:()=>({x:1})});manager.completeSensitiveOperation(h1)', ctx); assert.equal(codeOf(() => runInContext('manager.checkSensitiveOperation(h1)', ctx)), 'KEYGRAIN_STALE_OPERATION');
  runInContext('globalThis.h2=manager.beginSensitiveOperation({capture:()=>({x:2})});manager.failSensitiveOperation(h2)', ctx); assert.equal(codeOf(() => runInContext('manager.checkSensitiveOperation(h2)', ctx)), 'KEYGRAIN_STALE_OPERATION');
  runInContext('globalThis.h3=manager.beginSensitiveOperation({capture:()=>({x:3})});manager.cancelSensitiveOperation(h3,"navigation")', ctx); assert.equal(codeOf(() => runInContext('manager.checkSensitiveOperation(h3)', ctx)), 'KEYGRAIN_STALE_OPERATION');
  runInContext('globalThis.hSweep=manager.beginSensitiveOperation({capture:()=>({x:4})})', ctx); setNow(6000); runInContext('manager.snapshot()', ctx); assert.equal(codeOf(() => runInContext('manager.checkSensitiveOperation(hSweep)', ctx)), 'KEYGRAIN_STALE_OPERATION');
  createManager(); unlock();
  runInContext('globalThis.h4=manager.beginSensitiveOperation({capture:()=>({x:4})});manager.lockSensitive()', ctx); assert.equal(codeOf(() => runInContext('manager.checkSensitiveOperation(h4)', ctx)), 'KEYGRAIN_STALE_OPERATION');
});

test('generation semantics distinguish state changes from authorization revocation', () => {
  createManager(); unlock(); const full = snapshot(); setNow(61000); const metadata = snapshot();
  assert.equal(metadata.stateGeneration, full.stateGeneration + 1); assert.equal(metadata.authorizationGeneration, full.authorizationGeneration);
  runInContext('manager.extendMetadata()', ctx); const extended = snapshot(); assert.equal(extended.stateGeneration, metadata.stateGeneration + 1); assert.equal(extended.authorizationGeneration, metadata.authorizationGeneration);
  runInContext('manager.lockEverything()', ctx); const locked = snapshot(); assert.equal(locked.authorizationGeneration, extended.authorizationGeneration + 1);
  runInContext('manager.unlockFull({fullData:{x:1},records:[]})', ctx); assert.equal(snapshot().authorizationGeneration, locked.authorizationGeneration + 1);
});

test('global invalidation accepts only frozen reasons and clears all state', () => {
  createManager(); unlock(); const before = snapshot(); runInContext('globalThis.invalidHandle=manager.beginSensitiveOperation({capture:()=>({x:1})})', ctx); assert.equal(codeOf(() => runInContext('manager.invalidate("unsupported")', ctx)), 'KEYGRAIN_INVALIDATION_ERROR'); assert.deepEqual(snapshot(), before);
  runInContext('manager.invalidate("account_switch")', ctx); assert.equal(codeOf(() => runInContext('manager.checkSensitiveOperation(invalidHandle)', ctx)), 'KEYGRAIN_STALE_OPERATION');
  for (const reason of ['authentication_failure','runtime_shutdown','clock_rollback','external_security_invalidation']) { createManager(); unlock(); runInContext(`manager.invalidate(${JSON.stringify(reason)})`, ctx); assert.equal(snapshot().state, 'locked'); assert.equal(runInContext('manager.getMetadata()', ctx), null); }
});

test('full payload replacement preserves the lease, installs exact metadata, and invalidates old operations', () => {
  createManager();
  runInContext('globalThis.replacementRecords=[{id:"old",site:"old.example",name:"Old",email:"old@example.com"}]; manager.unlockFull({fullData:{secret:"old-secret",email:"account@example.com",services:replacementRecords,wallets:[],walletAuditLog:[],tombstones:[],deletionReview:[]},records:replacementRecords})', ctx);
  setNow(2000);
  const before = snapshot();
  runInContext('globalThis.replacementHandle=manager.beginSensitiveOperation({capture:()=>({accepted:true})}); globalThis.replacementRecords=[{id:"new",site:"new.example",name:"New",email:"new@example.com"}]; globalThis.replacementFull={secret:"new-secret",email:"account@example.com",services:replacementRecords,wallets:[],walletAuditLog:[],tombstones:[],deletionReview:[]}; globalThis.replacementResult=manager.installFullPayloadReplacement({operationHandle:replacementHandle,fullData:replacementFull,records:replacementRecords})', ctx);
  const after = snapshot();
  assert.equal(after.state, 'full');
  assert.equal(after.fullExpiresAt, before.fullExpiresAt);
  assert.equal(after.stateGeneration, before.stateGeneration + 1);
  assert.equal(after.authorizationGeneration, before.authorizationGeneration + 1);
  setNow(61000);
  assert.equal(snapshot().state, 'metadata');
  assert.equal(snapshot().metadataExpiresAt, 14461000);
  assert.deepEqual(JSON.parse(runInContext('JSON.stringify(manager.getMetadata())', ctx)), [{id:'new',site:'new.example',name:'New',email:'new@example.com'}]);
  assert.equal(codeOf(() => runInContext('manager.checkSensitiveOperation(replacementHandle)', ctx)), 'KEYGRAIN_STALE_OPERATION');
});

test('replacement validation rejects malformed candidates and forged handles without mutation', () => {
  createManager();
  runInContext('manager.unlockFull({fullData:{secret:"old-secret",email:"account@example.com",services:[],wallets:[],walletAuditLog:[],tombstones:[],deletionReview:[]},records:[]}); globalThis.replacementHandle=manager.beginSensitiveOperation({capture:()=>({accepted:true})})', ctx);
  const before = snapshot();
  assert.equal(codeOf(() => runInContext('manager.installFullPayloadReplacement({operationHandle:replacementHandle,fullData:{secret:"bad",email:"account@example.com",services:[],wallets:[],walletAuditLog:[],tombstones:[],deletionReview:[]},records:[{id:"mismatch"}]})', ctx)), 'KEYGRAIN_STALE_OPERATION');
  assert.deepEqual(snapshot(), before);
  assert.equal(runInContext('manager.checkSensitiveOperation(replacementHandle)', ctx), true);
  assert.equal(codeOf(() => runInContext('manager.installFullPayloadReplacement({operationHandle:{...replacementHandle,operationId:999},fullData:{secret:"new",email:"account@example.com",services:[],wallets:[],walletAuditLog:[],tombstones:[],deletionReview:[]},records:[]})', ctx)), 'KEYGRAIN_STALE_OPERATION');
  assert.deepEqual(snapshot(), before);
  setNow(61000);
  assert.equal(codeOf(() => runInContext('globalThis.expiryRecords=[]; globalThis.expiryFull={secret:"new",email:"account@example.com",services:expiryRecords,wallets:[],walletAuditLog:[],tombstones:[],deletionReview:[]}; manager.installFullPayloadReplacement({operationHandle:replacementHandle,fullData:expiryFull,records:expiryRecords})', ctx)), 'KEYGRAIN_EXPIRED');
  assert.equal(snapshot().state, 'metadata');
});

test('restoreFull and restoreMetadata deterministically restore exact remaining lease deadlines', () => {
  createManager();
  setNow(1000);
  const snapFull = JSON.parse(runInContext(`JSON.stringify(manager.restoreFull({
    fullData: {secret: "master", email: "user@example.com", services: [{id: "s1", name: "Github", site: "github.com", login: "user1"}], wallets: [], walletAuditLog: [], tombstones: [], deletionReview: []},
    records: [{id: "s1", name: "Github", site: "github.com", login: "user1"}],
    fullExpiresAt: 61000,
    metadataTailAnchor: 90000,
    activeMetadataTailSeconds: 29
  }))`, ctx));
  assert.equal(snapFull.state, 'full');
  assert.equal(snapFull.fullExpiresAt, 61000);
  assert.equal(snapFull.metadataExpiresAt, null);

  createManager();
  const snapMeta = JSON.parse(runInContext(`JSON.stringify(manager.restoreMetadata({
    metadata: [{id: "s1", name: "Github", site: "github.com", login: "user1"}],
    metadataExpiresAt: 90000,
    metadataTailAnchor: 90000,
    activeMetadataTailSeconds: 29
  }))`, ctx));
  assert.equal(snapMeta.state, 'metadata');
  assert.equal(snapMeta.fullExpiresAt, null);
  assert.equal(snapMeta.metadataExpiresAt, 90000);
});

test('explicit manager operations expose no generic full-data or credential authority', () => {
  createManager();
  const methods = JSON.parse(runInContext('JSON.stringify(Object.getOwnPropertyNames(KeygrainStateManager.prototype).filter(name=>name!=="constructor"&&!name.startsWith("_")).sort())', ctx));
  assert.deepEqual(methods, ['applySettings','beginSensitiveOperation','cancelSensitiveOperation','checkSensitiveOperation','completeSensitiveOperation','expire','extendFull','extendMetadata','failSensitiveOperation','getMetadata','getSensitiveOperationInput','installFullPayloadReplacement','invalidate','lockEverything','lockSensitive','restoreFull','restoreMetadata','snapshot','unlockFull','warningStatus'].sort());
  for (const method of ['getFullData','getSecrets','getRecords','setSecrets','setSecret','setEmail','getSecret','getEmail']) assert.equal(runInContext(`typeof manager[${JSON.stringify(method)}]`, ctx), 'undefined', method);
});

console.log(`${passed} tests: ${passed} passed, 0 failed`);
