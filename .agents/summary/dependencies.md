# Keygrain — Dependencies

## Python (`python/pyproject.toml`)

| Package | Version | Purpose |
|---------|---------|---------|
| `argon2-cffi` | ≥23.1.0 | Argon2id key strengthening |
| `cryptography` | ≥42.0.0 | Ed25519 key operations (SSH) |

**Dev dependencies (implicit):** pytest

**Standard library usage:** `hmac`, `hashlib`, `struct`, `secrets`, `os`, `sys`, `argparse`, `getpass`

## Kotlin/Android (`kotlin/app/build.gradle.kts`)

| Package | Version | Purpose |
|---------|---------|---------|
| `androidx.compose:compose-bom` | 2024.02.00 | Compose UI framework |
| `androidx.core:core-ktx` | 1.12.0 | Android core extensions |
| `androidx.activity:activity-compose` | 1.8.2 | Compose activity integration |
| `androidx.compose.material3:material3` | (BOM) | Material 3 design |
| `androidx.compose.material:material-icons-extended` | (BOM) | Icon set |
| `androidx.lifecycle:lifecycle-runtime-compose` | 2.7.0 | Lifecycle-aware compose |
| `androidx.lifecycle:lifecycle-viewmodel-compose` | 2.7.0 | ViewModel compose |
| `androidx.credentials:credentials` | 1.3.0 | Android Credential Manager |
| `androidx.security:security-crypto` | 1.1.0-alpha06 | EncryptedSharedPreferences |
| `androidx.biometric:biometric` | 1.1.0 | Biometric authentication |
| `androidx.fragment:fragment-ktx` | 1.6.2 | Fragment extensions |
| `androidx.datastore:datastore-preferences` | 1.0.0 | Key-value storage |
| `org.bouncycastle:bcprov-jdk18on` | 1.78.1 | Argon2id + Ed25519 (JVM) |
| `com.google.mlkit:barcode-scanning` | 17.2.0 | QR code scanning |
| `androidx.camera:camera-*` | 1.3.1 | CameraX for QR |
| `junit:junit` | 4.13.2 | Unit testing |
| `org.json:json` | 20231013 | JSON test parsing |

**Build:** Kotlin 1.9.22, compileSdk 34, minSdk 26, targetSdk 34, JVM 17

## Go Server (`server/go.mod`)

| Package | Version | Purpose |
|---------|---------|---------|
| `golang.org/x/crypto` | v0.31.0 | bcrypt for auth password hashing |

**Standard library:** `net/http`, `crypto/sha256`, `encoding/json`, `encoding/base64`, `sync`, `context`, `os`

## JavaScript/Browser Extension

No package manager (no `package.json`). Vendored libraries:

| Library | File | Purpose |
|---------|------|---------|
| hash-wasm (argon2) | `lib/hash-wasm-argon2.js` | Argon2id via WASM |
| TweetNaCl | `lib/tweetnacl.js` | Ed25519 for SSH |

**Web APIs used:** `crypto.subtle` (HMAC-SHA256, AES-GCM, PBKDF2), `TextEncoder`, `chrome.storage.local`, `chrome.scripting`, `chrome.alarms`

## CI/CD

| Tool | Version | Purpose |
|------|---------|---------|
| GitLab CI | — | Pipeline orchestration |
| Docker | — | Server containerization |
| Python 3.11 | slim image | Python tests |
| Node 20 | Alpine | JS tests + cross-platform |
| Go 1.22 | Alpine | Go build + tests |
| Eclipse Temurin 17 | JDK | Android build |

## Infrastructure

| Component | Purpose |
|-----------|---------|
| nginx | Reverse proxy + TLS termination |
| Let's Encrypt / certbot | SSL certificate auto-renewal |
| Docker Compose | Container orchestration |
| SSH | Deployment access |

## Dependency Philosophy

- **Python:** Minimal — stdlib + argon2-cffi + cryptography only
- **JavaScript:** Zero npm dependencies — vendored WASM libs, Web Crypto API
- **Kotlin:** AndroidX ecosystem + BouncyCastle for crypto
- **Go:** Single external dep (golang.org/x/crypto for bcrypt), stdlib for everything else
