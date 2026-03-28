# Monospace Font for Revealed Passwords (Android)

## File

`kotlin/app/src/main/java/com/badrani/keygrain/ui/screens/MainScreen.kt`

## Location

Line 914–918, inside `ServiceCard` composable:

```kotlin
Text(
    text = if (visible) password else "••••••••••••",
    style = MaterialTheme.typography.bodyLarge,
    modifier = Modifier.weight(1f)
)
```

## Change

Add `fontFamily` (conditional on visibility) and overflow protection:

```kotlin
Text(
    text = if (visible) password else "••••••••••••",
    style = MaterialTheme.typography.bodyLarge,
    fontFamily = if (visible) FontFamily.Monospace else FontFamily.Default,
    maxLines = 1,
    overflow = TextOverflow.Ellipsis,
    modifier = Modifier.weight(1f)
)
```

## Rationale

- **Conditional font:** Monospace only when revealed. Dots don't benefit from fixed-width alignment and look better in the default proportional font.
- **Overflow:** Monospace is wider than the default font. Without `maxLines = 1` + `TextOverflow.Ellipsis`, long passwords could wrap to a second line and break the row layout.

## Required Imports

```kotlin
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
```

Verify `TextOverflow` isn't already imported; `FontFamily` is confirmed missing.
