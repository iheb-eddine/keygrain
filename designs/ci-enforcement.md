# CI Enforcement Design

## Overview

Two automated gates added to GitLab CI to enforce QUALITY_PLAN.md rules, plus a new Go test job:

1. **Checksum gate** — Detects unauthorized/unacknowledged changes to `vectors.json` and `SPEC.md` by comparing their SHA-256 hashes against committed checksum files.
2. **Test count gate** — Prevents test deletion by comparing each platform's test count against a committed baseline. Pipeline fails if count drops.
3. **Go test job** — The Go server has 37 test functions but no CI job. Adding `test-go`.

These gates enforce the "Vector Checksum Gate" and "Test Count Gate" sections of QUALITY_PLAN.md mechanically, removing reliance on manual review for these checks.

## Frozen Requirements

### FR-1: Checksum Gate Job

A job named `checksum-gate` in stage `test` performs the following:

```bash
# vectors.json check
ACTUAL=$(sha256sum vectors.json | cut -d' ' -f1)
EXPECTED=$(tr -d '[:space:]' < .vectors-checksum)
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "CHECKSUM MISMATCH: vectors.json"
  echo "  expected: $EXPECTED"
  echo "  actual:   $ACTUAL"
  exit 1
fi

# SPEC.md check
ACTUAL=$(sha256sum SPEC.md | cut -d' ' -f1)
EXPECTED=$(tr -d '[:space:]' < .spec-checksum)
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "CHECKSUM MISMATCH: SPEC.md"
  echo "  expected: $EXPECTED"
  echo "  actual:   $ACTUAL"
  exit 1
fi
```

- Image: `alpine:3.19` (sha256sum available in coreutils)
- Runs on all branches: `rules: - if: $CI_COMMIT_BRANCH`
- Both files checked in a single job; both must pass

### FR-2: Test Count Gate

Each test job extracts its test count after a successful run and compares against `.test-baselines`. Pipeline fails if actual < baseline.

**Baseline file format** (`.test-baselines` in repo root):
```
python=127
js=84
kotlin=42
go=37
```

Plain `key=value`, one per line. No comments, no blank lines.

**Count extraction methods:**

| Platform | Method |
|----------|--------|
| Python | `pytest -q` outputs `N passed` on last line. Extract with: `grep -oP '^\d+(?= passed)'` |
| JS | Test runner outputs `N tests: X passed, Y failed`. Extract total with: `grep -oP '^\d+(?= tests:)'` |
| Kotlin | Parse Gradle XML test reports at `app/build/test-results/testReleaseUnitTest/**/*.xml`. Count: `find app/build/test-results/testReleaseUnitTest -name "*.xml" -exec grep -c "<testcase" {} + \| awk -F: '{sum+=$NF} END {print sum}'` |
| Go | `go test -v ./...` outputs `--- PASS:` per test. Count: `grep -c "^--- PASS:"` |

