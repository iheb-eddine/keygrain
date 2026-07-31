package com.secbytech.keygrain.ui.util

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal fun copyAndClear(
    context: Context,
    scope: CoroutineScope,
    label: String,
    text: String
) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
    if (android.os.Build.VERSION.SDK_INT >= 28) {
        scope.launch {
            delay(30_000)
            // Only clear if the clipboard still holds exactly what THIS call placed.
            // Prevents a stale timer from wiping a later copy (or the user's own copy).
            val current = clipboard.primaryClip?.getItemAt(0)?.text?.toString()
            if (current == text) {
                clipboard.clearPrimaryClip()
            }
        }
    }
}
