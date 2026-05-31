# Keygrain — Data Models

## Service Entry

Stored per-device (extension: `chrome.storage.local`, Android: EncryptedSharedPreferences). Synced encrypted.

```mermaid
classDiagram
    class ServiceEntry {
        +String id (UUIDv4, client-generated via crypto.randomUUID())
        +String site
        +String email
        +int length (default: 20, min: 8)
        +String symbols (default: "!@#$%&*-_=+?")
        +int counter (default: 1, min: 1)
        +int updated_at (unix timestamp)
        +int frecency (access score)
    }
```

## Sync Blob (Server-Side)

On-disk format: one JSON file per user at `data/<lookup_id>.json`.

```mermaid
classDiagram
    class SyncRecord {
        +String auth_password_hash (bcrypt)
        +ServiceMetadata[] services
        +String encrypted_blob (base64)
        +String checksum (SHA-256 hex of decoded blob)
        +int version (auto-incremented)
    }

    class ServiceMetadata {
        +String|null id (UUIDv4)
        +int updated_at (unix timestamp)
    }

    SyncRecord "1" --> "*" ServiceMetadata
```

**Note:** `services` metadata (IDs + timestamps) is plaintext for merge logic. All actual service data (site, email, length, symbols) is inside `encrypted_blob` — opaque to the server.

## Encrypted Blob Format

```
base64( IV[12 bytes] || AES-256-GCM(plaintext) || GCM-tag[16 bytes] )
```

- Key: `HMAC-SHA256(strengthened, email + ":keygrain-encryption")`
- Plaintext: JSON array of full service entries + wallet audit log

## Wallet Data Models

```mermaid
classDiagram
    class WalletEntry {
        +String wallet_name
        +String chain (from SUPPORTED_CHAINS)
        +int counter
        +int updated_at
    }

    class WalletAuditEntry {
        +String wallet_name
        +String chain
        +int counter
        +String action (created|rotated)
        +int timestamp
    }
```

Supported chains: `bitcoin`, `ethereum`, `solana`, `litecoin`, `dogecoin`, `bitcoin-testnet`, `polkadot`, `cosmos`, `avalanche`

## TOTP Input Formats

The TOTP parser accepts multiple input formats:

| Format | Example | Handling |
|--------|---------|----------|
| OTPAuth URI | `otpauth://totp/GitHub:user?secret=BASE32&digits=6` | Full parse: algorithm, digits, period |
| Base32 seed | `JBSWY3DPEHPK3PXP` | SHA1, 6 digits, 30s period |
| Hex seed | `48656c6c6f21` | SHA1, 6 digits, 30s period |

```mermaid
classDiagram
    class TotpParams {
        +byte[] seed
        +String algorithm (SHA1|SHA256|SHA512)
        +int digits (6|8)
        +int period (default: 30)
    }
```

## Rate Limiter State

```mermaid
classDiagram
    class RateLimiter {
        +Map~String,Bucket~ buckets
        +float64 capacity
        +float64 refillRate
    }

    class Bucket {
        +float64 tokens
        +Time lastAccess
    }

    RateLimiter "1" --> "*" Bucket
```

Two instances: one keyed by IP, one keyed by lookup_id. Stale buckets evicted periodically.

## Test Vector Format

```mermaid
classDiagram
    class VectorsJSON {
        +StrengthenVector[] strengthen_vectors
        +DeriveVector[] vectors
        +FingerprintVector[] fingerprint_vectors
    }

    class DeriveVector {
        +String secret_hex
        +String secret_utf8
        +String site
        +String email
        +int length
        +String symbols
        +int counter
        +String expected (password)
    }
```

Separate files: `totp-vectors.json`, `ssh-vectors.json`, `wallet-vectors.json` follow similar patterns.
