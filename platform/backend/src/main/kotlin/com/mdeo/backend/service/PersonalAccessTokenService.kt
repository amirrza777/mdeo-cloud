package com.mdeo.backend.service

import com.mdeo.backend.database.PersonalAccessTokensTable
import com.mdeo.backend.database.UsersTable
import com.mdeo.common.model.PersonalAccessTokenCreated
import com.mdeo.common.model.PersonalAccessTokenInfo
import com.mdeo.common.model.User
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import org.slf4j.LoggerFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64
import java.util.UUID
import kotlin.uuid.toJavaUuid
import kotlin.uuid.toKotlinUuid

/**
 * A prefix on every generated token, matching GitHub's own convention for
 * personal access tokens. Lets a caller (in particular [com.mdeo.backend.routes.gitRoutes])
 * cheaply decide whether an HTTP basic password looks like a token before
 * doing a database lookup, and gives anyone reading logs or support
 * requests an unambiguous way to recognize one.
 */
private const val TOKEN_PREFIX = "mdeo_pat_"

/**
 * Manages personal access tokens: an alternative to the account password
 * for git's HTTP basic auth that is independently revocable and does not
 * expose the account password itself.
 *
 * @param services The injected services providing access to configuration and other services
 */
class PersonalAccessTokenService(services: InjectedServices) : BaseService(), InjectedServices by services {
    private val logger = LoggerFactory.getLogger(PersonalAccessTokenService::class.java)
    private val secureRandom = SecureRandom()

    /**
     * Creates a new token for a user.
     *
     * @param userId The token's owner
     * @param name A label the user chooses to tell tokens apart later
     * @param expiresAt When the token stops working, or null for no expiry
     * @return The created token's metadata plus the raw value, which is
     *   never stored and cannot be recovered after this call returns
     */
    fun createToken(userId: UUID, name: String, expiresAt: Instant?): PersonalAccessTokenCreated {
        val rawToken = generateToken()
        val id = UUID.randomUUID()
        val now = Instant.now()

        transaction {
            PersonalAccessTokensTable.insert {
                it[PersonalAccessTokensTable.id] = id.toKotlinUuid()
                it[PersonalAccessTokensTable.userId] = userId.toKotlinUuid()
                it[PersonalAccessTokensTable.name] = name
                it[tokenHash] = hashToken(rawToken)
                it[tokenPrefix] = rawToken.take(TOKEN_PREFIX.length + 4)
                it[createdAt] = now
                it[PersonalAccessTokensTable.expiresAt] = expiresAt
            }
        }

        logger.info("Created personal access token '{}' for user {}", name, userId)
        return PersonalAccessTokenCreated(
            id = id.toString(),
            name = name,
            token = rawToken,
            createdAt = now.toString(),
            expiresAt = expiresAt?.toString()
        )
    }

    /**
     * Lists a user's own tokens. Never includes the raw value or its hash.
     */
    fun listTokens(userId: UUID): List<PersonalAccessTokenInfo> {
        return transaction {
            PersonalAccessTokensTable.selectAll()
                .where { PersonalAccessTokensTable.userId eq userId.toKotlinUuid() }
                .map { it.toInfo() }
        }
    }

    /**
     * Revokes a token, scoped to the caller's own tokens so one user cannot
     * revoke another's by guessing an id.
     *
     * @return true if a token was deleted, false if it did not exist or did not belong to [userId]
     */
    fun revokeToken(userId: UUID, tokenId: UUID): Boolean {
        return transaction {
            val deleted = PersonalAccessTokensTable.deleteWhere {
                (PersonalAccessTokensTable.id eq tokenId.toKotlinUuid()) and
                    (PersonalAccessTokensTable.userId eq userId.toKotlinUuid())
            }
            deleted > 0
        }
    }

    /**
     * Verifies a raw token value, the git-auth equivalent of
     * [UserService.verifyPassword]. A hash lookup rather than a bcrypt
     * comparison, so unlike password verification this is not a
     * meaningful CPU cost to rate-limit against.
     *
     * @return The token's owning user, or null if the token is unknown,
     *   expired, or does not start with the recognized prefix at all
     */
    fun verifyToken(rawToken: String): User? {
        if (!rawToken.startsWith(TOKEN_PREFIX)) {
            return null
        }

        val hash = hashToken(rawToken)
        return transaction {
            val row = PersonalAccessTokensTable
                .join(UsersTable, JoinType.INNER, PersonalAccessTokensTable.userId, UsersTable.id)
                .select(UsersTable.id, UsersTable.username, UsersTable.roles, PersonalAccessTokensTable.id, PersonalAccessTokensTable.expiresAt)
                .where { PersonalAccessTokensTable.tokenHash eq hash }
                .firstOrNull() ?: return@transaction null

            val expiresAt = row[PersonalAccessTokensTable.expiresAt]
            if (expiresAt != null && expiresAt.isBefore(Instant.now())) {
                return@transaction null
            }

            PersonalAccessTokensTable.update({ PersonalAccessTokensTable.id eq row[PersonalAccessTokensTable.id] }) {
                it[lastUsedAt] = Instant.now()
            }

            User(
                id = row[UsersTable.id].toJavaUuid().toString(),
                username = row[UsersTable.username],
                roles = parseRoles(row[UsersTable.roles]).toList()
            )
        }
    }

    private fun generateToken(): String {
        val bytes = ByteArray(32)
        secureRandom.nextBytes(bytes)
        return TOKEN_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun hashToken(rawToken: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(rawToken.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun ResultRow.toInfo(): PersonalAccessTokenInfo {
        return PersonalAccessTokenInfo(
            id = this[PersonalAccessTokensTable.id].toJavaUuid().toString(),
            name = this[PersonalAccessTokensTable.name],
            tokenPrefix = this[PersonalAccessTokensTable.tokenPrefix],
            createdAt = this[PersonalAccessTokensTable.createdAt].toString(),
            lastUsedAt = this[PersonalAccessTokensTable.lastUsedAt]?.toString(),
            expiresAt = this[PersonalAccessTokensTable.expiresAt]?.toString()
        )
    }

    private fun parseRoles(rawRoles: String): Set<String> {
        return rawRoles
            .split(",")
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .toSet()
    }
}
