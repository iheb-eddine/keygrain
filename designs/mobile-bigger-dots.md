# Design: Bigger Fingerprint Dots (16dp → 20dp)

## Changes

### 1. MainScreen.kt (line 234)

**File:** `kotlin/app/src/main/java/com/badrani/keygrain/ui/screens/MainScreen.kt`

```diff
- Box(Modifier.size(16.dp).background(WongPalette[idx], CircleShape))
+ Box(Modifier.size(20.dp).background(WongPalette[idx], CircleShape))
```

### 2. OnboardingScreen.kt (line 197)

**File:** `kotlin/app/src/main/java/com/badrani/keygrain/ui/screens/OnboardingScreen.kt`

```diff
- Box(Modifier.size(16.dp).background(WongPalette[idx], CircleShape))
+ Box(Modifier.size(20.dp).background(WongPalette[idx], CircleShape))
```

## Spacing

Both parent Rows use `Arrangement.spacedBy(8.dp)`. No change needed.

At 20dp dots with 8dp gaps, a 4-dot fingerprint spans 104dp total (4×20 + 3×8). Well within screen width on any phone.
