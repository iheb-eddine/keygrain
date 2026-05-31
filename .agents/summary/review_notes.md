# Keygrain — Documentation Review Notes

## Consistency Check Results

### ✅ Consistent

- All derivation types documented in architecture.md match SPEC.md §14 domain separation table
- Component file listings verified against actual filesystem
- API documentation matches server source code (sync.go endpoints, rate limit defaults)
- Test baselines in codebase_info.md match `.test-baselines` file (python=128, js=85, kotlin=42, go=37)
- CI pipeline stages and job names match `.gitlab-ci.yml`
- Dependency versions verified against `pyproject.toml`, `build.gradle.kts`, `go.mod`
- Platform mapping (Python/JS/Kotlin equivalents) verified by function name cross-reference

### ⚠️ Minor Notes

1. **Web generator**: Documented as a platform in architecture, but it's actually a subset of the server's static files (`server/static/generate/`). It uses its own copy of `hash-wasm-argon2.js` — not the extension's `lib/` copy. This is intentional (PWA independence) but could confuse contributors.

2. **Site rules system**: The extension includes a signed site rules mechanism (`popup-rules.js`, `rules.json`, `server/tools/sign-rules.py`) not deeply covered in the documentation. This is a secondary feature (auto-detects password constraints per site).

3. **Breach feed**: `popup-breach.js` + `server/static/breaches.json` — mentioned in components but not deeply documented. Low-priority feature.

## Completeness Check Results

### ✅ Well Covered

- Core algorithm (all derivation types, domain separation, test vectors)
- Sync protocol (API, encryption, merge strategy, conflict resolution)
- All platform implementations and their equivalents
- CI/CD pipeline and enforcement mechanisms
- Security model and trust boundaries
- Data models for all stored entities

### 📋 Gaps Identified

1. **Static website pages**: The server hosts multiple content pages (security, threat-model, compare, guide, FAQ, migrate, terms, privacy). These are marketing/docs pages, not core functionality, but not documented.

2. **Extension store metadata**: `extension/store/` directory exists with store listing content — not documented (deployment/ops concern only).

3. **Migration wizard internals**: `migrate.js` supports 5 import formats (LastPass, Bitwarden, 1Password, Chrome, Firefox). The parsing logic is complex but only mentioned as a component, not detailed.

4. **BIP-85 relationship**: The Python CLI supports both keygrain-native wallet derivation AND BIP-85 derivation from existing mnemonics. The distinction is in SPEC.md §13.6 but could be clearer in the interface docs.

5. **PublicSuffixList**: The Kotlin autofill uses eTLD+1 matching via a PSL trie. This is well-tested (24 test cases) but the matching logic isn't detailed in the architecture docs.

## Recommendations

1. The existing docs are comprehensive for agent navigation. The identified gaps are low-priority edge cases.
2. For contributors: always read `SPEC.md` first when modifying derivation logic.
3. The `designs/` directory (80+ docs) provides historical context for design decisions — reference when understanding "why" not just "what."
4. `ACCEPTED_LIMITATIONS.md` documents known tradeoffs — check before filing issues.
