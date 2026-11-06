package io.github.llyfn.rescrobble

import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.Url
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.install
import io.ktor.server.plugins.cors.routing.CORS

private fun Config.webAppHost(): String = Url(publicBaseUrl).let {
    if (it.specifiedPort == 0 || it.specifiedPort == it.protocol.defaultPort) it.host else "${it.host}:${it.specifiedPort}"
}

private fun Config.webAppOrigin(): String = "${Url(publicBaseUrl).protocol.name}://${webAppHost()}"

/**
 * Only the Web App and the Extension may call the backend from a browser. Credentials are not
 * allowed cross-origin: the Web App is served from the same origin, and the Extension sends a bearer token.
 */
fun Application.installCors(config: Config) {
    install(CORS) {
        allowHost(config.webAppHost(), schemes = listOf(Url(config.publicBaseUrl).protocol.name))
        allowHost(config.extensionId, schemes = listOf("chrome-extension"))
        allowMethod(HttpMethod.Post)
        allowHeader(HttpHeaders.Authorization)
        allowHeader(HttpHeaders.ContentType)
    }
}

/**
 * A cookie rides along on any request to this site, including ones another site triggers, so a
 * state-changing request authenticated by cookie must come from the Web App's own origin.
 * Bearer requests carry their credential explicitly and need no such check.
 */
fun ApplicationCall.isCookieRequestFromElsewhere(config: Config): Boolean {
    if (request.headers[HttpHeaders.Authorization] != null) return false
    val origin = request.headers[HttpHeaders.Origin] ?: return true
    return !origin.equals(config.webAppOrigin(), ignoreCase = true)
}
