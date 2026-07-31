package com.secbytech.keygrain.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.data.SshEngine
import com.secbytech.keygrain.ui.util.copyAndClear
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun SshRow(
    service: ServiceEntry,
    masterSecret: String,
    clipboardScope: CoroutineScope,
    context: Context
) {
    val ssh = service.ssh ?: return
    val sshKeyName = ssh.optString("key_name", "")
    if (sshKeyName.isEmpty()) return
    // Row-local scope for the heavy key derivation — safe to cancel on dispose since
    // nothing reaches the clipboard until copyAndClear/setPrimaryClip runs. The 30s
    // CLEAR uses the survivor clipboardScope instead.
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    var sshCopied by remember { mutableStateOf(false) }
    var sshPrivCopied by remember { mutableStateOf(false) }
    var sshPrivConfirmed by remember { mutableStateOf(false) }
    var showSshPrivDialog by remember { mutableStateOf(false) }
    LaunchedEffect(sshCopied) {
        if (sshCopied) { delay(1500); sshCopied = false }
    }
    LaunchedEffect(sshPrivCopied) {
        if (sshPrivCopied) { delay(1500); sshPrivCopied = false }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(
            color = MaterialTheme.colorScheme.primary,
            shape = MaterialTheme.shapes.small
        ) {
            Text(
                "SSH",
                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onPrimary
            )
        }
        Spacer(Modifier.width(8.dp))
        Text(
            text = sshKeyName,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f)
        )
        IconButton(onClick = {
            if (sshCopied) return@IconButton
            scope.launch {
                try {
                    val sshCounter = ssh.optInt("counter", 1)
                    val line = withContext(Dispatchers.Default) {
                        val kp = SshEngine.deriveSshKeypair(masterSecret.toByteArray(), service.email, sshKeyName, sshCounter)
                        val comment = "${service.email.lowercase()}:${sshKeyName.lowercase()}"
                        SshEngine.formatAuthorizedKeys(kp.publicKey, comment)
                    }
                    copyAndClear(context, clipboardScope, "ssh-pubkey", line)
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    sshCopied = true
                } catch (e: Exception) {
                    android.widget.Toast.makeText(context, "SSH error: ${e.message}", android.widget.Toast.LENGTH_SHORT).show()
                }
            }
        }) {
            Icon(
                if (sshCopied) Icons.Default.Check else Icons.Default.ContentCopy,
                contentDescription = if (sshCopied) "Copied" else "Copy SSH public key"
            )
        }
        Spacer(Modifier.width(4.dp))
        IconButton(onClick = {
            if (sshPrivCopied) return@IconButton
            if (!sshPrivConfirmed) { showSshPrivDialog = true; return@IconButton }
            scope.launch {
                try {
                    val sshCounter = ssh.optInt("counter", 1)
                    val pem = withContext(Dispatchers.Default) {
                        val kp = SshEngine.deriveSshKeypair(masterSecret.toByteArray(), service.email, sshKeyName, sshCounter)
                        try {
                            val comment = "${service.email.lowercase()}:${sshKeyName.lowercase()}"
                            SshEngine.formatOpensshPrivateKey(kp.seed, kp.publicKey, comment)
                        } finally {
                            kp.seed.fill(0)
                        }
                    }
                    val clip = ClipData.newPlainText("ssh-privkey", pem)
                    if (android.os.Build.VERSION.SDK_INT >= 33) {
                        clip.description.extras = android.os.PersistableBundle().apply {
                            putBoolean("android.content.extra.IS_SENSITIVE", true)
                        }
                    }
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(clip)
                    if (android.os.Build.VERSION.SDK_INT >= 28) {
                        clipboardScope.launch {
                            delay(30_000)
                            // Only clear if the clipboard still holds this private key.
                            val current = clipboard.primaryClip?.getItemAt(0)?.text?.toString()
                            if (current == pem) {
                                clipboard.clearPrimaryClip()
                            }
                        }
                    }
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    sshPrivCopied = true
                    android.widget.Toast.makeText(context, "Private key copied", android.widget.Toast.LENGTH_SHORT).show()
                } catch (e: Exception) {
                    android.widget.Toast.makeText(context, "SSH error: ${e.message}", android.widget.Toast.LENGTH_SHORT).show()
                }
            }
        }) {
            Icon(
                if (sshPrivCopied) Icons.Default.Check else Icons.Default.VpnKey,
                contentDescription = if (sshPrivCopied) "Copied" else "Copy SSH private key"
            )
        }
        if (showSshPrivDialog) {
            AlertDialog(
                onDismissRequest = { showSshPrivDialog = false },
                title = { Text("Copy Private Key") },
                text = { Text("The private key will be copied to clipboard and cleared after 30 seconds. Continue?") },
                confirmButton = {
                    TextButton(onClick = {
                        showSshPrivDialog = false
                        sshPrivConfirmed = true
                    }) { Text("Copy") }
                },
                dismissButton = {
                    TextButton(onClick = { showSshPrivDialog = false }) { Text("Cancel") }
                }
            )
        }
    }
}
