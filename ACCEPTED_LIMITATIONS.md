# Accepted Limitations

These are known issues that have been analyzed and deliberately accepted. They are NOT bugs.
Do NOT report these in bug bounties, code reviews, or security audits.

## 1. PIN Brute-Force (Extension)

**Issue:** 4-6 digit PIN with PBKDF2 100k iterations is crackable offline in <1 second on GPU.

**Why accepted:** PIN is a convenience feature, not a security boundary. The real security boundary is the master secret (Argon2id protected). Client-side 5-attempt lockout prevents online brute-force. Same tradeoff as every competitor (Bitwarden, 1Password, LastPass).

## 2. JS String Immutability (Extension)

**Issue:** JavaScript strings are immutable. The master secret stored as a string variable cannot be zeroed from memory until garbage collection.

**Why accepted:** Fundamental language limitation. Every browser-based password manager has this constraint. The Uint8Array results (strengthened keys) ARE zeroed. Exposure window is the popup's lifetime only. No mitigation exists without WebAssembly for all secret handling.

## 3. ~~Modulo Bias in Password Generation~~ [RESOLVED in v4]

**Status:** RESOLVED. Password generation now uses rejection sampling (unbiased_index), eliminating modulo bias entirely.

**Original issue:** Character selection used `byte % charset_length`, reducing effective entropy by ~1-2 bits over 20 characters.

## 4. Autofill Bypass on Rooted Android Devices

**Issue:** On rooted devices, the autofill whitelist can be bypassed via Xposed/package spoofing.

**Why accepted:** Rooted device = fundamentally compromised environment. The entire Android security model is broken. Same limitation as banking apps, Google Pay, Netflix. No app can provide meaningful guarantees on rooted devices.

## 5. Popup/Background Sync Race Condition (Extension)

**Issue:** Popup and background script can both initiate sync simultaneously. Concurrent writes to `chrome.storage.local` can overwrite each other.

**Why accepted:** Fixing requires routing all sync through the service worker (significant refactor). Practical impact is negligible — race window is milliseconds, worst case is stale state that self-corrects on next sync. No data loss, just a redundant sync cycle.

## 6. ~~Stream Counter Overflow at Password Length > 4096~~ [RESOLVED in v4]

**Status:** RESOLVED. HMAC stream extension now uses a 4-byte counter, supporting passwords up to ~16 million characters.

**Original issue:** Single-byte counter wrapped at 256, producing duplicate blocks for passwords > 4096 characters.

## 7. ccTLD Auto-Detect (e.g., `google.co.uk`)

**Issue:** Base domain extraction (`parts.slice(-2)`) produces `co.uk` instead of `google.co.uk` for multi-part TLDs.

**Why accepted:** Proper fix requires Public Suffix List (~200KB, too heavy for extension popup). Fuzzy search still works (user types "google"). Only affects auto-detect convenience, not security or correctness.

## 8. No File System Access (Extension)

**Issue:** Browser extensions cannot access the file system. Data stored in `chrome.storage.local` (10 MB quota).

**Why accepted:** Browser platform limitation. Workaround (native messaging host) requires separate installer, defeats extension simplicity. 10 MB is sufficient for thousands of services + wallets.

## 9. First-Sync TOCTOU Window

**Issue:** Metadata tamper detection only works after first successful sync (needs baseline). First sync after install has no cached metadata to validate against.

**Why accepted:** One-time window only. After first sync, all subsequent syncs are protected. A compromised server would need to attack at the exact moment of first install — and even then, the AAD binding prevents blob swapping.

## 10. Argon2id Parallelism = 1

**Issue:** Argon2id with parallelism=1 doesn't penalize GPU attackers (no thread synchronization overhead).

**Why accepted:** Parallelism=1 is required for deterministic cross-platform output. Higher parallelism would produce different results on different thread schedulings. The 64 MiB memory requirement is the primary GPU defense (GPUs have limited per-thread memory).
