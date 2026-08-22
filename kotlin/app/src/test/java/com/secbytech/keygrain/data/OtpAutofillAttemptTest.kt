package com.secbytech.keygrain.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class OtpAutofillAttemptTest {
    @Test
    fun validAndMalformedServicesAreHandledIndependently() {
        val valid = service("valid", storedTotp())
        val malformed = service("bad", JSONObject().put("mode", "stored").put("seed", "not-base64"))
        val result = attempt(listOf(valid, malformed)).run()

        assertEquals(listOf("valid"), result!!.map { it.service.name })
        assertTrue(result.single().code.matches(Regex("\\d{6}")))
    }

    @Test
    fun emptyEligibleServicesProduceNoOptionalValuesForOtpOnly() {
        val result = attempt(listOf(service("bad", JSONObject().put("mode", "hotp")))).run()
        assertEquals(emptyList<OtpAutofillValue>(), result)
    }

    @Test
    fun derivedRecordUsesExistingDerivationPath() {
        val result = attempt(
            listOf(service("derived", JSONObject().put("mode", "derived"))),
            budgetMillis = 10_000L
        ).run()
        assertEquals(listOf("derived"), result!!.map { it.service.name })
        assertTrue(result.single().code.length == 6)
    }

    @Test
    fun cancellationAndDeadlineDiscardWholeOptionalAugmentation() {
        var canceled = false
        val canceledResult = attempt(
            listOf(service("valid", storedTotp())),
            isCanceled = { canceled }
        ).run()
        assertEquals(1, canceledResult!!.size)

        canceled = true
        val afterCancel = attempt(
            listOf(service("valid", storedTotp())),
            isCanceled = { canceled }
        ).run()
        assertNull(afterCancel)

        val late = attempt(
            listOf(service("valid", storedTotp())),
            budgetMillis = 1L,
            now = sequenceOf(0L, 2L).iterator()
        ).run()
        assertNull(late)
    }

    @Test
    fun oneClockReadValueIsAppliedToEveryService() {
        val first = service("first", storedTotp())
        val second = service("second", storedTotp())
        var reads = 0
        val result = OtpAutofillAttempt(
            services = listOf(first, second),
            secret = ByteArray(32),
            clock = object : OtpAutofillClock {
                override fun epochSeconds(): Long {
                    reads++
                    return 100L
                }
            },
            budget = budget(1000L),
            isCancelled = { false },
            nowMillis = { 0L }
        ).run()
        assertEquals(1, reads)
        assertEquals(result!![0].code, result[1].code)
    }

    @Test
    fun derivedFailureDiscardsOptionalAugmentationSoMixedFallbackCanRemain() {
        val valid = service("valid", storedTotp())
        val failingDerived = service("fail", JSONObject().put("mode", "derived"))
        val result = OtpAutofillAttempt(
            services = listOf(valid, failingDerived),
            secret = ByteArray(32),
            clock = fixedClock(),
            budget = budget(1000L),
            isCancelled = { false },
            prepare = { config, secret, current ->
                if (current.name == "fail") null
                else TotpAutofillGenerator.prepare(config, secret, current)
            }
        ).run()
        val response = mutableListOf("password-dataset")
        result?.forEach { response += it.service.name }
        assertEquals(listOf("password-dataset"), response)
        assertNull(result)
    }

    @Test
    fun generationExceptionDiscardsOptionalAugmentationForMixedFallback() {
        val result = OtpAutofillAttempt(
            services = listOf(service("valid", storedTotp())),
            secret = ByteArray(32),
            clock = fixedClock(),
            budget = budget(1000L),
            isCancelled = { false },
            generate = { _, _ -> error("synthetic generation failure") }
        ).run()
        val response = mutableListOf("password-dataset")
        result?.forEach { response += it.service.name }
        assertEquals(listOf("password-dataset"), response)
        assertNull(result)
    }

    @Test
    fun cancellationAfterPreparationClearsPreparedSeed() {
        var checks = 0
        lateinit var captured: PreparedTotp
        val result = OtpAutofillAttempt(
            services = listOf(service("valid", storedTotp())),
            secret = ByteArray(32),
            clock = fixedClock(),
            budget = budget(1000L),
            isCancelled = { ++checks >= 4 },
            nowMillis = { 0L },
            prepare = { config, secret, current ->
                captured = TotpAutofillGenerator.prepare(config, secret, current)!!
                captured
            }
        ).run()
        assertNull(result)
        assertNull(TotpAutofillGenerator.generate(captured, 100L))
    }

    private fun fixedClock() = object : OtpAutofillClock {
        override fun epochSeconds(): Long = 100L
    }

    private fun attempt(
        services: List<ServiceEntry>,
        isCanceled: () -> Boolean = { false },
        budgetMillis: Long = 1000L,
        now: Iterator<Long> = listOf(0L).iterator()
    ): OtpAutofillAttempt = OtpAutofillAttempt(
        services = services,
        secret = ByteArray(32),
        clock = object : OtpAutofillClock {
            override fun epochSeconds(): Long = 100L
        },
        budget = budget(budgetMillis),
        isCancelled = isCanceled,
        nowMillis = { if (now.hasNext()) now.next() else 0L }
    )

    private fun budget(value: Long) = object : OtpAutofillBudget {
        override fun maxDurationMillis(): Long = value
    }

    private fun storedTotp(): JSONObject = JSONObject().apply {
        put("mode", "stored")
        put("seed", Base64.getEncoder().encodeToString(ByteArray(20) { 7 }))
    }

    private fun service(name: String, totp: JSONObject) = ServiceEntry(
        name = name,
        site = "$name.example.com",
        email = "$name@example.com",
        totp = totp
    )

}
