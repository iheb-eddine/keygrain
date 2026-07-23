package com.secbytech.keygrain.ui.screens

import android.view.WindowManager
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.font.FontFamily
import com.secbytech.keygrain.data.WalletEngine
import com.secbytech.keygrain.data.SyncManager
import com.secbytech.keygrain.data.WalletEntry
import com.secbytech.keygrain.data.WalletAuditEntry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletScreen(
    masterSecret: String,
    isDemoMode: Boolean = false,
    defaultEmail: String,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var email by remember { mutableStateOf(defaultEmail) }
    var walletName by remember { mutableStateOf("") }
    var selectedChain by remember { mutableStateOf("bitcoin") }
    var counter by remember { mutableStateOf("1") }
    var confirmed by remember { mutableStateOf(false) }
    var countdownActive by remember { mutableStateOf(false) }
    var countdownSeconds by remember { mutableStateOf(3) }
    var deriving by remember { mutableStateOf(false) }
    var mnemonic by remember { mutableStateOf<String?>(null) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var clearSeconds by remember { mutableStateOf(60) }

    // Load wordlist
    LaunchedEffect(Unit) { WalletEngine.loadWordlist(context) }

    // 3-second countdown after checkbox
    LaunchedEffect(confirmed) {
        if (confirmed) {
            countdownActive = true
            countdownSeconds = 3
            while (countdownSeconds > 0) {
                delay(1000)
                countdownSeconds--
            }
            countdownActive = false
        }
    }

    // Auto-clear mnemonic after 60 seconds
    LaunchedEffect(mnemonic) {
        if (mnemonic != null) {
            clearSeconds = 60
            while (clearSeconds > 0) {
                delay(1000)
                clearSeconds--
            }
            mnemonic = null
        }
    }

    // FLAG_SECURE when mnemonic is visible
    val activity = context as? android.app.Activity
    DisposableEffect(mnemonic) {
        if (mnemonic != null) {
            activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        onDispose {
            activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    val chains = WalletEngine.SUPPORTED_CHAINS.toList().sorted()
    val deriveEnabled = confirmed && !countdownActive && !deriving &&
        walletName.isNotBlank() && email.isNotBlank()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Wallet Derivation") },
                navigationIcon = {
                    IconButton(onClick = { mnemonic = null; onBack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState())
        ) {
            // Warning
            Card(
                shape = RoundedCornerShape(16.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    "⚠️ DISASTER RECOVERY DERIVATION\n\n" +
                    "• If you lose your master secret, ALL derived wallets are PERMANENTLY LOST.\n" +
                    "• There is NO recovery mechanism.\n" +
                    "• Use a hardware wallet for daily operations.\n" +
                    "• This is for DISASTER RECOVERY only.",
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer
                )
            }

            Spacer(Modifier.height(16.dp))

            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Email") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = walletName,
                onValueChange = { walletName = it.lowercase().filter { c -> c.isLetterOrDigit() || c == '-' } },
                label = { Text("Wallet name") },
                placeholder = { Text("e.g. personal, savings") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            Spacer(Modifier.height(8.dp))

            // Chain dropdown
            var chainExpanded by remember { mutableStateOf(false) }
            ExposedDropdownMenuBox(
                expanded = chainExpanded,
                onExpandedChange = { chainExpanded = it }
            ) {
                OutlinedTextField(
                    value = selectedChain,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Chain") },
                    modifier = Modifier.fillMaxWidth().menuAnchor(),
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = chainExpanded) }
                )
                ExposedDropdownMenu(expanded = chainExpanded, onDismissRequest = { chainExpanded = false }) {
                    chains.forEach { chain ->
                        DropdownMenuItem(
                            text = { Text(chain) },
                            onClick = { selectedChain = chain; chainExpanded = false }
                        )
                    }
                }
            }
            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = counter,
                onValueChange = { counter = it.filter { c -> c.isDigit() } },
                label = { Text("Counter") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            Spacer(Modifier.height(12.dp))

            // Confirmation
            Row(modifier = Modifier.fillMaxWidth()) {
                Checkbox(checked = confirmed, onCheckedChange = { confirmed = it; if (!it) mnemonic = null })
                Spacer(Modifier.width(8.dp))
                Text("I understand the risks", modifier = Modifier.padding(top = 12.dp))
            }

            if (countdownActive) {
                Text("Derive button activates in ${countdownSeconds}s...",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.secondary)
            }

            Spacer(Modifier.height(8.dp))

            Button(
                onClick = {
                    errorMsg = null
                    val c = counter.toIntOrNull() ?: 0
                    if (c < 1) { errorMsg = "Counter must be >= 1"; return@Button }
                    deriving = true
                    scope.launch {
                        try {
                            val result = withContext(Dispatchers.Default) {
                                WalletEngine.deriveWalletMnemonic(
                                    masterSecret.toByteArray(),
                                    email.trim(),
                                    walletName.trim(),
                                    selectedChain,
                                    c
                                )
                            }
                            mnemonic = result

                            // Persist wallet entry and audit log
                            if (!isDemoMode) {
                            val syncMgr = SyncManager()
                            val wallets = syncMgr.getWallets(context).toMutableList()
                            val wKey = walletName.trim().lowercase() + ":" + selectedChain.lowercase()
                            val idx = wallets.indexOfFirst { WalletEntry.mergeKey(it) == wKey }
                            if (idx >= 0) {
                                val existing = wallets[idx]
                                if (existing.counter != c || existing.email != email.trim()) {
                                    wallets[idx] = existing.copy(counter = c, email = email.trim(), updatedAt = java.time.Instant.now().toString())
                                }
                            } else {
                                wallets.add(WalletEntry(walletName = walletName.trim(), chain = selectedChain, counter = c, email = email.trim(), mode = "keygrain", createdAt = java.time.Instant.now().toString(), updatedAt = java.time.Instant.now().toString(), notes = ""))
                            }
                            syncMgr.saveWallets(context, wallets)

                            val auditLog = syncMgr.getAuditLog(context).toMutableList()
                            auditLog.add(WalletAuditEntry(action = "derive", walletName = walletName.trim(), chain = selectedChain, counter = c, timestamp = java.time.Instant.now().toString(), verification = "passed"))
                            syncMgr.saveAuditLog(context, auditLog)
                            }
                        } catch (e: Exception) {
                            errorMsg = e.message
                        }
                        deriving = false
                    }
                },
                enabled = deriveEnabled,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(if (deriving) "Deriving..." else "Derive Mnemonic")
            }

            errorMsg?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }

            // Mnemonic display
            mnemonic?.let { m ->
                Spacer(Modifier.height(16.dp))

                val bip44Path = BIP44_PATHS[selectedChain] ?: ""
                if (bip44Path.isNotEmpty()) {
                    Text("BIP-44 Path: $bip44Path",
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.secondary)
                    Spacer(Modifier.height(8.dp))
                }

                val words = m.split(" ")
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        words.forEachIndexed { i, word ->
                            Text("${i + 1}. $word", fontFamily = FontFamily.Monospace)
                        }
                    }
                }

                Spacer(Modifier.height(8.dp))
                Text("Auto-clear in ${clearSeconds}s",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.secondary)

                OutlinedButton(onClick = { mnemonic = null }, modifier = Modifier.fillMaxWidth()) {
                    Text("Clear")
                }
            }

            // Previously derived wallets list
            Spacer(Modifier.height(24.dp))
            HorizontalDivider()
            Spacer(Modifier.height(12.dp))
            Text("Previously Derived Wallets", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(8.dp))

            val syncMgr = remember { SyncManager() }
            val savedWallets = remember { mutableStateOf(emptyList<WalletEntry>()) }
            LaunchedEffect(mnemonic) {
                savedWallets.value = syncMgr.getWallets(context)
            }

            if (savedWallets.value.isEmpty()) {
                Text("No wallets derived yet.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                savedWallets.value.forEach { w ->
                    Card(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        shape = RoundedCornerShape(16.dp),
                        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        Row(modifier = Modifier.padding(12.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Column {
                                Text(w.walletName, style = MaterialTheme.typography.bodyMedium)
                                Text("${w.chain} • counter ${w.counter}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text(
                                w.createdAt.take(10),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }
}

private val BIP44_PATHS = mapOf(
    "bitcoin" to "m/84'/0'/0'/0/0",
    "ethereum" to "m/44'/60'/0'/0/0",
    "solana" to "m/44'/501'/0'/0'",
    "litecoin" to "m/84'/2'/0'/0/0",
    "dogecoin" to "m/44'/3'/0'/0/0",
    "bitcoin-testnet" to "m/84'/1'/0'/0/0",
    "polkadot" to "(substrate derivation)",
    "cosmos" to "m/44'/118'/0'/0/0",
    "avalanche" to "m/44'/60'/0'/0/0"
)
