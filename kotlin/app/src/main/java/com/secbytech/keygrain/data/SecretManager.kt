package com.secbytech.keygrain.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SecretManager(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "keygrain_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun saveSecret(secret: String) {
        prefs.edit().putString("master_secret", secret).apply()
    }

    fun getSecret(): String? = prefs.getString("master_secret", null)

    fun hasSecret(): Boolean = getSecret() != null

    fun clearSecret() {
        prefs.edit().remove("master_secret").apply()
    }
}
