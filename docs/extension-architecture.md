# Keygrain Browser Extension — Architecture & Lifecycle Specification

## 1. Executive Summary & Core Philosophy

The Keygrain browser extension is built on a **Worker-Authoritative Execution Model** with **Zero Plaintext Persistence** and **Ephemeral Dual-Tier Lease State Machines**. Unlike conventional password managers that persist static password vaults locally or synchronize unencrypted records across processes, Keygrain derives cryptographic secrets (passwords, TOTP seeds, Ed25519 SSH keys, BIP-39 cryptocurrency wallets) on demand directly from a single master secret combined with service metadata.

All sensitive cryptographic operations, lease enforcement, and credential derivations occur strictly within the privileged background context (Service Worker in Chrome, Event Page in Firefox). Untrusted extension projection clients (popup, options, content scripts) communicate with the background worker using cryptographically separated ingress envelopes and bounded single-use nonces.

```mermaid
graph TB
    subgraph UntrustedWebPage["Target Web Page (Untrusted Origin)"]
        DOM["Web Page DOM / Password Input"]
        CS["Keygrain Content Script (content.js)"]
    end

    subgraph ExtensionUI["Extension UI (Transient Client)"]
        POPUP["Popup UI (popup.js / popup.html)"]
        OPTIONS["Options / Settings Modal"]
        MIGRATE["Migration Assistant (migrate.js)"]
    end

    subgraph ExtensionWorker["Background Authority (Privileged Process)"]
        INGRESS["KeygrainWorkerIngress<br/>(RSA-OAEP + AES-256-GCM Decryption)"]
        SM["KeygrainStateManager<br/>(Ephemeral Lease State Machine)"]
        OWNER["KeygrainBrowserOwner<br/>(Dispatch, Auto-Lock, Reconcile)"]
        CRYPTO["Core Crypto Engine<br/>(Argon2id, HMAC-SHA256, Ed25519)"]
        ALARM["Alarms / Wake Reconciler"]
    end

    subgraph StorageLayer["Browser Storage Boundaries"]
        LOCAL["chrome.storage.local<br/>(AES-256-GCM Encrypted Blobs Only)"]
        SESSION["chrome.storage.session<br/>(Encrypted Ephemeral Lease Cache)"]
    end

    POPUP -->|"1. Request Challenge"| OWNER
    OWNER -->|"2. Issue Ephemeral RSA-2048 Public Key"| POPUP
    POPUP -->|"3. Encrypted Unlock Envelope (AES-256-GCM + OAEP Key)"| INGRESS
    INGRESS -->|"4. Plaintext Secret to Memory"| SM
    SM -->|"5. Argon2id Strengthening"| CRYPTO
    SM -->|"6. Save Ephemeral Lease (Restoration on Wake)"| SESSION
    OWNER -->|"7. Read/Write Encrypted Service Blobs"| LOCAL
    POPUP -->|"8. Tokenized Actions (Get Services / State)"| OWNER
    CS -->|"9. Context Probe & Proof (Tab + Document Binding)"| OWNER
    OWNER -->|"10. Single-Use Nonce Delivery"| CS
    CS -->|"11. Dispatch Input Event"| DOM
```

---

## 2. Manifest V3 Background Lifecycle Divergence

A critical architectural split exists between Chromium browsers and Mozilla Firefox under Manifest V3 (MV3). The background execution models operate under fundamentally different lifecycles and messaging primitives.

```mermaid
sequenceDiagram
    participant UI as Popup / Web Content (UI)
    participant BG as Background Worker / Event Page
    participant Session as chrome.storage.session
    participant Server as Sync Server

    UI->>BG: Wake / Message (Request Unlock)
    activate BG
    BG->>BG: Validate Master Secret (Crypto Ingress)
    BG->>Session: Store Secret & Extended Lease Time
    BG->>Server: Sync Check (ETag Match)
    Server-->>BG: Sync OK
    BG-->>UI: Return Unlocked State
    deactivate BG

    Note over BG: Chrome suspends service worker after ~30s of inactivity<br/>Firefox unloads event page when idle

    UI->>BG: Wake / Message (Request Autofill)
    activate BG
    BG->>Session: Read Secret & Lease Time
    BG->>BG: Explicit State Reconciliation (_reconcile)
    alt Lease Valid
        BG-->>UI: Return Autofill Data
    else Lease Expired
        BG->>Session: Clear Secret
        BG-->>UI: Return Locked State
    end
    deactivate BG
```

