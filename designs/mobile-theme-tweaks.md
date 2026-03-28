# Mobile Theme Tweaks

## Changes

### 1. Tonal Elevation
Replace shadow-based elevation with tonal elevation on ServiceCard:
- Set `defaultElevation = 0.dp` (no shadow)
- Set `containerColor = MaterialTheme.colorScheme.surfaceVariant`

### 2. Card Corner Radius
Increase ServiceCard corner radius from 12dp to 16dp.

### 3. Dark Theme surfaceVariant
Add explicit `surfaceVariant = Color(0xFF32324A)` to the dark color scheme.
This sits between background (0xFF1A1A2E) and surface (0xFF2A2A40) in luminance.

## Files Modified
- `kotlin/app/src/main/java/com/badrani/keygrain/ui/theme/Theme.kt`
- `kotlin/app/src/main/java/com/badrani/keygrain/ui/screens/MainScreen.kt`
