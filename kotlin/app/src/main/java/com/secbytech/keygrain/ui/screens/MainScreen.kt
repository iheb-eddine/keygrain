package com.secbytech.keygrain.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.secbytech.keygrain.data.Keygrain
import com.secbytech.keygrain.data.LocalDataWiper
import com.secbytech.keygrain.data.PublicSuffixList
import com.secbytech.keygrain.data.SecretManager
import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.data.ServiceManager
import com.secbytech.keygrain.data.DeletionReviewEntry
import com.secbytech.keygrain.data.SyncCrypto
import com.secbytech.keygrain.data.TotpEngine
import com.secbytech.keygrain.data.SshEngine
import com.secbytech.keygrain.data.SyncManager
import com.secbytech.keygrain.data.DeleteResult
import com.secbytech.keygrain.data.SyncResult
import com.secbytech.keygrain.ui.UserMessages
import com.secbytech.keygrain.ui.WongPalette
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
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
                },
                onDemo = {
                    isDemoMode = true
                    masterSecret = "demo-secret-keygrain"
                    unlocked = true
                }
            )
        }
        else -> {
            // Shared local reset used by BOTH Switch account and the OFF branch of
            // Delete server data, so their observable behavior stays identical.
            val wipeLocalAndRestart: () -> Unit = {
                LocalDataWiper.wipeAll(context)
                if (android.os.Build.VERSION.SDK_INT >= 28) {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.clearPrimaryClip()
                }
                settingsPrefs.edit()
                    .putBoolean("onboarding_completed", false)
                    .putBoolean("offline_mode", false)
                    .apply()
                onboardingCompleted = false
                unlocked = false
                masterSecret = ""
                isDemoMode = false
            }
            ServiceListScreen(
                masterSecret = masterSecret,
                serviceManager = serviceManager,
                isDemoMode = isDemoMode,
                onLock = {
                    unlocked = false
                    masterSecret = ""
                    isDemoMode = false
                    Keygrain.clearStrengthenCache()
                    if (android.os.Build.VERSION.SDK_INT >= 28) {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.clearPrimaryClip()
                    }
                    if (!canUseBiometric(context)) {
                        secretManager.clearSecret()
                    }
                },
                onSwitchAccount = wipeLocalAndRestart,
                onWipeLocalAndRestart = wipeLocalAndRestart
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
    var showManualEntry by remember { mutableStateOf(false) }
    val biometricFirstMode = secretManager.hasSecret() && canUseBiometric(context)

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
        if (biometricFirstMode) {
            showBiometric(context,
                onSuccess = { secretManager.getSecret()?.let { onUnlocked(it) } },
                onFailed = { showManualEntry = true }
            )
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
            if (biometricFirstMode) {
                Button(onClick = {
                    showBiometric(context,
                        onSuccess = { secretManager.getSecret()?.let { onUnlocked(it) } },
                        onFailed = { showManualEntry = true }
                    )
                }) {
                    Icon(Icons.Default.Fingerprint, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Unlock")
                }
                if (!showManualEntry) {
                    Spacer(Modifier.height(16.dp))
                    TextButton(onClick = { showManualEntry = true }) {
                        Text("Use secret instead")
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
                        Box(Modifier.size(20.dp).background(WongPalette[idx], CircleShape))
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
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ServiceListScreen(
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
                        }
                        else -> { syncFailed = true }
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
                        if (offlineMode) return@TextButton
                        isSyncing = true
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

    showDeleteDialog?.let { id ->
        val deleteName = services.firstOrNull { it.id == id }?.name ?: ""
        val hasStoredTotp = services.firstOrNull { it.id == id }?.totp?.optString("mode") == "stored"
        AlertDialog(
            onDismissRequest = { showDeleteDialog = null },
            title = { Text("Delete $deleteName?") },
            text = if (hasStoredTotp) {
                {
                    Text(
                        "⚠️ This service has a stored TOTP seed that is NOT derivable. " +
                            "Deleting it here and syncing removes it from all your devices, and " +
                            "it cannot be recovered."
                    )
                }
            } else null,
            confirmButton = {
                TextButton(onClick = {
                    if (isDemoMode) {
                        services = services.filter { it.id != id }
                    } else {
                        serviceManager.deleteService(id)
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

    if (showSwitchAccountDialog) {
        AlertDialog(
            onDismissRequest = { showSwitchAccountDialog = false },
            title = { Text("Switch account?") },
            text = {
                Text(
                    "This clears all data on this device — your services, wallets, and " +
                        "settings — and returns to setup so you can enter a different master " +
                        "secret.\n\nYour data on the sync server is not affected by this action."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showSwitchAccountDialog = false
                    onSwitchAccount()
                }) { Text("Switch account") }
            },
            dismissButton = {
                TextButton(onClick = { showSwitchAccountDialog = false }) { Text("Cancel") }
            }
        )
    }

    if (showDeleteServerDialog) {
        AlertDialog(
            onDismissRequest = { if (!deleteInProgress) showDeleteServerDialog = false },
            title = { Text("Delete data from the server?") },
            text = {
                Column {
                    Text(
                        "This permanently erases everything stored on the sync server for " +
                            "this account — all your services, wallets, and TOTP codes. This " +
                            "cannot be undone on the server."
                    )
                    Spacer(Modifier.height(16.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Switch(
                            checked = keepLocal,
                            onCheckedChange = { keepLocal = it },
                            enabled = !deleteInProgress
                        )
                        Spacer(Modifier.width(8.dp))
                        Text("Keep my data on this device (offline mode)")
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        if (keepLocal)
                            "Your data stays on this phone. It's removed from the server, but " +
                                "you can restore it later by turning Offline mode off to sync again."
                        else
                            "Your data will also be permanently erased from this device.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    deleteError?.let {
                        Spacer(Modifier.height(12.dp))
                        Text(
                            it,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !deleteInProgress,
                    onClick = {
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
                    }
                ) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !deleteInProgress,
                    onClick = { showDeleteServerDialog = false }
                ) { Text("Cancel") }
            }
        )
    }

}

private fun copyAndClear(
    context: Context,
    scope: CoroutineScope,
    label: String,
    text: String
) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
    if (android.os.Build.VERSION.SDK_INT >= 28) {
        scope.launch {
            delay(30_000)
            // Only clear if the clipboard still holds exactly what THIS call placed.
            // Prevents a stale timer from wiping a later copy (or the user's own copy).
            val current = clipboard.primaryClip?.getItemAt(0)?.text?.toString()
            if (current == text) {
                clipboard.clearPrimaryClip()
            }
        }
    }
}

@Composable
private fun PasswordRow(
    service: ServiceEntry,
    masterSecret: String,
    clipboardScope: CoroutineScope,
    context: Context,
    onCopy: () -> Unit
) {
    // Derive off the main thread — derivePassword runs Argon2id (heavy). Null = generating.
    // Key on stable content fields (not the ServiceEntry instance, whose JSONObject
    // members use identity equals) so a sync/copy reload doesn't reset to "Generating…".
    var password by remember(
        service.email, service.site, service.length, service.symbols, service.counter, masterSecret
    ) { mutableStateOf<String?>(null) }
    LaunchedEffect(
        service.email, service.site, service.length, service.symbols, service.counter, masterSecret
    ) {
        password = withContext(Dispatchers.Default) {
            Keygrain.derivePassword(
                secret = masterSecret.toByteArray(),
                email = service.email,
                site = service.site,
                length = service.length,
                symbols = service.symbols,
                counter = service.counter
            )
        }
    }
    var visible by remember { mutableStateOf(false) }
    var passwordCopied by remember { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    LaunchedEffect(passwordCopied) {
        if (passwordCopied) { delay(1500); passwordCopied = false }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = when {
                password == null -> "Generating…"
                visible -> password!!
                else -> "••••••••••••"
            },
            style = MaterialTheme.typography.bodyLarge,
            fontFamily = if (visible && password != null) FontFamily.Monospace else FontFamily.Default,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        IconButton(onClick = { visible = !visible }, enabled = password != null) {
            Icon(
                if (visible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                contentDescription = "Toggle"
            )
        }
        IconButton(
            enabled = password != null,
            onClick = {
                val pw = password ?: return@IconButton
                if (passwordCopied) return@IconButton
                copyAndClear(context, clipboardScope, "password", pw)
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                passwordCopied = true
                onCopy()
            }
        ) {
            Icon(
                if (passwordCopied) Icons.Default.Check else Icons.Default.ContentCopy,
                contentDescription = if (passwordCopied) "Copied" else "Copy"
            )
        }
    }
}

@Composable
private fun TotpRow(
    service: ServiceEntry,
    masterSecret: String,
    clipboardScope: CoroutineScope,
    context: Context,
    onCopy: () -> Unit
) {
    val totp = service.totp ?: return
    var totpCode by remember { mutableStateOf("") }
    var totpRemaining by remember { mutableIntStateOf(0) }
    val totpPeriod = totp.optInt("period", 30)
    var totpCopied by remember { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    LaunchedEffect(totpCopied) {
        if (totpCopied) { delay(1500); totpCopied = false }
    }
    LaunchedEffect(totp.toString(), service.email, service.site, masterSecret) {
        val mode = totp.optString("mode", "")
        val digits = totp.optInt("digits", 6)
        val period = totp.optInt("period", 30)
        val algorithm = totp.optString("algorithm", "SHA1")
        // Derive the seed ONCE off the main thread (derived mode runs Argon2id).
        // Previously this ran every second on the main thread → continuous ANR risk.
        val seed: ByteArray? = try {
            withContext(Dispatchers.Default) {
                if (mode == "stored") {
                    android.util.Base64.decode(totp.getString("seed"), android.util.Base64.DEFAULT)
                } else {
                    TotpEngine.deriveTotpSeed(masterSecret.toByteArray(), service.email, service.site)
                }
            }
        } catch (_: Exception) { null }
        if (seed == null) {
            totpCode = "error"
            totpRemaining = 0
            return@LaunchedEffect
        }
        while (true) {
            val now = System.currentTimeMillis() / 1000
            try {
                totpCode = TotpEngine.generateTotp(seed, now, digits, period, algorithm)
                totpRemaining = (period - (now % period)).toInt()
            } catch (_: Exception) {
                totpCode = "error"
                totpRemaining = 0
            }
            delay(1000)
        }
    }
    if (totpCode.isNotEmpty()) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                val formatted = if (totpCode.all { it.isDigit() }) {
                    if (totpCode.length == 8)
                        totpCode.substring(0, 4) + " " + totpCode.substring(4)
                    else
                        totpCode.substring(0, 3) + " " + totpCode.substring(3)
                } else totpCode
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
                    if (totpCopied) return@IconButton
                    copyAndClear(context, clipboardScope, "totp", totpCode)
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    totpCopied = true
                    onCopy()
                }) {
                    Icon(
                        if (totpCopied) Icons.Default.Check else Icons.Default.ContentCopy,
                        contentDescription = if (totpCopied) "Copied" else "Copy TOTP"
                    )
                }
            }
            LinearProgressIndicator(
                progress = { totpRemaining.toFloat() / totpPeriod },
                modifier = Modifier.fillMaxWidth().height(4.dp),
            )
        }
    }
}

@Composable
private fun SshRow(
    service: ServiceEntry,
    masterSecret: String,
    clipboardScope: CoroutineScope,
    context: Context
) {
    val ssh = service.ssh ?: return
    val sshKeyName = ssh.optString("key_name", "")
    if (sshKeyName.isEmpty()) return
    // Row-local scope for the heavy key derivation — safe to cancel on dispose since
    // nothing reaches the clipboard until copyAndClear/setPrimaryClip runs. The 30s
    // CLEAR uses the survivor clipboardScope instead.
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    var sshCopied by remember { mutableStateOf(false) }
    var sshPrivCopied by remember { mutableStateOf(false) }
    var sshPrivConfirmed by remember { mutableStateOf(false) }
    var showSshPrivDialog by remember { mutableStateOf(false) }
    LaunchedEffect(sshCopied) {
        if (sshCopied) { delay(1500); sshCopied = false }
    }
    LaunchedEffect(sshPrivCopied) {
        if (sshPrivCopied) { delay(1500); sshPrivCopied = false }
    }
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
            if (sshCopied) return@IconButton
            scope.launch {
                try {
                    val sshCounter = ssh.optInt("counter", 1)
                    val line = withContext(Dispatchers.Default) {
                        val kp = SshEngine.deriveSshKeypair(masterSecret.toByteArray(), service.email, sshKeyName, sshCounter)
                        val comment = "${service.email.lowercase()}:${sshKeyName.lowercase()}"
                        SshEngine.formatAuthorizedKeys(kp.publicKey, comment)
                    }
                    copyAndClear(context, clipboardScope, "ssh-pubkey", line)
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    sshCopied = true
                } catch (e: Exception) {
                    android.widget.Toast.makeText(context, "SSH error: ${e.message}", android.widget.Toast.LENGTH_SHORT).show()
                }
            }
        }) {
            Icon(
                if (sshCopied) Icons.Default.Check else Icons.Default.ContentCopy,
                contentDescription = if (sshCopied) "Copied" else "Copy SSH public key"
            )
        }
        Spacer(Modifier.width(4.dp))
        IconButton(onClick = {
            if (sshPrivCopied) return@IconButton
            if (!sshPrivConfirmed) { showSshPrivDialog = true; return@IconButton }
            scope.launch {
                try {
                    val sshCounter = ssh.optInt("counter", 1)
                    val pem = withContext(Dispatchers.Default) {
                        val kp = SshEngine.deriveSshKeypair(masterSecret.toByteArray(), service.email, sshKeyName, sshCounter)
                        try {
                            val comment = "${service.email.lowercase()}:${sshKeyName.lowercase()}"
                            SshEngine.formatOpensshPrivateKey(kp.seed, kp.publicKey, comment)
                        } finally {
                            kp.seed.fill(0)
                        }
                    }
                    val clip = ClipData.newPlainText("ssh-privkey", pem)
                    if (android.os.Build.VERSION.SDK_INT >= 33) {
                        clip.description.extras = android.os.PersistableBundle().apply {
                            putBoolean("android.content.extra.IS_SENSITIVE", true)
                        }
                    }
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(clip)
                    if (android.os.Build.VERSION.SDK_INT >= 28) {
                        clipboardScope.launch {
                            delay(30_000)
                            // Only clear if the clipboard still holds this private key.
                            val current = clipboard.primaryClip?.getItemAt(0)?.text?.toString()
                            if (current == pem) {
                                clipboard.clearPrimaryClip()
                            }
                        }
                    }
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    sshPrivCopied = true
                    android.widget.Toast.makeText(context, "Private key copied", android.widget.Toast.LENGTH_SHORT).show()
                } catch (e: Exception) {
                    android.widget.Toast.makeText(context, "SSH error: ${e.message}", android.widget.Toast.LENGTH_SHORT).show()
                }
            }
        }) {
            Icon(
                if (sshPrivCopied) Icons.Default.Check else Icons.Default.VpnKey,
                contentDescription = if (sshPrivCopied) "Copied" else "Copy SSH private key"
            )
        }
        if (showSshPrivDialog) {
            AlertDialog(
                onDismissRequest = { showSshPrivDialog = false },
                title = { Text("Copy Private Key") },
                text = { Text("The private key will be copied to clipboard and cleared after 30 seconds. Continue?") },
                confirmButton = {
                    TextButton(onClick = {
                        showSshPrivDialog = false
                        sshPrivConfirmed = true
                    }) { Text("Copy") }
                },
                dismissButton = {
                    TextButton(onClick = { showSshPrivDialog = false }) { Text("Cancel") }
                }
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ServiceCard(
    service: ServiceEntry,
    masterSecret: String,
    clipboardScope: CoroutineScope,
    onOpenDetail: () -> Unit,
    onCopy: () -> Unit,
    context: Context
) {
    Card(
        onClick = onOpenDetail,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Tap anywhere on the card opens the read-only Detail. Inner IconButtons
            // (visibility/copy/TOTP/SSH) consume their own taps, so they still work.
            Column {
                Text(service.name, style = MaterialTheme.typography.titleMedium)
                Text(service.email, style = MaterialTheme.typography.bodySmall)
            }
            PasswordRow(service, masterSecret, clipboardScope, context, onCopy)
            TotpRow(service, masterSecret, clipboardScope, context, onCopy)
            SshRow(service, masterSecret, clipboardScope, context)
        }
    }
}

@Composable
private fun CopyableRow(
    label: String,
    value: String,
    clipboardScope: CoroutineScope,
    context: Context
) {
    val haptic = LocalHapticFeedback.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) { delay(1500); copied = false }
    }
    // Single merged semantics node = one TalkBack stop for the whole row, with a
    // "Copy <label>" action label; the trailing icon is decorative (null description).
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClickLabel = "Copy $label") {
                if (copied) return@clickable
                copyAndClear(context, clipboardScope, label, value)
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                copied = true
            }
            .semantics(mergeDescendants = true) {
                contentDescription = "$label: $value"
            }
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(value, style = MaterialTheme.typography.bodyLarge)
        }
        Icon(
            if (copied) Icons.Default.Check else Icons.Default.ContentCopy,
            contentDescription = null
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ServiceDetailScreen(
    service: ServiceEntry,
    masterSecret: String,
    clipboardScope: CoroutineScope,
    context: Context,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onCopy: () -> Unit,
    onInteraction: () -> Unit
) {
    // Always-enabled so Back returns to the list and never backgrounds the app.
    BackHandler(enabled = true) { onBack() }
    // Root pointerInput mirrors the list's idiom: observe on the Initial pass and never
    // consume, so taps/scrolls reset the auto-lock timer without stealing child gestures.
    Box(modifier = Modifier.fillMaxSize().pointerInput(Unit) {
        awaitPointerEventScope {
            while (true) {
                awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial)
                onInteraction()
            }
        }
    }) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(service.name) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = onEdit) {
                        Icon(Icons.Default.Edit, contentDescription = "Edit")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Identity fields — copyable (fixes "can't copy name/site/email").
            CopyableRow("Service name", service.name, clipboardScope, context)
            if (service.site.isNotBlank()) {
                CopyableRow("Site", service.site, clipboardScope, context)
            }
            CopyableRow("Email", service.email, clipboardScope, context)

            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

            // Credentials — reuse the exact card rows (identical derivation + copy).
            Text(
                "Password",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            PasswordRow(service, masterSecret, clipboardScope, context, onCopy)

            if (service.totp != null) {
                Text(
                    "TOTP",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                TotpRow(service, masterSecret, clipboardScope, context, onCopy)
            }

            if (service.ssh?.optString("key_name", "").orEmpty().isNotEmpty()) {
                Text(
                    "SSH key",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                SshRow(service, masterSecret, clipboardScope, context)
            }

            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

            // Symbols — copyable (raw set; the one customized parameter worth backing up).
            CopyableRow("Symbols", service.symbols, clipboardScope, context)

            // Length / Counter — muted, non-copyable caption (trivial ints, not credentials).
            Text(
                "Length ${service.length} · Counter ${service.counter}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = onDelete,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                )
            ) {
                Icon(Icons.Default.Delete, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Delete")
            }
        }
    }
    } // Box (auto-lock interaction)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ServiceEditorScreen(
    onDismiss: () -> Unit,
    onSave: (ServiceEntry) -> Boolean,
    onInteraction: () -> Unit,
    initialEntry: ServiceEntry? = null,
    initialSite: String = "",
    detectedFullDomain: String? = null,
    defaultEmail: String = ""
) {
    val isEdit = initialEntry != null

    // Initial values captured once — used both to seed fields and to detect a dirty form.
    val initName = initialEntry?.name ?: ""
    val initSite = initialEntry?.site ?: initialSite
    val initEmail = initialEntry?.email ?: defaultEmail
    val initLength = initialEntry?.length?.toString() ?: "20"
    val initSymbols = initialEntry?.symbols ?: Keygrain.DEFAULT_SYMBOLS
    val initCounter = initialEntry?.counter?.toString() ?: "1"
    val initSshKeyName: String = initialEntry?.ssh?.optString("key_name", "") ?: ""

    // rememberSaveable so input survives config changes not covered by
    // android:configChanges (and any future narrowing of it). NOTE: the reported
    // data-loss bug is fixed by removing the sheet's drag-to-dismiss (full-screen
    // Scaffold below), not by this — full process-death still returns to Unlock
    // because the master secret is never persisted.
    var name by rememberSaveable { mutableStateOf(initName) }
    var site by rememberSaveable { mutableStateOf(initSite) }
    var email by rememberSaveable { mutableStateOf(initEmail) }
    var length by rememberSaveable { mutableStateOf(initLength) }
    var symbols by rememberSaveable { mutableStateOf(initSymbols) }
    var counter by rememberSaveable { mutableStateOf(initCounter) }
    var showAdvanced by rememberSaveable { mutableStateOf(isEdit) }
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
    var totpModeIndex by rememberSaveable { mutableIntStateOf(initialTotpMode) }
    val originalTotpSeed = remember { initialEntry?.totp?.optString("seed", "") ?: "" }
    // totpSeed is intentionally plain remember (NOT rememberSaveable): a Stored TOTP
    // secret must never be written to the saved-instance Bundle (persisted to disk).
    // See decision driver-d-001.
    var totpSeed by remember { mutableStateOf(originalTotpSeed) }

    // SSH state
    var sshKeyName by rememberSaveable { mutableStateOf(initSshKeyName) }

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

    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    val isDirty = name != initName || site != initSite || email != initEmail ||
        length != initLength || symbols != initSymbols || counter != initCounter ||
        sshKeyName != initSshKeyName || totpModeIndex != initialTotpMode ||
        totpSeed != originalTotpSeed

    var showDiscardDialog by remember { mutableStateOf(false) }
    val handleExit: () -> Unit = {
        if (isDirty) showDiscardDialog = true else onDismiss()
    }

    // enabled=true (not enabled=isDirty) so a clean-form Back returns to the list and
    // never falls through to the system to background the app.
    BackHandler(enabled = true) { handleExit() }

    // Root pointerInput mirrors the list's idiom: observe on the Initial pass and never
    // consume, so taps/scrolls reset the auto-lock timer. Typing is handled separately in
    // each field's onValueChange (Compose has no global soft-keyboard hook).
    Box(modifier = Modifier.fillMaxSize().pointerInput(Unit) {
        awaitPointerEventScope {
            while (true) {
                awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial)
                onInteraction()
            }
        }
    }) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (isEdit) "Edit Service" else "Add Service") },
                navigationIcon = {
                    IconButton(onClick = handleExit) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                },
                actions = {
                    TextButton(
                        enabled = name.isNotBlank() && email.isNotBlank(),
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
                            val ok = onSave(ServiceEntry(
                                name = name.trim(),
                                site = site.trim().ifEmpty { name.trim().lowercase() },
                                email = email.trim(),
                                length = (length.toIntOrNull() ?: 20).coerceAtLeast(8),
                                symbols = symbols.ifEmpty { Keygrain.DEFAULT_SYMBOLS },
                                counter = (counter.toIntOrNull() ?: 1).coerceAtLeast(1),
                                totp = totpJson,
                                ssh = sshJson
                            ))
                            if (!ok) {
                                scope.launch {
                                    snackbarHostState.showSnackbar("A service with that site and email already exists.")
                                }
                            }
                        }
                    ) { Text(if (isEdit) "Save" else "Add") }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                "ℹ️ Changing any field will generate a different password.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            OutlinedTextField(
                value = name,
                onValueChange = { name = it; onInteraction() },
                label = { Text("Service name") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = site,
                onValueChange = { if (!isEdit) site = it; onInteraction() },
                label = { Text("Site") },
                supportingText = if (detectedFullDomain != null && site == initialSite) {
                    { Text("Detected $detectedFullDomain \u2014 matches all subdomains") }
                } else null,
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                enabled = !isEdit
            )
            OutlinedTextField(
                value = email,
                onValueChange = { email = it; onInteraction() },
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
                        onValueChange = { length = it.filter { c -> c.isDigit() }; onInteraction() },
                        label = { Text("Length") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                    )
                    OutlinedTextField(
                        value = symbols,
                        onValueChange = { symbols = it; onInteraction() },
                        label = { Text("Symbols") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = counter,
                        onValueChange = { counter = it.filter { c -> c.isDigit() }; onInteraction() },
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
                            onValueChange = { totpSeed = it; onInteraction() },
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
                        onValueChange = { sshKeyName = it.filter { c -> !c.isWhitespace() }; onInteraction() },
                        label = { Text("Key name (optional)") },
                        placeholder = { Text("e.g. github, work-servers") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        }
    }
    } // Box (auto-lock interaction)

    if (showDiscardDialog) {
        AlertDialog(
            onDismissRequest = { showDiscardDialog = false },
            title = { Text("Discard changes?") },
            text = { Text("You have unsaved changes. Discard them?") },
            confirmButton = {
                TextButton(onClick = { showDiscardDialog = false; onDismiss() }) { Text("Discard") }
            },
            dismissButton = {
                TextButton(onClick = { showDiscardDialog = false }) { Text("Keep editing") }
            }
        )
    }

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

private fun showBiometric(context: Context, onSuccess: () -> Unit, onFailed: () -> Unit = {}) {
    val activity = context as FragmentActivity
    val executor = ContextCompat.getMainExecutor(activity)
    val prompt = BiometricPrompt(activity, executor, object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            onSuccess()
        }
        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            onFailed()
        }
        override fun onAuthenticationFailed() {
            // No-op: user can retry. Only onAuthenticationError is terminal.
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

/**
 * Sync v3 deletion review (Frozen Req 7). Surfaces services this device had unsynced
 * changes to that were deleted on another device. Per-item Restore (re-create under the
 * original id) / Discard (accept the deletion), plus Dismiss all (stop nagging, keep the
 * list). Mirrors the extension's deletion-review UI (designs/sync-deletion-reconciliation.md §7).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeletionReviewScreen(
    entries: List<DeletionReviewEntry>,
    onRestore: (DeletionReviewEntry) -> Unit,
    onDiscard: (DeletionReviewEntry) -> Unit,
    onDismissAll: () -> Unit,
    onBack: () -> Unit
) {
    BackHandler(onBack = onBack)
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Deleted elsewhere") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (entries.any { !it.seen }) {
                        TextButton(onClick = onDismissAll) { Text("Dismiss all") }
                    }
                }
            )
        }
    ) { padding ->
        if (entries.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Text("Nothing to review.")
            }
            return@Scaffold
        }
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
        ) {
            Text(
                "These services were deleted on another device, but you had changes to " +
                    "them here that hadn't synced yet. Restore the ones you want to keep — " +
                    "the rest stay deleted.",
                modifier = Modifier.padding(16.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            entries.forEach { entry ->
                val svc = entry.service
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 6.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            svc.name.ifBlank { svc.site },
                            style = MaterialTheme.typography.titleMedium
                        )
                        if (svc.site.isNotBlank()) {
                            Text(svc.site, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (svc.email.isNotBlank()) {
                            Text(svc.email, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(
                            "Deleted " + java.text.DateFormat
                                .getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT)
                                .format(java.util.Date(entry.deletedAt)),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                            horizontalArrangement = Arrangement.End
                        ) {
                            TextButton(onClick = { onDiscard(entry) }) { Text("Discard") }
                            Spacer(Modifier.width(8.dp))
                            Button(onClick = { onRestore(entry) }) { Text("Restore") }
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
