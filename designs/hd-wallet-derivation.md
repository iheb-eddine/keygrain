# HD Wallet Derivation Design

**Version:** 1
**Status:** Accepted

---

## 1. Overview

Keygrain gains deterministic HD wallet derivation. One master secret derives unlimited BIP-39 mnemonics and BIP-32 HD wallet seeds — no mnemonic to store, no seed phrase backup, no single point of physical failure.

### Why this is novel

BIP-32/BIP-39/BIP-44 HD wallets already work on deterministic derivation from a seed. The problem they don't solve: where does the seed come from? Users must store a 24-word mnemonic — on paper, on metal, in a safe. Lose it, and funds are gone forever.

Keygrain eliminates the mnemonic storage problem by deriving it from the master secret. The mnemonic exists only when needed — it is recomputed on demand.

| Tool | Approach | Storage required |
|------|----------|-----------------|
| Hardware wallets | Generate random mnemonic | Must store 24 words physically |
| SeedPass.me | BIP-85 from master mnemonic | Must store master mnemonic |
| **Keygrain** | **Derive from master secret** | **Nothing — master secret is memorized** |

Keygrain goes one level deeper than SeedPass.me: no mnemonic to store at all.

### Positioning: Disaster Recovery

> **⚠️ THIS IS NOT A WALLET. THIS IS NOT PRIMARY KEY MANAGEMENT.**

This feature is positioned exclusively as **disaster recovery / backup derivation**:

- Use hardware wallets (Ledger, Trezor) for daily operations
- Use Keygrain derivation as a **deterministic backup** — if your hardware wallet is lost/destroyed, you can recover your mnemonic from your master secret
- Never use Keygrain-derived keys as your only copy of wallet access

### Liability Framing

**CRITICAL WARNING:** If the master secret is lost or forgotten, ALL derived wallets and their funds are **permanently and irrecoverably lost**. There is no recovery mechanism, no support team, no reset procedure. This is by design — deterministic derivation means no stored backup exists anywhere.

The software provides the derivation algorithm. It does not custody funds, does not store keys, and cannot recover lost secrets. Users accept full responsibility for master secret preservation.

---

## 2. Derivation Algorithm

### 2.1 Formula

```
strengthened = strengthen(secret, email)                    // Argon2id, per SPEC.md §3
message = UTF8_ENCODE(
    LOWERCASE(email) + ":" + LOWERCASE(wallet_name) + ":" + LOWERCASE(chain) + ":" + DECIMAL(counter) + ":keygrain-wallet"
)
entropy = HMAC-SHA256(key = strengthened, message = message)  // 32 bytes = 256 bits
```

The 32-byte output serves as:
- **Mnemonic mode (primary):** BIP-39 entropy → 24-word mnemonic → BIP-32 HD wallet
- **Raw seed mode (advanced):** Used directly as a 32-byte master seed for BIP-32

### 2.2 Domain Separation

The `:keygrain-wallet` suffix ensures no collision with existing derivations:

| Derivation | Message format |
|------------|---------------|
| Password | `site:email:length:counter` |
| Auth ID | `email:keygrain-id` |
| Auth password | `email:32:keygrain-auth` |
| Encryption key | `email:keygrain-encryption` |
| TOTP | `site:email:keygrain-totp` |
| Fingerprint | `keygrain-fingerprint` |
| SSH | `email:key_name:counter:keygrain-ssh` |
| **Wallet** | **`email:wallet_name:chain:counter:keygrain-wallet`** |

**Collision-free proof:** Wallet messages end with `:keygrain-wallet`. No other derivation uses this suffix. The message structure `email:wallet_name:chain:counter:keygrain-wallet` cannot collide with SSH (`email:key_name:counter:keygrain-ssh`) because the suffixes differ. It cannot collide with password derivation (`site:email:length:counter`) because password messages end with a decimal integer, not `:keygrain-wallet`.

### 2.3 Mandatory Argon2id Strengthening

Argon2id strengthening is **mandatory and non-optional** for wallet derivation. The same parameters from SPEC.md §3 apply:

| Parameter | Value |
|-----------|-------|
| Algorithm | Argon2id (RFC 9106) |
| Memory | 65536 KiB (64 MiB) |
| Iterations | 3 |
| Parallelism | 1 |
| Output length | 32 bytes |
| Salt | `UTF-8("keygrain-strengthen:" + lowercase(email))` |

The existing `strengthen_secret(secret, email)` function is reused. No separate wallet-specific Argon2id call — the strengthened key is cached per `(secret, email)` pair across all derivation types.

### 2.4 Input Parameters

| Parameter | Type | Constraints | Default | Stored |
|-----------|------|-------------|---------|--------|
| `secret` | bytes | Non-empty | — | Never |
| `email` | string | Non-empty; lowercased | — | Per-wallet |
| `wallet_name` | string | Non-empty; matches `[a-z0-9\-]+`; lowercased | — | Per-wallet |
| `chain` | string | Must be from SUPPORTED_CHAINS enum (hard constraint); lowercased | — | Per-wallet |
| `counter` | integer | ≥ 1 | 1 | Per-wallet |

### 2.5 Input Normalization

| Parameter | Normalization | Rationale |
|-----------|---------------|-----------|
| `email` | Lowercased (ASCII) | Consistent with all other derivations |
| `wallet_name` | Lowercased; validated against `[a-z0-9\-]+` | Prevents case-mismatch; restricted charset prevents delimiter collisions |
| `chain` | Lowercased; validated against SUPPORTED_CHAINS enum | Hard constraint prevents typos and crafted values |
| `counter` | Decimal string, no leading zeros | Consistent with password/SSH counter |

**wallet_name validation:** Must match regex `^[a-z0-9\-]+$` (lowercase ASCII letters, digits, and hyphens only). Must not be empty. Recommended ≤ 32 characters for memorability. Examples: `personal`, `savings`, `trading`, `cold-storage`. Colons, underscores, and other punctuation are disallowed to prevent ambiguity in the colon-delimited HMAC message format.

### 2.6 Supported Chains (Enum)

Chain values are validated against a fixed set. This prevents typos that would silently derive a different wallet — a catastrophic failure mode for cryptocurrency.

| Chain value | BIP-44 coin type | Network |
|-------------|-----------------|---------|
| `bitcoin` | 0 | Bitcoin mainnet |
| `ethereum` | 60 | Ethereum / EVM chains |
| `solana` | 501 | Solana |
| `litecoin` | 2 | Litecoin |
| `dogecoin` | 3 | Dogecoin |
| `bitcoin-testnet` | 1 | Bitcoin testnet |
| `polkadot` | — | Polkadot (substrate derivation, see §5.2) |
| `cosmos` | 118 | Cosmos Hub |
| `avalanche` | 60 | Avalanche C-Chain (EVM-compatible) |

New chains can be added in future versions. The enum is a **hard protocol constraint** — the derivation algorithm rejects unknown chain values. This prevents typos that would silently derive a different wallet (catastrophic for cryptocurrency) and eliminates the possibility of intra-wallet collisions from crafted chain values containing delimiter characters.

### 2.7 Pseudocode

