# Design: ServiceCard Overflow Menu

## Problem

The ServiceCard header row displays Edit and Delete IconButtons alongside the site name and email. This clutters the card face and competes visually with the primary action (copy password). Edit and Delete are secondary actions that don't need constant visibility.

## Solution

Replace the two IconButtons with a single three-dot overflow menu (⋮) using Material 3's `DropdownMenu` component.

### Before

```
┌─────────────────────────────────────────┐
│ Site Name              [Edit] [Delete]   │
│ email@example.com                        │
│ ••••••••••••       [Visibility] [Copy]   │
└─────────────────────────────────────────┘
```

### After

```
┌─────────────────────────────────────────┐
│ Site Name                          [⋮]   │
│ email@example.com                        │
│ ••••••••••••       [Visibility] [Copy]   │
└─────────────────────────────────────────┘

         ┌──────────┐
         │ Edit     │
         │ Delete   │  ← error color
         └──────────┘
```

## Components

- `IconButton` — triggers the menu (icon: `Icons.Default.MoreVert`)
- `DropdownMenu` — the popup container, anchored via a wrapping `Box`
- `DropdownMenuItem` × 2 — Edit and Delete actions

## State

```kotlin
var menuExpanded by remember { mutableStateOf(false) }
```

## Code Change (header Row)

Replace:

```kotlin
IconButton(onClick = onEdit) {
    Icon(Icons.Default.Edit, contentDescription = "Edit")
}
IconButton(onClick = onDelete) {
    Icon(Icons.Default.Delete, contentDescription = "Delete")
}
```

With:

```kotlin
Box {
    IconButton(onClick = { menuExpanded = true }) {
        Icon(Icons.Default.MoreVert, contentDescription = "More options for ${service.name}")
    }
    DropdownMenu(
        expanded = menuExpanded,
        onDismissRequest = { menuExpanded = false }
    ) {
        DropdownMenuItem(
            text = { Text("Edit") },
            onClick = { menuExpanded = false; onEdit() },
            leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) }
        )
        DropdownMenuItem(
            text = { Text("Delete", color = MaterialTheme.colorScheme.error) },
            onClick = { menuExpanded = false; onDelete() },
            leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) }
        )
    }
}
```

## Behavior

| Action | Result |
|--------|--------|
| Tap ⋮ | Menu opens |
| Tap Edit | Calls `onEdit()`, menu closes |
| Tap Delete | Calls `onDelete()`, menu closes |
| Tap outside menu | Menu closes (built-in `onDismissRequest`) |

## Accessibility

- `contentDescription = "More options for ${service.name}"` — distinguishes overflow buttons across cards for screen readers.
- Menu items use `leadingIcon` for visual reinforcement; icons have `contentDescription = null` since the text label is sufficient.
- Delete uses `MaterialTheme.colorScheme.error` for both text and icon to signal destructive action.

## Scope

- **Changed:** Header row of `ServiceCard` only.
- **Unchanged:** Password row (visibility toggle, copy button), TOTP row, SSH row.
