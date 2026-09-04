import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, '..');
const source = readFileSync(resolve(extensionRoot, 'shared', 'diagnostics.js'), 'utf8');
const popupHtml = readFileSync(resolve(extensionRoot, 'shared', 'popup.html'), 'utf8');
const popupSource = readFileSync(resolve(extensionRoot, 'shared', 'popup.js'), 'utf8');
const firefoxManifest = readFileSync(resolve(extensionRoot, 'firefox', 'manifest.json'), 'utf8');
const chromeBackground = readFileSync(resolve(extensionRoot, 'chrome', 'background.js'), 'utf8');
const firefoxBackground = readFileSync(resolve(extensionRoot, 'firefox', 'background.js'), 'utf8');

const SAFE_CODES = [
  'KEYGRAIN_AUTH_PROTOCOL_ERROR', 'KEYGRAIN_CONTEXT_ERROR', 'KEYGRAIN_UNLOCK_FAILED',
  'KEYGRAIN_OPERATION_ERROR', 'KEYGRAIN_CONSUMER_MIGRATION_REQUIRED',
  'KEYGRAIN_SETTINGS_STORAGE_ERROR', 'KEYGRAIN_SETTINGS_ERROR', 'KEYGRAIN_CONFIRMATION_ERROR',
  'KEYGRAIN_METADATA_ERROR', 'KEYGRAIN_CLOCK_ROLLBACK', 'KEYGRAIN_EXPIRED',
  'KEYGRAIN_STALE_OPERATION', 'KEYGRAIN_INVALIDATION_ERROR',
  'KEYGRAIN_DERIVATION_ERROR', 'KEYGRAIN_FILL_DELIVERY_ERROR',
  'KEYGRAIN_TOTP_ERROR', 'KEYGRAIN_TOTP_DELIVERY_ERROR', 'KEYGRAIN_SSH_ERROR', 'KEYGRAIN_WALLET_ERROR',
  'ACCOUNT_NOT_FOUND', 'ACCOUNT_EXISTS',
];

function makeDiagnostics(manifestName, {manifestThrows = false, debugThrows = false} = {}) {
  const calls = [];
  const debug = (...args) => calls.push(args);
  const consoleApi = debugThrows ? {} : {debug};
  if (debugThrows) Object.defineProperty(consoleApi, 'debug', {get() { throw new Error('console secret@example.com'); }});
  const runtime = {
    getManifest: manifestThrows
      ? () => { throw new Error('manifest https://private.test lookup-123'); }
      : () => ({name: manifestName}),
  };
  const context = createContext({
    Array, Object, Set, String, console: consoleApi,
    chrome: {runtime},
  });
  runInContext('globalThis = this;', context);
  runInContext(source, context);
  return {diagnostics: context.KeygrainDiagnostics || context.KeygrainDiagnostics, calls};
}

