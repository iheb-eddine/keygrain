# Algorithm v2 Validation Report

Adversarial validation of the recommendation from `algorithm-v2-brainstorm.md`.

**Formula under review:**
```
message = lowercase(site) + ":" + lowercase(email) + ":" + str(length) + ":" + salt + ":" + str(counter)
```

**Overall verdict: APPROVED.** The algorithm is sound. No breaking flaws found. Several edge cases documented below with mitigations.

---

## Q1: Fresh Device Reconstruction

**Can the user recover all passwords with ONLY: master secret + email + site domains + length?**

**Verdict: YES, if defaults were used.**

With defaults (counter=1, salt="", length=20, symbols=default), the user needs only: master secret + email + site string. This is the core value proposition of deterministic password managers.

**Failure modes (non-default settings):**
- Custom length → must remember per-service length
- Counter > 1 → must remember counter value (but can brute-force: try 1, 2, 3...)
- Non-empty global salt → must remember salt
- Custom symbols → must remember symbol charset (see Q8 below)

**Mitigation:** Backup/sync stores all parameters. Fresh-device-without-backup is the disaster scenario, and the algorithm degrades gracefully — defaults work for most services, counter is brute-forceable.

---

## Q2: "github" vs "github.com"

**Verdict: Real risk, correctly mitigated by the design.**

If user types "github" on one device and "github.com" on another → different passwords. This is the fundamental tradeoff of user-confirmed input vs auto-normalization.

**Why auto-normalization is worse:**
- "accounts.google.com" → "google.com" silently? What about Google Workspace vs personal?
- "www.github.com" → "github.com"? What about subdomains that are genuinely different services?
- Cross-device inconsistency when normalization logic differs between platforms

**Mitigations in the design:**
1. Extension auto-suggests `window.location.hostname` as starting point
2. UI shows site field prominently — user always sees what string is used
3. Backup/sync preserves the service list
4. Lowercase-only normalization (no stripping, no eTLD+1 extraction)

**Same tradeoff as LessPass and Spectre/Master Password.** Proven acceptable in practice.

---

## Q3: Multiple Login Pages (accounts.google.com vs mail.google.com)

**Verdict: Non-issue. User decides.**

The user chooses what string to use:
- Want one password for all Google services? Use "google.com"
- Want separate passwords per subdomain? Use the full hostname

The extension suggests the current hostname but the user edits freely. The display name (not in derivation) can be "Google" while site is "google.com".

**Recommendation:** Extension should make editing the suggested site trivial (pre-selected text, not just appended).

---

## Q4: Non-Website Services (WiFi, laptop PIN)

**Verdict: Works fine.**

The site field accepts any string. Examples: "home-wifi", "laptop-pin", "work-vpn". Since there is no auto-detection for these, the user types deliberately and is more likely to remember.

No issue.

---

## Q5: Separator Collision

**Can `site:email` boundaries be ambiguous due to colon separators?**

**Verdict: No practical collision possible.**

Format: `site:email:length:salt:counter`

Attempted collision:
- site="x:y" email="z@a.com" → "x:y:z@a.com:20::1"
- site="x" email="y:z@a.com" → would need colon in email

**Why collisions are impossible with valid inputs:**
1. **Email cannot contain colons** (RFC 5321 §4.1.2)
2. **Length is always numeric** (integer ≥ 8)
3. **Counter is always numeric** (integer ≥ 1)
4. Therefore the site:email boundary is unambiguous — the first colon followed by a valid email address

**Salt may contain colons** (e.g., salt="my:salt"). This is safe because salt is bounded by numeric fields on both sides (length before, counter after). The parser can identify boundaries unambiguously. More importantly: the string is never parsed — it is fed as an opaque blob to HMAC. Two different logical inputs can only collide if the concatenated string is byte-identical, which requires violating the email RFC.

---

## Q6: Counter vs Salt for Rotation

**Verdict: Counter is the right choice for per-service rotation.**

**Why counter > per-service random salt:**
- Counter has natural ordering: user can try 1, 2, 3... to recover
- Random salt is unrecoverable if forgotten
- Counter is bounded: most users never exceed 2-3
- Counter is human-communicable: "I'm on version 3 of my GitHub password"

**What if user forgets counter?**
- Without backup: try sequentially (1, 2, 3...) — takes seconds
- With backup: stored in service entry

---

## Q7: Extension Auto-Suggest

**Verdict: Yes, suggest hostname. User confirms/edits.**

The design correctly recommends:
1. Auto-fill site field with current hostname
2. Show prominently for user verification
3. Never silently normalize
4. Allow free editing

