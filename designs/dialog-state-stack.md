# Nested Dialog State Loss Fix — Design Document

## Problem

`popup.js` uses a single `let dialogState = null` (line 113) to hold the return value of `openDialog()` — a `{trapHandler, trigger}` object. When a nested dialog opens, the outer dialog's state is overwritten. On close, the wrong state is passed to `closeDialog`, leaving the outer dialog's focus trap handler attached and restoring focus to the wrong element.

### Confirmed Nesting

Settings → Reset is the only real nesting pair:
- Line 1013: `dialogState = openDialog(settingsPanel)` — settings opens
- Line 1045: `dialogState = openDialog(resetDialog)` — reset opens inside settings, **overwrites** settings state
- Line 1073: `closeDialog(resetDialog, dialogState)` — closes reset with reset's state (correct by accident)
- Line 1074: `closeDialog(settingsPanel, dialogState)` — closes settings with **reset's** state (BUG)

### Symptoms

1. Settings panel's focus trap handler is never removed (memory leak, stale keydown listener)
2. Focus restores to reset dialog's trigger element instead of the settings button

## Fix Approach: Per-Dialog State Variables

Replace the single `dialogState` with one variable per dialog:

```js
let settingsState = null;
let resetState = null;
let addState = null;
let deleteState = null;
```

Each `openDialog` assigns to its own variable. Each `closeDialog` passes the matching variable.

### Why Not a Stack?

A stack assumes strict LIFO close ordering. While the current code happens to close in LIFO order, per-dialog variables are:
- Simpler (no push/pop logic)
- More explicit (each call site names its dialog)
- Resilient to future non-LIFO close patterns (e.g., "close all" on lock timeout)
- Appropriate for the actual nesting depth (max 2)

## Affected Call Sites

| Line | Current Code | Fixed Code |
|------|-------------|------------|
| 113 | `let dialogState = null` | `let settingsState = null; let resetState = null; let addState = null; let deleteState = null;` |
| 741 | `dialogState = openDialog(addDialog)` | `addState = openDialog(addDialog)` |
| 1013 | `dialogState = openDialog(settingsPanel)` | `settingsState = openDialog(settingsPanel)` |
| 1017 | `closeDialog(settingsPanel, dialogState)` | `closeDialog(settingsPanel, settingsState)` |
| 1031 | `closeDialog(settingsPanel, dialogState)` | `closeDialog(settingsPanel, settingsState)` |
| 1045 | `dialogState = openDialog(resetDialog)` | `resetState = openDialog(resetDialog)` |
| 1053 | `closeDialog(resetDialog, dialogState)` | `closeDialog(resetDialog, resetState)` |
| 1073 | `closeDialog(resetDialog, dialogState)` | `closeDialog(resetDialog, resetState)` |
| 1074 | `closeDialog(settingsPanel, dialogState)` | `closeDialog(settingsPanel, settingsState)` |
| 1099 | `dialogState = openDialog(addDialog)` | `addState = openDialog(addDialog)` |
| 1103 | `closeDialog(addDialog, dialogState)` | `closeDialog(addDialog, addState)` |
| 1176 | `closeDialog(addDialog, dialogState)` | `closeDialog(addDialog, addState)` |
| 1191 | `closeDialog(addDialog, dialogState)` | `closeDialog(addDialog, addState)` |
| 1199 | `dialogState = openDialog(deleteDialog)` | `deleteState = openDialog(deleteDialog)` |
| 1233 | `dialogState = openDialog(addDialog)` | `addState = openDialog(addDialog)` |
| 1238 | `closeDialog(deleteDialog, dialogState)` | `closeDialog(deleteDialog, deleteState)` |
| 1248 | `closeDialog(deleteDialog, dialogState)` | `closeDialog(deleteDialog, deleteState)` |
| 1335 | `closeDialog(settingsPanel, dialogState)` | `closeDialog(settingsPanel, settingsState)` |
| 1339 | `closeDialog(addDialog, dialogState)` | `closeDialog(addDialog, addState)` |
| 1343 | `closeDialog(deleteDialog, dialogState)` | `closeDialog(deleteDialog, deleteState)` |

## Frozen Requirements

1. Each dialog's focus trap handler MUST be removed when that dialog closes, regardless of nesting.
2. Each dialog's trigger element MUST receive focus when that dialog closes.
3. Opening a nested dialog MUST NOT destroy the outer dialog's state.
4. No changes to `openDialog`/`closeDialog` function signatures.
5. No changes to dialog open/close behavior or visual presentation.

## Invariants

1. **State isolation**: Each dialog's state variable is written only by that dialog's open call and read only by that dialog's close calls.
2. **Null on close**: After `closeDialog(X, xState)`, the corresponding variable should conceptually be "consumed" (the handler is removed, focus is restored). Re-closing with the same state is harmless (removeEventListener with a removed handler is a no-op).
3. **No cross-contamination**: `closeDialog(settingsPanel, ...)` never receives `resetState` or vice versa.

## Scope Boundary

### In Scope
- Replacing `dialogState` with per-dialog variables in `popup.js`
- Updating all 20 call sites to use the correct variable

### Out of Scope
- The dynamically-created "Confirm your master secret" dialog (~line 430) — uses raw DOM append/remove, not `openDialog`/`closeDialog`
- Changes to `popup-dialog.js` (`openDialog`/`closeDialog` signatures)
- Adding dialog nesting depth limits or validation
- Refactoring dialog management into a class/module

## Test Plan

### Manual Tests

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Settings open/close | Open settings → close via X or Escape | Focus returns to settings trigger; no stale keydown listeners |
| 2 | Reset inside settings (the bug) | Open settings → click Reset → type RESET → confirm | Reset dialog closes, settings closes, focus returns to original trigger, no stale handlers |
| 3 | Reset cancel inside settings | Open settings → click Reset → cancel | Reset closes, settings remains open with working focus trap |
| 4 | Add dialog open/close | Click Add → cancel | Focus returns to Add button |
| 5 | Delete dialog open/close | Click Delete on a service → cancel | Focus returns to delete button |
| 6 | Escape key per dialog | Open settings → press Escape | Only settings closes |
| 7 | Escape key nested | Open settings → open reset → press Escape on reset | Only reset closes, settings remains |

### Automated Verification

- Grep for `dialogState` in popup.js — must return 0 matches after fix
- Grep for `(settingsState|resetState|addState|deleteState)` — must match exactly 20 occurrences (same count as before)

### Regression Check

- All dialog open/close flows still work (no broken references)
- Focus trap still works in each dialog (Tab cycles within dialog)
- No console errors on any open/close sequence
