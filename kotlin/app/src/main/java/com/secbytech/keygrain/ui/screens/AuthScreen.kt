package com.secbytech.keygrain.ui.screens

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.data.*
import com.secbytech.keygrain.ui.WongPalette
import com.secbytech.keygrain.ui.util.canUseBiometric
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class AuthScreenTab {
    UNLOCK,
    CREATE
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthScreen(
    secretManager: SecretManager,
    serviceManager: ServiceManager,
    initialTab: AuthScreenTab = AuthScreenTab.UNLOCK,
    onUnlocked: (email: String, secret: String) -> Unit,
    onDemo: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var selectedTab by remember { mutableStateOf(initialTab) }
    val verifier = remember { AccountVerifier() }
    val syncManager = remember { SyncManager() }

    // State for Unlock tab
    var unlockEmail by remember { mutableStateOf(SyncStore.getSyncEmail(context) ?: "") }
    var unlockSecret by remember { mutableStateOf("") }
    var unlockSecretVisible by remember { mutableStateOf(false) }
    var unlockFingerprint by remember { mutableStateOf<List<Int>>(emptyList()) }
    var unlockError by remember { mutableStateOf<String?>(null) }
    var unlockLoading by remember { mutableStateOf(false) }

    // State for Create tab
    var createEmail by remember { mutableStateOf("") }
    var createConfirmEmail by remember { mutableStateOf("") }
    var createSecret by remember { mutableStateOf("") }
    var createConfirmSecret by remember { mutableStateOf("") }
    var createSecretVisible by remember { mutableStateOf(false) }
    var createConfirmSecretVisible by remember { mutableStateOf(false) }
    var createSecretFingerprint by remember { mutableStateOf<List<Int>>(emptyList()) }
    var createConfirmFingerprint by remember { mutableStateOf<List<Int>>(emptyList()) }
    var createError by remember { mutableStateOf<String?>(null) }
    var createLoading by remember { mutableStateOf(false) }

    val fileImportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        unlockError = null
        unlockLoading = true
        scope.launch {
            val secretBytes = unlockSecret.toByteArray()
            val normalizedEmail = unlockEmail.trim().lowercase()
            try {
                val errMsg: String? = withContext(Dispatchers.IO) {
                    try {
                        val rawBytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                            ?: throw Exception("Cannot read backup file")
                        val contentStr = rawBytes.toString(Charsets.UTF_8).trim()
                        val parsed = try {
                            if (contentStr.startsWith("{") || contentStr.startsWith("[")) {
                                serviceManager.parseJson(contentStr)
                            } else {
                                emptyList()
                            }
                        } catch (_: Exception) {
                            emptyList()
                        }

                        val finalParsed = if (parsed.isNotEmpty()) {
                            parsed
                        } else {
                            // Attempt AES-256-GCM decrypt with outer sync envelope
                            val key = Keygrain.deriveEncryptionKey(secretBytes, normalizedEmail)
                            val decrypted = SyncCrypto.decrypt(key, rawBytes).toString(Charsets.UTF_8)
                            serviceManager.parseJson(decrypted)
                        }

                        if (finalParsed.isEmpty()) {
                            "Backup file contains no services or could not be parsed."
                        } else {
                            serviceManager.replaceAll(finalParsed)
                            SyncStore.setSyncEmail(context, normalizedEmail)
                            // Backup restore starts in offline mode
                            val settingsPrefs = context.getSharedPreferences("keygrain_settings", Context.MODE_PRIVATE)
                            settingsPrefs.edit().putBoolean("offline_mode", true).apply()
                            null
                        }
                    } catch (e: javax.crypto.AEADBadTagException) {
                        "Failed to decrypt backup file. Make sure the email and secret match the backup."
                    } catch (e: Exception) {
                        "Error reading backup file: ${e.message}"
                    }
                }

                if (errMsg != null) {
                    unlockError = errMsg
                } else {
                    if (canUseBiometric(context)) {
                        secretManager.saveSecret(unlockSecret)
                    }
                    onUnlocked(normalizedEmail, unlockSecret)
                }
            } finally {
                secretBytes.fill(0)
                unlockLoading = false
            }
        }
    }

    // Debounced fingerprints
    LaunchedEffect(unlockSecret) {
        if (unlockSecret.isEmpty()) {
            unlockFingerprint = emptyList()
            return@LaunchedEffect
        }
        delay(250)
        unlockFingerprint = Keygrain.secretFingerprint(unlockSecret.toByteArray())
    }

    LaunchedEffect(createSecret) {
        if (createSecret.isEmpty()) {
            createSecretFingerprint = emptyList()
            return@LaunchedEffect
        }
        delay(250)
        createSecretFingerprint = Keygrain.secretFingerprint(createSecret.toByteArray())
    }

    LaunchedEffect(createConfirmSecret) {
        if (createConfirmSecret.isEmpty()) {
            createConfirmFingerprint = emptyList()
            return@LaunchedEffect
        }
        delay(250)
        createConfirmFingerprint = Keygrain.secretFingerprint(createConfirmSecret.toByteArray())
    }

    var showInfoDialog by remember { mutableStateOf(false) }

    if (showInfoDialog) {
        AlertDialog(
            onDismissRequest = { showInfoDialog = false },
            title = { Text("How Keygrain Works") },
            text = {
                Column {
                    Text(
                        "Keygrain generates unique, strong passwords and keys deterministically from one master secret and your account email.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "• No Passwords Stored: Passwords are never stored on any server or database. They are mathematically derived on demand.\n\n" +
                        "• Same Inputs = Same Outputs: Using the same master secret and email will always produce the identical passwords across all your devices.\n\n" +
                        "• Zero-Knowledge Sync: Sync only stores encrypted service configurations (like website names). The server never sees your master secret or passwords.\n\n" +
                        "• Keep It Safe: Because nothing is stored, if you forget your master secret, it cannot be recovered by anyone.",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { showInfoDialog = false }) {
                    Text("Got it")
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Keygrain") },
                actions = {
                    IconButton(onClick = { showInfoDialog = true }) {
                        Icon(Icons.Default.Info, contentDescription = "How it works")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            TabRow(
                selectedTabIndex = selectedTab.ordinal,
                modifier = Modifier.fillMaxWidth()
            ) {
                Tab(
                    selected = selectedTab == AuthScreenTab.UNLOCK,
                    onClick = {
                        selectedTab = AuthScreenTab.UNLOCK
                        unlockError = null
                    },
                    text = { Text("Unlock Account") }
                )
                Tab(
                    selected = selectedTab == AuthScreenTab.CREATE,
                    onClick = {
                        selectedTab = AuthScreenTab.CREATE
                        createError = null
                    },
                    text = { Text("Create Account") }
                )
            }

            Spacer(Modifier.height(24.dp))

            when (selectedTab) {
                AuthScreenTab.UNLOCK -> {
                    Text(
                        "Enter your account email and master secret to unlock your vault.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(16.dp))

                    OutlinedTextField(
                        value = unlockEmail,
                        onValueChange = {
                            unlockEmail = it
                            unlockError = null
                        },
                        label = { Text("Account Email") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(autoCorrect = false, keyboardType = KeyboardType.Email)
                    )

                    Spacer(Modifier.height(12.dp))

                    OutlinedTextField(
                        value = unlockSecret,
                        onValueChange = {
                            unlockSecret = it
                            unlockError = null
                        },
                        label = { Text("Master Secret") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(autoCorrect = false, keyboardType = KeyboardType.Password),
                        visualTransformation = if (unlockSecretVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { unlockSecretVisible = !unlockSecretVisible }) {
                                Icon(
                                    if (unlockSecretVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = "Toggle secret visibility"
                                )
                            }
                        }
                    )

                    FingerprintAndEntropyRow(secret = unlockSecret, fingerprint = unlockFingerprint)

                    AnimatedVisibility(visible = unlockError != null) {
                        unlockError?.let { err ->
                            Spacer(Modifier.height(12.dp))
                            Surface(
                                color = MaterialTheme.colorScheme.errorContainer,
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    text = err,
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.padding(12.dp)
                                )
                            }
                        }
                    }

                    Spacer(Modifier.height(20.dp))

                    val canUnlock = unlockEmail.isNotBlank() &&
                        AccountVerifier.isValidEmail(unlockEmail) &&
                        unlockSecret.isNotBlank() &&
                        !unlockLoading

                    Button(
                        onClick = {
                            unlockError = null
                            unlockLoading = true
                            scope.launch {
                                val secretBytes = unlockSecret.toByteArray()
                                try {
                                    val result = verifier.verifyAccount(secretBytes, unlockEmail, context)
                                    when (result) {
                                        is AccountVerificationResult.ExistsValid -> {
                                            val normalizedEmail = unlockEmail.trim().lowercase()
                                            SyncStore.setSyncEmail(context, normalizedEmail)
                                            if (canUseBiometric(context)) {
                                                secretManager.saveSecret(unlockSecret)
                                            }
                                            // Auto-sync initial state
                                            try {
                                                syncManager.sync(secretBytes, normalizedEmail, serviceManager, context)
                                            } catch (_: Exception) {}
                                            onUnlocked(normalizedEmail, unlockSecret)
                                        }
                                        is AccountVerificationResult.NotFound -> {
                                            // Check local vault: if local services exist for this email, allow offline unlock
                                            val localEmail = SyncStore.getSyncEmail(context)
                                            if (localEmail != null && localEmail.equals(unlockEmail.trim(), ignoreCase = true) && serviceManager.getServices().isNotEmpty()) {
                                                if (canUseBiometric(context)) {
                                                    secretManager.saveSecret(unlockSecret)
                                                }
                                                onUnlocked(localEmail, unlockSecret)
                                            } else {
                                                unlockError = "Account not found. Please verify your email and master secret, or create a new account."
                                            }
                                        }
                                        is AccountVerificationResult.WrongSecret -> {
                                            unlockError = "Incorrect master secret for this account."
                                        }
                                        is AccountVerificationResult.RateLimited -> {
                                            unlockError = "Too many attempts. Please wait a moment and try again."
                                        }
                                        is AccountVerificationResult.NetworkUnavailable -> {
                                            if (result.localMatches) {
                                                if (canUseBiometric(context)) {
                                                    secretManager.saveSecret(unlockSecret)
                                                }
                                                onUnlocked(unlockEmail.trim().lowercase(), unlockSecret)
                                            } else {
                                                unlockError = "Cannot verify account while offline. Please connect to the internet to unlock for the first time, or unlock from a backup file below."
                                            }
                                        }
                                        is AccountVerificationResult.ServerError -> {
                                            unlockError = "Server error (${result.code}). Please try again later."
                                        }
                                    }
                                } finally {
                                    secretBytes.fill(0)
                                    unlockLoading = false
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = canUnlock
                    ) {
                        if (unlockLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                                strokeWidth = 2.dp
                            )
                            Spacer(Modifier.width(8.dp))
                            Text("Verifying...")
                        } else {
                            Text("Unlock with Sync")
                        }
                    }

                    Spacer(Modifier.height(8.dp))

                    OutlinedButton(
                        onClick = {
                            if (unlockEmail.isNotBlank() && AccountVerifier.isValidEmail(unlockEmail) && unlockSecret.isNotBlank()) {
                                fileImportLauncher.launch(arrayOf("*/*", "application/json", "application/octet-stream"))
                            } else {
                                unlockError = "Please enter your account email and master secret first to decrypt the backup file."
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !unlockLoading
                    ) {
                        Icon(Icons.Default.FileOpen, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Unlock from Backup File")
                    }

                    Spacer(Modifier.height(16.dp))
                    TextButton(onClick = onDemo) {
                        Text("Try Demo")
                    }
                }

                AuthScreenTab.CREATE -> {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.Security,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(20.dp)
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "Local & Zero-Knowledge",
                                    style = MaterialTheme.typography.titleSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Spacer(Modifier.height(6.dp))
                            Text(
                                "Your account is created locally on this device. Your master secret is never stored or transmitted, and passwords are generated on-demand.\n\nYou can optionally enable Sync at any time to synchronize your saved services across devices using end-to-end encryption.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    Spacer(Modifier.height(16.dp))

                    OutlinedTextField(
                        value = createEmail,
                        onValueChange = {
                            createEmail = it
                            createError = null
                        },
                        label = { Text("Account Email") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(autoCorrect = false, keyboardType = KeyboardType.Email)
                    )

                    Spacer(Modifier.height(8.dp))

                    OutlinedTextField(
                        value = createConfirmEmail,
                        onValueChange = {
                            createConfirmEmail = it
                            createError = null
                        },
                        label = { Text("Confirm Account Email") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(autoCorrect = false, keyboardType = KeyboardType.Email),
                        isError = createConfirmEmail.isNotEmpty() && createEmail.trim() != createConfirmEmail.trim(),
                        supportingText = {
                            if (createConfirmEmail.isNotEmpty() && createEmail.trim() != createConfirmEmail.trim()) {
                                Text("Emails do not match", color = MaterialTheme.colorScheme.error)
                            }
                        }
                    )

                    Spacer(Modifier.height(8.dp))

                    OutlinedTextField(
                        value = createSecret,
                        onValueChange = {
                            createSecret = it
                            createError = null
                        },
                        label = { Text("Master Secret") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(autoCorrect = false, keyboardType = KeyboardType.Password),
                        visualTransformation = if (createSecretVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { createSecretVisible = !createSecretVisible }) {
                                Icon(
                                    if (createSecretVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = "Toggle secret visibility"
                                )
                            }
                        }
                    )

                    FingerprintAndEntropyRow(secret = createSecret, fingerprint = createSecretFingerprint)

                    Spacer(Modifier.height(8.dp))

                    OutlinedTextField(
                        value = createConfirmSecret,
                        onValueChange = {
                            createConfirmSecret = it
                            createError = null
                        },
                        label = { Text("Confirm Master Secret") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(autoCorrect = false, keyboardType = KeyboardType.Password),
                        visualTransformation = if (createConfirmSecretVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { createConfirmSecretVisible = !createConfirmSecretVisible }) {
                                Icon(
                                    if (createConfirmSecretVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = "Toggle confirm secret visibility"
                                )
                            }
                        },
                        isError = createConfirmSecret.isNotEmpty() && createSecret != createConfirmSecret,
                        supportingText = {
                            if (createConfirmSecret.isNotEmpty() && createSecret != createConfirmSecret) {
                                Text("Secrets do not match", color = MaterialTheme.colorScheme.error)
                            }
                        }
                    )

                    FingerprintAndEntropyRow(secret = createConfirmSecret, fingerprint = createConfirmFingerprint)

                    AnimatedVisibility(visible = createError != null) {
                        createError?.let { err ->
                            Spacer(Modifier.height(12.dp))
                            Surface(
                                color = MaterialTheme.colorScheme.errorContainer,
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    text = err,
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.padding(12.dp)
                                )
                            }
                        }
                    }

                    Spacer(Modifier.height(20.dp))

                    val canCreate = createEmail.isNotBlank() &&
                        AccountVerifier.isValidEmail(createEmail) &&
                        createEmail.trim() == createConfirmEmail.trim() &&
                        createSecret.isNotBlank() &&
                        createSecret == createConfirmSecret &&
                        !createLoading

                    Button(
                        onClick = {
                            createError = null
                            createLoading = true
                            scope.launch {
                                val secretBytes = createSecret.toByteArray()
                                try {
                                    val checkResult = verifier.checkCanCreateAccount(secretBytes, createEmail, context)
                                    when (checkResult) {
                                        is AccountCreationCheckResult.AlreadyExistsRemote,
                                        is AccountCreationCheckResult.AlreadyExistsLocal -> {
                                            createError = "An account with this email and secret already exists. Use Unlock instead."
                                        }
                                        is AccountCreationCheckResult.RateLimited -> {
                                            createError = "Too many attempts. Please wait a moment and try again."
                                        }
                                        is AccountCreationCheckResult.ServerError -> {
                                            createError = "Server error (${checkResult.code}). Please try again later."
                                        }
                                        is AccountCreationCheckResult.CanCreate -> {
                                            val normalizedEmail = createEmail.trim().lowercase()
                                            SyncStore.setSyncEmail(context, normalizedEmail)
                                            if (canUseBiometric(context)) {
                                                secretManager.saveSecret(createSecret)
                                            }
                                            // Initialize empty sync on server
                                            try {
                                                syncManager.sync(secretBytes, normalizedEmail, serviceManager, context)
                                            } catch (_: Exception) {}
                                            onUnlocked(normalizedEmail, createSecret)
                                        }
                                        is AccountCreationCheckResult.OfflineAllowed -> {
                                            val normalizedEmail = createEmail.trim().lowercase()
                                            SyncStore.setSyncEmail(context, normalizedEmail)
                                            if (canUseBiometric(context)) {
                                                secretManager.saveSecret(createSecret)
                                            }
                                            onUnlocked(normalizedEmail, createSecret)
                                        }
                                    }
                                } finally {
                                    secretBytes.fill(0)
                                    createLoading = false
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = canCreate
                    ) {
                        if (createLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                                strokeWidth = 2.dp
                            )
                            Spacer(Modifier.width(8.dp))
                            Text("Checking...")
                        } else {
                            Text("Create Account")
                        }
                    }

                    Spacer(Modifier.height(16.dp))
                    TextButton(onClick = onDemo) {
                        Text("Try Demo")
                    }
                }
            }
        }
    }
}

@Composable
internal fun FingerprintAndEntropyRow(
    secret: String,
    fingerprint: List<Int>
) {
    if (secret.isEmpty()) return

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        val bits = Keygrain.estimateEntropy(secret)
        val (label, _) = Keygrain.entropyLabel(bits)
        val color = when {
            bits >= 80 -> MaterialTheme.colorScheme.primary
            bits >= 60 -> MaterialTheme.colorScheme.tertiary
            bits >= 40 -> MaterialTheme.colorScheme.secondary
            else -> MaterialTheme.colorScheme.error
        }
        Text(
            "$label (${bits.toInt()} bits)",
            style = MaterialTheme.typography.bodySmall,
            color = color
        )

        if (fingerprint.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                fingerprint.forEach { idx ->
                    Box(
                        Modifier
                            .size(16.dp)
                            .background(WongPalette[idx], CircleShape)
                    )
                }
            }
        }
    }
}