```
function derive_wallet_entropy(secret: bytes, email: string, wallet_name: string, chain: string, counter: int) -> bytes[32]:
    require(wallet_name matches [a-z0-9\-]+)
    require(chain in SUPPORTED_CHAINS)
    require(counter >= 1)

    strengthened = strengthen(secret, email)
    message = UTF8_ENCODE(
        LOWERCASE(email) + ":" + LOWERCASE(wallet_name) + ":" + LOWERCASE(chain) + ":" + DECIMAL(counter) + ":keygrain-wallet"
    )
    entropy = HMAC-SHA256(key = strengthened, message = message)
    return entropy  // 32 bytes
```

---

## 3. BIP-39 Mnemonic Generation

### 3.1 Entropy to Mnemonic (Standard BIP-39)

The 32-byte (256-bit) entropy from §2 is converted to a 24-word mnemonic per the BIP-39 specification:

```
1. entropy = 256 bits (32 bytes from HMAC-SHA256)
2. checksum = first 8 bits of SHA-256(entropy)
3. combined = entropy || checksum = 264 bits
4. Split combined into 24 groups of 11 bits each
5. Each 11-bit value (0-2047) indexes into the BIP-39 English wordlist
6. mnemonic = 24 words separated by spaces
```

### 3.2 Wordlist

The BIP-39 English wordlist (2048 words) is the only supported wordlist. This ensures cross-platform compatibility and interoperability with all standard wallets.

Wordlist source: https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt

### 3.3 Checksum Verification

The checksum is inherent in the mnemonic. Any BIP-39-compliant wallet will validate the checksum when importing the mnemonic. This provides a built-in integrity check — if the derivation produces incorrect entropy (due to a bug), the checksum will fail and standard wallets will reject the mnemonic.

### 3.4 Pseudocode

```
function entropy_to_mnemonic(entropy: bytes[32]) -> string:
    checksum_byte = SHA256(entropy)[0]  // first byte = 8 bits for 256-bit entropy
    
    // Combine entropy + checksum into bit array
    bits = bytes_to_bits(entropy) + byte_to_bits(checksum_byte)  // 264 bits
    
    // Split into 24 groups of 11 bits
    words = []
    for i in 0..23:
        index = bits[i*11 : (i+1)*11] as integer  // 0-2047
        words.append(WORDLIST[index])
    
    return " ".join(words)
```

### 3.5 Mnemonic Validation

Before displaying a derived mnemonic to the user, implementations MUST:
1. Verify the checksum is valid (re-derive checksum from entropy, compare)
2. Verify all 24 words are in the BIP-39 English wordlist
3. Verify the mnemonic is exactly 24 words

These checks catch implementation bugs. If any check fails, the derivation MUST abort with an error — never display a potentially incorrect mnemonic.

---

## 4. BIP-32 Master Seed

### 4.1 Mnemonic Mode (Primary)

From the 24-word mnemonic, derive the BIP-32 master seed using standard BIP-39 seed derivation:

```
seed = PBKDF2-SHA512(
    password = UTF8_ENCODE(mnemonic_words),   // space-separated, NFKD normalized
    salt     = UTF8_ENCODE("mnemonic" + passphrase),
    iterations = 2048,
    output_length = 64 bytes
)
```

**NFKD normalization note:** BIP-39 requires NFKD (Unicode Normalization Form KD) on both the mnemonic and passphrase before PBKDF2. Since Keygrain only supports the English wordlist (pure ASCII) and uses an empty passphrase, NFKD is a no-op in all cases. Implementations MAY skip NFKD normalization but MUST document this assumption. If non-English wordlists or non-empty passphrases are ever supported, NFKD MUST be applied.

The `passphrase` defaults to empty string (`""`). Keygrain does NOT support BIP-39 passphrases — adding a passphrase would create a second secret the user must remember, defeating the purpose.

The 64-byte seed is the BIP-32 master seed from which the entire HD wallet tree is derived.

### 4.2 Raw Seed Mode (Advanced)

For software wallets that accept raw 32-byte seeds directly (bypassing BIP-39):

```
raw_seed = entropy  // The 32 bytes from §2, used directly
```

This mode skips BIP-39 mnemonic generation and PBKDF2. It is useful for:
- Wallets that don't use BIP-39 (e.g., some Solana wallets)
- Testing and development
- Situations where PBKDF2 overhead is undesirable

**⚠️ CRITICAL WARNING:** Raw seed mode produces a **completely different** master key than mnemonic mode for the same entropy. The two modes are NOT interchangeable. Users must record which mode they used — using the wrong mode during recovery will produce wrong keys and inaccessible funds.

**UI Guardrails (mandatory):**
- Raw seed mode MUST be hidden behind an "Advanced" toggle/section, not shown by default
- The UI MUST display a prominent warning explaining the incompatibility with mnemonic mode
- The wallet entry metadata (§10.2) MUST record which mode was used (`"mode": "mnemonic"` or `"mode": "raw"`)
- If a user attempts to switch modes for an existing wallet entry, the UI MUST require explicit confirmation

### 4.3 BIP-32 Master Key Derivation

From the 64-byte seed (mnemonic mode), derive the master private key and chain code:

```
I = HMAC-SHA512(key = UTF8_ENCODE("Bitcoin seed"), message = seed)
master_private_key = I[0:32]   // left 32 bytes
master_chain_code = I[32:64]   // right 32 bytes
```

If `master_private_key` is zero or ≥ the secp256k1 curve order n, the seed is invalid. This is astronomically unlikely (probability < 2⁻¹²⁷) but implementations should check and report an error rather than silently producing an invalid key.

### 4.4 Non-Bitcoin Chains

For Ethereum and other EVM chains (including Avalanche C-Chain), the same BIP-32 derivation applies (they use secp256k1).

For Ed25519-based chains (Solana), the derivation differs:
- **Solana:** Uses the raw 32-byte seed directly as the Ed25519 private key seed (no BIP-32 tree). The standard Solana derivation path is `m/44'/501'/0'/0'` using SLIP-0010 (Ed25519 variant of BIP-32).

For Sr25519-based chains (Polkadot):
- **Polkadot:** Uses substrate-style derivation from the BIP-39 mnemonic directly. The mnemonic is converted to a mini-secret via PBKDF2, then used to generate an Sr25519 keypair. Standard BIP-32/BIP-44 paths do not apply. Import the mnemonic into a substrate-compatible wallet (Polkadot.js, Nova Wallet).

---

## 5. BIP-44 Derivation Paths

### 5.1 Standard Path Structure

```
m / purpose' / coin_type' / account' / change / address_index
```

Where `'` denotes hardened derivation.

### 5.2 Paths by Chain

