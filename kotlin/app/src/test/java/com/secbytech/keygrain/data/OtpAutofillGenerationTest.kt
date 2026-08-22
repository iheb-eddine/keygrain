package com.secbytech.keygrain.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class OtpAutofillGenerationTest {
    @Test
    fun storedPreparationAndGenerationUseExistingEngine() {
        val seed = ByteArray(20) { (it + 1).toByte() }
        val config = storedConfig(seed)
        val service = service("stored")
        val prepared = TotpAutofillGenerator.prepare(config, ByteArray(32), service)
        assertNotNull(prepared)
        assertEquals(
            TotpEngine.generateTotp(seed, 100L, 6, 30, "SHA1"),
            TotpAutofillGenerator.generate(prepared!!, 100L)
        )
        prepared.clear()
        config.clear()
    }

    @Test
    fun preparedSeedIsDefensiveAndClearIsIdempotent() {
        val config = storedConfig(ByteArray(20) { 9 })
        val prepared = TotpAutofillGenerator.prepare(config, ByteArray(1), service("copy"))!!
        prepared.clear()
        prepared.clear()
        assertNull(TotpAutofillGenerator.generate(prepared, 100L))
    }

    @Test
    fun oneCallerTimestampControlsAllGenerationAndRolloverFailsClosed() {
        val config = storedConfig(ByteArray(20) { 3 })
        val first = TotpAutofillGenerator.prepare(config, ByteArray(1), service("one"))!!
        val second = TotpAutofillGenerator.prepare(config, ByteArray(1), service("two"))!!
        assertEquals(
            TotpAutofillGenerator.generate(first, 100L),
            TotpAutofillGenerator.generate(second, 100L)
        )
        assertNull(TotpAutofillGenerator.generate(first, 0L))
        assertNull(TotpAutofillGenerator.generate(first, 25L))
        assertNull(TotpAutofillGenerator.generate(first, 26L))
        assertNotNull(TotpAutofillGenerator.generate(first, 24L))
        first.clear()
        second.clear()
        config.clear()
    }

    @Test
    fun periodsOneThroughFiveNeverPassFiveSecondGuard() {
        for (period in 1..5) {
            val config = storedConfig(ByteArray(20) { 4 }, period = period)
            val prepared = TotpAutofillGenerator.prepare(config, ByteArray(1), service("p$period"))!!
            assertNull("period=$period", TotpAutofillGenerator.generate(prepared, period.toLong()))
            prepared.clear()
            config.clear()
        }
    }

    @Test
    fun derivedExecutorHasOnePermitNoQueueAndRecoversAfterUnwind() {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val first = TotpAutofillDerivedExecutor.submit {
            started.countDown()
            release.await(5, TimeUnit.SECONDS)
            "first"
        }
        assertNotNull(first)
        assertTrue(started.await(5, TimeUnit.SECONDS))
        assertNull(TotpAutofillDerivedExecutor.submit { "queued" })
        release.countDown()
        assertEquals("first", first!!.get(5, TimeUnit.SECONDS))
        val recovered = TotpAutofillDerivedExecutor.submit { "recovered" }
        assertNotNull(recovered)
        assertEquals("recovered", recovered!!.get(5, TimeUnit.SECONDS))
    }

    @Test
    fun canceledFutureDoesNotPermanentlyConsumeDerivedPermit() {
        val future = TotpAutofillDerivedExecutor.submit { "canceled" }
        assertNotNull(future)
        future!!.cancel(false)
        val recovered = TotpAutofillDerivedExecutor.submit { "recovered" }
        assertNotNull(recovered)
        assertEquals("recovered", recovered!!.get(5, TimeUnit.SECONDS))
    }

    @Test
    fun cancelRunningWorkerReleasesPermitAfterUnwind() {
        val started = CountDownLatch(1)
        val future = TotpAutofillDerivedExecutor.submit {
            started.countDown()
            try {
                Thread.sleep(10_000L)
            } catch (_: InterruptedException) {
                // The worker finally must still release the permit.
            }
            "stopped"
        }
        assertNotNull(future)
        assertTrue(started.await(5, TimeUnit.SECONDS))
        assertTrue(future!!.cancel(true))
        var recovered = TotpAutofillDerivedExecutor.submit { "recovered" }
        repeat(50) {
            if (recovered != null) return@repeat
            Thread.sleep(10L)
            recovered = TotpAutofillDerivedExecutor.submit { "recovered" }
        }
        assertNotNull(recovered)
        assertEquals("recovered", recovered!!.get(5, TimeUnit.SECONDS))
    }

    @Test
    fun rejectedDerivedWorkRunsNotStartedCleanup() {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val first = TotpAutofillDerivedExecutor.submit {
            started.countDown()
            release.await(5, TimeUnit.SECONDS)
            "first"
        }
        assertNotNull(first)
        assertTrue(started.await(5, TimeUnit.SECONDS))
        var cleanupCalls = 0
        val rejected = TotpAutofillDerivedExecutor.submit(
            { "never" },
            onNotStarted = { cleanupCalls++ }
        )
        assertNull(rejected)
        assertEquals(1, cleanupCalls)
        release.countDown()
        assertEquals("first", first!!.get(5, TimeUnit.SECONDS))
    }

    @Test
    fun completionCancelRaceHasOneTerminalWinner() {
        val deliveries = AtomicInteger(0)
        val completion = FillCompletion { deliveries.incrementAndGet() }
        assertTrue(completion.cancel())
        assertFalse(completion.complete(null))
        assertFalse(completion.cancel())
        assertEquals(0, deliveries.get())

        val completed = FillCompletion { deliveries.incrementAndGet() }
        assertTrue(completed.complete(null))
        assertFalse(completed.complete(null))
        assertFalse(completed.cancel())
        assertEquals(1, deliveries.get())
    }

    @Test
    fun completionMarksCompletedBeforeDeliveryExceptionAndDoesNotRedeliver() {
        val deliveries = AtomicInteger(0)
        val completion = FillCompletion {
            deliveries.incrementAndGet()
            error("injected delivery error")
        }
        try {
            completion.complete(null)
        } catch (_: IllegalStateException) {
            // The terminal CAS has already won before delivery is invoked.
        }
        assertFalse(completion.complete(null))
        assertFalse(completion.cancel())
        assertEquals(1, deliveries.get())
    }

    private fun storedConfig(seed: ByteArray, period: Int = 30): ValidatedTotpConfig {
        return TotpAutofillValidator.validate(
            JSONObject()
                .put("mode", "stored")
                .put("seed", Base64.getEncoder().encodeToString(seed))
                .put("period", period)
        )!!
    }

    private fun service(name: String): ServiceEntry = ServiceEntry(
        name = name,
        site = "$name.example.com",
        email = "$name@example.com"
    )
}
