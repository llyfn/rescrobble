package io.github.llyfn.rescrobble

import io.ktor.http.HttpStatusCode
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

@Serializable
class MeResponse(val username: String, val pro: Boolean?)

fun Route.apiRoutes(tokens: SessionTokenCodec) {
    route("/api") {
        get("/me") {
            val session = call.signedInUser(tokens)
                ?: return@get call.respond(HttpStatusCode.Unauthorized)
            call.respond(MeResponse(username = session.username, pro = null))
        }
    }
}
