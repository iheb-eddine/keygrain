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
    val clip = ClipData.newPlainText(label, text)
    if (android.os.Build.VERSION.SDK_INT >= 33) {
        clip.description.extras = android.os.PersistableBundle().apply {
            putBoolean("android.content.extra.IS_SENSITIVE", true)
        }
    }
    clipboard.setPrimaryClip(clip)
    if (android.os.Build.VERSION.SDK_INT >= 26) {
        scope.launch {
            delay(30_000)
            // Only clear if the clipboard still holds exactly what THIS call placed.
            // Prevents a stale timer from wiping a later copy (or the user's own copy).
            val current = clipboard.primaryClip?.getItemAt(0)?.text?.toString()
            if (current == text) {
                if (android.os.Build.VERSION.SDK_INT >= 28) {
                    clipboard.clearPrimaryClip()
                } else {
                    // clearPrimaryClip() was added in API 28. On API 26/27,
                    // replace our entry with an empty clip instead of calling it.
                    clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
                }
            }
        }
    }
}
