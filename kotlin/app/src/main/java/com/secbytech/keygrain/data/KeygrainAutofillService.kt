package com.secbytech.keygrain.data

import android.app.assist.AssistStructure
import android.os.CancellationSignal
import android.service.autofill.*
import android.util.Log
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicReference

class KeygrainAutofillService : AutofillService() {

    companion object {
        internal val DEFAULT_BROWSER_PACKAGES = setOf(
            "com.android.chrome",
            "org.mozilla.firefox",
            "com.sec.android.app.sbrowser",
            "com.brave.browser",
            "com.microsoft.emmx",
            "com.duckduckgo.mobile.android",
            "com.opera.browser"
        )
        private const val PREFS_NAME = "keygrain_autofill"
        private const val KEY_BROWSERS = "trusted_browsers"
        // Provisional bounded value; API 26+/slow-device measurements are a release gate.
        private const val OPTIONAL_TOTP_BUDGET_MILLIS = 1500L
        private val OPTIONAL_TOTP_BUDGET = object : OtpAutofillBudget {
            override fun maxDurationMillis(): Long = OPTIONAL_TOTP_BUDGET_MILLIS
        }

        internal fun isPasswordHint(hint: String?): Boolean {
            if (hint == null) return false
            return hint.contains("password", ignoreCase = true)
        }

        internal fun isPasswordInputType(inputType: Int): Boolean {
            val maskClass = inputType and android.text.InputType.TYPE_MASK_CLASS
            val variation = inputType and android.text.InputType.TYPE_MASK_VARIATION
            return (maskClass == android.text.InputType.TYPE_CLASS_TEXT &&
                (variation == android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                 variation == android.text.InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
                 variation == android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD)) ||
                (maskClass == android.text.InputType.TYPE_CLASS_NUMBER &&
                 variation == android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD)
        }

        internal fun isPasswordAttributes(attrs: Map<String, String>): Boolean {
            val type = attrs["type"] ?: ""
            val autocomplete = attrs["autocomplete"] ?: ""
            val name = attrs["name"] ?: ""
            val id = attrs["id"] ?: ""

            if (type.equals("password", ignoreCase = true)) return true
            if (autocomplete.contains("password", ignoreCase = true)) return true

            val isTextEnterable = type.isEmpty() || type.equals("text", ignoreCase = true)
            if (isTextEnterable) {
                if (hasPasswordToken(name) || hasPasswordToken(id)) {
                    return true
                }
            }
            return false
        }

        private fun hasPasswordToken(value: String): Boolean {
            if (value.isEmpty()) return false
            if (value.contains("password", ignoreCase = true) ||
                value.contains("passwd", ignoreCase = true)) {
                return true
            }
            val tokens = value.lowercase().split('_', '-', ' ', '.')
            val nonPasswordModifiers = setOf("boarding", "bus", "train", "boardingpass", "event", "transit")
            if (tokens.any { it in nonPasswordModifiers }) return false
            return tokens.any { it == "pass" || it == "pwd" }
        }
    }

    private fun getTrustedBrowsers(): Set<String> {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        return prefs.getStringSet(KEY_BROWSERS, null) ?: DEFAULT_BROWSER_PACKAGES
    }

