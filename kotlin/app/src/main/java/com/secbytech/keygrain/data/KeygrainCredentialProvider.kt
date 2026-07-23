package com.secbytech.keygrain.data

import android.app.PendingIntent
import android.content.Intent
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.PasswordCredentialEntry
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import java.net.URI

class KeygrainCredentialProvider : CredentialProviderService() {

    override fun onBeginGetCredentialRequest(
        request: BeginGetCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>
    ) {
        try {
        val secret = SecretManager(applicationContext).getSecret()
        if (secret == null) {
            callback.onResult(BeginGetCredentialResponse())
            return
        }

        val passwordOptions = request.beginGetCredentialOptions
            .filterIsInstance<BeginGetPasswordOption>()
        if (passwordOptions.isEmpty()) {
            callback.onResult(BeginGetCredentialResponse())
            return
        }

        val origin = try {
            request.callingAppInfo?.origin
        } catch (_: SecurityException) {
            null
        }
        if (origin == null) {
            callback.onResult(BeginGetCredentialResponse())
            return
        }

        val host = try {
            URI(origin).host
        } catch (_: Exception) {
            null
        }
        if (host.isNullOrEmpty()) {
            callback.onResult(BeginGetCredentialResponse())
            return
        }

        val normalized = ServiceManager.normalizeSite(host)
        val psl = PublicSuffixList.getInstance(applicationContext)
        val visitedRegistrable = psl.extractRegistrableDomain(normalized)
        if (visitedRegistrable == null) {
            callback.onResult(BeginGetCredentialResponse())
            return
        }

        val serviceManager = ServiceManager(applicationContext)
        val matches = serviceManager.getServices().filter {
            psl.extractRegistrableDomain(ServiceManager.normalizeSite(it.site)) == visitedRegistrable
        }
        if (matches.isEmpty()) {
            callback.onResult(BeginGetCredentialResponse())
            return
        }

        val entries = mutableListOf<PasswordCredentialEntry>()
        var requestCode = 0
        for (service in matches) {
            for (option in passwordOptions) {
                val intent = Intent(applicationContext, CredentialSelectionActivity::class.java).apply {
                    putExtra("service_name", service.name)
                    putExtra("email", service.email)
                    putExtra("site", service.site)
                    putExtra("length", service.length)
                    putExtra("symbols", service.symbols)
                    putExtra("counter", service.counter)
                }
                val pendingIntent = PendingIntent.getActivity(
                    applicationContext, requestCode++, intent,
                    PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )
                entries.add(
                    PasswordCredentialEntry.Builder(
                        applicationContext, service.email, pendingIntent, option
                    ).setDisplayName("Keygrain — ${service.name}").build()
                )
            }
        }

        callback.onResult(BeginGetCredentialResponse(entries))
        } catch (_: Exception) {
            callback.onResult(BeginGetCredentialResponse())
        }
    }

    override fun onBeginCreateCredentialRequest(
        request: BeginCreateCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>
    ) {
        callback.onResult(BeginCreateCredentialResponse())
    }

    override fun onClearCredentialStateRequest(
        request: ProviderClearCredentialStateRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<Void?, ClearCredentialException>
    ) {
        callback.onResult(null)
    }
}
