# Commit Grouping Plan (Consensus: 21 groups)

Based on distributed agent review (10 agents, adversarial debate, 4+ rounds).

## Principles (from consensus)
- Natural commit messages (not conventional-commits style, except BREAKING)
- Security hardening gets dedicated commits (visible to auditors)
- Breaking algorithm changes get their own commit
- Each group should produce a buildable tree
- Bug fixes absorbed into parent feature unless security-critical
- ~21 groups for 7 months of weekend development = natural cadence

---

## Group 1: Python core library + algorithm spec
**Commits:** 10c5398..ec6b61e (14 commits)
**Message:** `Initial implementation: Python password derivation library with Argon2id strengthening`
**Includes:** Python derive.py, SPEC.md, vectors.json, pip packaging, project-state docs

## Group 2: Android app foundation
**Commits:** ca2771f, 7a22619, 40dbb25, 38b2f0a (+ related mobile fixes)
**Message:** `Android app: Jetpack Compose UI with biometric unlock and service management`

## Group 3: Go sync server + deployment
**Commits:** 1661694..06daf97, 8f57e6e, 6630a50, 16d3ace, 43b3ae5 (server + CI/deploy)
**Message:** `Sync server: Go API with rate limiting, ETag concurrency, and Docker deployment`

## Group 4: Web generator (PWA)
**Commits:** 82e53f5, 3069631, 120e6c3, 91786c1, 89b111c, 734f4dc, 3415f80, 9cfdda6
**Message:** `Web password generator: client-side PWA with offline support`

## Group 5: Browser extension (initial)
**Commits:** 393474a..49958b7 (extension design, implementation, store prep, initial fixes)
**Message:** `Browser extension: Chrome MV3 + Firefox MV2 with encrypted storage and autofill`

## Group 6: Extension features (round 1)
**Commits:** a0002b6..d0c00d1 (rewrite, auto-detect, fill, auto-lock, badge, keyboard, settings)
**Message:** `Extension features: auto-detect site, autofill, PIN lock, badge count, dark mode`

## Group 7: Extension features (round 2)
**Commits:** b102b7a, 84cd55d, f6438da, 3ed8be6e, 2dcd97f, 745f135 (site rules, breach, migrate, edit, context menu)
**Message:** `Migration wizard, breach warnings, site rules, and context menu autofill`

## Group 8: Sync v2 + UX overhaul
**Commits:** 6c8f191..d9f5b76 (sync v2, Argon2id, help, modern UI, logo, in-app help)
**Message:** `Sync protocol v2: Argon2id key strengthening, modern UI, in-app help`

## Group 9: TOTP + SSH key derivation
**Commits:** 4dc112c, 592a5ba, 72b4ad4, 17c61b5, 8c80002 (TOTP + SSH across platforms)
**Message:** `TOTP and SSH key derivation across all platforms`

## Group 10: HD wallet derivation (BIP-39 + BIP-85)
**Commits:** 0d6e1ce (+ wallet-related fixes)
**Message:** `HD wallet derivation: BIP-39 mnemonic and BIP-85 child key support`

## Group 11: BREAKING — Algorithm v2 (site+counter in derivation)
**Commits:** 339cfbf, 4f3b36e, abe1edf (algorithm change + migration + legacy fallback)
**Message:** `BREAKING: algorithm v2 — include site and counter in derivation input`

## Group 12: Rejection sampling (spec v4)
**Commits:** 92a983a, dd279cb, da2cc26, ee5f7d3 (eliminate modulo bias across platforms)
**Message:** `Eliminate modulo bias with rejection sampling (spec v4)`

## Group 13: Security hardening (bug bounty rounds 1-3)
**Commits:** f9e7011, 2bf1f09, 41357c3, 1902656, 662e092, ea29b26, 048a3c7 (security fixes)
**Message:** `Security hardening: fix critical bugs from internal security review`

## Group 14: Android UX overhaul
**Commits:** cf3bd73, d865028..563ac6a (haptic, monospace, overflow menu, sync status, biometric-first, bottom sheet, theme, rotation)
**Message:** `Android UX overhaul: Material 3 polish, biometric-first unlock, bottom sheets`

## Group 15: Android autofill + Credential Manager
**Commits:** 260eaec..2111281 (PSL-aware autofill, email detection, credential provider)
**Message:** `Android Autofill Framework + Credential Manager for Android 14+`

## Group 16: Quality infrastructure + CI gates
**Commits:** bded275, 4d717a2, 196fc56, f0500b7, 4bc3b9e (quality plan, drift vectors, modularize, tests, CI fixes)
**Message:** `Quality infrastructure: CI checksum gates, test baselines, popup modularization`

## Group 17: Sync improvements + dedup
**Commits:** a55b5b0, 936a641, bc1b971, babbac7, 999a32b, acfbf22 (UUIDs, merge fix, dedup)
**Message:** `Sync reliability: client-generated UUIDs, deduplication, conflict resolution`

## Group 18: Website + documentation
**Commits:** 38a6bf9, a3cc7b6..4307479, 07e87b8, 4558118, 20b4ce6 (landing page, guide, compare, changelog, terms, 404, FAQ, docs)
**Message:** `Website: landing page, security docs, getting started guide, comparison page`

## Group 19: Security hardening (bug bounty rounds 4-6)
**Commits:** 21f2b1d, 09c07d7, 0c45e2c, faf3928, 4570f42, 38ebbad (later security rounds)
**Message:** `Security hardening round 2: 60+ bugs fixed across all platforms`

## Group 20: Store submission + Firefox/Chrome fixes
**Commits:** 23de745, 951bdfc, 331dd3a, bbffec2, 00a8630, d5cf212, 025d7e7, 2e16e6b, e91be0e (store prep, AMO fixes, innerHTML)
**Message:** `Extension store submission: Chrome Web Store + Firefox Add-ons`

## Group 21: Version display + final polish
**Commits:** 139a2a4..d8d641e (VERSION files, embed, display, CI validation, version bump, links)
**Message:** `Version display across all platforms, CI validation, v0.9.1 release`

---

## Execution Notes (from reviewer_9)
- Flatten merge commits (do NOT use --rebase-merges)
- Use `git rebase -i --root` with a GIT_SEQUENCE_EDITOR script
- After squash: second rebase pass to assign dates
- After dates: verify each commit builds (pytest, node test, go build)
- Estimated time: 1.5-2.5 hours total
