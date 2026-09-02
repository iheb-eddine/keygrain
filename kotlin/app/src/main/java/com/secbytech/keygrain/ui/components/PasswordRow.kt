package com.secbytech.keygrain.ui.components

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.data.Keygrain

import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.ui.util.copyAndClear
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal fun derivePasswordForRow(
    service: ServiceEntry,
    masterSecret: String
): Result<String> {
    val secretBytes = masterSecret.toByteArray()
    return try {
        Result.success(
            Keygrain.derivePassword(
                secret = secretBytes,
                email = service.email,
                site = service.site,
                length = service.length,
                symbols = service.symbols,
                counter = service.counter
            )
        )
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e)
    } finally {
        secretBytes.fill(0)
    }
}

@Composable
internal fun PasswordRow(
    service: ServiceEntry,
    masterSecret: String,
    clipboardScope: CoroutineScope,
    context: Context,
    onCopy: () -> Unit
) {
    var password by remember(
        service.email, service.site, service.length, service.symbols, service.counter, masterSecret
    ) { mutableStateOf<String?>(null) }
    var derivationError by remember(
        service.email, service.site, service.length, service.symbols, service.counter, masterSecret
    ) { mutableStateOf<Throwable?>(null) }
    var isDeriving by remember { mutableStateOf(false) }
    var visible by remember(
        service.email, service.site, service.length, service.symbols, service.counter, masterSecret
    ) { mutableStateOf(false) }
    var passwordCopied by remember { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()


    var derivationDurationMs by remember(
        service.email, service.site, service.length, service.symbols, service.counter, masterSecret
    ) { mutableStateOf<Long?>(null) }
    var wasKeyCached by remember(
        service.email, service.site, service.length, service.symbols, service.counter, masterSecret
    ) { mutableStateOf<Boolean?>(null) }
    var showDerivationInfoDialog by remember { mutableStateOf(false) }

    LaunchedEffect(passwordCopied) {
        if (passwordCopied) { delay(1500); passwordCopied = false }
    }

    fun doCopy(pw: String) {
        if (passwordCopied) return
        copyAndClear(context, clipboardScope, "password", pw)
        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        passwordCopied = true
        onCopy()
    }

    fun ensureDerived(onSuccess: (String) -> Unit) {
        val existing = password
        if (existing != null) {
            onSuccess(existing)
            return
        }
        if (isDeriving) return
        isDeriving = true
        derivationError = null
        scope.launch {
            val secretBytes = masterSecret.toByteArray()
            val cached = try {
                Keygrain.hasStrengthenedKey(secretBytes, service.email)
            } finally {
                secretBytes.fill(0)
            }
            val start = System.currentTimeMillis()
            val result = withContext(Dispatchers.Default) {
                derivePasswordForRow(service, masterSecret)
            }
            val elapsed = System.currentTimeMillis() - start
            isDeriving = false
            result.fold(
                onSuccess = {
                    password = it
                    derivationDurationMs = elapsed
                    wasKeyCached = cached
                    derivationError = null
                    onSuccess(it)
                },
                onFailure = {
                    password = null
                    derivationDurationMs = null
                    wasKeyCached = null
                    derivationError = it
                }
            )
        }
    }

    if (showDerivationInfoDialog) {
        val isCached = wasKeyCached == true
        AlertDialog(
            onDismissRequest = { showDerivationInfoDialog = false },
            title = {
                Text(
                    if (isCached) "Instant derivation (${derivationDurationMs ?: 0}ms)"
                    else "Argon2id derivation (${derivationDurationMs ?: 0}ms)"
                )
            },
            text = {
                Text(
                    if (isCached) {
                        "The heavy Argon2id strengthening key for ${service.email} was already computed during this session!\n\n" +
                        "Keygrain safely reused this in-memory session key, executing only fast HMAC-SHA256 rejection sampling " +
                        "which takes just a few milliseconds.\n\n" +
                        "When you lock the app, all session keys in RAM are immediately wiped."
                    } else {
                        "Keygrain computed this password deterministically on-demand using Argon2id " +
                        "(3 iterations, 64 MB memory) followed by HMAC-SHA256 rejection sampling.\n\n" +
                        "This deliberate calculation ensures brute-force resistance even if a GPU cluster attempts to guess your master secret. " +
                        "Because this requires real CPU and memory work, deriving takes about a second—your master password is never stored or transmitted anywhere!"
                    }
                )
            },
            confirmButton = {
                TextButton(onClick = { showDerivationInfoDialog = false }) {
                    Text("Got it")
                }
            }
        )
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = when {
                    isDeriving -> "Deriving with Argon2id…"
                    derivationError != null -> "Unable to generate password. Edit service settings to repair."
                    visible && password != null -> password!!
                    else -> "••••••••••••"
                },
                style = MaterialTheme.typography.bodyLarge,
                color = if (derivationError != null) MaterialTheme.colorScheme.error else LocalContentColor.current,
                fontFamily = if (visible && password != null) FontFamily.Monospace else FontFamily.Default,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (visible && derivationDurationMs != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(top = 2.dp)
                ) {
                    Text(
                        text = if (wasKeyCached == true) "Cached in ${derivationDurationMs}ms" else "Derived in ${derivationDurationMs}ms",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    IconButton(
                        onClick = { showDerivationInfoDialog = true },
                        modifier = Modifier.size(18.dp).padding(start = 4.dp)
                    ) {
                        Icon(
                            Icons.Default.Info,
                            contentDescription = "Why derivation takes time",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
            }
        }
        IconButton(
            onClick = {
                if (!visible && password == null) {
                    ensureDerived { visible = true }
                } else {
                    visible = !visible
                }
            },
            enabled = derivationError == null && !isDeriving
        ) {
            Icon(
                if (visible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                contentDescription = "Toggle"
            )
        }
        IconButton(
            enabled = derivationError == null && !isDeriving,
            onClick = {
                ensureDerived { pw -> doCopy(pw) }
            }
        ) {
            Icon(
                if (passwordCopied) Icons.Default.Check else Icons.Default.ContentCopy,
                contentDescription = if (passwordCopied) "Copied" else "Copy"
            )
        }
    }
}


