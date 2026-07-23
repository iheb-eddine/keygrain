package com.secbytech.keygrain.data

import android.content.Context

/**
 * Wipes all account-scoped data stored on this device. Shared by "Switch account"
 * and the "delete server data (also locally)" flow.
 *
 * Scope: the master secret, the service list, all sync state (sync email, known
 * UUIDs, wallets, audit log, conflict flags), and the in-memory strengthen cache.
 *
 * This never touches the server. Navigation state and the app settings store
 * ("keygrain_settings": onboarding_completed / offline_mode) are the caller's
 * responsibility, because the two callers reset them differently.
 */
object LocalDataWiper {
    fun wipeAll(context: Context) {
        SecretManager(context).clearAll()
        ServiceManager(context).clearAll()
        SyncManager().clearLocalData(context)
        Keygrain.clearStrengthenCache()
    }
}
