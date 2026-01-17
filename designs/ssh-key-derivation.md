# SSH Key Derivation Design

**Version:** 1
**Status:** Draft

---

## 1. Overview

Keygrain gains deterministic Ed25519 SSH key derivation. One master secret derives unlimited SSH key pairs — no key files, no key management, no backup anxiety. Keys are computed on demand and piped directly to `ssh-agent`.

### Why this is novel

No password manager — vault-based or deterministic — offers this:

| Tool | SSH keys? | How |
|------|-----------|-----|
| 1Password | Stores keys | Vault-based, requires sync |
| Bitwarden | No | — |
| KeePassXC | ssh-agent integration | Stores keys in database |
| LessPass/Spectre | No | Password-only |
| **Keygrain** | **Derives keys** | **Deterministic from master secret** |

The key differentiator: Keygrain SSH keys exist nowhere. They are recomputed from the master secret on every use. No file to steal, no backup to lose, no sync to configure. The same master secret on any device produces the same key pair.

### How it fits

Ed25519 private keys are 32-byte seeds. HMAC-SHA256 produces 32 bytes. The existing derivation machinery (Argon2id strengthen → HMAC-SHA256) maps directly to SSH key generation with zero new cryptographic primitives.

---

## 2. Derivation Algorithm

### 2.1 Formula

```
strengthened = strengthen(secret, email)                    // Argon2id, per SPEC.md §3
message = UTF8_ENCODE(LOWERCASE(email) + ":" + LOWERCASE(key_name) + ":" + DECIMAL(counter) + ":keygrain-ssh")
seed = HMAC-SHA256(key = strengthened, message = message)  // 32 bytes
```

The 32-byte `seed` IS the Ed25519 private key seed. The public key is derived from it by the Ed25519 algorithm.

### 2.2 Domain Separation

The `:keygrain-ssh` suffix ensures no collision with existing derivations:

| Derivation | Message format |
|------------|---------------|
| Password | `site:email:length:counter` |
| Auth ID | `email:keygrain-id` |
| Auth password | `email:32:keygrain-auth` |
| Encryption key | `email:keygrain-encryption` |
| TOTP | `site:email:keygrain-totp` |
| Fingerprint | `keygrain-fingerprint` |
| Wallet | `email:wallet_name:chain:counter:keygrain-wallet` |
| **SSH** | **`email:key_name:counter:keygrain-ssh`** |

**Collision-free proof:** Password derivation messages end with `:<counter>` where counter is a decimal integer. SSH messages end with `:keygrain-ssh` which is not a decimal integer. Therefore no password message can equal any SSH message regardless of input values. The same logic applies to auth derivations (which end with `keygrain-id`, `keygrain-auth`, `keygrain-encryption`) — these use different suffixes and cannot collide with `:keygrain-ssh`.

**Field order note:** Password and TOTP derivations use `site:email:...` order (site first), while SSH and Wallet derivations use `email:name:...` order (email first). This is not a consistency issue — domain separation relies on the unique suffix (`:keygrain-ssh`, `:keygrain-totp`, etc.), not on field ordering. The different orderings reflect the different parameter semantics: password/TOTP are site-centric, SSH/wallet are identity-centric.

### 2.3 Input Normalization

| Parameter | Normalization | Rationale |
|-----------|---------------|-----------|
| `email` | Lowercased | Consistent with all other derivations |
| `key_name` | Lowercased; spaces disallowed | Prevents case-mismatch lockout; spaces break authorized_keys comment parsing |
| `counter` | Decimal string, no leading zeros | Consistent with password counter |

**key_name validation:** Non-empty, no whitespace characters. UTF-8 encoded. No length limit enforced, but UIs should suggest ≤ 32 characters for memorability.

### 2.4 Key Strengthening

The same Argon2id strengthening from SPEC.md §3 applies. The strengthened key is cached per `(secret, email)` pair — SSH derivation reuses the same cache as password derivation.

