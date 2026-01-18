package com.badrani.keygrain.data

import android.app.assist.AssistStructure
import android.os.CancellationSignal
import android.service.autofill.*
import android.view.autofill.AutofillValue
import android.widget.RemoteViews

class KeygrainAutofillService : AutofillService() {

    // TODO: SECURITY — No Digital Asset Links (DAL) verification.
    // A malicious app can embed a WebView loading any domain (e.g. bank.com),
    // trigger autofill on a password field, and receive the real derived password.
    // Mitigation: verify the requesting app's signing certificate against the domain's
    // /.well-known/assetlinks.json, or add a user confirmation step before filling.

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

        val domain = extractDomain(structure)
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
