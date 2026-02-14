# Screenshot Guide — Keygrain Store Submission

## Requirements

- **Chrome Web Store:** 1280×800 or 640×400 pixels, PNG or JPEG, 1–5 screenshots
- **Firefox Add-ons:** Any reasonable size, PNG or JPEG, 1–5 screenshots

Use 1280×800 for both stores (works for Chrome, acceptable for Firefox).

## Screenshot 1: Main Popup — Unlocked with Services

**What to show:** The popup open with 3–4 saved services visible, showing the colored fingerprint and the service list.

**Setup:**
1. Install the extension in a clean browser profile
2. Unlock with a test secret and email
3. Add services: github.com, gmail.com, amazon.com
4. Open the popup on a neutral page (e.g., new tab)

**Capture:** Browser window at 1280×800 with the popup open. Crop to show the popup prominently.

**Purpose:** Shows the core UI — what users see daily.

## Screenshot 2: Password Generation / Fill

**What to show:** The popup open on a login page with the "Fill" button visible, demonstrating the autofill workflow.

**Setup:**
1. Navigate to a recognizable login page (github.com/login)
2. Open the popup — the matching service should be highlighted
3. Show the generated password (partially visible) and the Fill button

**Capture:** Full browser window at 1280×800 showing both the login form and the popup.

**Purpose:** Demonstrates the primary use case — generating and filling passwords.

## Screenshot 3: Context Menu

**What to show:** The right-click context menu on a password field showing "Fill with Keygrain".

**Setup:**
1. Navigate to any login page
2. Right-click on the password field
3. Capture with the context menu visible

**Capture:** Full browser window at 1280×800 with context menu open.

**Purpose:** Shows the quick-access feature.

## Screenshot 4: Settings / Sync

**What to show:** The settings panel showing sync configuration and auto-lock timer.

**Setup:**
1. Open the popup
2. Navigate to the settings view
3. Show sync enabled with last sync time visible

**Capture:** Browser window at 1280×800 with settings panel visible.

**Purpose:** Shows the sync feature and security settings.

## Screenshot 5: Add Service

**What to show:** The "Add Service" form with customization options (length, symbols, counter).

**Setup:**
1. Open the popup
2. Click "Add Service"
3. Fill in a site name, show the customization options

**Capture:** Browser window at 1280×800 with the add-service form visible.

**Purpose:** Shows per-site customization capabilities.

## Capture Tips

- Use a clean browser profile with no other extensions visible
- Use the default browser theme (light mode)
- Ensure no personal data is visible in tabs or bookmarks
- Use example.com email addresses in the popup
- Window size: set browser to exactly 1280×800 using DevTools device toolbar or a window-resizing extension
- On Linux: `xdotool` or screenshot tools can set exact dimensions

## Chrome Web Store Additional Assets

- **Promo tile (optional):** 440×280 PNG — use the Keygrain logo centered on a clean background
- **Marquee (optional):** 1400×560 PNG — logo + tagline "Your passwords, derived — not stored"

## File Naming Convention

```
extension/store/screenshots/
├── 01-main-popup.png
├── 02-autofill.png
├── 03-context-menu.png
├── 04-settings-sync.png
└── 05-add-service.png
```
