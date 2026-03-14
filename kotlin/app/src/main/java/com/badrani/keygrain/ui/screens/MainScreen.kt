package com.badrani.keygrain.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.util.Log
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.badrani.keygrain.data.Keygrain
import com.badrani.keygrain.data.SecretManager
import com.badrani.keygrain.data.ServiceEntry
import com.badrani.keygrain.data.ServiceManager
import com.badrani.keygrain.data.SyncCrypto
import com.badrani.keygrain.data.TotpEngine
import com.badrani.keygrain.data.SshEngine
import com.badrani.keygrain.data.SyncManager
import com.badrani.keygrain.data.SyncResult
import com.badrani.keygrain.ui.UserMessages
import com.badrani.keygrain.ui.WongPalette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen() {
    val context = LocalContext.current
    val secretManager = remember { SecretManager(context) }
    val serviceManager = remember { ServiceManager(context) }
    val settingsPrefs = remember {
        context.getSharedPreferences("keygrain_settings", Context.MODE_PRIVATE)
    }

    var onboardingCompleted by remember {
        mutableStateOf(settingsPrefs.getBoolean("onboarding_completed", false))
    }
    var unlocked by remember { mutableStateOf(false) }
    var masterSecret by remember { mutableStateOf("") }
    var isDemoMode by remember { mutableStateOf(false) }

    when {
        !onboardingCompleted && !secretManager.hasSecret() -> {
            OnboardingWizard(
                secretManager = secretManager,
                serviceManager = serviceManager,
                onComplete = { secret ->
                    settingsPrefs.edit().putBoolean("onboarding_completed", true).apply()
                    onboardingCompleted = true
                    if (secret != null) {
                        masterSecret = secret
                        unlocked = true
                        SecretManager.sessionActive = true
                    }
                }
            )
        }
        !unlocked -> {
            UnlockScreen(
                secretManager = secretManager,
                showSubtitle = !secretManager.hasSecret(),
                onUnlocked = { secret ->
                    masterSecret = secret
                    unlocked = true
                    SecretManager.sessionActive = true
                },
                onDemo = {
                    isDemoMode = true
                    masterSecret = "demo-secret-keygrain"
                    unlocked = true
                }
            )
        }
        else -> {
            ServiceListScreen(
                masterSecret = masterSecret,
                serviceManager = serviceManager,
                isDemoMode = isDemoMode,
                onLock = {
                    unlocked = false
                    masterSecret = ""
                    isDemoMode = false
                    SecretManager.sessionActive = false
                    Keygrain.clearStrengthenCache()
                    if (android.os.Build.VERSION.SDK_INT >= 28) {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.clearPrimaryClip()
                    }
                    if (!canUseBiometric(context)) {
                        secretManager.clearSecret()
                    }
                }
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun UnlockScreen(
    secretManager: SecretManager,
    showSubtitle: Boolean = false,
    onUnlocked: (String) -> Unit,
    onDemo: () -> Unit
) {
    val context = LocalContext.current
    var secret by remember { mutableStateOf("") }
    var secretVisible by remember { mutableStateOf(false) }
    var fingerprintIndices by remember { mutableStateOf<List<Int>>(emptyList()) }

    LaunchedEffect(secret) {
        if (secret.isEmpty()) {
            fingerprintIndices = emptyList()
            return@LaunchedEffect
        }
        delay(500)
        fingerprintIndices = Keygrain.secretFingerprint(secret.toByteArray())
    }

    // Auto-trigger biometric if secret is stored
    LaunchedEffect(Unit) {
        if (secretManager.hasSecret() && canUseBiometric(context)) {
            showBiometric(context) {
                secretManager.getSecret()?.let { onUnlocked(it) }
            }
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Keygrain") }) }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .padding(16.dp)
                .fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (secretManager.hasSecret()) {
                Text("Unlock with biometric or enter master secret")
                Spacer(Modifier.height(16.dp))
                Button(onClick = {
                    if (canUseBiometric(context)) {
                        showBiometric(context) {
                            secretManager.getSecret()?.let { onUnlocked(it) }
                        }
                    }
                }) {
                    Icon(Icons.Default.Fingerprint, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Unlock")
                }
                Spacer(Modifier.height(24.dp))
                HorizontalDivider()
                Spacer(Modifier.height(24.dp))
            }

            if (showSubtitle) {
                Text(
                    "Enter your master secret — the single passphrase that generates all your passwords.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(Modifier.height(16.dp))
            }

            OutlinedTextField(
                value = secret,
                onValueChange = { secret = it },
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
            if (secret.isNotEmpty()) {
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
                    color = color,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
            if (fingerprintIndices.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.align(Alignment.CenterHorizontally)) {
                    fingerprintIndices.forEach { idx ->
                        Box(Modifier.size(16.dp).background(WongPalette[idx], CircleShape))
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = {
                    if (secret.isNotBlank()) {
                        if (canUseBiometric(context)) {
                            secretManager.saveSecret(secret)
                        }
                        onUnlocked(secret)
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = secret.isNotBlank()
            ) {
                Text("Unlock")
            }
            Spacer(Modifier.height(16.dp))
            TextButton(onClick = onDemo) {
                Text("Try Demo")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ServiceListScreen(
    masterSecret: String,
    serviceManager: ServiceManager,
    isDemoMode: Boolean = false,
    onLock: () -> Unit
) {
    val context = LocalContext.current
    val demoServices = remember { listOf(
        ServiceEntry(name = "GitHub", site = "github.com", email = "demo@example.com", length = 20, symbols = Keygrain.DEFAULT_SYMBOLS, counter = 1, updatedAt = 1),
        ServiceEntry(name = "Google", site = "google.com", email = "demo@example.com", length = 20, symbols = Keygrain.DEFAULT_SYMBOLS, counter = 1, updatedAt = 2),
        ServiceEntry(name = "Netflix", site = "netflix.com", email = "demo@example.com", length = 20, symbols = Keygrain.DEFAULT_SYMBOLS, counter = 1, updatedAt = 3),
        ServiceEntry(name = "Amazon", site = "amazon.com", email = "demo@example.com", length = 20, symbols = Keygrain.DEFAULT_SYMBOLS, counter = 1, updatedAt = 4),
        ServiceEntry(name = "Twitter", site = "twitter.com", email = "demo@example.com", length = 20, symbols = Keygrain.DEFAULT_SYMBOLS, counter = 1, updatedAt = 5),
    ) }
    var services by remember { mutableStateOf(if (isDemoMode) demoServices else serviceManager.getServices()) }
    var searchQuery by remember { mutableStateOf("") }
    val filteredServices = remember(services, searchQuery) {
        if (searchQuery.isBlank()) services.sortedByDescending { it.frecency }
        else services.mapNotNull { svc ->
            val score = maxOf(fuzzyScore(searchQuery, svc.name), fuzzyScore(searchQuery, svc.email))
            if (score > 0) Pair(svc, score) else null
        }.sortedByDescending { (svc, score) -> score * (1 + svc.frecency) }
            .map { it.first }
    }
    var showAddDialog by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf<String?>(null) }
    var showEditDialog by remember { mutableStateOf<ServiceEntry?>(null) }
    var menuExpanded by remember { mutableStateOf(false) }
    var showHelpScreen by remember { mutableStateOf(false) }
    var showWalletScreen by remember { mutableStateOf(false) }
    var showSyncEmailDialog by remember { mutableStateOf(false) }
    var syncEmail by remember { mutableStateOf("") }
    var isSyncing by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val syncManager = remember { SyncManager() }

    // Auto-sync state
    var syncGeneration by remember { mutableIntStateOf(0) }
    var skipNextDebounce by remember { mutableStateOf(false) }
    var lastSyncTime by remember { mutableLongStateOf(0L) }

    fun getMostCommonEmail(): String =
        services.groupingBy { it.email }.eachCount().maxByOrNull { it.value }?.key ?: ""

    fun performAutoSync() {
        if (isDemoMode || isSyncing) return
        val email = getMostCommonEmail()
        if (email.isBlank()) return
        isSyncing = true
        val gen = syncGeneration
        scope.launch {
            try {
                val secretBytes = masterSecret.toByteArray()
                try {
                    when (val r = syncManager.sync(secretBytes, email, serviceManager, context)) {
                        is SyncResult.Success -> {
                            if (syncGeneration != gen) return@launch
                            skipNextDebounce = true
                            services = serviceManager.getServices()
                            lastSyncTime = System.currentTimeMillis()
                        }
                        else -> { /* silent failure for auto-sync */ }
                    }
                } finally { secretBytes.fill(0) }
            } catch (_: Exception) { }
            finally { isSyncing = false }
        }
    }

    fun triggerDebouncedSync() {
        if (skipNextDebounce) { skipNextDebounce = false; return }
        syncGeneration++
        val gen = syncGeneration
        scope.launch {
            delay(5000)
            if (syncGeneration == gen) performAutoSync()
        }
    }

    // Auto-sync on unlock (initial load)
    LaunchedEffect(Unit) { performAutoSync() }

    // Clear sessionActive if composable is disposed (Activity death)
    DisposableEffect(Unit) {
        onDispose { SecretManager.sessionActive = false }
    }

    // Auto-lock timer (15 min)
    var lockSecondsRemaining by remember { mutableIntStateOf(15 * 60) }
    var showLockWarning by remember { mutableStateOf(false) }
    val lockTimerReset = remember { mutableLongStateOf(System.currentTimeMillis()) }

    LaunchedEffect(lockTimerReset.longValue) {
        lockSecondsRemaining = 15 * 60
        showLockWarning = false
        while (lockSecondsRemaining > 0) {
            delay(1000)
            lockSecondsRemaining--
            showLockWarning = lockSecondsRemaining <= 60
        }
        onLock()
    }

    // Reset auto-lock on keyboard input (searchQuery changes)
    LaunchedEffect(searchQuery) {
        lockTimerReset.longValue = System.currentTimeMillis()
    }

    // Export/Import state
    var fileAction by remember { mutableStateOf<String?>(null) } // "export" or "import"
    var fileEmail by remember { mutableStateOf("") }
    var showImportConfirm by remember { mutableStateOf(false) }
    var importedServices by remember { mutableStateOf<List<ServiceEntry>>(emptyList()) }

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream")
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val msg = try {
                val key = Keygrain.deriveEncryptionKey(masterSecret.toByteArray(), fileEmail)
                try {
                    val json = serviceManager.exportJson().toByteArray()
                    val encrypted = SyncCrypto.encrypt(key, json)
                    context.contentResolver.openOutputStream(uri)?.use { it.write(encrypted) }
                    UserMessages.exportSuccess(services.size)
                } finally {
                    key.fill(0)
                }
            } catch (e: Exception) {
                Log.e("Keygrain", "Export failed", e)
                UserMessages.EXPORT_ERROR
            }
            snackbarHostState.showSnackbar(msg)
        }
    }

    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                val key = Keygrain.deriveEncryptionKey(masterSecret.toByteArray(), fileEmail)
                try {
                    val blob = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: throw Exception("Cannot read file")
                    val json = SyncCrypto.decrypt(key, blob).toString(Charsets.UTF_8)
                    importedServices = serviceManager.parseJson(json)
                    showImportConfirm = true
                } finally {
                    key.fill(0)
                }
            } catch (e: javax.crypto.AEADBadTagException) {
                Log.e("Keygrain", "Import decryption failed", e)
                snackbarHostState.showSnackbar(UserMessages.DECRYPT_FILE_ERROR)
            } catch (e: Exception) {
                Log.e("Keygrain", "Import failed", e)
                snackbarHostState.showSnackbar(UserMessages.IMPORT_ERROR)
            }
        }
    }

    if (showWalletScreen) {
        WalletScreen(
            masterSecret = masterSecret,
            isDemoMode = isDemoMode,
            defaultEmail = services.groupingBy { it.email }.eachCount()
                .maxByOrNull { it.value }?.key ?: "",
            onBack = { showWalletScreen = false }
        )
        return
    }

    if (showHelpScreen) {
        HelpScreen(onBack = { showHelpScreen = false })
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Keygrain") },
                actions = {
                    Box {
                        IconButton(onClick = { menuExpanded = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "Menu")
                        }
                        DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                            DropdownMenuItem(
                                text = { Text("Sync") },
                                onClick = {
                                    menuExpanded = false
                                    syncEmail = services.groupingBy { it.email }.eachCount()
                                        .maxByOrNull { it.value }?.key ?: ""
                                    showSyncEmailDialog = true
                                }
                            )
                            HorizontalDivider()
                            DropdownMenuItem(
                                text = { Text("Export to file") },
                                onClick = {
                                    menuExpanded = false
                                    fileEmail = services.groupingBy { it.email }.eachCount()
                                        .maxByOrNull { it.value }?.key ?: ""
                                    fileAction = "export"
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Import from file") },
                                onClick = {
                                    menuExpanded = false
                                    fileEmail = services.groupingBy { it.email }.eachCount()
                                        .maxByOrNull { it.value }?.key ?: ""
                                    fileAction = "import"
                                }
                            )
                            HorizontalDivider()
                            DropdownMenuItem(
                                text = { Text("Help") },
                                onClick = {
                                    menuExpanded = false
                                    showHelpScreen = true
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Wallet") },
                                onClick = {
                                    menuExpanded = false
                                    showWalletScreen = true
                                }
                            )
                        }
                    }
                    IconButton(onClick = onLock) {
                        Icon(Icons.Default.Lock, contentDescription = "Lock")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = {
            FloatingActionButton(onClick = { showAddDialog = true }) {
                Icon(Icons.Default.Add, contentDescription = "Add service")
            }
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().pointerInput(Unit) {
            awaitPointerEventScope {
                while (true) {
                    awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial)
                    lockTimerReset.longValue = System.currentTimeMillis()
                }
            }
        }) {
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
        // Auto-lock warning banner
        AnimatedVisibility(visible = showLockWarning) {
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "Locking in ${lockSecondsRemaining}s",
                        modifier = Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.onErrorContainer
                    )
                    TextButton(onClick = { lockTimerReset.longValue = System.currentTimeMillis() }) {
                        Text("Extend")
                    }
                }
            }
        }
        // Demo mode banner
        if (isDemoMode) {
            Surface(
                color = MaterialTheme.colorScheme.tertiaryContainer,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    "Demo Mode — nothing is saved",
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
        if (services.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Text("No services yet. Tap + to add one.")
            }
        } else {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                placeholder = { Text("Search services...") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                singleLine = true,
                trailingIcon = {
                    if (searchQuery.isNotEmpty()) {
                        IconButton(onClick = { searchQuery = "" }) {
                            Icon(Icons.Default.Clear, contentDescription = "Clear")
                        }
                    }
                }
            )
            if (lastSyncTime > 0L) {
                Text(
                    text = "Last synced: ${formatRelativeTime(lastSyncTime)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp)
                )
            }
            if (filteredServices.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Text("No matching services")
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(filteredServices, key = { it.name }) { service ->
                        ServiceCard(
                            service = service,
                            masterSecret = masterSecret,
                            onDelete = { showDeleteDialog = service.name },
                            onEdit = { showEditDialog = service },
                            onCopy = {
                                if (isDemoMode) {
                                    services = services.map {
                                        if (it.name == service.name) it.copy(frecency = it.frecency * 0.95 + 1)
                                        else it
                                    }
                                } else {
                                    serviceManager.updateFrecency(service.name)
                                    services = serviceManager.getServices()
                                    triggerDebouncedSync()
                                }
                            },
                            context = context
                        )
                    }
                }
            }
        }
        } // Column
        } // Box
    } // Scaffold

    // Sync email prompt dialog
    if (showSyncEmailDialog) {
        AlertDialog(
            onDismissRequest = { showSyncEmailDialog = false },
            title = { Text("Sync to Server") },
            text = {
                Column {
                    Text("Email for sync identity:")
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = syncEmail,
                        onValueChange = { syncEmail = it },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showSyncEmailDialog = false
                        isSyncing = true
                        val secretBytes = masterSecret.toByteArray()
                        scope.launch {
                            val msg = try {
                                when (val r = syncManager.sync(secretBytes, syncEmail, serviceManager, context)) {
                                    is SyncResult.Success -> {
                                        skipNextDebounce = true
                                        services = serviceManager.getServices()
                                        lastSyncTime = System.currentTimeMillis()
                                        UserMessages.syncSuccess(r.services.size)
                                    }
                                    is SyncResult.AuthError -> UserMessages.AUTH_ERROR
                                    is SyncResult.NetworkError -> UserMessages.NETWORK_ERROR
                                    is SyncResult.ServerError -> UserMessages.SERVER_ERROR
                                    is SyncResult.IntegrityError -> UserMessages.INTEGRITY_ERROR
                                    is SyncResult.ConflictError -> UserMessages.CONFLICT_ERROR
                                }
                            } catch (e: Exception) {
                                Log.e("Keygrain", "Sync failed", e)
                                UserMessages.NETWORK_ERROR
                            } finally {
                                secretBytes.fill(0)
                            }
                            isSyncing = false
                            snackbarHostState.showSnackbar(msg)
                        }
                    },
                    enabled = syncEmail.isNotBlank()
                ) { Text("Continue") }
            },
            dismissButton = {
                TextButton(onClick = { showSyncEmailDialog = false }) { Text("Cancel") }
            }
        )
    }

    // Loading dialog
    if (isSyncing) {
        AlertDialog(
            onDismissRequest = {},
            confirmButton = {},
            text = {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    CircularProgressIndicator()
                    Text("Syncing...")
                }
            }
        )
    }

    // File export/import email prompt
    fileAction?.let { action ->
        AlertDialog(
            onDismissRequest = { fileAction = null },
            title = { Text(if (action == "export") "Export to File" else "Import from File") },
            text = {
                Column {
                    Text("Email for encryption key:")
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = fileEmail,
                        onValueChange = { fileEmail = it },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        fileAction = null
                        if (action == "export") {
                            exportLauncher.launch("keygrain-backup.keygrain")
                        } else {
                            importLauncher.launch(arrayOf("application/octet-stream", "*/*"))
                        }
                    },
                    enabled = fileEmail.isNotBlank()
                ) { Text("Continue") }
            },
            dismissButton = {
                TextButton(onClick = { fileAction = null }) { Text("Cancel") }
            }
        )
    }

    // Import confirmation dialog
    if (showImportConfirm) {
        AlertDialog(
            onDismissRequest = { showImportConfirm = false },
            title = { Text("Confirm Import") },
            text = {
                Text("Replace all ${services.size} local services with ${importedServices.size} services from file?")
            },
            confirmButton = {
                TextButton(onClick = {
                    showImportConfirm = false
                    serviceManager.replaceAll(importedServices)
                    services = serviceManager.getServices()
                    scope.launch { snackbarHostState.showSnackbar(UserMessages.importSuccess(importedServices.size)) }
                }) { Text("Replace") }
            },
            dismissButton = {
                TextButton(onClick = { showImportConfirm = false }) { Text("Cancel") }
            }
        )
    }

    if (showAddDialog) {
        AddServiceDialog(
            onDismiss = { showAddDialog = false },
            onAdd = { entry ->
                if (isDemoMode) {
                    services = services + entry
                } else {
                    serviceManager.addService(entry)
                    services = serviceManager.getServices()
                    triggerDebouncedSync()
                }
                showAddDialog = false
            }
        )
    }

    showEditDialog?.let { editEntry ->
        AddServiceDialog(
            onDismiss = { showEditDialog = null },
            onAdd = { entry ->
                if (isDemoMode) {
                    services = services.map { if (it.name == editEntry.name) entry else it }
                } else {
                    serviceManager.updateService(editEntry.name, entry)
                    services = serviceManager.getServices()
                    triggerDebouncedSync()
                }
                showEditDialog = null
            },
            initialEntry = editEntry
        )
    }

    showDeleteDialog?.let { name ->
        AlertDialog(
            onDismissRequest = { showDeleteDialog = null },
            title = { Text("Delete $name?") },
            confirmButton = {
                TextButton(onClick = {
                    if (isDemoMode) {
                        services = services.filter { it.name != name }
                    } else {
                        serviceManager.deleteService(name)
                        services = serviceManager.getServices()
                        triggerDebouncedSync()
                    }
                    showDeleteDialog = null
                }) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = null }) { Text("Cancel") }
            }
        )
    }
}

@Composable
private fun ServiceCard(
    service: ServiceEntry,
    masterSecret: String,
    onDelete: () -> Unit,
    onEdit: () -> Unit,
    onCopy: () -> Unit,
    context: Context
) {
    val scope = rememberCoroutineScope()
    val password = remember(service, masterSecret) {
        Keygrain.derivePassword(
            secret = masterSecret.toByteArray(),
            email = service.email,
            site = service.site,
            length = service.length,
            symbols = service.symbols,
            counter = service.counter
        )
    }
    var visible by remember { mutableStateOf(false) }

    fun copyAndClear(label: String, text: String) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            scope.launch {
                delay(30_000)
                clipboard.clearPrimaryClip()
            }
        }
    }

    // TOTP state
    var totpCode by remember { mutableStateOf("") }
    var totpRemaining by remember { mutableIntStateOf(0) }
    val totpPeriod = service.totp?.optInt("period", 30) ?: 30

    if (service.totp != null) {
        LaunchedEffect(service.totp) {
            while (true) {
                val mode = service.totp.optString("mode", "")
                val digits = service.totp.optInt("digits", 6)
                val period = service.totp.optInt("period", 30)
                val algorithm = service.totp.optString("algorithm", "SHA1")
                val now = System.currentTimeMillis() / 1000
                try {
                    val seed = if (mode == "stored") {
                        android.util.Base64.decode(service.totp.getString("seed"), android.util.Base64.DEFAULT)
                    } else {
                        TotpEngine.deriveTotpSeed(masterSecret.toByteArray(), service.email, service.site)
                    }
                    totpCode = TotpEngine.generateTotp(seed, now, digits, period, algorithm)
                    totpRemaining = (period - (now % period)).toInt()
                } catch (_: Exception) {
                    totpCode = "error"
                    totpRemaining = 0
                }
                delay(1000)
            }
        }
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(service.name, style = MaterialTheme.typography.titleMedium)
                    Text(service.email, style = MaterialTheme.typography.bodySmall)
                }
                IconButton(onClick = onEdit) {
                    Icon(Icons.Default.Edit, contentDescription = "Edit")
                }
                IconButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, contentDescription = "Delete")
                }
            
            }
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = if (visible) password else "••••••••••••",
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = { visible = !visible }) {
                    Icon(
                        if (visible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = "Toggle"
                    )
                }
                IconButton(onClick = {
                    copyAndClear("password", password)
                    Toast.makeText(context, "Copied", Toast.LENGTH_SHORT).show()
                    onCopy()
                }) {
                    Icon(Icons.Default.ContentCopy, contentDescription = "Copy")
                }
            }
            // TOTP display
            if (service.totp != null && totpCode.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val formatted = if (totpCode.length == 8)
                        totpCode.substring(0, 4) + " " + totpCode.substring(4)
                    else
                        totpCode.substring(0, 3) + " " + totpCode.substring(3)
                    Text(
                        text = formatted,
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.weight(1f)
                    )
                    Text(
                        text = "${totpRemaining}s",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    IconButton(onClick = {
                        copyAndClear("totp", totpCode)
                        Toast.makeText(context, "TOTP copied", Toast.LENGTH_SHORT).show()
                        onCopy()
                    }) {
                        Icon(Icons.Default.ContentCopy, contentDescription = "Copy TOTP")
                    }
                }
                LinearProgressIndicator(
                    progress = { totpRemaining.toFloat() / totpPeriod },
                    modifier = Modifier.fillMaxWidth().height(4.dp),
                )
            }
            // SSH display
            if (service.ssh != null) {
                val sshKeyName = service.ssh.optString("key_name", "")
                if (sshKeyName.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(
                            color = MaterialTheme.colorScheme.primary,
                            shape = MaterialTheme.shapes.small
                        ) {
                            Text(
                                "SSH",
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = sshKeyName,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(onClick = {
                            try {
                                val sshCounter = service.ssh.optInt("counter", 1)
                                val kp = SshEngine.deriveSshKeypair(masterSecret.toByteArray(), service.email, sshKeyName, sshCounter)
                                val comment = "${service.email.lowercase()}:${sshKeyName.lowercase()}"
                                val line = SshEngine.formatAuthorizedKeys(kp.publicKey, comment)
                                copyAndClear("ssh-pubkey", line)
                                Toast.makeText(context, "SSH public key copied", Toast.LENGTH_SHORT).show()
                            } catch (e: Exception) {
                                Toast.makeText(context, "SSH error: ${e.message}", Toast.LENGTH_SHORT).show()
                            }
                        }) {
                            Icon(Icons.Default.ContentCopy, contentDescription = "Copy SSH public key")
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddServiceDialog(
    onDismiss: () -> Unit,
    onAdd: (ServiceEntry) -> Unit,
    initialEntry: ServiceEntry? = null
) {
    var name by remember { mutableStateOf(initialEntry?.name ?: "") }
    var site by remember { mutableStateOf(initialEntry?.site ?: "") }
    var email by remember { mutableStateOf(initialEntry?.email ?: "") }
    var length by remember { mutableStateOf(initialEntry?.length?.toString() ?: "20") }
    var symbols by remember { mutableStateOf(initialEntry?.symbols ?: Keygrain.DEFAULT_SYMBOLS) }
    var counter by remember { mutableStateOf(initialEntry?.counter?.toString() ?: "1") }
    var showAdvanced by remember { mutableStateOf(initialEntry != null) }
    val isEdit = initialEntry != null
    val pwChanged = isEdit && (
        (length.toIntOrNull() ?: 20) != initialEntry!!.length ||
        symbols != initialEntry.symbols ||
        (counter.toIntOrNull() ?: 1) != initialEntry.counter
    )

    // TOTP state
    val totpModes = listOf("None", "Stored", "Derived")
    val initialTotpMode = when (initialEntry?.totp?.optString("mode")) {
        "stored" -> 1
        "derived" -> 2
        else -> 0
    }
    var totpModeIndex by remember { mutableIntStateOf(initialTotpMode) }
    val originalTotpSeed = remember { initialEntry?.totp?.optString("seed", "") ?: "" }
    var totpSeed by remember { mutableStateOf(originalTotpSeed) }

    // SSH state
    var sshKeyName by remember { mutableStateOf(initialEntry?.ssh?.optString("key_name", "") ?: "") }

    // QR Scanner state
    var showQrScanner by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> if (granted) showQrScanner = true }

    // Auto-fill site from name if it looks like a domain
    LaunchedEffect(name) {
        if (!isEdit && site.isEmpty() && name.contains(".")) {
            site = name.lowercase()
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isEdit) "Edit Service" else "Add Service") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "ℹ️ Changing any field will generate a different password.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Service name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = site,
                    onValueChange = { if (!isEdit) site = it },
                    label = { Text("Site") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isEdit
                )
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
                )
                TextButton(
                    onClick = { showAdvanced = !showAdvanced },
                    modifier = Modifier.semantics {
                        contentDescription = if (showAdvanced) "Hide options" else "Show options"
                    }
                ) {
                    Text(if (showAdvanced) "⚙️ Hide options" else "⚙️ Options")
                }
                AnimatedVisibility(
                    visible = showAdvanced,
                    enter = expandVertically(),
                    exit = shrinkVertically()
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = length,
                            onValueChange = { length = it.filter { c -> c.isDigit() } },
                            label = { Text("Length") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                        )
                        OutlinedTextField(
                            value = symbols,
                            onValueChange = { symbols = it },
                            label = { Text("Symbols") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        OutlinedTextField(
                            value = counter,
                            onValueChange = { counter = it.filter { c -> c.isDigit() } },
                            label = { Text("Counter") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                        )
                        if (pwChanged) {
                            Text(
                                "⚠️ Changing these options will change your generated password.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error
                            )
                        }
                        // TOTP section
                        HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
                        Text("🔑 TOTP", style = MaterialTheme.typography.labelLarge)
                        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                            totpModes.forEachIndexed { index, label ->
                                SegmentedButton(
                                    selected = totpModeIndex == index,
                                    onClick = { totpModeIndex = index },
                                    shape = SegmentedButtonDefaults.itemShape(index, totpModes.size)
                                ) { Text(label, style = MaterialTheme.typography.bodySmall) }
                            }
                        }
                        if (totpModeIndex == 1) {
                            OutlinedTextField(
                                value = totpSeed,
                                onValueChange = { totpSeed = it },
                                label = { Text("Seed / otpauth:// URI") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                            OutlinedButton(
                                onClick = {
                                    if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                                        showQrScanner = true
                                    } else {
                                        cameraPermissionLauncher.launch(android.Manifest.permission.CAMERA)
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.Default.QrCodeScanner, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text("Scan QR")
                            }
                        }
                        // SSH section
                        HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
                        Text("🔐 SSH Key", style = MaterialTheme.typography.labelLarge)
                        OutlinedTextField(
                            value = sshKeyName,
                            onValueChange = { sshKeyName = it.filter { c -> !c.isWhitespace() } },
                            label = { Text("Key name (optional)") },
                            placeholder = { Text("e.g. github, work-servers") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val totpJson = when (totpModeIndex) {
                        1 -> { // Stored
                            val input = totpSeed.trim()
                            if (input == originalTotpSeed && initialEntry?.totp != null) {
                                initialEntry.totp
                            } else {
                                try {
                                    val parsed = TotpEngine.parseTotpInput(input)
                                    JSONObject().apply {
                                        put("mode", "stored")
                                        put("seed", android.util.Base64.encodeToString(parsed.seed, android.util.Base64.NO_WRAP))
                                        put("digits", parsed.digits)
                                        put("period", parsed.period)
                                        put("algorithm", parsed.algorithm)
                                    }
                                } catch (_: Exception) { null }
                            }
                        }
                        2 -> JSONObject().apply { // Derived
                            put("mode", "derived")
                            put("digits", 6)
                            put("period", 30)
                            put("algorithm", "SHA1")
                        }
                        else -> null
                    }
                    val sshJson = if (sshKeyName.isNotBlank()) {
                        val sshCounter = initialEntry?.ssh?.optInt("counter", 1) ?: 1
                        JSONObject().apply {
                            put("key_name", sshKeyName.trim())
                            put("counter", sshCounter)
                        }
                    } else null
                    onAdd(ServiceEntry(
                        name = name.trim(),
                        site = site.trim().ifEmpty { name.trim().lowercase() },
                        email = email.trim(),
                        length = (length.toIntOrNull() ?: 20).coerceAtLeast(8),
                        symbols = symbols.ifEmpty { Keygrain.DEFAULT_SYMBOLS },
                        counter = (counter.toIntOrNull() ?: 1).coerceAtLeast(1),
                        totp = totpJson,
                        ssh = sshJson
                    ))
                },
                enabled = name.isNotBlank() && email.isNotBlank()
            ) { Text(if (isEdit) "Save" else "Add") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )

    if (showQrScanner) {
        QrScannerDialog(
            onResult = { uri ->
                showQrScanner = false
                if (uri != null) totpSeed = uri
            },
            onDismiss = { showQrScanner = false }
        )
    }
}

@Composable
private fun QrScannerDialog(onResult: (String?) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = androidx.compose.ui.platform.LocalLifecycleOwner.current
    var detected by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Scan QR Code") },
        text = {
            AndroidView(
                factory = { ctx ->
                    val previewView = androidx.camera.view.PreviewView(ctx)
                    val cameraProviderFuture = androidx.camera.lifecycle.ProcessCameraProvider.getInstance(ctx)
                    cameraProviderFuture.addListener({
                        val cameraProvider = cameraProviderFuture.get()
                        val preview = androidx.camera.core.Preview.Builder().build().also {
                            it.setSurfaceProvider(previewView.surfaceProvider)
                        }
                        val analyzer = androidx.camera.core.ImageAnalysis.Builder()
                            .setBackpressureStrategy(androidx.camera.core.ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()
                        analyzer.setAnalyzer(ContextCompat.getMainExecutor(ctx)) { imageProxy ->
                            @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
                            val mediaImage = imageProxy.image
                            if (mediaImage != null && !detected) {
                                val inputImage = com.google.mlkit.vision.common.InputImage.fromMediaImage(
                                    mediaImage, imageProxy.imageInfo.rotationDegrees
                                )
                                com.google.mlkit.vision.barcode.BarcodeScanning.getClient()
                                    .process(inputImage)
                                    .addOnSuccessListener { barcodes ->
                                        for (barcode in barcodes) {
                                            val value = barcode.rawValue
                                            if (value != null && value.startsWith("otpauth://")) {
                                                detected = true
                                                onResult(value)
                                                return@addOnSuccessListener
                                            }
                                        }
                                    }
                                    .addOnCompleteListener { imageProxy.close() }
                            } else {
                                imageProxy.close()
                            }
                        }
                        try {
                            cameraProvider.unbindAll()
                            cameraProvider.bindToLifecycle(
                                lifecycleOwner,
                                androidx.camera.core.CameraSelector.DEFAULT_BACK_CAMERA,
                                preview, analyzer
                            )
                        } catch (_: Exception) {}
                    }, ContextCompat.getMainExecutor(ctx))
                    previewView
                },
                modifier = Modifier.fillMaxWidth().height(300.dp)
            )
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}
private fun canUseBiometric(context: Context): Boolean {
    return BiometricManager.from(context)
        .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
        BiometricManager.BIOMETRIC_SUCCESS
}

private fun fuzzyScore(query: String, text: String): Int {
    val q = query.lowercase()
    val t = text.lowercase()
    var qi = 0; var score = 0; var consecutive = 0; var prevIdx = -2
    for (ti in t.indices) {
        if (qi >= q.length) break
        if (t[ti] == q[qi]) {
            score++
            if (ti == prevIdx + 1) { consecutive++; score += consecutive }
            else consecutive = 0
            if (ti == 0) score += 2
            if (ti > 0 && t[ti - 1].let { it == ' ' || it == '-' || it == '_' || it == '.' }) score += 2
            prevIdx = ti
            qi++
        }
    }
    return if (qi == q.length) score else 0
}

private fun formatRelativeTime(ts: Long): String {
    val diff = (System.currentTimeMillis() - ts) / 1000
    return when {
        diff < 60 -> "just now"
        diff < 3600 -> "${diff / 60}m ago"
        else -> "${diff / 3600}h ago"
    }
}

private fun showBiometric(context: Context, onSuccess: () -> Unit) {
    val activity = context as FragmentActivity
    val executor = ContextCompat.getMainExecutor(activity)
    val prompt = BiometricPrompt(activity, executor, object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            onSuccess()
        }
    })
    prompt.authenticate(
        BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock Keygrain")
            .setSubtitle("Authenticate to access your passwords")
            .setNegativeButtonText("Cancel")
            .build()
    )
}
