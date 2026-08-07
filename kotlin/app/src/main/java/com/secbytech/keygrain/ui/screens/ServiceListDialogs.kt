package com.secbytech.keygrain.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.data.ServiceEntry

/**
 * Dialog: manual sync trigger with email prompt.
 */
@Composable
internal fun SyncEmailDialog(
    syncEmail: String,
    onSyncEmailChange: (String) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Sync to Server") },
        text = {
            Column {
                Text("Email for sync identity:")
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = syncEmail,
                    onValueChange = onSyncEmailChange,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = syncEmail.isNotBlank()) { Text("Continue") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

/**
 * Dialog: syncing in progress (non-dismissable spinner).
 */
@Composable
internal fun SyncingDialog() {
    AlertDialog(
        onDismissRequest = {},
        confirmButton = {},
        text = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                CircularProgressIndicator()
                Text("Syncing...")
            }
        }
    )
}

/**
 * Dialog: export/import file email prompt.
 */
@Composable
internal fun FileEmailDialog(
    action: String, // "export" or "import"
    fileEmail: String,
    onFileEmailChange: (String) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (action == "export") "Export to File" else "Import from File") },
        text = {
            Column {
                Text("Email for encryption key:")
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = fileEmail,
                    onValueChange = onFileEmailChange,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = fileEmail.isNotBlank()) { Text("Continue") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

/**
 * Dialog: confirm import replacement.
 */
@Composable
internal fun ImportConfirmDialog(
    localCount: Int,
    importCount: Int,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Confirm Import") },
        text = {
            Text("Replace all $localCount local services with $importCount services from file?")
        },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text("Replace") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

/**
 * Dialog: confirm service deletion.
 */
@Composable
internal fun DeleteServiceDialog(
    serviceName: String,
    hasStoredTotp: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete $serviceName?") },
        text = if (hasStoredTotp) {
            {
                Text(
                    "⚠️ This service has a stored TOTP seed that is NOT derivable. " +
                        "Deleting it here and syncing removes it from all your devices, and " +
                        "it cannot be recovered."
                )
            }
        } else null,
        confirmButton = {
            TextButton(onClick = onConfirm) { Text("Delete") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

/**
 * Dialog: confirm account switch (wipes local data).
 */
@Composable
internal fun SwitchAccountDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Switch account?") },
        text = {
            Text(
                "This clears all data on this device — your services, wallets, and " +
                    "settings — and returns to setup so you can enter a different master " +
                    "secret.\n\nYour data on the sync server is not affected by this action."
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text("Switch account") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

/**
 * Dialog: confirm server data deletion with keep-local toggle.
 */
@Composable
internal fun DeleteServerDialog(
    keepLocal: Boolean,
    onKeepLocalChange: (Boolean) -> Unit,
    deleteInProgress: Boolean,
    deleteError: String?,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = { if (!deleteInProgress) onDismiss() },
        title = { Text("Delete data from the server?") },
        text = {
            Column {
                Text(
                    "This permanently erases everything stored on the sync server for " +
                        "this account — all your services, wallets, and TOTP codes. This " +
                        "cannot be undone on the server."
                )
                Spacer(Modifier.height(16.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(
                        checked = keepLocal,
                        onCheckedChange = onKeepLocalChange,
                        enabled = !deleteInProgress
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Keep my data on this device (offline mode)")
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    if (keepLocal)
                        "Your data stays on this phone. It's removed from the server, but " +
                            "you can restore it later by turning Offline mode off to sync again."
                    else
                        "Your data will also be permanently erased from this device.",
                    style = MaterialTheme.typography.bodySmall
                )
                deleteError?.let {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
        },
        confirmButton = {
            TextButton(enabled = !deleteInProgress, onClick = onConfirm) {
                Text("Delete", color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(enabled = !deleteInProgress, onClick = onDismiss) { Text("Cancel") }
        }
    )
}
