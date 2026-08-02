package com.mdeo.optimizerexecution.worker

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.ConcurrentHashMap

/**
 * Raised when a worker stops reporting progress on a request it was given.
 *
 * @param message Description of which request was abandoned and when it was last heard from.
 */
class WorkerUnresponsiveException(message: String) : RuntimeException(message)

/**
 * Tracks how recently each in-flight request was heard from, so that a caller can wait for work
 * of any length without imposing a deadline on it.
 *
 * Requests are answered by a worker in another process or on another host. Three things can
 * happen to one: it completes, the worker dies, or the worker stays alive while the request goes
 * nowhere — a send that failed silently, a reply that was lost, a connection that was severed
 * without being closed. The first two resolve the caller's [CompletableDeferred] on their own.
 * The third is what this class exists for, and the only signal that distinguishes it from work
 * that is simply slow is the worker saying it is still busy. So that is what is measured here:
 * not how long the request has taken, but how long since the worker last said anything at all.
 *
 * A worker processes requests one at a time, so a beat for one request also vouches for those
 * queued behind it — they are not being neglected, their turn has not come. Beats therefore
 * refresh every request in flight to this worker. What they cannot outlast is idleness: a worker
 * with nothing left to work on stops beating, which is exactly the state a request that was never
 * received, or whose reply went missing, leaves behind.
 *
 * @param unresponsiveAfterMs Silence after which in-flight requests are treated as abandoned.
 * @param pollIntervalMs How often a waiter re-checks liveness while waiting.
 */
class RequestLiveness(
    private val unresponsiveAfterMs: Long = UNRESPONSIVE_AFTER_MS,
    private val pollIntervalMs: Long = HEARTBEAT_INTERVAL_MS
) {

    /**
     * Last time each in-flight request was heard from, as a monotonic reading in nanoseconds.
     */
    private val lastSignal = ConcurrentHashMap<String, Long>()

    /**
     * Begins tracking [requestId], counting from now.
     *
     * Call this before sending, not after: a request whose send silently failed produces no
     * further signal, and starting the clock at send time is what makes that case time out
     * instead of waiting forever.
     *
     * @param requestId The request being sent.
     */
    fun starting(requestId: String) {
        lastSignal[requestId] = System.nanoTime()
    }

    /**
     * The request the worker last reported working on, or `null` if it has reported nothing.
     */
    @Volatile
    private var lastReported: String? = null

    /**
     * Records that the worker reported progress on [requestId], which counts as a sign of life
     * for every request currently in flight to it.
     *
     * @param requestId The request the worker reported working on.
     */
    fun signal(requestId: String) {
        val now = System.nanoTime()
        lastReported = requestId
        lastSignal.replaceAll { _, _ -> now }
    }

    /**
     * Stops tracking [requestId]. Safe to call for a request that was never tracked.
     *
     * @param requestId The request that has finished, failed, or been abandoned.
     */
    fun finished(requestId: String) {
        lastSignal.remove(requestId)
    }

    /**
     * Waits for [deferred] for as long as the worker keeps reporting progress on [requestId].
     *
     * @param requestId The request being awaited.
     * @param deferred The result to wait for.
     * @return The result once it arrives.
     * @throws WorkerUnresponsiveException if nothing is heard about [requestId] for
     *         [unresponsiveAfterMs].
     */
    suspend fun <T : Any> awaitWhileAlive(requestId: String, deferred: CompletableDeferred<T>): T {
        while (true) {
            withTimeoutOrNull(pollIntervalMs) { deferred.await() }?.let { return it }
            if (deferred.isCompleted) return deferred.await()
            val silentForMs = silentForMs(requestId)
            if (silentForMs >= unresponsiveAfterMs) {
                val lastReported = this.lastReported
                val working = if (lastReported != null) "last worked on $lastReported" else "never reported working"
                throw WorkerUnresponsiveException(
                    "Worker went silent for ${silentForMs}ms while request $requestId was in flight ($working)"
                )
            }
        }
    }

    /**
     * How long ago [requestId] was last heard from, in milliseconds. An untracked request counts
     * as never heard from, so a caller waiting on one gives up rather than waiting forever.
     */
    private fun silentForMs(requestId: String): Long {
        val last = lastSignal[requestId] ?: return Long.MAX_VALUE
        return (System.nanoTime() - last) / 1_000_000L
    }
}
