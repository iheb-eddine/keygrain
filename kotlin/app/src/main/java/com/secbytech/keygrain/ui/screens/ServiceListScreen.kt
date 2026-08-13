package com.secbytech.keygrain.ui.screens

import android.content.ClipboardManager
import android.content.Context
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.data.DeleteResult
import com.secbytech.keygrain.data.Keygrain
import com.secbytech.keygrain.data.PublicSuffixList
import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.data.ServiceManager
import com.secbytech.keygrain.data.SyncCrypto
import com.secbytech.keygrain.data.SyncManager
import com.secbytech.keygrain.data.SyncResult
import com.secbytech.keygrain.ui.UserMessages
import com.secbytech.keygrain.ui.components.ServiceCard
import com.secbytech.keygrain.ui.util.formatRelativeTime
import com.secbytech.keygrain.ui.util.fuzzyScore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ServiceListScreen(
    masterSecret: String,
    serviceManager: ServiceManager,
    isDemoMode: Boolean = false,
    onLock: () -> Unit,
    onSwitchAccount: () -> Unit,
    onWipeLocalAndRestart: () -> Unit
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
    var prefillSite by remember { mutableStateOf<String?>(null) }
    var detectedFullDomain by remember { mutableStateOf<String?>(null) }
    var showDeleteDialog by remember { mutableStateOf<String?>(null) }
    var showEditDialog by remember { mutableStateOf<ServiceEntry?>(null) }
    var detailService by remember { mutableStateOf<ServiceEntry?>(null) }
    var menuExpanded by remember { mutableStateOf(false) }
    var showHelpScreen by remember { mutableStateOf(false) }
    var showWalletScreen by remember { mutableStateOf(false) }
    var showSwitchAccountDialog by remember { mutableStateOf(false) }
    var showSyncEmailDialog by remember { mutableStateOf(false) }
    // Sync v3 deletion review (Frozen Req 7): services this device changed that were
    // deleted on another device. Populated by SyncManager on a confirmed sync.
    var deletionReview by remember {
        mutableStateOf(if (isDemoMode) emptyList() else serviceManager.getDeletionReview())
    }
    var showDeletionReviewScreen by remember { mutableStateOf(false) }
    var syncEmail by remember { mutableStateOf("") }
    var isSyncing by remember { mutableStateOf(false) }
    var syncFailed by remember { mutableStateOf(false) }
    var syncUpgradeRequired by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    // Survivor scope for clipboard 30s auto-clears. Owned by ServiceListScreen so it
    // stays alive across the Help/Wallet/editor/detail early-returns (a per-card or
    // per-detail scope would be cancelled on navigation, leaving copies un-wiped).
    // Cancelled only when ServiceListScreen itself is disposed (e.g. onLock), which
    // already clears the clipboard — so no leak there.
    val clipboardScope = rememberCoroutineScope()
    val syncManager = remember { SyncManager() }
    val settingsPrefs = remember {
        context.getSharedPreferences("keygrain_settings", Context.MODE_PRIVATE)
    }
    var offlineMode by remember { mutableStateOf(settingsPrefs.getBoolean("offline_mode", false)) }

    // Delete-server-data flow state
    var showDeleteServerDialog by remember { mutableStateOf(false) }
    var keepLocal by remember { mutableStateOf(true) }
    var deleteInProgress by remember { mutableStateOf(false) }
    var deleteError by remember { mutableStateOf<String?>(null) }

    // Auto-sync state
    var syncGeneration by remember { mutableIntStateOf(0) }
    var skipNextDebounce by remember { mutableStateOf(false) }
    var lastSyncTime by remember { mutableLongStateOf(0L) }

    // Tick to force subtitle recomposition every 60s
    var subtitleTick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(60_000); subtitleTick++ } }

    fun getMostCommonEmail(): String =
        services.groupingBy { it.email }.eachCount().maxByOrNull { it.value }?.key ?: ""

    fun performAutoSync() {
        if (isDemoMode || isSyncing || offlineMode || deleteInProgress) return
        val email = syncManager.getSyncEmail(context) ?: getMostCommonEmail()
        if (email.isBlank()) return
        isSyncing = true
        syncUpgradeRequired = false
        val gen = syncGeneration
        scope.launch {
            try {
                val secretBytes = masterSecret.toByteArray()
                try {
                    when (syncManager.sync(secretBytes, email, serviceManager, context)) {
                        is SyncResult.Success -> {
                            if (syncGeneration != gen) return@launch
                            syncManager.setSyncEmail(context, email)
                            skipNextDebounce = true
                            services = serviceManager.getServices()
                            deletionReview = serviceManager.getDeletionReview()
                            lastSyncTime = System.currentTimeMillis()
                            syncFailed = false
                            syncUpgradeRequired = false
                        }
                        is SyncResult.UpgradeRequired -> {
                            syncFailed = true
                            syncUpgradeRequired = true
                        }
                        else -> {
                            syncFailed = true
                            syncUpgradeRequired = false
                        }
                    }
                } finally { secretBytes.fill(0) }
            } catch (_: Exception) { }
            finally { isSyncing = false }
        }
    }

    fun triggerDebouncedSync() {
        if (offlineMode || deleteInProgress) return
        if (skipNextDebounce) { skipNextDebounce = false; return }
        syncGeneration++
        val gen = syncGeneration
        scope.launch {
            delay(5000)
            if (syncGeneration == gen) performAutoSync()
        }
    }

    // Auto-sync on unlock (initial load)
    LaunchedEffect(Unit) {
        if (!isDemoMode) {
            // Sync v3 one-time migration (design §8): must run before the first v3 sync so
            // a deletion that had not yet propagated is preserved as a tombstone rather
            // than lost. Self-guarded (no-op once known_uuids is gone), safe to call every
            // launch. Runs regardless of offline mode — it only rewrites local state.
            withContext(Dispatchers.IO) {
                syncManager.migrateFromKnownUUIDs(context, serviceManager)
            }
            services = serviceManager.getServices()
            deletionReview = serviceManager.getDeletionReview()
        }
        performAutoSync()
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
            val msg = withContext(Dispatchers.IO) {
                try {
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
            }
            snackbarHostState.showSnackbar(msg)
        }
    }

    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            var parsed: List<ServiceEntry>? = null
            val errMsg: String? = withContext(Dispatchers.IO) {
                try {
                    val key = Keygrain.deriveEncryptionKey(masterSecret.toByteArray(), fileEmail)
                    try {
                        val blob = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                            ?: throw Exception("Cannot read file")
                        val json = SyncCrypto.decrypt(key, blob).toString(Charsets.UTF_8)
                        parsed = serviceManager.parseJson(json)
                        null
                    } finally {
                        key.fill(0)
                    }
                } catch (e: javax.crypto.AEADBadTagException) {
                    Log.e("Keygrain", "Import decryption failed", e)
                    UserMessages.DECRYPT_FILE_ERROR
                } catch (e: Exception) {
                    Log.e("Keygrain", "Import failed", e)
                    UserMessages.IMPORT_ERROR
                }
            }
            if (errMsg != null) {
                snackbarHostState.showSnackbar(errMsg)
            } else {
                importedServices = parsed ?: emptyList()
                showImportConfirm = true
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

    if (showDeletionReviewScreen) {
        DeletionReviewScreen(
            entries = deletionReview,
            onRestore = { entry ->
                // Re-insert under the original id (synced=false so a failed push re-pushes
                // rather than risking deletion), then push so other devices recreate it.
                serviceManager.restoreFromReview(entry)
                services = serviceManager.getServices()
                deletionReview = serviceManager.getDeletionReview()
                triggerDebouncedSync()
                if (deletionReview.none { !it.seen }) showDeletionReviewScreen = false
            },
            onDiscard = { entry ->
                // Accept the deletion: drop the review entry, keep the service deleted.
                serviceManager.setDeletionReview(
                    deletionReview.filter { it.service.id != entry.service.id }
                )
                deletionReview = serviceManager.getDeletionReview()
                if (deletionReview.isEmpty()) showDeletionReviewScreen = false
            },
            onDismissAll = {
                // Keep entries but stop nagging (mirrors the extension's dismiss-all).
                serviceManager.setDeletionReview(deletionReview.map { it.copy(seen = true) })
                deletionReview = serviceManager.getDeletionReview()
                showDeletionReviewScreen = false
            },
            onBack = { showDeletionReviewScreen = false }
        )
        return
    }

    // Full-screen editor (Add + Edit) — replaces the old ModalBottomSheet. Full-screen
    // early-return has no drag-to-dismiss gesture, so over-scroll can no longer discard input.
    if (prefillSite != null || showEditDialog != null) {
        val editEntry = showEditDialog
        ServiceEditorScreen(
            initialEntry = editEntry,
            initialSite = prefillSite ?: "",
            detectedFullDomain = detectedFullDomain,
            defaultEmail = getMostCommonEmail(),
            onInteraction = { lockTimerReset.longValue = System.currentTimeMillis() },
            onDismiss = {
                prefillSite = null; detectedFullDomain = null; showEditDialog = null
            },
            onSave = { entry ->
                if (editEntry != null) {
                    if (isDemoMode) {
                        services = services.map { if (it.name == editEntry.name) entry else it }
                        showEditDialog = null
                        true
                    } else if (serviceManager.updateService(editEntry.id!!, entry)) {
                        services = serviceManager.getServices()
                        triggerDebouncedSync()
                        showEditDialog = null
                        true
                    } else false
                } else {
                    if (isDemoMode) {
                        services = services + entry
                        prefillSite = null; detectedFullDomain = null
                        true
                    } else if (serviceManager.addService(entry)) {
                        services = serviceManager.getServices()
                        triggerDebouncedSync()
                        prefillSite = null; detectedFullDomain = null
                        true
                    } else false
                }
            }
        )
        return
    }

    // Read-only detail view (reached by tapping a card in Unit 5). Full-screen early-return.
    detailService?.let { detail ->
        ServiceDetailScreen(
            service = detail,
            masterSecret = masterSecret,
            clipboardScope = clipboardScope,
            context = context,
            onBack = { detailService = null },
            onEdit = { showEditDialog = detail; detailService = null },
            onDelete = { showDeleteDialog = detail.id; detailService = null },
            onInteraction = { lockTimerReset.longValue = System.currentTimeMillis() },
            onCopy = {
                if (isDemoMode) {
                    services = services.map {
                        if (it.name == detail.name) it.copy(frecency = it.frecency * 0.95 + 1)
                        else it
                    }
                } else {
                    serviceManager.updateFrecency(detail.name)
                    services = serviceManager.getServices()
                    triggerDebouncedSync()
                }
            }
        )
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Keygrain")
                        @Suppress("UNUSED_EXPRESSION") subtitleTick
                        val subtitle = when {
                            isDemoMode -> null
                            offlineMode -> "Offline"
                            getMostCommonEmail().isBlank() -> null
                            isSyncing -> "Syncing…"
                            lastSyncTime > 0L -> "Synced ${formatRelativeTime(lastSyncTime)}"
                            syncFailed -> "Not synced"
                            else -> null
                        }
                        if (subtitle != null) {
                            Text(
                                text = subtitle,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menuExpanded = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "Menu")
                        }
                        DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                            DropdownMenuItem(
                                text = { Text("Sync") },
                                enabled = !offlineMode,
                                onClick = {
                                    menuExpanded = false
                                    syncEmail = syncManager.getSyncEmail(context)
                                        ?: services.groupingBy { it.email }.eachCount()
                                            .maxByOrNull { it.value }?.key ?: ""
                                    showSyncEmailDialog = true
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Offline mode") },
                                trailingIcon = {
                                    Switch(
                                        checked = offlineMode,
                                        onCheckedChange = null
                                    )
                                },
                                onClick = {
                                    menuExpanded = false
                                    val newValue = !offlineMode
                                    offlineMode = newValue
                                    settingsPrefs.edit().putBoolean("offline_mode", newValue).apply()
                                    // Re-enabling sync (turning offline OFF) resumes syncing so
                                    // local data is pushed back to the server.
                                    if (!newValue) performAutoSync()
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
                            if (!isDemoMode) {
                                HorizontalDivider()
                                DropdownMenuItem(
                                    text = { Text("Switch account") },
                                    onClick = {
                                        menuExpanded = false
                                        showSwitchAccountDialog = true
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text("Delete server data") },
                                    onClick = {
                                        menuExpanded = false
                                        deleteError = null
                                        keepLocal = true
                                        showDeleteServerDialog = true
                                    }
                                )
                            }
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
            FloatingActionButton(onClick = {
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clipText = clipboard.primaryClip?.getItemAt(0)?.text?.toString()?.trim() ?: ""
                val urlRegex = Regex("^(https?://\\S+|[a-zA-Z0-9][a-zA-Z0-9.-]*\\.[a-zA-Z]{2,}(:\\d+)?(/\\S*)?)$", RegexOption.IGNORE_CASE)
                if (clipText.matches(urlRegex)) {
                    val normalized = ServiceManager.normalizeSite(clipText)
                    val psl = PublicSuffixList.getInstance(context)
                    val registrable = psl.extractRegistrableDomain(normalized)
                    prefillSite = registrable ?: normalized
                    detectedFullDomain = if (registrable != null && registrable != normalized) normalized else null
                } else {
                    prefillSite = ""
                    detectedFullDomain = null
                }
            }) {
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
        AnimatedVisibility(visible = syncUpgradeRequired) {
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    UserMessages.SYNC_UPGRADE_REQUIRED,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
        // Sync v3 deletion-review banner (Frozen Req 7). Non-blocking: shown only when
        // this device held unsynced changes to services that were deleted elsewhere.
        val pendingReview = deletionReview.filter { !it.seen }
        AnimatedVisibility(visible = pendingReview.isNotEmpty()) {
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        if (pendingReview.size == 1)
                            "1 service you changed here was deleted on another device"
                        else
                            "${pendingReview.size} services you changed here were deleted on another device",
                        modifier = Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodySmall
                    )
                    TextButton(onClick = { showDeletionReviewScreen = true }) { Text("Review") }
                }
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
                    items(filteredServices, key = { it.id ?: it.name }) { service ->
                        ServiceCard(
                            service = service,
                            masterSecret = masterSecret,
                            clipboardScope = clipboardScope,
                            onOpenDetail = { detailService = service },
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

    // --- Dialogs (extracted to ServiceListDialogs.kt) ---

    if (showSyncEmailDialog) {
        SyncEmailDialog(
            syncEmail = syncEmail,
            onSyncEmailChange = { syncEmail = it },
            onConfirm = {
                showSyncEmailDialog = false
                if (offlineMode) return@SyncEmailDialog
                isSyncing = true
                syncUpgradeRequired = false
                val secretBytes = masterSecret.toByteArray()
                scope.launch {
                    val msg = try {
                        when (val r = syncManager.sync(secretBytes, syncEmail, serviceManager, context)) {
                            is SyncResult.Success -> {
                                syncManager.setSyncEmail(context, syncEmail)
                                skipNextDebounce = true
                                services = serviceManager.getServices()
                                deletionReview = serviceManager.getDeletionReview()
                                lastSyncTime = System.currentTimeMillis()
                                syncUpgradeRequired = false
                                UserMessages.syncSuccess(r.services.size)
                            }
                            is SyncResult.UpgradeRequired -> {
                                syncUpgradeRequired = true
                                UserMessages.SYNC_UPGRADE_REQUIRED
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
            onDismiss = { showSyncEmailDialog = false }
        )
    }

    if (isSyncing) { SyncingDialog() }

    fileAction?.let { action ->
        FileEmailDialog(
            action = action,
            fileEmail = fileEmail,
            onFileEmailChange = { fileEmail = it },
            onConfirm = {
                fileAction = null
                if (action == "export") {
                    exportLauncher.launch("keygrain-backup.keygrain")
                } else {
                    importLauncher.launch(arrayOf("application/octet-stream", "*/*"))
                }
            },
            onDismiss = { fileAction = null }
        )
    }

    if (showImportConfirm) {
        ImportConfirmDialog(
            localCount = services.size,
            importCount = importedServices.size,
            onConfirm = {
                showImportConfirm = false
                serviceManager.replaceAll(importedServices)
                services = serviceManager.getServices()
                scope.launch { snackbarHostState.showSnackbar(UserMessages.importSuccess(importedServices.size)) }
            },
            onDismiss = { showImportConfirm = false }
        )
    }

    showDeleteDialog?.let { id ->
        val svc = services.firstOrNull { it.id == id }
        DeleteServiceDialog(
            serviceName = svc?.name ?: "",
            hasStoredTotp = svc?.totp?.optString("mode") == "stored",
            onConfirm = {
                if (isDemoMode) {
                    services = services.filter { it.id != id }
                } else {
                    serviceManager.deleteService(id)
                    services = serviceManager.getServices()
                    triggerDebouncedSync()
                }
                showDeleteDialog = null
            },
            onDismiss = { showDeleteDialog = null }
        )
    }

    if (showSwitchAccountDialog) {
        SwitchAccountDialog(
            onConfirm = {
                showSwitchAccountDialog = false
                onSwitchAccount()
            },
            onDismiss = { showSwitchAccountDialog = false }
        )
    }

    if (showDeleteServerDialog) {
        DeleteServerDialog(
            keepLocal = keepLocal,
            onKeepLocalChange = { keepLocal = it },
            deleteInProgress = deleteInProgress,
            deleteError = deleteError,
            onConfirm = {
                deleteError = null
                // Race guard (a): invalidate any pending debounced sync so it
                // cannot recreate the record right after we delete it.
                syncGeneration++
                deleteInProgress = true
                val keep = keepLocal
                val email = syncManager.getSyncEmail(context) ?: getMostCommonEmail()
                scope.launch {
                    try {
                        // No derivable email => there is no server record to target.
                        val result = if (email.isBlank()) {
                            DeleteResult.NotFound
                        } else {
                            val secretBytes = masterSecret.toByteArray()
                            try {
                                syncManager.deleteServerData(secretBytes, email, context)
                            } finally {
                                secretBytes.fill(0)
                            }
                        }
                        when (result) {
                            // SAFETY (Invariant #1): wipe/offline-flip ONLY here (200/404).
                            is DeleteResult.Success, is DeleteResult.NotFound -> {
                                if (keep) {
                                    settingsPrefs.edit().putBoolean("offline_mode", true).apply()
                                    offlineMode = true
                                    showDeleteServerDialog = false
                                    scope.launch {
                                        snackbarHostState.showSnackbar(
                                            "Server data deleted. Your data is still on this " +
                                                "device — turn Offline mode off to sync again."
                                        )
                                    }
                                } else {
                                    showDeleteServerDialog = false
                                    onWipeLocalAndRestart()
                                }
                            }
                            is DeleteResult.AuthError ->
                                deleteError = "Couldn't verify your account. Nothing was changed."
                            is DeleteResult.RateLimited ->
                                deleteError = "Too many requests. Wait a moment and try again. Nothing was changed."
                            is DeleteResult.ServerError, is DeleteResult.NetworkError ->
                                deleteError = "Couldn't reach the server. Nothing was changed — please try again."
                        }
                    } catch (e: Exception) {
                        // Fail-closed: any unexpected throwable leaves everything untouched.
                        deleteError = "Something went wrong. Nothing was changed — please try again."
                    } finally {
                        deleteInProgress = false
                    }
                }
            },
            onDismiss = { showDeleteServerDialog = false }
        )
    }

}