const dev = makeDiagnostics('Keygrain DEV');
assert.equal(dev.diagnostics.isEnabled(), true);
assert.deepEqual(JSON.parse(JSON.stringify(dev.diagnostics.CATEGORIES)), [
  'popup_message_transport_failure',
  'background_startup_rejection',
  'worker_response_error',
]);
assert.deepEqual(JSON.parse(JSON.stringify(dev.diagnostics.SAFE_CODES)), SAFE_CODES);
assert.equal(dev.diagnostics.record('popup_message_transport_failure'), true);
assert.equal(dev.diagnostics.record('background_startup_rejection'), true);
assert.equal(dev.diagnostics.recordWorkerResponse({ok: false, code: 'KEYGRAIN_UNLOCK_FAILED', message: 'raw exception'}), true);
assert.equal(dev.diagnostics.mapWorkerResponseCode({code: 'KEYGRAIN_CONTEXT_ERROR'}), 'KEYGRAIN_CONTEXT_ERROR');
assert.equal(dev.diagnostics.mapWorkerResponseCode({code: 'KEYGRAIN_DERIVATION_ERROR'}), 'KEYGRAIN_DERIVATION_ERROR');
assert.equal(dev.diagnostics.mapWorkerResponseCode({code: 'KEYGRAIN_FILL_DELIVERY_ERROR'}), 'KEYGRAIN_FILL_DELIVERY_ERROR');
assert.equal(dev.diagnostics.mapWorkerResponseCode({code: 'KEYGRAIN_TOTP_ERROR'}), 'KEYGRAIN_TOTP_ERROR');
assert.equal(dev.diagnostics.mapWorkerResponseCode({code: 'KEYGRAIN_TOTP_DELIVERY_ERROR'}), 'KEYGRAIN_TOTP_DELIVERY_ERROR');
assert.equal(dev.diagnostics.mapWorkerResponseCode({code: 'KEYGRAIN_SSH_ERROR'}), 'KEYGRAIN_SSH_ERROR');
assert.equal(dev.diagnostics.mapWorkerResponseCode({code: 'KEYGRAIN_WALLET_ERROR'}), 'KEYGRAIN_WALLET_ERROR');
assert.equal(dev.diagnostics.mapWorkerResponseCode({code: 'not-safe', message: 'raw exception'}), 'UNKNOWN');
assert.equal(dev.diagnostics.mapWorkerResponseCode({code: 'https://example.test/?lookup_id=lookup-123'}), 'UNKNOWN');
assert.equal(dev.diagnostics.mapWorkerResponseCode(null), 'UNKNOWN');
assert.equal(dev.diagnostics.mapWorkerResponseCode([]), 'UNKNOWN');
const throwingResponse = {};
Object.defineProperty(throwingResponse, 'code', {get() { throw new Error('secret@example.com master-secret Authorization Bearer token https://private.test lookup-123 payload=secret timing=42'); }});
assert.equal(dev.diagnostics.mapWorkerResponseCode(throwingResponse), 'UNKNOWN');
assert.equal(dev.diagnostics.record('unknown_category'), false);
assert.deepEqual(dev.calls, [
  ['[Keygrain diagnostic]', 'popup_message_transport_failure'],
  ['[Keygrain diagnostic]', 'background_startup_rejection'],
  ['[Keygrain diagnostic]', 'worker_response_error', 'KEYGRAIN_UNLOCK_FAILED'],
]);
const serializedCalls = JSON.stringify(dev.calls);
for (const sensitive of [
  'raw exception', 'secret@example.com', 'master-secret', 'Authorization',
  'https://private.test', 'lookup-123', 'payload=secret', 'timing=42',
]) assert.equal(serializedCalls.includes(sensitive), false, `diagnostic leaked ${sensitive}`);

const production = makeDiagnostics('Keygrain');
assert.equal(production.diagnostics.isEnabled(), false);
assert.equal(production.diagnostics.record('popup_message_transport_failure'), false);
assert.equal(production.diagnostics.record('background_startup_rejection'), false);
assert.equal(production.diagnostics.recordWorkerResponse({code: 'KEYGRAIN_UNLOCK_FAILED'}), false);
assert.deepEqual(production.calls, [], 'production must not call the diagnostic sink');

const throwingManifest = makeDiagnostics('Keygrain DEV', {manifestThrows: true});
assert.equal(throwingManifest.diagnostics.isEnabled(), false);
assert.equal(throwingManifest.diagnostics.record('background_startup_rejection'), false);
assert.deepEqual(throwingManifest.calls, []);
const throwingConsole = makeDiagnostics('Keygrain DEV', {debugThrows: true});
assert.equal(throwingConsole.diagnostics.record('popup_message_transport_failure'), false);
assert.deepEqual(throwingConsole.calls, []);

