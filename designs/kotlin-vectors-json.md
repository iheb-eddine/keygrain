# Design: Refactor KeygrainTest.kt to Read from vectors.json

## Frozen Requirements

1. `testStrengthenVectors` MUST read from `vectors.json` → `strengthen_vectors[]` instead of hardcoded data.
2. `testAllVectors` MUST read from `vectors.json` → `vectors[]` instead of hardcoded data.
3. JSON loading MUST use `File("../../vectors.json")` and `org.json.JSONObject` — the established pattern.
4. JSON field access MUST use snake_case keys matching vectors.json: `secret_hex`, `email`, `expected_hex`, `site`, `length`, `symbols`, `counter`, `expected`.
5. All vectors in the JSON arrays MUST be tested — no filtering or skipping.
6. If vectors.json is updated (vectors added/modified/removed), Kotlin tests automatically reflect the change on next run.
7. Hardcoded `Vector` and `StrengthenVector` data classes and their inline lists MUST be removed.
8. `hexToBytes` and `bytesToHex` helper functions MUST be retained.

## Invariants

1. Behavioral tests (`testDeterministic`, `testCaseInsensitiveEmail`, `testCaseInsensitiveSite`, `testDifferentSiteDifferentOutput`, `testMinLengthRejected`, `testEmptySymbolsRejected`, `testEmptySiteRejected`) remain unchanged.
2. Test assertions use the same format: `assertEquals` with a descriptive failure message identifying the failing vector.
3. `Keygrain.clearStrengthenCache()` is called before each vector (same as current behavior).
4. The test file remains in the same package and location.
5. No new dependencies — `org.json.JSONObject` and `java.io.File` are already available (used by sibling tests).

## Scope Boundary

### In Scope
- Replace hardcoded strengthen vectors with JSON-driven iteration over `strengthen_vectors[]`.
- Replace hardcoded password vectors with JSON-driven iteration over `vectors[]`.
- Remove `Vector` and `StrengthenVector` data classes.
- Add a `loadVectors()` helper (private, returns `JSONObject`) following the TotpEngineTest pattern.

### Out of Scope
- **Fingerprint vectors:** `fingerprint_vectors[]` exists in vectors.json but KeygrainTest.kt does not currently test fingerprints. Adding fingerprint test coverage is a separate follow-up task.
- **Behavioral tests:** No changes to non-vector-driven tests.
- **Test infrastructure:** No new test framework, parameterized test runner, or build changes.
- **vectors.json modifications:** The JSON file is not modified.

## Test Plan

### Verification Strategy

1. **Run `./gradlew test` from `kotlin/`** — all existing tests must pass with zero failures.
2. **Vector count check:** `testStrengthenVectors` iterates exactly `strengthen_vectors.length()` vectors (currently 3). `testAllVectors` iterates exactly `vectors.length()` vectors (currently 9). If vectors.json gains entries, the test automatically covers them.
3. **Drift elimination proof:** Temporarily modify one `expected` value in vectors.json → confirm the Kotlin test fails → revert. This proves the test reads from the file, not from stale hardcoded data.
4. **Failure message quality:** Each assertion message must identify the failing vector (e.g., include site, email, counter for password vectors; email for strengthen vectors).

### Regression Risks

| Risk | Mitigation |
|------|-----------|
| Relative path breaks in CI | Same pattern works for TotpEngineTest/SshEngineTest/WalletEngineTest in CI already |
| JSON parse error on malformed file | Test fails loudly with exception — acceptable (same as other tests) |
| Field name mismatch | Design specifies exact snake_case keys; implementation must match |