### 2.1 Chrome: Ephemeral Service Workers

- **Lifecycle & Execution Window**: Chrome MV3 background scripts run as standard Web Service Workers (`service_worker` in `manifest.json`). They are stateless and ephemeral; the browser forcibly terminates worker processes after approximately 30 seconds of inactivity or during memory pressure.
- **State Reconstitution**: Background worker memory is lost on termination. To preserve active session leases across worker restarts without writing secrets to persistent disk, `KeygrainStateManager` writes encrypted ephemeral lease state to `chrome.storage.session`. When woken up by an alarm, message, or user action, the background worker restores its in-memory lease and state directly from session storage.
- **IPC Messaging Protocol**: Asynchronous runtime message listeners (`chrome.runtime.onMessage.addListener`) **must return `true`** synchronously to signal to the browser that the response channel will be answered asynchronously via `sendResponse`.

### 2.2 Firefox: Event Pages (MV3)

- **Lifecycle & Execution Model**: Firefox MV3 utilizes non-persistent Background Event Pages (`scripts` in `manifest.json`). While they unload when idle, their lifecycle hooks and runtime messaging semantics differ significantly from Chrome.
- **Promise-Based IPC**: In Firefox MV3, asynchronous message listeners **must return a `Promise`** (such as `startupPromise.then(...)`) rather than returning `true`. Returning `true` causes the IPC channel to immediately close before asynchronous processing completes, causing autofill and unlock timeouts.
- **Unified Session API**: Firefox supports `browser.storage.session` (in-memory, cleared on browser exit). The background implementation leverages this to maintain a unified state cache between both browser builds.

> [!IMPORTANT]
> **Architectural Separation**: `extension/chrome/background.js` and `extension/firefox/background.js` must remain separate entrypoints. Attempting to merge them into a single monolithic script breaks asynchronous IPC semantics across browser runtimes.

---

## 3. Cryptographic Domain Separation

Keygrain enforces strict cryptographic domain separation across all derived secrets. Every derivation branches from the root Argon2id-strengthened key using a unique domain suffix and purpose label in HMAC-SHA256.

```mermaid
graph TD
    SECRET["Master Secret + Email"]
    SALT["Salt = 'keygrain-strengthen:' + Email"]
    ARGON["Argon2id Key Derivation<br/>m=65536 KiB (64 MiB), t=3, p=1, out=32B"]
    STRENGTHENED["Strengthened Master Key (32 Bytes in Memory)"]

    SECRET --> ARGON
    SALT --> ARGON
    ARGON --> STRENGTHENED

    STRENGTHENED -->|"HMAC-SHA256(Key, site + email + counter)"| PASS["Password Derivation (Rejection Sampling + Shuffle)"]
    STRENGTHENED -->|"HMAC-SHA256(Key, site + email + ':keygrain-totp')"| TOTP["TOTP Seed (RFC 6238 HMAC-SHA1)"]
    STRENGTHENED -->|"HMAC-SHA256(Key, site + email + ':keygrain-ssh')"| SSH["Ed25519 SSH Keypair"]
    STRENGTHENED -->|"HMAC-SHA256(Key, site + email + ':keygrain-wallet')"| WALLET["BIP-39 HD Wallet Mnemonic"]
    STRENGTHENED -->|"HMAC-SHA256(Key, email + ':keygrain-local-storage')"| LOCAL_ENC["Local Storage AES-256-GCM Key"]
    STRENGTHENED -->|"HMAC-SHA256(Key, email + ':keygrain-encryption')"| SYNC_ENC["Sync Server AES-256-GCM Key"]
    STRENGTHENED -->|"HMAC-SHA256(Key, email + ':keygrain-id')"| LOOKUP_ID["Sync Lookup ID (SHA-256)"]
    STRENGTHENED -->|"HMAC-SHA256(Key, email + ':keygrain-auth')"| AUTH_PW["Sync Auth Password (bcrypt)"]
```

