# Counter Manual Editing

## Problem

The password counter (version) is irreversible. Clicking "Rotate password" increments it by 1 with no way to go back. If a user rotates by mistake or needs to restore from backup, they cannot set the counter to a specific value.

## Solution

Add a number input in the edit dialog's rotate section showing the current counter value. The user can type any value >= 1. The existing "Rotate password" button remains as a quick +1 shortcut.

## UI Changes

### popup.html — `#rotate-section`

Add a counter input row before the rotate button:

```html
<div id="rotate-section" class="hidden">
  <label for="add-counter">Password version</label>
  <input type="number" id="add-counter" min="1" step="1" value="1">
  <button id="rotate-btn" type="button">…Rotate password</button>
  <button id="mark-rotated-btn" type="button" class="hidden">…Mark as rotated</button>
</div>
```

### popup.js — Edit dialog open (`handleEdit`)

When opening the edit dialog, set the counter input value:

```js
document.getElementById("add-counter").value = svc.counter || 1;
```

### popup.js — Rotate button

Change from directly saving to just incrementing the input:

```js
rotateBtn.addEventListener("click", () => {
  if (!confirm("This will generate a new password. Continue?")) return;
  const input = document.getElementById("add-counter");
  input.value = parseInt(input.value, 10) + 1;
});
```

The actual save happens when the user clicks the dialog's "Save" button.

### popup.js — Dialog confirm (`addConfirm` handler)

Read the counter input and apply it:

```js
const newCounter = parseInt(document.getElementById("add-counter").value, 10);
if (!newCounter || newCounter < 1 || !Number.isInteger(newCounter)) {
  showStatus("Password version must be a positive integer.");
  return;
}
```

On save for existing services:

```js
if (editIndex !== null) {
  const oldCounter = services[editIndex].counter || 1;
  if (newCounter < oldCounter) {
    if (!confirm("Setting a lower version will revert to an older password. Continue?")) return;
  }
  services[editIndex] = {...services[editIndex], name, email, length, symbols, totp, ssh, counter: newCounter, updated_at: nextTimestamp(services)};
}
```

### popup.js — Add dialog open (new service)

Hide the rotate section for new services (existing behavior). Counter defaults to 1.

## Implementation Note

When the counter increases (whether via the input or the Rotate button), clear the `migrating` flag (`delete services[editIndex].migrating`) — same as the current rotate handler does.

## Validation

- `min="1"` on the HTML input
- JS validation: must be a positive integer
- Decrease warning: confirm dialog when new value < old value

## Scope

- No changes to the service list view (the "vN" badge continues to reflect the stored counter)
- No changes to sync, export/import, or derivation logic (they already use `svc.counter`)
- The "Rotate password" button becomes a convenience shortcut that increments the input rather than immediately saving
