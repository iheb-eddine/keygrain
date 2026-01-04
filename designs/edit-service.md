# Edit Service

## Overview
Allow users to edit an existing service's name, email, length, symbols, and salt in both the browser extension and Android app.

## Approach
Reuse the existing add-service dialog, pre-filled with current values. Track an `editIndex` to distinguish add vs edit mode.

## Key behaviors
- Edit button (✏️) on each service row
- Dialog title/button text changes to "Edit Service" / "Save"
- Warning shown if length, symbols, or salt changed (password will change)
- Name collision rejected (excluding the service being edited)
- On save: update in-place, re-encrypt, re-render

## Extension
- State: `editIndex` (null = add mode, number = edit mode)
- Reuse `add-dialog`, pre-fill fields, swap title/button text

## Android
- `ServiceManager.updateService(oldName, newEntry)` method
- Reuse `AddServiceDialog` with optional initial values
- Edit icon on `ServiceCard`
