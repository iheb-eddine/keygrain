# Keygrain Glossary & Documentation Governance

This document defines canonical terminology, banned language, approved security claims, tone guidelines, and disclosure layers for all Keygrain documentation.

All documentation (pages, READMEs, comments, marketing copy) MUST conform to this standard.

---

## Canonical Terminology

Use these terms exactly. Do not invent synonyms.

| Term | Definition | Notes |
|------|-----------|-------|
| **master secret** | The user's passphrase or high-entropy input that seeds all derivations | Never "master password" (confusable with per-site passwords) |
| **strengthened key** | The 32-byte output of Argon2id applied to the master secret | Never "derived key" (too generic) |
| **key strengthening** | The Argon2id process that converts a master secret into a strengthened key | "Key stretching" is acceptable in casual context. Never "hashing" alone. |
| **service** | A saved site configuration (site + email + parameters) | The unit of data in the encrypted blob |
| **site** | The domain or identifier that scopes a password derivation | `github.com`, `home-wifi` — normalized per SPEC §10.2 |
| **derived password** | The deterministic password output for a given set of inputs | Never "generated password" (implies randomness) |
| **visual fingerprint** | The 4-color indicator derived from the raw secret for verification | Uses Wong colorblind-safe palette |
| **encrypted blob** | The AES-256-GCM ciphertext containing all service configurations | What the sync server stores |
| **PIN** | A short numeric secret (4–8 digits) used for quick unlock on trusted devices | NOT the master secret — distinct security tier |
| **migration wizard** | The UI flow that guides users from another password manager to Keygrain | Import from LastPass, Bitwarden, 1Password, Chrome, Firefox |
| **counter** | Per-site integer (≥1) that enables password rotation without changing other inputs | Incrementing produces an uncorrelated new password |
| **lookup ID** | Hex-encoded HMAC output used as the user's pseudonymous server identity | Not linkable to email without the strengthened key |

---

## Banned Terms

These terms MUST NOT appear in any Keygrain documentation.

| Banned Term | Reason | Approved Alternative |
|-------------|--------|---------------------|
| **zero-knowledge** | Technically inaccurate — the server sees metadata (service count, timestamps, blob size) | "The server never sees plaintext passwords or service names" |
| **military-grade** | Meaningless marketing term with no technical content | Name the specific algorithm: "AES-256-GCM", "Argon2id (64 MiB, 3 iterations)" |
| **unhackable** | Dishonest — no system is unhackable; violates honest-limitations principle | "Designed to resist [specific attack class]" with cited parameters |
| **stored nowhere** | Misleading — service configurations ARE stored (encrypted). Only passwords are derived. | "Passwords are derived on demand, not stored" |
| **bank-level security** | Same problem as "military-grade" — vague appeal to authority | Cite specific properties |
| **impossible to crack** | Absolute claim that ignores weak-secret scenarios | "Costs ~1s per guess with Argon2id (64 MiB)" |
| **trustless** | Overloaded term; Keygrain does require trust in the local device | "The server is untrusted for content" |

---

## Security Claims Registry

Every security claim used in documentation MUST appear in this registry with its SPEC.md evidence. Claims not in this table are unauthorized.

| Claim | SPEC.md Evidence | Allowed Layers |
|-------|-----------------|----------------|
| Argon2id makes each guess cost ~1 second on consumer hardware | §3.1: m=65536 KiB, t=3, p=1 | All |
| Email in salt prevents multi-target amortization | §3.1: salt = "keygrain-strengthen:" + email | Overview, Technical, Spec |
| Knowing one password does not reveal other passwords | §9: "HMAC prevents deriving the strengthened key or other passwords from one output" | All |
| Passwords always contain uppercase, lowercase, digit, and symbol | §4.4 Step 1: forced categories | All |
| Same inputs produce identical output on any platform | §9: Determinism guarantee; §8: cross-platform test vectors | All |
| Sync data is encrypted with AES-256-GCM | §6.3: encryption_key = HMAC-SHA256(strengthened, email + ":keygrain-encryption") | All |
| Server cannot decrypt service configurations | Architecture §4.1: encryption key never leaves client | All |
| Character selection is unbiased (no modular bias) | §4.4: rejection sampling with limit = floor(256/n)*n | Technical, Spec |
| Domain separation prevents cross-derivation | §14: unique message suffixes per derivation type | Technical, Spec |
| A 4-digit PIN is exhaustible in ~3 hours | §9.1: 10⁴ candidates × ~1s/guess | All (limitations context only) |
| Compromised device defeats all protection | §9.1: "If an attacker extracts the raw secret from memory, strengthening provides no protection" | All (limitations context only) |

