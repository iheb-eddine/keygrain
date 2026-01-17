package com.badrani.keygrain.ui

object UserMessages {
    const val AUTH_ERROR = "Couldn't verify your identity. Check your secret and email."
    const val NETWORK_ERROR = "Can't reach the server. Check your internet connection and try again."
    const val SERVER_ERROR = "Something went wrong on the server. Try again in a few minutes."
    const val CONFLICT_ERROR = "Another device updated your backup since you last synced."
    const val DECRYPT_FILE_ERROR = "Couldn't decrypt the file. Make sure you're using the same secret and email you used to export it."
    const val EXPORT_ERROR = "Couldn't export your services. Make sure you have storage access and try again."
    const val IMPORT_ERROR = "Couldn't read the backup file. Make sure you selected a valid Keygrain backup."

    const val INTEGRITY_ERROR = "Sync failed due to a data integrity issue. Try again or export your data as a backup."

    fun syncSuccess(count: Int) = "Synced \u2014 $count services."
    fun exportSuccess(count: Int) = "Exported $count services to file."
    fun importSuccess(count: Int) = "Imported $count services from file."
}
