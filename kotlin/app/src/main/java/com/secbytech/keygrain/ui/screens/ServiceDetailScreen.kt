package com.secbytech.keygrain.ui.screens

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.data.ServiceEntry
import com.secbytech.keygrain.ui.components.CopyableRow
import com.secbytech.keygrain.ui.components.PasswordRow
import com.secbytech.keygrain.ui.components.SshRow
import com.secbytech.keygrain.ui.components.TotpRow
import kotlinx.coroutines.CoroutineScope

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ServiceDetailScreen(
    service: ServiceEntry,
    masterSecret: String,
    clipboardScope: CoroutineScope,
    context: Context,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onCopy: () -> Unit,
    onInteraction: () -> Unit
) {
    // Always-enabled so Back returns to the list and never backgrounds the app.
    BackHandler(enabled = true) { onBack() }
    // Root pointerInput mirrors the list's idiom: observe on the Initial pass and never
    // consume, so taps/scrolls reset the auto-lock timer without stealing child gestures.
    Box(modifier = Modifier.fillMaxSize().pointerInput(Unit) {
        awaitPointerEventScope {
            while (true) {
                awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial)
                onInteraction()
            }
        }
    }) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(service.name) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = onEdit) {
                        Icon(Icons.Default.Edit, contentDescription = "Edit")
                    }
                }
            )
        }
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
            // Identity fields — copyable (fixes "can't copy name/site/email").
            CopyableRow("Service name", service.name, clipboardScope, context)
            if (service.site.isNotBlank()) {
                CopyableRow("Site", service.site, clipboardScope, context)
            }
            CopyableRow("Email", service.email, clipboardScope, context)

            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

            // Credentials — reuse the exact card rows (identical derivation + copy).
            Text(
                "Password",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            PasswordRow(service, masterSecret, clipboardScope, context, onCopy)

            if (service.totp != null) {
                Text(
                    "TOTP",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                TotpRow(service, masterSecret, clipboardScope, context, onCopy)
            }

            if (service.ssh?.optString("key_name", "").orEmpty().isNotEmpty()) {
                Text(
                    "SSH key",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                SshRow(service, masterSecret, clipboardScope, context)
            }

            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

            // Symbols — copyable (raw set; the one customized parameter worth backing up).
            CopyableRow("Symbols", service.symbols, clipboardScope, context)

            // Length / Counter — muted, non-copyable caption (trivial ints, not credentials).
            Text(
                "Length ${service.length} · Counter ${service.counter}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = onDelete,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                )
            ) {
                Icon(Icons.Default.Delete, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Delete")
            }
        }
    }
    } // Box (auto-lock interaction)
}
