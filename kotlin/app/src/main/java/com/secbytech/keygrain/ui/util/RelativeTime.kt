package com.secbytech.keygrain.ui.util



internal fun formatRelativeTime(ts: Long): String {
    val diff = (System.currentTimeMillis() - ts) / 1000
    return when {
        diff < 60 -> "just now"
        diff < 3600 -> "${diff / 60}m ago"
        else -> "${diff / 3600}h ago"
    }
}
