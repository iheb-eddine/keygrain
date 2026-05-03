package com.badrani.keygrain.data

import android.app.assist.AssistStructure
import android.os.CancellationSignal
import android.service.autofill.*
import android.util.Log
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
        try {
            val secretManager = SecretManager(applicationContext)
            val secret = secretManager.getSecret()
            if (secret == null) {
                Log.d("KeygrainAutofill", "No secret available")
                callback.onSuccess(null)
                return
            }

            val structure = request.fillContexts.lastOrNull()?.structure
            if (structure == null) {
                Log.d("KeygrainAutofill", "No assist structure")
                callback.onSuccess(null)
                return
            }

            val requestingPackage = structure.activityComponent?.packageName

            val domain = extractDomain(structure)

            if (domain != null && domain.isNotEmpty()) {
                val trustedBrowsers = getTrustedBrowsers()
                if (requestingPackage == null || requestingPackage !in trustedBrowsers) {
                    Log.d("KeygrainAutofill", "Untrusted browser: $requestingPackage")
                    callback.onSuccess(null)
                    return
                }
            }

            if (domain.isNullOrEmpty()) {
                Log.d("KeygrainAutofill", "No domain found")
                callback.onSuccess(null)
                return
            }

            val normalizedDomain = ServiceManager.normalizeSite(domain)
            val psl = PublicSuffixList.getInstance(applicationContext)
            val visitedRegistrable = psl.extractRegistrableDomain(normalizedDomain)
            if (visitedRegistrable == null) {
                Log.d("KeygrainAutofill", "No registrable domain for: $normalizedDomain")
                callback.onSuccess(null)
                return
            }
            val serviceManager = ServiceManager(applicationContext)
            val matches = serviceManager.getServices().filter {
                psl.extractRegistrableDomain(ServiceManager.normalizeSite(it.site)) == visitedRegistrable
            }

            if (matches.isEmpty()) {
                Log.d("KeygrainAutofill", "No matching services for: $visitedRegistrable")
                callback.onSuccess(null)
                return
            }

            val passwordNodes = mutableListOf<AutofillNodeInfo>()
            for (i in 0 until structure.windowNodeCount) {
                findPasswordNodes(structure.getWindowNodeAt(i).rootViewNode, passwordNodes)
            }

            val passwordIds = passwordNodes.map { it.id }.toSet()
            val usernameNodes = mutableListOf<AutofillNodeInfo>()
            for (i in 0 until structure.windowNodeCount) {
                findUsernameNodes(structure.getWindowNodeAt(i).rootViewNode, usernameNodes, passwordIds)
            }

            if (passwordNodes.isEmpty() && usernameNodes.isEmpty()) {
                Log.d("KeygrainAutofill", "No autofillable fields found")
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
                for (node in usernameNodes) {
                    datasetBuilder.setValue(node.id, AutofillValue.forText(service.email), presentation)
                }
                for (node in passwordNodes) {
                    datasetBuilder.setValue(node.id, AutofillValue.forText(password), presentation)
                }
                responseBuilder.addDataset(datasetBuilder.build())
            }

            callback.onSuccess(responseBuilder.build())
        } catch (e: Exception) {
            Log.e("KeygrainAutofill", "onFillRequest failed", e)
            callback.onSuccess(null)
        }
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
            } == true || (node.inputType and android.text.InputType.TYPE_MASK_CLASS == android.text.InputType.TYPE_CLASS_TEXT
                    && node.inputType and android.text.InputType.TYPE_MASK_VARIATION == android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD)
                || (node.inputType and android.text.InputType.TYPE_MASK_CLASS == android.text.InputType.TYPE_CLASS_NUMBER
                    && node.inputType and android.text.InputType.TYPE_MASK_VARIATION == android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD)
            if (isPassword) {
                results.add(AutofillNodeInfo(autofillId))
            }
        }
        for (i in 0 until node.childCount) {
            findPasswordNodes(node.getChildAt(i), results)
        }
    }

    private fun findUsernameNodes(node: AssistStructure.ViewNode, results: MutableList<AutofillNodeInfo>, excludeIds: Set<android.view.autofill.AutofillId>) {
        val autofillId = node.autofillId
        if (autofillId != null && autofillId !in excludeIds) {
            val hints = node.autofillHints
            val variation = node.inputType and android.text.InputType.TYPE_MASK_VARIATION
            val isUsername = when {
                hints?.any {
                    it.equals("username", ignoreCase = true) ||
                    it.equals("emailAddress", ignoreCase = true) ||
                    it.equals(android.view.View.AUTOFILL_HINT_USERNAME, ignoreCase = true) ||
                    it.equals(android.view.View.AUTOFILL_HINT_EMAIL_ADDRESS, ignoreCase = true)
                } == true -> true
                node.inputType and android.text.InputType.TYPE_MASK_CLASS == android.text.InputType.TYPE_CLASS_TEXT &&
                    (variation == android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS ||
                     variation == android.text.InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS) -> true
                else -> {
                    val html = node.htmlInfo
                    html != null && html.tag.equals("input", ignoreCase = true) && run {
                        val attributes = html.attributes ?: emptyList()
                        val attrs = mutableMapOf<String, String>()
                        for (pair in attributes) {
                            attrs[pair.first.lowercase()] = pair.second?.lowercase() ?: ""
                        }
                        attrs["type"] == "email" ||
                            attrs["name"]?.let { it.contains("email") || it.contains("user") || it.contains("login") } == true ||
                            attrs["id"]?.let { it.contains("email") || it.contains("user") || it.contains("login") } == true
                    }
                }
            }
            if (isUsername) {
                results.add(AutofillNodeInfo(autofillId))
            }
        }
        for (i in 0 until node.childCount) {
            findUsernameNodes(node.getChildAt(i), results, excludeIds)
        }
    }
}