**Comparison logic** (appended to each test job's script):
```bash
ACTUAL_COUNT=<extracted count>
BASELINE=$(grep '^<platform>=' .test-baselines | cut -d= -f2)
if [ "$ACTUAL_COUNT" -lt "$BASELINE" ]; then
  echo "TEST COUNT REGRESSION: <platform>"
  echo "  baseline: $BASELINE"
  echo "  actual:   $ACTUAL_COUNT"
  exit 1
fi
echo "Test count OK: <platform> $ACTUAL_COUNT >= $BASELINE"
```

### FR-3: Go Test Job

A new job `test-go` in stage `test`:
- Image: `golang:1.22-alpine`
- Script: `cd server && go test -v ./... 2>&1 | tee test-output.txt`
- Count extraction from `test-output.txt` as specified in FR-2
- Runs on all branches: `rules: - if: $CI_COMMIT_BRANCH`

### FR-4: Error Messages

All gate failures MUST include:
- Which file/platform failed
- Expected value (from checksum file or baseline)
- Actual value (computed)

### FR-5: Baselines File

`.test-baselines` committed to repo root with initial values:
```
python=127
js=84
kotlin=42
go=37
```

## Invariants

1. Existing test jobs (`test-python`, `test-js`, `build-mobile`) continue to execute their tests exactly as before. Count gate logic is appended after existing commands — it does not replace or modify test execution.
2. No existing CI job is removed or renamed.
3. The `build`, `build-mobile`, `deploy` stages and their jobs are untouched except for appending count-gate logic to `build-mobile`'s script (after the existing `./gradlew testReleaseUnitTest` line).
4. Checksum file format remains: bare 64-character lowercase hex SHA-256 hash (trailing newline acceptable; comparison strips all whitespace).
5. The `build-mobile` job's trigger rules remain unchanged (master OR kotlin/** changes). This means the Kotlin count gate only runs when Kotlin code is relevant — this is a deliberate decision since Kotlin tests require full Android SDK setup and are slow.

## Scope Boundary

**Files that MAY be modified (in Session 2):**
- `.gitlab-ci.yml` — add `checksum-gate` job, add `test-go` job, append count-gate logic to `test-python`, `test-js`, `build-mobile`
- `.test-baselines` — new file

**Files that MUST NOT be modified:**
- `vectors.json`, `SPEC.md`
- `.vectors-checksum`, `.spec-checksum`
- Any source code (`python/`, `extension/`, `kotlin/`, `server/`)
- `QUALITY_PLAN.md`
- All other files not listed above

## Test Plan

### Verification Steps (for Session 2 implementer)

1. **Checksum gate — failure case:** Change one character in `.vectors-checksum`, push to a branch. Verify pipeline fails with message showing "CHECKSUM MISMATCH: vectors.json" and both expected/actual hashes.

2. **Checksum gate — pass case:** Push with correct checksums. Verify `checksum-gate` job passes.

3. **Test count gate — failure case:** Set `python=9999` in `.test-baselines`, push. Verify `test-python` job fails with message showing "TEST COUNT REGRESSION: python", baseline=9999, actual=127.

4. **Test count gate — pass case:** Push with correct baselines. Verify all test jobs pass and print "Test count OK: <platform> N >= M".

5. **Go test job — existence:** Verify `test-go` job appears in pipeline and passes with 37+ tests.

6. **Invariant check:** Verify all existing jobs (`test-python`, `test-js`, `build-extension`, `build-package`, `build-mobile`, `deploy`) still exist with their original behavior intact.

### Existing Tests That Verify Invariants

- `test-python`: 127 tests covering Python derivation logic
- `test-js`: 84 tests covering extension JS logic
- `build-mobile` (Kotlin): 42 unit tests
- All must continue passing without modification

## Integration

### New Jobs

| Job | Stage | Image | Trigger |
|-----|-------|-------|---------|
| `checksum-gate` | test | `alpine:3.19` | All branches |
| `test-go` | test | `golang:1.22-alpine` | All branches |

### Modified Jobs

| Job | Change |
|-----|--------|
| `test-python` | Append: capture pytest output, extract count, compare to baseline |
| `test-js` | Append: capture test output, extract count, compare to baseline |
| `build-mobile` | Append: after testReleaseUnitTest, extract count from XML reports, compare to baseline |

### Dependency Graph

No new inter-job dependencies. All test-stage jobs run in parallel. The `checksum-gate` job has no relationship to test jobs — it checks file integrity independently.

### Pipeline Flow (unchanged structure)

```
test stage:  [checksum-gate] [test-python] [test-js] [test-go] [build-mobile*]
build stage: [build-extension] [build-package]
deploy stage: [deploy]

* build-mobile only on master or kotlin/** changes
```

## Maintenance Procedures

### Updating Checksums (after user-approved spec/vector change)

```bash
sha256sum vectors.json | cut -d' ' -f1 > .vectors-checksum
sha256sum SPEC.md | cut -d' ' -f1 > .spec-checksum
git add .vectors-checksum .spec-checksum
git commit -m "Update checksums for spec/vector change"
```

### Updating Test Baselines (after adding tests)

Edit `.test-baselines` and set the new count:
```bash
# After adding tests, run locally to get new count, then update:
sed -i 's/^python=.*/python=130/' .test-baselines
git add .test-baselines
git commit -m "Bump python test baseline to 130"
```

Baselines should only increase. A decrease requires explicit justification (test was genuinely invalid, not just inconvenient).

## Design Decisions Log

| Decision | Rationale |
|----------|-----------|
| Single checksum job for both files | Simpler than two jobs; both checks are instant |
| Baselines in flat file, not CI variables | Versioned in git, reviewable in MRs, no CI admin access needed |
| Kotlin gate only on build-mobile triggers | Kotlin tests require Android SDK (slow); only relevant for kotlin/ changes |
| .test-baselines supersedes QUALITY_PLAN.md numbers | QUALITY_PLAN.md had historical counts (Python=119, JS=83); .test-baselines reflects current reality |
| Go test job uses golang:1.22-alpine | Matches existing build-package image; minimal |
