# Keygrain Android App — User Guide

Keygrain generates unique passwords from your secret — nothing is stored. You remember one secret, and Keygrain creates a different strong password for every site you use. Same secret + same service = same password, always.

---

## Getting Started

### Installing

Install Keygrain from the Google Play Store (search "Keygrain"). Once installed, open the app to begin setup.

### First Launch

On first launch, Keygrain walks you through a short onboarding wizard. You can skip it at any step and set things up later.

---

## Onboarding

The onboarding wizard has five steps (shown as dots at the top of the screen):

1. **Welcome** — explains how Keygrain works: passwords are derived mathematically, never stored.
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
- Services deleted on another device: removed locally on next sync.

### Sync Errors

| Message | Meaning |
|---------|---------|
| Auth error | Email or secret doesn't match the server identity. Use the same email and secret on all devices. |
| Network error | No internet or server unreachable. Try again later. |
| Server error | Temporary server issue. Try again in a few minutes. |
| Integrity error | Data corruption detected. Try syncing again. |
| Conflict error | Another device synced at the same time. The app retries once automatically. |

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

Tap the **🔒** icon in the top-right corner to lock the app manually. This clears your master secret from memory immediately.

---

## Troubleshooting

### Wrong password being generated

- Make sure you're using the exact same **email** and **master secret** as when you created the service
- Check that the **site** matches what you originally entered (remember: it's normalized — no `www.`, no `https://`, lowercase)
- If you incremented the **counter**, make sure it matches the version you set on the website

### Locked out / forgot master secret

There is no recovery. Keygrain doesn't store your master secret anywhere — it only keeps it in memory while unlocked. If you forget it, you'll need to start over with a new secret and update all your website passwords.

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
