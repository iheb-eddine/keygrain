# Keygrain — Documentation Index

> **For AI Assistants:** This file is the primary entry point for understanding the keygrain codebase. Read this file first — it contains summaries and pointers to detailed documentation. Only read the linked files when you need deeper information on a specific topic.

## Quick Reference

**What is Keygrain?** A deterministic password/credential derivation tool. Same inputs → same output. No vault needed.

**Key invariant:** All platforms (Python, JavaScript, Kotlin) produce byte-identical output for the same inputs. This is enforced by shared test vectors and CI.

**Algorithm:** Argon2id strengthen → HMAC-SHA256 stream → rejection sampling → Fisher-Yates shuffle

**Authoritative spec:** `SPEC.md` (root) — complete, self-contained algorithm specification.

---

## Documentation Map

| File | Contains | Read when... |
|------|----------|-------------|
| [architecture.md](architecture.md) | System design, security boundaries, derivation pipeline, domain separation | Understanding how components fit together or security model |
| [components.md](components.md) | Per-file responsibilities for all platforms, component relationships | Finding which file to modify for a feature |
| [interfaces.md](interfaces.md) | Sync API endpoints, Python/JS/Kotlin function signatures, CLI interface, error handling patterns | Building integrations, understanding API contracts, error handling |
| [data_models.md](data_models.md) | Service entries, sync blob format, wallet entries, rate limiter state | Understanding data storage or sync protocol |
| [workflows.md](workflows.md) | Derivation flow, sync flow, autofill flow, CI pipeline, deployment | Understanding end-to-end processes |
| [dependencies.md](dependencies.md) | All external deps per platform, build tools, infrastructure | Adding dependencies or troubleshooting builds |
| [developer_workflows.md](developer_workflows.md) | Step-by-step procedures: adding derivation types, test vectors, sync protocol changes, new platforms, server deployment | Following a specific development workflow end-to-end |
| [codebase_info.md](codebase_info.md) | Languages, platforms, test baselines, CI jobs, hosting | Quick factual reference |

---

## Key Concepts

### Derivation Types (all use same strengthened key, different HMAC messages)

| Type | Spec section | Use case |
|------|-------------|----------|
| Password | SPEC §4 | Primary feature — unique password per site |
| TOTP seed | SPEC §11 | Self-hosted 2FA without storing seeds |
| SSH key | SPEC §12 | Ed25519 keypairs from secret |
| Wallet | SPEC §13 | BIP-39 mnemonics for disaster recovery |
| Auth credentials | SPEC §6 | Stateless server authentication |
| Fingerprint | SPEC §7 | Visual confirmation of correct secret |

### Platform Mapping

| Feature | Python file | JS file | Kotlin file |
|---------|-------------|---------|-------------|
| Core derivation | `derive.py` | `keygrain.js` | `Keygrain.kt` |
| TOTP | `totp.py` | `totp.js` | `TotpEngine.kt` |
| SSH | `ssh.py` | `ssh.js` | `SshEngine.kt` |
| Wallet | `wallet.py` | `wallet.js` | `WalletEngine.kt` |
| Sync client | — | `sync.js` | `SyncManager.kt` |
| Sync server | — | — | `server/sync.go` |

### Cross-Platform Testing

All implementations must pass identical test vectors. CI enforces:
1. Checksum gate prevents vector file modification without updating checksums
2. Each platform runs its own test suite with baseline enforcement
3. Cross-platform job runs Python + Node.js derivation and diffs output

---

## Common Tasks Guide

| Task | Start here |
|------|-----------|
| Add new derivation type | [developer_workflows.md](developer_workflows.md) §1, then `SPEC.md` §14 |
| Fix a derivation bug | Check `vectors.json` — if vector exists, all platforms must match |
| Add extension feature | `extension/shared/popup.js` (UI), plus platform manifests |
| Modify sync protocol | [developer_workflows.md](developer_workflows.md) §3, then `API.md` |
| Update CI | `.gitlab-ci.yml`, may need `.test-baselines` update |
| Deploy server | [developer_workflows.md](developer_workflows.md) §5 |
| Add a test | [developer_workflows.md](developer_workflows.md) §2 |
| Android UI change | `kotlin/.../ui/screens/MainScreen.kt` (main), `OnboardingScreen.kt` (wizard) |
| Understand error handling | [interfaces.md](interfaces.md) — Error Handling Patterns section |

---

## Important Files (Root)

| File | Purpose |
|------|---------|
| `SPEC.md` | Authoritative algorithm specification (v4) |
| `API.md` | Sync API reference |
| `vectors.json` | Password derivation test vectors |
| `totp-vectors.json` | TOTP test vectors |
| `ssh-vectors.json` | SSH test vectors |
| `wallet-vectors.json` | Wallet test vectors |
| `.gitlab-ci.yml` | CI/CD pipeline definition |
| `.test-baselines` | Minimum test counts (python=128, js=85, kotlin=42, go=37) |
| `README.md` | User-facing project overview |
| `ACCEPTED_LIMITATIONS.md` | Known limitations with rationale |
| `designs/` | 80+ design documents for features |