This matches the UX pattern of LessPass's browser extension.

---

## Q8: Data Model

**Verdict: Correct and minimal.**

```
ServiceEntry {
  name: String        // display label (NOT in derivation)
  site: String        // derivation input (lowercased)
  email: String       // derivation input (lowercased)
  length: Int         // derivation input (default 20)
  symbols: String     // charset parameter (default "!@#$%&*-_=+?")
  counter: Int        // derivation input (default 1)
}

Settings {
  salt: String        // global salt (IN derivation, default "")
}
```

**Note on symbols:** Although symbols is not in the HMAC message string, it IS a derivation parameter in effect — changing symbols changes the password output (different charset → different modulo mapping from the same byte stream). On a fresh device without backup, the user must remember custom symbol sets. The report treats symbols as a "soft derivation parameter."

---

## Additional Edge Cases Found

### E1: Domain Rename (twitter.com → x.com) — HIGH RISK

**Scenario:**
1. User has site="twitter.com" stored
2. Twitter rebrands to x.com
3. Extension suggests "x.com" on the new domain
4. User creates new entry with site="x.com" → different password
5. User updates password on X to the new one
6. Old "twitter.com" entry is orphaned

**The trap:** On a fresh device without backup, user might try "twitter.com" (the domain they originally registered with) and get the old password that no longer works on X.

**This is not an algorithm flaw** — it is an inherent limitation of user-confirmed input that applies to all deterministic password managers.

**Mitigations:**
- Keep old entries with a note (display name: "Twitter (old, now x.com)")
- Backup/sync preserves history
- The site-rules-db design could maintain a domain-rename registry to warn users

### E2: Two Accounts, Same Site + Same Email

**Scenario:** User has two accounts on the same site with the same email (some sites allow this). Site + email are identical → same password for both.

**Resolution:** Counter serves double duty — both rotation AND multi-account disambiguation. User sets counter=1 for first account, counter=2 for second.

**UX concern:** This is not obvious. The UI should make counter's multi-account use discoverable (tooltip, help text, or a "multiple accounts?" prompt).

### E3: Global Salt Change — FOOTGUN

**Scenario:**
1. User changes global salt (e.g., "" → "2024")
2. ALL passwords change simultaneously
3. User must update passwords on ALL services
4. If they update 30/50 services and lose track → some services have old password, some have new
5. Cannot easily revert without remembering old salt

**Risk level: HIGH.** This is a catastrophic UX failure mode.

**Required guardrails:**
- Confirmation dialog: "This will change ALL your passwords. You must update every service."
- Store previous salt value so user can temporarily switch back
- Mark as "Advanced" / hide behind settings
- Consider showing a checklist of services that need updating

### E4: Symbols as Soft Derivation Parameter

**Scenario:** User customizes symbols from "!@#$%&*-_=+?" to "!@#" for a site that restricts special characters. On a fresh device without backup, they must remember this custom set.

**Impact:** Lower than other parameters because:
- Most users keep defaults
- Sites that restrict symbols are memorable ("that annoying bank site")
- The default symbol set is documented and stable

**Mitigation:** The site-rules-db design already addresses this — known site restrictions can be auto-applied.

---

## Comparison with Prior Art

| Feature | Keygrain v2 | LessPass | Spectre/Master Password |
|---------|-------------|----------|------------------------|
| Site identifier | User-confirmed string | User-typed "site" field | User-typed "site name" |
| Normalization | Lowercase only | None | Lowercase only |
| Rotation | Counter (per-service) | Counter | Counter |
| Global rotation | Salt | N/A | N/A |
| Display name | Separate from site | N/A | N/A |
| Auto-suggest | Extension suggests hostname | Extension suggests hostname | N/A (no extension) |

The design aligns with proven approaches and adds the display-name separation (an improvement over LessPass where renaming changes the password).

---

## Final Verdict

**APPROVED.** Algorithm v2 (Option B) is the correct choice. The design:

1. Solves the critical flaw (service not in derivation)
2. Maintains reconstructability on fresh devices
3. Makes the right tradeoff (user-confirmed > auto-normalized)
4. Handles rotation cleanly (counter for per-service, salt for global)
5. Has no practical collision risk
6. Matches proven approaches (LessPass, Spectre)

**Action items for implementation:**
- Document E1 (domain rename) in user-facing help
- Make counter's multi-account use discoverable in UI
- Add UX guardrails for global salt change
- Treat symbols as a soft derivation parameter in documentation
