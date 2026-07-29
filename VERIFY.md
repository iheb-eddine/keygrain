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
- **Published checksums.** Each [GitHub Release](https://github.com/iheb-eddine/keygrain/releases)
  from extension 1.2.0 onward carries the exact `keygrain-chrome-<version>.zip` and
  `keygrain-firefox-<version>.zip` plus a `SHA256SUMS.txt`, built by GitHub Actions from the
  tagged commit in this repository.

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
git checkout firefox-v<version>   # the version you installed (see About/Help)
bash extension/build.sh
cd extension/dist
sha256sum keygrain-chrome-*.zip keygrain-firefox-*.zip
```

> **Verifying 1.2.0 specifically:** `build.sh` at the 1.2.0 tag did not normalise the
> builder's timezone or umask, so it only reproduced our hash on a UTC machine with a
> `022` umask. That is fixed on `main`. To verify 1.2.0, take the fixed builder — it is a
> ~40-line shell script you can read in full before running it:
> ```bash
> git checkout firefox-v1.2.0
> git checkout main -- extension/build.sh
> bash extension/build.sh
> ```
> From the next release onward, the plain instructions above are enough.

Compare the output against `SHA256SUMS.txt` on the matching
[GitHub Release](https://github.com/iheb-eddine/keygrain/releases) — or download that
file into `extension/dist/` and run `sha256sum -c SHA256SUMS.txt`. If they match, the
released zip was built from exactly this source. (You need `bash`, `zip`, and
`sha256sum` — no other toolchain.)

**What is covered today.** Hash verification is available for **Firefox 1.2.0 and later**.
Chrome and Firefox carry independent versions and independent tags (`chrome-v<version>`,
`firefox-v<version>`) because store review times differ, and tags are only created for
versions that were published with checksums. Two gaps we would rather state than hide:

- **Chrome.** The version currently in the Chrome Web Store predates this and has no tag or
  published checksums, so Method A cannot be completed for it. Tags and checksums will follow
  with the next Chrome release. Until then, use Method B, or use Firefox.
- **Extension 1.1.0** was published without a tag or checksum file. There is nothing to
  compare it against. Update to 1.2.0 or later to verify by hash.

Releases before 1.2.0 used a single tag for all components (`v1.0.0`, `v0.11.0`).

### Method B — inspect what's actually installed

Method B compares against the assembled build output, so **first run
`bash extension/build.sh`** (it writes `extension/dist/chrome/` and
`extension/dist/firefox/`). If a tag exists for your version, check it out first; if not,
build from the closest tag you can and read the diff — because nothing is minified or
bundled, this is inspection you can do with your own eyes rather than a pass/fail hash, and
genuine differences between versions will show up alongside anything else.

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

## Verify the web generator

The web generator at [keygrain.com/generate](https://keygrain.com/generate/) is a
**client** (it derives passwords in your browser with no server calls — load it, then
go offline and it still works). Its source is public in [`web/`](web/), and the server
serves it **verbatim**, so you can compare what your browser loads against this repo:

- **View source / DevTools:** open `keygrain.com/generate/`, view the HTML and the
  loaded scripts (`index.html`, `hash-wasm-argon2.js`, `sw.js`) — nothing is minified,
  so it's directly readable and matches `web/` in this repo at the deployed version.
- **Diff the served files:** download the assets and diff against `web/`:

```bash
for f in index.html hash-wasm-argon2.js sw.js manifest.json; do
  curl -fsS "https://keygrain.com/generate/$f" | diff - "web/$f" && echo "$f: identical"
done
```

Any difference in the served JavaScript is a red flag; identical output means the live
generator is exactly this source.

## Verify the Python package (PyPI)

The `keygrain` Python package (the CLI and library) is a **pure-Python** distribution,
built by GitHub Actions from this repository via **PyPI Trusted Publishing** — there is
no separately-uploaded artifact and no long-lived token. Two independent checks:

### Method A — rebuild the wheel and compare hashes

The **wheel** (`.whl`) is reproducible: the build pins zip-entry timestamps to the
released commit's timestamp (`SOURCE_DATE_EPOCH`), and nothing is minified or
transpiled. Rebuilding from the tag on any machine yields a byte-identical wheel — and
the wheel is what `pip install` uses for this pure-Python package.

```bash
git clone https://github.com/iheb-eddine/keygrain.git
cd keygrain
git checkout v<version>                       # CLI 1.0.0 is tagged v1.0.0; later
                                              # releases use cli-v<version>
export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
cd python
python -m build --wheel
sha256sum dist/keygrain-<version>-py3-none-any.whl
```

Compare against the wheel's hash on the package's
[PyPI release page](https://pypi.org/project/keygrain/#files) (each file lists its
SHA-256), or download and hash the installed artifact directly:

```bash
pip download keygrain==<version> --no-deps -d /tmp/kg && sha256sum /tmp/kg/*.whl
```

A match means the wheel on PyPI was built from exactly this source. (You need Python
plus `build`; no other toolchain.)

> **Note:** only the **wheel** is byte-reproducible. The source tarball (`.tar.gz`)
> is *not* currently guaranteed to hash-match across machines (its tar/gzip metadata
> isn't fully pinned), so verify the `.whl` — which is the artifact `pip` actually
> installs. The tarball's *contents* are still just this source, auditable by extraction.

### Method B — check the publishing provenance (attestations)

Because the package is published via Trusted Publishing, PyPI records **PEP 740
attestations** that cryptographically bind each uploaded file to the GitHub Actions
workflow run and the exact commit that produced it. On the
[PyPI release files page](https://pypi.org/project/keygrain/#files), each file shows a
**"Publisher"/provenance** panel identifying the source as
`iheb-eddine/keygrain` via `.github/workflows/publish.yml`. That links the artifact you
install back to this public repository — not to any private build. If a release ever
shows a different publisher (or none), treat it as suspect.

## Verify the Android APK

Keygrain for Android is distributed through Google Play (currently closed testing). Play
uses **Play App Signing**: we sign our build with our own upload key, Google verifies it,
then **re-signs** the APK delivered to your device with a separate app signing key that
Google holds. So the certificate on an APK installed from Play is the *app signing*
certificate below — not our upload certificate. Both are published so you can tell which
you are looking at.

Android build reproducibility is not guaranteed the way the extension's is, so the trust
anchor for the APK is its **signing certificate**: every genuine Keygrain install is signed
with the same app signing key, and Android refuses to install an update signed by a
different key.

```bash
# From the Android SDK build-tools:
apksigner verify --print-certs keygrain.apk
```

**App signing certificate — compare against this one.** This is the certificate reported by
an APK installed from Google Play, measured on a real device (`adb pull` of the installed
`base.apk`, then `apksigner verify --print-certs`). The DN is Google's, because Google holds
this key and signs with it on our behalf:

```
apksigner form:  ed8594df67738ebc5a66dca158150acf698c80485c16415ef7eb5689786e8100
keytool form:    ED:85:94:DF:67:73:8E:BC:5A:66:DC:A1:58:15:0A:CF:69:8C:80:48:5C:16:41:5E:F7:EB:56:89:78:6E:81:00
certificate DN:  CN=Android, OU=Android, O=Google Inc., L=Mountain View, ST=California, C=US
```

Our Play Console additionally lists an app signing certificate
`8B:96:7B:5D:05:36:43:3C:DE:74:AE:39:FF:31:D2:E4:54:0B:7A:B6:DB:97:56:F1:21:98:B0:A5:06:C2:92:E4`
and a post-quantum one
`9A:8B:99:DD:2F:A5:4A:AA:3A:1B:65:9D:01:9D:F3:89:15:3C:5F:BD:D4:54:67:12:1C:37:A3:9F:6D:DA:E0:66`.
We are reconciling why the installed artifact reports the value above instead; if your install
reports one of these, that is ours too and not a cause for alarm. We would rather show you all
three than quietly publish one and let you conclude the mismatch means tampering.

**Upload certificate — for reference only.** This is the key our CI signs the build with
before uploading to Play, and the value the CI drift guard enforces on every build. You will
only ever see it on an APK taken directly from our build pipeline, never on a Play install:

```
apksigner form:  ab3621a449405f75e94b0283e5a35f0da86127409984dd63db02a8e8d7a38e11
keytool form:    AB:36:21:A4:49:40:5F:75:E9:4B:02:83:E5:A3:5F:0D:A8:61:27:40:99:84:DD:63:DB:02:A8:E8:D7:A3:8E:11
```

(`apksigner verify --print-certs` prints lowercase hex with no colons; `keytool -list -v`
prints it colon-separated — same value. `apksigner` reports the classical certificate, not
the post-quantum one.)

> **Note on what this does and does not prove.** Because Google re-signs, the app signing
> certificate proves the APK came through *our* Play listing and was not modified after
> Google signed it. It does not prove the bytes match a build you can reproduce yourself —
> for that, the extension and the Python package are the stronger channels.

## Honest limitations

- These checks are for the technically inclined — most users won't run them, and the
  app stores remain a trust point (they sign and serve the package).
- What reproducible builds + unminified code + published checksums give you is that
  **tampering is detectable by anyone who checks** — auditors, researchers, or a
  cautious you — rather than requiring blind trust.
- Auto-updates ship new versions over time; re-verify against the matching release if
  you want assurance for a specific installed version.
