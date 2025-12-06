# Onboarding Wizard Design

## 1. Overview

The onboarding wizard guides first-time Keygrain users through understanding the deterministic password derivation concept, setting up their master secret, adding their first service, and learning about backup options.

The wizard is a 5-step `HorizontalPager` flow that appears only on first launch. It is skippable at every step. After completion (or skip), the normal app flow resumes.

### Detection Logic

The onboarding shows when **both** conditions are true:
- `SecretManager.hasSecret()` returns `false`
- `onboarding_completed` preference is `false`

This means:
- First launch: onboarding shows
- User skipped onboarding previously: goes straight to UnlockScreen
- User completed onboarding but cleared app data: onboarding shows again (correct — they lost their secret)

---

## 2. Screen Flow

### Step 1: Welcome

**Purpose:** Explain the core concept in plain language.

**Content:**
```
[Keygrain logo/icon]

Welcome to Keygrain

Keygrain generates unique passwords from one master secret.
Your passwords are never stored anywhere — they're
mathematically derived every time you need them.

Same secret + same service = same password. Always.

This means: no database to hack, no cloud to breach,
no sync to fail. But also: if you forget your secret,
your passwords cannot be recovered.

[Next →]                                    [Skip]
```

**Components:** Logo/icon, title text, body text, Next button (primary), Skip button (text).

---

### Step 2: Master Secret

**Purpose:** Explain what the master secret is, let the user enter one, and verify via fingerprint.

**Content:**
```
Your Master Secret

This is the single passphrase that generates all your
passwords. Choose something memorable but hard to guess.

Tips:
• Use a phrase only you would know
• Longer is better (4+ words recommended)
• You'll need to remember this exactly — there's no reset

[Master Secret input field]        [👁 toggle]

[4 colored dots — fingerprint visualization]

These colors are your secret's fingerprint. They'll always
be the same for the same secret — use them to verify you
typed it correctly.

[Set Master Secret]                         [Skip]
```

**Behavior:**
- Input field with visibility toggle (same as current UnlockScreen)
- Fingerprint dots appear after 500ms debounce (same `Keygrain.secretFingerprint()` logic)
- "Set Master Secret" calls `SecretManager.saveSecret(secret)` and advances to step 3
- The entered secret is held in memory for step 3 (service password generation)

**Fingerprint Visualization:** The 4 colored dots use the Wong color-blind-safe palette (8 colors). They provide a visual confirmation that the user typed their secret correctly. On subsequent unlocks, the user can compare the dots to verify they entered the same secret. The design doc implementer should ensure the dots explanation copy is clear to non-technical users.

---

### Step 3: First Service

**Purpose:** Guide the user to add their first service with a pre-filled example.

**Content:**
```
Add Your First Service

Let's generate a password for a service you use.
We've pre-filled an example — edit it to match your account.

Service name:  [Google          ]
Email:         [                ]

[⚙️ Options]  (expandable: length, symbols, salt)

[Generated password preview — masked by default]
[👁 toggle] [📋 copy]

[Add Service]                               [Skip]
```

**Behavior:**
- Service name pre-filled with "Google" (editable)
- Email field empty (required)
- Options section collapsed by default (same as current AddServiceDialog)
- Password preview shows the derived password in real-time once both fields are filled
- "Add Service" saves via `ServiceManager.addService()` and advances to step 4
- If master secret was not set in step 2 (user skipped it), this step shows a message: "Set up your master secret first to generate passwords" with a back arrow

---

### Step 4: Backup (Informational)

**Purpose:** Inform the user that backup exists without triggering the full sync flow.

**Content:**
```
Keep Your Services Safe

Your master secret is never backed up (only you know it).
But your service list (names, emails, settings) can be
backed up to prevent re-entering them.

Options available in the menu (⋮):
• Backup to server — encrypted with your secret
• Export to file — save locally or share

You can set this up anytime from the main screen menu.

[Next →]                                    [Skip]
```

