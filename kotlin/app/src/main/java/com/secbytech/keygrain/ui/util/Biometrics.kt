package com.secbytech.keygrain.ui.util

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.secbytech.keygrain.data.Keygrain

internal fun canUseBiometric(context: Context): Boolean {
    return BiometricManager.from(context)
        .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
        BiometricManager.BIOMETRIC_SUCCESS
}

internal fun showBiometric(context: Context, onSuccess: () -> Unit, onFailed: () -> Unit = {}) {
    val activity = context as FragmentActivity
    val executor = ContextCompat.getMainExecutor(activity)
    val prompt = BiometricPrompt(activity, executor, object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            onSuccess()
        }
        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            onFailed()
        }
        override fun onAuthenticationFailed() {
            // No-op: user can retry. Only onAuthenticationError is terminal.
        }
    })
    prompt.authenticate(
        BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock Keygrain")
            .setSubtitle("Authenticate to access your passwords")
            .setNegativeButtonText("Cancel")
            .build()
    )
}
