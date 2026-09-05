package com.secbytech.keygrain.ui.screens

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.secbytech.keygrain.data.SyncManager
import com.secbytech.keygrain.data.SyncStore
import com.secbytech.keygrain.data.WalletAuditEntry
import com.secbytech.keygrain.data.WalletEngine
import com.secbytech.keygrain.data.WalletEntry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletScreen(
    masterSecret: String,
    isDemoMode: Boolean = false,
    defaultEmail: String = "",
    onLock: (() -> Unit)? = null,
    onBack: (() -> Unit)? = null,
    onSwitchAccount: (() -> Unit)? = null,
    onDataChanged: (() -> Unit)? = null,
    onWalletsChanged: ((List<WalletEntry>) -> Unit)? = null,
    showAddWalletDialog: Boolean = false,
    onDismissAddDialog: (() -> Unit)? = null
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val syncMgr = remember { SyncManager() }
    val settingsPrefs = remember { context.getSharedPreferences("keygrain_settings", Context.MODE_PRIVATE) }

    var wallets by remember { mutableStateOf(emptyList<WalletEntry>()) }
    var searchQuery by remember { mutableStateOf("") }
    var showAddDialog by remember { mutableStateOf(false) }
    var editingWallet by remember { mutableStateOf<WalletEntry?>(null) }
    var viewingWallet by remember { mutableStateOf<WalletEntry?>(null) }
    var deletingWallet by remember { mutableStateOf<WalletEntry?>(null) }
    val snackbarHostState = remember { SnackbarHostState() }

    fun refreshWallets() {
        wallets = syncMgr.getWallets(context)
        onWalletsChanged?.invoke(wallets)
    }

    LaunchedEffect(Unit) {
        WalletEngine.loadWordlist(context)
        refreshWallets()
    }

    val filteredWallets = remember(wallets, searchQuery) {
        if (searchQuery.isBlank()) wallets
        else {
            val q = searchQuery.trim().lowercase()
            wallets.filter {
                it.label.lowercase().contains(q) ||
                it.walletId.lowercase().contains(q) ||
                it.walletName.lowercase().contains(q) ||
                it.notes.lowercase().contains(q)
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize()
    ) {
            // Search Bar
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                placeholder = { Text("Search wallets…") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    if (searchQuery.isNotEmpty()) {
                        IconButton(onClick = { searchQuery = "" }) {
                            Icon(Icons.Default.Clear, contentDescription = "Clear")
                        }
                    }
                },
                singleLine = true,
                shape = RoundedCornerShape(24.dp)
            )

            if (filteredWallets.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.AccountBalanceWallet,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.outline
                        )
                        Spacer(Modifier.height(16.dp))
                        Text(
                            if (searchQuery.isEmpty()) "No wallets yet" else "No matching wallets",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            if (searchQuery.isEmpty())
                                "Tap '+' to create or derive your first universal BIP-39 HD wallet."
                            else "Try a different search term.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(filteredWallets, key = { it.id.ifEmpty { it.walletName } }) { wallet ->
                        WalletItemCard(
                            wallet = wallet,
                            onView = { viewingWallet = wallet },
                            onEdit = { editingWallet = wallet },
                            onDelete = { deletingWallet = wallet },
                            onQuickCopy = {
                                scope.launch {
                                    val mnemonic = withContext(Dispatchers.Default) {
                                        WalletEngine.deriveWalletMnemonic(
                                            masterSecret.toByteArray(),
                                            wallet.effectiveId(),
                                            wallet.words,
                                            wallet.counter
                                        )
                                    }
                                    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                    cm.setPrimaryClip(ClipData.newPlainText("Wallet Mnemonic", mnemonic))
                                    snackbarHostState.showSnackbar("Copied mnemonic to clipboard")
                                }
                            }
                        )
                    }
                }
            }
        }

    // Add / Edit Dialog
    val isAdding = showAddDialog || showAddWalletDialog
    if (isAdding || editingWallet != null) {
        WalletEditorDialog(
            initialWallet = editingWallet,
            masterSecret = masterSecret,
            isDemoMode = isDemoMode,
            onDismiss = {
                showAddDialog = false
                editingWallet = null
                onDismissAddDialog?.invoke()
            },
            onSave = { updated ->
                val current = syncMgr.getWallets(context).toMutableList()
                val idx = current.indexOfFirst { it.id == updated.id || WalletEntry.mergeKey(it) == WalletEntry.mergeKey(updated) }
                if (idx >= 0) {
                    current[idx] = updated
                } else {
                    current.add(updated)
                }
                syncMgr.saveWallets(context, current)
                refreshWallets()
                onDataChanged?.invoke()
                showAddDialog = false
                editingWallet = null
                onDismissAddDialog?.invoke()
                scope.launch {
                    snackbarHostState.showSnackbar(if (editingWallet != null) "Wallet updated" else "Wallet created")
                }
            }
        )
    }

    // View / Export Mnemonic Dialog
    viewingWallet?.let { wallet ->
        WalletViewerDialog(
            wallet = wallet,
            masterSecret = masterSecret,
            onDismiss = { viewingWallet = null }
        )
    }

    // Delete Confirmation Dialog
    deletingWallet?.let { wallet ->
        AlertDialog(
            onDismissRequest = { deletingWallet = null },
            icon = { Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
            title = { Text("Delete Wallet") },
            text = {
                Text(
                    "Are you sure you want to delete this wallet? This only removes the slot reference. You can re-derive it anytime with your Master Secret and Wallet ID." +
                    "This only removes the label and slot reference. You can always re-derive this exact wallet at any time using your Master Secret and Wallet ID ('${wallet.effectiveId()}')."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val current = syncMgr.getWallets(context).toMutableList()
                        current.removeAll { it.id == wallet.id || WalletEntry.mergeKey(it) == WalletEntry.mergeKey(wallet) }
                        syncMgr.saveWallets(context, current)
                        refreshWallets()
                        onDataChanged?.invoke()
                        deletingWallet = null
                        scope.launch { snackbarHostState.showSnackbar("Wallet deleted") }
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { deletingWallet = null }) { Text("Cancel") }
            }
        )
    }
}

