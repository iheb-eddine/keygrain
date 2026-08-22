package com.secbytech.keygrain.data

import android.service.autofill.Dataset
import android.service.autofill.FillResponse
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import java.util.concurrent.Future
import java.util.concurrent.FutureTask
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal interface OtpAutofillClock {
    fun epochSeconds(): Long
}

internal interface OtpAutofillBudget {
    fun maxDurationMillis(): Long
}

internal class PreparedTotp private constructor(
    private val seedBytes: ByteArray,
    val digits: Int,
    val period: Int,
    val algorithm: String
) {
    private val cleared = AtomicBoolean(false)
    companion object {
        fun from(seed: ByteArray, config: ValidatedTotpConfig): PreparedTotp =
            PreparedTotp(seed.copyOf(), config.digits, config.period, config.algorithm)
    }

    fun clear() {
        if (cleared.compareAndSet(false, true)) seedBytes.fill(0)
    }

    internal fun seedCopyForGeneration(): ByteArray? =
        if (cleared.get()) null else seedBytes.copyOf()
}

internal object TotpAutofillGenerator {
    fun prepare(
        config: ValidatedTotpConfig,
        secret: ByteArray,
        service: ServiceEntry
    ): PreparedTotp? {
        val seed = try {
            when (config.mode) {
                Mode.STORED -> config.seedCopy()
                Mode.DERIVED -> TotpEngine.deriveTotpSeed(secret, service.email, service.site)
            }
        } catch (_: Exception) {
            null
        } ?: return null
        return try {
            PreparedTotp.from(seed, config)
        } finally {
            seed.fill(0)
        }
    }

    fun generate(prepared: PreparedTotp, epochSecond: Long): String? {
        if (epochSecond <= 0L) return null
        val remaining = prepared.period - (epochSecond % prepared.period)
        if (remaining <= 5L) return null
        val seed = prepared.seedCopyForGeneration() ?: return null
        return try {
            TotpEngine.generateTotp(
                seed,
                epochSecond,
                prepared.digits,
                prepared.period,
                prepared.algorithm
            )
        } catch (_: Exception) {
            null
        } finally {
            seed.fill(0)
        }
    }
}

/** One process-wide no-queue permit for synchronous derived-mode Argon2 work. */
internal object TotpAutofillDerivedExecutor {
    private val permit = Semaphore(1)
    private val executor = ThreadPoolExecutor(
        1,
        1,
        1L,
        TimeUnit.MILLISECONDS,
        SynchronousQueue(),
        Executors.defaultThreadFactory(),
        ThreadPoolExecutor.AbortPolicy()
    ).apply {
        allowCoreThreadTimeOut(true)
    }

    fun <T> submit(task: () -> T): Future<T>? = submit(task, {})

    fun <T> submit(task: () -> T, onNotStarted: () -> Unit): Future<T>? {
        if (!permit.tryAcquire()) {
            onNotStarted()
            return null
        }
        val ran = AtomicBoolean(false)
        val released = AtomicBoolean(false)
        val cleaned = AtomicBoolean(false)
        fun releaseOnce() {
            if (released.compareAndSet(false, true)) permit.release()
        }
        fun cleanupNotStartedOnce() {
            if (cleaned.compareAndSet(false, true)) onNotStarted()
        }
        val future = object : FutureTask<T>({
            ran.set(true)
            try {
                task()
            } finally {
                releaseOnce()
            }
        }) {
            override fun done() {
                // If cancellation won before the callable started, its finally cannot run.
                if (!ran.get()) {
                    releaseOnce()
                    cleanupNotStartedOnce()
                }
            }
        }
        return try {
            executor.execute(future)
            future
        } catch (_: RejectedExecutionException) {
            releaseOnce()
            cleanupNotStartedOnce()
            null
        }
    }
}

internal class FillCompletion(private val deliver: (FillResponse?) -> Unit) {
    private enum class State { OPEN, CANCELLED, COMPLETED }
    private val state = AtomicReference(State.OPEN)

    fun cancel(): Boolean = state.compareAndSet(State.OPEN, State.CANCELLED)

    fun complete(response: FillResponse?): Boolean {
        if (!state.compareAndSet(State.OPEN, State.COMPLETED)) return false
        deliver(response)
        return true
    }
}

internal object OtpAutofillResponse {
    fun addValue(dataset: Dataset.Builder, id: AutofillId, code: String) {
        dataset.setValue(id, AutofillValue.forText(code))
    }
}
