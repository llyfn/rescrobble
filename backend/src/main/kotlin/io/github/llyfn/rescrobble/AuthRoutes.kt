package io.github.llyfn.rescrobble

import io.ktor.http.HttpStatusCode
import io.ktor.http.URLBuilder
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.response.respondRedirect
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import io.ktor.server.sessions.clear
import io.ktor.server.sessions.sessions
import io.ktor.server.sessions.set
import kotlinx.serialization.Serializable

const val SIGN_IN_FAILED_PATH = "/?signIn=failed"

/** Last.fm's codes for an invalid, unauthorized, or expired approval token. */
private val INVALID_TOKEN_CODES = setOf(4, 14, 15)

@Serializable
class SessionRequest(val token: String)

@Serializable
class SessionResponse(val username: String, val token: String)

@Serializable
class ErrorResponse(val error: String)

fun Route.authRoutes(config: Config, lastFm: LastFmClient, tokens: SessionTokenCodec) {
    route("/auth") {
        get("/login") {
            val approvalUrl = URLBuilder(LastFmClient.AUTH_URL).apply {
                parameters.append("api_key", config.lastFmApiKey)
                parameters.append("cb", "${config.publicBaseUrl}/auth/callback")
            }.buildString()
            call.respondRedirect(approvalUrl)
        }

        get("/callback") {
            val token = call.request.queryParameters["token"]
            if (token.isNullOrBlank()) return@get call.respondRedirect(SIGN_IN_FAILED_PATH)

            val session = try {
                lastFm.getSession(token)
            } catch (_: LastFmException) {
                return@get call.respondRedirect(SIGN_IN_FAILED_PATH)
            }
            call.sessions.set(UserSession(session.username, session.sessionKey))
            call.respondRedirect("/")
        }

        post("/session") {
            val request = call.receive<SessionRequest>()
            val session = try {
                lastFm.getSession(request.token)
            } catch (e: LastFmException.Api) {
                return@post if (e.code in INVALID_TOKEN_CODES) {
                    call.respond(HttpStatusCode.Unauthorized, ErrorResponse("invalidToken"))
                } else {
                    call.respond(HttpStatusCode.ServiceUnavailable, ErrorResponse("lastFmUnavailable"))
                }
            } catch (_: LastFmException.Unavailable) {
                return@post call.respond(HttpStatusCode.ServiceUnavailable, ErrorResponse("lastFmUnavailable"))
            }
            val token = tokens.encode(UserSession(session.username, session.sessionKey))
            call.respond(SessionResponse(session.username, token))
        }

        post("/logout") {
            if (call.isCookieRequestFromElsewhere(config)) return@post call.respond(HttpStatusCode.Forbidden)
            call.sessions.clear<UserSession>()
            call.respond(HttpStatusCode.NoContent)
        }
    }
}
