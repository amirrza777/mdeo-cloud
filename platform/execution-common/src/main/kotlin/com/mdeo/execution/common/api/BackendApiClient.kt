package com.mdeo.execution.common.api

import com.mdeo.common.model.ExecutionState
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.modules.SerializersModule
import org.slf4j.LoggerFactory

/**
 * Base HTTP client for interacting with the backend API.
 * Provides common functionality for fetching data from the backend service.
 *
 * @param baseUrl Base URL of the backend API
 * @param serializersModule Optional custom serializers module for type-specific deserialization
 */
open class BackendApiClient(
    protected val baseUrl: String,
    serializersModule: SerializersModule? = null
) {
    protected val logger = LoggerFactory.getLogger(this::class.java)

    private companion object {
        val TERMINAL_STATES = setOf(
            ExecutionState.COMPLETED,
            ExecutionState.FAILED,
            ExecutionState.CANCELLED
        )

        /**
         * Attempts for a terminal state update, including the initial one.
         */
        const val TERMINAL_STATE_MAX_ATTEMPTS = 5

        /**
         * Delay before the first retry; doubled for each subsequent attempt.
         */
        const val RETRY_BASE_DELAY_MS = 1_000L
    }

    protected val client: HttpClient = HttpClient(CIO) {
        install(ContentNegotiation) {
            json(createJsonConfig(serializersModule))
        }
    }

    /**
     * Creates JSON configuration with optional custom serializers.
     */
    private fun createJsonConfig(serializersModule: SerializersModule?): Json {
        return Json {
            ignoreUnknownKeys = true
            isLenient = true
            if (serializersModule != null) {
                this.serializersModule = serializersModule
            }
        }
    }

    /**
     * Closes the HTTP client and releases resources.
     */
    fun close() {
        client.close()
    }

    /**
     * Updates execution state on the backend.
     *
     * Terminal states ([ExecutionState.COMPLETED], [ExecutionState.FAILED],
     * [ExecutionState.CANCELLED]) are retried with exponential backoff: unlike a progress update,
     * a lost terminal update is never superseded by a later one and leaves the backend showing the
     * execution as still running forever. Retries only cover transient failures (connection errors,
     * 5xx, 408, 429); a rejection such as an expired token is permanent and fails fast.
     *
     * @param executionId UUID of the execution
     * @param state New state string
     * @param progressText Optional progress text
     * @param jwtToken JWT token to authenticate the request
     * @return true if update was successful, false otherwise
     */
    suspend fun updateExecutionState(
        executionId: String,
        state: String,
        progressText: String?,
        jwtToken: String
    ): Boolean {
        val terminal = state in TERMINAL_STATES
        val maxAttempts = if (terminal) TERMINAL_STATE_MAX_ATTEMPTS else 1
        var attempt = 1

        while (true) {
            val status = try {
                client.patch("$baseUrl/executions/$executionId/state") {
                    contentType(ContentType.Application.Json)
                    header(HttpHeaders.Authorization, "Bearer $jwtToken")
                    setBody(UpdateExecutionStateRequest(state, progressText))
                }.status
            } catch (e: Exception) {
                logger.warn(
                    "Error updating execution $executionId to state $state on backend " +
                        "(attempt $attempt/$maxAttempts)", e
                )
                null
            }

            if (status == HttpStatusCode.OK || status == HttpStatusCode.NoContent) {
                return true
            }

            if (status != null && !isRetryable(status)) {
                logStateUpdateGivenUp(
                    "Backend rejected state update for execution $executionId to $state: $status",
                    terminal
                )
                return false
            }

            if (attempt >= maxAttempts) {
                logStateUpdateGivenUp(
                    "Giving up updating execution $executionId to state $state on backend " +
                        "after $maxAttempts attempt(s), last status: ${status ?: "connection error"}",
                    terminal
                )
                return false
            }

            delay(RETRY_BASE_DELAY_MS shl (attempt - 1))
            attempt++
        }
    }

    /**
     * Logs an abandoned state update. A lost terminal update permanently desynchronises the
     * backend, while a lost progress update is corrected by the next one.
     */
    private fun logStateUpdateGivenUp(message: String, terminal: Boolean) {
        if (terminal) logger.error(message) else logger.warn(message)
    }

    /**
     * Whether a failed state update is worth retrying, i.e. whether the response indicates a
     * transient condition rather than a request the backend will keep rejecting.
     */
    private fun isRetryable(status: HttpStatusCode): Boolean {
        return status.value >= 500 ||
            status == HttpStatusCode.RequestTimeout ||
            status == HttpStatusCode.TooManyRequests
    }

    /**
     * Updates execution metadata on the backend.
     *
     * @param executionId UUID of the execution
     * @param metadata JSON metadata object
     * @param jwtToken JWT token to authenticate the request
     * @return true if update was successful, false otherwise
     */
    suspend fun updateExecutionMetadata(
        executionId: String,
        metadata: JsonObject,
        jwtToken: String
    ): Boolean {
        return try {
            logger.info("Updating backend metadata for execution $executionId")

            val response = client.patch("$baseUrl/executions/$executionId/metadata") {
                contentType(ContentType.Application.Json)
                header(HttpHeaders.Authorization, "Bearer $jwtToken")
                setBody(UpdateExecutionMetadataRequest(metadata))
            }

            response.status == HttpStatusCode.OK || response.status == HttpStatusCode.NoContent
        } catch (e: Exception) {
            logger.error("Error updating execution metadata on backend", e)
            false
        }
    }

    /**
     * Makes an authenticated GET request to the backend.
     *
     * @param path The API path (relative to baseUrl)
     * @param jwtToken JWT token for authentication
     * @param queryParams Optional query parameters
     * @return The response or null if the request failed
     */
    protected suspend inline fun <reified T> authenticatedGet(
        path: String,
        jwtToken: String,
        queryParams: Map<String, String> = emptyMap()
    ): T? {
        return try {
            val response = client.get("$baseUrl$path") {
                queryParams.forEach { (key, value) -> parameter(key, value) }
                contentType(ContentType.Application.Json)
                header(HttpHeaders.Authorization, "Bearer $jwtToken")
            }

            if (response.status == HttpStatusCode.OK) {
                response.body<T>()
            } else {
                logger.warn("Request to $path failed with status: ${response.status}")
                null
            }
        } catch (e: Exception) {
            logger.error("Error making request to $path", e)
            null
        }
    }
}

/**
 * Request payload for updating execution state.
 */
@Serializable
internal data class UpdateExecutionStateRequest(
    val state: String,
    val progressText: String?
)

/**
 * Request payload for updating execution metadata.
 */
@Serializable
internal data class UpdateExecutionMetadataRequest(
    val metadata: JsonObject
)
