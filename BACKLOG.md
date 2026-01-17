# Keygrain Backlog — Prioritized

Consolidated from 2 brainstorm sessions (product + UX, 6 agents total).

## Tier 0: Foundation (must ship before anything else)

| # | Item | Effort | Status |
|---|------|--------|--------|
| 0.1 | Clipboard auto-clear (30s) | XS | ✅ Already existed |
| 0.2 | Visible focus styles (fix outline:none) | XS | ✅ Done |
| 0.3 | ARIA labels on icon buttons | S | ✅ Done |
| 0.4 | Focus management + ARIA on dialogs | S | ✅ Done |
| 0.5 | Secret confirmation on setup | S | ✅ Done |
| 0.6 | Global salt warning/confirmation | S | ✅ Done |

## Tier 1: Core Quality (next sprint)

| # | Item | Effort | Status |
|---|------|--------|--------|
| 1.1 | Rename "Counter" → "Password version" | XS | ✅ Done |
| 1.2 | One-line explanation on lock screen | XS | ✅ Done |
| 1.3 | Autofill username + password | M | ✅ Done |
| 1.4 | Auto-lock warning (60s before) | S | ✅ Done |
| 1.5 | Invisible sync (auto on unlock/change) | M | ✅ Done |

## Tier 2: Growth (ship to stores)

| # | Item | Effort | Status |
|---|------|--------|--------|
| 2.1 | Extension store submission (Chrome + Firefox) | M | ✅ Prep done (manifests, listing, privacy) |
| 2.2 | ~~Algorithm versioning infrastructure~~ | — | ❌ Skipped (no users, broke directly) |
| 2.3 | ~~Argon2id default for new users~~ | — | ✅ Done (mandatory, no flag) |
| 2.4 | Hide salt from UI | S | ✅ Done (salt removed entirely) |
| 2.5 | Hide counter behind "Rotate password" | S | ✅ Done |

## Breaking Changes Made (no users)

| Change | Impact |
|--------|--------|
| Salt removed from derivation | HMAC message: `site:email:length:counter` (was `site:email:length:salt:counter`) |
| Argon2id mandatory | All derivations use `Argon2id(secret, "keygrain-strengthen:"+email, 64MiB/3iter/p1)` → strengthened key |
| Migration code removed | No fallback to /api/backup/ |
| /api/backup/ endpoint deleted | Server only has /api/sync/ |

## Tier 3: Power Features

| # | Item | Effort | Status |
|---|------|--------|--------|
| 3.1 | Fuzzy search + frecency | M | ✅ Done |
| 3.2 | Global shortcut (Ctrl+Shift+K) | M | ✅ Done |
| 3.3 | PIN/biometric unlock for extension | L | ✅ Done |
| 3.4 | Background auto-sync | S | ✅ Done |
| 3.5 | Bulk counter increment | S | ✅ Done |

## Tier 4: Expansion (post-v1.2)

| # | Item | Effort | Status |
|---|------|--------|--------|
| 4.1 | Site Rules DB (Ed25519 signed) | L | ✅ Done |
| 4.2 | Shadow migration mode | L | ✅ Done |
| 4.3 | Landing page + public threat model | M | ✅ Done |
| 4.4 | Demo mode | M | ✅ Done |
| 4.5 | PyPI publication | M | Pending |
| 4.6 | iOS app | XL | Pending |
| 4.7 | Shamir Secret Sharing recovery | L | Pending |

## Implementation Order (starting now)

Starting with Tier 0 items (all small, high-impact, parallelizable):
1. 0.1 Clipboard auto-clear
2. 0.2 Visible focus styles
3. 0.3 ARIA labels
4. 0.4 Dialog focus management
5. 0.5 Secret confirmation
6. 0.6 Salt warning

Then Tier 1 items in order.
