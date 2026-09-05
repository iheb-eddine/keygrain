package com.secbytech.keygrain.data

import android.content.Context
import java.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal sealed interface AccountVerificationResult {
    data class ExistsValid(
        val services: List<Pair<String?, Long>>,
        val encryptedBlob: String,
        val checksum: String,
        val etag: String
    ) : AccountVerificationResult
    data object NotFound : AccountVerificationResult
    data class WrongSecret(val code: Int) : AccountVerificationResult
    data object RateLimited : AccountVerificationResult
    data class NetworkUnavailable(val localMatches: Boolean) : AccountVerificationResult
    data class ServerError(val code: Int, val body: String) : AccountVerificationResult
    data class UpgradeRequired(val reason: UpgradeRequiredReason) : AccountVerificationResult
}

internal sealed interface AccountCreationCheckResult {
    data object CanCreate : AccountCreationCheckResult
    data object AlreadyExistsRemote : AccountCreationCheckResult
    data object AlreadyExistsLocal : AccountCreationCheckResult
    data object RateLimited : AccountCreationCheckResult
    data class ServerError(val code: Int, val body: String) : AccountCreationCheckResult
    data class OfflineAllowed(val reason: String) : AccountCreationCheckResult
    data class UpgradeRequired(val reason: UpgradeRequiredReason) : AccountCreationCheckResult
}

internal class AccountVerifier(
    private val baseUrl: String = "https://keygrain.com",
    private val transport: SyncTransport = SyncTransport(baseUrl)
) {
    companion object {
        fun buildAuthHeader(secret: ByteArray, email: String): Pair<String, String> {
            val normalizedEmail = email.trim().lowercase()
            val lookupId = Keygrain.deriveLookupId(secret, normalizedEmail)
            val authPassword = Keygrain.deriveAuthPassword(secret, normalizedEmail)
            val credentials = "$lookupId:$authPassword"
            val encoded = Base64.getEncoder().encodeToString(credentials.toByteArray(Charsets.UTF_8))
            return Pair(lookupId, "Basic $encoded")
        }

        fun isValidEmail(email: String): Boolean {
            val trimmed = email.trim()
            if (trimmed.isEmpty()) return false
            val atIdx = trimmed.indexOf('@')
            if (atIdx <= 0 || atIdx == trimmed.length - 1) return false
            val domain = trimmed.substring(atIdx + 1)
            return domain.contains('.') && !domain.startsWith('.') && !domain.endsWith('.')
        }
    }

    suspend fun verifyAccount(
        secret: ByteArray,
        email: String,
        context: Context? = null
    ): AccountVerificationResult = withContext(Dispatchers.IO) {
        val normalizedEmail = email.trim().lowercase()
        val (lookupId, authHeader) = buildAuthHeader(secret, normalizedEmail)

        val localMatches = if (context != null) {
            val localEmail = SyncStore.getSyncEmail(context)
            localEmail != null && localEmail.equals(normalizedEmail, ignoreCase = true)
        } else false

        when (val result = transport.doGet(lookupId, authHeader)) {
            is GetResult.Success -> {
                AccountVerificationResult.ExistsValid(
                    services = result.services,
                    encryptedBlob = result.encryptedBlob,
                    checksum = result.checksum,
                    etag = result.etag
                )
            }
            is GetResult.NotFound -> {
                AccountVerificationResult.NotFound
            }
            is GetResult.AuthError -> {
                AccountVerificationResult.WrongSecret(result.code)
            }
            is GetResult.Error -> {
                if (result.code == 429) {
                    AccountVerificationResult.RateLimited
                } else {
                    AccountVerificationResult.ServerError(result.code, result.body)
                }
            }
            is GetResult.NetworkError -> {
                AccountVerificationResult.NetworkUnavailable(localMatches = localMatches)
            }
            is GetResult.UpgradeRequired -> {
                AccountVerificationResult.UpgradeRequired(result.reason)
            }
        }
    }

    suspend fun checkCanCreateAccount(
        secret: ByteArray,
        email: String,
        context: Context? = null
    ): AccountCreationCheckResult = withContext(Dispatchers.IO) {
        val normalizedEmail = email.trim().lowercase()

        if (context != null) {
            val localEmail = SyncStore.getSyncEmail(context)
            if (localEmail != null && localEmail.equals(normalizedEmail, ignoreCase = true)) {
                return@withContext AccountCreationCheckResult.AlreadyExistsLocal
            }
        }

        val (lookupId, authHeader) = buildAuthHeader(secret, normalizedEmail)

        when (val result = transport.doGet(lookupId, authHeader)) {
            is GetResult.Success -> {
                AccountCreationCheckResult.AlreadyExistsRemote
            }
            is GetResult.NotFound -> {
                AccountCreationCheckResult.CanCreate
            }
            is GetResult.AuthError -> {
                AccountCreationCheckResult.AlreadyExistsRemote
            }
            is GetResult.Error -> {
                if (result.code == 429) {
                    AccountCreationCheckResult.RateLimited
                } else {
                    AccountCreationCheckResult.ServerError(result.code, result.body)
                }
            }
            is GetResult.NetworkError -> {
                AccountCreationCheckResult.OfflineAllowed("Device is offline. Account will be created locally.")
            }
            is GetResult.UpgradeRequired -> {
                AccountCreationCheckResult.UpgradeRequired(result.reason)
            }
        }
    }
}