private fun WalletEntry.effectiveId(): String =
    if (walletId.isNotBlank()) walletId else walletName

private fun WalletEntry.effectiveDisplayName(): String =
    if (label.isNotBlank()) label else effectiveId()

@Composable
private fun WalletItemCard(
    wallet: WalletEntry,
    onView: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onQuickCopy: () -> Unit
) {
    var menuExpanded by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onView),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                    Surface(
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.primaryContainer,
                        modifier = Modifier.size(40.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                Icons.Default.Key,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(
                            text = wallet.effectiveDisplayName(),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            text = "ID: ${wallet.effectiveId()} • ${wallet.words} words • counter ${wallet.counter}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                Box {
                    IconButton(onClick = { menuExpanded = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "Options")
                    }
                    DropdownMenu(
                        expanded = menuExpanded,
                        onDismissRequest = { menuExpanded = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("View & Export") },
                            leadingIcon = { Icon(Icons.Default.Visibility, contentDescription = null) },
                            onClick = {
                                menuExpanded = false
                                onView()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Edit") },
                            leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                            onClick = {
                                menuExpanded = false
                                onEdit()
                            }
                        )
                        HorizontalDivider()
                        DropdownMenuItem(
                            text = { Text("Delete", color = MaterialTheme.colorScheme.error) },
                            leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                            onClick = {
                                menuExpanded = false
                                onDelete()
                            }
                        )
                    }
                }
            }

            if (wallet.notes.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = wallet.notes,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedButton(
                    onClick = onQuickCopy,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Copy Mnemonic", style = MaterialTheme.typography.labelMedium)
                }
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = onView,
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)
                ) {
                    Icon(Icons.Default.Visibility, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("View", style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WalletEditorDialog(
    initialWallet: WalletEntry?,
    masterSecret: String,
    isDemoMode: Boolean,
    onDismiss: () -> Unit,
    onSave: (WalletEntry) -> Unit
) {
    val isEdit = initialWallet != null
    var walletId by remember { mutableStateOf(initialWallet?.effectiveId() ?: "") }
    var label by remember { mutableStateOf(initialWallet?.label ?: "") }
    var wordCount by remember { mutableIntStateOf(initialWallet?.words ?: 24) }
    var counterText by remember { mutableStateOf((initialWallet?.counter ?: 1).toString()) }
    var notes by remember { mutableStateOf(initialWallet?.notes ?: "") }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.94f)
                .fillMaxHeight(0.90f)
                .imePadding(),
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(20.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        if (isEdit) "Edit Wallet" else "Add Universal Wallet",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                }

                HorizontalDivider(Modifier.padding(vertical = 8.dp))

                Column(
                    modifier = Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedTextField(
                        value = walletId,
                        onValueChange = {
                            if (!isEdit) {
                                walletId = it.lowercase().filter { c -> c.isLetterOrDigit() || c == '-' }
                            }
                        },
                        label = { Text("Wallet ID (Derivation Seed)") },
                        placeholder = { Text("e.g. personal, savings, 1") },
                        enabled = !isEdit,
                        supportingText = {
                            Text(if (isEdit) "Wallet ID cannot be changed once created" else "Slug used for deterministic derivation")
                        },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    OutlinedTextField(
                        value = label,
                        onValueChange = { label = it },
                        label = { Text("Visual Label") },
                        placeholder = { Text("e.g. Primary Coldcard Vault") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Text("Word Count", style = MaterialTheme.typography.labelMedium)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        FilterChip(
                            selected = wordCount == 24,
                            onClick = { if (!isEdit) wordCount = 24 },
                            label = { Text("24 Words (Recommended)") },
                            modifier = Modifier.weight(1f),
                            enabled = !isEdit
                        )
                        FilterChip(
                            selected = wordCount == 12,
                            onClick = { if (!isEdit) wordCount = 12 },
                            label = { Text("12 Words") },
                            modifier = Modifier.weight(1f),
                            enabled = !isEdit
                        )
                    }

                    OutlinedTextField(
                        value = counterText,
                        onValueChange = { counterText = it.filter { c -> c.isDigit() } },
                        label = { Text("Counter") },
                        supportingText = { Text("Incrementing derives a completely independent root wallet") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    OutlinedTextField(
                        value = notes,
                        onValueChange = { notes = it },
                        label = { Text("Notes (Optional)") },
                        placeholder = { Text("e.g. Bound to Electrum hardware device") },
                        minLines = 2,
                        maxLines = 4,
                        modifier = Modifier.fillMaxWidth()
                    )

                    errorMsg?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }

                Spacer(Modifier.height(12.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(onClick = onDismiss) { Text("Cancel") }
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = {
                            val cleanId = walletId.trim().lowercase()
                            if (cleanId.isBlank()) {
                                errorMsg = "Wallet ID cannot be empty"
                                return@Button
                            }
                            val c = counterText.toIntOrNull() ?: 1
                            if (c < 1) {
                                errorMsg = "Counter must be >= 1"
                                return@Button
                            }
                            val now = java.time.Instant.now().toString()
                            val displayLabel = if (label.isNotBlank()) label.trim() else cleanId
                            val entry = initialWallet?.copy(
                                label = displayLabel,
                                counter = c,
                                notes = notes.trim(),
                                updatedAt = now
                            ) ?: WalletEntry(
                                id = UUID.randomUUID().toString(),
                                walletId = cleanId,
                                label = displayLabel,
                                words = wordCount,
                                counter = c,
                                createdAt = now,
                                updatedAt = now,
                                notes = notes.trim(),
                                walletName = cleanId,
                                chain = "universal"
                            )
                            onSave(entry)
                        }
                    ) {
                        Text(if (isEdit) "Save Changes" else "Create Wallet")
                    }
                }
            }
        }
    }
}

@Composable
private fun WalletViewerDialog(
    wallet: WalletEntry,
    masterSecret: String,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var mnemonic by remember { mutableStateOf<String?>(null) }
    var seedHex by remember { mutableStateOf<String?>(null) }
    var selectedFormatTab by remember { mutableIntStateOf(0) }
    var selectedWalletApp by remember { mutableStateOf("Sparrow / Electrum") }
    var clearSeconds by remember { mutableIntStateOf(60) }
    var isDeriving by remember { mutableStateOf(true) }
    var derivationTimeMs by remember { mutableLongStateOf(0L) }
    var showArgonInfoDialog by remember { mutableStateOf(false) }

    // Derive on launch with accurate execution timing
    LaunchedEffect(wallet) {
        withContext(Dispatchers.Default) {
            val start = System.currentTimeMillis()
            val m = WalletEngine.deriveWalletMnemonic(
                masterSecret.toByteArray(),
                wallet.effectiveId(),
                wallet.words,
                wallet.counter
            )
            val seedBytes = WalletEngine.mnemonicToSeed(m)
            val hex = seedBytes.joinToString("") { "%02x".format(it) }
            val elapsed = System.currentTimeMillis() - start
            mnemonic = m
            seedHex = hex
            derivationTimeMs = elapsed
            isDeriving = false
        }
    }

    // Auto-clear countdown
    LaunchedEffect(Unit) {
        while (clearSeconds > 0) {
            delay(1000)
            clearSeconds--
        }
        onDismiss()
    }

    // FLAG_SECURE
    val activity = context as? Activity
    DisposableEffect(Unit) {
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose {
            activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.96f)
                .fillMaxHeight(0.92f)
                .imePadding(),
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(20.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            wallet.effectiveDisplayName(),
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            "Auto-closing in ${clearSeconds}s",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.secondary
                        )
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                }

                Spacer(Modifier.height(12.dp))

                TabRow(selectedTabIndex = selectedFormatTab) {
                    Tab(
                        selected = selectedFormatTab == 0,
                        onClick = { selectedFormatTab = 0 },
                        text = { Text("Mnemonic") }
                    )
                    Tab(
                        selected = selectedFormatTab == 1,
                        onClick = { selectedFormatTab = 1 },
                        text = { Text("Seed Hex") }
                    )
                    Tab(
                        selected = selectedFormatTab == 2,
                        onClick = { selectedFormatTab = 2 },
                        text = { Text("Wallet Formats") }
                    )
                }

                Spacer(Modifier.height(16.dp))

                // Fun & Educational Argon2id Derivation Badge
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                Icons.Default.Shield,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(Modifier.width(8.dp))
                            if (isDeriving) {
                                Text(
                                    "Forging seed with Argon2id (64 MiB, 3 passes)...",
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.Medium,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer
                                )
                            } else {
                                Text(
                                    "Argon2id derivation completed in ${derivationTimeMs} ms",
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.Medium,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer
                                )
                            }
                        }
                        IconButton(
                            onClick = { showArgonInfoDialog = true },
                            modifier = Modifier.size(24.dp)
                        ) {
                            Icon(
                                Icons.Default.Info,
                                contentDescription = "Learn about Argon2id",
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                }

                Spacer(Modifier.height(10.dp))

                if (isDeriving) {
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            CircularProgressIndicator(strokeWidth = 3.dp)
                            Text(
                                "Computing memory-hard proof-of-work...",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                "ASIC & GPU resistant key stretching in progress",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.outline
                            )
                        }
                    }
                } else {
                    Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                        when (selectedFormatTab) {
                            0 -> MnemonicView(mnemonic ?: "")
                            1 -> SeedHexView(seedHex ?: "")
                            2 -> WalletAppExportView(wallet, mnemonic ?: "", seedHex ?: "", selectedWalletApp, onSelectApp = { selectedWalletApp = it })
                        }
                    }
                }

                if (showArgonInfoDialog) {
                    AlertDialog(
                        onDismissRequest = { showArgonInfoDialog = false },
                        icon = { Icon(Icons.Default.Shield, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
                        title = { Text("Why Argon2id?") },
                        text = {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    "Keygrain uses Argon2id (RFC 9106) with 64 MiB of memory, 3 iterations, and 1 thread to strengthen your Master Secret before producing root entropy.",
                                    style = MaterialTheme.typography.bodyMedium
                                )
                                Text(
                                    "⚡ Memory-Hard Security: Because it consumes 64 MiB of RAM per derivation, an attacker cannot cheaply brute-force your secret with massive GPU rigs or specialized ASIC chips.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    "🛡️ Fresh Ephemeral Keys: Unlike passwords, HD wallet keys are derived on-demand with wallet-specific salts and never cached in memory. That slight computation time (~${if (derivationTimeMs > 0) "${derivationTimeMs}ms" else "1s"}) is your mathematical armor against hackers!",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        },
                        confirmButton = {
                            TextButton(onClick = { showArgonInfoDialog = false }) {
                                Text("Got it!")
                            }
                        }
                    )
                }

                Spacer(Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedButton(onClick = onDismiss) {
                        Text("Close")
                    }

                    Button(
                        onClick = {
                            val textToCopy = when (selectedFormatTab) {
                                0 -> mnemonic ?: ""
                                1 -> seedHex ?: ""
                                2 -> formatExportContent(wallet, mnemonic ?: "", seedHex ?: "", selectedWalletApp)
                                else -> ""
                            }
                            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            cm.setPrimaryClip(ClipData.newPlainText("Wallet Data", textToCopy))
                        }
                    ) {
                        Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(
                            when (selectedFormatTab) {
                                0 -> "Copy Mnemonic"
                                1 -> "Copy Seed Hex"
                                else -> when (selectedWalletApp) {
                                    "Sparrow / Electrum" -> "Copy Keystore"
                                    "MetaMask / Rabby Compatible" -> "Copy Recovery Phrase"
                                    else -> "Copy JSON"
                                }
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MnemonicView(mnemonic: String) {
    val words = remember(mnemonic) { mnemonic.split(" ") }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f),
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(
                "⚠️ Anyone with these ${words.size} words has full control of all assets derived from this wallet root.",
                modifier = Modifier.padding(10.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer
            )
        }

        Spacer(Modifier.height(12.dp))

        // Grid of words (2 columns)
        words.chunked(2).forEachIndexed { rowIdx, pair ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                pair.forEachIndexed { colIdx, word ->
                    val wordNum = rowIdx * 2 + colIdx + 1
                    Surface(
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(10.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "$wordNum.",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.width(28.dp)
                            )
                            Text(
                                word,
                                style = MaterialTheme.typography.bodyMedium,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Medium
                            )
                        }
                    }
                }
                if (pair.size == 1) {
                    Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun SeedHexView(seedHex: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            "BIP-39 512-bit Root Seed (Hexadecimal)",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            "Used by wallets that accept raw master seeds or hardware seed signers directly.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(
                text = seedHex,
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(14.dp)
            )
        }
    }
}

@Composable
private fun WalletAppExportView(
    wallet: WalletEntry,
    mnemonic: String,
    seedHex: String,
    selectedWalletApp: String,
    onSelectApp: (String) -> Unit
) {
    val apps = listOf("Sparrow / Electrum", "BIP-39 Standard JSON", "MetaMask / Rabby Compatible")

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Select Wallet Format:", style = MaterialTheme.typography.labelMedium)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            apps.forEach { app ->
                FilterChip(
                    selected = selectedWalletApp == app,
                    onClick = { onSelectApp(app) },
                    label = { Text(app, style = MaterialTheme.typography.labelSmall) }
                )
            }
        }

        val exportText = remember(selectedWalletApp, mnemonic, seedHex) {
            formatExportContent(wallet, mnemonic, seedHex, selectedWalletApp)
        }

        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(
                text = exportText,
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(12.dp)
            )
        }
    }
}

private fun formatExportContent(
    wallet: WalletEntry,
    mnemonic: String,
    seedHex: String,
    appFormat: String
): String {
    return when (appFormat) {
        "Sparrow / Electrum" -> {
            """
            # Keygrain Universal Wallet Export
            # App Format: Sparrow / Electrum Keystore
            # Wallet ID: ${wallet.effectiveId()}
            # Counter: ${wallet.counter}
            
            keystore:
              type: bip39
              mnemonic: $mnemonic
              passphrase: ""
            """.trimIndent()
        }
        "MetaMask / Rabby Compatible" -> {
            """
            # Import as Secret Recovery Phrase (SRP)
            # Word Count: ${wallet.words}
            
            $mnemonic
            """.trimIndent()
        }
        else -> generateAppExportJson(wallet, mnemonic, seedHex)
    }
}

private fun generateAppExportJson(wallet: WalletEntry, mnemonic: String, seedHex: String): String {
    return JSONObject().apply {
        put("version", "keygrain-bip39-v1")
        put("wallet_id", wallet.effectiveId())
        put("label", wallet.effectiveDisplayName())
        put("words", wallet.words)
        put("counter", wallet.counter)
        put("mnemonic", mnemonic)
        put("seed_hex", seedHex)
    }.toString(2)
}