| Chain | Path | Notes |
|-------|------|-------|
| Bitcoin (legacy) | `m/44'/0'/0'/0/0` | P2PKH addresses |
| Bitcoin (SegWit) | `m/84'/0'/0'/0/0` | P2WPKH (bech32) — recommended |
| Bitcoin (Taproot) | `m/86'/0'/0'/0/0` | P2TR (bech32m) |
| Ethereum | `m/44'/60'/0'/0/0` | Standard MetaMask path |
| Solana | `m/44'/501'/0'/0'` | Phantom/Solflare standard |
| Litecoin | `m/84'/2'/0'/0/0` | SegWit |
| Dogecoin | `m/44'/3'/0'/0/0` | Legacy |
| Polkadot | *(no BIP-44 path)* | Uses substrate-style derivation from mnemonic directly (see note below) |
| Cosmos | `m/44'/118'/0'/0/0` | Standard |
| Avalanche | `m/44'/60'/0'/0/0` | Same as Ethereum (C-Chain is EVM-compatible) |

**Polkadot note:** Polkadot uses Sr25519 (Schnorrkel) which is not compatible with BIP-32 derivation paths. The BIP-39 mnemonic is imported directly into substrate-based wallets (Polkadot.js, Nova Wallet) which apply their own key derivation (mini-secret → Sr25519 keypair). No BIP-44 path applies. Users should import the mnemonic into a Polkadot-compatible wallet directly.

### 5.3 Account Index

The `account'` level (third component) defaults to `0'`. Keygrain does not expose account index configuration — users who need multiple accounts for the same chain should use different `wallet_name` values (e.g., `savings`, `trading`).

### 5.4 Keygrain Does NOT Derive Child Keys

Keygrain's responsibility ends at providing the mnemonic (or raw seed). The actual BIP-32/BIP-44 child key derivation is performed by the user's wallet software (MetaMask, Phantom, Electrum, etc.). Keygrain documents the paths for reference only — it does not implement the full HD tree traversal.

**Exception:** The CLI MAY offer a `--show-address` flag that derives the first address for verification purposes (confirming the mnemonic produces the expected address). This is optional and platform-dependent.

---

## 6. Interface Contracts

### 6.1 Python

```python
def derive_wallet_entropy(
    secret: bytes,
    email: str,
    *,
    wallet_name: str,
    chain: str,
    counter: int = 1,
) -> bytes:
    """Derive 32 bytes of wallet entropy deterministically.

    Args:
        secret: Master secret bytes.
        email: Email address (lowercased internally).
        wallet_name: Wallet label (lowercased, must match [a-z0-9\\-]+).
        chain: Chain identifier (must be in SUPPORTED_CHAINS).
        counter: Rotation counter (default 1, minimum 1).

    Returns:
        32 bytes of entropy suitable for BIP-39 mnemonic generation.

    Raises:
        ValueError: If wallet_name doesn't match [a-z0-9\\-]+, chain is unsupported, or counter < 1.
    """

def entropy_to_mnemonic(entropy: bytes) -> str:
    """Convert 32 bytes of entropy to a 24-word BIP-39 mnemonic.

    Args:
        entropy: Exactly 32 bytes.

    Returns:
        Space-separated 24-word mnemonic (English).

    Raises:
        ValueError: If entropy is not 32 bytes or checksum validation fails.
    """

def mnemonic_to_seed(mnemonic: str, passphrase: str = "") -> bytes:
    """Convert a BIP-39 mnemonic to a 64-byte BIP-32 seed via PBKDF2-SHA512.

    Args:
        mnemonic: Space-separated BIP-39 mnemonic (24 words).
        passphrase: Optional BIP-39 passphrase (default empty).

    Returns:
        64 bytes (BIP-32 master seed).
    """

def derive_wallet_mnemonic(
    secret: bytes,
    email: str,
    *,
    wallet_name: str,
    chain: str,
    counter: int = 1,
) -> str:
    """High-level: derive a 24-word BIP-39 mnemonic from master secret.

    Combines derive_wallet_entropy + entropy_to_mnemonic.
    Performs double-derivation verification internally.

    Returns:
        Space-separated 24-word mnemonic.

    Raises:
        RuntimeError: If double-derivation check fails (implementation bug detected).
    """

SUPPORTED_CHAINS: set[str] = {
    "bitcoin", "ethereum", "solana", "litecoin", "dogecoin",
    "bitcoin-testnet", "polkadot", "cosmos", "avalanche",
}
```

### 6.2 JavaScript (Browser Extension)

```javascript
/**
 * Derive 32 bytes of wallet entropy deterministically.
 * @param {string} secret - Master secret
 * @param {string} email - User email
 * @param {{walletName: string, chain: string, counter?: number}} options
 * @returns {Promise<Uint8Array>} 32 bytes of entropy
 * @throws {Error} if inputs are invalid
 */
async function deriveWalletEntropy(secret, email, { walletName, chain, counter = 1 }) { }

/**
 * Convert 32 bytes of entropy to a 24-word BIP-39 mnemonic.
 * @param {Uint8Array} entropy - Exactly 32 bytes
 * @returns {string} Space-separated 24-word mnemonic
 * @throws {Error} if entropy length is wrong or checksum fails
 */
function entropyToMnemonic(entropy) { }

/**
 * Convert a BIP-39 mnemonic to a 64-byte seed (PBKDF2-SHA512).
 * @param {string} mnemonic - 24-word mnemonic
 * @param {string} [passphrase=""] - Optional passphrase
 * @returns {Promise<Uint8Array>} 64-byte BIP-32 master seed
 */
async function mnemonicToSeed(mnemonic, passphrase = "") { }

/**
 * High-level: derive a 24-word mnemonic from master secret.
 * Performs double-derivation verification.
 * @param {string} secret - Master secret
 * @param {string} email - User email
 * @param {{walletName: string, chain: string, counter?: number}} options
 * @returns {Promise<string>} 24-word mnemonic
 * @throws {Error} on invalid inputs or verification failure
 */
async function deriveWalletMnemonic(secret, email, { walletName, chain, counter = 1 }) { }

const SUPPORTED_CHAINS = new Set([
    "bitcoin", "ethereum", "solana", "litecoin", "dogecoin",
    "bitcoin-testnet", "polkadot", "cosmos", "avalanche",
]);
```

### 6.3 Kotlin (Android)

```kotlin
object WalletEngine {
    val SUPPORTED_CHAINS: Set<String> = setOf(
        "bitcoin", "ethereum", "solana", "litecoin", "dogecoin",
        "bitcoin-testnet", "polkadot", "cosmos", "avalanche"
    )

    /**
     * Derive 32 bytes of wallet entropy deterministically.
     * @throws IllegalArgumentException on invalid inputs
     */
    fun deriveWalletEntropy(
        secret: ByteArray,
        email: String,
        walletName: String,
        chain: String,
        counter: Int = 1
    ): ByteArray

    /**
     * Convert 32 bytes of entropy to a 24-word BIP-39 mnemonic.
     * @throws IllegalArgumentException if entropy is not 32 bytes
     * @throws IllegalStateException if checksum validation fails
     */
    fun entropyToMnemonic(entropy: ByteArray): String

    /**
     * Convert a BIP-39 mnemonic to a 64-byte seed (PBKDF2-SHA512).
     */
    fun mnemonicToSeed(mnemonic: String, passphrase: String = ""): ByteArray

    /**
     * High-level: derive a 24-word mnemonic with double-derivation verification.
     * @throws RuntimeException if verification fails
     */
    fun deriveWalletMnemonic(
        secret: ByteArray,
        email: String,
        walletName: String,
        chain: String,
        counter: Int = 1
    ): String
}
```

