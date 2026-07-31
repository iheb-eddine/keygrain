package com.secbytech.keygrain.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.data.DeletionReviewEntry

/**
 * Sync v3 deletion review (Frozen Req 7). Surfaces services this device had unsynced
 * changes to that were deleted on another device. Per-item Restore (re-create under the
 * original id) / Discard (accept the deletion), plus Dismiss all (stop nagging, keep the
 * list). Mirrors the extension's deletion-review UI (designs/sync-deletion-reconciliation.md §7).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DeletionReviewScreen(
    entries: List<DeletionReviewEntry>,
    onRestore: (DeletionReviewEntry) -> Unit,
    onDiscard: (DeletionReviewEntry) -> Unit,
    onDismissAll: () -> Unit,
    onBack: () -> Unit
) {
    BackHandler(onBack = onBack)
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Deleted elsewhere") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (entries.any { !it.seen }) {
                        TextButton(onClick = onDismissAll) { Text("Dismiss all") }
                    }
                }
            )
        }
    ) { padding ->
        if (entries.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Text("Nothing to review.")
            }
            return@Scaffold
        }
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
        ) {
            Text(
                "These services were deleted on another device, but you had changes to " +
                    "them here that hadn't synced yet. Restore the ones you want to keep — " +
                    "the rest stay deleted.",
                modifier = Modifier.padding(16.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            entries.forEach { entry ->
                val svc = entry.service
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 6.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            svc.name.ifBlank { svc.site },
                            style = MaterialTheme.typography.titleMedium
                        )
                        if (svc.site.isNotBlank()) {
                            Text(svc.site, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (svc.email.isNotBlank()) {
                            Text(svc.email, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(
                            "Deleted " + java.text.DateFormat
                                .getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT)
                                .format(java.util.Date(entry.deletedAt)),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                            horizontalArrangement = Arrangement.End
                        ) {
                            TextButton(onClick = { onDiscard(entry) }) { Text("Discard") }
                            Spacer(Modifier.width(8.dp))
                            Button(onClick = { onRestore(entry) }) { Text("Restore") }
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
