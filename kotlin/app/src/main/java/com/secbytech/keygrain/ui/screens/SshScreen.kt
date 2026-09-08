package com.secbytech.keygrain.ui.screens

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import android.view.WindowManager
import android.widget.Toast
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.data.ServiceManager
import com.secbytech.keygrain.data.SshEngine
import com.secbytech.keygrain.data.SshKeyEntry
import com.secbytech.keygrain.data.SyncStore
import com.secbytech.keygrain.ui.util.canUseBiometric
import com.secbytech.keygrain.ui.util.showBiometric
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SshScreen(
    masterSecret: String,
    serviceManager: ServiceManager,
    isDemoMode: Boolean = false,
    defaultEmail: String = "",
    onLock: (() -> Unit)? = null,
    onBack: (() -> Unit)? = null,
    onSwitchAccount: (() -> Unit)? = null,
    onDataChanged: (() -> Unit)? = null,
    onSshKeysChanged: ((List<SshKeyEntry>) -> Unit)? = null,
    showAddSshDialog: Boolean = false,
    onDismissAddDialog: (() -> Unit)? = null,
    syncEpoch: Long = 0L
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val settingsPrefs = remember { context.getSharedPreferences("keygrain_settings", Context.MODE_PRIVATE) }
    var sshKeys by remember { mutableStateOf(emptyList<SshKeyEntry>()) }
    var searchQuery by remember { mutableStateOf("") }
    var showAddDialog by remember { mutableStateOf(false) }
    var editingItem by remember { mutableStateOf<SshKeyEntry?>(null) }
    var viewingItem by remember { mutableStateOf<SshKeyEntry?>(null) }
    var deletingItem by remember { mutableStateOf<SshKeyEntry?>(null) }

    fun refreshList() {
        sshKeys = SyncStore.getSshKeys(context)
        onSshKeysChanged?.invoke(sshKeys)
    }

    LaunchedEffect(Unit) {
        SyncStore.migrateLegacySshKeys(context, serviceManager)
        refreshList()
    }

    LaunchedEffect(syncEpoch) {
        if (syncEpoch > 0L) {
            refreshList()
        }
    }

    val filteredItems = remember(sshKeys, searchQuery) {
        if (searchQuery.isBlank()) sshKeys
        else {
            val q = searchQuery.trim().lowercase()
            sshKeys.filter {
                it.keyName.lowercase().contains(q) ||
                it.email.lowercase().contains(q) ||
                it.comment.lowercase().contains(q)
            }
        }
    }

    if (onBack != null) {
        BackHandler { onBack() }
    }

    Column(
        modifier = Modifier.fillMaxSize()
    ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                placeholder = { Text("Search SSH keys...") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    if (searchQuery.isNotEmpty()) {
                        IconButton(onClick = { searchQuery = "" }) {
                            Icon(Icons.Default.Clear, contentDescription = "Clear")
                        }
                    }
                },
                singleLine = true,
                shape = RoundedCornerShape(12.dp)
            )

            if (filteredItems.isEmpty()) {
                Box(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            Icons.Default.VpnKey,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.outline,
                            modifier = Modifier.size(48.dp)
                        )
                        Text(
                            if (sshKeys.isEmpty()) "No SSH keys found" else "No matching keys",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            if (sshKeys.isEmpty()) "Tap '+' to generate your first Ed25519 key" else "Try a different search query",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.outline
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp)
                ) {
                    items(filteredItems, key = { it.id.ifEmpty { "${it.email}_${it.keyName}" } }) { item ->
                        SshItemCard(
                            item = item,
                            masterSecret = masterSecret,
                            onView = { viewingItem = item },
                            onEdit = { editingItem = item },
                            onDelete = { deletingItem = item }
                        )
                    }
                }
            }
        }

    val isAdding = showAddDialog || showAddSshDialog
    if (isAdding) {
        SshEditorDialog(
            initialItem = null,
            defaultEmail = defaultEmail.ifEmpty { SyncStore.getSyncEmail(context) ?: "" },
            onDismiss = {
                showAddDialog = false
                onDismissAddDialog?.invoke()
            },
            onSave = { keyName, email, counter ->
                val cleanKeyName = keyName.trim()
                val commentVal = if (email.isNotBlank()) email.trim() else cleanKeyName
                val newKey = SshKeyEntry(
                    id = UUID.randomUUID().toString(),
                    keyName = cleanKeyName,
                    counter = counter,
                    email = email.trim(),
                    comment = commentVal,
                    createdAt = System.currentTimeMillis(),
                    updatedAt = System.currentTimeMillis()
                )
                SyncStore.putSshKey(context, newKey)
                refreshList()
                onDataChanged?.invoke()
                showAddDialog = false
                onDismissAddDialog?.invoke()
            }
        )
    }

    if (editingItem != null) {
        SshEditorDialog(
            initialItem = editingItem,
            defaultEmail = editingItem!!.email,
            onDismiss = { editingItem = null },
            onSave = { keyName, email, counter ->
                val current = editingItem!!
                val cleanKeyName = keyName.trim()
                val commentVal = if (email.isNotBlank()) email.trim() else cleanKeyName
                val updatedKey = current.copy(
                    keyName = cleanKeyName,
                    counter = counter,
                    email = email.trim(),
                    comment = commentVal,
                    updatedAt = System.currentTimeMillis()
                )
                SyncStore.putSshKey(context, updatedKey)
                refreshList()
                onDataChanged?.invoke()
                editingItem = null
            }
        )
    }

    if (viewingItem != null) {
        SshViewerDialog(
            item = viewingItem!!,
            masterSecret = masterSecret,
            onDismiss = { viewingItem = null }
        )
    }

    if (deletingItem != null) {
        AlertDialog(
            onDismissRequest = { deletingItem = null },
            icon = { Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
            title = { Text("Delete SSH Key") },
            text = { Text("Are you sure you want to delete '${deletingItem!!.keyName}'? The public and private keys can always be regenerated if you reuse the same key name and counter.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        SyncStore.removeSshKey(context, deletingItem!!)
                        refreshList()
                        onDataChanged?.invoke()
                        deletingItem = null
                    }
                ) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { deletingItem = null }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun SshItemCard(
    item: SshKeyEntry,
    masterSecret: String,
    onView: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    var menuExpanded by remember { mutableStateOf(false) }
    var copiedPub by remember { mutableStateOf(false) }

    LaunchedEffect(copiedPub) {
        if (copiedPub) {
            delay(1500)
            copiedPub = false
        }
    }

    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
        modifier = Modifier.fillMaxWidth().clickable { onView() }
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.secondaryContainer),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Default.Key,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                    }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(
                            item.keyName,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            item.email,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                Box {
                    IconButton(onClick = { menuExpanded = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "Menu")
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

            Spacer(Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.surface
                    ) {
                        Text(
                            "Ed25519",
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            fontWeight = FontWeight.Medium
                        )
                    }
                    if (item.counter > 1) {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.tertiaryContainer
                        ) {
                            Text(
                                "v${item.counter}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onTertiaryContainer,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }
                    }
                }

                Button(
                    onClick = {
                        scope.launch {
                            try {
                                val line = withContext(Dispatchers.Default) {
                                    val kp = SshEngine.deriveSshKeypair(masterSecret.toByteArray(), item.keyName, item.counter)
                                    val comment = item.keyName.lowercase()
                                    SshEngine.formatAuthorizedKeys(kp.publicKey, comment)
                                }
                                val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                cm.setPrimaryClip(ClipData.newPlainText("ssh-pubkey", line))
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                copiedPub = true
                                Toast.makeText(context, "Public key copied", Toast.LENGTH_SHORT).show()
                            } catch (e: Exception) {
                                Toast.makeText(context, "Derivation error: ${e.message}", Toast.LENGTH_SHORT).show()
                            }
                        }
                    },
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Icon(
                        if (copiedPub) Icons.Default.Check else Icons.Default.ContentCopy,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(if (copiedPub) "Copied!" else "Copy Pubkey", style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

@Composable
private fun SshViewerDialog(
    item: SshKeyEntry,
    masterSecret: String,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    var isDeriving by remember { mutableStateOf(true) }
    var derivationTimeMs by remember { mutableLongStateOf(0L) }
    var authKeysLine by remember { mutableStateOf("") }
    var fingerprintSha256 by remember { mutableStateOf("") }
    var pemPrivateKey by remember { mutableStateOf<String?>(null) }
    var selectedTab by remember { mutableIntStateOf(0) }
    var showPrivWarning by remember { mutableStateOf(false) }
    var showArgonInfo by remember { mutableStateOf(false) }
    var clearSeconds by remember { mutableIntStateOf(60) }

    LaunchedEffect(item) {
        withContext(Dispatchers.Default) {
            val start = System.currentTimeMillis()
            val kp = SshEngine.deriveSshKeypair(masterSecret.toByteArray(), item.keyName, item.counter)
            val comment = item.keyName.lowercase()
            val line = SshEngine.formatAuthorizedKeys(kp.publicKey, comment)

            // SHA256 Fingerprint
            val md = MessageDigest.getInstance("SHA-256")
            val fpHash = md.digest(kp.publicKey)
            val fpB64 = android.util.Base64.encodeToString(fpHash, android.util.Base64.NO_WRAP).trimEnd('=')
            val fp = "SHA256:$fpB64"

            authKeysLine = line
            fingerprintSha256 = fp
            derivationTimeMs = System.currentTimeMillis() - start
            isDeriving = false
        }
    }

    LaunchedEffect(Unit) {
        while (clearSeconds > 0) {
            delay(1000)
            clearSeconds--
        }
        onDismiss()
    }

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
                .fillMaxWidth(0.95f)
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
                        Text(item.keyName, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text("Auto-closing in ${clearSeconds}s", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                }

                Spacer(Modifier.height(10.dp))

                TabRow(selectedTabIndex = selectedTab) {
                    Tab(
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                        text = { Text("Public Key") }
                    )
                    Tab(
                        selected = selectedTab == 1,
                        onClick = {
                            if (pemPrivateKey == null) {
                                showPrivWarning = true
                            } else {
                                selectedTab = 1
                            }
                        },
                        text = { Text("Private Key") }
                    )
                }

                Spacer(Modifier.height(12.dp))

                // Fun & Educational Argon2id Derivation Badge
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                            Icon(Icons.Default.Shield, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            if (isDeriving) {
                                Text(
                                    "Stretching key with Argon2id...",
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
                        IconButton(onClick = { showArgonInfo = true }, modifier = Modifier.size(24.dp)) {
                            Icon(Icons.Default.Info, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))

                if (isDeriving) {
                    Box(modifier = Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                } else {
                    Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                        if (selectedTab == 0) {
                            Column(
                                modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                                verticalArrangement = Arrangement.spacedBy(14.dp)
                            ) {
                                Text("authorized_keys entry:", style = MaterialTheme.typography.labelMedium)
                                Surface(
                                    shape = RoundedCornerShape(12.dp),
                                    color = MaterialTheme.colorScheme.surfaceVariant,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text(
                                        text = authKeysLine,
                                        fontFamily = FontFamily.Monospace,
                                        style = MaterialTheme.typography.bodySmall,
                                        modifier = Modifier.padding(12.dp)
                                    )
                                }

                                Text("SHA-256 Fingerprint:", style = MaterialTheme.typography.labelMedium)
                                Surface(
                                    shape = RoundedCornerShape(12.dp),
                                    color = MaterialTheme.colorScheme.surfaceVariant,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text(
                                        text = fingerprintSha256,
                                        fontFamily = FontFamily.Monospace,
                                        fontWeight = FontWeight.SemiBold,
                                        style = MaterialTheme.typography.bodySmall,
                                        modifier = Modifier.padding(12.dp)
                                    )
                                }
                            }
                        } else {
                            Column(
                                modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Text("OpenSSH PEM Private Key:", style = MaterialTheme.typography.labelMedium)
                                Surface(
                                    shape = RoundedCornerShape(12.dp),
                                    color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text(
                                        text = pemPrivateKey ?: "",
                                        fontFamily = FontFamily.Monospace,
                                        style = MaterialTheme.typography.bodySmall,
                                        modifier = Modifier.padding(12.dp)
                                    )
                                }
                            }
                        }
                    }
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
                            val textToCopy = if (selectedTab == 0) authKeysLine else pemPrivateKey ?: ""
                            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            val clip = ClipData.newPlainText("SSH Key Data", textToCopy)
                            if (selectedTab == 1 && Build.VERSION.SDK_INT >= 33) {
                                clip.description.extras = PersistableBundle().apply {
                                    putBoolean("android.content.extra.IS_SENSITIVE", true)
                                }
                            }
                            cm.setPrimaryClip(clip)
                            Toast.makeText(context, if (selectedTab == 0) "Public key copied" else "Private key copied", Toast.LENGTH_SHORT).show()
                        }
                    ) {
                        Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(if (selectedTab == 0) "Copy authorized_keys" else "Copy Private Key")
                    }
                }
            }
        }
    }

    if (showPrivWarning) {
        AlertDialog(
            onDismissRequest = { showPrivWarning = false },
            icon = { Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
            title = { Text("Display Private Key?") },
            text = { Text("Your OpenSSH private key allows direct authentication. Make sure no one is watching your screen. Key will be cleared automatically.") },
            confirmButton = {
                val onRevealKey: () -> Unit = {
                    val kp = SshEngine.deriveSshKeypair(masterSecret.toByteArray(), item.keyName, item.counter)
                    try {
                        val comment = item.keyName.lowercase()
                        pemPrivateKey = SshEngine.formatOpensshPrivateKey(kp.seed, kp.publicKey, comment)
                    } finally {
                        kp.seed.fill(0)
                    }
                    selectedTab = 1
                    showPrivWarning = false
                }

                TextButton(
                    onClick = {
                        if (canUseBiometric(context)) {
                            showBiometric(
                                context = context,
                                onSuccess = onRevealKey,
                                onFailed = {
                                    Toast.makeText(context, "Biometric authentication required to reveal private key", Toast.LENGTH_SHORT).show()
                                }
                            )
                        } else {
                            onRevealKey()
                        }
                    }
                ) {
                    Text(if (canUseBiometric(context)) "Authenticate & Reveal" else "Reveal", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showPrivWarning = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    if (showArgonInfo) {
        AlertDialog(
            onDismissRequest = { showArgonInfo = false },
            icon = { Icon(Icons.Default.Shield, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
            title = { Text("SSH Cryptographic Derivation") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Keygrain derives deterministic Ed25519 SSH keys from your Master Secret and email.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        "1. Argon2id stretches your secret using email as salt (64 MiB RAM, 3 passes).",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Text(
                        "2. HMAC-SHA256 with domain ':keygrain-ssh' produces a 32-byte Ed25519 seed.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Text(
                        "3. Standard RFC 8032 curve points generate the public key and OpenSSH PEM bundle.",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { showArgonInfo = false }) {
                    Text("Got it!")
                }
            }
        )
    }
}

@Composable
private fun SshEditorDialog(
    initialItem: SshKeyEntry?,
    defaultEmail: String,
    onDismiss: () -> Unit,
    onSave: (keyName: String, email: String, counter: Int) -> Unit
) {
    var keyName by remember { mutableStateOf(initialItem?.keyName ?: "") }
    var email by remember { mutableStateOf(initialItem?.email ?: initialItem?.comment ?: "") }
    var counter by remember { mutableIntStateOf(initialItem?.counter ?: 1) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initialItem == null) "New SSH Keypair" else "Edit SSH Key") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = keyName,
                    onValueChange = {
                        keyName = it.filter { c -> !c.isWhitespace() }
                        errorMsg = null
                    },
                    label = { Text("Key Name (e.g. github, vps)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it; errorMsg = null },
                    label = { Text("Comment (optional, e.g. email or machine)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Counter (Generation):", style = MaterialTheme.typography.bodyMedium)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { if (counter > 1) counter-- }) {
                            Icon(Icons.Default.Remove, contentDescription = "Decrement")
                        }
                        Text("$counter", fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp))
                        IconButton(onClick = { counter++ }) {
                            Icon(Icons.Default.Add, contentDescription = "Increment")
                        }
                    }
                }

                if (errorMsg != null) {
                    Text(errorMsg!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (keyName.isBlank()) {
                        errorMsg = "Key name cannot be empty"
                        return@Button
                    }
                    onSave(keyName.trim(), email.trim(), counter)
                }
            ) {
                Text("Save")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}
