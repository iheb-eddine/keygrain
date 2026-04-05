# Cross-Platform Integration CI Job

Closes drift vector #3: each platform tests independently but no job compares outputs across platforms.

## Frozen Requirements

1. A single GitLab CI job (`test-cross-platform`) runs in the `test` stage.
2. The job derives passwords using the **full pipeline** (Argon2id strengthening + HMAC derivation + rejection sampling + Fisher-Yates shuffle) on both Python and Node.js for identical inputs.
3. The job asserts that Python output === JS output for each tested vector.
4. At least two vectors from `vectors.json` are tested:
   - `vectors[0]`: base case (secret=`my-master-secret`, site=`github.com`, length=20, counter=1)
   - `vectors[4]`: different length (length=16) — exercises stream consumption differences
5. The job uses `node:20` (Debian-based) as the base image, with Python 3 installed via apt.
6. `argon2-cffi` is installed via pip (manylinux wheel, no compilation needed on Debian).
7. The keygrain Python package is installed via `pip install ./python`.
8. The JS derivation uses the existing VM-based approach (load hash-wasm-argon2.js + keygrain.js in a Node VM context).
9. Timeout: 2 minutes (actual runtime ~10–15s: two Argon2id calls per platform, but the same strengthened key is reused for both vectors on each platform).
10. Output comparison strips trailing whitespace to avoid newline mismatch false failures.

## Invariants

1. **Determinism:** Given identical inputs, Python and JS MUST produce identical password strings. If they diverge, the job fails.
2. **Full pipeline:** The test runs real Argon2id (no mocks). This is the entire point — mocked tests cannot catch Argon2id parameter drift.
3. **Vector source of truth:** The expected outputs come from `vectors.json`. Both platforms must match the expected value AND each other.
4. **Independence from unit tests:** This job does not replace per-platform unit tests. It adds a cross-platform comparison layer.

## Scope Boundary

**In scope:**
- Python + JS full derivation comparison
- GitLab CI job definition (in `.gitlab-ci.yml`)
- A runner script (`ci/cross-platform-check.sh`) that orchestrates both derivations and comparison

**Out of scope:**
- Kotlin (requires Android SDK — impractical in CI without the existing heavy setup)
- Strengthen-only comparison (already covered by per-platform tests against vectors.json)
- Fingerprint vectors (no Argon2id involved, low drift risk)
- TOTP, wallet, or SSH derivation vectors
- Performance optimization (this job is intentionally slow)

## Test Plan

### Job: `test-cross-platform`

**Image:** `node:20`

**Setup:**
```bash
apt-get update && apt-get install -y python3 python3-pip python3-venv
pip install --break-system-packages ./python
```

**Execution flow (ci/cross-platform-check.sh):**

Each derive script reads `vectors.json` directly and takes vector indices as arguments. No vector data passes through shell variables — this avoids shell metacharacter issues with symbols like `$`, `!`, `*`.

1. **Python derivation:**
   ```bash
   PY_OUT=$(python3 ci/cross-platform-derive.py 0 4)
   ```
   The script reads `vectors.json`, derives passwords for the specified vector indices, and prints one result per line (no trailing whitespace).

2. **JS derivation:**
   ```bash
   JS_OUT=$(node ci/cross-platform-derive.mjs 0 4)
   ```
   The `.mjs` script uses the VM-context approach from `test-strengthen-slow.mjs`: loads `hash-wasm-argon2.js` and `keygrain.js` in a Node VM, derives passwords for the specified vector indices, prints one result per line.

3. **Comparison:**
   ```bash
   if [ "$PY_OUT" != "$JS_OUT" ]; then
     echo "DRIFT DETECTED"
     echo "  Python: $PY_OUT"
     echo "  JS:     $JS_OUT"
     exit 1
   fi
   echo "✓ Cross-platform outputs match"
   ```

   Each script also validates its own output against the `expected` field in vectors.json internally, failing with a non-zero exit code if there's a mismatch.

**Expected output on success:**
```
✓ [py] vectors[0] github.com len=20: ?X_BAbv4UHAfw=kYV$mh
✓ [py] vectors[4] github.com len=16: -g_7CA9z$e2HQ3pA
✓ [js] vectors[0] github.com len=20: ?X_BAbv4UHAfw=kYV$mh
✓ [js] vectors[4] github.com len=16: -g_7CA9z$e2HQ3pA
✓ Cross-platform outputs match
```

### CI Job Definition (addition to .gitlab-ci.yml)

```yaml
test-cross-platform:
  stage: test
  image: node:20
  script:
    - apt-get update && apt-get install -y python3 python3-pip python3-venv
    - pip install --break-system-packages ./python
    - bash ci/cross-platform-check.sh
  timeout: 2m
  rules:
    - if: $CI_COMMIT_BRANCH
```

### Files to Create (during implementation)

| File | Purpose |
|------|---------|
| `ci/cross-platform-check.sh` | Orchestrator: runs Python + JS scripts, compares stdout |
| `ci/cross-platform-derive.py` | Python script: reads vectors.json, derives passwords for given indices, prints results |
| `ci/cross-platform-derive.mjs` | Node.js script: reads vectors.json, loads keygrain in VM, derives passwords, prints results |

### Failure Modes

| Failure | Meaning | Action |
|---------|---------|--------|
| Python ≠ JS | Cross-platform drift | Investigate which platform diverged from vectors.json |
| Both ≠ expected | Both platforms drifted together | Likely vectors.json was updated without updating implementations |
| pip install fails | argon2-cffi wheel unavailable | Check Python version compatibility, consider pinning |
| Timeout (>2m) | Argon2id taking too long | Investigate CI runner memory (Argon2id needs 64MB) |
