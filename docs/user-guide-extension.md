# Keygrain Browser Extension — User Guide

Keygrain generates unique passwords from your secret — nothing is stored. You remember one secret, and Keygrain creates a different strong password for every site you use.

---

## Getting Started

### Installing

- **Chrome:** Install from the Chrome Web Store (search "Keygrain")
- **Firefox:** Install from Firefox Add-ons (search "Keygrain")

Once installed, you'll see the 🔑 Keygrain icon in your browser toolbar. A small number badge appears on the icon when the current site matches one of your saved services.

### Locking and Unlocking

Click the Keygrain icon to open the popup. When locked, you'll see the unlock screen. When you're done, click the 🔒 button in the top-right corner to lock manually.

---

## First-Time Setup

The first time you use Keygrain:

1. **Enter your email** — this is part of how your passwords are generated. Use the same email on all your devices.
2. **Choose a master secret** — this is the one thing you need to remember. Make it long and unique.
3. **Confirm your secret** — type it again to make sure there are no typos.
4. **Check the visual fingerprint** — the colored dots below the secret field are a visual pattern unique to your secret + email combination. If the dots match between the two fields, you typed the same thing both times.
5. Click **Unlock**.

After unlocking, Keygrain will offer to set up a PIN for quick access next time.

### Setting a PIN

A PIN lets you unlock quickly without typing your full secret every time:

1. Choose a 4–6 digit PIN
2. Click **Set PIN**
3. Next time you open Keygrain, you'll only need your PIN

> **Note:** If you enter the wrong PIN 5 times in a row, the PIN is cleared for security. You'll need to enter your full master secret and set a new PIN.

You can skip the PIN setup and use your master secret every time if you prefer.

---

## Demo Mode

Want to try Keygrain before committing? Click **Try Demo** on the lock screen.

Demo mode loads example services (GitHub, Google, Netflix, etc.) so you can explore the interface. Your real passwords are never affected — a banner at the top reminds you that you're in demo mode.

To exit demo mode, click the 🔒 lock button.

---

## Adding a Service

1. Click the **＋** button at the bottom
2. Fill in:
   - **Service name** — e.g., "GitHub" or "netflix.com"
   - **Site** — the website domain (e.g., "github.com")
   - **Email** — the email you use to log in to that site
3. Click **Add**

### Auto-Detection

When you open Keygrain while on a website, it will suggest adding that site if it's not already in your list. Click the suggestion to pre-fill the details.

### Options

Click **⚙️ Options** to customize:
- **Length** — password length (minimum 8, default 20)
- **Symbols** — which special characters to include

Some sites have specific password rules. Keygrain knows about these and will automatically adjust the settings — you'll see a "✓ Optimized for [site]" message.

### Strength Indicator

Each service in your list shows a colored bar indicating password strength:
- **Green** = Strong (20+ characters)
- **Yellow** = Good (13–19 characters)
- **Orange** = Fair (8–12 characters)

---

## Copying a Password

Click the **📋** (clipboard) button next to any service. The password is copied to your clipboard.

- A confirmation message appears: "Copied! Clears in 30s."
- After 30 seconds, your clipboard is automatically cleared for security.

---

## Autofill

Autofill types your password directly into the login form on the current page.

### From the Popup

1. Open Keygrain on a login page
2. Click the **▶** (fill) button next to the matching service
3. Keygrain fills in your email and password automatically

If only one service matches the current site, a **Quick Fill** button appears at the top for one-click access.

### Keyboard Shortcut

Press **Ctrl+Shift+K** (or **Cmd+Shift+K** on Mac) to autofill without opening the popup. Keygrain matches the current site and fills your credentials instantly.

### Right-Click Menu

Right-click on any login field and select **Fill with Keygrain** from the context menu.

### If Autofill Doesn't Work

Some sites block autofill. If it doesn't work, use the copy button instead and paste manually.

---

## PIN Unlock

After your first login, if you set a PIN:

1. Open Keygrain — the PIN screen appears
2. Enter your 4–6 digit PIN
3. Click **Unlock**

If you need to use your master secret instead, click **Use master secret instead** below the PIN field.

---

## Searching Services

When not searching, your most-used services appear first. Type in the search bar to find services. Keygrain uses fuzzy matching — you don't need to type the exact name:

- "git" finds "GitHub"
- "goo" finds "Google"
- You can also search by email

### Keyboard Navigation

