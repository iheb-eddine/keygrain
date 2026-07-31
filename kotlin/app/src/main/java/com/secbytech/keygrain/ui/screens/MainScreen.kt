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

    var onboardingCompleted by remember {
        mutableStateOf(settingsPrefs.getBoolean("onboarding_completed", false))
    }
    var unlocked by remember { mutableStateOf(false) }
    var masterSecret by remember { mutableStateOf("") }
    var isDemoMode by remember { mutableStateOf(false) }

    when {
        !onboardingCompleted && !secretManager.hasSecret() -> {
            OnboardingWizard(
                secretManager = secretManager,
                serviceManager = serviceManager,
                onComplete = { secret ->
                    settingsPrefs.edit().putBoolean("onboarding_completed", true).apply()
                    onboardingCompleted = true
                    if (secret != null) {
                        masterSecret = secret
                        unlocked = true
                    }
                }
            )
        }
        !unlocked -> {
            UnlockScreen(
                secretManager = secretManager,
                showSubtitle = !secretManager.hasSecret(),
                onUnlocked = { secret ->
                    masterSecret = secret
                    unlocked = true
                },
                onDemo = {
                    isDemoMode = true
                    masterSecret = "demo-secret-keygrain"
                    unlocked = true
                }
            )
        }
        else -> {
            // Shared local reset used by BOTH Switch account and the OFF branch of
            // Delete server data, so their observable behavior stays identical.
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
                onboardingCompleted = false
                unlocked = false
                masterSecret = ""
                isDemoMode = false
            }
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