### 3.1 Domain Separation Registry

| Purpose | HMAC-SHA256 Derivation Input | Output / Encoding | Description |
| :--- | :--- | :--- | :--- |
| **Password Derivation** | `site.toLowerCase() + ":" + email.toLowerCase() + ":" + length + ":" + counter` | Charset mapped & Fisher-Yates shuffled | Dynamic site passwords |
| **TOTP Seed** | `site.toLowerCase() + ":" + email.toLowerCase() + ":keygrain-totp"` | 20 bytes Base32 RFC 6238 | Two-factor authentication seeds |
| **SSH Keypair** | `site.toLowerCase() + ":" + email.toLowerCase() + ":keygrain-ssh"` | 32 bytes RFC 8032 Ed25519 / OpenSSH | Deterministic SSH keys |
| **HD Wallet** | `site.toLowerCase() + ":" + email.toLowerCase() + ":keygrain-wallet"` | BIP-39 English 12/24 words | Cryptocurrency seed mnemonics |
| **Local Storage Key** | `email.toLowerCase() + ":keygrain-local-storage"` | 32 bytes AES-256-GCM key | Encrypts `chrome.storage.local` data |
| **Sync Encryption Key** | `email.toLowerCase() + ":keygrain-encryption"` | 32 bytes AES-256-GCM key | Encrypts sync blobs for server |
| **Lookup ID** | `email.toLowerCase() + ":keygrain-id"` | 64-char Hex (HMAC-SHA256) | Pseudonymous server account ID |
| **Auth Password** | `derivePassword(strengthened, email + ":32:keygrain-auth")` | 32-char string | HTTP Basic Auth password for server |

### 3.2 Worker Ingress Isolation

In `extension/shared/worker-ingress.js`, full unlock ingress and single-use metadata autofill ingress are isolated into completely independent factories (`createIngress` vs `createMetadataPasswordIngress`).

```mermaid
graph TD
    subgraph Shared Cryptography (Web Crypto API)
        CryptoCore[AES-GCM / RSA-OAEP / Argon2id]
    end

    subgraph Master Unlock Ingress
        M_Ingress[createIngress]
        M_Label[Label: KEYGRAIN-RSA-OAEP-LABEL-v1]
        M_AAD[AAD Prefix: KEYGRAIN-INGRESS-AAD-v1]
        
        M_Ingress -->|Uses| M_Label
        M_Ingress -->|Uses| M_AAD
        M_Ingress -->|Calls| CryptoCore
    end

    subgraph Metadata (Autofill) Ingress
        A_Ingress[createMetadataPasswordIngress]
        A_Label[Label: KEYGRAIN-METADATA-PASSWORD-OAEP-LABEL-v1]
        A_AAD[AAD Prefix: KEYGRAIN-METADATA-PASSWORD-AAD-v1]
        
        A_Ingress -->|Uses| A_Label
        A_Ingress -->|Uses| A_AAD
        A_Ingress -->|Calls| CryptoCore
    end

    Note over M_Ingress,A_Ingress: Separation prevents cross-protocol ciphertext attacks.<br/>Enforced by automated regression tests.
```

- **Invariant**: The two protocols use distinct RSA-OAEP labels, distinct AES-GCM Authenticated Additional Data (AAD) prefixes, and isolated memory sinks.
- **Contract Enforcement**: Test suite `extension/tests/test-worker-ingress.mjs` verifies that no code or reference sharing exists between the two ingress implementations.

---

## 4. State Reconciliation & Lease State Machine

### 4.1 Ephemeral Dual-Tier Lease State Machine