assert.match(popupHtml, /<script src="diagnostics\.js"><\/script>/);
assert.match(firefoxManifest, /"diagnostics\.js"/);
assert.match(chromeBackground, /importScripts\([^\n]*"diagnostics\.js"/);
assert.match(firefoxBackground, /browser\.runtime\.onMessage/);
assert.doesNotMatch(firefoxBackground, /typeof chrome === "undefined"|browser\.browserAction|browser\.tabs\.executeScript|browser\.contentScripts\.register/);

console.log('  ✓ Keygrain diagnostic categories are fixed, safe, and DEV-gated');

assert.match(popupSource, /if \(!response\?\.ok\) \{\s*globalThis\.KeygrainDiagnostics\?\.recordWorkerResponse\(response\);/);
assert.match(popupSource, /catch \(_\) \{\s*globalThis\.KeygrainDiagnostics\?\.record\("popup_message_transport_failure"\);/);
assert.match(popupSource, /showStatus\(statusEl, response\?\.message \|\| "Unlock failed; try again\."/);
for (const background of [chromeBackground, firefoxBackground]) {
  assert.match(background, /const startupPromise = \(async \(\) =>/);
  assert.doesNotMatch(background, /console\.(?:debug|info|log|warn|error)/);
}
const sendMsgBlock = popupSource.slice(popupSource.indexOf('async function sendMsg'), popupSource.indexOf('// Credentials are sent', popupSource.indexOf('async function sendMsg')));
assert.doesNotMatch(sendMsgBlock, /KeygrainDiagnostics/);


// Post-unlock UI state: the successful owner unlock must not return to the login form.
const updateScreenMarkup = popupHtml.slice(
  popupHtml.indexOf('<div id="update-required-screen"'),
  popupHtml.indexOf('<!-- Main Screen -->'),
);
assert.match(updateScreenMarkup, /role="status"/);
assert.match(updateScreenMarkup, /aria-live="polite"/);
assert.match(updateScreenMarkup, /tabindex="-1"/);
assert.match(updateScreenMarkup, /Unlock completed\. Update Keygrain to continue\./);
assert.doesNotMatch(updateScreenMarkup, /<(?:input|button)\b/);

function fakeScreenElement(initiallyHidden = true) {
  const classes = new Set(initiallyHidden ? ['hidden'] : []);
  return {
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
    get hidden() { return classes.has('hidden'); },
    textContent: '',
    value: '',
    focus() { this.focused = true; },
    focused: false,
  };
}
const updateScreen = fakeScreenElement();
const lockForState = fakeScreenElement(false);
const pinForState = fakeScreenElement(false);
const mainForState = fakeScreenElement(false);
const stateContext = createContext({
  document: {body: {style: {}}},
  updateRequiredScreen: updateScreen,
  lockScreen: lockForState,
  pinScreen: pinForState,
  mainScreen: mainForState,
  statusEl: {textContent: 'stale status'},
  renderEpoch: 0,
  popupRenderItems: [],
});
runInContext('globalThis = this;', stateContext);
const updateStart = popupSource.indexOf('  function showUpdateRequiredScreen()');
const updateEnd = popupSource.indexOf('\n  function showPinScreen()', updateStart);
assert(updateStart >= 0 && updateEnd > updateStart, 'update-required helper must exist');
runInContext(popupSource.slice(updateStart, updateEnd), stateContext);
runInContext('showUpdateRequiredScreen()', stateContext);
assert.equal(stateContext.renderEpoch, 1);
assert.equal(updateScreen.hidden, false);
assert.equal(lockForState.hidden, true);
assert.equal(pinForState.hidden, true);
assert.equal(mainForState.hidden, true);
assert.equal(stateContext.statusEl.textContent, '');
assert.equal(updateScreen.focused, true);

for (const helper of ['showLockScreen', 'showPinScreen', 'showMainScreen']) {
  const start = popupSource.indexOf(`  function ${helper}()`);
  const next = popupSource.indexOf('\n  function ', start + 1);
  const body = popupSource.slice(start, next > start ? next : popupSource.length);
  assert.match(body, /updateRequiredScreen\.classList\.add\("hidden"\)/, `${helper} must hide update-required state`);
}
const unlockStart = popupSource.indexOf('  async function unlockFromForm()');
const unlockEnd = popupSource.indexOf('\n  async function failClosedLeaseExtension', unlockStart);
assert(unlockStart >= 0 && unlockEnd > unlockStart, 'unlock flow must remain identifiable');
const unlockFlow = popupSource.slice(unlockStart, unlockEnd);
const challengeAt = unlockFlow.indexOf('await sendMsg({action: "issueUnlockChallenge", popupSessionId})');
const envelopeAt = unlockFlow.indexOf('await KeygrainWorkerIngress.makeEnvelope(', challengeAt);
const unlockAt = unlockFlow.indexOf('await sendMsg({action: "unlockEncrypted", popupSessionId, envelope})', envelopeAt);
const firstEmailClear = unlockFlow.indexOf('if (emailInput) emailInput.value = "";', unlockAt);
const firstSecretClear = unlockFlow.indexOf('if (secretInput) secretInput.value = "";', unlockAt);
const ownerViewAt = unlockFlow.indexOf('await requestOwnerView()', unlockAt);
const finalEmailClear = unlockFlow.lastIndexOf('if (emailInput) emailInput.value = "";');
const finalSecretClear = unlockFlow.lastIndexOf('if (secretInput) secretInput.value = "";');
assert(challengeAt >= 0 && envelopeAt > challengeAt && unlockAt > envelopeAt,
  'challenge, envelope, and encrypted unlock order changed');
assert(firstEmailClear > unlockAt && firstSecretClear > unlockAt,
  'raw unlock inputs are not cleared after encrypted unlock');
assert(ownerViewAt > firstEmailClear && ownerViewAt > firstSecretClear,
  'owner view is requested before raw unlock inputs are cleared');
assert(finalEmailClear > ownerViewAt && finalSecretClear > ownerViewAt,
  'final cleanup no longer clears both raw unlock inputs');

const ownerViewStart = popupSource.indexOf('  async function requestOwnerView()');
const ownerViewEnd = popupSource.indexOf('\n  async function unlockFromForm', ownerViewStart);
assert(ownerViewStart >= 0 && ownerViewEnd > ownerViewStart, 'owner view flow must remain identifiable');
const ownerViewFlow = popupSource.slice(ownerViewStart, ownerViewEnd);
const stateRequestAt = ownerViewFlow.indexOf('await sendMsg({action: FIXED_ACTIONS.state})');
const consumerRequestAt = ownerViewFlow.indexOf('await sendMsg({action});', stateRequestAt);
const deliveryStateAt = ownerViewFlow.indexOf('await sendMsg({action: FIXED_ACTIONS.state})', stateRequestAt + 1);
const generationCheckAt = ownerViewFlow.indexOf('deliveryState.stateGeneration !== state.stateGeneration');
const renderAt = ownerViewFlow.indexOf('renderItems(boundedItems, state)');
const selectionOptionsAt = ownerViewFlow.indexOf('FIXED_ACTIONS.selectionOptions') > -1 ? ownerViewFlow.indexOf('FIXED_ACTIONS.selectionOptions') : ownerViewFlow.indexOf('requestPasswordOptions');
assert(stateRequestAt >= 0 && consumerRequestAt > stateRequestAt && deliveryStateAt > consumerRequestAt,
  'owner view does not request state, then the fixed state-gated consumer, then delivery state');
assert(generationCheckAt >= 0 && generationCheckAt < renderAt,
  'state/authorization generation checks do not precede rendering');
assert(selectionOptionsAt > generationCheckAt,
  'password capabilities are requested before delivery-state validation');
assert.match(ownerViewFlow, /FIXED_ACTIONS\.metadata/);
assert.match(ownerViewFlow, /FIXED_ACTIONS\.serviceList/);
assert.match(ownerViewFlow, /if \(epoch !== renderEpoch\) return;/);
assert.match(ownerViewFlow, /validateItemsResponse\(response\)/);

assert.match(popupSource, /let popupRenderItems = \[\]/,
  'popup render-only projection is missing');
assert.doesNotMatch(popupSource, /\bcurrentSecret\b|\bcurrentEmail\b|\bservices\s*=/,
  'popup retains secret, email, or full-record authority');
assert.doesNotMatch(popupSource, /chrome\.storage|decryptServices|derivePassword|syncWithServer|operationHandle|fullData/,
  'popup retains a direct storage/crypto/operation authority path');
// check replaced
//  'popup response is not constrained to the bounded multi-field projection');

console.log('  ✓ development identity, popup label, build inventory, and post-unlock state');