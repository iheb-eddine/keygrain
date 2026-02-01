# Candidate Assessment: Keygrain Fixes & Improvements

**Date:** 2026-05-11
**Status:** Final

---

## Priority 1: Modulo Bias Fix — DO IT

**What:** Password derivation uses `byte % charset_length` which has modulo bias. Fix with rejection sampling.

**Real value:** Negligible security impact. Actual entropy loss is **0.13 bits** for a 20-character password with default charset (67 chars):
- Full charset (67): `256 mod 67 = 55`. First 55 chars get P=4/256, last 12 get P=3/256.
- Entropy loss per character: 0.0077 bits.
- Over all positions (16 fill + 4 forced): total loss = 0.126 bits.
- Effective entropy: 112.62 bits vs ideal 112.75 bits.

This is **not a security improvement** — it's algorithmic hygiene. The reason to do it: there are no users yet, so this is the one free opportunity to make the algorithm clean before it becomes a permanent breaking change.

**Effort:** Low. ~20 lines changed per implementation (Python reference, Chrome ext, Firefox ext). The real work is updating test vectors in SPEC.md, `vectors.json`, and all test suites across platforms.

**Risk:** Zero user impact (no users). Coordination risk across implementations is manageable since all share the same test vectors.

**Breaking change:** Yes — all generated passwords change. Acceptable only because there are no users.

---

## Priority 2: PyPI Publication — DO IT

**What:** Make `pip install keygrain` work. Package structure exists but isn't published.

**Real value:** High for adoption. The standard discovery path for Python CLI tools. Without this, the tool is invisible to the Python ecosystem.

**Effort:** Very low. `pyproject.toml` already defines name, version, dependencies, and entry point. Steps: (1) clean up `setup.cfg`/`pyproject.toml` inconsistency (setup.cfg is missing `cryptography` dependency), (2) add classifiers and long description, (3) `python -m build && twine upload`.

**Risk:** Near zero. Publishing doesn't change code. Only concern: name availability on PyPI (unlikely conflict for "keygrain").

**Note:** `setup.cfg` and `pyproject.toml` have duplicate metadata. The `setup.cfg` omits the `cryptography>=42.0.0` dependency present in `pyproject.toml`. Must reconcile before publishing (recommend dropping `setup.cfg` in favor of `pyproject.toml` only).

---

## Priority 3: Extension Store Submission — DO IT

**What:** Submit to Chrome Web Store and Firefox Add-ons. Manifests exist for both platforms.

**Real value:** High for adoption. Chrome requires Web Store for non-developer installs. Without store presence, the extension is unusable by normal users.

**Effort:** Medium. Code is ready. Administrative overhead: developer accounts ($5 Chrome, free Firefox), screenshots, store descriptions, privacy policy, passing review.

**Risk:** Low technical risk. Store review may flag permissions or require minor manifest adjustments. Privacy policy is a hard requirement.

---

## Priority 4: ccTLD Auto-Detect — SKIP

**What:** `parts.slice(-2)` in popup.js:888 extracts `co.uk` instead of `google.co.uk` for multi-part TLDs.

**Real value:** Low. Only affects the auto-detect convenience in popup search bar. Does NOT affect password derivation (uses stored site string). Fuzzy search still works — user types "google" and finds it.

**Effort:** High. Proper fix requires Public Suffix List (~200KB data or network dependency). Hardcoded ccTLD lists go stale and are incomplete.

**Risk:** PSL dependency bloats extension. Network-fetched PSL adds failure mode. Hardcoded list requires ongoing maintenance.

**Already documented:** ACCEPTED_LIMITATIONS.md #7. Workaround (fuzzy search) is adequate.

---

## Priority 5: Popup/Background Sync Race Condition — SKIP

**What:** Popup and background script can both trigger `syncWithServer` simultaneously.

**Real value:** Negligible. Analysis of actual code shows multiple mitigations already in place:
- `background.js`: `bgSyncInProgress` flag prevents concurrent background syncs.
- `popup.js`: `syncInProgress` flag prevents concurrent popup syncs.
- `popup.js`: `syncGeneration` counter (line 89) — after sync returns, checks `if (syncGeneration !== gen) return;` and discards stale results.
- Both sync paths merge the same server data with the same local data, producing identical results.

Worst case: one wasted HTTP request. No data loss, no corruption.

**Effort:** Medium. Requires message passing between popup and service worker. Service worker lifecycle (can terminate at any time) makes coordination tricky.

**Risk:** The fix itself is more likely to introduce bugs (service worker termination during coordination) than the current "bug" is to cause problems.

**Already documented:** ACCEPTED_LIMITATIONS.md #5.

---

## Summary

| # | Candidate | Verdict | Rationale |
|---|-----------|---------|-----------|
| 1 | Modulo bias fix | **Do it** | Free breaking change window (no users). Algorithmic hygiene. |
| 2 | PyPI publication | **Do it** | Near-zero effort, high adoption value. |
| 3 | Extension store submission | **Do it** | Required for real users. |
| 4 | ccTLD auto-detect | **Skip** | Disproportionate effort, adequate workaround exists. |
| 5 | Sync race condition | **Skip** | Harmless in practice, fix is riskier than the bug. |