State transitions are governed by `KeygrainStateManager`:

```mermaid
stateDiagram-v2
    [*] --> Locked

    Locked --> Full : Encrypted Unlock Ingress (Master Secret + Email)
    
    state Full {
        [*] --> FullActive
        FullActive --> FullExpiring : Time >= FullDeadline - LeadTime
        FullExpiring --> FullActive : Extend Full Lease
    }

    Full --> Metadata : Full Lease Expiration (Countdown Reached)
    Full --> Metadata : User Action: Lock Sensitive Credentials
    
    state Metadata {
        [*] --> MetadataActive
        MetadataActive --> MetadataExpiring : Time >= MetaDeadline - LeadTime
        MetadataExpiring --> MetadataActive : Extend Metadata Lease
    }

    Metadata --> Full : Fast Full Unlock (Master Secret Re-entry)
    Metadata --> Locked : Metadata Lease Expiration
    
    Full --> Locked : User Action: Lock Everything / Logout
    Metadata --> Locked : User Action: Lock Everything / Logout
    
    Full --> Locked : Clock Rollback Detected (System Clock Drift)
    Metadata --> Locked : Clock Rollback Detected (System Clock Drift)
```

| State | In-Memory Cryptographic Data | Capabilities | Expiry Action |
| :--- | :--- | :--- | :--- |
| **`Locked`** | None. | None (Login prompt shown). | N/A |
| **`Full`** | Master secret, strengthened key, decrypted service records. | Autofill, derivation, CRUD, Sync. | Transitions to `Metadata` state; sensitive secrets wiped. |
| **`Metadata`** | Non-sensitive metadata only (`id`, `site`, `name`, `email`). | Search & list services; no derivation. | Transitions to `Locked` state; all metadata wiped. |

### 4.2 Explicit State Reconciliation

Every public method on `KeygrainStateManager` executes an explicit reconciliation cycle before serving requests:

```javascript
const now = this._readNow();
this._reconcile(now);
```

- **Anti-Bypass Invariant**: Explicit check ensures no operation (autofill, copy, export, sync) executes against an expired lease.
- **Clock Rollback Detection**: If system time moves backwards relative to the internal monotonic reference, `_reconcile` invalidates all active leases immediately and transitions to `Locked`.
- **No Metaprogramming**: State reconciliation avoids dynamic proxies or decorators to preserve deterministic stack traces and prevent V8 JIT optimization deoptimizations.

---

## 5. Message Ingress & Secure Autofill Flow

### 5.1 Hybrid Encrypted Ingress Handshake

Master secrets submitted via the popup UI never travel across IPC channels in plaintext:

```mermaid
sequenceDiagram
    autonumber
    participant Popup as Extension Popup (popup.js)
    participant Ingress as KeygrainWorkerIngress
    participant Worker as Background Owner (background.js)
    participant Storage as chrome.storage.local

    Popup->>Worker: keygrain.popup.challenge (popupSessionId)
    Worker->>Ingress: createIngressChallenge(sender)
    Ingress->>Ingress: Generate Ephemeral RSA-OAEP 2048-bit Keypair
    Ingress-->>Popup: { challengeId, publicKeySpki, expiresAt }
    
    Note over Popup: User enters master secret & email
    Popup->>Popup: Generate Ephemeral AES-256-GCM Key (K_e)
    Popup->>Popup: Encrypt { email, secret } using AES-GCM (K_e, AAD="KEYGRAIN-INGRESS-AAD-v1\0")
    Popup->>Popup: Encrypt K_e using RSA-OAEP (publicKeySpki, Label="KEYGRAIN-RSA-OAEP-LABEL-v1")
    Popup->>Popup: Clear input fields from DOM immediately
    
    Popup->>Worker: keygrain.popup.unlockEncrypted({ challengeId, encryptedKey, iv, ciphertext, tag })
    Worker->>Ingress: decryptAndValidate(envelope, sender)
    Ingress->>Ingress: Decrypt K_e with RSA Private Key
    Ingress->>Ingress: Decrypt Payload with K_e and verify AAD
    Ingress->>Ingress: Destroy RSA Private Key immediately
    Ingress-->>Worker: Plaintext { email, secret }
    
    Worker->>Worker: Argon2id Key Derivation
    Worker->>Storage: Read Encrypted Services Blob
    Worker->>Worker: Decrypt Services with AES-256-GCM
    Worker->>Worker: Initialize Full Lease State in KeygrainStateManager
    Worker-->>Popup: { ok: true, state: "full" }
```

