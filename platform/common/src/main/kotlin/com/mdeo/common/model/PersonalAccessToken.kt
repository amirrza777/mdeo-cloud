package com.mdeo.common.model

import kotlinx.serialization.Serializable

/**
 * Request payload to create a new personal access token.
 *
 * @property name A label the user chooses to tell tokens apart later
 * @property expiresAt When the token stops working, or null for no expiry (ISO 8601 timestamp)
 */
@Serializable
data class CreatePersonalAccessTokenRequest(
    val name: String,
    val expiresAt: String? = null
)

/**
 * Response to creating a personal access token. [token] is the raw secret
 * value and is only ever present in this one response - it cannot be
 * recovered afterward, only revoked and replaced with a new one.
 *
 * @property id Unique identifier for the token
 * @property name The label the user gave it
 * @property token The raw token value, shown once
 * @property createdAt When the token was created (ISO 8601 timestamp)
 * @property expiresAt When the token stops working, or null for no expiry (ISO 8601 timestamp)
 */
@Serializable
data class PersonalAccessTokenCreated(
    val id: String,
    val name: String,
    val token: String,
    val createdAt: String,
    val expiresAt: String? = null
)

/**
 * A personal access token's metadata, without the raw value.
 *
 * @property id Unique identifier for the token
 * @property name The label the user gave it
 * @property tokenPrefix First few characters of the raw token, enough to tell tokens apart in a list
 * @property createdAt When the token was created (ISO 8601 timestamp)
 * @property lastUsedAt When the token was last used to authenticate, or null if never (ISO 8601 timestamp)
 * @property expiresAt When the token stops working, or null for no expiry (ISO 8601 timestamp)
 */
@Serializable
data class PersonalAccessTokenInfo(
    val id: String,
    val name: String,
    val tokenPrefix: String,
    val createdAt: String,
    val lastUsedAt: String? = null,
    val expiresAt: String? = null
)
