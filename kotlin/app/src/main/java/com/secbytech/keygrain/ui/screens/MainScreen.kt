package com.secbytech.keygrain.ui.screens

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import com.secbytech.keygrain.data.Keygrain
import com.secbytech.keygrain.data.LocalDataWiper
import com.secbytech.keygrain.data.SecretManager
import com.secbytech.keygrain.data.ServiceManager
import com.secbytech.keygrain.data.SyncStore
import com.secbytech.keygrain.ui.util.canUseBiometric

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen() {
    val context = LocalContext.current
    val secretManager = remember { SecretManager(context) }
    val serviceManager = remember { ServiceManager(context) }
    val settingsPrefs = remember {
        context.getSharedPreferences("keygrain_settings", Context.MODE_PRIVATE)
    }

    var configuredEmail by remember {
        mutableStateOf(SyncStore.getSyncEmail(context))
    }
    var unlocked by remember { mutableStateOf(false) }
    var masterSecret by remember { mutableStateOf("") }
    var isDemoMode by remember { mutableStateOf(false) }

    // Legacy migration: if sync_email is null but local services exist, populate sync_email from most common email
    LaunchedEffect(Unit) {
        if (configuredEmail == null) {
            val services = serviceManager.getServices()
            if (services.isNotEmpty()) {
                val commonEmail = services.groupingBy { it.email }.eachCount().maxByOrNull { it.value }?.key
                if (!commonEmail.isNullOrBlank()) {
                    SyncStore.setSyncEmail(context, commonEmail)
                    configuredEmail = commonEmail
                }
            }
        }
    }

    val wipeLocalAndRestart: () -> Unit = {
        LocalDataWiper.wipeAll(context)
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.clearPrimaryClip()
        }
        settingsPrefs.edit()
            .putBoolean("onboarding_completed", false)
            .putBoolean("offline_mode", false)
            .apply()
        configuredEmail = null
        unlocked = false
        masterSecret = ""
        isDemoMode = false
    }

    when {
        !unlocked -> {
            if (configuredEmail.isNullOrBlank()) {
                AuthScreen(
                    secretManager = secretManager,
                    serviceManager = serviceManager,
                    onUnlocked = { email, secret ->
                        configuredEmail = email
                        masterSecret = secret
                        unlocked = true
                        settingsPrefs.edit().putBoolean("onboarding_completed", true).apply()
                    },
                    onDemo = {
                        isDemoMode = true
                        masterSecret = "demo-secret-keygrain"
                        unlocked = true
                    }
                )
            } else {
                UnlockScreen(
                    secretManager = secretManager,
                    serviceManager = serviceManager,
                    onUnlocked = { email, secret ->
                        configuredEmail = email
                        masterSecret = secret
                        unlocked = true
                    },
                    onSwitchAccount = wipeLocalAndRestart,
                    onDemo = {
                        isDemoMode = true
                        masterSecret = "demo-secret-keygrain"
                        unlocked = true
                    }
                )
            }
        }
        else -> {
            ServiceListScreen(
                masterSecret = masterSecret,
                serviceManager = serviceManager,
                isDemoMode = isDemoMode,
                onLock = {
                    unlocked = false
                    masterSecret = ""
                    isDemoMode = false
                    Keygrain.clearStrengthenCache()
                    if (android.os.Build.VERSION.SDK_INT >= 28) {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.clearPrimaryClip()
                    }
                    if (!canUseBiometric(context)) {
                        secretManager.clearSecret()
                    }
                },
                onSwitchAccount = wipeLocalAndRestart,
                onWipeLocalAndRestart = wipeLocalAndRestart
            )
        }
    }
}