### 2.5 Ed25519 Seed vs Scalar (Clamping)

The 32-byte HMAC output is the Ed25519 **seed**, not the scalar. The Ed25519 signing algorithm (RFC 8032 §5.1.5) internally applies SHA-512 to the seed to produce the scalar, then clamps it. Implementations MUST NOT clamp the HMAC output before passing it to the Ed25519 key generation function. Any 32 bytes are a valid Ed25519 seed.

### 2.6 Pseudocode

```
function derive_ssh_keypair(secret: bytes, email: string, key_name: string, counter: int) -> (bytes[32], bytes[32]):
    require(key_name is non-empty)
    require(counter >= 1)

    strengthened = strengthen(secret, email)
    message = UTF8_ENCODE(LOWERCASE(email) + ":" + LOWERCASE(key_name) + ":" + DECIMAL(counter) + ":keygrain-ssh")
    seed = HMAC-SHA256(key = strengthened, message = message)

    // Ed25519 key generation from seed (library handles SHA-512 + clamping internally)
    private_key = Ed25519PrivateKey.from_seed(seed)
    public_key = private_key.get_public_key()    // 32 bytes

    return (seed, public_key)
```

---

## 3. Key Formats

### 3.1 OpenSSH Private Key Format (PEM)

The unencrypted OpenSSH private key format (used by `ssh-add` via stdin):

```
-----BEGIN OPENSSH PRIVATE KEY-----
<base64-encoded binary blob>
-----END OPENSSH PRIVATE KEY-----
```

Binary blob structure (all integers are big-endian uint32 unless noted):

```
"openssh-key-v1\0"          // AUTH_MAGIC (null-terminated)
string  ciphername          // "none"
string  kdfname             // "none"
string  kdfoptions          // "" (empty string)
uint32  number_of_keys      // 1
string  public_key_blob     // (see §3.2)
string  private_key_blob    // (see below, padded)
```

Private key blob (before encryption, which is "none"):

```
uint32  check1              // random uint32 (both must match)
uint32  check2              // same as check1
string  key_type            // "ssh-ed25519"
string  public_key_raw      // 32 bytes
string  private_key_raw     // 64 bytes (seed || public_key)
string  comment             // "email:key_name" (lowercased)
byte[]  padding             // Bytes 1, 2, 3, ..., N where N = (8 - unpadded_length % 8) % 8.
                            // If the content before padding is already divisible by 8, no padding is added.
                            // The block size is 8 (cipher block size for "none").
```

For deterministic output, `check1` and `check2` SHOULD be derived from the seed rather than random:

```
check_bytes = HMAC-SHA256(key = seed, message = UTF8_ENCODE("openssh-check"))
check1 = check_bytes[0:4] as big-endian uint32
check2 = check1
```

This ensures the same inputs always produce the same PEM output — critical for test vector reproducibility.

**Note:** Deterministic check bytes make Keygrain-generated PEM files distinguishable from standard `ssh-keygen` output (which uses random check bytes). This is not a security concern — the PEM is ephemeral and never stored — but implementors should be aware of this difference.

### 3.1.1 PEM Encoding Rules (Deterministic Output)

For byte-identical output across implementations, the PEM encoding MUST follow these rules:

1. **Base64 line length:** 70 characters per line (matching OpenSSH `ssh-keygen` output). The Python `cryptography` library uses 76 characters — implementations MUST NOT use the library's default PEM serialization; they must construct the PEM manually with 70-char lines.
2. **Trailing newline:** The PEM output MUST end with a newline character (`\n`) after the `-----END OPENSSH PRIVATE KEY-----` line.
3. **Line endings:** Unix line endings (`\n`) only. No `\r\n`.
4. **No trailing padding in base64:** Standard base64 with `=` padding as needed.

### 3.2 Public Key Blob (Wire Format)

```
string  key_type            // "ssh-ed25519"
string  public_key_raw      // 32 bytes
```

Where `string` is: `uint32 length` followed by `length` bytes.