### 5.2 Context Probe & Bounded Autofill Delivery

Content scripts running in untrusted web pages cannot query credentials directly:

```mermaid
sequenceDiagram
    autonumber
    participant WebPage as Target Web Page (DOM)
    participant CS as Content Script (content.js)
    participant Background as Background Owner (background.js)
    participant Crypto as Derivation Engine

    WebPage->>CS: User focuses Login Form / Password Field
    CS->>CS: Identify matching service candidate from cached metadata
    CS->>Background: keygrain.password.contextProbe({ tabUrl, formSignature })
    
    Background->>Background: Verify active tab origin against service domain (eTLD+1)
    Background->>Background: Ensure State is "Full"
    Background-->>CS: { challenge: random_nonce_128bit, serviceId }
    
    CS->>Background: keygrain.password.contextProof({ challenge, documentId/nonce, hasPasswordField: true })
    Background->>Crypto: Derive Password Just-In-Time (Argon2id + HMAC-SHA256)
    Background->>Background: Generate Single-Use Delivery Nonce (TTL: 30s)
    Background-->>CS: { deliveryNonce, password }
    
    CS->>WebPage: Inject Password via Native Property Descriptor
    CS->>CS: Dispatch 'input' and 'change' Events
    CS->>CS: Overwrite password variable in memory with null
    CS->>Background: keygrain.password.fillResult({ deliveryNonce, success: true })
    Background->>Background: Invalidate Delivery Nonce
```

- **Origin Binding (eTLD+1)**: Passwords are only derived for verified top-level private domains matching the active tab.
- **Framework-Safe Injection**: Injected via `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` to trigger standard React, Angular, and Vue state listeners without exposing credentials to untrusted page scripts.
- **Single-Use Delivery Nonce**: Credentials are bound to a short-lived nonce (30s TTL) invalidated upon first use.

---

## 6. Worker Suspension & Resumption Flow

```mermaid
graph TD
    A[Worker Inactive / Idle] -->|Browser Suspends Process| B[Memory Cleared by OS]
    C[User Clicks Extension Icon / Alarm Triggers] -->|Browser Restarts Worker| D[Worker Startup Reconciler]
    D -->|Read Ephemeral State| E[chrome.storage.session]
    E -->|Check Expiry & Monotonic Clock| F{Is Lease Valid?}
    F -->|Expired or Tampered| G[Wipe Session & Enter 'Locked' State]
    F -->|Valid Remaining Time| H[Restore Ephemeral Lease with Exact Remaining Seconds]
    H -->|Update Badge & State| I[Ready for User Action]
```

1. **Session-Scoped Storage**: Ephemeral state cached exclusively in `chrome.storage.session` (in-memory, never persisted to disk).
2. **Exact Expiration Tracking**: Leases store absolute expiration timestamps (`expiresAt`). Waking from suspension recalculates remaining seconds (`expiresAt - now()`), preventing worker suspension from artificially extending lease lifetime.
3. **Entropy Invariants**: Security nonces and confirmation IDs are generated exclusively via Web Crypto (`crypto.randomUUID()` and `crypto.getRandomValues()`). `Math.random()` is prohibited.

---

## 7. Cross-References

- [System Architecture](architecture.md) — High-level system overview, server sync protocol, and global threat model.
- [Algorithm Specification](../SPEC.md) — Mathematical specification of Argon2id and deterministic password derivation.
- [Extension User Guide](user-guide-extension.md) — Practical user workflows and extension features.
