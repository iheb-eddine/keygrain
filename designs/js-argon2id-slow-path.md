# Slow-Path CI Job: Real Argon2id in JS Extension Tests

Closes drift vector #2: the current JS tests mock Argon2id entirely via `STRENGTHEN_MAP`, meaning the strengthen step itself is never tested against the canonical vectors.

## Frozen Requirements

1. A new CI job `test-js-slow` runs in the `test` stage, separate from `test-js`.
2. Uses `node:20-alpine` image.
3. Executes the real `hash-wasm-argon2.js` WASM bundle inside the VM context (no mocks).
4. Calls `strengthenSecret(secret_utf8, email)` with real Argon2id.
5. Asserts the output matches `expected_hex` from `vectors.json` for at least one strengthen vector.
6. Argon2id params are those hardcoded in `keygrain.js`: t=3, m=65536 (64 MB), p=1, len=32.
7. Job timeout: 2 minutes (generous for a ~5s computation).

## Invariants

1. The test MUST use the same `strengthenSecret()` from `extension/shared/keygrain.js` — not a reimplementation.
2. Expected values MUST come from `vectors.json` (single source of truth).
3. The test MUST fail if Argon2id output diverges from the vector (drift detection).
4. The job MUST NOT block the fast `test-js` job (separate job, no `needs` dependency).
5. The job MUST be pipeline-blocking (`allow_failure` is NOT set). A drift failure must prevent merge.

## Scope Boundary

**In scope:**
- New file: `extension/tests/test-strengthen-slow.mjs`
- New CI job definition in `.gitlab-ci.yml`
- Verifying ≥1 strengthen vector with real Argon2id

**Out of scope:**
- Modifying `test.mjs` or its mock approach
- Running all strengthen vectors (optional future optimization)
- Performance benchmarking
- Any changes to `keygrain.js` or `hash-wasm-argon2.js`

## Test Plan

### Test file: `extension/tests/test-strengthen-slow.mjs`

Approach:

1. Create a VM context with `WebAssembly`, `TextEncoder`, `TextDecoder`, `Uint8Array`, `crypto`, `setTimeout`, etc.
2. Execute `hash-wasm-argon2.js` source inside the VM context. This UMD bundle assigns `hashwasm.argon2id` to `globalThis.hashwasm` — providing the real WASM-backed implementation.
3. Execute `keygrain.js` source inside the same context (it references `hashwasm.argon2id`).
4. Read `vectors.json`, extract `strengthen_vectors[0]` (the base case: secret=`my-master-secret`, email=`test@gmail.com`).
5. Call `strengthenSecret(secret_utf8, email)` in the VM.
6. Convert the result to hex and assert equality with `expected_hex`.
7. Exit 0 on match, exit 1 on mismatch.

Key difference from `test.mjs`: the existing test provides a mock `hashwasm` object that returns hardcoded values. The slow-path test instead runs the actual `hash-wasm-argon2.js` source in the VM, so the real WASM Argon2id executes.

### CI job

```yaml
test-js-slow:
  stage: test
  image: node:20-alpine
  script:
    - cd extension/tests
    - node test-strengthen-slow.mjs
  timeout: 2m
  rules:
    - if: $CI_COMMIT_BRANCH
```

No `allow_failure`. No test-baseline enforcement — this is a single-assertion smoke test.

### Why this is safe in Node 20

Node 20 has full `WebAssembly` support. The `vm.createContext()` API includes `WebAssembly` in the context by default. The hash-wasm bundle compiles its WASM module via `WebAssembly.compile()` which works in any V8-backed context.
