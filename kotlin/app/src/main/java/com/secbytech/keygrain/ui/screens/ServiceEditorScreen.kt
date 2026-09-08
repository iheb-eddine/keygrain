package com.secbytech.keygrain.ui.screens

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.secbytech.keygrain.data.Keygrain
import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.data.SyncCrypto
import com.secbytech.keygrain.data.TotpEngine
import com.secbytech.keygrain.ui.components.CryptoFieldLabel
import com.secbytech.keygrain.ui.components.CryptoInfoBanner
import com.secbytech.keygrain.ui.components.QrScannerDialog
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

internal fun boundedServiceLength(raw: String, fallback: Int = 20): Int =
    (raw.toIntOrNull() ?: fallback).coerceIn(8, 128)

internal fun serviceSymbolsError(symbols: String): String? {
    try {
        Keygrain.validateSymbols(symbols)
    } catch (_: IllegalArgumentException) {
        return "Symbols must be non-empty graphic printable ASCII."
    }
    return if (
        Keygrain.UPPER.length + Keygrain.LOWER.length + Keygrain.DIGITS.length + symbols.length <= 256
    ) null else "Symbols set is too large for password generation."
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ServiceEditorScreen(
    masterSecret: String,
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
        // Global TOTP ticker for preview when TOTP is enabled (Stored or Derived)
        var globalTotpProgress by remember {
            val now = System.currentTimeMillis() / 1000
            mutableFloatStateOf((30 - (now % 30)) / 30f)
        }
        LaunchedEffect(totpModeIndex) {
            if (totpModeIndex > 0) {
                while (true) {
                    val now = System.currentTimeMillis() / 1000
                    globalTotpProgress = (30 - (now % 30)) / 30f
                    delay(1000)
                }
            }
        }

    Scaffold(
        topBar = {
            Column {
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
                                val symbolsError = serviceSymbolsError(symbols)
                                if (symbolsError != null) {
                                    scope.launch { snackbarHostState.showSnackbar(symbolsError) }
                                    return@TextButton
                                }
                                val totpJson = when (totpModeIndex) {
                                1 -> { // Stored
                                    val input = totpSeed.trim()
                                    if (input == originalTotpSeed && initialEntry?.totp != null) {
                                        initialEntry.totp
                                    } else {
                                        try {
                                            val parsed = TotpEngine.parseTotpInput(input)
                                            val masterSecretBytes = masterSecret.ifEmpty { "demo" }.toByteArray()
                                            val encKey = Keygrain.deriveEncryptionKey(masterSecretBytes, email.trim())
                                            val encBytes = try {
                                                SyncCrypto.encrypt(encKey, parsed.seed)
                                            } finally {
                                                encKey.fill(0)
                                                parsed.seed.fill(0)
                                                masterSecretBytes.fill(0)
                                            }
                                            JSONObject().apply {
                                                put("mode", "stored")
                                                put("seed_enc", android.util.Base64.encodeToString(encBytes, android.util.Base64.NO_WRAP))
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
                                length = boundedServiceLength(length),
                                symbols = symbols,
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
            if (totpModeIndex > 0) {
                LinearProgressIndicator(
                    progress = { globalTotpProgress },
                    modifier = Modifier.fillMaxWidth().height(2.dp),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant
                )
            }
        }
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
            CryptoInfoBanner("Site, Email, Length, Symbols, and Counter determine your generated password. Service name is for display only.")
            OutlinedTextField(
                value = name,
                onValueChange = { name = it; onInteraction() },
                label = { CryptoFieldLabel("Service name", isCrypto = false) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = site,
                onValueChange = { if (!isEdit) site = it; onInteraction() },
                label = { CryptoFieldLabel("Site", isCrypto = true, cryptoType = "HMAC Input") },
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
                label = { CryptoFieldLabel("Email", isCrypto = true, cryptoType = "Argon2id Salt") },
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
                        label = { CryptoFieldLabel("Length", isCrypto = true, cryptoType = "Derivation") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                    )
                    OutlinedTextField(
                        value = symbols,
                        onValueChange = { symbols = it; onInteraction() },
                        label = { CryptoFieldLabel("Symbols", isCrypto = true, cryptoType = "Derivation") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = counter,
                        onValueChange = { counter = it.filter { c -> c.isDigit() }; onInteraction() },
                        label = { CryptoFieldLabel("Counter (Version)", isCrypto = true, cryptoType = "Rotation") },
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
                            label = { CryptoFieldLabel("Seed / otpauth:// URI", isCrypto = true, cryptoType = "Seed") },
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
                        label = { CryptoFieldLabel("Key name (optional)", isCrypto = true, cryptoType = "SSH Derivation") },
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