---

## 7. CLI Interface

### 7.1 Commands

```bash
# Derive and display the 24-word mnemonic
keygrain wallet <email> --name <wallet_name> --chain <chain> [--counter <n>]

# Derive and display the raw 32-byte entropy (hex)
keygrain wallet <email> --name <wallet_name> --chain <chain> [--counter <n>] --raw

# Derive and display the BIP-32 master seed (hex, 64 bytes)
keygrain wallet <email> --name <wallet_name> --chain <chain> [--counter <n>] --seed

# Show the BIP-44 derivation path for the chain
keygrain wallet <email> --name <wallet_name> --chain <chain> [--counter <n>] --path

# BIP-85 compatibility mode (from existing mnemonic)
keygrain wallet-bip85 --mnemonic "<24 words>" --app-no <n> [--words 24] [--passphrase ""]
```

### 7.2 Examples

```bash
# Derive Bitcoin wallet mnemonic
$ KEYGRAIN_SECRET=my-master-secret keygrain wallet test@gmail.com --name personal --chain bitcoin

⚠️  WARNING: DISASTER RECOVERY ONLY
⚠️  If you lose your master secret, these funds are PERMANENTLY LOST.
⚠️  Do NOT use this as your only wallet backup.

Type "I understand the risks" to continue: I understand the risks

Deriving wallet mnemonic...
Verification: ✓ (double-derivation match)

Chain:        bitcoin
Wallet:       personal
Counter:      1
BIP-44 Path:  m/84'/0'/0'/0/0

Mnemonic (24 words):
┌─────────────────────────────────────────────────────┐
│  1. abandon    7. ...      13. ...      19. ...     │
│  2. ...        8. ...      14. ...      20. ...     │
│  3. ...        9. ...      15. ...      21. ...     │
│  4. ...       10. ...      16. ...      22. ...     │
│  5. ...       11. ...      17. ...      23. ...     │
│  6. ...       12. ...      18. ...      24. ...     │
└─────────────────────────────────────────────────────┘

Import this mnemonic into your wallet software to verify addresses.
This mnemonic was NOT stored anywhere.

# Rotate wallet (counter=2)
$ KEYGRAIN_SECRET=my-master-secret keygrain wallet test@gmail.com --name personal --chain bitcoin --counter 2

# Raw entropy output (for scripting)
$ KEYGRAIN_SECRET=my-master-secret keygrain wallet test@gmail.com --name personal --chain bitcoin --raw
a1b2c3d4...  (64 hex characters)
```

### 7.3 Mandatory Confirmation Flow

The CLI MUST require interactive confirmation before displaying a mnemonic:

1. Display warning banner (cannot be suppressed)
2. Require user to type `"I understand the risks"` (exact string match)
3. Only then proceed with derivation

For non-interactive use (scripting), a `--yes-i-understand-the-risks` flag bypasses the prompt. This flag name is intentionally long and explicit.

### 7.4 Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Invalid arguments (empty wallet_name, unsupported chain, counter < 1) |
| 2 | Verification failure (double-derivation mismatch — implementation bug) |
| 3 | User cancelled (did not confirm warning) |

---

## 8. Guardrails

### 8.1 Mandatory Warnings

Every wallet derivation — on every platform — MUST display the following warning before showing results:

```
⚠️  DISASTER RECOVERY DERIVATION

This derives a wallet mnemonic from your master secret.

CRITICAL RISKS:
• If you lose or forget your master secret, ALL derived wallets
  and their funds are PERMANENTLY and IRRECOVERABLY LOST.
• There is NO recovery mechanism, NO support team, NO reset.
• This tool does NOT store your mnemonic or private keys.
• This is intended as DISASTER RECOVERY, not primary wallet management.

RECOMMENDED USAGE:
• Use a hardware wallet (Ledger, Trezor) for daily operations.
• Use this derivation ONLY to verify you can recover your mnemonic
  if your hardware wallet is lost or destroyed.
• NEVER send funds to a derived wallet without first verifying
  the addresses match your hardware wallet.
```

### 8.2 Confirmation Flow

| Platform | Confirmation mechanism |
|----------|----------------------|
| CLI | Type exact string `"I understand the risks"` |
| Browser extension | Checkbox + "I understand" button, 5-second delay before button becomes active |
| Android app | Checkbox + confirmation dialog with 3-second countdown |

### 8.3 Double-Derivation Verification

Before displaying any mnemonic or entropy to the user, implementations MUST:

```
entropy_1 = derive_wallet_entropy(secret, email, wallet_name, chain, counter)
entropy_2 = derive_wallet_entropy(secret, email, wallet_name, chain, counter)
assert entropy_1 == entropy_2, "CRITICAL: Derivation mismatch detected"
```

This catches:
- Non-determinism bugs (race conditions, uninitialized memory, thread-safety issues)
- Implementation bugs in the Argon2id or HMAC path (e.g., mutable state corruption)
- Certain classes of hardware faults (though note: a persistent memory corruption affecting both calls identically would NOT be caught)

**Limitation:** This check does NOT reliably detect single-bit memory corruption — if the same RAM cell is stuck, both derivations will produce the same wrong result. For true memory integrity, ECC RAM is required. The primary value of this check is catching software bugs that introduce non-determinism.

If the check fails, the derivation MUST abort with a clear error. Never display a potentially incorrect mnemonic.

### 8.4 Address Verification Step

After displaying the mnemonic, the UI SHOULD prompt:

```
VERIFICATION STEP (recommended):
Import this mnemonic into your wallet software and verify that
the first receiving address matches what you expect.

If this is your first time deriving this wallet, record the first
address for future verification.
```

### 8.5 No Clipboard for Mnemonics

Mnemonics MUST NOT be automatically copied to clipboard. The clipboard is a shared resource accessible to other applications. Users must manually select and copy if needed, with a clear warning:

```
⚠️  Copying a mnemonic to clipboard exposes it to other applications.
    Clear your clipboard immediately after use.
```

### 8.6 Screen Security

On mobile (Android):
- Set `FLAG_SECURE` on the activity displaying the mnemonic (prevents screenshots and screen recording)
- Clear the displayed mnemonic after 60 seconds or on background

On browser extension:
- Do not persist the mnemonic in any DOM element after the popup closes
- Clear the mnemonic from memory when the popup is closed

### 8.7 Audit Log

Every wallet derivation SHOULD be logged locally (without the mnemonic):

```json
{
  "action": "wallet_derivation",
  "timestamp": "2026-05-10T00:00:00Z",
  "wallet_name": "personal",
  "chain": "bitcoin",
  "counter": 1,
  "verification": "passed"
}
```

This helps users track which wallets they have derived and with what parameters.

---

## 9. Key Management

### 9.1 Conceptual Model

Each wallet derivation is identified by four parameters:

| Field | Purpose | Example |
|-------|---------|---------|
| `email` | Identity (same as all Keygrain derivations) | `user@example.com` |
| `wallet_name` | User-chosen label | `personal`, `savings`, `trading` |
| `chain` | Blockchain network | `bitcoin`, `ethereum`, `solana` |
| `counter` | Rotation counter | `1` (default), `2` (after rotation) |

