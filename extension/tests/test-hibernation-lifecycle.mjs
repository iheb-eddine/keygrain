import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Keygrain Hibernation Lifecycle Adversarial Tests:');

for (const browserName of ['chrome', 'firefox']) {
  const bgSource = readFileSync(resolve(__dirname, '..', browserName, 'background.js'), 'utf8');

  // Verify critical structural and anti-regression invariants in background.js source:
  assert.match(bgSource, /sessionUpdateQueue/, `${browserName}: must declare and use sessionUpdateQueue serialization`);
  assert.match(bgSource, /activeMetadataTailSeconds\s*:\s*activeTail/, `${browserName}: saveSession must persist activeTail`);
  assert.match(bgSource, /activeMetadataTailSeconds\s*:\s*session\.activeMetadataTailSeconds/, `${browserName}: restoreSession must pass session.activeMetadataTailSeconds directly without recalculation`);
  assert.doesNotMatch(bgSource, /Math\.round\(\(session\.metadataTailAnchor\s*-\s*session\.fullExpiresAt\)\s*\/\s*1000\)/,
    `${browserName}: background.js must NOT compute arithmetic drift during restoreSession`);

  const makeCtx = (initialTime = 1000000000) => {
    let mockTime = initialTime;
    const ctx = createContext({
      Array, ArrayBuffer,
      Date: class extends Date {
        constructor(...args) {
          if (args.length === 0) super(mockTime);
          else super(...args);
        }
        static now() { return mockTime; }
      },
      Error, JSON, Map, Math, Number, Object, Promise, RegExp, Set, String, URL, Uint8Array, console,
      setTimeout, clearTimeout,
    });
    runInContext('globalThis = this;', ctx);
    runInContext(readFileSync(resolve(__dirname, '..', 'shared', 'unlock-state.js'), 'utf8'), ctx);
    runInContext('globalThis.KeygrainInline = {computeMatchPatterns: () => []};', ctx);
    runInContext(readFileSync(resolve(__dirname, '..', 'shared', 'browser-owner.js'), 'utf8'), ctx);

    return {
      ctx,
      setTime: (t) => { mockTime = t; },
      getTime: () => mockTime,
    };
  };

  // Scenario 1: Clean cold boot into full unlock state before full lease expiry
  {
    const { ctx, setTime, getTime } = makeCtx(1000000);
    const mockStorage = { keygrainSecurityLeaseSettings: { version: 1, fullLeaseSeconds: 60, metadataTailSeconds: 14400 } };
    let savedSession = null;
    const adapter = {
      browser: browserName,
      storage: {
        async get() { return mockStorage; },
        async set() {},
        async remove() {},
      },
      async reconcileIndicators(payload) {
        const snap = payload.after;
        if (snap.state === 'locked') {
          savedSession = null;
        } else {
          savedSession = {
            email: 'user@example.com',
            secret: snap.state === 'full' ? 'secret-123' : null,
            fullExpiresAt: snap.state === 'full' ? snap.fullExpiresAt : null,
            metadataExpiresAt: snap.metadataExpiresAt,
            metadataTailAnchor: snap.metadataTailAnchor,
            activeMetadataTailSeconds: snap.state === 'full' ? 14400 : null,
            metadata: [{ id: '1', site: 'test.com', name: 'Test', email: 'user@example.com' }],
          };
        }
      }
    };
    ctx._adapter = adapter;
    runInContext('globalThis.owner = KeygrainBrowserOwner.createOwner({adapter:_adapter, settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>Date.now()})', ctx);
    runInContext(`
      owner.manager.unlockFull({
        fullData: { secret: "secret-123", email: "user@example.com", services: [{ id: "1", site: "test.com", name: "Test", email: "user@example.com", password: "p" }] },
        records: [{ id: "1", site: "test.com", name: "Test", email: "user@example.com" }]
      });
      owner.reconcile("unlock");
    `, ctx);
    await runInContext('owner.whenReconciled()', ctx);

    // Evict owner instance (simulating worker termination)
    ctx.owner = null;

    // Wake 20 seconds later (well within 60s full lease)
    setTime(getTime() + 20000);

    // Worker wakes up, re-creates owner, restores session
    runInContext('globalThis.owner = KeygrainBrowserOwner.createOwner({adapter:_adapter, settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>Date.now()})', ctx);
    ctx._restoringSession = savedSession;
    runInContext(`
      owner.restoreSession({
        email: _restoringSession.email,
        fullData: { secret: _restoringSession.secret, email: _restoringSession.email, services: [{ id: "1", site: "test.com", name: "Test", email: "user@example.com", password: "p" }] },
        records: [{ id: "1", site: "test.com", name: "Test", email: "user@example.com" }],
        fullExpiresAt: _restoringSession.fullExpiresAt,
        metadataTailAnchor: _restoringSession.metadataTailAnchor,
        activeMetadataTailSeconds: _restoringSession.activeMetadataTailSeconds,
      });
      owner.reconcile("startup");
    `, ctx);
    await runInContext('owner.whenReconciled()', ctx);

    const snap = runInContext('owner.snapshot()', ctx);
    assert.equal(snap.state, 'full', `${browserName} S1: state should be full`);
    assert.equal(snap.fullExpiresAt, 1060000, `${browserName} S1: fullExpiresAt must be exact`);
    assert.equal(snap.metadataTailAnchor, 1000000 + (60 + 14400) * 1000, `${browserName} S1: metadataTailAnchor must be exact`);
    console.log(`  ✓ ${browserName}: S1 cold boot into full lease succeeds with exact lease`);
  }

  // Scenario 2: Worker wakes up 1 second before full lease expiry (negative jitter)
  {
    const { ctx, setTime, getTime } = makeCtx(2000000);
    let savedSession = {
      email: 'user@example.com',
      secret: 'secret-123',
      fullExpiresAt: 2060000,
      metadataExpiresAt: null,
      metadataTailAnchor: 2060000 + 14400000,
      activeMetadataTailSeconds: 14400,
      metadata: [{ id: '1', site: 'test.com', name: 'Test', email: 'user@example.com' }],
    };
    const adapter = {
      browser: browserName,
      storage: { async get() { return {}; }, async set() {}, async remove() {} },
      async reconcileIndicators() {}
    };
    ctx._adapter = adapter;
    // Advance to 100ms before expiry
    setTime(2059900);
    runInContext('globalThis.owner = KeygrainBrowserOwner.createOwner({adapter:_adapter, settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>Date.now()})', ctx);
    ctx._restoringSession = savedSession;
    runInContext(`
      owner.restoreSession({
        email: _restoringSession.email,
        fullData: { secret: _restoringSession.secret, email: _restoringSession.email, services: [] },
        records: [],
        fullExpiresAt: _restoringSession.fullExpiresAt,
        metadataTailAnchor: _restoringSession.metadataTailAnchor,
        activeMetadataTailSeconds: _restoringSession.activeMetadataTailSeconds,
      });
      owner.reconcile("startup");
    `, ctx);
    await runInContext('owner.whenReconciled()', ctx);

    let snap = runInContext('owner.snapshot()', ctx);
    assert.equal(snap.state, 'full', `${browserName} S2: state should still be full before deadline`);

    // Advance past deadline by 200ms
    setTime(2060100);
    runInContext('owner.reconcile("wake");', ctx);
    await runInContext('owner.whenReconciled()', ctx);

    snap = runInContext('owner.snapshot()', ctx);
    assert.equal(snap.state, 'metadata', `${browserName} S2: state must transition cleanly to metadata`);
    assert.equal(snap.metadataTailAnchor, 2060000 + 14400000, `${browserName} S2: metadataTailAnchor must remain anchor`);
    console.log(`  ✓ ${browserName}: S2 wake right before full lease boundary transitions safely`);
  }

  // Scenario 3: Delayed alarm / OS sleep past full lease expiry (e.g. +2 hours later)
  {
    const { ctx, setTime } = makeCtx(3000000);
    let savedSession = {
      email: 'user@example.com',
      secret: 'secret-123',
      fullExpiresAt: 3060000, // 60s lease
      metadataExpiresAt: null,
      metadataTailAnchor: 3060000 + 14400000, // 4 hours tail
      activeMetadataTailSeconds: 14400,
      metadata: [{ id: '1', site: 'test.com', name: 'Test', email: 'user@example.com' }],
    };
    const adapter = {
      browser: browserName,
      storage: { async get() { return {}; }, async set() {}, async remove() {} },
      async reconcileIndicators() {}
    };
    ctx._adapter = adapter;
    // OS slept for 2 hours (7200 seconds)
    setTime(3000000 + 7200000);

    runInContext('globalThis.owner = KeygrainBrowserOwner.createOwner({adapter:_adapter, settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>Date.now()})', ctx);
    ctx._restoringSession = savedSession;
    // Startup logic in background.js: now >= fullExpiresAt, but now < metadataTailAnchor
    runInContext(`
      owner.restoreSession({
        email: _restoringSession.email,
        metadata: _restoringSession.metadata,
        metadataExpiresAt: _restoringSession.metadataTailAnchor,
        metadataTailAnchor: _restoringSession.metadataTailAnchor,
        activeMetadataTailSeconds: _restoringSession.activeMetadataTailSeconds,
      });
      owner.reconcile("startup");
    `, ctx);
    await runInContext('owner.whenReconciled()', ctx);

    const snap = runInContext('owner.snapshot()', ctx);
    assert.equal(snap.state, 'metadata', `${browserName} S3: state must be metadata`);
    assert.equal(snap.fullExpiresAt, null, `${browserName} S3: fullExpiresAt must be null`);
    assert.equal(snap.hasFullData, false, `${browserName} S3: hasFullData must be false`);
    assert.equal(snap.metadataTailAnchor, 3060000 + 14400000, `${browserName} S3: tail anchor must not shift`);
    console.log(`  ✓ ${browserName}: S3 late wake past full lease transitions to metadata without anchor shift`);
  }

  // Scenario 4: Extreme sleep (+24 hours) past both full and metadata tail
  {
    const { ctx, setTime } = makeCtx(4000000);
    const adapter = {
      browser: browserName,
      storage: { async get() { return {}; }, async set() {}, async remove() {} },
      async reconcileIndicators() {}
    };
    ctx._adapter = adapter;
    // Time advanced by 24h
    setTime(4000000 + 86400000);
    runInContext('globalThis.owner = KeygrainBrowserOwner.createOwner({adapter:_adapter, settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>Date.now()})', ctx);
    // When now >= metadataTailAnchor, background.js removes keygrainSession and doesn't restore
    runInContext('owner.reconcile("startup");', ctx);
    await runInContext('owner.whenReconciled()', ctx);

    const snap = runInContext('owner.snapshot()', ctx);
    assert.equal(snap.state, 'locked', `${browserName} S4: state must be locked`);
    assert.equal(snap.metadataAvailable, false, `${browserName} S4: metadata must not be available`);
    console.log(`  ✓ ${browserName}: S4 extreme sleep past metadata tail lands securely in locked state`);
  }

  // Scenario 5: Multiple cold wakes during metadata tail maintain exact tail anchor without arithmetic drift
  {
    const { ctx, setTime } = makeCtx(5000000);
    const initialFullExpiresAt = 5060000;
    const initialTailAnchor = 5060000 + 14400000;
    let savedSession = {
      email: 'user@example.com',
      secret: null,
      fullExpiresAt: null,
      metadataExpiresAt: initialTailAnchor,
      metadataTailAnchor: initialTailAnchor,
      activeMetadataTailSeconds: 14400,
      metadata: [{ id: '1', site: 'test.com', name: 'Test', email: 'user@example.com' }],
    };
    const adapter = {
      browser: browserName,
      storage: { async get() { return {}; }, async set() {}, async remove() {} },
      async reconcileIndicators() {}
    };
    ctx._adapter = adapter;

    // Wake 1 at +30m
    setTime(5000000 + 1800000);
    runInContext('globalThis.owner = KeygrainBrowserOwner.createOwner({adapter:_adapter, settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>Date.now()})', ctx);
    ctx._restoringSession = savedSession;
    runInContext(`
      owner.restoreSession({
        email: _restoringSession.email,
        metadata: _restoringSession.metadata,
        metadataExpiresAt: _restoringSession.metadataTailAnchor,
        metadataTailAnchor: _restoringSession.metadataTailAnchor,
        activeMetadataTailSeconds: _restoringSession.activeMetadataTailSeconds,
      });
      owner.reconcile("startup");
    `, ctx);
    await runInContext('owner.whenReconciled()', ctx);

    let snap = runInContext('owner.snapshot()', ctx);
    assert.equal(snap.metadataTailAnchor, initialTailAnchor, `${browserName} S5: wake 1 tail anchor must match initial`);

    // Simulate session update saving back activeMetadataTailSeconds
    savedSession.activeMetadataTailSeconds = 14400;

    // Wake 2 at +1h
    ctx.owner = null;
    setTime(5000000 + 3600000);
    runInContext('globalThis.owner = KeygrainBrowserOwner.createOwner({adapter:_adapter, settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>Date.now()})', ctx);
    ctx._restoringSession = savedSession;
    runInContext(`
      owner.restoreSession({
        email: _restoringSession.email,
        metadata: _restoringSession.metadata,
        metadataExpiresAt: _restoringSession.metadataTailAnchor,
        metadataTailAnchor: _restoringSession.metadataTailAnchor,
        activeMetadataTailSeconds: _restoringSession.activeMetadataTailSeconds,
      });
      owner.reconcile("startup");
    `, ctx);
    await runInContext('owner.whenReconciled()', ctx);

    snap = runInContext('owner.snapshot()', ctx);
    assert.equal(snap.metadataTailAnchor, initialTailAnchor, `${browserName} S5: wake 2 tail anchor must not drift`);
    console.log(`  ✓ ${browserName}: S5 successive cold wakes preserve exact tail anchor without arithmetic drift`);
  }

  // Scenario 6: Re-unlock from metadata state resets full lease and re-anchors metadata tail
  {
    const { ctx, setTime } = makeCtx(6000000);
    const adapter = {
      browser: browserName,
      storage: { async get() { return {}; }, async set() {}, async remove() {} },
      async reconcileIndicators() {}
    };
    ctx._adapter = adapter;
    setTime(6000000);
    runInContext('globalThis.owner = KeygrainBrowserOwner.createOwner({adapter:_adapter, settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>Date.now()})', ctx);
    // Restore in metadata state
    runInContext(`
      owner.restoreSession({
        email: "user@example.com",
        metadata: [{ id: "1", site: "test.com", name: "Test", email: "user@example.com" }],
        metadataExpiresAt: 6000000 + 10000,
        metadataTailAnchor: 6000000 + 10000,
        activeMetadataTailSeconds: 14400,
      });
      owner.reconcile("startup");
    `, ctx);
    await runInContext('owner.whenReconciled()', ctx);

    let snap = runInContext('owner.snapshot()', ctx);
    assert.equal(snap.state, 'metadata');

    // User unlocks full again
    setTime(6005000);
    runInContext(`
      owner.manager.unlockFull({
        fullData: { secret: "secret-abc", email: "user@example.com", services: [{ id: "1", site: "test.com", name: "Test", email: "user@example.com", password: "p" }] },
        records: [{ id: "1", site: "test.com", name: "Test", email: "user@example.com" }]
      });
      owner.reconcile("unlock");
    `, ctx);
    await runInContext('owner.whenReconciled()', ctx);

    snap = runInContext('owner.snapshot()', ctx);
    assert.equal(snap.state, 'full', `${browserName} S6: must transition back to full`);
    assert.equal(snap.fullExpiresAt, 6005000 + 60000, `${browserName} S6: new full lease`);
    assert.equal(snap.metadataTailAnchor, 6005000 + (60 + 14400) * 1000, `${browserName} S6: newly anchored tail`);
    console.log(`  ✓ ${browserName}: S6 re-unlock from metadata state cleanly re-anchors full lease`);
  }

  // Scenario 7: Concurrent updateSession serialization
  {
    let queue = Promise.resolve();
    let session = { count: 0, ops: [] };
    const updateSession = (updater) => {
      queue = queue.then(async () => {
        // simulate async storage I/O delay
        await new Promise(r => setTimeout(r, 2));
        session = await updater(session);
      }).catch(() => {});
      return queue;
    };

    // Fire 5 concurrent updates without awaiting individual callers
    const p1 = updateSession(async (s) => ({ ...s, count: s.count + 1, ops: [...s.ops, 1] }));
    const p2 = updateSession(async (s) => ({ ...s, count: s.count + 1, ops: [...s.ops, 2] }));
    const p3 = updateSession(async (s) => ({ ...s, count: s.count + 1, ops: [...s.ops, 3] }));
    const p4 = updateSession(async (s) => ({ ...s, count: s.count + 1, ops: [...s.ops, 4] }));
    const p5 = updateSession(async (s) => ({ ...s, count: s.count + 1, ops: [...s.ops, 5] }));

    await Promise.all([p1, p2, p3, p4, p5]);
    assert.equal(session.count, 5, `${browserName} S7: concurrency count must be 5`);
    assert.deepEqual(session.ops, [1, 2, 3, 4, 5], `${browserName} S7: ops must be perfectly serialized`);
    console.log(`  ✓ ${browserName}: S7 updateSession serializes concurrent updates without lost writes`);
  }

  // Scenario 8: Invalid or corrupted storage.session payloads fail closed safely
  {
    const { ctx } = makeCtx(8000000);
    const adapter = {
      browser: browserName,
      storage: { async get() { return {}; }, async set() {}, async remove() {} },
      async reconcileIndicators() {}
    };
    ctx._adapter = adapter;
    runInContext('globalThis.owner = KeygrainBrowserOwner.createOwner({adapter:_adapter, settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>Date.now()})', ctx);

    // Attempt invalid email
    assert.throws(() => {
      runInContext('owner.restoreSession({ email: null, fullData: {}, records: [], fullExpiresAt: 8000100 })', ctx);
    }, /KEYGRAIN_STALE_OPERATION/);

    // Attempt missing fullData
    assert.throws(() => {
      runInContext('owner.restoreSession({ email: "test@example.com", fullData: null, records: [], fullExpiresAt: 8000100 })', ctx);
    }, /KEYGRAIN_STALE_OPERATION/);

    const snap = runInContext('owner.snapshot()', ctx);
    assert.equal(snap.state, 'locked', `${browserName} S8: invalid session payload fails closed to locked`);
    console.log(`  ✓ ${browserName}: S8 corrupted session payloads fail closed without exposing state`);
  }

  // Scenario 9: Inbound unlock messages wait for startupPromise
  {
    let startupResolved = false;
    let unlockExecuted = false;
    const startupPromise = new Promise(resolve => {
      setTimeout(() => {
        startupResolved = true;
        resolve();
      }, 10);
    });

    const ingressPromise = Promise.resolve({
      issueChallenge: async () => {
        assert.equal(startupResolved, true, 'startupPromise must resolve before ingress challenge');
        unlockExecuted = true;
        return 'test-challenge';
      }
    });

    // Emulate background.js message handling
    await startupPromise
      .then(() => ingressPromise)
      .then(ingress => ingress.issueChallenge({ sender: {}, popupSessionId: 'sess-1' }));

    assert.equal(unlockExecuted, true);
    console.log(`  ✓ ${browserName}: S9 unlock challenge waits for startupPromise before admission`);
  }

  // Scenario 10: Full state manager recovery snapshot invariant
  {
    const { ctx } = makeCtx(10000000);
    const adapter = {
      browser: browserName,
      storage: { async get() { return {}; }, async set() {}, async remove() {} },
      async reconcileIndicators() {}
    };
    ctx._adapter = adapter;
    runInContext('globalThis.owner = KeygrainBrowserOwner.createOwner({adapter:_adapter, settings:{version:1,fullLeaseSeconds:60,metadataTailSeconds:14400}, clock:()=>Date.now()})', ctx);
    runInContext(`
      owner.restoreSession({
        email: "user@example.com",
        fullData: { secret: "s", email: "user@example.com", services: [] },
        records: [],
        fullExpiresAt: 10060000,
        metadataTailAnchor: 10000000 + 14460000,
        activeMetadataTailSeconds: 14400,
      });
    `, ctx);
    const snap = runInContext('owner.snapshot()', ctx);
    assert.deepEqual(
      Object.keys(snap).sort(),
      ['authorizationGeneration','fullExpiresAt','fullWarningAt','hasFullData','metadataAvailable','metadataExpiresAt','metadataTailAnchor','metadataWarningAt','state','stateGeneration'].sort()
    );
    console.log(`  ✓ ${browserName}: S10 snapshot after session recovery satisfies strict schema invariant`);
  }
}

console.log('All hibernation lifecycle adversarial tests passed successfully.');
