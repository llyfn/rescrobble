package io.github.llyfn.rescrobble

import io.ktor.http.HttpHeaders
import io.ktor.server.application.ApplicationCall
import io.ktor.server.sessions.get
import io.ktor.server.sessions.sessions

/**
 * The signed-in user from either the Extension's bearer token or the Web App's cookie.
 * A request that sends an Authorization header is judged by that header alone.
 */
fun ApplicationCall.signedInUser(tokens: SessionTokenCodec): UserSession? {
    val authorization = request.headers[HttpHeaders.Authorization]
        ?: return sessions.get<UserSession>()
    val (scheme, token) = authorization.trim().split(' ', limit = 2).takeIf { it.size == 2 } ?: return null
    if (!scheme.equals("Bearer", ignoreCase = true) || token.isBlank()) return null
    return tokens.decode(token.trim())
}