- **↓ / ↑** — move through the list
- **Enter** — autofill the selected service
- **Escape** — clear the search (press again to close the popup)

---

## Editing a Service

1. Click the **✏️** (edit) button next to a service
2. Change the name, email, length, or symbols
3. Click **Save**

> **⚠️ Warning:** Changing the length or symbols will change your generated password. You'll need to update it on the actual website too.

Note: The site field cannot be changed after creation (it's part of how your password is generated).

---

## Deleting a Service

1. Click the **🗑** (delete) button next to a service
2. Confirm in the dialog that appears

This cannot be undone. If you have sync enabled, the deletion will sync to your other devices.

---

## Rotating a Password

Rotating generates a new password for a service. Do this when:
- A site has been breached
- You want to change your password periodically
- Someone may have seen your password

### How to Rotate

1. Click **✏️** to edit the service
2. Click **🔄 Rotate password**
3. Confirm when prompted

After rotating, a version badge (v2, v3, etc.) appears next to the service name. You'll need to go to the actual website and change your password there to match the new one.

---

## Sync

Keygrain automatically syncs your service list across devices.

### How It Works

- Sync happens automatically in the background after you make changes
- A "Last synced" indicator appears at the bottom of the service list
- All devices using the same email + master secret share the same data

### Multi-Device Setup

1. Install Keygrain on your other device
2. Enter the same email and master secret
3. Your services sync automatically

### Sync Errors

If sync fails, a ⚠️ icon appears. Click it to see the error details. Common causes:
- No internet connection
- Server temporarily unavailable

Sync will retry automatically when the issue resolves.

---

## Migrating from Another Password Manager

If you're switching from another password manager:

1. Click the **☰** menu button
2. Select **Migrate from another manager**
3. Follow the guided process to import your existing passwords

Keygrain creates a migration checklist so you can update each site one at a time. Services marked with "⚠️ migrate" still use your old password — visit each site to change it to the Keygrain-generated one.

Click **✅ Mark as rotated** in the edit dialog once you've updated a site.

---

## Settings

Click the **⚙** button to open settings:

| Setting | What it does | Default |
|---------|-------------|---------|
| Auto-lock timeout | Minutes before Keygrain locks automatically | 15 min |
| Default password length | Length for new services | 20 |
| Default symbols | Special characters for new services | !@#$%&*-_=+? |
| Server URL | Sync server address | https://keygrain.com |

### Auto-Lock

Keygrain locks itself automatically after the timeout period of inactivity. When 60 seconds remain before auto-lock, a warning banner appears with an **Extend** button — click it to reset the timer.

Any click or keypress in the popup also resets the timer.

---

## Export & Import

### Exporting a Backup

1. Click the **☰** menu
2. Click **Export to file**
3. Save the `.keygrain` file somewhere safe

The export is encrypted with your master secret — it's safe to store in cloud storage.

### Importing a Backup

1. Click the **☰** menu
2. Click **Import from file**
3. Select your `.keygrain` backup file
4. Follow the prompts

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Shift+K (Cmd+Shift+K on Mac) | Autofill current site |
| ↓ / ↑ | Navigate service list |
| Enter | Fill selected service |
| Escape | Clear search → close popup |

---

## Breach Warnings

Keygrain checks for known data breaches that affect your services. When a breach is detected:

- A warning banner appears with details about the breach
- Click **×** to dismiss a warning
- Click **🔄 Rotate all affected** to generate new passwords for all breached services at once

After rotating, remember to visit each affected site and update your password there.

---

## Troubleshooting

### Wrong password being generated

- Make sure you're using the exact same **email** and **master secret** as when you created the service
- Check that the **service name** and **site** match what you originally entered
- If you rotated the password, make sure the version matches (look for the v2/v3 badge)

### Locked out

- If your PIN was cleared (5 wrong attempts), enter your master secret on the lock screen
- If you forgot your master secret, there is no recovery — Keygrain doesn't store it anywhere. This is by design for security.

### Sync not working

- Check your internet connection
- Click the ⚠️ sync error icon for details
- Verify the server URL in Settings is correct
- Try locking and unlocking again

### Autofill not working

- Some sites block autofill for security reasons
- Try the right-click context menu instead
- As a fallback, use the copy button and paste manually
- Make sure the site in your service matches the current page's domain

### Extension icon shows a number

That's the badge count — it shows how many of your saved services match the current website. Click the icon to see them.
