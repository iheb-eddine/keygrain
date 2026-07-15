# Verifying Keygrain

Keygrain is built so you don't have to trust us — you can check that what you install
matches this public source. This is stronger than most extensions, which ship
minified/bundled code that can't realistically be audited.

## Why the extension is verifiable

- **Reproducible build.** `extension/build.sh` zips a **sorted**, fixed-timestamp file
  list as UTC with no extra metadata, and performs **no minification, bundling, or
  transpilation** — the shipped files are the source (only the `manifest.json` version
  string is substituted at build time). Because the entry order does not depend on your
  filesystem, the same commit produces byte-identical zips with the same SHA-256 on any
  POSIX machine with `bash`, `zip`, and `sha256sum`.
- **Published checksums.** Every [GitHub Release](https://github.com/iheb-eddine/keygrain/releases)
  carries the exact `keygrain-chrome-<version>.zip` and `keygrain-firefox-<version>.zip`
  plus a `SHA256SUMS.txt`, built by GitHub Actions from this repository.

> **Store caveat:** the Chrome Web Store and Firefox Add-ons re-package and re-sign
> what we upload, so the installed **container** (`.crx` / `.xpi`) will *not* hash-match
> our zip. What you verify is the **file contents** — and because nothing is minified,
> a diff is human-readable and should be empty. Firefox is the stronger channel here:
> Mozilla reviews the submitted source, and the `.xpi` is a plain zip you can extract.

## Verify the extension

### Method A — rebuild from source and compare hashes (easiest)

```bash
git clone https://github.com/iheb-eddine/keygrain.git
cd keygrain
git checkout v<version>          # the version you installed (see the extension's About/Help)
bash extension/build.sh
cd extension/dist
sha256sum keygrain-chrome-*.zip keygrain-firefox-*.zip
```

Compare the output against `SHA256SUMS.txt` on the matching
[GitHub Release](https://github.com/iheb-eddine/keygrain/releases) — or download that
file into `extension/dist/` and run `sha256sum -c SHA256SUMS.txt`. If they match, the
released zip was built from exactly this source. (You need `bash`, `zip`, and
`sha256sum` — no other toolchain.)

### Method B — inspect what's actually installed

Method B compares against the assembled build output, so **first run
`bash extension/build.sh`** (it writes `extension/dist/chrome/` and
`extension/dist/firefox/`).

**Firefox:** download the add-on's `.xpi` (or find it under your profile's
`extensions/` folder), unzip it, and diff against the build:

```bash
unzip -d installed keygrain.xpi
diff -r installed extension/dist/firefox
```

Files that appear only in `installed` are store-added metadata/signing artifacts
(`META-INF/`, `mozilla-recommendation.json`, …) — expected. The JS/HTML/CSS must be
identical. Since nothing is minified, you can also just read the code.

**Chrome:** go to `chrome://extensions`, enable **Developer mode**, and note the
extension's ID and version. The unpacked files live under your Chrome profile at
`Extensions/goeemlncopfbcnppjalfmgdalbhlgdha/<version>_0/` (Chrome appends `_0`). Diff
that folder against the build:

```bash
diff -r "<chrome-profile>/Extensions/goeemlncopfbcnppjalfmgdalbhlgdha/<version>_0" \
        extension/dist/chrome
```

Expected differences are limited to store-added metadata (e.g. `_metadata/`, signing
files) and the `manifest.json` version string — the actual JS/HTML/CSS should be
identical.

## Verify the Android APK

The Android app is distributed as a direct APK download from keygrain.com. Android
build reproducibility is not guaranteed the way the extension's is, so the trust
anchor for the APK is its **signing certificate**: every genuine Keygrain APK is
signed with the same key, and Android refuses to install an update signed by a
different key.

```bash
# From the Android SDK build-tools:
apksigner verify --print-certs keygrain.apk
```

Compare the printed certificate SHA-256 against Keygrain's published signing
fingerprint (see the release notes / this repository's release page). A match means
the APK was signed by Keygrain and has not been tampered with since.

> Publishing the exact fingerprint here is a maintainer to-do; until then you can at
> least confirm the same certificate is used across versions (an attacker cannot
> re-sign with our key).

## Honest limitations

- These checks are for the technically inclined — most users won't run them, and the
  app stores remain a trust point (they sign and serve the package).
- What reproducible builds + unminified code + published checksums give you is that
  **tampering is detectable by anyone who checks** — auditors, researchers, or a
  cautious you — rather than requiring blind trust.
- Auto-updates ship new versions over time; re-verify against the matching release if
  you want assurance for a specific installed version.