### 9.2 Wallet Name Conventions

Wallet names are freeform labels (within constraints). Recommended patterns:

- Purpose-based: `personal`, `savings`, `trading`, `cold-storage`
- Account-based: `main`, `secondary`, `business`
- Platform-based: `coinbase-backup`, `ledger-recovery`

Constraints:
- Must match regex `^[a-z0-9\-]+$` (lowercase letters, digits, hyphens only)
- Non-empty
- Lowercased before derivation (input is lowercased, then validated against regex)
- Recommended ≤ 32 characters
- Colons and other punctuation are disallowed to prevent HMAC message delimiter ambiguity

### 9.3 Chain Isolation

Different chains produce completely independent entropy. Deriving `bitcoin` and `ethereum` wallets with the same `wallet_name` and `counter` produces unrelated mnemonics. This is by design — chain isolation prevents cross-chain correlation.

### 9.4 Counter Semantics

The counter enables wallet rotation:
- Counter `1` is the default (first wallet)
- Incrementing produces an entirely new, uncorrelated mnemonic
- Use case: if a mnemonic is compromised, increment counter and migrate funds

### 9.5 Relationship to Service Entries

Wallet derivations are **standalone** — they are NOT linked to service entries (unlike TOTP which attaches to a service). Wallets have their own parameter set and their own storage model (see §10).

---

## 10. Storage

### 10.1 What is Stored

| Data | Stored? | Where |
|------|---------|-------|
| Master secret | Never | User's memory |
| Wallet entropy | Never | Derived on demand |
| Mnemonic | Never | Derived on demand, displayed transiently |
| BIP-32 seed | Never | Derived on demand (by wallet software) |
| Private keys | Never | Derived by wallet software from mnemonic |
| `wallet_name` | Yes | Wallet entry metadata |
| `chain` | Yes | Wallet entry metadata |
| `counter` | Yes | Wallet entry metadata |
| `email` | Yes | Wallet entry metadata |

### 10.2 Wallet Entry Format

Wallet entries are stored in the encrypted config blob alongside service entries:

```json
{
  "wallets": [
    {
      "wallet_name": "personal",
      "chain": "bitcoin",
      "counter": 1,
      "email": "user@example.com",
      "mode": "mnemonic",
      "created_at": "2026-05-10T00:00:00Z",
      "notes": "Ledger backup"
    }
  ]
}
```

### 10.3 Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wallet_name` | string | Yes | User-chosen label |
| `chain` | string | Yes | Blockchain identifier (from enum) |
| `counter` | integer | Yes | Rotation counter (≥ 1) |
| `email` | string | Yes | Email used for derivation |
| `mode` | string | Yes | Derivation mode: `"mnemonic"` (default) or `"raw"` |
| `created_at` | string | Yes | ISO 8601 timestamp of first derivation |
| `notes` | string | No | User notes (e.g., "Ledger Nano X backup") |

### 10.4 What is NOT Stored

The mnemonic, entropy, seed, and any private keys are NEVER stored — not in the config blob, not in local storage, not in any cache. They are recomputed from the master secret every time they are needed.

The stored metadata (`wallet_name`, `chain`, `counter`) is non-sensitive. Knowing these values without the master secret reveals nothing about the wallet.

### 10.5 Sync Integration

Wallet entries sync with the existing encrypted config blob. The `wallets` array is a new top-level field alongside the existing services array:

```json
{
  "services": [...],
  "wallets": [...]
}
```

Same sync semantics as services: entire blob is encrypted with AES-256-GCM, synced as a unit. No server-side changes required.

### 10.6 Wallet Merge Semantics

Merge key: `wallet_name + chain` (case-insensitive, both already lowercased).

When syncing:
- If a wallet entry exists on both local and remote with the same `wallet_name + chain`: the entry with the most recent `created_at` wins.
- If a wallet entry exists only on remote (not in local known set): it's new from another device → add locally.
- If a wallet entry exists only locally with no remote match: it's new locally → include in push.
- Deletion: absence = deletion (same as services). A wallet entry previously synced but now missing from a push is deleted.

Note: `email` is NOT part of the merge key — it's global per-device. Two devices using different emails for the same wallet_name+chain is a misconfiguration, not a merge scenario.

### 10.7 Audit Log

Every wallet derivation is logged in the encrypted blob:

```json
{
  "services": [...],
  "wallets": [...],
  "wallet_audit_log": [
    {
      "action": "derive",
      "wallet_name": "personal",
      "chain": "bitcoin",
      "counter": 1,
      "timestamp": "2026-05-10T00:00:00Z",
      "verification": "passed"
    }
  ]
}
```

The audit log is append-only (new entries added, never removed). It syncs with the blob. Access via CLI: `keygrain wallet --history`.

---

## 11. BIP-85 Compatibility

### 11.1 Use Case

Users who already have a master BIP-39 mnemonic (e.g., stored on a hardware wallet) can derive child mnemonics using the BIP-85 standard. This provides compatibility with the SeedPass.me workflow.

### 11.2 BIP-85 Overview

BIP-85 (Deterministic Entropy From BIP32 Keychains) defines a standard way to derive child entropy from a master HD wallet:

```
1. Start with master mnemonic → BIP-32 master seed (via PBKDF2)
2. Derive child key at path: m/83696968'/39'/language'/words'/index'
3. Use HMAC-SHA512(key="bip-entropy-from-k", message=child_private_key)
4. Truncate to desired entropy length (16 bytes for 12 words, 32 bytes for 24 words)
5. Convert to BIP-39 mnemonic
```

### 11.3 Keygrain BIP-85 Derivation

For English BIP-39 mnemonics (12 or 24 words):

```
Path: m/83696968'/39'/0'/words'/index'

Where:
  83696968 = BIP-85 application number
  39       = BIP-39 application
  0        = English language
  words    = Number of words (12 or 24)
  index    = Child index (0-based)
```

Entropy length by word count:
- 12 words: 128 bits (16 bytes) of entropy + 4-bit checksum
- 24 words: 256 bits (32 bytes) of entropy + 8-bit checksum

### 11.4 Algorithm

```
function bip85_derive_mnemonic(master_mnemonic: string, index: int, words: int = 24, master_passphrase: string = "") -> string:
    // Step 1: Master mnemonic → BIP-32 seed
    seed = PBKDF2-SHA512(master_mnemonic, "mnemonic" + master_passphrase, 2048, 64)
    
    // Step 2: BIP-32 master key
    I = HMAC-SHA512(key="Bitcoin seed", message=seed)
    master_key = I[0:32]           // 32-byte private key scalar
    master_chain_code = I[32:64]   // 32-byte chain code
    
    // Step 3: Derive child at m/83696968'/39'/0'/words'/index'
    // (hardened derivation at each level)
    child_key = derive_hardened_child(master_key, master_chain_code, [83696968, 39, 0, words, index])
    // child_key is the 32-byte private key scalar at the derived path
    
    // Step 4: BIP-85 entropy derivation
    // Per BIP-85: key is the literal ASCII string, message is the 32-byte private key scalar
    entropy_raw = HMAC-SHA512(key=UTF8_ENCODE("bip-entropy-from-k"), message=child_key)
    
    // Step 5: Truncate to required entropy length
    // 12-word mnemonic = 128 bits = 16 bytes
    // 24-word mnemonic = 256 bits = 32 bytes
    entropy_bytes = 16 if words == 12 else 32
    entropy = entropy_raw[0:entropy_bytes]
    
    // Step 6: Convert to mnemonic
    return entropy_to_mnemonic(entropy)
```