### Registry Rules

1. **Adding a claim:** Cite the exact SPEC.md section. Get peer review before merging.
2. **Removing a claim:** Document why in the commit message. Never silently remove.
3. **Modifying wording:** The new wording must still be supported by the cited evidence.
4. **Layer restrictions:** Some claims are too technical for landing pages. Respect the allowed layers.

---

## Tone Guidelines

**Voice:** Calm expert friend.

You are a senior engineer explaining your system to a peer over coffee. You are confident because you did the work. You are honest because you respect your audience. You never hedge, never hype.

### Principles

- **Confident, not boastful.** State facts directly. "Argon2id costs ~1s per guess" not "Keygrain uses cutting-edge technology."
- **Honest, not defensive.** Limitations are stated plainly, not buried or qualified into irrelevance. "If your secret is weak, Argon2id buys time, not safety."
- **Precise, not pedantic.** Use exact numbers where they matter. Round where precision adds noise.
- **Active voice.** "Keygrain derives passwords" not "passwords are derived by Keygrain."
- **Second person for the user.** "Your secret" not "the user's secret."
- **No hedging words.** Ban: "arguably", "it should be noted that", "it is worth mentioning", "relatively", "fairly".
- **No marketing superlatives.** Ban: "revolutionary", "next-generation", "industry-leading", "best-in-class".

---

## Callout Types

Use these four callout types consistently across all documentation:

| Type | Purpose | Example context |
|------|---------|-----------------|
| **TIP** | Helpful advice that improves the user experience | "TIP: Use 6+ random words for your master secret" |
| **WARNING** | Something that could cause data loss or confusion if ignored | "WARNING: Forgetting your master secret means permanent loss of all passwords" |
| **SECURITY** | Security-relevant information the reader must understand | "SECURITY: A 4-digit PIN is brute-forceable in ~3 hours" |
| **NOTE** | Additional context that is not critical but aids understanding | "NOTE: Email is lowercased before use — case does not matter" |

### Formatting

In Markdown:
```
> **TIP:** Content here.

> **WARNING:** Content here.

> **SECURITY:** Content here.

> **NOTE:** Content here.
```

In HTML pages: use the appropriate styled element consistent with the site design.

---

## Progressive Disclosure Layers

Documentation is organized into four layers of increasing detail. Each layer has a target audience and an appropriate level of technical depth.

| Layer | Audience | Depth | Examples |
|-------|----------|-------|----------|
| **Landing** | Anyone evaluating Keygrain in 30 seconds | One-sentence claims with no jargon | Homepage hero, comparison table headers |
| **Overview** | Developers deciding whether to adopt | How it works conceptually, security properties, trade-offs | /security page, /compare page, README |
| **Technical** | Developers integrating or auditing | Architecture, trust boundaries, protocol details | /threat-model, docs/architecture.md |
| **Specification** | Implementors producing compatible code | Exact algorithms, test vectors, byte-level formats | SPEC.md, vectors.json |

### Layer Rules

1. Each layer links downward ("See /threat-model for details" or "See SPEC.md §3").
2. Never force a reader to go deeper than they need. Each layer must be self-contained for its audience.
3. Security claims at the Landing layer must be registerable in the Claims Registry.
4. The Specification layer is the source of truth. All other layers derive from it.
