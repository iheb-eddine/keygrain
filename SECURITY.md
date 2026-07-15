# Security Policy

Keygrain is a security tool, so we take vulnerability reports seriously. Thank you for
helping keep users safe.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via GitHub's **[Private vulnerability reporting](https://github.com/iheb-eddine/keygrain/security/advisories/new)**
(the repository's *Security → Report a vulnerability* tab). This keeps the details
confidential until a fix is available.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (proof of concept if possible).
- Affected component(s) and version(s) — see the scope below.
- Any suggested remediation.

This is an independent project maintained on a best-effort basis. We aim to
acknowledge reports promptly and to coordinate a fix and disclosure timeline with you;
please allow reasonable time to address the issue before any public disclosure.

## Scope

In scope — reports here are especially valuable:

- **The derivation algorithm** (`SPEC.md`, `python/`, `extension/`, `kotlin/`): any way
  to weaken derivation, leak the master secret, produce cross-platform divergence, or
  bias output.
- **The clients** (browser extension, Python CLI, Android app): secret handling,
  storage, autofill, memory hygiene, or anything that could expose secrets or derived
  material.
- **The sync protocol** (`API.md`): the client encrypts with AES-256-GCM before upload
  and the server stores only opaque ciphertext — reports showing the client leaks
  plaintext/metadata, or that the protocol is weaker than documented, are in scope.

Notes:

- The hosted sync **server implementation** is closed source, but reports about the
  live service at `keygrain.com` (e.g. auth bypass, data exposure) are welcome.
- The security model assumes a trusted local device. Attacks requiring a compromised
  device or OS are generally out of scope.

## Verifying what you run

Before reporting a "the published artifact doesn't match the source" concern, note that
the extension is built reproducibly and can be checked against this source — see
[VERIFY.md](VERIFY.md).

## Supported versions

Only the latest released version is supported. Please verify issues against the current
`main` before reporting.

## Safe harbor

We consider good-faith security research that respects user privacy, avoids service
disruption, and does not access or modify others' data to be authorized, and we will
not pursue action against researchers who follow this policy and report responsibly.
