package com.secbytech.keygrain.ui.screens

import android.content.ClipboardManager
import android.content.Context
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.data.DeleteResult
import com.secbytech.keygrain.data.Keygrain
import com.secbytech.keygrain.data.PublicSuffixList
import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.data.ServiceManager
import com.secbytech.keygrain.data.SyncCrypto
import com.secbytech.keygrain.data.SyncManager
import com.secbytech.keygrain.data.SyncResult
import com.secbytech.keygrain.data.SyncStore
import com.secbytech.keygrain.ui.UserMessages
import com.secbytech.keygrain.ui.components.ServiceCard
import com.secbytech.keygrain.ui.components.launchAutofillSettings
import com.secbytech.keygrain.ui.util.AutofillUtils
import com.secbytech.keygrain.ui.util.formatRelativeTime
import com.secbytech.keygrain.ui.util.fuzzyScore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ServiceListScreen(
    masterSecret: String,
    serviceManager: ServiceManager,
    isDemoMode: Boolean = false,
    onLock: () -> Unit,
    onSwitchAccount: () -> Unit,
    onWipeLocalAndRestart: () -> Unit,
    triggerDebouncedSync: () -> Unit = {},
    offlineMode: Boolean = false,
    syncGeneration: Int = 0,
    showAddDialog: Boolean = false,
    prefillSiteFromFab: String? = null,
    detectedFullDomainFromFab: String? = null,
    onDismissAddDialog: (() -> Unit)? = null,
    onInteraction: () -> Unit = {},
    onServicesChanged: ((List<ServiceEntry>) -> Unit)? = null,
    onOpenAutofillSettings: () -> Unit = {}
) {
    val context = LocalContext.current
    val demoServices = remember { listOf(
        ServiceEntry(
            name = "GitHub",
            site = "github.com",
            email = "demo@example.com",
            length = 20,
            symbols = Keygrain.DEFAULT_SYMBOLS,
            counter = 1,
            totp = JSONObject().apply {
                put("mode", "derived")
                put("digits", 6)
                put("period", 30)
                put("algorithm", "SHA1")
            },
            ssh = JSONObject().apply {
                put("key_name", "id_ed25519")
                put("counter", 1)
            },
            updatedAt = 1
        ),
        ServiceEntry(
            name = "Google",
            site = "google.com",
            email = "demo@example.com",
            length = 20,
            symbols = Keygrain.DEFAULT_SYMBOLS,
            counter = 1,
            totp = JSONObject().apply {
                put("mode", "derived")
                put("digits", 6)
                put("period", 30)
                put("algorithm", "SHA1")
            },
            updatedAt = 2
        ),
        ServiceEntry(
            name = "Production Bastion",
            site = "bastion.internal",
            email = "demo@example.com",
            length = 24,
            symbols = Keygrain.DEFAULT_SYMBOLS,
            counter = 1,
            ssh = JSONObject().apply {
                put("key_name", "bastion-admin")
                put("counter", 1)
            },
            updatedAt = 3
        ),
        ServiceEntry(
            name = "Mastodon",
            site = "mastodon.social",
            email = "demo@example.com",
            length = 20,
            symbols = Keygrain.DEFAULT_SYMBOLS,
            counter = 1,
            updatedAt = 4
        ),
        ServiceEntry(
            name = "Wikipedia",
            site = "wikipedia.org",
            email = "demo@example.com",
            length = 20,
            symbols = Keygrain.DEFAULT_SYMBOLS,
            counter = 1,
            updatedAt = 5
        )
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

    var showSwitchAccountDialog by remember { mutableStateOf(false) }
    // Sync v3 deletion review (Frozen Req 7): services this device changed that were
    // deleted on another device. Populated by SyncManager on a confirmed sync.
    var deletionReview by remember {
        mutableStateOf(if (isDemoMode) emptyList() else serviceManager.getDeletionReview())
    }
    var showDeletionReviewScreen by remember { mutableStateOf(false) }
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

    // Auto-sync refresh when syncGeneration increments
    LaunchedEffect(syncGeneration) {
        if (!isDemoMode && syncGeneration > 0) {
            services = serviceManager.getServices()
            deletionReview = serviceManager.getDeletionReview()
            onServicesChanged?.invoke(services)
        }
    }

    LaunchedEffect(services) {
        onServicesChanged?.invoke(services)
    }

    // React to add dialog trigger from MainScreen FAB
    LaunchedEffect(showAddDialog) {
        if (showAddDialog) {
            prefillSite = prefillSiteFromFab ?: ""
            detectedFullDomain = detectedFullDomainFromFab
            onDismissAddDialog?.invoke()
        }
    }

    // Autofill & Chrome setup state
    var isAutofillEnabled by remember { mutableStateOf(AutofillUtils.isAutofillEnabled(context)) }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
                isAutofillEnabled = AutofillUtils.isAutofillEnabled(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    // Global TOTP progress ticker (active whenever any service has TOTP enabled)
    val hasTotp = remember(services) { services.any { it.totp != null } }
    var globalTotpProgress by remember { mutableFloatStateOf(1f) }
    LaunchedEffect(hasTotp) {
        if (!hasTotp) return@LaunchedEffect
        while (true) {
            val now = System.currentTimeMillis() / 1000
            val remaining = (30 - (now % 30)).toFloat()
            globalTotpProgress = remaining / 30f
            delay(1000)
        }
    }

    fun getMostCommonEmail(): String =
        syncManager.getSyncEmail(context)?.ifBlank { null }
            ?: services.groupingBy { it.email }.eachCount().maxByOrNull { it.value }?.key ?: ""

    // Initial load
    LaunchedEffect(Unit) {
        if (!isDemoMode) {
            services = serviceManager.getServices()
            deletionReview = serviceManager.getDeletionReview()
            onServicesChanged?.invoke(services)
        }
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
            masterSecret = masterSecret,
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

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial)
                        lockTimerReset.longValue = System.currentTimeMillis()
                        onInteraction()
                    }
                }
            }
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            if (hasTotp) {
                LinearProgressIndicator(
                    progress = { globalTotpProgress },
                    modifier = Modifier.fillMaxWidth().height(2.dp),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant
                )
            }
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
        // Offline / Unsynced Account Warning Banner
        val lastSyncTs = remember { SyncStore.getLastSuccessfulSyncAt(context) }
        val isOfflineAcc = (offlineMode || lastSyncTs == 0L || services.any { !it.synced }) && !isDemoMode
        if (isOfflineAcc && services.isNotEmpty()) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Warning,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        if (offlineMode) "Offline Mode — data stored only on this device"
                        else if (lastSyncTs == 0L) "Not Synced — data stored only on this device"
                        else "Unsynced Changes — not backed up to cloud",
                        modifier = Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelSmall
                    )
                    TextButton(onClick = {
                        fileEmail = syncManager.getSyncEmail(context) ?: getMostCommonEmail()
                        fileAction = "export"
                        exportLauncher.launch("keygrain-backup.keygrain")
                    }) {
                        Text("Backup", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
        if (!isAutofillEnabled && !isDemoMode) {
            com.secbytech.keygrain.ui.components.AutofillSetupBanner(
                isAutofillEnabled = false,
                onEnableAutofill = onOpenAutofillSettings
            )
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
        } // Column
    } // Box

    // --- Dialogs (extracted to ServiceListDialogs.kt) ---



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
}
}
