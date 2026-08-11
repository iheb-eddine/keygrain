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
import com.secbytech.keygrain.data.Keygrain
import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.ui.util.copyAndClear
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal fun derivePasswordForRow(
    service: ServiceEntry,
    masterSecret: String
): Result<String> = try {
    Result.success(
        Keygrain.derivePassword(
            secret = masterSecret.toByteArray(),
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
}

@Composable
internal fun PasswordRow(
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
    var derivationError by remember(
        service.email, service.site, service.length, service.symbols, service.counter, masterSecret
    ) { mutableStateOf<Throwable?>(null) }
    LaunchedEffect(
        service.email, service.site, service.length, service.symbols, service.counter, masterSecret
    ) {
        password = null
        derivationError = null
        val result = withContext(Dispatchers.Default) {
            derivePasswordForRow(service, masterSecret)
        }
        result.fold(
            onSuccess = {
                password = it
                derivationError = null
            },
            onFailure = {
                password = null
                derivationError = it
            }
        )
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
                password == null && derivationError == null -> "Generating…"
                derivationError != null -> "Unable to generate password. Edit service settings to repair."
                visible -> password!!
                else -> "••••••••••••"
            },
            style = MaterialTheme.typography.bodyLarge,
            color = if (derivationError != null) MaterialTheme.colorScheme.error else LocalContentColor.current,
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
