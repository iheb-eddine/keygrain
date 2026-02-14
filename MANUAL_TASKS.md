# Manual Tasks (Require Your Action)

## Android Signing (CI/CD)

The release keystore was removed from git (security fix). To restore signed builds:

1. Generate a NEW keystore (the old one's passwords were exposed in git history):
   ```bash
   keytool -genkey -v -keystore release.keystore -alias keygrain -keyalg RSA -keysize 2048 -validity 10000
   ```
2. In GitLab → Settings → CI/CD → Variables, add:
   - `RELEASE_KEYSTORE` (type: File) → upload the new keystore
   - `KEYSTORE_PASSWORD` (type: Variable, masked) → your new password
   - `KEY_ALIAS` (type: Variable) → `keygrain`
   - `KEY_PASSWORD` (type: Variable, masked) → your new key password
3. For local builds, place `release.keystore` in `kotlin/` (it's gitignored)

Without the keystore, CI produces an unsigned APK (still builds successfully).

## PyPI Publication

1. Register at https://pypi.org/account/register/ (free)
2. Enable 2FA (required for uploads)
3. Generate API token at https://pypi.org/manage/account/token/
4. Run: `cd python && python -m build && twine upload dist/*`

## Chrome Web Store

1. Pay $5 one-time fee at https://chrome.google.com/webstore/devconsole/
2. Upload the zip from `extension/chrome/` build
3. Fill in store listing (screenshots, description, privacy policy)
4. Submit for review

## Firefox Add-ons

1. Register at https://addons.mozilla.org/developers/ (free)
2. Upload the zip from `extension/firefox/` build
3. Fill in listing details
4. Submit for review

## Domain / Hosting

- SSL auto-renews (Let's Encrypt)
- CI/CD deploys on push to master — no manual action needed

## Wipe Server Sync Test Data

After an algorithm change (e.g., rejection sampling fix), the server's stored bcrypt hash no longer matches the new auth password. Both GET and PUT will return 401 until the old record is removed.

1. Delete the contents of the server's `sync/` data directory
2. The client will then GET → 404, PUT without `If-Match` → new record created with the new auth hash