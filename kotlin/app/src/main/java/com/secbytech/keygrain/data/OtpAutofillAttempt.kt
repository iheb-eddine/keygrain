package com.secbytech.keygrain.data

internal data class OtpAutofillValue(
    val service: ServiceEntry,
    val code: String
)

/** Optional OTP work. A null result means the whole optional augmentation was abandoned. */
internal class OtpAutofillAttempt(
    private val services: List<ServiceEntry>,
    private val secret: ByteArray,
    private val clock: OtpAutofillClock,
    private val budget: OtpAutofillBudget,
    private val isCancelled: () -> Boolean,
    private val nowMillis: () -> Long = { System.nanoTime() / 1_000_000L },
    private val prepare: (ValidatedTotpConfig, ByteArray, ServiceEntry) -> PreparedTotp? =
        { config, requestSecret, service -> TotpAutofillGenerator.prepare(config, requestSecret, service) },
    private val generate: (PreparedTotp, Long) -> String? =
        { preparedTotp, epochSecond -> TotpAutofillGenerator.generate(preparedTotp, epochSecond) }
) {
    fun run(): List<OtpAutofillValue>? {
        val startMillis = nowMillis()
        if (budget.maxDurationMillis() <= 0L || isStopped(startMillis)) return null

        val prepared = mutableListOf<Pair<ServiceEntry, PreparedTotp>>()
        return try {
            for (service in services) {
                if (isStopped(startMillis)) return null
                val totp = service.totp ?: continue
                val config = try {
                    TotpAutofillValidator.validate(totp)
                } catch (_: Exception) {
                    null
                } ?: continue
                try {
                    if (isStopped(startMillis)) return null
                    if (config.mode == Mode.DERIVED && isStopped(startMillis)) return null
                    val preparedTotp = prepare(config, secret, service)
                    if (preparedTotp == null && config.mode == Mode.DERIVED) return null
                    if (preparedTotp != null) prepared += service to preparedTotp
                    if (isStopped(startMillis)) return null
                } finally {
                    config.clear()
                }
            }

            if (isStopped(startMillis) || prepared.isEmpty()) return emptyList()
            val epochSecond = clock.epochSeconds()
            if (epochSecond <= 0L || isStopped(startMillis)) return null

            val values = mutableListOf<OtpAutofillValue>()
            for ((service, preparedTotp) in prepared) {
                if (isStopped(startMillis)) return null
                val code = try {
                    generate(preparedTotp, epochSecond)
                } catch (_: Exception) {
                    return null
                }
                if (isStopped(startMillis)) return null
                if (code != null) values += OtpAutofillValue(service, code)
            }
            if (isStopped(startMillis)) null else values
        } finally {
            prepared.forEach { (_, preparedTotp) -> preparedTotp.clear() }
        }
    }

    private fun isStopped(startMillis: Long): Boolean {
        if (isCancelled()) return true
        val elapsed = nowMillis() - startMillis
        val max = budget.maxDurationMillis()
        return elapsed < 0L || elapsed >= max
    }
}
