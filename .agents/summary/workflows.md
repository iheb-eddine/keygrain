# Keygrain — Workflows

## Password Derivation Flow

```mermaid
flowchart TD
    A[User provides secret + email + site + params] --> B{Strengthen cache hit?}
    B -->|Yes| D[Use cached strengthened key]
    B -->|No| C[Argon2id: secret + salt=keygrain-strengthen:email]
    C --> D
    D --> E[Build message: site:email:length:counter]
    E --> F[HMAC-SHA256: key=strengthened, msg=message]
    F --> G[Stream: key || HMAC(key, counter) extensions]
    G --> H[Force 1 char per category: UPPER, LOWER, DIGIT, SYMBOL]
    H --> I[Fill remaining from full charset via rejection sampling]
    I --> J[Fisher-Yates shuffle]
    J --> K[Return password string]
```

## Sync Flow (Extension/Mobile)

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    C->>C: Derive lookup_id, auth_password, encryption_key
    C->>S: GET /api/sync/:lookup_id (Basic auth)

    alt First sync (404)
        C->>C: Encrypt local services → blob
        C->>S: PUT /api/sync/:lookup_id (no If-Match)
        S->>S: bcrypt(auth_password), store blob
        S-->>C: 201 Created + ETag
    else Existing (200)
        S-->>C: 200 + encrypted_blob + ETag
        C->>C: Decrypt blob with encryption_key
        C->>C: Merge: per-service by UUID, latest updated_at wins
        C->>C: Re-encrypt merged services → new blob
        C->>S: PUT /api/sync/:lookup_id (If-Match: etag)
        alt ETag matches
            S-->>C: 200 OK + new ETag
        else Conflict
            S-->>C: 409 + current_etag
            C->>S: GET (re-fetch)
            C->>C: Re-merge and retry PUT
        end
    end
```

## Extension Unlock + Autofill Flow

```mermaid
flowchart TD
    A[User clicks extension icon] --> B{PIN set?}
    B -->|Yes| C[Enter PIN]
    B -->|No| D[Enter master secret + email]
    C --> E[Decrypt secret from PIN-encrypted storage]
    D --> F[Store secret in session]
    E --> F
    F --> G[Derive secret fingerprint for visual confirmation]
    G --> H[Show service list with fuzzy search]
    H --> I{User action}
    I -->|Fill| J[Derive password for selected service]
    I -->|Copy| K[Derive + copy to clipboard + 30s clear]
    I -->|Ctrl+Shift+K| L[Auto-detect site from active tab URL]
    J --> M[Inject into active tab via content script]
    L --> N[Match service by domain]
    N --> J
```

## Cross-Platform Test Verification (CI)

```mermaid
flowchart TD
    A[Push to any branch] --> B[checksum-gate]
    B -->|Verify SHA-256| C{vectors.json + SPEC.md unchanged?}
    C -->|No| FAIL[Pipeline fails]
    C -->|Yes| D[test-python: pytest + baseline check]
    C -->|Yes| E[test-js: node test.mjs + baseline check]
    C -->|Yes| F[test-go: go test + baseline check]
    C -->|Yes| G[test-cross-platform]
    G --> H[Python derives 9 vectors → stdout]
    G --> I[Node derives 9 vectors → stdout]
    H --> J{Outputs identical?}
    I --> J
    J -->|No| FAIL
    J -->|Yes| PASS[All tests pass]
    D --> PASS
    E --> PASS
    F --> PASS
```

## Mobile Biometric Unlock Flow

```mermaid
flowchart TD
    A[App launch] --> B{Secret in EncryptedSharedPreferences?}
    B -->|No| C[Show onboarding wizard]
    B -->|Yes| D{Biometric available?}
    D -->|Yes| E[BiometricPrompt]
    D -->|No| F[Manual secret entry]
    E -->|Success| G[Load secret → main screen]
    E -->|Fail| F
    F --> G
    G --> H[Service list with search]
    H --> I[Tap service → derive + copy]
```

## Service Merge Strategy

Per-service merge by UUID, latest `updated_at` wins:

```mermaid
flowchart TD
    A[Local services + Remote services] --> B[Group by UUID]
    B --> C{For each UUID}
    C -->|Local only| D[Keep local, mark for upload]
    C -->|Remote only| E[Keep remote, add locally]
    C -->|Both exist| F{Compare updated_at}
    F -->|Local newer| D
    F -->|Remote newer| E
    F -->|Equal| G[Keep either, they are identical]
```

## Deployment Flow

```mermaid
flowchart LR
    A[Push to master] --> B[GitLab CI]
    B --> C[build-package: Go binary + Docker]
    B --> D[build-mobile: APK]
    C --> E[deploy]
    D --> E
    E --> F[SCP artifacts to server]
    F --> G[Run setup-server.sh if needed]
    G --> H[Run deploy.sh: docker compose up]
    H --> I[Copy APK to static/app/]
```
