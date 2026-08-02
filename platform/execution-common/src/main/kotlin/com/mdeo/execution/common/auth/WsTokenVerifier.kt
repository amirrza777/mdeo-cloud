package com.mdeo.execution.common.auth

import com.auth0.jwk.JwkProvider
import com.auth0.jwk.JwkProviderBuilder
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.auth0.jwt.interfaces.DecodedJWT
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.security.interfaces.RSAPublicKey
import java.util.concurrent.TimeUnit

/**
 * Verifies bearer tokens outside of Ktor's request authentication pipeline.
 *
 * The HTTP routes get their verification from `configureJwtAuth`, which only applies to a
 * call that carries an `Authorization` header. A WebSocket connection is authorized once at
 * the handshake and then carries many requests for potentially different work, so the
 * connection's own credentials say nothing about any individual request on it. This verifies
 * the token each request supplies for itself, against the same JWKS and issuer.
 *
 * @param backendUrl Base URL of the backend serving `/.well-known/jwks.json`
 * @param issuer Expected token issuer
 */
class WsTokenVerifier(
    backendUrl: String,
    private val issuer: String
) {
    private val jwkProvider: JwkProvider = JwkProviderBuilder(backendUrl)
        .cached(10, 24, TimeUnit.HOURS)
        .rateLimited(10, 1, TimeUnit.MINUTES)
        .build()

    /**
     * Verifies a token and extracts the claims execution services authorize against.
     *
     * @param token The raw bearer token
     * @return The token's principal data, or null if the token is missing or invalid
     */
    suspend fun verify(token: String?): JwtPrincipalData? {
        if (token.isNullOrBlank()) {
            return null
        }
        val decoded = try {
            // JWKS fetches on a cache miss are blocking network calls.
            withContext(Dispatchers.IO) { verifyToken(token) }
        } catch (e: Exception) {
            return null
        }
        return JwtPrincipalData(
            projectId = decoded.getClaim("projectId")?.asString(),
            executionId = decoded.getClaim("executionId")?.asString(),
            scopes = decoded.getClaim("scope")?.asList(String::class.java) ?: emptyList()
        )
    }

    private fun verifyToken(token: String): DecodedJWT {
        val keyId = JWT.decode(token).keyId
        val publicKey = jwkProvider.get(keyId).publicKey as RSAPublicKey
        return JWT.require(Algorithm.RSA256(publicKey, null))
            .withIssuer(issuer)
            .acceptLeeway(3)
            .build()
            .verify(token)
    }
}
