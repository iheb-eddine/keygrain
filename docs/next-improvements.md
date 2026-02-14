# Keygrain — Next Improvements (Brainstorm Output)

Output from a 3-agent brainstorming session (product_lead, security_expert, ux_designer).

## P0 — Pre-Launch (2 weeks)

| # | Feature | Rationale |
|---|---------|-----------|
| 1 | Rate limiting on backup server | Token bucket: 10 req/min burst, 2/min sustained per lookup_id; 100/min per IP. Prevents brute-force on auth. |
| 2 | Secret fingerprint / visual verification | 4 colored circles from HMAC-SHA256(secret, "keygrain-fingerprint")[0:8]. Prevents #1 user error: wrong secret → wrong passwords. 500ms debounce, domain-separated. |
| 3 | Progressive disclosure | Default form shows only Secret + Email + Generate. Length/Symbols/Salt hidden behind "⚙️ Options". Reduces cognitive load. |
| 4 | Chrome/Firefox store submissions + accessibility | ARIA labels, keyboard nav. Required for store approval. |

## P1 — v1.1 (6 weeks)

| # | Feature | Rationale |
|---|---------|-----------|
| 5 | Onboarding wizard | Skippable, contextual micro-tutorials on first use of each feature. |
| 6 | Site Rules DB | Ed25519 signed JSON, bundled baseline, community submissions. "✓ Optimized for site" indicator. Auto-sets symbols/length per site. |
| 7 | Migration wizard | Import 1Password/Bitwarden/LastPass CSV. Checklist UX, pausable progress. Critical growth lever. |
| 8 | Breach monitoring | HIBP k-anonymity API (opt-in only). Alerts if a derived password appears in breaches. |
| 9 | Secret rotation workflow | Algorithm versioning infrastructure. Allows changing master secret without losing access. |
| 10 | Backup versioning / ETag | SHA-256(blob)[0:16] as ETag. If-Match on PUT, 412 on conflict. Prevents accidental overwrites. |
| 11 | Error message humanization | Replace technical errors with user-friendly messages + suggested actions. |

## P2 — v1.2 (following quarter)

| # | Feature | Rationale |
|---|---------|-----------|
| 12 | Modulo bias fix | Rejection sampling. Bundle with algorithm v2. Only ~2 bits entropy loss — not urgent. |
| 13 | Emergency Access / Shamir | "Emergency Contacts" framing. Choose 3 people, any 2 can help recover. |
| 14 | iOS app | Covers the other half of mobile users. Requires Mac + Apple Developer. |
| 15 | Browser extension hardening | Clipboard countdown timer, fill confirmation dialog. |
| 16 | Security audit | Commission after P1 stabilizes. |

## P3 — Future

| # | Feature | Rationale |
|---|---------|-----------|
| 17 | TOTP integration | Separate encryption domain, clear UX separation from derived passwords. |
| 18 | Team/Family sharing | Requires rotation solved first. |
| 19 | Desktop app (Tauri) | Native desktop experience. |
| 20 | Passkey/WebAuthn bridge | Research only — deterministic ≠ hardware-bound (model mismatch). |

## Key Decisions

- **Modulo bias** is NOT practically exploitable (~2 bits entropy loss) — defer to P2
- **TOTP** deferred to preserve "nothing to breach" brand identity
- **Passkeys** parked — deterministic derivation fundamentally incompatible with hardware-bound keys
- **Migration wizard** elevated to P1 as critical growth lever
- **Accessibility** elevated to P0 for store submission requirements
- **Site Rules DB** must be Ed25519 signed to prevent weakening attacks

## Monetization (at v1.1 launch)

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | Core derivation, extension, 1 backup, fingerprint verification |
| Pro | $2/mo | Breach monitoring, verified site rules, backup versioning |
| Teams | $4/user/mo | Future (after P3 features) |
