# Enter Key Fix — Design Document

## Problem

Pressing Enter in input fields does nothing. Users must click buttons manually.

## Input → Button Pairs

| # | Screen | Input(s) | Action on Enter |
|---|--------|----------|-----------------|
| 1 | Lock screen | `#email` | Move focus to `#secret` |
| 2 | Lock screen | `#secret` | Click `#unlock-btn` |
| 3 | PIN unlock | `#pin-input` | Click `#pin-unlock-btn` |
| 4 | PIN setup banner | `#pin-set-input` | Click `#pin-save-btn` |
| 5 | Add/Edit dialog | `#add-name`, `#add-site`, `#add-email`, `#add-length`, `#add-symbols`, `#add-totp-seed`, `#add-ssh-keyname` | Click `#add-confirm` |
| 6 | Settings dialog | `#set-lock-timeout`, `#set-length`, `#set-symbols`, `#set-server-url` | Click `#settings-save` |

## Code to Add

### Helper function

```js
function enterToClick(input, btn) {
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !btn.disabled) btn.click();
  });
}
```

### Listener registrations

```js
// Lock screen
emailInput.addEventListener("keydown", e => { if (e.key === "Enter") secretInput.focus(); });
enterToClick(secretInput, unlockBtn);

// PIN unlock
enterToClick(pinInput, pinUnlockBtn);

// PIN setup
enterToClick(pinSetInput, pinSaveBtn);

// Add/Edit dialog
[addName, addSite, addEmail, addLength, addSymbols, addTotpSeed, addSshKeyname].forEach(
  input => enterToClick(input, addConfirm)
);

// Settings dialog
[setLockTimeout, setLength, setSymbols, setServerUrl].forEach(
  input => enterToClick(input, settingsSave)
);
```

## Placement in popup.js

Add the helper function and all registrations after the last event handler registration block (after `pinSaveBtn.addEventListener("click", ...)`, around line 1200 of popup.js). The DOM refs are already declared at the top of the IIFE.
