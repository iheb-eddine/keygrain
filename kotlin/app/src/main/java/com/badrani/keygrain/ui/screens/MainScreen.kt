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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.badrani.keygrain.data.Keygrain
import com.badrani.keygrain.data.RestoreResult
import com.badrani.keygrain.data.SecretManager
import com.badrani.keygrain.data.ServiceEntry
import com.badrani.keygrain.data.ServiceManager
import com.badrani.keygrain.data.SyncCrypto
import com.badrani.keygrain.data.SyncManager
import com.badrani.keygrain.data.SyncResult
import com.badrani.keygrain.ui.UserMessages
import com.badrani.keygrain.ui.WongPalette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

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
                }
            )
        }
        else -> {
            ServiceListScreen(
                masterSecret = masterSecret,
                serviceManager = serviceManager,
                onLock = {
                    unlocked = false
                    masterSecret = ""
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
    onUnlocked: (String) -> Unit
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
                        secretManager.saveSecret(secret)
                        onUnlocked(secret)
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = secret.isNotBlank()
            ) {
                Text("Unlock")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ServiceListScreen(
    masterSecret: String,
    serviceManager: ServiceManager,
    onLock: () -> Unit
) {
    val context = LocalContext.current
    var services by remember { mutableStateOf(serviceManager.getServices()) }
    var searchQuery by remember { mutableStateOf("") }
    val filteredServices = remember(services, searchQuery) {
        if (searchQuery.isBlank()) services
        else services.filter {
            it.name.contains(searchQuery, ignoreCase = true) ||
                it.email.contains(searchQuery, ignoreCase = true)
        }
    }
    var showAddDialog by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf<String?>(null) }
    var showEditDialog by remember { mutableStateOf<ServiceEntry?>(null) }
    var menuExpanded by remember { mutableStateOf(false) }
    var syncAction by remember { mutableStateOf<String?>(null) } // "backup" or "restore"
    var syncEmail by remember { mutableStateOf("") }
    var showConfirmDialog by remember { mutableStateOf<String?>(null) }
    var isSyncing by remember { mutableStateOf(false) }
    var showConflictDialog by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val syncManager = remember { SyncManager() }

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
                                text = { Text("Backup to server") },
                                onClick = {
                                    menuExpanded = false
                                    syncEmail = services.groupingBy { it.email }.eachCount()
                                        .maxByOrNull { it.value }?.key ?: ""
                                    syncAction = "backup"
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Restore from server") },
                                onClick = {
                                    menuExpanded = false
                                    syncEmail = services.groupingBy { it.email }.eachCount()
                                        .maxByOrNull { it.value }?.key ?: ""
                                    syncAction = "restore"
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
        if (services.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Text("No services yet. Tap + to add one.")
            }
        } else {
            Column(modifier = Modifier.padding(padding)) {
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
                                context = context
                            )
                        }
                    }
                }
            }
        }
    }

    // Email prompt dialog
    syncAction?.let { action ->
        AlertDialog(
            onDismissRequest = { syncAction = null },
            title = { Text(if (action == "backup") "Backup to Server" else "Restore from Server") },
            text = {
                Column {
                    Text("Email for backup identity:")
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
                        syncAction = null
                        showConfirmDialog = action
                    },
                    enabled = syncEmail.isNotBlank()
                ) { Text("Continue") }
            },
            dismissButton = {
                TextButton(onClick = { syncAction = null }) { Text("Cancel") }
            }
        )
    }

    // Confirmation dialog
    showConfirmDialog?.let { action ->
        AlertDialog(
            onDismissRequest = { showConfirmDialog = null },
            title = { Text("Confirm") },
            text = {
                Text(
                    if (action == "backup")
                        "Back up ${services.size} services to the server? This will overwrite any existing backup for this email."
                    else
                        "Restore from server? This will replace all ${services.size} local services with the backup."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showConfirmDialog = null
                    isSyncing = true
                    val secretBytes = masterSecret.toByteArray()
                    scope.launch {
                        val msg: String? = try {
                            if (action == "backup") {
                                when (val r = syncManager.backup(secretBytes, syncEmail, serviceManager, context)) {
                                    is SyncResult.Success -> UserMessages.backupSuccess(services.size)
                                    is SyncResult.Conflict -> {
                                        showConflictDialog = true
                                        null
                                    }
                                    is SyncResult.AuthError -> UserMessages.AUTH_ERROR
                                    is SyncResult.NetworkError -> UserMessages.NETWORK_ERROR
                                    is SyncResult.ServerError -> UserMessages.SERVER_ERROR
                                }
                            } else {
                                when (val r = syncManager.restore(secretBytes, syncEmail, serviceManager, context)) {
                                    is RestoreResult.Success -> {
                                        services = serviceManager.getServices()
                                        UserMessages.restoreSuccess(r.services.size)
                                    }
                                    is RestoreResult.AuthError -> UserMessages.AUTH_ERROR
                                    is RestoreResult.NetworkError -> UserMessages.NETWORK_ERROR
                                    is RestoreResult.NotFound -> UserMessages.NOT_FOUND
                                    is RestoreResult.DecryptionError -> UserMessages.DECRYPT_BACKUP_ERROR
                                    is RestoreResult.ServerError -> UserMessages.SERVER_ERROR
                                }
                            }
                        } finally {
                            secretBytes.fill(0)
                        }
                        isSyncing = false
                        if (msg != null) snackbarHostState.showSnackbar(msg)
                    }
                }) { Text(if (action == "backup") "Backup" else "Restore") }
            },
            dismissButton = {
                TextButton(onClick = { showConfirmDialog = null }) { Text("Cancel") }
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

    // Conflict dialog
    if (showConflictDialog) {
        AlertDialog(
            onDismissRequest = { showConflictDialog = false },
            title = { Text("Backup conflict detected") },
            text = {
                Text("Another device updated your backup since you last synced. To avoid losing that device\u2019s changes:\n\n1. Restore to get the latest backup\n2. Review and re-add any local changes\n3. Backup again")
            },
            confirmButton = {
                TextButton(onClick = {
                    showConflictDialog = false
                    isSyncing = true
                    val secretBytes = masterSecret.toByteArray()
                    scope.launch {
                        val msg = when (val r = syncManager.restore(secretBytes, syncEmail, serviceManager, context)) {
                            is RestoreResult.Success -> {
                                services = serviceManager.getServices()
                                UserMessages.restoreSuccess(r.services.size)
                            }
                            is RestoreResult.AuthError -> UserMessages.AUTH_ERROR
                            is RestoreResult.NetworkError -> UserMessages.NETWORK_ERROR
                            is RestoreResult.NotFound -> UserMessages.NOT_FOUND
                            is RestoreResult.DecryptionError -> UserMessages.DECRYPT_BACKUP_ERROR
                            is RestoreResult.ServerError -> UserMessages.SERVER_ERROR
                        }
                        secretBytes.fill(0)
                        isSyncing = false
                        snackbarHostState.showSnackbar(msg)
                    }
                }) { Text("Restore Now") }
            },
            dismissButton = {
                TextButton(onClick = { showConflictDialog = false }) { Text("Cancel") }
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
                serviceManager.addService(entry)
                services = serviceManager.getServices()
                showAddDialog = false
            }
        )
    }

    showEditDialog?.let { editEntry ->
        AddServiceDialog(
            onDismiss = { showEditDialog = null },
            onAdd = { entry ->
                serviceManager.updateService(editEntry.name, entry)
                services = serviceManager.getServices()
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
                    serviceManager.deleteService(name)
                    services = serviceManager.getServices()
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
    context: Context
) {
    val password = remember(service, masterSecret) {
        Keygrain.derivePassword(
            secret = masterSecret.toByteArray(),
            email = service.email,
            length = service.length,
            symbols = service.symbols,
            salt = service.salt
        )
    }
    var visible by remember { mutableStateOf(false) }

    Card(modifier = Modifier.fillMaxWidth()) {
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
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("password", password))
                    Toast.makeText(context, "Copied", Toast.LENGTH_SHORT).show()
                }) {
                    Icon(Icons.Default.ContentCopy, contentDescription = "Copy")
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
    var email by remember { mutableStateOf(initialEntry?.email ?: "") }
    var length by remember { mutableStateOf(initialEntry?.length?.toString() ?: "20") }
    var symbols by remember { mutableStateOf(initialEntry?.symbols ?: Keygrain.DEFAULT_SYMBOLS) }
    var salt by remember { mutableStateOf(initialEntry?.salt ?: "") }
    var showAdvanced by remember { mutableStateOf(initialEntry != null) }
    val isEdit = initialEntry != null
    val pwChanged = isEdit && (
        (length.toIntOrNull() ?: 20) != initialEntry!!.length ||
        symbols != initialEntry.symbols ||
        salt != initialEntry.salt
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isEdit) "Edit Service" else "Add Service") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Service name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
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
                            value = salt,
                            onValueChange = { salt = it },
                            label = { Text("Salt") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        if (pwChanged) {
                            Text(
                                "⚠️ Changing these options will change your generated password.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onAdd(ServiceEntry(
                        name = name.trim(),
                        email = email.trim(),
                        length = (length.toIntOrNull() ?: 20).coerceAtLeast(8),
                        symbols = symbols.ifEmpty { Keygrain.DEFAULT_SYMBOLS },
                        salt = salt
                    ))
                },
                enabled = name.isNotBlank() && email.isNotBlank()
            ) { Text(if (isEdit) "Save" else "Add") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

private fun canUseBiometric(context: Context): Boolean {
    return BiometricManager.from(context)
        .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
        BiometricManager.BIOMETRIC_SUCCESS
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
