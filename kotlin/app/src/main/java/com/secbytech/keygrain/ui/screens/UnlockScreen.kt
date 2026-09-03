package com.secbytech.keygrain.ui.screens

import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
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
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import com.secbytech.keygrain.data.*
import com.secbytech.keygrain.ui.WongPalette
import com.secbytech.keygrain.ui.UserMessages
import com.secbytech.keygrain.ui.util.canUseBiometric
import com.secbytech.keygrain.ui.util.showBiometric
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun UnlockScreen(
    secretManager: SecretManager,
    serviceManager: ServiceManager,
    onUnlocked: (email: String, secret: String) -> Unit,
    onSwitchAccount: () -> Unit,
    onDemo: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val syncManager = remember { SyncManager() }

    val accountEmail = remember { SyncStore.getSyncEmail(context) ?: "" }
    var secret by remember { mutableStateOf("") }
    var secretVisible by remember { mutableStateOf(false) }
    var fingerprintIndices by remember { mutableStateOf<List<Int>>(emptyList()) }
    var showManualEntry by remember { mutableStateOf(!secretManager.hasSecret()) }
    val biometricFirstMode = secretManager.hasSecret() && canUseBiometric(context)

    var errorMessage by remember { mutableStateOf<String?>(null) }
    var verifying by remember { mutableStateOf(false) }
    var showSwitchConfirmDialog by remember { mutableStateOf(false) }

    LaunchedEffect(secret) {
        if (secret.isEmpty()) {
            fingerprintIndices = emptyList()
            return@LaunchedEffect
        }
        delay(250)
        fingerprintIndices = Keygrain.secretFingerprint(secret.toByteArray())
    }

    // Auto-trigger biometric if secret is stored
    LaunchedEffect(Unit) {
        if (biometricFirstMode) {
            showBiometric(
                context,
                onSuccess = {
                    val saved = secretManager.getSecret()
                    if (saved != null) {
                        onUnlocked(accountEmail, saved)
                    } else {
                        showManualEntry = true
                    }
                },
                onFailed = { showManualEntry = true }
            )
        }
    }

    val services = remember { serviceManager.getServices() }
    val lastSyncAt = remember { SyncStore.getLastSuccessfulSyncAt(context) }
    val isOfflineAccount = lastSyncAt == 0L || services.any { !it.synced }
    val snackbarHostState = remember { SnackbarHostState() }

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val msg = withContext(Dispatchers.IO) {
                try {
                    val json = serviceManager.exportJson().toByteArray()
                    context.contentResolver.openOutputStream(uri)?.use { it.write(json) }
                    UserMessages.exportSuccess(services.size)
                } catch (e: Exception) {
                    UserMessages.EXPORT_ERROR
                }
            }
            snackbarHostState.showSnackbar(msg)
        }
    }

    if (showSwitchConfirmDialog) {
        val unsyncedCount = if (lastSyncAt == 0L) 0 else services.count { !it.synced }
        AlertDialog(
            onDismissRequest = { showSwitchConfirmDialog = false },
            title = { Text("Switch Account") },
            text = {
                Column {
                    when {
                        lastSyncAt == 0L && services.isNotEmpty() -> {
                            Text(
                                "⚠️ WARNING: Offline Account",
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.titleSmall
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "This account is not synced to the cloud. All ${services.size} stored service(s) exist only on this device and will be permanently lost if you switch without downloading a backup.",
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                        unsyncedCount > 0 -> {
                            Text(
                                "⚠️ WARNING: Unsynced Changes",
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.titleSmall
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "You have $unsyncedCount service(s) with local changes that have not yet synced to the cloud. Switching accounts now will permanently discard these local changes.",
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                        else -> {
                            Text(
                                "Switching accounts will clear locally cached vault data on this device. Your data on the sync server is safely preserved and will be restored when you sign in again."
                            )
                        }
                    }

                    if (services.isNotEmpty()) {
                        Spacer(Modifier.height(14.dp))
                        OutlinedButton(
                            onClick = {
                                exportLauncher.launch("keygrain-backup.json")
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Default.Share, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Download / Backup Services (${services.size})")
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showSwitchConfirmDialog = false
                        onSwitchAccount()
                    }
                ) {
                    Text("Switch Account", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showSwitchConfirmDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Keygrain") }) },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (accountEmail.isNotBlank()) {
                Text(
                    text = "Account: $accountEmail",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary
                )
                if (isOfflineAccount && services.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Surface(
                        color = MaterialTheme.colorScheme.errorContainer,
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.Warning,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.error,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "Offline Account (${services.size} local service${if (services.size > 1) "s" else ""})",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.onErrorContainer
                                )
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "Your data is not backed up to the cloud. You can download a local backup at any time.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer
                            )
                            Spacer(Modifier.height(8.dp))
                            OutlinedButton(
                                onClick = { exportLauncher.launch("keygrain-backup.json") },
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.onErrorContainer
                                ),
                                border = androidx.compose.foundation.BorderStroke(
                                    1.dp,
                                    MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.5f)
                                )
                            ) {
                                Icon(Icons.Default.Share, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Download Backup")
                            }
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
            }

            if (biometricFirstMode) {
                Button(onClick = {
                    showBiometric(
                        context,
                        onSuccess = {
                            val saved = secretManager.getSecret()
                            if (saved != null) {
                                onUnlocked(accountEmail, saved)
                            } else {
                                showManualEntry = true
                            }
                        },
                        onFailed = { showManualEntry = true }
                    )
                }) {
                    Icon(Icons.Default.Fingerprint, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Unlock with Biometrics")
                }
                if (!showManualEntry) {
                    Spacer(Modifier.height(16.dp))
                    TextButton(onClick = { showManualEntry = true }) {
                        Text("Use master secret instead")
                    }
                }
                Spacer(Modifier.height(24.dp))
            }

            AnimatedVisibility(
                visible = showManualEntry || !biometricFirstMode,
                enter = expandVertically(),
                exit = shrinkVertically()
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    OutlinedTextField(
                        value = secret,
                        onValueChange = {
                            secret = it
                            errorMessage = null
                        },
                        label = { Text("Master Secret") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(autoCorrect = false, keyboardType = KeyboardType.Password),
                        visualTransformation = if (secretVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { secretVisible = !secretVisible }) {
                                Icon(
                                    if (secretVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = "Toggle visibility"
                                )
                            }
                        }
                    )

                    FingerprintAndEntropyRow(secret = secret, fingerprint = fingerprintIndices)

                    AnimatedVisibility(visible = errorMessage != null) {
                        errorMessage?.let { err ->
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

                    Spacer(Modifier.height(16.dp))

                    Button(
                        onClick = {
                            if (secret.isNotBlank()) {
                                errorMessage = null
                                verifying = true
                                scope.launch {
                                    val secretBytes = secret.toByteArray()
                                    try {
                                        val savedSecret = secretManager.getSecret()
                                        if (savedSecret != null && savedSecret != secret) {
                                            errorMessage = "Incorrect master secret for this account."
                                        } else {
                                            if (canUseBiometric(context)) {
                                                secretManager.saveSecret(secret)
                                            }
                                            // Trigger non-blocking background sync if offline mode is disabled
                                            val settingsPrefs = context.getSharedPreferences("keygrain_settings", Context.MODE_PRIVATE)
                                            val offlineMode = settingsPrefs.getBoolean("offline_mode", false)
                                            if (!offlineMode) {
                                                try {
                                                    syncManager.sync(secretBytes, accountEmail, serviceManager, context)
                                                } catch (_: Exception) {}
                                            }
                                            onUnlocked(accountEmail, secret)
                                        }
                                    } finally {
                                        secretBytes.fill(0)
                                        verifying = false
                                    }
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = secret.isNotBlank() && !verifying
                    ) {
                        if (verifying) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                                strokeWidth = 2.dp
                            )
                            Spacer(Modifier.width(8.dp))
                            Text("Verifying...")
                        } else {
                            Text("Unlock")
                        }
                    }

                    Spacer(Modifier.height(16.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        TextButton(onClick = { showSwitchConfirmDialog = true }) {
                            Text("Switch Account")
                        }
                        TextButton(onClick = onDemo) {
                            Text("Try Demo")
                        }
                    }
                }
            }
        }
    }
}