**Important:** In Step 4, `child_key` is the **32-byte private key scalar** at the derived path — NOT the full serialized extended key (78 bytes) or the public key. This is the `k` value from BIP-32's CKDpriv function.

### 11.5 Interface

```python
def bip85_derive_mnemonic(
    master_mnemonic: str,
    *,
    index: int = 0,
    words: int = 24,
    master_passphrase: str = "",
) -> str:
    """Derive a child mnemonic from a master mnemonic using BIP-85.

    Args:
        master_mnemonic: 12 or 24-word BIP-39 mnemonic.
        index: Child index (0-based, default 0).
        words: Number of words in output (12 or 24, default 24).
            12-word: uses 16 bytes of entropy from HMAC-SHA512 output.
            24-word: uses 32 bytes of entropy from HMAC-SHA512 output.
        master_passphrase: BIP-39 passphrase for the master mnemonic (default empty).
            If the master mnemonic was created with a passphrase, it MUST be provided
            here — otherwise the derivation produces wrong results silently.

    Returns:
        Space-separated child mnemonic.

    Raises:
        ValueError: If words is not 12 or 24, or master_mnemonic is invalid.
    """
```

### 11.6 CLI

```bash
# Derive 24-word child mnemonic from master mnemonic (BIP-85)
$ keygrain wallet-bip85 --mnemonic "abandon abandon ... about" --index 0

⚠️  BIP-85 DERIVATION
Path: m/83696968'/39'/0'/24'/0'

Child Mnemonic (24 words):
[... 24 words ...]

# Derive 12-word child mnemonic
$ keygrain wallet-bip85 --mnemonic "abandon abandon ... about" --index 0 --words 12

⚠️  BIP-85 DERIVATION
Path: m/83696968'/39'/0'/12'/0'

Child Mnemonic (12 words):
[... 12 words ...]
```

### 11.7 Relationship to Main Keygrain Flow

BIP-85 mode is a **separate entry point** that does NOT use the Keygrain master secret or Argon2id strengthening. It accepts a BIP-39 mnemonic directly and applies the BIP-85 standard.

| Feature | Main Keygrain wallet | BIP-85 mode |
|---------|---------------------|-------------|
| Input | Master secret + email | Master mnemonic |
| Strengthening | Argon2id (mandatory) | None (PBKDF2 in BIP-39) |
| Derivation | HMAC-SHA256 | BIP-32 + BIP-85 |
| Storage needed | Master secret (memorized) | Master mnemonic (24 words) |
| Competitor | Novel approach | SeedPass.me equivalent |

---

## 12. Edge Cases

### 12.1 Invalid Inputs

| Condition | Behavior |
|-----------|----------|
| Empty `wallet_name` | Reject with error |
| `wallet_name` with invalid characters | Reject with error listing allowed characters: `[a-z0-9\-]` |
| Unsupported `chain` value | Reject with error listing supported chains |
| `counter < 1` | Reject with error |
| Empty `secret` | Reject with error |
| Empty `email` | Reject with error |

### 12.2 Chain Typos

Because chain is validated against an enum, typos are caught immediately:

```
$ keygrain wallet test@gmail.com --name personal --chain bitconi
Error: Unsupported chain "bitconi". Did you mean "bitcoin"?
Supported chains: bitcoin, ethereum, solana, litecoin, dogecoin, ...
```

Implementations SHOULD provide fuzzy-match suggestions for typos.

### 12.3 Double-Derivation Failure

If the double-derivation check fails (entropy_1 ≠ entropy_2):

```
CRITICAL ERROR: Derivation verification failed.
The same inputs produced different outputs. This indicates a serious
implementation bug or hardware memory corruption.

DO NOT use any previously derived mnemonics from this session.
Please report this error.
```

Exit immediately. Do not display any mnemonic.

### 12.4 Mnemonic Checksum Failure

If `entropy_to_mnemonic` produces a mnemonic that fails BIP-39 checksum validation:

This should be impossible (the checksum is computed from the entropy), but if it occurs, it indicates a bug in the implementation. Abort with error.

### 12.5 Invalid BIP-32 Master Key

If the BIP-32 master private key derived from the seed is zero or ≥ secp256k1 order n:

Probability: < 2⁻¹²⁷. If it occurs, increment counter and re-derive. Display a message explaining why counter was auto-incremented.

### 12.6 Master Secret Change

If the user changes their master secret, ALL previously derived wallets become inaccessible. The UI must warn:

```
⚠️  Changing your master secret will make ALL previously derived
    wallets unreachable. Ensure all funds are moved first.
```

### 12.7 Email Change

Changing the email used for derivation produces a completely different wallet. The UI must make clear which email is associated with each wallet entry.

### 12.8 Platform Crypto Availability

| Platform | BIP-39 wordlist | PBKDF2-SHA512 | HMAC-SHA256 |
|----------|----------------|---------------|-------------|
| Python | Bundled or `mnemonic` package | `hashlib.pbkdf2_hmac` | `hmac` stdlib |
| JS (extension) | Bundled (2048 words, ~12 KB) | Web Crypto `deriveBits` | Web Crypto `sign` |
| Kotlin (Android) | Bundled | `javax.crypto.SecretKeyFactory` | `javax.crypto.Mac` |

### 12.9 Large Counter Values

No upper limit on counter. However, the UI should warn if counter > 10 (suggests the user may be confused about the rotation model).

---

## 13. Test Plan

### 13.1 Wallet Entropy Derivation Vectors

All vectors use Argon2id strengthening from SPEC.md §3 (m=65536, t=3, p=1).

