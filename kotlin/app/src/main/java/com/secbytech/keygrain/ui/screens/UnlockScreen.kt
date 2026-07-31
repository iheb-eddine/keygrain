package com.secbytech.keygrain.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.data.Keygrain
import com.secbytech.keygrain.data.SecretManager
import com.secbytech.keygrain.ui.WongPalette
import com.secbytech.keygrain.ui.util.canUseBiometric
import com.secbytech.keygrain.ui.util.showBiometric
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun UnlockScreen(
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
