package com.secbytech.keygrain.ui.components

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.ui.util.copyAndClear
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay

@Composable
internal fun CopyableRow(
    label: String,
    value: String,
    clipboardScope: CoroutineScope,
    context: Context
) {
    val haptic = LocalHapticFeedback.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) { delay(1500); copied = false }
    }
    // Single merged semantics node = one TalkBack stop for the whole row, with a
    // "Copy <label>" action label; the trailing icon is decorative (null description).
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClickLabel = "Copy $label") {
                if (copied) return@clickable
                copyAndClear(context, clipboardScope, label, value)
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                copied = true
            }
            .semantics(mergeDescendants = true) {
                contentDescription = "$label: $value"
            }
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(value, style = MaterialTheme.typography.bodyLarge)
        }
        Icon(
            if (copied) Icons.Default.Check else Icons.Default.ContentCopy,
            contentDescription = null
        )
    }
}
