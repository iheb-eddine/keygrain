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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.data.Keygrain
import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.data.SyncCrypto
import com.secbytech.keygrain.data.TotpEngine
import com.secbytech.keygrain.ui.util.copyAndClear
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
    var visible by remember { mutableStateOf(false) }
    var totpCode by remember { mutableStateOf("") }
    var totpRemaining by remember { mutableIntStateOf(0) }
    var totpCopied by remember { mutableStateOf(false) }
    var isDeriving by remember { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    LaunchedEffect(totpCopied) {
        if (totpCopied) { delay(1500); totpCopied = false }
    }

    suspend fun resolveSeed(): ByteArray? = withContext(Dispatchers.Default) {
        val mode = totp.optString("mode", "")
        if (mode == "stored") {
            if (totp.has("seed_enc")) {
                val encKey = Keygrain.deriveEncryptionKey(masterSecret.toByteArray(), service.email)
                try {
                    val encBytes = android.util.Base64.decode(totp.getString("seed_enc"), android.util.Base64.DEFAULT)
                    SyncCrypto.decrypt(encKey, encBytes)
                } finally {
                    encKey.fill(0)
                }
            } else if (totp.has("seed")) {
                android.util.Base64.decode(totp.getString("seed"), android.util.Base64.DEFAULT)
            } else null
        } else {
            TotpEngine.deriveTotpSeed(masterSecret.toByteArray(), service.email, service.site)
        }
    }

    // 1-second ticker loop active ONLY when unmasked (visible)
    LaunchedEffect(visible, totp.toString(), service.email, service.site, masterSecret) {
        if (!visible) {
            totpCode = ""
            return@LaunchedEffect
        }
        isDeriving = true
        val digits = totp.optInt("digits", 6)
        val period = totp.optInt("period", 30)
        val algorithm = totp.optString("algorithm", "SHA1")
        val seed = try { resolveSeed() } catch (_: Exception) { null }
        isDeriving = false
        if (seed == null) {
            totpCode = "error"
            totpRemaining = 0
            return@LaunchedEffect
        }
        try {
            while (visible) {
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
        } finally {
            seed.fill(0)
        }
    }

    fun doCopyTotp() {
        if (totpCopied) return
        scope.launch {
            isDeriving = true
            val digits = totp.optInt("digits", 6)
            val period = totp.optInt("period", 30)
            val algorithm = totp.optString("algorithm", "SHA1")
            var seed: ByteArray? = null
            val codeToCopy = try {
                seed = resolveSeed()
                if (seed != null) {
                    val now = System.currentTimeMillis() / 1000
                    TotpEngine.generateTotp(seed, now, digits, period, algorithm)
                } else null
            } catch (_: Exception) { null }
            finally {
                seed?.fill(0)
            }
            isDeriving = false
            if (!codeToCopy.isNullOrEmpty() && codeToCopy != "error") {
                copyAndClear(context, clipboardScope, "totp", codeToCopy)
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                totpCopied = true
                onCopy()
            }
        }
    }


    val formatted = when {
        isDeriving -> "Deriving…"
        !visible -> "••••••"
        totpCode.all { it.isDigit() } -> {
            if (totpCode.length == 8)
                totpCode.substring(0, 4) + " " + totpCode.substring(4)
            else if (totpCode.length == 6)
                totpCode.substring(0, 3) + " " + totpCode.substring(3)
            else totpCode
        }
        else -> totpCode
    }

    Surface(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        color = if (visible) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface.copy(alpha = 0.7f),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (visible) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
        ),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
        ) {
            Icon(
                Icons.Default.Security,
                contentDescription = null,
                tint = if (visible) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp)
            )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "2FA",
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold),
                    color = if (visible) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.width(12.dp))
                Text(
                    text = formatted,
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = if (visible) androidx.compose.ui.text.font.FontWeight.Bold else androidx.compose.ui.text.font.FontWeight.Normal
                    ),
                    color = if (visible) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
                    fontFamily = if (visible) FontFamily.Monospace else FontFamily.Default,
                    modifier = Modifier.weight(1f)
                )
                if (visible && totpRemaining > 0) {
                    Text(
                        text = "${totpRemaining}s",
                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium),
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f)
                    )
                    Spacer(Modifier.width(6.dp))
                }
                IconButton(
                    onClick = { visible = !visible },
                    enabled = !isDeriving
                ) {
                    Icon(
                        if (visible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = "Toggle TOTP",
                        tint = if (visible) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                IconButton(
                    onClick = { doCopyTotp() },
                    enabled = !isDeriving
                ) {
                    Icon(
                        if (totpCopied) Icons.Default.Check else Icons.Default.ContentCopy,
                        contentDescription = if (totpCopied) "Copied" else "Copy TOTP",
                        tint = if (visible) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
}


