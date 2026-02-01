# Design: Documentation Fixes — SPEC.md & ACCEPTED_LIMITATIONS.md

## Fix 1: SPEC.md line 134 — Off-by-one in pseudocode

**File:** `SPEC.md`, Step 2 of §4.4 (around line 131–133)

**Current text:**
```
full_charset = UPPER + LOWER + DIGITS + symbols
for i in 0..(length - 5):
    chars[4 + i] = full_charset[unbiased_index(LENGTH(full_charset))]
```

**Replacement:**
```
full_charset = UPPER + LOWER + DIGITS + symbols
for i = 0, 1, ..., length - 5:
    chars[4 + i] = full_charset[unbiased_index(LENGTH(full_charset))]
```

**Rationale:** Step 1 places 4 characters at indices 0–3. Remaining positions = length − 4. The loop variable `i` takes values 0 through length−5 inclusive (length−4 iterations), filling indices 4 through length−1. The enumeration notation is unambiguous — no range convention needed.

---

## Fix 2: ACCEPTED_LIMITATIONS.md §3 — Modulo bias (RESOLVED in v4)

**File:** `ACCEPTED_LIMITATIONS.md`, section 3

**Current text:**
```
## 3. Modulo Bias in Password Generation (~1-2 bits)

**Issue:** Character selection uses `byte % charset_length`. For 67-char charset, first 55 chars are ~0.4% more likely. Reduces effective entropy by ~1-2 bits over 20 characters.

**Why accepted:** 121 bits is still astronomically secure. Fixing with rejection sampling would change all generated passwords (breaking change) for negligible security gain. Bias is identical across all 3 platforms.
```

**Replacement:**
```
## 3. ~~Modulo Bias in Password Generation~~ [RESOLVED in v4]

**Status:** RESOLVED. Password generation now uses rejection sampling (unbiased_index), eliminating modulo bias entirely.

**Original issue:** Character selection used `byte % charset_length`, reducing effective entropy by ~1-2 bits over 20 characters.
```

---

## Fix 3: ACCEPTED_LIMITATIONS.md §6 — Single-byte counter (RESOLVED in v4)

**File:** `ACCEPTED_LIMITATIONS.md`, section 6

**Current text:**
```
## 6. Stream Counter Overflow at Password Length > 4096

**Issue:** HMAC stream extension uses single-byte counter. Wraps at 256, producing duplicate blocks for passwords > 4096 characters.

**Why accepted:** No real-world password is 4096+ characters. Maximum practical length is ~128. Adding multi-byte counter would change all generated passwords (breaking change) for a non-existent use case.
```

**Replacement:**
```
## 6. ~~Stream Counter Overflow at Password Length > 4096~~ [RESOLVED in v4]

**Status:** RESOLVED. HMAC stream extension now uses a 4-byte counter, supporting passwords up to ~16 million characters.

**Original issue:** Single-byte counter wrapped at 256, producing duplicate blocks for passwords > 4096 characters.
```
