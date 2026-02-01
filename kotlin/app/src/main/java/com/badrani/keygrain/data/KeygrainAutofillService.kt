package com.badrani.keygrain.data

import android.app.assist.AssistStructure
import android.os.CancellationSignal
import android.service.autofill.*
import android.view.autofill.AutofillValue
import android.widget.RemoteViews

class KeygrainAutofillService : AutofillService() {

    companion object {
        private val DEFAULT_BROWSER_PACKAGES = setOf(
            "com.android.chrome",
            "org.mozilla.firefox",
            "com.sec.android.app.sbrowser",
            "com.brave.browser",
            "com.microsoft.emmx"
        )
        private const val PREFS_NAME = "keygrain_autofill"
        private const val KEY_BROWSERS = "trusted_browsers"
    }

    private fun getTrustedBrowsers(): Set<String> {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        return prefs.getStringSet(KEY_BROWSERS, null) ?: DEFAULT_BROWSER_PACKAGES
    }

    override fun onFillRequest(request: FillRequest, cancel: CancellationSignal, callback: FillCallback) {
        if (!SecretManager.sessionActive) {
            callback.onSuccess(null)
            return
        }

        val secretManager = SecretManager(applicationContext)
        val secret = secretManager.getSecret()
        if (secret == null) {
            callback.onSuccess(null)
            return
        }

        val structure = request.fillContexts.lastOrNull()?.structure
        if (structure == null) {
            callback.onSuccess(null)
            return
        }

        val requestingPackage = structure.activityComponent?.packageName

        val domain = extractDomain(structure)

        // If webDomain is present but app is not a trusted browser, refuse to fill
        if (domain != null && domain.isNotEmpty()) {
            val trustedBrowsers = getTrustedBrowsers()
            if (requestingPackage == null || requestingPackage !in trustedBrowsers) {
                callback.onSuccess(null)
                return
            }
        }

        if (domain.isNullOrEmpty()) {
            callback.onSuccess(null)
            return
        }

        val normalizedDomain = ServiceManager.normalizeSite(domain)
        val serviceManager = ServiceManager(applicationContext)
        val matches = serviceManager.getServices().filter {
            ServiceManager.normalizeSite(it.site) == normalizedDomain
        }

        if (matches.isEmpty()) {
            callback.onSuccess(null)
            return
        }

        val passwordNodes = mutableListOf<AutofillNodeInfo>()
        for (i in 0 until structure.windowNodeCount) {
            findPasswordNodes(structure.getWindowNodeAt(i).rootViewNode, passwordNodes)
        }

        if (passwordNodes.isEmpty()) {
            callback.onSuccess(null)
            return
        }

        val responseBuilder = FillResponse.Builder()
        for (service in matches) {
            val password = Keygrain.derivePassword(
                secret = secret.toByteArray(),
                email = service.email,
                site = service.site,
                length = service.length,
                symbols = service.symbols,
                counter = service.counter
            )

            val presentation = RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
                setTextViewText(android.R.id.text1, "Keygrain — ${service.name}")
            }

            val datasetBuilder = Dataset.Builder()
            for (node in passwordNodes) {
                datasetBuilder.setValue(node.id, AutofillValue.forText(password), presentation)
            }
            responseBuilder.addDataset(datasetBuilder.build())
        }

        callback.onSuccess(responseBuilder.build())
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        callback.onSuccess()
    }

    private fun extractDomain(structure: AssistStructure): String? {
        for (i in 0 until structure.windowNodeCount) {
            val domain = findDomain(structure.getWindowNodeAt(i).rootViewNode)
            if (domain != null) return domain
        }
        return null
    }

    private fun findDomain(node: AssistStructure.ViewNode): String? {
        node.webDomain?.let { if (it.isNotEmpty()) return it }
        for (i in 0 until node.childCount) {
            val result = findDomain(node.getChildAt(i))
            if (result != null) return result
        }
        return null
    }

    private data class AutofillNodeInfo(val id: android.view.autofill.AutofillId)

    private fun findPasswordNodes(node: AssistStructure.ViewNode, results: MutableList<AutofillNodeInfo>) {
        val autofillId = node.autofillId
        if (autofillId != null) {
            val hints = node.autofillHints
            val isPassword = hints?.any {
                it.equals("password", ignoreCase = true) ||
                it.equals(android.view.View.AUTOFILL_HINT_PASSWORD, ignoreCase = true)
            } == true || node.inputType and android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD != 0
            if (isPassword) {
                results.add(AutofillNodeInfo(autofillId))
            }
        }
        for (i in 0 until node.childCount) {
            findPasswordNodes(node.getChildAt(i), results)
        }
    }
}
