# Card Styling Consistency Fix

## Reference Style (MainScreen ServiceCard)

```kotlin
Card(
    shape = RoundedCornerShape(16.dp),
    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
)
```

## Cards to Update

### 1. HelpScreen.kt — FaqCard (line 88)

**Current:**
```kotlin
Card(modifier = Modifier.fillMaxWidth())
```

**Change to:**
```kotlin
Card(
    modifier = Modifier.fillMaxWidth(),
    shape = RoundedCornerShape(16.dp),
    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
)
```

### 2. WalletScreen.kt — Warning Card (line 97)

**Current:**
```kotlin
Card(
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    modifier = Modifier.fillMaxWidth()
)
```

**Change to:**
```kotlin
Card(
    shape = RoundedCornerShape(16.dp),
    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    modifier = Modifier.fillMaxWidth()
)
```

> Note: Keeps `errorContainer` intentionally — communicates danger/risk semantics.

### 3. WalletScreen.kt — Mnemonic Display Card (line 183)

**Current:**
```kotlin
Card(modifier = Modifier.fillMaxWidth())
```

**Change to:**
```kotlin
Card(
    modifier = Modifier.fillMaxWidth(),
    shape = RoundedCornerShape(16.dp),
    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
)
```

### 4. WalletScreen.kt — Wallet List Item Cards (line 203)

**Current:**
```kotlin
Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
```

**Change to:**
```kotlin
Card(
    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    shape = RoundedCornerShape(16.dp),
    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
)
```

> Note: The `padding(vertical = 4.dp)` on the modifier is intentional — WalletScreen uses a Column (not LazyColumn with `Arrangement.spacedBy`), so inter-card spacing is handled via padding.

## Required Imports (if not already present)

- `androidx.compose.foundation.shape.RoundedCornerShape`
- `androidx.compose.ui.unit.dp` (already present in both files)
