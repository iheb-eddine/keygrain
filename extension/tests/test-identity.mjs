// extension/tests/test-identity.mjs — Dev identity and build inventory checks
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, '..');
const chromeManifest = JSON.parse(readFileSync(resolve(extensionRoot, 'chrome', 'manifest.json'), 'utf8'));
const firefoxManifest = JSON.parse(readFileSync(resolve(extensionRoot, 'firefox', 'manifest.json'), 'utf8'));
const popupSource = readFileSync(resolve(extensionRoot, 'shared', 'popup.js'), 'utf8');
const buildSource = readFileSync(resolve(extensionRoot, 'build.sh'), 'utf8');
const popupHtml = readFileSync(resolve(extensionRoot, 'shared', 'popup.html'), 'utf8');
const chromeBackground = readFileSync(resolve(extensionRoot, 'chrome', 'background.js'), 'utf8');
const firefoxBackground = readFileSync(resolve(extensionRoot, 'firefox', 'background.js'), 'utf8');
const diagnosticsSource = readFileSync(resolve(extensionRoot, 'shared', 'diagnostics.js'), 'utf8');

const expectedName = 'Keygrain';
const expectedVersion = '1.3.0';
const expectedFirefoxId = 'extension@keygrain.com';

assert.equal(chromeManifest.name, expectedName);
assert.equal(firefoxManifest.name, expectedName);
assert.equal(chromeManifest.version, expectedVersion);
assert.equal(firefoxManifest.version, expectedVersion);
assert.match(expectedVersion, /^\d+\.\d+\.\d+$/);
assert.equal(Object.hasOwn(chromeManifest, 'browser_specific_settings'), false);
assert.equal(firefoxManifest.browser_specific_settings.gecko.id, expectedFirefoxId);
assert.equal(firefoxManifest.manifest_version, 3);
assert.equal(Object.hasOwn(firefoxManifest, 'browser_action'), false);
assert.equal(Object.hasOwn(firefoxManifest, 'action'), true);
assert.deepEqual(Object.keys(firefoxManifest.background), ['scripts']);
assert.equal(Object.hasOwn(firefoxManifest.background, 'service_worker'), false);
assert.ok(firefoxManifest.permissions.includes('scripting'));
assert.ok(Array.isArray(firefoxManifest.host_permissions));

assert.match(
  popupSource,
  /const manifest = chrome\.runtime\.getManifest\(\);[\s\S]*versionDisplay\.textContent = manifest\.name \+ " v" \+ manifest\.version;/,
  'popup Settings label must use runtime manifest name and version',
);
assert.doesNotMatch(popupSource, /version_name/);

assert.match(buildSource, /mkdir -p dist\/chrome dist\/firefox/);
assert.match(buildSource, /for target in chrome firefox; do/);
assert.match(popupHtml, /<script src="diagnostics\.js"><\/script>/);
assert.match(popupHtml, /<script src="worker-ingress\.js"><\/script>[\s\S]*<script src="popup-dialog\.js"><\/script>/);
assert.match(chromeBackground, /importScripts\([^\n]*"worker-ingress\.js"/);
assert.match(chromeBackground, /action === "issueUnlockChallenge"/);
assert.match(chromeBackground, /action === "unlockEncrypted"/);
assert.match(firefoxManifest.background.scripts.join(','), /worker-ingress\.js/);
assert.match(firefoxBackground, /action === "issueUnlockChallenge"/);
assert.match(firefoxBackground, /action === "unlockEncrypted"/);
assert.doesNotMatch(chromeBackground, /action === "unlock"/);
assert.doesNotMatch(firefoxBackground, /action === "unlock"/);
assert.match(popupSource, /issueUnlockChallenge/);
assert.match(popupSource, /unlockEncrypted/);
assert.doesNotMatch(popupSource, /secret:\s*candidateSecret/);
assert.doesNotMatch(popupSource, /action:\s*["']unlock["']/);
assert.match(chromeBackground, /importScripts\([^\n]*"diagnostics\.js"/);
assert.doesNotMatch(JSON.stringify(firefoxManifest), /browser_action|optional_permissions/);
assert.doesNotMatch(readFileSync(resolve(extensionRoot, 'firefox', 'background.js'), 'utf8'), /MV2|browserAction|tabs\.executeScript|contentScripts\.register/);
assert.match(diagnosticsSource, /runtime\.getManifest\(\)\?\.name === DEV_MANIFEST_NAME/);
assert.match(buildSource, /cp -r shared\/\* "dist\/\$target\/"/);
assert.match(buildSource, /cp "\$target"\/\* "dist\/\$target\/"/);
assert.match(buildSource, /extract_version/);
assert.match(buildSource, /keygrain-\$target-\$V\.zip/);

console.log('  ✓ development identity, popup label, and build inventory');
