package com.secbytech.keygrain.ui.components

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.data.ServiceEntry
import kotlinx.coroutines.CoroutineScope

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ServiceCard(
    service: ServiceEntry,
    masterSecret: String,
    clipboardScope: CoroutineScope,
    onOpenDetail: () -> Unit,
    onCopy: () -> Unit,
    context: Context
) {
    Card(
        onClick = onOpenDetail,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Tap anywhere on the card opens the read-only Detail. Inner IconButtons
            // (visibility/copy/TOTP/SSH) consume their own taps, so they still work.
            Column {
                Text(service.name, style = MaterialTheme.typography.titleMedium)
                Text(service.email, style = MaterialTheme.typography.bodySmall)
            }
            PasswordRow(service, masterSecret, clipboardScope, context, onCopy)
            TotpRow(service, masterSecret, clipboardScope, context, onCopy)
            SshRow(service, masterSecret, clipboardScope, context)
        }
    }
}
