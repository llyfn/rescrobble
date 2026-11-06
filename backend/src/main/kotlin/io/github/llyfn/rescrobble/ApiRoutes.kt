package io.github.llyfn.rescrobble

import io.ktor.http.HttpStatusCode
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

@Serializable
class MeResponse(val username: String, val pro: Boolean?)

fun Route.apiRoutes(lastFm: LastFmClient, tokens: SessionTokenCodec) {
    route("/api") {
        get("/me") {
            val session = call.signedInUser(tokens)
                ?: return@get call.respond(HttpStatusCode.Unauthorized)
            val pro = try {
                lastFm.getAuthenticatedUser(session.sessionKey).pro
            } catch (e: LastFmException) {
                // Only a revoked session ends sign-in; an outage still lets the user see who they are.
                if (e is LastFmException.Api && e.code == LastFmClient.INVALID_SESSION) {
                    return@get call.respondLastFmFailure(e)
                }
                null
            }
            call.respond(MeResponse(username = session.username, pro = pro))
        }
    }
}
