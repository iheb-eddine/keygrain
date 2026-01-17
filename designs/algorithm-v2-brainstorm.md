# Algorithm v2: Service-Unique Password Derivation

## Problem

Current derivation: `message = lowercase(email) + ":" + str(length) + ":" + salt`

The service name is NOT in the derivation. Two services with the same email, length, and salt produce identical passwords. This is a critical flaw.

## Constraints

1. The identifier must be something the user can remember/reconstruct on a fresh device
2. It must not change accidentally (typo-resistant)
3. It must be different per service
4. Hidden IDs won't work (fresh install can't regenerate without stored IDs)
5. Breaking changes are acceptable (no users yet)

## Options Analyzed

### Option A: Normalized domain in HMAC input

```
message = normalize(domain) + ":" + lowercase(email) + ":" + str(length) + ":" + salt
```

**Pros:** Natural, memorable, reconstructable.

**Cons:** Normalization ambiguity. "github.com" vs "www.github.com" vs "accounts.google.com" — which is canonical? Auto-normalization creates hidden state the user can't predict.

**Failure scenario:** User adds "gmail.com" on phone, extension auto-detects "mail.google.com" on desktop → different passwords.

**Verdict:** Direction is right, but auto-normalization is dangerous.

### Option B: User-confirmed site field (RECOMMENDED)

```
message = lowercase(site) + ":" + lowercase(email) + ":" + str(length) + ":" + salt + ":" + str(counter)
```

The `name` field is a display label only. A `site` field is the derivation input — whatever string the user confirms. Normalization is lowercase only.

**Pros:** Simple, predictable, no hidden state. User knows exactly what string is used. Proven model (LessPass, Spectre use the same approach).

**Cons:** User must remember what they typed. Mitigated by UI prominence, extension suggestions, and backup/sync.

**Verdict:** Best option. See detailed design below.

### Option C: Per-service unique salt

Each service gets a unique auto-generated salt.

**Pros:** No algorithm change needed.

**Cons:** Defeats keygrain's core value proposition. On a fresh device with no backup, passwords are unrecoverable. Contradicts the "no storage needed" design goal.

**Verdict:** Rejected. Fundamentally incompatible with keygrain's philosophy.

### Option D: Domain as default salt

```
effective_salt = salt if salt != "" else normalized_domain
```

**Pros:** Backward-compatible.

**Cons:** Conflates two concepts. Confusing semantics (what if user sets salt AND has a domain?). "Backward compatible" is irrelevant with no users.

**Verdict:** Rejected. No advantage over Option B, adds confusion.

## Recommended Design: Option B

### Derivation Formula

```
message = lowercase(site) + ":" + lowercase(email) + ":" + str(length) + ":" + salt + ":" + str(counter)
key = HMAC-SHA256(secret, message)
stream = key || HMAC-SHA256(key, 0x01) || HMAC-SHA256(key, 0x02) || ...
```

The rest of the algorithm (forced categories, fill, Fisher-Yates shuffle) remains unchanged.

### Fields

| Field | In derivation | Scope | Default | Purpose |
|-------|--------------|-------|---------|---------|
| `site` | YES | per-service | (required) | Service identifier — user-confirmed string |
| `email` | YES | per-service | (required) | Login identity |
| `length` | YES | per-service | 20 | Password length |
| `salt` | YES | global | "" | Global pepper / generation marker |
| `counter` | YES | per-service | 1 | Per-service rotation counter |
| `name` | NO | per-service | (optional) | Display label in UI |
| `symbols` | NO (affects charset) | per-service | "!@#$%&*-_=+?" | Symbol charset |

### Data Model

```
ServiceEntry {
  name: String        // display label (NOT in derivation)
  site: String        // user-confirmed identifier (IN derivation, lowercased)
  email: String       // login identity (IN derivation, lowercased)
  length: Int         // password length (IN derivation, default 20, min 8)
  symbols: String     // symbol charset (affects output, default "!@#$%&*-_=+?")
  counter: Int        // rotation counter (IN derivation, default 1)
}

Settings {
  salt: String        // global salt (IN derivation, default "")
  ...
}
```

### Site Field Rules

- **Normalization:** Lowercase only. No stripping of www, protocols, or paths.
- **Input:** User-confirmed. The extension/app may *suggest* the current hostname, but the user sees and confirms the exact value.
- **UI:** The site value must be shown prominently, not hidden. The user must always know what string is being used.
- **Non-domain use:** The site field accepts any string. For services without a domain (WiFi, local apps), the user enters a memorable identifier like "home-wifi".

### Salt vs Counter (Rotation)

Two distinct rotation mechanisms:

- **Global salt** (in settings): Change it to rotate ALL passwords at once. Useful as a generation marker. Stored once, applies to all services.
- **Per-service counter** (default 1): Increment when a single service's password is compromised. User goes from 1 → 2 → 3 etc.

### Uniqueness Guarantees

Each component ensures uniqueness along a different axis:

| Same site + different email | → different password (email in derivation) |
| Same email + different site | → different password (site in derivation) |
| Same site + same email + different counter | → different password (counter in derivation) |
| Everything same + different global salt | → different password (salt in derivation) |
| Everything same + different length | → different password (length in derivation) |

### Separator Safety

The message uses colon separators: `site:email:length:salt:counter`. Theoretical collision risk if `site` contains colons (e.g., "localhost:8080"). This is safe because:

- The HMAC input is a single concatenated string — there is no parsing step
- Two inputs collide only if the entire concatenated string is identical
- Emails cannot contain colons (RFC 5321)
- Length and counter are always numeric
- A contrived collision would require e.g. site="a:user@x.com:20::1" with empty email — not a realistic scenario

### Backward Compatibility

**Clean break.** No users exist yet (app pending store submission, extension in testing). No migration path needed. All test vectors will be regenerated for the new formula.

### Tradeoffs Accepted

**User must remember their site string.** This is the inherent tradeoff of user-confirmed input vs auto-normalization. Mitigated by:

1. UI shows site prominently at all times
2. Extension suggests current hostname as starting point
3. Backup/sync preserves the service list
4. The site is typically just the domain where the user logs in — natural to remember

This is the same tradeoff every deterministic password manager (LessPass, Spectre/Master Password) makes. The alternative (auto-normalization) creates worse problems: hidden state, subdomain ambiguity, cross-device inconsistency.
