package com.secbytech.keygrain.ui.util

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.autofill.AutofillManager

object AutofillUtils {

    val KNOWN_CHROME_PACKAGES = listOf(
        "com.android.chrome",
        "org.chromium.chrome",
        "com.chrome.beta",
        "com.chrome.dev",
        "com.chrome.canary"
    )

    /**
     * Checks if Keygrain is currently enabled as an autofill service.
     */
    fun isAutofillEnabled(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        val afm = context.getSystemService(AutofillManager::class.java) ?: return false
        return afm.hasEnabledAutofillServices()
    }

    /**
     * Creates an Intent to prompt the user to enable Keygrain as the autofill service.
     */
    fun createEnableAutofillIntent(context: Context): Intent {
        val packageName = context.packageName
        return Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
            data = Uri.parse("package:$packageName")
        }
    }

    /**
     * Creates an Intent to open the system Settings screen.
     */
    fun createAutofillSettingsIntent(): Intent {
        return Intent(Settings.ACTION_SETTINGS)
    }

    /**
     * Backward-compatible alias for createEnableAutofillIntent.
     */
    fun createSetAutofillServiceIntent(context: Context): Intent {
        return createEnableAutofillIntent(context)
    }

    /**
     * Checks if any known Chrome / Chromium package is installed on the device.
     */
    fun getInstalledChromePackage(packageManager: PackageManager): String? {
        return KNOWN_CHROME_PACKAGES.firstOrNull { pkg ->
            isPackageInstalled(packageManager, pkg)
        }
    }

    /**
     * Helper to test if a specific package is installed.
     */
    fun isPackageInstalled(packageManager: PackageManager, packageName: String): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(packageName, 0)
            }
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Creates an intent to launch Chrome / Chromium browser.
     */
    fun createLaunchChromeIntent(packageManager: PackageManager): Intent? {
        val chromePkg = getInstalledChromePackage(packageManager) ?: return null
        return packageManager.getLaunchIntentForPackage(chromePkg)
    }
}
