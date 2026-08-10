# Keygrain Android App — User Guide

Keygrain derives unique passwords from your master secret rather than keeping a password vault of generated passwords. You remember one secret, and Keygrain creates a different strong password for every site you use. Same secret + same service = same password, always.

Android does store some local account data, including service configuration and sync-related state. When biometric unlock is enabled, the master secret may also be retained encrypted in the Android Keystore so the app can unlock quickly. While the app is unlocked, the secret is held in memory; locking clears that in-memory copy. The secret and generated passwords are not sent to the sync server.

---

## Getting Started

### Installing

Android is currently in closed testing:

1. [Join the Keygrain tester group](https://groups.google.com/g/keygrain-testers).
2. [Opt into closed testing](https://play.google.com/apps/testing/com.secbytech.keygrain) with your Google account.
3. Install Keygrain through Google Play, then open the app to begin setup.

No Keygrain account is required. A Google account is needed only for Play tester enrollment.

### First Launch

On first launch, Keygrain walks you through a short onboarding wizard. You can skip it at any step and set things up later.

---

## Onboarding

The onboarding wizard has five steps (shown as dots at the top of the screen):

1. **Welcome** — explains how Keygrain works: passwords are derived mathematically rather than kept in a password vault.
2. **Master Secret** — choose the single passphrase that generates all your passwords. Tips:
   - Use a phrase only you would know
   - Longer is better (4+ words recommended)
   - There is no reset — if you forget it, your passwords cannot be recovered
3. **First Service** — add your first service (pre-filled with google.com as an example). Edit the fields to match a real account, and you'll see the generated password live.
4. **Backup Info** — explains that your service list can be synced or exported (set up anytime from the menu).
5. **Completion** — summary of what you configured. Tap **Get Started** to enter the app.

You can tap **Skip** at any step to jump straight into the app.

---

## Unlocking

After onboarding, the app locks when closed. There are two ways to unlock:

### Biometric (Fingerprint / Face)

If your device supports strong biometrics and you've previously entered your master secret, Keygrain automatically prompts for biometric authentication when you open the app. Tap **Unlock** to trigger it manually.

If biometric authentication fails or is cancelled, you can always fall back to manual entry — there's no lockout.

### Manual Secret Entry

Type your master secret in the text field and tap **Unlock**. Use the 👁 icon to toggle visibility.

### Visual Fingerprint

As you type your secret, a row of colored dots appears below the field. These dots are a unique visual pattern for your secret — they'll always be the same for the same input. Use them to verify you typed your secret correctly (compare with what you saw during onboarding).

---

## Managing Services

### Adding a Service

1. Tap the **＋** button (bottom-right corner)
2. Fill in:
   - **Service name** — e.g., "GitHub" or "netflix.com"
   - **Site** — the website domain (e.g., "github.com"). If the name contains a dot, the site auto-fills.
   - **Email** — the email you use to log in to that site
3. Tap **Add**

The site field is normalized automatically: `https://www.Example.com/path` becomes `example.com`. This ensures consistent password generation regardless of how you type the URL.

#### Advanced Options

Tap **⚙️ Options** to customize:

- **Length** — password length (minimum 8, default 20)
- **Symbols** — which special characters to include (default: `!@#$%&*-_=+?`)
- **Counter** — increment this to rotate your password (default: 1). Each counter value produces a completely different password for the same service.

### Editing a Service

1. Tap the **✏️** (edit) icon on a service card
2. Change the name, email, length, symbols, or counter
3. Tap **Save**

> **⚠️ Warning:** Changing the length, symbols, or counter will change your generated password. You'll need to update it on the actual website too.

Note: The site field cannot be changed after creation — it's part of how your password is generated.

### Deleting a Service

1. Tap the **🗑** (delete) icon on a service card
2. Confirm in the dialog that appears

This cannot be undone locally. If you sync afterward, the deletion propagates to the server.

### Searching

When you have multiple services, a search bar appears at the top. Type to filter by service name or email. Tap the **✕** to clear the search.

---

## Copying Passwords

Each service card shows your password (hidden by default as dots).

- Tap the **👁** icon to reveal/hide the password
- Tap the **📋** (copy) icon to copy it to your clipboard

A "Copied" toast confirms the action.

---

## Advanced credentials and wallets

### TOTP codes

You can attach a time-based one-time password (TOTP) to a service while adding or editing it:

1. Open the service editor and tap **⚙️ Options**.
2. In the **TOTP** section, choose one of these modes:
   - **Stored** — enter a TOTP seed or an `otpauth://` URI in **Seed / otpauth:// URI**. Supported seeds can be Base32 or hexadecimal. A stored seed is retained as sensitive service data; it is not derivable from the master secret. If you delete a service with a stored seed, the confirmation warns that the seed cannot be recovered.
   - **Derived** — derives the TOTP seed from the master secret and the service's email and site. No imported TOTP seed is stored for this mode, so the same inputs reproduce the code.
   - **None** — removes TOTP from the service.
3. For a supported authenticator QR code, choose **Stored**, tap **Scan QR**, grant camera access if Android asks, and scan the code. The scanner accepts a detected `otpauth://` value for TOTP; it does not promise to import arbitrary QR payloads.
4. Save the service. Its current code and countdown appear on the service card, and the copy button copies the current code.

### SSH keys

To derive an SSH keypair for a service:

1. Open the service editor and tap **⚙️ Options**.
2. Under **SSH Key**, enter a value in **Key name (optional)**, such as `github` or `work-servers`.
3. Save the service and open its detail view. Use **Copy SSH public key** to copy the `ssh-ed25519` authorized-keys line for installing on a server.
4. To copy the private key, use the private-key action. In the **Copy Private Key** prompt, choose **Copy**, then use the private-key action again to perform the copy. Treat the resulting OpenSSH PEM as a secret: it is unencrypted private-key material. Android marks it sensitive where supported and clears it from the clipboard after 30 seconds if the clipboard has not changed.

### Wallet derivation

The **Wallet** item in the **⋮** menu opens **Wallet Derivation**. This derives a 24-word mnemonic from your master secret; it does not create an on-chain wallet, import funds, or manage balances.

1. Enter the **Email** and a lowercase **Wallet name** (for example, `personal` or `savings`).
2. Choose a **Chain**: `avalanche`, `bitcoin`, `bitcoin-testnet`, `cosmos`, `dogecoin`, `ethereum`, `litecoin`, `polkadot`, or `solana`.
3. Enter a **Counter** of 1 or greater. A different wallet name, chain, or counter derives a different result.
4. Check **I understand the risks**. The **Derive Mnemonic** button activates after a three-second delay.
5. Tap **Derive Mnemonic** and record the 24 numbered words securely. Where the selected chain defines one, the screen also shows its **BIP-44 Path**; Polkadot shows `(substrate derivation)` instead.

This is a **disaster-recovery derivation** feature, not an everyday wallet. If you lose your master secret, every derived wallet is permanently lost and there is no recovery mechanism. Use a hardware wallet for daily operations and never share the mnemonic.

The mnemonic is protected from screenshots while displayed and is removed automatically after 60 seconds. Tap **Clear** to remove it sooner. The app retains wallet metadata and an audit entry for previously derived wallets, and these are included in normal sync; the displayed mnemonic itself is not persisted by the wallet screen.

---

## Syncing Across Devices

Sync merges your service list with the Keygrain server so all your devices stay in sync.

### How to Sync

1. Tap the **⋮** menu (top-right) → **Sync**
2. Enter your email (pre-filled with your most-used email across services)
3. Tap **Continue**

A progress spinner appears while syncing.

### How Merge Works

- Services that exist on both sides: the newer version wins (by timestamp). Ties go to the server version.
- Services added on another device: appear locally after sync.
- Services deleted locally: removed from the server on next sync.
- Services deleted on another device: routine remote deletions are removed locally on next sync. If this device has unsynced changes to the service, the deletion appears in the review flow described below instead.

### Sync Errors

| Message | Meaning |
|---------|---------|
| Auth error | Email or secret doesn't match the server identity. Use the same email and secret on all devices. |
| Network error | No internet or server unreachable. Try again later. |
| Server error | Temporary server issue. Try again in a few minutes. |
| Integrity error | Data corruption detected. Try syncing again. |
| Conflict error | Another device synced at the same time. The app retries once automatically. |

---

## Advanced account and data controls

### Offline mode

1. Open the **⋮** menu and turn on **Offline mode**.
2. While it is on, Keygrain keeps your local services and wallet tools available but disables automatic and menu sync. Changes made in this mode remain local and are not on the server until a later successful sync.
3. Turn **Offline mode** off from the same menu to resume the normal sync path. The app will try to sync again, but a network or server failure can still prevent it.

### Switch account

To start with a different master secret on this device, open **⋮** → **Switch account** and confirm **Switch account**. This wipes account-scoped local state, including the master secret, services, sync state, wallets, audit log, and conflict/review state, then returns to setup. It does not delete or change anything on the sync server; server data remains until you delete it separately or use another device/account to manage it.

### Delete server data

Open **⋮** → **Delete server data** only when you intend to permanently erase this account's data from the sync server. The confirmation covers services, wallets, and TOTP data and cannot be undone on the server.

The dialog includes **Keep my data on this device (offline mode)**:

- **On** — after the server confirms deletion (or confirms that no server record exists), the app leaves your local data in place and turns on **Offline mode**. Turn Offline mode off later to try syncing the retained data again; that may put it back on the server.
- **Off** — after confirmed deletion, the app also wipes the local account data and returns to setup. This is the local-delete path; make sure you have the master secret and any required backup before choosing it.

Only a confirmed server success or confirmed no-record result changes local state. Authentication, rate-limit, network, server, and unexpected failures show that nothing was changed; retry after resolving the problem rather than assuming the server was erased.

### Review deletions from another device

After a successful sync, a service can be flagged for review when this device had unsynced changes to it but another device deleted it. A routine remote deletion with no unsynced local change is applied silently. For a flagged change, the service-list banner tells you that a service you changed here was deleted on another device; tap **Review** to open **Deleted elsewhere**.

For each entry:

- **Restore** re-creates the service under its original ID and schedules it to be pushed again when sync is enabled. It does not guarantee an immediate server update while offline or when the network fails.
- **Discard** accepts the deletion and keeps the service deleted.
- **Dismiss all** marks the review entries as seen and stops the reminder, but retains the entries locally.

---

## Android Autofill and Credential Provider status

Android Autofill Service and Credential Provider support is currently **unresolved**. In the 2026-08-11 investigation, a Xiaomi device running Android 14 reported no Autofill session and no Keygrain provider callback while a password field was focused. That evidence does not establish whether the browser/device or Keygrain provider path is responsible.

This guide intentionally provides **no supported Android settings or setup procedure** for these providers. Do not rely on selecting Keygrain as an Autofill Service or Credential Provider, and do not assume that either provider fills passwords end to end. Manual use of the app's service cards and copy actions is separate from this unresolved framework integration. Provider instructions should be added only after a real framework callback and successful end-to-end fill are verified.

---

## Export & Import

### Exporting a Backup

1. Tap **⋮** menu → **Export to file**
2. Enter your email (used as part of the encryption key)
3. Tap **Continue**
4. Choose where to save the `.keygrain` file

The export is encrypted with a key derived from your master secret + email — it's safe to store in cloud storage or share between your devices.

### Importing a Backup

1. Tap **⋮** menu → **Import from file**
2. Enter the same email you used when exporting
3. Tap **Continue**
4. Select the `.keygrain` file
5. Confirm the replacement

> **⚠️ Import replaces all local services.** The confirmation dialog shows: "Replace all X local services with Y services from file?" Make sure you want to overwrite before confirming.

If decryption fails (wrong email or different master secret), you'll see an error message and nothing is changed.

---

## Locking

Tap the **🔒** icon in the top-right corner to lock the app manually. This clears the master secret from memory immediately. If biometric unlock is enabled, an encrypted Keystore-backed copy may remain so you can unlock again with biometrics; locking does not mean that encrypted copy is deleted.

---

## Troubleshooting

### Wrong password being generated

- Make sure you're using the exact same **email** and **master secret** as when you created the service
- Check that the **site** matches what you originally entered (remember: it's normalized — no `www.`, no `https://`, lowercase)
- If you incremented the **counter**, make sure it matches the version you set on the website

### Locked out / forgot master secret

There is no recovery. Keygrain cannot reconstruct a forgotten master secret, and Android's encrypted Keystore copy is only for biometric unlock — it is not a recovery backup. If you forget your secret, you'll need to start over with a new secret and update all your website passwords.

### Biometric not working

- Make sure your device has a fingerprint or face enrolled in system settings
- Keygrain requires **strong** biometric authentication — some older sensors may not qualify
- If biometric is unavailable, enter your master secret manually

### Sync not working

- Check your internet connection
- Verify you're using the same email on all devices
- If you get "Auth error," your master secret or email differs from what was used on another device
- Try again — transient conflicts resolve automatically

### Import fails with decryption error

- You must use the same **email** and **master secret** that were active when the file was exported
- The file may be corrupted — try exporting again from the source device