**Behavior:**
- Purely informational — no actions triggered
- "Next" advances to step 5
- No "Enable now" button to avoid cognitive overload

---

### Step 5: Done

**Purpose:** Confirm completion and summarize.

**Content:**
```
You're All Set! ✓

Here's what you've set up:
✓ Master secret configured
✓ First service added (Google)
✓ Backup available in menu

Remember: your master secret is the key to everything.
Keep it safe, keep it memorable.

[Get Started]
```

**Behavior:**
- Summary adapts based on what was actually completed:
  - If secret was set: "✓ Master secret configured"
  - If secret was skipped: "○ Master secret — set up on next screen"
  - If service was added: "✓ First service added ({name})"
  - If service was skipped: "○ Add services anytime with the + button"
- "Get Started" marks onboarding complete and transitions to normal flow

---

## 3. Skip Behavior

**Every step** has a "Skip" text button (except step 5 which has "Get Started").

**Skip on any step:**
1. Sets `onboarding_completed = true` in SharedPreferences
2. Transitions immediately to the normal app flow (UnlockScreen)

**Post-skip UX:** When a user who skipped onboarding lands on UnlockScreen without a stored secret, the screen shows an additional subtitle:

```
Enter your master secret — the single passphrase
that generates all your passwords.
```

This provides minimal context for users who skipped the explanation.

**"Skip All" option:** Step 1 (Welcome) additionally shows "Skip setup" as the skip action, making it clear this skips the entire wizard, not just this page.

---

## 4. State Persistence

### Storage

| Key | Location | Type | Purpose |
|-----|----------|------|---------|
| `onboarding_completed` | Regular SharedPreferences (`keygrain_settings`) | Boolean | Whether onboarding was shown |
| `master_secret` | EncryptedSharedPreferences (`keygrain_prefs`) | String | Existing — master secret storage |

### Why Regular SharedPreferences?

The `onboarding_completed` flag is not sensitive data. Using regular SharedPreferences avoids requiring the crypto library just to check if onboarding should show. It also survives independently of the encrypted prefs.

### State Transitions

```
App Launch
    │
    ├─ hasSecret() == true ──────────────► UnlockScreen (biometric/manual)
    │
    └─ hasSecret() == false
         │
         ├─ onboarding_completed == true ► UnlockScreen (with subtitle)
         │
         └─ onboarding_completed == false ► OnboardingWizard
                                                │
                                                ├─ Complete/Skip ► set onboarding_completed=true
                                                │                  ► UnlockScreen or ServiceList
                                                └─ (if secret was entered during onboarding)
                                                   ► skip UnlockScreen, go to ServiceList
```

---

## 5. UI Components (Compose)

### New Composables

| Component | Description |
|-----------|-------------|
| `OnboardingWizard` | Top-level composable. Contains `HorizontalPager` with 5 pages. Manages wizard state. |
| `OnboardingPage` | Reusable page layout: icon/image slot, title, body text, primary action, skip button. |
| `WelcomePage` | Step 1 content |
| `MasterSecretPage` | Step 2 — input field, fingerprint dots, set button |
| `FirstServicePage` | Step 3 — pre-filled form, password preview |
| `BackupInfoPage` | Step 4 — informational text |
| `CompletionPage` | Step 5 — dynamic summary |
| `OnboardingPageIndicator` | Dot indicator showing current step (1-5) |

### Layout Structure

```kotlin
@Composable
fun OnboardingWizard(
    secretManager: SecretManager,
    serviceManager: ServiceManager,
    onComplete: (masterSecret: String?) -> Unit  // null if secret not set
)
```

Each page follows a consistent layout:
```
┌─────────────────────────────┐
│         [Page indicator]     │  ← dots showing step 1/5, 2/5, etc.
│                              │
│         [Icon/Image]         │
│                              │
│         [Title]              │
│                              │
│         [Body text]          │
│                              │
│         [Interactive area]   │  ← input fields, buttons (step-specific)
│                              │
│  [Skip]          [Primary →] │
└─────────────────────────────┘
```

