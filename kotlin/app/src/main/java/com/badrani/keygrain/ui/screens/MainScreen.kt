package com.badrani.keygrain.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.badrani.keygrain.data.Keygrain
import com.badrani.keygrain.data.SecretManager
import com.badrani.keygrain.data.ServiceEntry
import com.badrani.keygrain.data.ServiceManager

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen() {
    val context = LocalContext.current
    val secretManager = remember { SecretManager(context) }
    val serviceManager = remember { ServiceManager(context) }

    var unlocked by remember { mutableStateOf(false) }
    var masterSecret by remember { mutableStateOf("") }

    if (!unlocked) {
        UnlockScreen(
            secretManager = secretManager,
            onUnlocked = { secret ->
                masterSecret = secret
                unlocked = true
            }
        )
    } else {
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun UnlockScreen(
    secretManager: SecretManager,
    onUnlocked: (String) -> Unit
) {
    val context = LocalContext.current
    var secret by remember { mutableStateOf("") }
    var secretVisible by remember { mutableStateOf(false) }

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
    var showAddDialog by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Keygrain") },
                actions = {
                    IconButton(onClick = onLock) {
                        Icon(Icons.Default.Lock, contentDescription = "Lock")
                    }
                }
            )
        },
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
            LazyColumn(
                modifier = Modifier.padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(services, key = { it.name }) { service ->
                    ServiceCard(
                        service = service,
                        masterSecret = masterSecret,
                        onDelete = { showDeleteDialog = service.name },
                        context = context
                    )
                }
            }
        }
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
    onAdd: (ServiceEntry) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var length by remember { mutableStateOf("20") }
    var symbols by remember { mutableStateOf(Keygrain.DEFAULT_SYMBOLS) }
    var salt by remember { mutableStateOf("") }
    var showAdvanced by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add Service") },
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
                TextButton(onClick = { showAdvanced = !showAdvanced }) {
                    Text(if (showAdvanced) "Hide advanced" else "Show advanced")
                }
                if (showAdvanced) {
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
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onAdd(ServiceEntry(
                        name = name.trim(),
                        email = email.trim(),
                        length = length.toIntOrNull() ?: 20,
                        symbols = symbols.ifEmpty { Keygrain.DEFAULT_SYMBOLS },
                        salt = salt
                    ))
                },
                enabled = name.isNotBlank() && email.isNotBlank()
            ) { Text("Add") }
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
