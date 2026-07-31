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
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.data.TotpEngine
import com.secbytech.keygrain.ui.util.copyAndClear
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

@Composable
internal fun TotpRow(
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