### 3.3 Authorized Keys Format

```
ssh-ed25519 <base64(public_key_blob)> <comment>
```

Comment format: `email:key_name` (both lowercased — the same forms used in derivation). This ensures the authorized_keys output is deterministic for the same inputs regardless of the case the user typed.

Example:
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPKq29YIcDtlu4fT0cdGxI3+2QlaK3rkyK2gV6+mv5Ay test@gmail.com:github
```

---

## 4. Interface Contracts

### 4.1 Python

```python
def derive_ssh_keypair(
    secret: bytes,
    email: str,
    *,
    key_name: str,
    counter: int = 1,
) -> tuple[bytes, bytes]:
    """Derive an Ed25519 keypair deterministically.

    Args:
        secret: Master secret bytes.
        email: Email address (lowercased internally).
        key_name: Key label (lowercased internally). Non-empty.
        counter: Rotation counter (default 1, minimum 1).

    Returns:
        Tuple of (seed: 32 bytes, public_key: 32 bytes).
    """

def format_openssh_private_key(seed: bytes, public_key: bytes, comment: str) -> str:
    """Format an Ed25519 keypair as an OpenSSH PEM private key string."""

def format_authorized_keys(public_key: bytes, comment: str) -> str:
    """Format an Ed25519 public key as an authorized_keys line."""
```

### 4.2 JavaScript

```javascript
async function deriveSshKeypair(secret, email, { keyName, counter = 1 }) -> { seed: Uint8Array, publicKey: Uint8Array }
    // secret: string (master secret)
    // email: string
    // keyName: string (non-empty)
    // counter: integer >= 1
    // Returns: { seed: Uint8Array(32), publicKey: Uint8Array(32) }

function formatAuthorizedKeys(publicKey: Uint8Array, comment: string) -> string
    // Returns: "ssh-ed25519 <base64> <comment>"
```

### 4.3 Kotlin

```kotlin
/**
 * SSH functions live in a separate SshEngine object (not in the core Keygrain object).
 * Convention: core password/auth derivation → Keygrain object.
 * Feature-specific derivation → separate objects (TotpEngine, WalletEngine, SshEngine).
 */
object SshEngine {
    fun deriveSshKeypair(
        secret: ByteArray,
        email: String,
        keyName: String,
        counter: Int = 1
    ): SshKeypair

    fun formatAuthorizedKeys(publicKey: ByteArray, comment: String): String

    data class SshKeypair(
        val seed: ByteArray,       // 32 bytes
        val publicKey: ByteArray   // 32 bytes
    )
}
```

**Note:** `formatOpensshPrivateKey` is deliberately omitted from Kotlin. Android has no standard ssh-agent, so there is no use case for PEM generation on mobile. If Termux ssh-agent integration is added in the future, this function can be added at that time.

### 4.4 Return Value Design

All platforms return the raw 32-byte seed and 32-byte public key. Format functions are separate — the caller decides whether they need OpenSSH PEM, authorized_keys, or raw bytes. This separation keeps the core derivation testable without format dependencies.

The `format_openssh_private_key` function MUST produce deterministic output following the encoding rules in §3.1.1 (70-char base64 lines, trailing newline, deterministic check bytes). The `format_authorized_keys` function uses lowercased email and key_name in the comment (see §3.3).

---

## 5. CLI Interface

### 5.1 Commands

```bash
# Derive and display the public key (authorized_keys format)
keygrain ssh <email> --name <key_name> [--counter <n>]

# Derive and output the private key (OpenSSH PEM to stdout)
keygrain ssh <email> --name <key_name> [--counter <n>] --private

# Derive and add to ssh-agent directly
keygrain ssh <email> --name <key_name> [--counter <n>] --agent
```

### 5.2 Examples

```bash
# Show public key for GitHub
$ KEYGRAIN_SECRET=my-master-secret keygrain ssh test@gmail.com --name github
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPKq29YIcDtlu4fT0cdGxI3+2QlaK3rkyK2gV6+mv5Ay test@gmail.com:github

