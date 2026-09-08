package com.secbytech.keygrain.ui.screens

import android.content.ClipboardManager
import android.content.Context
import android.util.Log
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.data.Keygrain
import com.secbytech.keygrain.data.LocalDataWiper
import com.secbytech.keygrain.data.PublicSuffixList
import com.secbytech.keygrain.data.SecretManager
import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.data.ServiceManager
import com.secbytech.keygrain.data.SshKeyEntry
import com.secbytech.keygrain.data.SyncCrypto
import com.secbytech.keygrain.data.SyncManager
import com.secbytech.keygrain.data.SyncResult
import com.secbytech.keygrain.data.SyncStore
import com.secbytech.keygrain.data.WalletEntry
import com.secbytech.keygrain.ui.UserMessages

import com.secbytech.keygrain.ui.util.canUseBiometric
import com.secbytech.keygrain.ui.util.formatRelativeTime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen() {
    val context = LocalContext.current
    val secretManager = remember { SecretManager(context) }
    val serviceManager = remember { ServiceManager(context) }
    val syncManager = remember { SyncManager() }
    val settingsPrefs = remember {
        context.getSharedPreferences("keygrain_settings", Context.MODE_PRIVATE)
    }
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    var configuredEmail by remember {
        mutableStateOf(SyncStore.getSyncEmail(context))
    }
    var unlocked by remember { mutableStateOf(false) }
    var masterSecret by remember { mutableStateOf("") }
    var isDemoMode by remember { mutableStateOf(false) }

    // Lifted sync state
    var isSyncing by remember { mutableStateOf(false) }
    var syncFailed by remember { mutableStateOf(false) }
    var lastSyncTime by remember { mutableLongStateOf(0L) }
    var offlineMode by remember { mutableStateOf(settingsPrefs.getBoolean("offline_mode", false)) }
    var syncGeneration by remember { mutableIntStateOf(0) }
    var syncEpoch by remember { mutableLongStateOf(0L) }
    var subtitleTick by remember { mutableIntStateOf(0) }

    // Child counts for top bar subtitle
    var loginCount by remember { mutableIntStateOf(0) }
    var sshKeyCount by remember { mutableIntStateOf(0) }
    var walletCount by remember { mutableIntStateOf(0) }

    // Global navigation/dialog state
    var showHelpScreen by remember { mutableStateOf(false) }
    var showSwitchAccountDialog by remember { mutableStateOf(false) }

    // FAB add trigger state
    var showAddLoginDialog by remember { mutableStateOf(false) }
    var prefillLoginSite by remember { mutableStateOf<String?>(null) }
    var detectedLoginFullDomain by remember { mutableStateOf<String?>(null) }
    var showAddSshDialog by remember { mutableStateOf(false) }
    var showAddWalletDialog by remember { mutableStateOf(false) }

    // Tick to refresh relative time in subtitle every 60s
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            subtitleTick++
        }
    }

    fun getEffectiveEmail(): String =
        configuredEmail?.ifBlank { null }
            ?: syncManager.getSyncEmail(context)?.ifBlank { null }
            ?: serviceManager.getServices().groupingBy { it.email }.eachCount().maxByOrNull { it.value }?.key ?: ""

    fun performAutoSync() {
        if (isDemoMode || isSyncing || offlineMode) return
        val email = getEffectiveEmail()
        if (email.isBlank()) return
        isSyncing = true
        val gen = syncGeneration
        scope.launch {
            try {
                val secretBytes = masterSecret.toByteArray()
                try {
                    when (val res = syncManager.sync(secretBytes, email, serviceManager, context)) {
                        is SyncResult.Success -> {
                            if (syncGeneration != gen) return@launch
                            syncManager.setSyncEmail(context, email)
                            val now = System.currentTimeMillis()
                            lastSyncTime = now
                            syncEpoch = now
                            sshKeyCount = res.sshKeys.size
                            walletCount = res.wallets.size
                            syncFailed = false
                            syncGeneration++
                        }
                        else -> {
                            syncFailed = true
                        }
                    }
                } finally {
                    secretBytes.fill(0)
                }
            } catch (e: Exception) {
                Log.e("Keygrain", "performAutoSync error", e)
                syncFailed = true
            } finally {
                isSyncing = false
            }
        }
    }

    fun triggerDebouncedSync() {
        if (offlineMode) return
        syncGeneration++
        val gen = syncGeneration
        scope.launch {
            delay(1200)
            if (syncGeneration == gen) performAutoSync()
        }
    }

    // Auto-sync ONCE on unlock
    LaunchedEffect(unlocked) {
        if (unlocked && !isDemoMode) {
            withContext(Dispatchers.IO) {
                syncManager.migrateFromKnownUUIDs(context, serviceManager)
            }
            performAutoSync()
        }
    }

    // Legacy migration: if sync_email is null but local services exist, populate sync_email from most common email
    LaunchedEffect(Unit) {
        if (configuredEmail == null) {
            val services = serviceManager.getServices()
            if (services.isNotEmpty()) {
                val commonEmail = services.groupingBy { it.email }.eachCount().maxByOrNull { it.value }?.key
                if (!commonEmail.isNullOrBlank()) {
                    SyncStore.setSyncEmail(context, commonEmail)
                    configuredEmail = commonEmail
                }
            }
        }
    }

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
        configuredEmail = null
        unlocked = false
        masterSecret = ""
        isDemoMode = false
    }

    when {
        !unlocked -> {
            if (configuredEmail.isNullOrBlank()) {
                AuthScreen(
                    secretManager = secretManager,
                    serviceManager = serviceManager,
                    onUnlocked = { email, secret ->
                        configuredEmail = email
                        masterSecret = secret
                        unlocked = true
                        settingsPrefs.edit().putBoolean("onboarding_completed", true).apply()
                    },
                    onDemo = {
                        isDemoMode = true
                        masterSecret = "demo-secret-keygrain"
                        unlocked = true
                    }
                )
            } else {
                UnlockScreen(
                    secretManager = secretManager,
                    serviceManager = serviceManager,
                    onUnlocked = { email, secret ->
                        configuredEmail = email
                        masterSecret = secret
                        unlocked = true
                    },
                    onSwitchAccount = wipeLocalAndRestart,
                    onDemo = {
                        isDemoMode = true
                        masterSecret = "demo-secret-keygrain"
                        unlocked = true
                    }
                )
            }
        }
        showHelpScreen -> {
            HelpScreen(onBack = { showHelpScreen = false })
        }
        else -> {
            var selectedTab by remember {
                mutableIntStateOf(settingsPrefs.getInt("last_active_tab", 0).coerceIn(0, 2))
            }
            val onLockAction: () -> Unit = {
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
            }

            Scaffold(
                topBar = {
                    TopAppBar(
                        title = {
                            Column {
                                Text("Keygrain", fontWeight = FontWeight.SemiBold)
                                @Suppress("UNUSED_EXPRESSION") subtitleTick
                                val syncStatus = when {
                                    isDemoMode -> "Demo Mode"
                                    offlineMode -> "Offline"
                                    isSyncing -> "Syncing…"
                                    lastSyncTime > 0L -> "Synced ${formatRelativeTime(lastSyncTime)}"
                                    syncFailed -> "Not synced"
                                    else -> null
                                }
                                val tabItemCount = when (selectedTab) {
                                    0 -> "$loginCount items"
                                    1 -> "$sshKeyCount keys"
                                    2 -> "$walletCount wallets"
                                    else -> ""
                                }
                                val subtitle = if (syncStatus != null) {
                                    "$tabItemCount • $syncStatus"
                                } else {
                                    tabItemCount
                                }
                                Text(
                                    text = subtitle,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        },
                        actions = {
                            IconButton(onClick = {
                                val newOffline = !offlineMode
                                offlineMode = newOffline
                                settingsPrefs.edit().putBoolean("offline_mode", newOffline).apply()
                                if (!newOffline) {
                                    performAutoSync()
                                }
                            }) {
                                Icon(
                                    if (offlineMode) Icons.Default.CloudOff else Icons.Default.CloudQueue,
                                    contentDescription = if (offlineMode) "Offline Mode On" else "Offline Mode Off"
                                )
                            }
                            IconButton(
                                onClick = {
                                    val email = getEffectiveEmail()
                                    if (email.isNotBlank() && !offlineMode && !isSyncing) {
                                        isSyncing = true
                                        val secretBytes = masterSecret.toByteArray()
                                        scope.launch {
                                            val msg = try {
                                                when (val r = syncManager.sync(secretBytes, email, serviceManager, context)) {
                                                    is SyncResult.Success -> {
                                                        syncManager.setSyncEmail(context, email)
                                                        val now = System.currentTimeMillis()
                                                        lastSyncTime = now
                                                        syncEpoch = now
                                                        sshKeyCount = r.sshKeys.size
                                                        walletCount = r.wallets.size
                                                        syncFailed = false
                                                        syncGeneration++
                                                        UserMessages.syncSuccess(r.services.size)
                                                    }
                                                    is SyncResult.AuthError -> UserMessages.AUTH_ERROR
                                                    is SyncResult.NetworkError -> UserMessages.NETWORK_ERROR
                                                    is SyncResult.ServerError -> UserMessages.SERVER_ERROR
                                                    is SyncResult.IntegrityError -> UserMessages.INTEGRITY_ERROR
                                                    is SyncResult.ConflictError -> UserMessages.CONFLICT_ERROR
                                                    is SyncResult.UpgradeRequired -> UserMessages.SYNC_UPGRADE_REQUIRED
                                                }
                                            } catch (e: Exception) {
                                                Log.e("Keygrain", "Manual sync failed", e)
                                                UserMessages.NETWORK_ERROR
                                            } finally {
                                                secretBytes.fill(0)
                                            }
                                            isSyncing = false
                                            snackbarHostState.showSnackbar(msg)
                                        }
                                    }
                                },
                                enabled = !offlineMode && !isSyncing
                            ) {
                                Icon(Icons.Default.Sync, contentDescription = "Sync now")
                            }
                            IconButton(onClick = { showHelpScreen = true }) {
                                Icon(Icons.Default.HelpOutline, contentDescription = "Help")
                            }
                            IconButton(onClick = { showSwitchAccountDialog = true }) {
                                Icon(Icons.Default.SwitchAccount, contentDescription = "Switch account")
                            }
                            IconButton(onClick = onLockAction) {
                                Icon(Icons.Default.Lock, contentDescription = "Lock")
                            }
                        }
                    )
                },
                floatingActionButton = {
                    FloatingActionButton(onClick = {
                        when (selectedTab) {
                            0 -> {
                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                val clipText = clipboard.primaryClip?.getItemAt(0)?.text?.toString()?.trim() ?: ""
                                val urlRegex = Regex("^(https?://\\S+|[a-zA-Z0-9][a-zA-Z0-9.-]*\\.[a-zA-Z]{2,}(:\\d+)?(/\\S*)?)$", RegexOption.IGNORE_CASE)
                                if (clipText.matches(urlRegex)) {
                                    val normalized = ServiceManager.normalizeSite(clipText)
                                    val psl = PublicSuffixList.getInstance(context)
                                    val registrable = psl.extractRegistrableDomain(normalized)
                                    prefillLoginSite = registrable ?: normalized
                                    detectedLoginFullDomain = if (registrable != null && registrable != normalized) normalized else null
                                } else {
                                    prefillLoginSite = ""
                                    detectedLoginFullDomain = null
                                }
                                showAddLoginDialog = true
                            }
                            1 -> {
                                showAddSshDialog = true
                            }
                            2 -> {
                                showAddWalletDialog = true
                            }
                        }
                    }) {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = when (selectedTab) {
                                0 -> "Add service"
                                1 -> "Add SSH key"
                                2 -> "Add wallet"
                                else -> "Add"
                            }
                        )
                    }
                },
                snackbarHost = { SnackbarHost(snackbarHostState) },
                bottomBar = {
                    NavigationBar(
                        tonalElevation = 2.dp,
                        windowInsets = WindowInsets.navigationBars
                    ) {
                        NavigationBarItem(
                            selected = selectedTab == 0,
                            onClick = {
                                selectedTab = 0
                                settingsPrefs.edit().putInt("last_active_tab", 0).apply()
                            },
                            icon = { Icon(Icons.Default.Password, contentDescription = "Logins") },
                            label = { Text("Logins") },
                            alwaysShowLabel = true
                        )
                        NavigationBarItem(
                            selected = selectedTab == 1,
                            onClick = {
                                selectedTab = 1
                                settingsPrefs.edit().putInt("last_active_tab", 1).apply()
                            },
                            icon = { Icon(Icons.Default.VpnKey, contentDescription = "SSH Keys") },
                            label = { Text("SSH Keys") },
                            alwaysShowLabel = true
                        )
                        NavigationBarItem(
                            selected = selectedTab == 2,
                            onClick = {
                                selectedTab = 2
                                settingsPrefs.edit().putInt("last_active_tab", 2).apply()
                            },
                            icon = { Icon(Icons.Default.AccountBalanceWallet, contentDescription = "Wallets") },
                            label = { Text("Wallets") },
                            alwaysShowLabel = true
                        )
                    }
                }
            ) { innerPadding ->
                Box(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
                    when (selectedTab) {
                        0 -> {
                            ServiceListScreen(
                                masterSecret = masterSecret,
                                serviceManager = serviceManager,
                                isDemoMode = isDemoMode,
                                onLock = onLockAction,
                                onSwitchAccount = wipeLocalAndRestart,
                                onWipeLocalAndRestart = wipeLocalAndRestart,
                                triggerDebouncedSync = ::triggerDebouncedSync,
                                offlineMode = offlineMode,
                                syncGeneration = syncGeneration,
                                showAddDialog = showAddLoginDialog,
                                prefillSiteFromFab = prefillLoginSite,
                                detectedFullDomainFromFab = detectedLoginFullDomain,
                                onDismissAddDialog = { showAddLoginDialog = false },
                                onServicesChanged = { list -> loginCount = list.size }
                            )
                        }
                        1 -> {
                            SshScreen(
                                masterSecret = masterSecret,
                                serviceManager = serviceManager,
                                isDemoMode = isDemoMode,
                                defaultEmail = configuredEmail ?: "",
                                onLock = onLockAction,
                                onBack = null,
                                onSwitchAccount = wipeLocalAndRestart,
                                onDataChanged = ::triggerDebouncedSync,
                                onSshKeysChanged = { list -> sshKeyCount = list.size },
                                showAddSshDialog = showAddSshDialog,
                                onDismissAddDialog = { showAddSshDialog = false },
                                syncEpoch = syncEpoch
                            )
                        }
                        2 -> {
                            WalletScreen(
                                masterSecret = masterSecret,
                                isDemoMode = isDemoMode,
                                defaultEmail = configuredEmail ?: "",
                                onLock = onLockAction,
                                onBack = null,
                                onSwitchAccount = wipeLocalAndRestart,
                                onDataChanged = ::triggerDebouncedSync,
                                onWalletsChanged = { list -> walletCount = list.size },
                                showAddWalletDialog = showAddWalletDialog,
                                onDismissAddDialog = { showAddWalletDialog = false },
                                syncEpoch = syncEpoch
                            )
                        }
                    }
                }
            }

            if (showSwitchAccountDialog) {
                val lastSyncAt = SyncStore.getLastSuccessfulSyncAt(context)
                val isOffline = offlineMode || lastSyncAt == 0L
                val unsyncedCount = if (isOffline) 0 else serviceManager.getServices().count { !it.synced }
                SwitchAccountDialog(
                    isOfflineAccount = isOffline,
                    unsyncedCount = unsyncedCount,
                    serviceCount = serviceManager.getServices().size,
                    onExportBackup = {
                        val email = getEffectiveEmail()
                        val secretBytes = masterSecret.toByteArray()
                        try {
                            val key = Keygrain.deriveEncryptionKey(secretBytes, email)
                            val json = serviceManager.exportJson().toByteArray()
                            val encrypted = SyncCrypto.encrypt(key, json)
                            key.fill(0)
                        } catch (e: Exception) {
                            Log.e("Keygrain", "Backup failed", e)
                        } finally {
                            secretBytes.fill(0)
                        }
                    },
                    onConfirm = {
                        showSwitchAccountDialog = false
                        wipeLocalAndRestart()
                    },
                    onDismiss = { showSwitchAccountDialog = false }
                )
            }
        }
    }
}