### Integration Point

In `MainScreen.kt`, the composable tree becomes:

```kotlin
@Composable
fun MainScreen() {
    val context = LocalContext.current
    val secretManager = remember { SecretManager(context) }
    val serviceManager = remember { ServiceManager(context) }
    val settingsPrefs = remember {
        context.getSharedPreferences("keygrain_settings", Context.MODE_PRIVATE)
    }

    var onboardingCompleted by remember {
        mutableStateOf(settingsPrefs.getBoolean("onboarding_completed", false))
    }
    var unlocked by remember { mutableStateOf(false) }
    var masterSecret by remember { mutableStateOf("") }

    when {
        !onboardingCompleted && !secretManager.hasSecret() -> {
            OnboardingWizard(
                secretManager = secretManager,
                serviceManager = serviceManager,
                onComplete = { secret ->
                    settingsPrefs.edit().putBoolean("onboarding_completed", true).apply()
                    onboardingCompleted = true
                    if (secret != null) {
                        masterSecret = secret
                        unlocked = true
                    }
                }
            )
        }
        !unlocked -> {
            UnlockScreen(
                secretManager = secretManager,
                showSubtitle = !secretManager.hasSecret(),
                onUnlocked = { secret ->
                    masterSecret = secret
                    unlocked = true
                }
            )
        }
        else -> {
            ServiceListScreen(
                masterSecret = masterSecret,
                serviceManager = serviceManager,
                onLock = {
                    unlocked = false
                    masterSecret = ""
                }
            )
        }
    }
}
```

### Pager Configuration

- `HorizontalPager` with `userScrollEnabled = false` (navigation only via buttons to enforce step order)
- Animated transitions between pages (default pager animation)
- Back gesture/button goes to previous page (except step 1 where it exits the app)

---

## 6. Test Plan

### Unit Tests

| Test | Validates |
|------|-----------|
| `onboarding shows when no secret and not completed` | Detection logic: both conditions false → wizard shows |
| `onboarding skipped when completed flag is true` | Skip persistence works |
| `onboarding skipped when secret exists` | Returning user never sees onboarding |
| `skip sets completed flag` | Any skip → flag set to true |
| `master secret saved on step 2 completion` | `SecretManager.saveSecret()` called |
| `service added on step 3 completion` | `ServiceManager.addService()` called with correct entry |
| `completion summary reflects actual steps taken` | Dynamic summary adapts |
| `skip on step 2 does not save empty secret` | No side effects on skip |

### UI Tests (Compose)

| Test | Validates |
|------|-----------|
| `pager shows 5 pages` | All steps present |
| `skip button visible on every page` | Accessibility/UX requirement |
| `fingerprint dots appear after secret input` | 500ms debounce + visualization |
| `next button disabled until required fields filled (step 2, 3)` | Form validation |
| `page indicator updates on navigation` | Visual feedback |
| `back button navigates to previous page` | Navigation |
| `pre-filled service name is "Google"` | Step 3 default |

### Integration Tests

| Test | Validates |
|------|-----------|
| `full flow: welcome → secret → service → backup → done → service list` | Happy path |
| `skip on step 1 → UnlockScreen with subtitle` | Skip path |
| `skip on step 2 → UnlockScreen (no secret saved)` | Partial completion |
| `complete step 2, skip step 3 → ServiceList (no service added)` | Mixed completion |
| `kill app after step 2, relaunch → UnlockScreen (not onboarding)` | Crash recovery: secret saved means hasSecret()=true |
| `clear app data → onboarding shows again` | Fresh state |

### Manual QA Checklist

- [ ] Onboarding only shows on first install
- [ ] All text is readable (font sizes, contrast)
- [ ] Fingerprint dots match between onboarding and UnlockScreen
- [ ] Password generated in step 3 matches what ServiceList shows later
- [ ] Landscape orientation doesn't break layout
- [ ] Screen reader announces all interactive elements
- [ ] Back button behavior is intuitive at each step