# Add to ssh-agent (key never touches disk)
$ KEYGRAIN_SECRET=my-master-secret keygrain ssh test@gmail.com --name github --agent
Identity added: (stdin) (test@gmail.com:github)

# Output private key (for piping)
$ KEYGRAIN_SECRET=my-master-secret keygrain ssh test@gmail.com --name github --private
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQy...
-----END OPENSSH PRIVATE KEY-----

# Rotate key (counter=2)
$ KEYGRAIN_SECRET=my-master-secret keygrain ssh test@gmail.com --name github --counter 2
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB2SGvfBxox1EA50EAjpA6KLFPxC/OXA4zgD8cs7vtFq test@gmail.com:github
```

### 5.3 Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Invalid arguments (empty key_name, counter < 1, missing secret) |
| 2 | Environment error (ssh-agent not available in --agent mode) |

---

## 6. Integration with ssh-agent

### 6.1 Direct Agent Addition (--agent flag)

```bash
keygrain ssh test@gmail.com --name github --agent
```

Internally:
```python
import subprocess

pem = format_openssh_private_key(seed, public_key, comment)
proc = subprocess.run(
    ["ssh-add", "-"],
    input=pem.encode(),
    capture_output=True
)
```

The `-` argument tells `ssh-add` to read the key from stdin. The key exists only in memory — never written to a file or temp file.

### 6.2 Manual Piping (--private flag)

```bash
keygrain ssh test@gmail.com --name github --private | ssh-add -
```

Equivalent to `--agent` but gives the user control over the pipeline.

### 6.3 Key Lifetime

By default, keys added to ssh-agent persist until the agent is killed or the key is explicitly removed. For ephemeral use:

```bash
# Add with 1-hour lifetime
keygrain ssh test@gmail.com --name github --private | ssh-add -t 3600 -
```

The `--agent` flag could accept an optional `--lifetime <seconds>` parameter:

```bash
keygrain ssh test@gmail.com --name github --agent --lifetime 3600
```

### 6.4 Agent Availability Check

Before attempting `ssh-add`, check that `SSH_AUTH_SOCK` is set and the socket exists. If not, print a clear error:

```
Error: ssh-agent not available. Start one with: eval $(ssh-agent)
```

---

## 7. Key Management

### 7.1 Conceptual Model

SSH keys are a new derivation type alongside passwords and TOTP. Each SSH key is identified by:

| Field | Purpose | Example |
|-------|---------|---------|
| `email` | Identity (same as password derivation) | `user@example.com` |
| `key_name` | User-chosen label for the key | `github`, `work-servers`, `personal` |
| `counter` | Rotation counter | `1` (default), `2` (after rotation) |

### 7.2 Relationship to Service Entries

Two models:

**Model A: Standalone keys (CLI-only, no service entry)**

The user derives keys by providing email + key_name + counter directly. Nothing is stored. This is the power-user workflow — the user remembers their key names.

**Model B: Service-linked keys (extension/mobile)**

A service entry can have an `ssh` field:

```json
{
  "site": "github.com",
  "email": "user@example.com",
  "length": 20,
  "symbols": "!@#$%&*-_=+?",
  "counter": 1,
  "ssh": {
    "key_name": "github",
    "counter": 1
  }
}
```

The `ssh.counter` is independent of the password `counter`. Rotating the password does not rotate the SSH key (and vice versa).

### 7.3 Key Name Conventions

Key names are freeform labels. Recommended conventions:

- Service-specific: `github`, `gitlab`, `bitbucket`
- Role-specific: `work-servers`, `personal`, `deploy`
- Host-specific: `prod-bastion`, `dev-cluster`

Constraints:
- Non-empty
- No whitespace characters (hard constraint, see §2.3)
- Lowercased before derivation
- No length limit (but keep it memorable — you need to reproduce it on a fresh device)
- UTF-8 encoded

### 7.4 Key Rotation

Incrementing the counter produces an entirely new, uncorrelated key pair. Rotation workflow:

1. Derive new key: `keygrain ssh user@example.com --name github --counter 2`
2. Add new public key to the remote service
3. Remove old public key from the remote service
4. Update the stored counter (if using Model B)

---

## 8. Storage

### 8.1 What is stored

| Data | Stored? | Where |
|------|---------|-------|
| Master secret | Never | User's memory |
| Ed25519 seed (private key) | Never | Derived on demand |
| Ed25519 public key | Never | Derived on demand |
| `key_name` | Optionally | Service entry `ssh.key_name` field |
| `counter` | Optionally | Service entry `ssh.counter` field |

### 8.2 What is NOT stored

The private key, seed, and public key are NEVER stored. They are recomputed from the master secret every time they are needed. This is the core security property.

### 8.3 Metadata in Sync

If the user links an SSH key to a service entry (Model B), the `ssh.key_name` and `ssh.counter` fields are synced with the existing encrypted config blob. These are non-sensitive metadata — knowing the key_name without the master secret reveals nothing.

---

## 9. Edge Cases

### 9.1 Invalid Inputs

| Condition | Behavior |
|-----------|----------|
| Empty `key_name` | Reject with error |
| `counter < 1` | Reject with error |
| Empty `secret` | Reject with error (same as password derivation) |
| Empty `email` | Reject with error (same as password derivation) |

### 9.2 Platform Crypto Availability

| Platform | Ed25519 library | Availability |
|----------|----------------|--------------|
| Python | `cryptography` (already a dependency) | Always available |
| JS (extension) | `tweetnacl` or Web Crypto (Ed25519 added in Chrome 113, Firefox 130) | Check availability, fallback to tweetnacl |
| Kotlin (Android) | BouncyCastle (already a dependency) | Always available |

### 9.3 ssh-agent Not Running

If `SSH_AUTH_SOCK` is unset or the socket doesn't exist, `--agent` mode fails with exit code 2 and a helpful error message. The user can still use `--private` to output the key and manage it manually.

### 9.4 Key Name Collisions

If a user creates two service entries with the same `key_name` and `counter`, they get the same key. This is by design — the derivation is deterministic. The UI should warn if a key_name is already in use.

### 9.5 Very Long Key Names

No technical limit, but extremely long key names make the authorized_keys comment unwieldy. The UI may suggest keeping names under 32 characters, but this is not enforced.

### 9.6 Special Characters in Key Names

Key names are UTF-8 strings. Characters like `:`, `/`, `-` are allowed. Whitespace is disallowed (see §2.3) because the authorized_keys format uses space as a field delimiter. Colons in key_names do not cause ambiguity in the derivation message because the `:keygrain-ssh` suffix is the authoritative domain separator.

**Colons and the comment field:** Since the authorized_keys comment uses `email:key_name` format, a key_name containing colons (e.g., `my:server`) produces a comment like `test@gmail.com:my:server` which is visually ambiguous. This is an accepted limitation — the comment is a display hint, not a parsed field. UIs SHOULD discourage colons in key_names but MUST NOT reject them.

---

## 10. Test Vectors

All vectors use the Argon2id strengthening from SPEC.md §3 (m=65536, t=3, p=1).

### 10.1 SSH Key Derivation

| # | secret (UTF-8) | email | key_name | counter | seed (hex) | public_key (hex) |
|---|---|---|---|---|---|---|
| 1 | `my-master-secret` | `test@gmail.com` | `github` | 1 | `15d7cd5c74358c1cd7f7f93ef45d074afcf6fd9e008a94de9e8608a330d96dc1` | `f2aadbd608703b65bb87d3d1c746c48dfed9095a2b7ae4c8ada057afa6bf9032` |
| 2 | `my-master-secret` | `test@gmail.com` | `work-servers` | 1 | `d415ea7afd4b8e113bee60f42ae84b387b564f38e8b95a0c3326b3720d5fb9f0` | `5050a666581b46ebd076f5f902eaaa14a2dc7b14bdeada5fae5c861e049530e0` |
| 3 | `my-master-secret` | `test@gmail.com` | `github` | 2 | `657c26252e9b425f83f5fd763177b75ea7046b4f9167a2116f248c19455ab9e2` | `1d921af7c1c68c75100e741008e903a28b14fc42fce5c0e33803f1cb3bbed16a` |
| 4 | `my-master-secret` | `TEST@Gmail.com` | `GitHub` | 1 | `15d7cd5c74358c1cd7f7f93ef45d074afcf6fd9e008a94de9e8608a330d96dc1` | `f2aadbd608703b65bb87d3d1c746c48dfed9095a2b7ae4c8ada057afa6bf9032` |
| 5 | `different-secret` | `test@gmail.com` | `github` | 1 | `247c4840e93dd75558b52c3979ed67420de5093f22fb1cdd74e86202d1f17e99` | `60efc824475a7a03dfba1bfc6abc49c4d4156bd705872fcf5615b00d210999ba` |

**Verification rules:**
- Vectors 1 and 4 MUST produce identical output (email and key_name case normalization).
- Vectors 1 and 3 MUST differ (counter change).
- Vectors 1 and 2 MUST differ (key_name change).
- Vectors 1 and 5 MUST differ (secret change).

### 10.2 Authorized Keys Output

| # | Expected authorized_keys line |
|---|---|
| 1 | `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPKq29YIcDtlu4fT0cdGxI3+2QlaK3rkyK2gV6+mv5Ay test@gmail.com:github` |
| 2 | `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFBQpmZYG0br0Hb1+QLqqhSi3HsUveraX65chh4ElTDg test@gmail.com:work-servers` |
| 3 | `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB2SGvfBxox1EA50EAjpA6KLFPxC/OXA4zgD8cs7vtFq test@gmail.com:github` |
| 5 | `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGDvyCRHWnoD37ob/Gq8ScTUFWvXBYcvz1YVsA0hCZm6 test@gmail.com:github` |

### 10.3 HMAC Message Strings

For implementor debugging — the exact message bytes fed to HMAC-SHA256:

| # | Message (UTF-8) | Message (hex) |
|---|---|---|
| 1 | `test@gmail.com:github:1:keygrain-ssh` | `7465737440676d61696c2e636f6d3a6769746875623a313a6b6579677261696e2d737368` |
| 2 | `test@gmail.com:work-servers:1:keygrain-ssh` | `7465737440676d61696c2e636f6d3a776f726b2d736572766572733a313a6b6579677261696e2d737368` |
| 3 | `test@gmail.com:github:2:keygrain-ssh` | `7465737440676d61696c2e636f6d3a6769746875623a323a6b6579677261696e2d737368` |

### 10.4 Cross-Platform Validation

An `ssh-vectors.json` file will be committed to the repository root containing all derivation vectors, authorized_keys outputs, and HMAC message strings. All platform implementations MUST pass these vectors identically. This follows the same pattern as `vectors.json` (passwords), `totp-vectors.json`, and `wallet-vectors.json`.

---

## 11. Security Considerations

### 11.1 Comparison with Traditional SSH Key Management

| Property | Traditional (`ssh-keygen`) | Keygrain SSH |
|----------|---------------------------|--------------|
| Key storage | `~/.ssh/id_ed25519` file | Nowhere (derived on demand) |
| Backup required | Yes (lose file = lose access) | No (master secret recreates all keys) |
| Per-device keys | Different key per device | Same key on all devices |
| Key theft | Attacker needs file + passphrase | Attacker needs master secret |
| Forward secrecy | Compromised key doesn't reveal others | Compromised master secret reveals ALL keys |
| Rotation | Generate new key, distribute new pubkey | Increment counter, distribute new pubkey |
| Revocation | Remove pubkey from authorized_keys | Same |

### 11.2 Threat Model

**What Keygrain SSH protects against:**
- Disk theft / forensics: No key file exists to extract
- Backup compromise: No key in backups
- Device loss: Re-derive on new device instantly
- Key sprawl: One secret, unlimited keys, zero management

**What Keygrain SSH does NOT protect against:**
- Master secret compromise: Attacker derives ALL SSH keys (and all passwords)
- Memory extraction: While key is in ssh-agent, it's in memory (same as traditional)
- Weak master secret: Argon2id helps but cannot save a 4-digit PIN

### 11.3 Forward Secrecy Tradeoff

Traditional SSH: compromising one key reveals access to servers using that key only. Keygrain: compromising the master secret reveals all keys. This is the fundamental tradeoff of deterministic derivation — it applies equally to passwords.

Mitigation: the master secret is protected by Argon2id (64 MiB, 3 iterations). An attacker who obtains a public key cannot reverse HMAC-SHA256 to get the strengthened key, and cannot reverse Argon2id to get the master secret.

### 11.4 Key Reuse Across Devices

Unlike traditional SSH (where each device has its own key), Keygrain produces the same key on all devices. This means:
- Server logs cannot distinguish which device connected
- Revoking access from one device requires changing the master secret or rotating the key (incrementing counter)

This is acceptable for most users. Power users who need per-device keys can use device-specific key_names (e.g., `github-laptop`, `github-phone`).

### 11.5 Timing Attacks

HMAC-SHA256 and Ed25519 key generation are constant-time in all recommended libraries (Python `cryptography`, BouncyCastle, tweetnacl). No special precautions needed beyond using these libraries correctly.

---

## 12. Platform-Specific Notes

### 12.1 Python (CLI + Library)

**Library:** `cryptography` (already a dependency for the project)

**Capabilities:**
- Full CLI with `--agent` support (subprocess to `ssh-add -`)
- Ed25519 key generation via `cryptography`; PEM formatting is manual per §3.1.1 (70-char lines)
- All format functions available

**Dependencies:** No new dependencies required.

### 12.2 JavaScript (Browser Extension)

**Library:** `tweetnacl` (or Web Crypto Ed25519 where available)

**Capabilities:**
- Derive keypair and display public key / authorized_keys line
- Copy authorized_keys to clipboard
- NO ssh-agent integration (browser cannot access Unix sockets)
- NO private key PEM output (no use case in browser context)

**Web Crypto Ed25519 support:**
- Chrome 113+ (May 2023)
- Firefox 130+ (Sep 2024)
- Safari: Not yet supported

**Fallback:** Use `tweetnacl` (25 KB, pure JS, no dependencies) for Ed25519 operations. This is already a common choice for browser crypto.

**Note:** The extension's primary SSH use case is displaying the public key for the user to copy into GitHub/GitLab settings. Private key operations are handled by the CLI.

### 12.3 Kotlin (Android App)

**Library:** BouncyCastle (already a dependency)

**Capabilities:**
- Derive keypair and display public key / authorized_keys line
- Copy authorized_keys to clipboard
- NO ssh-agent integration (Android has no standard ssh-agent)
- Could integrate with Termux's ssh-agent via intent (future consideration)

**BouncyCastle Ed25519:**
```kotlin
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters

val privateKey = Ed25519PrivateKeyParameters(seed, 0)
val publicKey = privateKey.generatePublicKey()
val publicKeyBytes = publicKey.encoded  // 32 bytes
```

### 12.4 Platform Feature Matrix

| Feature | Python CLI | Browser Extension | Android App |
|---------|-----------|-------------------|-------------|
| Derive keypair | ✓ | ✓ | ✓ |
| Show public key | ✓ | ✓ | ✓ |
| Show authorized_keys | ✓ | ✓ | ✓ |
| Copy to clipboard | — | ✓ | ✓ |
| Output private key PEM | ✓ | — | — |
| Add to ssh-agent | ✓ | — | — |
| QR code for pubkey | — | — | ✓ (future) |
