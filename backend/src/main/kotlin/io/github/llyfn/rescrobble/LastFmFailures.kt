package io.github.llyfn.rescrobble

import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.response.header
import io.ktor.server.response.respond

private const val RETRY_AFTER_SECONDS = 60

/** A revoked session means signing in again; anything else from Last.fm is worth retrying later. */
suspend fun ApplicationCall.respondLastFmFailure(failure: LastFmException) {
    if (failure is LastFmException.Api && failure.code == LastFmClient.INVALID_SESSION) {
        respond(HttpStatusCode.Unauthorized, ErrorResponse("sessionInvalid"))
    } else {
        response.header(HttpHeaders.RetryAfter, RETRY_AFTER_SECONDS)
        respond(HttpStatusCode.ServiceUnavailable, ErrorResponse("lastFmUnavailable"))
    }
}