| # | secret (UTF-8) | email | wallet_name | chain | counter | expected entropy (hex) |
|---|---|---|---|---|---|---|
| 1 | `my-master-secret` | `test@gmail.com` | `personal` | `bitcoin` | 1 | *(to be computed from reference implementation)* |
| 2 | `my-master-secret` | `test@gmail.com` | `personal` | `ethereum` | 1 | *(must differ from #1 — chain isolation)* |
| 3 | `my-master-secret` | `test@gmail.com` | `personal` | `bitcoin` | 2 | *(must differ from #1 — counter rotation)* |
| 4 | `my-master-secret` | `test@gmail.com` | `savings` | `bitcoin` | 1 | *(must differ from #1 — wallet_name change)* |
| 5 | `my-master-secret` | `TEST@Gmail.com` | `Personal` | `Bitcoin` | 1 | *(must equal #1 — case normalization)* |
| 6 | `different-secret` | `test@gmail.com` | `personal` | `bitcoin` | 1 | *(must differ from #1 — secret change)* |

**Verification rules:**
- Vectors 1 and 5 MUST produce identical output (email, wallet_name, chain case normalization)
- All other pairs MUST produce different output
- Each vector's entropy must pass BIP-39 checksum validation when converted to mnemonic

### 13.2 HMAC Message Strings

For implementor debugging — the exact message bytes fed to HMAC-SHA256:

| # | Message (UTF-8) |
|---|---|
| 1 | `test@gmail.com:personal:bitcoin:1:keygrain-wallet` |
| 2 | `test@gmail.com:personal:ethereum:1:keygrain-wallet` |
| 3 | `test@gmail.com:personal:bitcoin:2:keygrain-wallet` |
| 4 | `test@gmail.com:savings:bitcoin:1:keygrain-wallet` |

### 13.3 BIP-39 Mnemonic Vectors

Using known entropy → mnemonic test vectors from the BIP-39 specification:

| Entropy (hex) | Expected mnemonic (first 4 words) |
|---|---|
| `0000000000000000000000000000000000000000000000000000000000000000` | `abandon abandon abandon abandon ...` |
| `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff` | `zoo zoo zoo zoo ...` |
| `7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f` | `legal winner thank year ...` |

Full 24-word mnemonics for these vectors are defined in the BIP-39 test vectors repository.

### 13.4 BIP-39 Seed Derivation Vectors

From the BIP-39 specification (passphrase = "TREZOR"):

| Mnemonic | Passphrase | Expected seed (hex, first 16 bytes) |
|---|---|---|
| `abandon abandon ... about` (all "abandon" × 23 + "about") | `TREZOR` | `c55257c360c07c72...` |

Note: Keygrain uses empty passphrase by default, but the test suite should verify PBKDF2 correctness using the standard BIP-39 test vectors with passphrase.

### 13.5 BIP-85 Vectors

From the BIP-85 specification test vectors:

| Master mnemonic | Path | Expected child entropy (hex) |
|---|---|---|
| *(BIP-85 spec test vector)* | `m/83696968'/39'/0'/24'/0'` | *(from BIP-85 spec)* |

### 13.6 Cross-Platform Validation

A `wallet-vectors.json` file will be committed to the repository root containing:
- All entropy derivation vectors with exact hex values
- Corresponding 24-word mnemonics
- HMAC message strings in hex

All platform implementations MUST pass these vectors identically.

### 13.7 Integration Tests

| Test | Assertion |
|------|-----------|
| Same inputs → same mnemonic (determinism) | Derive twice, compare |
| Different chain → different mnemonic | `bitcoin` ≠ `ethereum` for same params |
| Different wallet_name → different mnemonic | `personal` ≠ `savings` for same params |
| Counter increment → different mnemonic | counter=1 ≠ counter=2 |
| Case normalization | `Bitcoin` = `bitcoin`, `Personal` = `personal` |
| Invalid chain rejected | `bitconi` → error |
| Empty wallet_name rejected | `""` → error |
| Invalid wallet_name characters rejected | `"my wallet"` → error, `"my:wallet"` → error, `"MY_WALLET"` → error |
| Mnemonic checksum valid | All derived mnemonics pass BIP-39 validation |
| Double-derivation passes | entropy_1 == entropy_2 for all test cases |

---

## 14. Security Considerations

### 14.1 Threat Model

| Threat | Protection | Residual risk |
|--------|-----------|---------------|
| Brute-force master secret | Argon2id (64 MiB, 3 iterations) | Weak secrets (< 6 chars) still vulnerable |
| Multi-target attack | Email in Argon2id salt | Per-user attack cost |
| Compromised device (memory) | None — accepted limitation | Attacker gets all wallet entropy |
| Stolen config blob | AES-256-GCM encryption | Only metadata exposed (wallet_name, chain) |
| Network eavesdropping | Mnemonic never transmitted | No network exposure |
| Clipboard theft | Mnemonic not auto-copied | User must manually copy |
| Screen capture | FLAG_SECURE (Android) | Desktop has no equivalent |
| Supply chain attack | Deterministic derivation is verifiable | User can verify on multiple implementations |

### 14.2 Comparison with Hardware Wallets

| Property | Hardware wallet | Keygrain wallet derivation |
|----------|----------------|---------------------------|
| Key generation | Random (TRNG on device) | Deterministic (from master secret) |
| Mnemonic storage | Physical backup required | No storage — recomputed |
| Single point of failure | Physical backup (fire, theft) | Master secret (memory) |
| Transaction signing | On-device (air-gapped) | NOT supported — Keygrain is not a wallet |
| Recovery from loss | Import mnemonic to new device | Re-derive mnemonic from master secret |
| Multi-device access | One device at a time | Any device with master secret |
| Compromise blast radius | One wallet | ALL wallets (master secret = everything) |

### 14.3 The Master Secret Single Point of Failure

This is the fundamental security tradeoff:

**Traditional:** 24-word mnemonic stored physically. Risk: physical theft, fire, flood.
**Keygrain:** Master secret memorized. Risk: forgetting, cognitive decline, death.

Neither approach is strictly superior. Keygrain is best used as a **complement** to physical backup — not a replacement. The recommended workflow:

1. Generate wallet with hardware wallet (random mnemonic)
2. Store mnemonic physically (metal plate, safe)
3. ALSO configure Keygrain to derive the same wallet parameters
4. Verify Keygrain derivation produces the same mnemonic
5. If physical backup is lost → recover from Keygrain
6. If master secret is forgotten → recover from physical backup

### 14.4 Why NOT Primary Wallet Management

Keygrain should NOT be used as the primary wallet because:

1. **No transaction signing:** Keygrain derives keys but cannot sign transactions. The mnemonic must be imported into wallet software, which then holds the private keys in memory.
2. **Blast radius:** Compromising the master secret compromises ALL wallets simultaneously. A hardware wallet limits compromise to one device.
3. **No air-gap:** Keygrain runs on general-purpose computers connected to the internet. Hardware wallets are air-gapped.
4. **Human memory is fragile:** A memorized secret can be forgotten. Physical backups are more reliable for long-term storage.

### 14.5 Entropy Quality

The 32-byte entropy from HMAC-SHA256 has full 256-bit security assuming:
- The master secret has sufficient entropy (recommended: ≥ 128 bits)
- Argon2id strengthening is not bypassed
- The HMAC-SHA256 implementation is correct

For a typical master secret (passphrase with 40-80 bits of entropy), Argon2id adds ~20 bits of effective security (at 1s/guess). This gives ~60-100 bits of effective security — adequate for most threat models but below the 128-bit ideal.

**Recommendation:** Users storing significant funds should use a high-entropy master secret (≥ 20 random characters or a 6+ word diceware passphrase).

### 14.6 Forward Secrecy

There is none. Compromising the master secret at any point reveals all past and future wallet derivations. This is inherent to deterministic derivation and cannot be mitigated without adding state (which defeats the purpose).

### 14.7 Quantum Resistance

- **HMAC-SHA256:** Grover's algorithm reduces 256-bit security to 128-bit. Still adequate.
- **Argon2id:** Memory-hard functions are believed to be quantum-resistant.
- **BIP-32/secp256k1:** Vulnerable to Shor's algorithm. This is a Bitcoin/Ethereum problem, not a Keygrain problem. When quantum computers threaten secp256k1, the entire cryptocurrency ecosystem must migrate.
- **Ed25519 (Solana):** Also vulnerable to Shor's algorithm.

Keygrain's derivation layer (Argon2id + HMAC-SHA256) remains secure against quantum attacks. The vulnerability is in the downstream cryptography (secp256k1, Ed25519) used by the blockchains themselves.

---

## 15. Platform-Specific Notes

### 15.1 Python (CLI + Library)

**Capabilities:**
- Full CLI with interactive confirmation flow
- All derivation functions (entropy, mnemonic, seed, BIP-85)
- Reference implementation for test vector generation

**Dependencies:**
- `argon2-cffi` — Argon2id (already a dependency)
- `mnemonic` package (or bundled wordlist) — BIP-39 wordlist and mnemonic operations
- `hashlib` — PBKDF2-SHA512, SHA-256, HMAC-SHA256 (stdlib)

**BIP-85 support:** Requires BIP-32 hardened child derivation. Uses `coincurve` for secp256k1 operations (optional dependency: `pip install keygrain[bip85]`).

### 15.2 JavaScript (Browser Extension)

**Capabilities:**
- Derive and display mnemonic (with full guardrail UI)
- Copy mnemonic (with warning)
- Wallet entry management (CRUD in encrypted storage)
- NO BIP-85 mode (requires secp256k1 — too heavy for extension)

**Dependencies:**
- BIP-39 wordlist: bundled as JSON array (~12 KB)
- PBKDF2-SHA512: Web Crypto API (`crypto.subtle.deriveBits`)
- HMAC-SHA256: Web Crypto API (`crypto.subtle.sign`)
- SHA-256: Web Crypto API (`crypto.subtle.digest`)

**BIP-85 consideration:** Uses `@noble/secp256k1` (~20 KB, audited by Trail of Bits) for BIP-32 hardened derivation. Bundled as a vendored library alongside tweetnacl.

### 15.3 Kotlin (Android App)

**Capabilities:**
- Full derivation with native UI guardrails
- FLAG_SECURE for mnemonic display
- Biometric confirmation before derivation (optional)
- Wallet entry management synced with config blob

**Dependencies:**
- `javax.crypto.Mac` — HMAC-SHA256
- `javax.crypto.SecretKeyFactory` — PBKDF2-SHA512
- `java.security.MessageDigest` — SHA-256
- BIP-39 wordlist: bundled as resource file
- BIP-85: NOT supported on Android (secp256k1 dependency too heavy for mobile)

### 15.4 Platform Feature Matrix

| Feature | Python CLI | Browser Extension | Android App |
|---------|-----------|-------------------|-------------|
| Derive mnemonic | ✓ | ✓ | ✓ |
| Derive raw entropy | ✓ | ✓ | ✓ |
| BIP-39 seed derivation | ✓ | ✓ | ✓ |
| BIP-85 compatibility | ✓ (`coincurve`) | ✓ (`@noble/secp256k1`) | ✗ (secp256k1 too heavy) |
| Double-derivation check | ✓ | ✓ | ✓ |
| Interactive confirmation | ✓ (stdin) | ✓ (UI) | ✓ (dialog) |
| Screen security | ✗ | ✗ | ✓ (FLAG_SECURE) |
| Wallet entry storage | ✗ (CLI is stateless) | ✓ | ✓ |
| Address verification | ✗ (deferred) | ✗ | ✗ |
| Audit log | ✗ | ✓ (encrypted blob) | ✓ (encrypted blob) |

**BIP-85 libraries:**
- Python: `coincurve` (optional dependency: `pip install keygrain[bip85]`)
- JavaScript: `@noble/secp256k1` (~20 KB, audited by Trail of Bits)
- Android: NOT supported (secp256k1 dependency too heavy for mobile)

---

## Appendix A: BIP-39 English Wordlist

The complete 2048-word BIP-39 English wordlist is defined at:
https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt

Implementations MUST bundle this wordlist (not fetch it at runtime). The wordlist is immutable — it will never change.

**Integrity verification:** Implementations MUST verify the bundled wordlist at build time (or first use) against the canonical SHA-256 hash:

```
SHA-256(english.txt) = 2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda
```

If the hash does not match, the build MUST fail (or the runtime MUST abort before any mnemonic generation). A corrupted wordlist would produce valid-looking but incorrect mnemonics — a silent, catastrophic failure mode.

---

## Appendix B: Derivation Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     MNEMONIC MODE (Primary)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  master_secret ──→ Argon2id ──→ strengthened_key                │
│                     (64 MiB, t=3, p=1)                          │
│                                                                  │
│  strengthened_key + message ──→ HMAC-SHA256 ──→ 32-byte entropy │
│                                                                  │
│  entropy ──→ BIP-39 ──→ 24-word mnemonic                       │
│                                                                  │
│  mnemonic ──→ PBKDF2-SHA512 ──→ 64-byte BIP-32 seed            │
│                (2048 iterations)                                  │
│                                                                  │
│  BIP-32 seed ──→ [wallet software] ──→ HD wallet tree           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     RAW SEED MODE (Advanced)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  master_secret ──→ Argon2id ──→ strengthened_key                │
│                                                                  │
│  strengthened_key + message ──→ HMAC-SHA256 ──→ 32-byte seed    │
│                                                                  │
│  32-byte seed ──→ [wallet software] ──→ keys                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     BIP-85 MODE (Compatibility)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  master_mnemonic ──→ PBKDF2 ──→ BIP-32 seed                    │
│                                                                  │
│  BIP-32 seed ──→ derive m/83696968'/39'/0'/24'/index'           │
│                                                                  │
│  child_key ──→ HMAC-SHA512("bip-entropy-from-k") ──→ entropy   │
│                                                                  │
│  entropy[0:32] ──→ BIP-39 ──→ 24-word child mnemonic           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Appendix C: Disclaimer Text (Legal)

The following disclaimer MUST be displayed on first use of wallet derivation features and MUST be accepted before any derivation occurs:

```
DISCLAIMER

This software provides deterministic cryptographic derivation as a
disaster recovery tool. It is NOT a cryptocurrency wallet and does
NOT manage, custody, or transmit funds.

BY USING THIS FEATURE, YOU ACKNOWLEDGE AND ACCEPT:

1. Loss of your master secret results in PERMANENT, IRRECOVERABLE
   loss of access to all derived wallets and their contents.

2. This software is provided "AS IS" without warranty of any kind.
   The developers accept NO LIABILITY for lost funds, incorrect
   derivations, or any other damages arising from use.

3. You are solely responsible for verifying derived mnemonics
   against your wallet software before relying on them.

4. This feature is intended as BACKUP/DISASTER RECOVERY only.
   Primary wallet management should use dedicated hardware wallets.

5. Cryptocurrency transactions are irreversible. Funds sent to
   incorrect addresses cannot be recovered by anyone.

6. Cryptocurrency regulations vary by jurisdiction. You are solely
   responsible for compliance with applicable laws in your region.
```
