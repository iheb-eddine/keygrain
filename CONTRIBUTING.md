# Contributing to Keygrain

Thanks for your interest in improving Keygrain. It's a deterministic password/keys
derivation tool, so correctness and cross-platform consistency matter more than
features.

## Before you start

- **Security issues are not bug reports.** If you've found a vulnerability, do **not**
  open a public issue — follow [SECURITY.md](SECURITY.md) (private reporting).
- **Algorithm changes are high-stakes.** `SPEC.md`, `vectors.json`, and the other
  `*-vectors.json` files are the source of truth and are checksum-gated in CI. Changing
  derivation behavior means bumping the spec, updating vectors, and updating **every**
  platform so outputs stay byte-identical. Open an issue to discuss first.

## Development setup

See [docs/developer-guide.md](docs/developer-guide.md) for building each platform. In
short:

```bash
# Python (reference implementation)
cd python && pip install -e . && pytest tests/

# Browser extension (no build tooling / no npm — vanilla JS + vendored libs)
cd extension && ./build.sh && node tests/test.mjs

# Android
cd kotlin && ./gradlew testReleaseUnitTest
```

## Ground rules

- **Cross-platform parity.** Any change touching derivation must produce identical
  output on all platforms. Run `bash ci/cross-platform-check.sh` and validate against
  `vectors.json`. Add vectors for new behavior.
- **Keep the extension verifiable.** No bundlers, minifiers, transpilers, or npm
  dependencies — the shipped files must remain the source (see [VERIFY.md](VERIFY.md)).
  Crypto goes through the Web Crypto API or the vendored libs in `extension/shared/lib/`.
- **Never log or persist secrets in plaintext.** Master secrets, strengthened keys, and
  derived material must not appear in logs or unencrypted storage.
- **Tests don't regress.** CI enforces per-platform test-count baselines; add tests for
  new code.

## Pull requests

1. Branch from `main`, keep the change focused (one concern per PR).
2. Make sure the full CI matrix is green (tests, checksum gate, version check,
   cross-platform, builds).
3. Update docs when behavior or interfaces change.
4. Reference the issue your PR addresses.

## Commit messages

Short, imperative subject lines (e.g. `fix: correct rejection-sampling boundary`).
Group unrelated changes into separate commits/PRs.

## License

By contributing, you agree that your contributions are licensed under the repository's
[MIT License](LICENSE).