    override fun onFillRequest(request: FillRequest, cancel: CancellationSignal, callback: FillCallback) {
        var otpPath = false
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

            if (cancel.isCanceled) {
                callback.onSuccess(null)
                return
            }
            val otpCandidate = OtpAutofillDetector.findCandidate(structure)
            if (cancel.isCanceled) {
                callback.onSuccess(null)
                return
            }

            val requestingPackage = structure.activityComponent?.packageName

            val domain = extractDomain(structure)

            if (domain != null && domain.isNotEmpty()) {
                val trustedBrowsers = getTrustedBrowsers()
                if (requestingPackage == null || requestingPackage !in trustedBrowsers) {
                    Log.d("KeygrainAutofill", "Untrusted browser")
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
            val serviceManager = ServiceManager(applicationContext)
            val matches = AutofillMatcher.mostSpecificMatches(
                normalizedDomain,
                serviceManager.getServices(),
                psl
            )

            if (matches.isEmpty()) {
                Log.d("KeygrainAutofill", "No matching services")
                callback.onSuccess(null)
                return
            }

            if (cancel.isCanceled) {
                callback.onSuccess(null)
                return
            }

            val otpExcludeIds = when (otpCandidate) {
                is OtpCandidateResult.One -> setOf(otpCandidate.id)
                else -> emptySet()
            }

            val passwordNodes = mutableListOf<AutofillNodeInfo>()
            for (i in 0 until structure.windowNodeCount) {
                findPasswordNodes(structure.getWindowNodeAt(i).rootViewNode, passwordNodes, otpExcludeIds)
            }

            val passwordIds = passwordNodes.map { it.id }.toSet() + otpExcludeIds
            val usernameNodes = mutableListOf<AutofillNodeInfo>()
            for (i in 0 until structure.windowNodeCount) {
                findUsernameNodes(structure.getWindowNodeAt(i).rootViewNode, usernameNodes, passwordIds)
            }

            if (passwordNodes.isEmpty() && usernameNodes.isEmpty() && otpCandidate !is OtpCandidateResult.One) {
                Log.d("KeygrainAutofill", "No autofillable fields found")
                callback.onSuccess(null)
                return
            }

            if (otpCandidate is OtpCandidateResult.One) {
                otpPath = true
                handleOtpRequest(
                    secret = secret,
                    matches = matches,
                    usernameNodes = usernameNodes,
                    passwordNodes = passwordNodes,
                    otpId = otpCandidate.id,
                    cancel = cancel,
                    callback = callback
                )
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
            if (!otpPath) {
                Log.e("KeygrainAutofill", "onFillRequest failed", e)
                callback.onSuccess(null)
            }
        }
    }

    private data class OtpDatasetState(
        val service: ServiceEntry,
        val passwordBuilder: Dataset.Builder,
        val otpBuilder: Dataset.Builder,
        val presentation: RemoteViews,
        val hasPasswordValue: Boolean,
        var hasOtpValue: Boolean
    )

    private fun handleOtpRequest(
        secret: String,
        matches: List<ServiceEntry>,
        usernameNodes: List<AutofillNodeInfo>,
        passwordNodes: List<AutofillNodeInfo>,
        otpId: android.view.autofill.AutofillId,
        cancel: CancellationSignal,
        callback: FillCallback
    ) {
        val completion = FillCompletion { response -> callback.onSuccess(response) }
        val futureRef = AtomicReference<Future<*>?>(null)
        cancel.setOnCancelListener {
            completion.cancel()
            futureRef.get()?.cancel(true)
        }
        try {
            if (cancel.isCanceled) {
                completion.cancel()
                return
            }

        val states = try {
            matches.map { service ->
                val presentation = RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
                    setTextViewText(android.R.id.text1, "Keygrain — ${service.name}")
                }
                val passwordDataset = Dataset.Builder(presentation)
                val otpDataset = Dataset.Builder(presentation)
                var hasPasswordValue = false
                for (node in usernameNodes) {
                    val value = AutofillValue.forText(service.email)
                    passwordDataset.setValue(node.id, value, presentation)
                    otpDataset.setValue(node.id, value, presentation)
                    hasPasswordValue = true
                }
                for (node in passwordNodes) {
                    val password = Keygrain.derivePassword(
                        secret = secret.toByteArray(),
                        email = service.email,
                        site = service.site,
                        length = service.length,
                        symbols = service.symbols,
                        counter = service.counter
                    )
                    val value = AutofillValue.forText(password)
                    passwordDataset.setValue(node.id, value, presentation)
                    otpDataset.setValue(node.id, value, presentation)
                    hasPasswordValue = true
                }
                OtpDatasetState(service, passwordDataset, otpDataset, presentation, hasPasswordValue, false)
            }.toMutableList()
        } catch (_: Exception) {
            completion.complete(null)
            return
        }

        if (cancel.isCanceled) {
            completion.cancel()
            return
        }

        val optionalStartMillis = System.nanoTime() / 1_000_000L
        val optionalBudgetMillis = OPTIONAL_TOTP_BUDGET.maxDurationMillis()
        fun optionalBudgetAvailable(): Boolean {
            val elapsed = (System.nanoTime() / 1_000_000L) - optionalStartMillis
            return elapsed >= 0L && elapsed < optionalBudgetMillis
        }
        val secretBytes = secret.toByteArray()
        val attempt = OtpAutofillAttempt(
            services = matches,
            secret = secretBytes,
            clock = object : OtpAutofillClock {
                override fun epochSeconds(): Long = System.currentTimeMillis() / 1000L
            },
            budget = OPTIONAL_TOTP_BUDGET,
            isCancelled = { cancel.isCanceled },
            nowMillis = { System.nanoTime() / 1_000_000L }
        )

        fun buildResponse(includeOtp: Boolean): FillResponse? {
            val responseBuilder = FillResponse.Builder()
            var datasetCount = 0
            states.forEach { state ->
                val hasValue = state.hasPasswordValue || (includeOtp && state.hasOtpValue)
                if (!hasValue) return@forEach
                val builder = if (includeOtp && state.hasOtpValue) {
                    state.otpBuilder
                } else {
                    state.passwordBuilder
                }
                responseBuilder.addDataset(builder.build())
                datasetCount++
            }
            return if (datasetCount == 0) null else responseBuilder.build()
        }

        fun finish(values: List<OtpAutofillValue>?) {
            if (cancel.isCanceled) {
                completion.cancel()
                return
            }
            var includeOtp = values != null && optionalBudgetAvailable()
            if (includeOtp) {
                try {
                    values!!.forEach { value ->
                        val state = states.firstOrNull { it.service == value.service } ?: return@forEach
                        OtpAutofillResponse.addValue(state.otpBuilder, otpId, value.code, state.presentation)
                        state.hasOtpValue = true
                    }
                } catch (_: Exception) {
                    includeOtp = false
                }
            }
            val response = if (includeOtp) buildResponse(includeOtp = true) else buildResponse(includeOtp = false)
            // Response construction is part of the optional budget. If it expired while
            // building, publish only the already-built password fallback.
            val finalResponse = if (includeOtp && !optionalBudgetAvailable()) {
                buildResponse(includeOtp = false)
            } else {
                response
            }
            if (cancel.isCanceled) {
                completion.cancel()
                return
            }
            completion.complete(finalResponse)
        }

        val hasDerivedCandidate = matches.any { service ->
            val totp = service.totp
            try {
                totp != null && totp.has("mode") && !totp.isNull("mode") &&
                    totp.get("mode") is String && totp.getString("mode") == "derived"
            } catch (_: Exception) {
                false
            }
        }

        if (hasDerivedCandidate) {
            val future = TotpAutofillDerivedExecutor.submit({
                try {
                    finish(attempt.run())
                } catch (_: Exception) {
                    try {
                        finish(null)
                    } catch (_: Exception) {
                        completion.complete(null)
                    }
                    Unit
                } finally {
                    secretBytes.fill(0)
                }
            }, onNotStarted = { secretBytes.fill(0) })
            if (future == null) {
                secretBytes.fill(0)
                finish(null)
            } else {
                futureRef.set(future)
                if (cancel.isCanceled) future.cancel(true)
            }
        } else {
            try {
                try {
                    finish(attempt.run())
                } catch (_: Exception) {
                    finish(null)
                }
            } finally {
                secretBytes.fill(0)
            }
        }
        } catch (_: Exception) {
            completion.complete(null)
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

    private fun findPasswordNodes(
        node: AssistStructure.ViewNode,
        results: MutableList<AutofillNodeInfo>,
        excludeIds: Set<android.view.autofill.AutofillId> = emptySet()
    ) {
        val autofillId = node.autofillId
        if (autofillId != null && autofillId !in excludeIds) {
            val hints = node.autofillHints
            val isPassword = hints?.any { isPasswordHint(it) } == true
                || isPasswordInputType(node.inputType)
                || run {
                    val html = node.htmlInfo
                    html != null && html.tag.equals("input", ignoreCase = true) && run {
                        val attributes = html.attributes ?: emptyList()
                        val attrs = mutableMapOf<String, String>()
                        for (pair in attributes) {
                            val key = pair?.first?.lowercase() ?: continue
                            attrs[key] = pair.second?.lowercase() ?: ""
                        }
                        isPasswordAttributes(attrs)
                    }
                }
            if (isPassword) {
                results.add(AutofillNodeInfo(autofillId))
            }
        }
        for (i in 0 until node.childCount) {
            findPasswordNodes(node.getChildAt(i), results, excludeIds)
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
                            val key = pair?.first?.lowercase() ?: continue
                            attrs[key] = pair.second?.lowercase() ?: ""
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
